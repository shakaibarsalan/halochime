import json
from types import SimpleNamespace

import pytest
from livekit import rtc

from talkfront_agent.api import ContractError, parse_dispatch_metadata
from talkfront_agent.phone import (
    REFUSAL_TEXTS,
    PhoneDispatch,
    build_open_call_request,
    is_phone_dispatch,
    is_sip_participant,
    parse_phone_dispatch,
    phone_call_info,
    refusal_text,
    widget_features,
)

SIP = rtc.ParticipantKind.PARTICIPANT_KIND_SIP
STANDARD = rtc.ParticipantKind.PARTICIPANT_KIND_STANDARD


def _phone_meta(**over):
    data = {"channel": "phone", "agentId": "agt_1", "organizationId": "org_1", "channelId": "ch_1"}
    data.update(over)
    return json.dumps(data)


def _participant(kind, attributes=None, identity="sip_+15551230000"):
    return SimpleNamespace(kind=kind, attributes=attributes or {}, identity=identity)


# --------------------------------------------------------------------------- metadata


def test_phone_dispatch_is_recognised():
    assert is_phone_dispatch(_phone_meta()) is True
    assert is_phone_dispatch(_phone_meta().encode()) is True


@pytest.mark.parametrize(
    "raw",
    [
        None,
        "",
        "not json",
        "[]",
        json.dumps({"conversationId": "c", "agentId": "a", "organizationId": "o", "mode": "voice"}),
        json.dumps({"channel": "web", "agentId": "a"}),
        json.dumps({"channel": "whatsapp"}),
    ],
)
def test_other_metadata_is_not_a_phone_call(raw):
    assert is_phone_dispatch(raw) is False


def test_parses_phone_dispatch():
    assert parse_phone_dispatch(_phone_meta()) == PhoneDispatch(agent_id="agt_1", organization_id="org_1", channel_id="ch_1")


@pytest.mark.parametrize("missing", ["agentId", "organizationId", "channelId"])
def test_phone_dispatch_needs_every_id(missing):
    data = json.loads(_phone_meta())
    del data[missing]
    with pytest.raises(ContractError):
        parse_phone_dispatch(json.dumps(data))


@pytest.mark.parametrize("bad", ["", 5, None, "x" * 201])
def test_phone_dispatch_rejects_bad_ids(bad):
    with pytest.raises(ContractError):
        parse_phone_dispatch(_phone_meta(agentId=bad))


def test_widget_metadata_is_not_parsed_as_phone():
    with pytest.raises(ContractError):
        parse_phone_dispatch(json.dumps({"conversationId": "c", "agentId": "a", "organizationId": "o", "mode": "voice"}))


def test_phone_metadata_is_not_widget_metadata():
    # The widget parser still refuses it, so the entrypoint must pick the parser by is_phone_dispatch.
    with pytest.raises(ContractError):
        parse_dispatch_metadata(_phone_meta())


# --------------------------------------------------------------------------- SIP participant


def test_sip_participant_detection():
    assert is_sip_participant(_participant(SIP)) is True
    assert is_sip_participant(_participant(STANDARD)) is False
    assert is_sip_participant(_participant(rtc.ParticipantKind.PARTICIPANT_KIND_AGENT)) is False
    assert is_sip_participant(object()) is False


def test_call_info_from_sip_attributes():
    call = phone_call_info(
        _participant(
            SIP,
            {
                "sip.phoneNumber": "+15551230000",
                "sip.trunkPhoneNumber": "+15559870000",
                "sip.callID": "SCL_abc",
                "sip.trunkID": "ST_trunk",
                "sip.ruleID": "SDR_rule",
                "sip.callStatus": "active",
            },
        )
    )
    assert call is not None
    assert call.caller_number == "+15551230000"
    assert call.called_number == "+15559870000"
    assert call.call_id == "SCL_abc"
    assert call.trunk_id == "ST_trunk"
    assert call.rule_id == "SDR_rule"
    assert call.identity == "sip_+15551230000"


def test_call_info_with_hidden_number():
    call = phone_call_info(_participant(SIP, {"sip.trunkID": "ST_trunk", "sip.phoneNumber": "  "}))
    assert call is not None
    assert call.caller_number is None
    assert call.called_number is None


def test_browser_visitor_has_no_call_info():
    assert phone_call_info(_participant(STANDARD, {"sip.phoneNumber": "+1555"})) is None


def test_long_attributes_are_cut():
    call = phone_call_info(_participant(SIP, {"sip.phoneNumber": "+1" + "5" * 100}))
    assert call is not None and call.caller_number is not None
    assert len(call.caller_number) == 50


# --------------------------------------------------------------------------- open call request


def test_open_call_request_leaves_out_unknown_fields():
    dispatch = PhoneDispatch(agent_id="agt_1", organization_id="org_1", channel_id="ch_1")
    call = phone_call_info(_participant(SIP, {"sip.trunkID": "ST_trunk"}))
    assert call is not None
    body = build_open_call_request(dispatch, "tfp-room_+1555_abc", call)
    assert body == {
        "agentId": "agt_1",
        "organizationId": "org_1",
        "channelId": "ch_1",
        "roomName": "tfp-room_+1555_abc",
        "trunkId": "ST_trunk",
    }


def test_open_call_request_with_everything():
    dispatch = PhoneDispatch(agent_id="a", organization_id="o", channel_id="c")
    call = phone_call_info(
        _participant(
            SIP,
            {"sip.phoneNumber": "+1", "sip.trunkPhoneNumber": "+2", "sip.trunkID": "ST", "sip.callID": "SCL"},
        )
    )
    assert call is not None
    body = build_open_call_request(dispatch, "room", call)
    assert body["callerNumber"] == "+1"
    assert body["calledNumber"] == "+2"
    assert body["callId"] == "SCL"


# --------------------------------------------------------------------------- decisions


def test_widget_features_off_for_phone():
    f = widget_features(sip=True)
    assert (f.live_captions, f.greeting_audio, f.reply_cut) == (False, False, False)


def test_widget_features_on_for_widget():
    f = widget_features(sip=False)
    assert (f.live_captions, f.greeting_audio, f.reply_cut) == (True, True, True)


def test_refusal_wording():
    assert refusal_text("out_of_credit") == REFUSAL_TEXTS["out_of_credit"]
    assert refusal_text("rate_limited") == REFUSAL_TEXTS["rate_limited"]
    assert refusal_text("not_found") == REFUSAL_TEXTS["default"]
    assert refusal_text(None) == REFUSAL_TEXTS["default"]
    # Short and ends the call politely.
    for text in REFUSAL_TEXTS.values():
        assert len(text) < 120 and text.endswith("Goodbye.")


# --------------------------------------------------------------------------- internal API


def test_open_phone_call_posts_and_returns_the_conversation():
    import asyncio

    import httpx

    from talkfront_agent.api import ApiSettings, TalkfrontApi

    seen: list[httpx.Request] = []

    def responder(req: httpx.Request) -> httpx.Response:
        seen.append(req)
        return httpx.Response(200, json={"conversationId": "conv_9"})

    api = TalkfrontApi(ApiSettings(base_url="http://web.test", secret="s"), transport=httpx.MockTransport(responder))
    body = {"agentId": "a", "organizationId": "o", "channelId": "c", "roomName": "r"}
    assert asyncio.run(api.open_phone_call(body)) == "conv_9"
    assert seen[0].method == "POST"
    assert seen[0].url.path == "/api/internal/phone/calls"
    assert json.loads(seen[0].content) == body


def test_open_phone_call_refusal_carries_the_code():
    import asyncio

    import httpx

    from talkfront_agent.api import ApiSettings, InternalApiError, TalkfrontApi

    def responder(req: httpx.Request) -> httpx.Response:
        return httpx.Response(402, json={"error": {"code": "out_of_credit", "message": "no minutes"}})

    api = TalkfrontApi(ApiSettings(base_url="http://web.test", secret="s"), transport=httpx.MockTransport(responder))
    with pytest.raises(InternalApiError) as err:
        asyncio.run(api.open_phone_call({"agentId": "a", "organizationId": "o", "channelId": "c", "roomName": "r"}))
    assert err.value.status == 402
    assert err.value.code == "out_of_credit"
    assert refusal_text(err.value.code) == REFUSAL_TEXTS["out_of_credit"]
