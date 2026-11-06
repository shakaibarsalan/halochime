"""Live inbox: a team member takes a conversation over from the AI, talks, and hands it back."""

from __future__ import annotations

import asyncio
import json

import pytest
from livekit.agents import llm, room_io

from talkfront_agent import agent as agent_mod
from talkfront_agent.api import make_message
from talkfront_agent.takeover import (
    AUTO_RELEASE_S,
    MAX_STAFF_NAME,
    MAX_STAFF_TEXT,
    StaffCommand,
    StaffDesk,
    back_text,
    joined_text,
    parse_staff_command,
)
from talkfront_agent.transcript import TranscriptBuffer


class Clock:
    def __init__(self) -> None:
        self.t = 1000.0

    def __call__(self) -> float:
        return self.t


def _desk(clock: Clock | None = None) -> tuple[StaffDesk, list[tuple]]:
    events: list[tuple] = []
    desk = StaffDesk(
        on_join=lambda name: events.append(("join", name)),
        on_say=lambda text, name, mid: events.append(("say", text, name, mid)),
        on_release=lambda name, auto: events.append(("release", name, auto)),
        now=clock or Clock(),
    )
    return desk, events


# ------------------------------------------------------------------ commands


def test_parse_commands() -> None:
    assert parse_staff_command(b'{"type":"takeover","name":"  Sam   Lee "}') == StaffCommand("takeover", name="Sam Lee")
    assert parse_staff_command('{"type":"release"}') == StaffCommand("release")
    say = parse_staff_command(json.dumps({"type": "say", "text": "  Hi there,\nlet me check.  ", "id": "m1", "name": "Sam"}))
    assert say == StaffCommand("say", name="Sam", text="Hi there,\nlet me check.", id="m1")


@pytest.mark.parametrize(
    "raw",
    [b"not json", b"[]", b'{"type":"dance"}', b'{"type":"say","text":"   "}', b'{"type":"say"}', b"\xff\xfe"],
)
def test_unreadable_commands_are_ignored(raw: bytes) -> None:
    assert parse_staff_command(raw) is None


def test_long_values_are_cut() -> None:
    cmd = parse_staff_command(json.dumps({"type": "say", "text": "a" * 5000, "name": "n" * 500, "id": "i" * 500}))
    assert cmd is not None
    assert len(cmd.text) == MAX_STAFF_TEXT and len(cmd.name) == MAX_STAFF_NAME and len(cmd.id) <= 100


def test_wording() -> None:
    assert joined_text("Sam") == "Sam from the team joined the chat"
    assert back_text("Ava") == "You're back with Ava"
    assert back_text("  ") == "You're back with the assistant"


# ------------------------------------------------------------------ state machine


def test_takeover_say_release() -> None:
    desk, events = _desk()
    assert not desk.active
    assert desk.handle(StaffCommand("takeover", name="Sam"))
    assert desk.active and desk.name == "Sam"
    # Taking over again (a second click, or a refresh) says nothing new.
    assert not desk.handle(StaffCommand("takeover", name="Sam"))
    assert desk.handle(StaffCommand("say", name="Sam", text="Hello!", id="m1"))
    # The same message twice is said once.
    desk.handle(StaffCommand("say", name="Sam", text="Hello!", id="m1"))
    assert desk.handle(StaffCommand("release"))
    assert not desk.active
    # Releasing again does nothing.
    assert not desk.handle(StaffCommand("release"))
    assert events == [("join", "Sam"), ("say", "Hello!", "Sam", "m1"), ("release", "Sam", False)]


def test_say_without_takeover_joins_first() -> None:
    # After an automatic hand back the dashboard may still send words: the team member joins again.
    desk, events = _desk()
    desk.handle(StaffCommand("say", name="Sam", text="Still here", id="m2"))
    assert desk.active
    assert events == [("join", "Sam"), ("say", "Still here", "Sam", "m2")]


def test_another_team_member_takes_over() -> None:
    desk, events = _desk()
    desk.handle(StaffCommand("takeover", name="Sam"))
    desk.handle(StaffCommand("takeover", name="Priya"))
    assert desk.name == "Priya"
    assert events == [("join", "Sam"), ("join", "Priya")]


def test_nameless_commands_keep_the_current_name() -> None:
    desk, events = _desk()
    desk.handle(StaffCommand("takeover"))
    assert desk.name == "Someone"
    desk.handle(StaffCommand("say", text="Hi", id="x"))
    assert events == [("join", "Someone"), ("say", "Hi", "Someone", "x")]


def test_auto_release_after_quiet_time() -> None:
    clock = Clock()
    desk, events = _desk(clock)
    desk.handle(StaffCommand("takeover", name="Sam"))
    clock.t += AUTO_RELEASE_S - 10
    assert not desk.check_idle()
    # Each message starts the wait again.
    desk.handle(StaffCommand("say", name="Sam", text="One moment", id="a"))
    clock.t += AUTO_RELEASE_S - 1
    assert not desk.check_idle() and desk.active
    clock.t += 2
    assert desk.check_idle()
    assert not desk.active
    assert events[-1] == ("release", "Sam", True)
    # Nothing more to release.
    clock.t += AUTO_RELEASE_S * 2
    assert not desk.check_idle()


def test_spoken_staff_words_are_claimed_once() -> None:
    desk, _ = _desk()
    handle = object()
    assert not desk.claim_spoken()  # an ordinary AI reply
    desk.expect_spoken(handle)
    assert desk.claim_spoken()  # the staff words, already saved as "staff"
    assert not desk.claim_spoken()  # the next AI reply is saved as usual
    desk.forget_spoken(handle)  # its speech ended afterwards: nothing left to forget

    cut = object()
    desk.expect_spoken(cut)
    desk.forget_spoken(cut)  # cut off before any words: no reply will come
    assert desk.spoken_pending == 0
    assert not desk.claim_spoken()


# ------------------------------------------------------------------ no AI replies while taken over


def _message(text: str) -> llm.ChatMessage:
    return llm.ChatMessage(role="user", content=[text])


@pytest.mark.parametrize("realtime", [False, True])
def test_voice_turn_gets_no_reply_while_taken_over(realtime: bool) -> None:
    async def run() -> list[str]:
        held: list[str] = []

        async def keep(text: str) -> None:
            held.append(text)

        a = agent_mod.TalkfrontAgent(instructions="sys", realtime=realtime)
        a.taken_over = lambda: True
        a.on_held_turn = keep
        with pytest.raises(llm.StopResponse):
            await a.on_user_turn_completed(llm.ChatContext.empty(), _message("can you hear me?"))
        return held

    held = asyncio.run(run())
    # Classic voice keeps the words itself (LiveKit drops the turn); realtime saves its own transcript.
    assert held == ([] if realtime else ["can you hear me?"])


def test_voice_turn_is_answered_when_not_taken_over() -> None:
    async def run() -> None:
        a = agent_mod.TalkfrontAgent(instructions="sys")
        a.taken_over = lambda: False
        assert await a.on_user_turn_completed(llm.ChatContext.empty(), _message("hello there")) is None

    asyncio.run(run())


def test_typed_message_is_kept_not_answered_while_taken_over() -> None:
    async def run() -> tuple[list[str], list[str]]:
        state = {"taken": True}
        kept: list[str] = []
        answered: list[str] = []

        async def keep(text: str) -> None:
            kept.append(text)

        async def answer(sess, ev) -> None:  # type: ignore[no-untyped-def]
            answered.append(ev.text)

        cb = agent_mod.staff_aware_text_input(lambda: state["taken"], keep, answer)
        await cb(None, room_io.TextInputEvent(text="is anyone there?"))  # type: ignore[arg-type]
        state["taken"] = False
        await cb(None, room_io.TextInputEvent(text="thanks"))  # type: ignore[arg-type]
        return kept, answered

    kept, answered = asyncio.run(run())
    assert kept == ["is anyone there?"]
    assert answered == ["thanks"]


# ------------------------------------------------------------------ transcript


def test_staff_role_is_a_transcript_role() -> None:
    assert make_message("staff", "Hi, this is Sam.")["role"] == "staff"


def test_visitor_staff_and_notice_lines_are_sent_quickly() -> None:
    async def run() -> list[list[str]]:
        sent: list[list[str]] = []

        async def send(rows):  # type: ignore[no-untyped-def]
            sent.append([r["role"] for r in rows])

        buf = TranscriptBuffer(send, interval=30, urgent_delay=0.01, min_gap=0.05)
        buf.start()
        buf.add("assistant", "an AI reply")  # waits for the next regular flush ...
        await asyncio.sleep(0.1)
        assert sent == []
        buf.add("staff", "Hi, this is Sam")  # ... unless a line the live inbox waits for comes
        buf.add("system", "Sam from the team joined the chat")
        await asyncio.sleep(0.1)
        buf.add("user", "hello Sam")
        await asyncio.sleep(0.1)
        await buf.aclose()
        return sent

    sent = asyncio.run(run())
    assert sent == [["assistant", "staff", "system"], ["user"]]
