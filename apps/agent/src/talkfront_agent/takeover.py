"""Live inbox: a person from the business takes a conversation over from the AI, and hands it back.

The web app sends commands to this agent alone, as LiveKit data on TOPIC_STAFF (JSON):
  {"type": "takeover", "name": "Sam"}                 a team member joins; the AI stops answering
  {"type": "say", "text": "...", "id": "...", "name": "Sam"}   their words to the visitor
  {"type": "release"}                                 they leave; the AI answers again

Only data sent by the server counts (a LiveKit server SDK sends without a participant): the visitor's
browser could publish on the same topic. While a team member has the conversation the AI does not
answer, check in or end the call; the visitor's words are still saved. After AUTO_RELEASE_S with no
command from the team, the conversation goes back to the AI by itself.

This module holds the state machine and the wording; agent.py wires it to the session and the room.
"""

from __future__ import annotations

import collections
import json
import time
from collections.abc import Callable
from dataclasses import dataclass
from typing import Literal

# Server -> agent commands.
TOPIC_STAFF = "tf.staff"
# Agent -> widget: a team member joined or left (JSON {type: "joined" | "left", text, name?}).
TOPIC_NOTICE = "tf.notice"
# Agent -> widget, text chats: a team member's reply (JSON {id, name, text}).
TOPIC_STAFF_REPLY = "tf.staff_reply"

# Back to the AI after this long without a command from the team member.
AUTO_RELEASE_S = 180.0
MAX_STAFF_TEXT = 2000
MAX_STAFF_NAME = 60
MAX_ID = 100
# "say" ids remembered, so a repeated command is not said twice.
SEEN_IDS = 200
DEFAULT_STAFF_NAME = "Someone"

CommandType = Literal["takeover", "say", "release"]


@dataclass(frozen=True)
class StaffCommand:
    type: CommandType
    name: str = ""
    text: str = ""
    id: str = ""


def _one_line(value: object, limit: int) -> str:
    return " ".join(value.split())[:limit] if isinstance(value, str) else ""


def _text(value: object, limit: int) -> str:
    return value.strip()[:limit].strip() if isinstance(value, str) else ""


def parse_staff_command(data: bytes | str) -> StaffCommand | None:
    """A command from the web app, or None when the payload is not one."""
    try:
        raw = json.loads(data.decode("utf-8") if isinstance(data, bytes) else data)
    except (ValueError, UnicodeDecodeError):
        return None
    if not isinstance(raw, dict):
        return None
    kind = raw.get("type")
    name = _one_line(raw.get("name"), MAX_STAFF_NAME)
    if kind == "takeover":
        return StaffCommand("takeover", name=name)
    if kind == "release":
        return StaffCommand("release", name=name)
    if kind == "say":
        text = _text(raw.get("text"), MAX_STAFF_TEXT)
        if not text:
            return None
        return StaffCommand("say", name=name, text=text, id=_one_line(raw.get("id"), MAX_ID))
    return None


def joined_text(name: str) -> str:
    return f"{name or DEFAULT_STAFF_NAME} from the team joined the chat"


def back_text(agent_name: str) -> str:
    return f"You're back with {agent_name.strip() or 'the assistant'}"


def joined_note_for_model(name: str) -> str:
    return (
        f"{name or DEFAULT_STAFF_NAME}, a person from the team, has joined and is now talking with the visitor "
        "directly. Their words appear as your replies. Do not answer while they are here."
    )


def released_note_for_model(name: str) -> str:
    return (
        f"{name or DEFAULT_STAFF_NAME} from the team has left the conversation and you are answering again. "
        "Everything they told the visitor is above, as your replies: stand by it, don't repeat it, and carry "
        "on helping the visitor from there. If the visitor said something the team member did not answer, "
        "answer that now. Don't say that the team member left or mention them by name (the visitor already "
        "saw a notice): just continue naturally, e.g. \"I'm here to help. What else can I do for you?\""
    )


class StaffDesk:
    """Who from the team has the conversation, if anyone.

    Callbacks: ``on_join(name)`` when a team member takes it over (or another one takes it from them),
    ``on_say(text, name, id)`` for each of their messages, ``on_release(name, auto)`` when it goes back
    to the AI (``auto``: no command for AUTO_RELEASE_S).
    """

    def __init__(
        self,
        *,
        on_join: Callable[[str], None],
        on_say: Callable[[str, str, str], None],
        on_release: Callable[[str, bool], None],
        now: Callable[[], float] = time.monotonic,
        auto_release_s: float = AUTO_RELEASE_S,
    ) -> None:
        self._on_join = on_join
        self._on_say = on_say
        self._on_release = on_release
        self._now = now
        self._auto_release_s = auto_release_s
        self._name: str | None = None
        self._last_command_at = 0.0
        self._seen: collections.OrderedDict[str, None] = collections.OrderedDict()
        # Voice: staff words handed to the voice and not yet in the chat history (see claim_spoken).
        self._spoken_pending: list[object] = []

    @property
    def active(self) -> bool:
        return self._name is not None

    @property
    def name(self) -> str:
        return self._name or ""

    def handle(self, cmd: StaffCommand) -> bool:
        """Applies one command. Returns True when it changed or said something."""
        if cmd.type == "release":
            return self._release(auto=False)
        self._last_command_at = self._now()
        name = cmd.name or self._name or DEFAULT_STAFF_NAME
        joined = False
        if self._name != name:
            # A new takeover, a "say" after an automatic hand back, or another team member taking over.
            self._name = name
            self._on_join(name)
            joined = True
        if cmd.type == "takeover":
            return joined
        if cmd.id:
            if cmd.id in self._seen:
                return joined
            self._seen[cmd.id] = None
            while len(self._seen) > SEEN_IDS:
                self._seen.popitem(last=False)
        self._on_say(cmd.text, name, cmd.id)
        return True

    def check_idle(self) -> bool:
        """Hands the conversation back when the team member has sent nothing for a while. True if it did."""
        if self._name is None or self._now() - self._last_command_at < self._auto_release_s:
            return False
        return self._release(auto=True)

    def _release(self, *, auto: bool) -> bool:
        if self._name is None:
            return False
        name, self._name = self._name, None
        self._on_release(name, auto)
        return True

    # Voice: staff words are spoken through the session, which also adds them to the chat history as an
    # agent reply. They are saved as "staff" when the command arrives, so that reply must not be saved
    # again as "assistant". Each spoken line is expected here until its reply shows up or its speech ends.

    def expect_spoken(self, key: object) -> None:
        self._spoken_pending.append(key)

    def claim_spoken(self) -> bool:
        """An agent reply was added to the history: True when it is staff words (then it is not saved)."""
        if not self._spoken_pending:
            return False
        self._spoken_pending.pop(0)
        return True

    def forget_spoken(self, key: object) -> None:
        """That speech is over; if its reply never came (cut off before any words), stop expecting it."""
        if key in self._spoken_pending:
            self._spoken_pending.remove(key)

    @property
    def spoken_pending(self) -> int:
        return len(self._spoken_pending)
