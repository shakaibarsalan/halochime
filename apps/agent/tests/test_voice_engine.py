"""Voice engine choice: realtime when configured and OpenAI is healthy; backups follow the agent's model."""

from __future__ import annotations

import time

import pytest

from talkfront_agent import agent as agent_mod
from talkfront_agent.api import parse_runtime_config

from .test_metadata import runtime_payload


def _runtime(mode: str = "voice", voice: object = None, llm: dict | None = None):  # type: ignore[no-untyped-def]
    payload = runtime_payload(**({"llm": llm} if llm else {}))
    payload["mode"] = mode
    if voice is not None:
        payload["agent"]["voice"] = voice
    return parse_runtime_config(payload)


def test_voice_block_is_optional_and_defaults_to_classic() -> None:
    assert _runtime().agent.voice.engine == "classic"
    rt = _runtime(voice={"engine": "realtime", "realtimeModel": "gpt-realtime-2.1-mini", "realtimeVoice": "cedar"})
    assert (rt.agent.voice.engine, rt.agent.voice.realtime_voice) == ("realtime", "cedar")
    assert _runtime(voice={"engine": "something-else"}).agent.voice.engine == "classic"


def test_use_realtime_needs_voice_mode_key_and_healthy_openai(monkeypatch: pytest.MonkeyPatch) -> None:
    realtime = {"engine": "realtime", "realtimeModel": "gpt-realtime-2.1-mini", "realtimeVoice": "marin"}
    monkeypatch.setitem(agent_mod._openai_health, "checked_at", 1e18)  # fresh: no background check
    monkeypatch.setitem(agent_mod._openai_health, "ok", True)
    monkeypatch.setenv("OPENAI_API_KEY", "test")
    assert agent_mod.use_realtime(_runtime(voice=realtime)) is True
    assert agent_mod.use_realtime(_runtime(mode="text", voice=realtime)) is False
    assert agent_mod.use_realtime(_runtime(voice={**realtime, "engine": "classic"})) is False
    monkeypatch.setitem(agent_mod._openai_health, "ok", False)
    assert agent_mod.use_realtime(_runtime(voice=realtime)) is False
    monkeypatch.setitem(agent_mod._openai_health, "ok", True)
    monkeypatch.delenv("OPENAI_API_KEY")
    assert agent_mod.use_realtime(_runtime(voice=realtime)) is False


def test_fallback_chain_uses_only_providers_with_keys(monkeypatch: pytest.MonkeyPatch) -> None:
    built: list[tuple[str, str]] = []
    monkeypatch.setattr(agent_mod, "_llm_for", lambda p, m, t: built.append((p, m)) or object())
    monkeypatch.setattr(agent_mod.llm, "FallbackAdapter", lambda llms, **kw: llms)
    for key in ("GROQ_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY", "ANTHROPIC_API_KEY"):
        monkeypatch.delenv(key, raising=False)
    monkeypatch.setenv("GROQ_API_KEY", "g")
    monkeypatch.setenv("OPENAI_API_KEY", "o")
    agent_mod.build_llm(_runtime(llm={"provider": "groq", "model": "openai/gpt-oss-20b", "temperature": 0.4}))
    assert built == [
        ("groq", "openai/gpt-oss-20b"),
        ("groq", "qwen/qwen3.8-27b"),
        ("groq", "openai/gpt-oss-120b"),
        ("openai", "gpt-4o-mini"),
    ]
    built.clear()
    monkeypatch.setenv("GEMINI_API_KEY", "x")
    agent_mod.build_llm(_runtime(llm={"provider": "openai", "model": "gpt-4o-mini", "temperature": 0.4}))
    assert built[0] == ("openai", "gpt-4o-mini") and built[-1] == ("gemini", "gemini-3.5-flash-lite")
    assert built.count(("openai", "gpt-4o-mini")) == 1


def test_end_call_only_after_a_goodbye() -> None:
    say = agent_mod.sounds_like_goodbye
    assert not say("Hi. Can you hear me?")
    assert not say("What languages do you speak?")
    assert not say("Can you bypass this?")
    assert say("Okay thank you, bye.")
    assert say("No thanks, that is all")
    assert say("Hang up the call.")
    assert say("shukriya khuda hafiz")
    assert say("شکریہ")  # Urdu: shukriya


def test_end_call_counts_requests_to_end_and_the_previous_turn() -> None:
    say = agent_mod.sounds_like_goodbye
    assert say("Still the call never ends.")
    assert say("Please end the call")
    assert say("so the conversation doesn't end?")
    assert say("Okay, sure.", "Okay, thank you so much.")
    assert not say("How do I end a subscription?", "Hello")


def test_a_lone_bye_after_a_long_message_is_doubtful() -> None:
    # 5 Nov: "...it can automatically start being showing. So, why?" was heard as "So, bye." and the call ended.
    doubtful = agent_mod.goodbye_is_doubtful
    assert doubtful(
        "This sentence I cannot pronounce it, but at the start of message it can automatically start showing. So, bye."
    )
    assert not doubtful("Okay, bye.")  # short: a goodbye
    assert not doubtful("Okay thank you so much for explaining all of that to me, bye.")  # thanks too
    assert not doubtful("Alright that is everything I needed to know about the pricing, goodbye!")
    assert not doubtful("What does your product do for small shops in the city and how much is it?")


def test_goodbye_heard_by_the_other_speech_to_text_counts() -> None:
    # 5 Nov: the realtime transcript said "But" for "bye"; Deepgram's words are a second opinion.
    agent = agent_mod.TalkfrontAgent(instructions="x")
    agent._heard.append((time.time() - 30, "okay goodbye"))  # too old to count
    agent._heard.append((time.time() - 2, "bye"))
    assert agent.heard_recently(agent_mod.HEARD_FOR_GOODBYE_S) == "bye"
    assert agent_mod.sounds_like_goodbye("But", "", agent.heard_recently(agent_mod.HEARD_FOR_GOODBYE_S))
