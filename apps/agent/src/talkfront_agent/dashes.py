"""Per-agent switch "No dashes in replies": the em dash (and the spaced en dash) reads as AI-written to
some businesses' customers, and a prompt rule alone still lets one through now and then (25 Nov,
Dragon Spring Swords). This replaces them in the reply text the visitor sees and the saved transcript.

- " — ", "—" and " – " become ", " (a comma, which reads naturally in almost every case).
- Number ranges keep an unspaced en dash: "3–5", "3 – 5" and "3—5" all become "3–5".
- A dash used as a bullet at the start of a line becomes "- " (a normal list item).
- No doubled punctuation: "oil, – choji" becomes "oil, choji", not "oil,, choji".
- A dash ending a line (or the reply) is dropped.

Replies stream in small pieces, so `DashCleaner` holds back the end of each piece that could still be
part of a pattern (spaces, dashes, digits, punctuation) until the next piece shows how it ends."""

from __future__ import annotations

import re
from collections.abc import AsyncIterable, AsyncIterator

_RANGE = re.compile(r"(\d)[ \t]*[\u2013\u2014][ \t]*(\d)")
_BULLET = re.compile(r"(\n[ \t]*)[\u2013\u2014][ \t]+")
_LINE_START = re.compile(r"(\n[ \t]*)[\u2013\u2014](?=\S)")
# Group 1: punctuation right before the dash; group 3: the line or text ends right after it.
_DASH = re.compile(
    r"([,;:.!?]?)([ \t]*\u2014[ \t]*|[ \t]+\u2013(?:[ \t]+|(?=\n|$)))(\n|$)?"
)
# The end of a piece that may still change once the next piece arrives.
_HOLD = re.compile(r"[\d,;:.!?\s\u2013\u2014]*$")


def clean_dashes(text: str) -> str:
    """The whole text with its dashes replaced (see the module docstring)."""
    return _clean("\n" + text)[1:]


def _dash(m: re.Match[str]) -> str:
    before, _, after = m.group(1), m.group(2), m.group(3)
    if after is not None:
        return before + after  # a dash ending a line or the text: just drop it
    return before + " " if before else ", "  # never "oil,, choji"


def _clean(text: str) -> str:
    text = _RANGE.sub("\\1\u2013\\2", text)
    text = _BULLET.sub(r"\1- ", text)
    text = _LINE_START.sub(r"\1", text)
    return _DASH.sub(_dash, text)


class DashCleaner:
    """Cleans a reply that arrives in pieces; `push` each piece, then `flush` once at the end."""

    def __init__(self) -> None:
        self._held = ""
        self._started = False

    def push(self, piece: str) -> str:
        text = self._held + piece
        hold = _HOLD.search(text)
        cut = hold.start() if hold else len(text)
        ready, self._held = text[:cut], text[cut:]
        return self._emit(ready)

    def flush(self) -> str:
        ready, self._held = self._held, ""
        return self._emit(ready)

    def _emit(self, ready: str) -> str:
        if not ready:
            return ""
        # The very start of the reply counts as the start of a line (a dash there is a bullet).
        prefix = "" if self._started else "\n"
        self._started = True
        out = _clean(prefix + ready)
        return out[len(prefix) :] if prefix and out.startswith(prefix) else out


async def clean_dash_stream(pieces: AsyncIterable[str]) -> AsyncIterator[str]:
    cleaner = DashCleaner()
    async for piece in pieces:
        out = cleaner.push(piece)
        if out:
            yield out
    tail = cleaner.flush()
    if tail:
        yield tail
