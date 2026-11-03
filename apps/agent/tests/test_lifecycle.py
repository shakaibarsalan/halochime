import asyncio

from talkfront_agent.agent import accepts_temperature
from talkfront_agent.lifecycle import EndReason, OnceGuard
from talkfront_agent.tools import format_results
from talkfront_agent.transcript import TranscriptBuffer, describe_tool_call


def test_once_guard_runs_once_for_concurrent_and_later_callers():
    calls = 0

    async def finalize():
        nonlocal calls
        calls += 1
        await asyncio.sleep(0.01)
        return "done"

    async def main():
        guard = OnceGuard()
        results = await asyncio.gather(*(guard.run(finalize) for _ in range(5)))
        later = await guard.run(finalize)
        return results, later

    results, later = asyncio.run(main())
    assert calls == 1
    assert results == ["done"] * 5 and later == "done"


def test_once_guard_survives_a_cancelled_caller():
    calls = 0

    async def finalize():
        nonlocal calls
        calls += 1
        await asyncio.sleep(0.02)
        return "done"

    async def main():
        guard = OnceGuard()
        first = asyncio.create_task(guard.run(finalize))
        await asyncio.sleep(0)
        first.cancel()
        return await guard.run(finalize)

    assert asyncio.run(main()) == "done"
    assert calls == 1


def test_end_reason_first_wins():
    r = EndReason()
    assert r.resolve("visitor_left") == "visitor_left"
    assert r.set("max_duration") is True
    assert r.set("agent_ended") is False
    assert r.resolve("visitor_left") == "max_duration"


def test_transcript_flush_keeps_rows_on_failure_and_ignores_late_rows():
    sent: list[list[dict]] = []
    fail = True

    async def send(rows):
        if fail:
            raise RuntimeError("api down")
        sent.append(rows)

    async def main():
        nonlocal fail
        buf = TranscriptBuffer(send, interval=999)
        buf.add("user", "hello", 1_700_000_000)
        buf.add("assistant", "   ")  # empty rows are skipped
        buf.add("assistant", "hi there", 1_700_000_001)
        assert await buf.flush() is False
        assert buf.pending == 2
        fail = False
        buf.add("tool", "search_knowledge {} -> ok: x")
        assert await buf.aclose() is True
        buf.add("user", "too late")
        return buf

    buf = asyncio.run(main())
    assert buf.pending == 0
    assert [[r["role"] for r in batch] for batch in sent] == [["user", "assistant", "tool"]]


def test_describe_tool_call_is_short():
    line = describe_tool_call("search_knowledge", '{"query": "refunds"}', "x" * 1000, False)
    assert line.startswith('search_knowledge {"query": "refunds"} -> ok: ')
    assert len(line) < 400
    assert describe_tool_call("request_human", "{}", "boom", True).endswith("-> error: boom")


def test_format_results_has_titles():
    text = format_results(
        [
            {"chunkId": "c", "sourceId": "s", "title": "Refunds", "url": "https://x.test/r", "content": "30 days.", "score": 1},
            {"chunkId": "d", "sourceId": "s", "title": "", "url": None, "content": "Shipping info", "score": 0.5},
        ]
    )
    assert "[1] Refunds (https://x.test/r)\n30 days." in text
    assert "[2] Untitled\nShipping info" in text


def test_temperature_only_for_models_that_accept_it():
    assert not accepts_temperature("claude-haiku-5-5")
    assert not accepts_temperature("claude-opus-4-7")
    assert accepts_temperature("claude-sonnet-4-6")
    assert accepts_temperature("claude-haiku-4-5")
    assert accepts_temperature("claude-3-5-haiku-20241022")


def test_handoff_draft_needs_a_new_visitor_turn():
    from talkfront_agent.lifecycle import HandoffDraft, TurnCounter

    turns = TurnCounter()
    draft = HandoffDraft(turns)
    assert draft.take_confirmed()[0] is None  # nothing prepared

    draft.prepare({"message": "catering quote", "phone": "0300"})
    request, reason = draft.take_confirmed()
    assert request is None and reason  # same turn: the model can't confirm for the visitor

    turns.user_turn()  # visitor replied "yes"
    request, reason = draft.take_confirmed()
    assert request == {"message": "catering quote", "phone": "0300"} and reason is None
    assert draft.take_confirmed()[0] is None  # sent once


def test_handoff_draft_restore_keeps_it_confirmed():
    from talkfront_agent.lifecycle import HandoffDraft, TurnCounter

    turns = TurnCounter()
    draft = HandoffDraft(turns)
    draft.prepare({"message": "x", "email": "a@b.co"})
    turns.user_turn()
    request, _ = draft.take_confirmed()
    draft.restore(request)  # send failed
    assert draft.take_confirmed()[0] == request
