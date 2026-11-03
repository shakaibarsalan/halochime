"""Collects transcript rows from session events and posts them to /messages in batches."""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
from collections.abc import Awaitable, Callable

from .api import MessageRole, TranscriptMessage, make_message

logger = logging.getLogger("talkfront.transcript")

FLUSH_INTERVAL_S = 5.0
# If the API is down for a long time, keep at most this many unsent rows (oldest dropped).
MAX_PENDING = 2000
TOOL_ARGS_PREVIEW = 200
TOOL_OUTPUT_PREVIEW = 300

Sender = Callable[[list[TranscriptMessage]], Awaitable[None]]


def _short(text: str, limit: int) -> str:
    text = " ".join(text.split())
    return text if len(text) <= limit else text[: limit - 1] + "…"


def describe_tool_call(name: str, arguments: str, output: str | None, is_error: bool) -> str:
    """One short line per tool call for the transcript, e.g.
    ``search_knowledge {"query": "refunds"} -> ok: [1] Refund policy ...``"""
    try:
        args = json.dumps(json.loads(arguments), ensure_ascii=False) if arguments else "{}"
    except ValueError:
        args = arguments
    line = f"{name} {_short(args, TOOL_ARGS_PREVIEW)}"
    if output is None:
        return line
    status = "error" if is_error else "ok"
    return f"{line} -> {status}: {_short(output, TOOL_OUTPUT_PREVIEW)}"


class TranscriptBuffer:
    def __init__(self, send: Sender, *, interval: float = FLUSH_INTERVAL_S) -> None:
        self._send = send
        self._interval = interval
        self._pending: list[TranscriptMessage] = []
        self._lock = asyncio.Lock()
        self._task: asyncio.Task[None] | None = None
        self._closed = False

    @property
    def pending(self) -> int:
        return len(self._pending)

    def add(self, role: MessageRole, content: str, created_at: float | None = None) -> None:
        if self._closed:
            logger.debug("transcript closed, dropping late %s row", role)
            return
        content = content.strip()
        if not content:
            return
        self._pending.append(make_message(role, content, created_at))
        if len(self._pending) > MAX_PENDING:
            dropped = len(self._pending) - MAX_PENDING
            del self._pending[:dropped]
            logger.warning("transcript buffer full, dropped %d oldest rows", dropped)

    def start(self) -> None:
        if self._task is None:
            self._task = asyncio.create_task(self._loop(), name="talkfront_transcript_flush")

    async def _loop(self) -> None:
        while True:
            await asyncio.sleep(self._interval)
            await self.flush()

    async def flush(self) -> bool:
        """Send everything pending. Returns False if a send failed (rows are kept for retry)."""
        async with self._lock:
            if not self._pending:
                return True
            batch = self._pending
            self._pending = []
            try:
                await self._send(batch)
            except Exception as e:  # keep the rows; the next flush retries them
                self._pending = batch + self._pending
                logger.warning("transcript flush of %d rows failed: %s", len(batch), e)
                return False
            logger.debug("transcript flushed %d rows", len(batch))
            return True

    async def aclose(self) -> bool:
        """Stop the timer, then do a final flush. Later ``add`` calls are ignored."""
        if self._task is not None:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task
            self._task = None
        ok = await self.flush()
        self._closed = True
        if not ok:
            logger.error("final transcript flush failed, %d rows not stored", len(self._pending))
        return ok
