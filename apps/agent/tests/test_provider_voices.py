"""ElevenLabs / Cartesia voices: used through the classic pipeline when the key is set, else the default voice."""

from __future__ import annotations

import pytest

from talkfront_agent import agent as agent_mod
from talkfront_agent.api import ProviderVoice, parse_runtime_config

from .test_metadata import runtime_payload

ELEVEN = {"provider": "elevenlabs", "voiceId": "21m00Tcm4TlvDq8ikWAM", "model": "eleven_flash_v2_5", "language": "hi"}
CARTESIA = {"provider": "cartesia", "voiceId": "f786b574-daa5-4673-aa0c-cbe3e8534c02", "model": "sonic-3.6", "language": "ur"}
# What the web app sends with a provider voice: the default (realtime) voice for when it can't be used.
DEFAULT_VOICE = {"engine": "realtime", "realtimeModel": "gpt-realtime-2.1-mini", "realtimeVoice": "marin"}


def _runtime(provider_voice: object = None, mode: str = "voice"):  # type: ignore[no-untyped-def]
    payload = runtime_payload()
    payload["mode"] = mode
    payload["agent"]["voice"] = {**DEFAULT_VOICE, **({"providerVoice": provider_voice} if provider_voice is not None else {})}
    return parse_runtime_config(payload)


@pytest.fixture(autouse=True)
def _keys(monkeypatch: pytest.MonkeyPatch) -> None:
    for key in ("ELEVENLABS_API_KEY", "CARTESIA_API_KEY", "DEEPGRAM_API_KEY", "ELEVEN_API_KEY"):
        monkeypatch.delenv(key, raising=False)
    monkeypatch.setenv("OPENAI_API_KEY", "test")
    monkeypatch.setitem(agent_mod._openai_health, "checked_at", 1e18)  # fresh: no background check
    monkeypatch.setitem(agent_mod._openai_health, "ok", True)


def test_provider_voice_is_parsed_leniently() -> None:
    assert _runtime().agent.voice.provider_voice is None
    assert _runtime(ELEVEN).agent.voice.provider_voice == ProviderVoice("elevenlabs", "21m00Tcm4TlvDq8ikWAM", "eleven_flash_v2_5", "hi")
    assert _runtime({"provider": "elevenlabs"}).agent.voice.provider_voice is None  # no voice id
    assert _runtime("elevenlabs:abc").agent.voice.provider_voice is None
    assert _runtime({**CARTESIA, "language": ""}).agent.voice.provider_voice.language is None  # type: ignore[union-attr]


def test_provider_voice_with_key_uses_the_classic_pipeline(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ELEVENLABS_API_KEY", "x")
    rt = _runtime(ELEVEN)
    assert agent_mod.provider_voice_for(rt) == rt.agent.voice.provider_voice
    assert agent_mod.use_realtime(rt) is False
    monkeypatch.setenv("CARTESIA_API_KEY", "y")
    assert agent_mod.provider_voice_for(_runtime(CARTESIA)).provider == "cartesia"  # type: ignore[union-attr]


def test_missing_key_falls_back_to_the_default_voice(monkeypatch: pytest.MonkeyPatch) -> None:
    rt = _runtime(ELEVEN)
    assert agent_mod.provider_voice_for(rt) is None
    assert agent_mod.use_realtime(rt) is True  # the default realtime voice
    monkeypatch.setenv("ELEVENLABS_API_KEY", "x")  # the other provider's key doesn't count
    assert agent_mod.provider_voice_for(_runtime(CARTESIA)) is None


def test_unknown_provider_or_voice_id_falls_back(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ELEVENLABS_API_KEY", "x")
    monkeypatch.setenv("CARTESIA_API_KEY", "y")
    assert agent_mod.provider_voice_for(_runtime({**ELEVEN, "provider": "playht"})) is None
    assert agent_mod.provider_voice_for(_runtime({**ELEVEN, "voiceId": "bad id; drop"})) is None
    assert agent_mod.provider_voice_for(_runtime({**ELEVEN, "voiceId": "short"})) is None
    assert agent_mod.use_realtime(_runtime({**ELEVEN, "provider": "playht"})) is True


def test_text_chats_never_use_a_provider_voice(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ELEVENLABS_API_KEY", "x")
    assert agent_mod.provider_voice_for(_runtime(ELEVEN, mode="text")) is None


def test_odd_model_name_gets_the_provider_default(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CARTESIA_API_KEY", "y")
    chosen = agent_mod.provider_voice_for(_runtime({**CARTESIA, "model": "Sonic 3!"}))
    assert chosen is not None and chosen.model == agent_mod.DEFAULT_PROVIDER_MODELS["cartesia"]
    chosen = agent_mod.provider_voice_for(_runtime({**CARTESIA, "model": ""}))
    assert chosen is not None and chosen.model == "sonic-3.6"


def test_build_tts_picks_the_provider_and_keeps_deepgram_behind_it(monkeypatch: pytest.MonkeyPatch) -> None:
    made: list[tuple[str, dict]] = []
    monkeypatch.setattr(agent_mod.deepgram, "TTS", lambda **kw: made.append(("deepgram", kw)) or "deepgram")
    monkeypatch.setattr(agent_mod.elevenlabs, "TTS", lambda **kw: made.append(("elevenlabs", kw)) or "elevenlabs")
    monkeypatch.setattr(agent_mod.cartesia, "TTS", lambda **kw: made.append(("cartesia", kw)) or "cartesia")
    monkeypatch.setattr(agent_mod.tts_mod, "FallbackAdapter", lambda voices, **kw: ("fallback", voices))

    # No key: the Deepgram voice only.
    assert agent_mod.build_tts(_runtime(ELEVEN)) == "deepgram"

    monkeypatch.setenv("ELEVENLABS_API_KEY", "eleven-key")
    assert agent_mod.build_tts(_runtime(ELEVEN)) == "elevenlabs"  # no Deepgram key: nothing behind it
    assert made[-1] == (
        "elevenlabs",
        {"voice_id": "21m00Tcm4TlvDq8ikWAM", "model": "eleven_flash_v2_5", "api_key": "eleven-key", "language": "hi"},
    )
    agent_mod.build_tts(_runtime({**ELEVEN, "language": None}))
    assert "language" not in made[-1][1]  # auto: ElevenLabs follows the text

    monkeypatch.setenv("DEEPGRAM_API_KEY", "dg")
    monkeypatch.setenv("CARTESIA_API_KEY", "cartesia-key")
    assert agent_mod.build_tts(_runtime(CARTESIA)) == ("fallback", ["cartesia", "deepgram"])
    assert ("cartesia", {"api_key": "cartesia-key", "model": "sonic-3.6", "voice": CARTESIA["voiceId"], "language": "ur", "word_timestamps": False}) in made
