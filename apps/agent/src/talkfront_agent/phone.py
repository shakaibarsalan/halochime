"""Phone calls through LiveKit SIP.

A call to a business's number reaches LiveKit through the business's SIP trunk (Twilio Elastic SIP
Trunking or any SIP provider). The dispatch rule the dashboard made for that number puts the call in
its own room and dispatches this worker with metadata ``{"channel": "phone", "agentId", "organizationId",
"channelId"}``. Unlike a widget session there is no conversation yet: the worker asks the web app to
open one (``POST /api/internal/phone/calls``, same minutes and limits checks as a widget voice call),
then runs the normal voice flow. When the web app refuses (no minutes, lines busy, channel turned off),
the caller hears one short sentence and the call is hung up.

The pure parts (metadata, SIP participant details, refusal wording) are here so they can be tested
without LiveKit.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

from livekit import rtc

from .api import ContractError

logger = logging.getLogger("talkfront.phone")

CHANNEL_PHONE = "phone"
# How long to wait for the caller to be in the room. The SIP participant is normally there before
# the job starts (the call made the room), so this only matters when something is wrong.
CALLER_WAIT_S = 15.0
REFUSAL_PLAYOUT_TIMEOUT_S = 12.0
REFUSAL_GRACE_S = 0.5

# What the caller hears when the web app does not open a conversation. Short: they are paying for the call.
REFUSAL_TEXTS = {
    "out_of_credit": "Sorry, we can't take calls on this line right now. Please try again later. Goodbye.",
    "rate_limited": "Sorry, all our lines are busy right now. Please call back in a few minutes. Goodbye.",
    "default": "Sorry, this number can't take calls right now. Please try again later. Goodbye.",
}


@dataclass(frozen=True)
class PhoneDispatch:
    """Dispatch metadata of a phone call (set on the dispatch rule, so the same for every call)."""

    agent_id: str
    organization_id: str
    channel_id: str


@dataclass(frozen=True)
class PhoneCall:
    """Who is calling, from the SIP participant's attributes."""

    identity: str
    caller_number: str | None
    called_number: str | None
    call_id: str | None
    trunk_id: str | None
    rule_id: str | None


def is_phone_dispatch(raw: str | bytes | None) -> bool:
    """True when the dispatch metadata says this job is a phone call (``"channel": "phone"``)."""
    if not raw:
        return False
    try:
        data = json.loads(raw)
    except (TypeError, ValueError):
        return False
    return isinstance(data, dict) and data.get("channel") == CHANNEL_PHONE


def parse_phone_dispatch(raw: str | bytes | None) -> PhoneDispatch:
    """Parse the metadata a phone dispatch rule carries. Raises ContractError when it is not one."""
    if not raw:
        raise ContractError("dispatch metadata is empty")
    try:
        data = json.loads(raw)
    except (TypeError, ValueError) as e:
        raise ContractError(f"dispatch metadata is not valid JSON: {e.__class__.__name__}") from None
    if not isinstance(data, dict) or data.get("channel") != CHANNEL_PHONE:
        raise ContractError("dispatch metadata is not a phone call")

    def req_str(key: str) -> str:
        value = data.get(key)
        if not isinstance(value, str) or not value or len(value) > 200:
            raise ContractError(f"phone dispatch metadata field '{key}' must be a non-empty string")
        return value

    return PhoneDispatch(
        agent_id=req_str("agentId"),
        organization_id=req_str("organizationId"),
        channel_id=req_str("channelId"),
    )


def is_sip_participant(participant: Any) -> bool:
    """A caller on the phone line (not a browser visitor, not another agent)."""
    return getattr(participant, "kind", None) == rtc.ParticipantKind.PARTICIPANT_KIND_SIP


def _attr(attributes: Mapping[str, str], key: str, max_len: int = 200) -> str | None:
    value = attributes.get(key)
    if not isinstance(value, str):
        return None
    value = value.strip()
    return value[:max_len] if value else None


def phone_call_info(participant: Any) -> PhoneCall | None:
    """The call details of a SIP participant, or None for anyone else. ``sip.phoneNumber`` is the
    caller's number on inbound calls (absent when the dispatch rule hides it)."""
    if not is_sip_participant(participant):
        return None
    attributes = getattr(participant, "attributes", None) or {}
    return PhoneCall(
        identity=str(getattr(participant, "identity", "")),
        caller_number=_attr(attributes, "sip.phoneNumber", 50),
        called_number=_attr(attributes, "sip.trunkPhoneNumber", 50),
        call_id=_attr(attributes, "sip.callID"),
        trunk_id=_attr(attributes, "sip.trunkID"),
        rule_id=_attr(attributes, "sip.ruleID"),
    )


@dataclass(frozen=True)
class WidgetFeatures:
    """Things only the website widget can show or use. A phone line has no screen, gets 8 kHz
    narrowband audio and no widget data channel, so they are all off for a SIP caller."""

    # Words shown while the visitor speaks (second speech to text over the visitor's audio).
    live_captions: bool
    # The ready-made greeting audio file (made for the widget's own greeting copy).
    greeting_audio: bool
    # The "reply cut" notice that marks a talked-over reply in the widget.
    reply_cut: bool


def widget_features(sip: bool) -> WidgetFeatures:
    return WidgetFeatures(live_captions=not sip, greeting_audio=not sip, reply_cut=not sip)


def refusal_text(code: str | None) -> str:
    return REFUSAL_TEXTS.get(code or "", REFUSAL_TEXTS["default"])


def build_open_call_request(dispatch: PhoneDispatch, room_name: str, call: PhoneCall) -> dict[str, str]:
    """Body of POST /api/internal/phone/calls. Optional fields are left out when unknown
    (zod .optional() accepts a missing key, not null)."""
    body: dict[str, str] = {
        "agentId": dispatch.agent_id,
        "organizationId": dispatch.organization_id,
        "channelId": dispatch.channel_id,
        "roomName": room_name,
    }
    for key, value in (
        ("callerNumber", call.caller_number),
        ("calledNumber", call.called_number),
        ("trunkId", call.trunk_id),
        ("callId", call.call_id),
    ):
        if value:
            body[key] = value
    return body


async def wait_for_caller(ctx: Any) -> rtc.RemoteParticipant | None:
    """The SIP participant of this room, or None if no caller shows up in time."""
    try:
        return await asyncio.wait_for(
            ctx.wait_for_participant(kind=rtc.ParticipantKind.PARTICIPANT_KIND_SIP), CALLER_WAIT_S
        )
    except asyncio.TimeoutError:
        return None


def _refusal_tts():  # type: ignore[no-untyped-def]
    # Imported here so the pure helpers above load without the plugins.
    from livekit.plugins import deepgram, openai

    if os.environ.get("OPENAI_API_KEY"):
        return openai.TTS(model="gpt-4o-mini-tts", voice="marin")
    return deepgram.TTS(model="aura-2-thalia-en")


async def say_and_hang_up(ctx: Any, text: str) -> None:
    """Tell the caller one sentence, then end the call (deleting the room hangs up the SIP leg).
    Nothing is billed: no conversation was opened."""
    from livekit.agents import Agent, AgentSession, room_io

    session = AgentSession(tts=_refusal_tts())
    try:
        await session.start(
            agent=Agent(instructions="Say only what you are given."),
            room=ctx.room,
            room_options=room_io.RoomOptions(
                audio_input=False, audio_output=True, text_input=False, text_output=False, close_on_disconnect=True
            ),
            record=False,
        )
        handle = session.say(text, allow_interruptions=False)
        await asyncio.wait_for(handle.wait_for_playout(), REFUSAL_PLAYOUT_TIMEOUT_S)
        await asyncio.sleep(REFUSAL_GRACE_S)
    except Exception as e:  # the caller may have hung up already
        logger.warning("refusal message not played: %s", type(e).__name__)
    finally:
        try:
            await ctx.delete_room()
        except Exception as e:
            logger.warning("could not hang up the call: %s", type(e).__name__)
        ctx.shutdown(reason="phone call refused")
