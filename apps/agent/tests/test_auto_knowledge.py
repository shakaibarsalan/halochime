"""The agent attaches knowledge results to the latest visitor message before the model answers."""

from __future__ import annotations

import asyncio

import pytest
from livekit.agents import Agent, llm

from talkfront_agent import agent as agent_mod


class FakeApi:
    pass


def _ctx(*messages: tuple[str, str]) -> llm.ChatContext:
    ctx = llm.ChatContext.empty()
    for role, text in messages:
        ctx.add_message(role=role, content=text)  # type: ignore[arg-type]
    return ctx


async def _run(agent: agent_mod.TalkfrontAgent, ctx: llm.ChatContext) -> llm.ChatContext:
    seen: list[llm.ChatContext] = []

    async def fake_default_llm_node(self, chat_ctx, tools, model_settings):  # type: ignore[no-untyped-def]
        seen.append(chat_ctx)
        if False:
            yield ""

    original = Agent.default.llm_node
    Agent.default.llm_node = fake_default_llm_node  # type: ignore[method-assign]
    try:
        async for _ in agent.llm_node(ctx, [], None):
            pass
    finally:
        Agent.default.llm_node = original  # type: ignore[method-assign]
    return seen[0]


def test_note_inserted_before_latest_user_message(monkeypatch: pytest.MonkeyPatch) -> None:
    async def run() -> None:
        calls: list[str] = []

        async def fake_search(api, conversation_id, query):  # type: ignore[no-untyped-def]
            calls.append(query)
            return "[1] Install\nPaste one script tag before </body>."

        monkeypatch.setattr(agent_mod, "search_formatted", fake_search)
        a = agent_mod.TalkfrontAgent(instructions="sys", api=FakeApi(), conversation_id="c1")  # type: ignore[arg-type]
        sent = await _run(a, _ctx(("system", "sys"), ("user", "hi"), ("assistant", "hello"), ("user", "how do I install it?")))

        roles = [i.role for i in sent.items if isinstance(i, llm.ChatMessage)]
        assert roles == ["system", "user", "assistant", "system", "user"]
        note = sent.items[-2]
        assert isinstance(note, llm.ChatMessage) and "Paste one script tag" in (note.text_content or "")
        assert calls == ["how do I install it?"]

        # A second step of the same turn (e.g. after a tool call) reuses the search.
        await _run(a, _ctx(("system", "sys"), ("user", "how do I install it?")))
        assert calls == ["how do I install it?"]

    asyncio.run(run())


def test_no_note_when_nothing_found_or_search_fails(monkeypatch: pytest.MonkeyPatch) -> None:
    async def run() -> None:
        async def nothing(api, conversation_id, query):  # type: ignore[no-untyped-def]
            return None

        monkeypatch.setattr(agent_mod, "search_formatted", nothing)
        a = agent_mod.TalkfrontAgent(instructions="sys", api=FakeApi(), conversation_id="c1")  # type: ignore[arg-type]
        sent = await _run(a, _ctx(("system", "sys"), ("user", "what are your hours?")))
        assert [i.role for i in sent.items if isinstance(i, llm.ChatMessage)] == ["system", "user"]

        async def slow(api, conversation_id, query):  # type: ignore[no-untyped-def]
            await asyncio.sleep(5)
            return "late"

        monkeypatch.setattr(agent_mod, "search_formatted", slow)
        monkeypatch.setattr(agent_mod, "AUTO_SEARCH_TIMEOUT_S", 0.05)
        b = agent_mod.TalkfrontAgent(instructions="sys", api=FakeApi(), conversation_id="c1")  # type: ignore[arg-type]
        sent = await _run(b, _ctx(("system", "sys"), ("user", "what are your hours?")))
        assert [i.role for i in sent.items if isinstance(i, llm.ChatMessage)] == ["system", "user"]

    asyncio.run(run())


def test_short_messages_skip_search(monkeypatch: pytest.MonkeyPatch) -> None:
    async def run() -> None:
        async def boom(api, conversation_id, query):  # type: ignore[no-untyped-def]
            raise AssertionError("should not search")

        monkeypatch.setattr(agent_mod, "search_formatted", boom)
        a = agent_mod.TalkfrontAgent(instructions="sys", api=FakeApi(), conversation_id="c1")  # type: ignore[arg-type]
        sent = await _run(a, _ctx(("system", "sys"), ("user", "ok")))
        assert len(sent.items) == 2

    asyncio.run(run())


def test_realtime_turn_gets_one_fresh_knowledge_note(monkeypatch: pytest.MonkeyPatch) -> None:
    async def run() -> None:
        async def fake_search(api, conversation_id, query):  # type: ignore[no-untyped-def]
            return f"[1] About\nResults for {query}"

        monkeypatch.setattr(agent_mod, "search_formatted", fake_search)
        a = agent_mod.TalkfrontAgent(instructions="sys", api=FakeApi(), conversation_id="c1", realtime=True)  # type: ignore[arg-type]
        pushed: list[llm.ChatContext] = []

        async def fake_update(ctx: llm.ChatContext) -> None:
            pushed.append(ctx)
            a._chat_ctx = ctx  # what the real agent would now hold

        monkeypatch.setattr(a, "update_chat_ctx", fake_update)
        for question in ("what are your opening hours", "do you deliver to my area"):
            msg = llm.ChatMessage(role="user", content=[question])
            await a.on_user_turn_completed(llm.ChatContext.empty(), msg)
        notes = [i for i in pushed[-1].items if isinstance(i, llm.ChatMessage) and i.role == "system" and "Results for" in (i.text_content or "")]
        assert len(notes) == 1 and "do you deliver" in (notes[0].text_content or "")

        classic = agent_mod.TalkfrontAgent(instructions="sys", api=FakeApi(), conversation_id="c1")  # type: ignore[arg-type]
        monkeypatch.setattr(classic, "update_chat_ctx", fake_update)
        before = len(pushed)
        await classic.on_user_turn_completed(llm.ChatContext.empty(), llm.ChatMessage(role="user", content=["opening hours please"]))
        assert len(pushed) == before  # classic voices use llm_node instead

    asyncio.run(run())
