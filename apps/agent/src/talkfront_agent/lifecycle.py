"""Small pieces that make the end of a conversation happen exactly once."""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from typing import TypeVar

from .api import EndedReason

T = TypeVar("T")


class OnceGuard:
    """Runs an async function at most once.

    Every caller after the first waits for the same run and gets its result (or its exception),
    so several shutdown paths (visitor left, max duration, error, job shutdown) can all call
    ``run`` safely and concurrently.
    """

    def __init__(self) -> None:
        self._task: asyncio.Task[object] | None = None

    @property
    def started(self) -> bool:
        return self._task is not None

    async def run(self, fn: Callable[[], Awaitable[T]]) -> T:
        if self._task is None:
            # Created synchronously, before any await, so two callers can't both get here.
            async def _call() -> object:
                return await fn()

            self._task = asyncio.ensure_future(_call())
        # shield: a cancelled caller must not cancel the one run that everyone shares.
        return await asyncio.shield(self._task)  # type: ignore[return-value]


class EndReason:
    """First reason wins. Later paths (e.g. the room closing after a max-duration goodbye)
    don't overwrite why the conversation actually ended."""

    def __init__(self) -> None:
        self._reason: EndedReason | None = None

    @property
    def value(self) -> EndedReason | None:
        return self._reason

    def set(self, reason: EndedReason) -> bool:
        if self._reason is None:
            self._reason = reason
            return True
        return False

    def resolve(self, default: EndedReason) -> EndedReason:
        return self._reason if self._reason is not None else default


class TurnCounter:
    """Counts finished visitor turns, so tools can tell whether the visitor has replied."""

    def __init__(self) -> None:
        self.user_turns = 0

    def user_turn(self) -> None:
        self.user_turns += 1


class HandoffDraft:
    """A prepared message for the team that is only sent after the visitor confirms it.

    Models sometimes "confirm" on the visitor's behalf in the same turn they prepared the
    message. Requiring at least one new visitor turn between prepare and send stops that.
    """

    def __init__(self, turns: TurnCounter) -> None:
        self._turns = turns
        self._request: object | None = None
        self._prepared_at_turn = 0

    @property
    def pending(self) -> bool:
        """A message is prepared but not sent yet."""
        return self._request is not None

    def prepare(self, request: object) -> None:
        self._request = request
        self._prepared_at_turn = self._turns.user_turns

    def take_confirmed(self) -> tuple[object | None, str | None]:
        """Returns (request, None) when it may be sent, else (None, reason for the model)."""
        if self._request is None:
            return None, "There is no prepared message. Use request_human first."
        if self._turns.user_turns <= self._prepared_at_turn:
            return None, (
                "Not sent: the visitor has not confirmed yet. Read the details back, ask if they "
                "are correct, and call confirm_message only after they say yes."
            )
        request, self._request = self._request, None
        return request, None

    def restore(self, request: object) -> None:
        """Put a request back after a failed send, keeping it confirmed."""
        self._request = request
        self._prepared_at_turn = -1
