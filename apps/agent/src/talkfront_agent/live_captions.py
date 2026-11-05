"""Live captions of the visitor's words while they speak, for realtime voice calls.

The realtime model transcribes the visitor only after they stop talking, so the widget would show
their words late. This runs Deepgram streaming speech to text on the visitor's microphone purely
for display and sends the words as they come on TOPIC_LIVE_CAPTION. The widget shows them in the
visitor's bubble and swaps in the realtime model's own (more accurate, any language) transcript
when it arrives. Nothing here feeds the model or the saved transcript.

The model writes its transcript once per message: each time the visitor's held audio is committed
(LiveKit's end of turn, a pause of 0.6 s or more). So captions are numbered by those commits, and
caption turn n is exactly the words of the model's message that will hold them. The widget then puts
each transcript in place of its own caption, however many pauses a long stretch of speech has.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import time
from collections.abc import Callable

from livekit import rtc
from livekit.agents import NOT_GIVEN, stt
from livekit.plugins import deepgram

from .echo import began_at, spoken_duration

logger = logging.getLogger("talkfront.live_captions")

TOPIC_LIVE_CAPTION = "tf.live_caption"
# Voice calls: a reply the visitor talked over, stopped part way (JSON {text, played_s}), for display only.
TOPIC_REPLY_CUT = "tf.reply_cut"
SAMPLE_RATE = 16000


async def send_json(room: rtc.Room, identity: str | None, topic: str, payload: dict[str, object]) -> None:
    """Sends a small JSON message to the visitor alone. Display niceties: a failure is ignored."""
    if not identity:
        return
    with contextlib.suppress(Exception):
        await room.local_participant.send_text(
            json.dumps(payload), topic=topic, destination_identities=[identity]
        )


class LiveCaptions:
    def __init__(
        self,
        room: rtc.Room,
        *,
        language: str,
        keyterms: list[str],
        on_final: Callable[[str], None] | None = None,
        is_echo: Callable[..., bool] | None = None,
    ) -> None:
        self._room = room
        # Called with the turn's words so far each time Deepgram finalises some (prefetches knowledge).
        self._on_final = on_final
        # The agent's own voice from the visitor's speakers is not shown as their words.
        self._is_echo = is_echo
        # Deepgram nova-3 "multi" follows code-switching between its languages; Urdu speech still comes
        # out readable enough as a preview, and the realtime transcript replaces it.
        self._stt = deepgram.STT(
            model="nova-3",
            language=language,
            interim_results=True,
            punctuate=True,
            smart_format=True,
            keyterm=keyterms if keyterms else NOT_GIVEN,
        )
        self._task: asyncio.Task[None] | None = None
        self._visitor: str | None = None
        self._init_turns()

    def _init_turns(self) -> None:
        self._finals: list[str] = []
        # Each visitor turn gets a number, so the widget puts its words in that turn's part of their
        # bubble, and the model's transcript of that turn in its place.
        self._turn = 0
        # The visitor's audio committed to the model so far, one message each. Caption turn n holds the
        # words of the message made by the next commit after n commits.
        self._commits = 0
        self._turn_over = False
        # A sentence shown with interim words whose final words had not come yet.
        self._sentence_open = False
        self._last_sentence_of_old_turn = False

    def start(self, participant: rtc.RemoteParticipant) -> None:
        self._visitor = participant.identity
        self._task = asyncio.create_task(self._run(participant), name="talkfront_live_captions")

    def committed(self) -> None:
        """The visitor's held audio went to the model as one message: words heard from now on belong
        to the next one, except the final words of a sentence they were finishing (its audio was in
        this message). Called at the commit itself, not when the agent starts answering: realtime
        replies rarely say "thinking", and a reply resumed after a false interruption says
        "speaking" again, so the agent's state drifted away from the model's messages."""
        self._commits += 1
        if not self._turn_over:
            self._turn_over = True
            self._last_sentence_of_old_turn = self._sentence_open

    def _turn_for(self, final: bool) -> int:
        if self._turn_over:
            if final and self._last_sentence_of_old_turn:
                self._last_sentence_of_old_turn = False
                return self._turn
            self._turn_over = False
            self._last_sentence_of_old_turn = False
            # The message these words go into. Commits that had no caption words (the visitor's words
            # all taken as echo, say) still had a message and a transcript, so their numbers are skipped.
            self._turn = self._commits
            self._finals.clear()
        return self._turn

    async def aclose(self) -> None:
        if self._task:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await self._task

    async def _track(self, participant: rtc.RemoteParticipant) -> rtc.Track:
        while True:
            for pub in participant.track_publications.values():
                if pub.kind == rtc.TrackKind.KIND_AUDIO and pub.track is not None:
                    return pub.track
            await asyncio.sleep(0.2)

    async def _run(self, participant: rtc.RemoteParticipant) -> None:
        try:
            track = await self._track(participant)
            audio = rtc.AudioStream(track, sample_rate=SAMPLE_RATE, num_channels=1)
            stream = self._stt.stream()

            # Deepgram's timestamps count from the first audio pushed.
            audio_started: dict[str, float | None] = {"t": None}

            async def pump() -> None:
                async for ev in audio:
                    if audio_started["t"] is None:
                        audio_started["t"] = time.time()
                    stream.push_frame(ev.frame)

            pumping = asyncio.create_task(pump())
            try:
                async for ev in stream:
                    if ev.type not in (stt.SpeechEventType.INTERIM_TRANSCRIPT, stt.SpeechEventType.FINAL_TRANSCRIPT):
                        continue
                    text = ev.alternatives[0].text.strip() if ev.alternatives else ""
                    if not text:
                        continue
                    final = ev.type == stt.SpeechEventType.FINAL_TRANSCRIPT
                    alt = ev.alternatives[0]
                    if self._is_echo is not None and self._is_echo(
                        text, final=final, started_at=began_at(alt, audio_started["t"]), duration=spoken_duration(alt)
                    ):
                        if final:
                            # That sentence is over: no final words of it are still to come.
                            self._sentence_open = False
                            self._last_sentence_of_old_turn = False
                        continue
                    turn = self._turn_for(final)
                    self._sentence_open = not final
                    shown = " ".join([*self._finals, text])
                    if final:
                        self._finals.append(text)
                        if self._on_final is not None:
                            with contextlib.suppress(Exception):
                                self._on_final(" ".join(self._finals))
                    await self._send(shown, final, turn)
            finally:
                pumping.cancel()
                await stream.aclose()
                await audio.aclose()
        except asyncio.CancelledError:
            raise
        except Exception as e:  # captions are a nicety: never take the call down with them
            logger.warning("live captions stopped: %s", type(e).__name__)

    async def _send(self, text: str, final: bool, turn: int) -> None:
        await send_json(self._room, self._visitor, TOPIC_LIVE_CAPTION, {"text": text, "final": final, "turn": turn})
