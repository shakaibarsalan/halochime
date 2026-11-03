import json

import pytest

from talkfront_agent.api import ContractError, parse_dispatch_metadata, parse_runtime_config


def _meta(**over):
    data = {"conversationId": "conv_1", "agentId": "agt_1", "organizationId": "org_1", "mode": "voice"}
    data.update(over)
    return json.dumps(data)


def test_parses_dispatch_metadata():
    meta = parse_dispatch_metadata(_meta(mode="text"))
    assert meta.conversation_id == "conv_1"
    assert meta.agent_id == "agt_1"
    assert meta.organization_id == "org_1"
    assert meta.mode == "text"


@pytest.mark.parametrize(
    "raw",
    [
        "",
        None,
        "not json",
        "[]",
        _meta(mode="video"),
        _meta(conversationId=""),
        _meta(agentId=None),
        json.dumps({"agentId": "a", "organizationId": "o", "mode": "voice"}),
    ],
)
def test_rejects_bad_dispatch_metadata(raw):
    with pytest.raises(ContractError):
        parse_dispatch_metadata(raw)


def runtime_payload(**agent_over):
    agent = {
        "id": "agt_1",
        "name": "Ava",
        "greeting": "Hi! How can I help?",
        "systemPrompt": "You are Ava.",
        "stt": {"provider": "deepgram", "model": "nova-3", "language": "en"},
        "llm": {"provider": "anthropic", "model": "claude-haiku-5-5", "temperature": 0.4},
        "tts": {"provider": "deepgram", "voice": "aura-2-andromeda-en"},
        "maxDurationSec": 600,
        "handoffEnabled": True,
    }
    agent.update(agent_over)
    return {
        "conversationId": "conv_1",
        "mode": "voice",
        "agent": agent,
        "visitor": {"id": "v_1", "name": None, "email": "a@b.co"},
    }


def test_parses_runtime_config():
    rt = parse_runtime_config(runtime_payload())
    assert rt.agent.system_prompt == "You are Ava."
    assert rt.agent.llm.temperature == 0.4
    assert rt.agent.tts.voice == "aura-2-andromeda-en"
    assert rt.agent.max_duration_sec == 600
    assert rt.agent.handoff_enabled is True
    assert rt.visitor.name is None and rt.visitor.email == "a@b.co"


def test_parses_groq_llm():
    rt = parse_runtime_config(
        runtime_payload(llm={"provider": "groq", "model": "openai/gpt-oss-20b", "temperature": 0.4})
    )
    assert rt.agent.llm.provider == "groq"
    assert rt.agent.llm.model == "openai/gpt-oss-20b"


@pytest.mark.parametrize(
    "over",
    [
        {"maxDurationSec": 0},
        {"maxDurationSec": 1.5},
        {"handoffEnabled": "yes"},
        {"llm": {"provider": "mistral", "model": "x", "temperature": 0.2}},
        {"llm": {"provider": "anthropic", "model": "x", "temperature": 2}},
        {"stt": {"provider": "deepgram", "model": "", "language": "en"}},
    ],
)
def test_rejects_bad_runtime_config(over):
    with pytest.raises(ContractError):
        parse_runtime_config(runtime_payload(**over))
