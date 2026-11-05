"""Echo cancellation on the server, for visitors on laptop speakers.

Browsers cancel most of the agent's voice coming back into the visitor's microphone, but on laptop
speakers a fair part gets through (5 Nov call: echo at about 0.013 rms, speech at 0.05 to 0.15). Speech
to text then hears the agent's own words as the visitor's, and when the visitor talks over the agent
the mix is taken for echo and their question is lost (test calls with that much echo: "Can it also
answer in Urdu?" dropped, "Okay, so why does that happen?" transcribed as "Hallo, wie geht's?").

WebRTC's echo canceller (LiveKit's AudioProcessingModule) removes it here, because the server knows
exactly what the agent said: each frame the agent sends is the reference ("reverse stream"), fed in
step with the visitor's audio, one 10 ms chunk for each 10 ms heard. Offline: echo 0.008 to 0.025 rms
down to 0, the visitor's words intact, for echo arriving up to about 0.5 s after its reference.

Real echo comes back later than that (the room's send buffer, the network both ways, the browser's
buffers, Bluetooth), so the reference is held back to match: the delay is measured by lining up the
loudness of the agent's audio with the loudness of the microphone, while the agent talks.
"""

from __future__ import annotations

import collections
import contextlib
import logging
import os
from collections.abc import Callable

import numpy as np
from livekit import rtc
from livekit.agents.voice import io

logger = logging.getLogger("talkfront.aec")

RATE = 16000
CHUNK = RATE // 100  # 10 ms, what the canceller takes
# The canceller's own delay search covers echo up to about 0.5 s after its reference. Echo later than
# HOLD_BACK_AFTER_MS gets the reference held back so the echo arrives TARGET_DELAY_MS after it; earlier
# echo is left alone (moving the reference makes the canceller adapt again).
HOLD_BACK_AFTER_MS = 400
TARGET_DELAY_MS = 200
# Held back from the start, before the first measurement (test calls measured 510 to 840 ms of echo
# delay: this brings that within the canceller's reach).
INITIAL_HOLD_BACK_MS = 300
# Echo delays looked for: up to 1.5 s.
MAX_DELAY_CHUNKS = 150
# Loudness history used to measure the delay (3 s), and how often it is measured (1 s).
ENVELOPE_CHUNKS = 300
MEASURE_EVERY_CHUNKS = 100
# The agent must have spoken this much of the window (in chunks with sound) for a measurement.
MIN_SPEECH_CHUNKS = 80
# Loudness of the agent's audio counted as sound.
SOUND_RMS = 0.01
# Lining up must be this clear (correlation) to move the reference: real echo matched 0.71 to 0.98, and
# a visitor with no echo once matched 0.56 by chance.
MIN_CORRELATION = 0.65
# Two measurements in a row agree when this close (100 ms).
AGREE_CHUNKS = 10
# Moves smaller than this are left to the canceller (it reaches about 0.5 s; each move makes it adapt again).
MIN_SHIFT_CHUNKS = 15
# Agent audio waiting to be played is capped (a long reply pushed ahead of real time).
MAX_PENDING_CHUNKS = 100 * 120


def enabled() -> bool:
    """On unless SERVER_ECHO_CANCEL=0 (a quick way back without a new build)."""
    return os.environ.get("SERVER_ECHO_CANCEL", "1") != "0"


class EchoCanceller:
    def __init__(self) -> None:
        self._apm = rtc.AudioProcessingModule(echo_cancellation=True, high_pass_filter=True)
        # The agent's audio, 10 ms chunks at RATE, in the order it plays.
        self._pending: collections.deque[np.ndarray] = collections.deque()
        self._partial = np.zeros(0, dtype=np.int16)
        self._paused = False
        # The reference waits here before the canceller gets it (see the module notes).
        self._delay_line: collections.deque[np.ndarray] = collections.deque()
        self.delay_chunks = INITIAL_HOLD_BACK_MS // 10
        self._ref_env: collections.deque[float] = collections.deque(maxlen=ENVELOPE_CHUNKS + MAX_DELAY_CHUNKS)
        self._mic_env: collections.deque[float] = collections.deque(maxlen=ENVELOPE_CHUNKS)
        self._chunks = 0
        self._mic = np.zeros(0, dtype=np.int16)
        self._in_resampler: rtc.AudioResampler | None = None
        self._in_rate = 0
        self._out_resampler: rtc.AudioResampler | None = None
        self._out_rate = 0
        # The canceller failed once: from then on the audio only changes rate.
        self.failed = False
        self.measured_ms: int | None = None
        # A delay measured once and waiting for the next measurement to agree before the reference moves.
        self._candidate: int | None = None

    # --- the agent's side ---------------------------------------------------------------------

    def agent_audio(self, frame: rtc.AudioFrame) -> None:
        """A frame the agent is about to play (frames come ahead of real time)."""
        pcm = _mono(frame)
        if frame.sample_rate != RATE:
            if self._out_resampler is None or self._out_rate != frame.sample_rate:
                self._out_resampler = rtc.AudioResampler(frame.sample_rate, RATE, num_channels=1)
                self._out_rate = frame.sample_rate
            mono = rtc.AudioFrame(pcm.tobytes(), frame.sample_rate, 1, len(pcm))
            pcm = np.concatenate(
                [np.frombuffer(bytes(f.data), dtype=np.int16) for f in self._out_resampler.push(mono)]
                or [np.zeros(0, dtype=np.int16)]
            )
        self._partial = np.concatenate([self._partial, pcm])
        while len(self._partial) >= CHUNK and len(self._pending) < MAX_PENDING_CHUNKS:
            self._pending.append(self._partial[:CHUNK].copy())
            self._partial = self._partial[CHUNK:]

    def agent_cleared(self) -> None:
        """The agent was cut off: what it had not played yet never will be."""
        self._pending.clear()
        self._partial = np.zeros(0, dtype=np.int16)

    def agent_paused(self, paused: bool) -> None:
        self._paused = paused

    def _next_reference(self) -> np.ndarray:
        if self._paused or not self._pending:
            return np.zeros(CHUNK, dtype=np.int16)
        return self._pending.popleft()

    # --- the visitor's side -------------------------------------------------------------------

    def process(self, frame: rtc.AudioFrame) -> list[rtc.AudioFrame]:
        """The visitor's audio in, the same audio without the agent's echo out (10 ms frames at RATE)."""
        pcm = _mono(frame)
        if frame.sample_rate != RATE:
            if self._in_resampler is None or self._in_rate != frame.sample_rate:
                self._in_resampler = rtc.AudioResampler(frame.sample_rate, RATE, num_channels=1)
                self._in_rate = frame.sample_rate
            mono = rtc.AudioFrame(pcm.tobytes(), frame.sample_rate, 1, len(pcm))
            parts = [np.frombuffer(bytes(f.data), dtype=np.int16) for f in self._in_resampler.push(mono)]
            pcm = np.concatenate(parts) if parts else np.zeros(0, dtype=np.int16)
        self._mic = np.concatenate([self._mic, pcm])
        out: list[rtc.AudioFrame] = []
        while len(self._mic) >= CHUNK:
            near, self._mic = self._mic[:CHUNK], self._mic[CHUNK:]
            out.append(self._cancel(near))
        return out

    def _cancel(self, near: np.ndarray) -> rtc.AudioFrame:
        reference = self._next_reference()
        self._ref_env.append(_rms(reference))
        self._mic_env.append(_rms(near))
        self._chunks += 1
        if self._chunks % MEASURE_EVERY_CHUNKS == 0:
            self._measure_delay()
        self._delay_line.append(reference)
        while len(self._delay_line) > self.delay_chunks + 1:
            self._delay_line.popleft()
        late_reference = self._delay_line[0] if len(self._delay_line) > self.delay_chunks else np.zeros(CHUNK, dtype=np.int16)
        frame = rtc.AudioFrame(near.tobytes(), RATE, 1, CHUNK)
        if self.failed:
            return frame
        try:
            self._apm.process_reverse_stream(rtc.AudioFrame(late_reference.tobytes(), RATE, 1, CHUNK))
            self._apm.set_stream_delay_ms(TARGET_DELAY_MS)
            self._apm.process_stream(frame)
        except Exception as e:  # never lose the visitor's audio over this
            self.failed = True
            logger.warning("echo cancellation stopped: %s", e)
            return rtc.AudioFrame(near.tobytes(), RATE, 1, CHUNK)
        return frame

    def _measure_delay(self) -> None:
        """Lines up the agent's loudness with the microphone's to find how late its echo comes back."""
        if len(self._mic_env) < ENVELOPE_CHUNKS or len(self._ref_env) < ENVELOPE_CHUNKS + MAX_DELAY_CHUNKS:
            return
        ref = np.fromiter(self._ref_env, dtype=np.float64)
        mic = np.fromiter(self._mic_env, dtype=np.float64)
        if int(np.sum(ref[MAX_DELAY_CHUNKS:] > SOUND_RMS)) < MIN_SPEECH_CHUNKS:
            return  # the agent was mostly quiet: nothing to line up
        mic = mic - mic.mean()
        if not mic.any():
            return
        best, best_lag = 0.0, 0
        n = ENVELOPE_CHUNKS
        for lag in range(MAX_DELAY_CHUNKS + 1):
            # mic[i] heard at chunk i; its echo came from the reference `lag` chunks earlier.
            seg = ref[MAX_DELAY_CHUNKS - lag: MAX_DELAY_CHUNKS - lag + n]
            seg = seg - seg.mean()
            denom = float(np.linalg.norm(seg) * np.linalg.norm(mic))
            if denom <= 0:
                continue
            corr = float(np.dot(seg, mic)) / denom
            if corr > best:
                best, best_lag = corr, lag
        if best < MIN_CORRELATION:
            return
        # Speech has a rhythm, so a wrong delay can line up once (a phone call measured 1320, 480, 1080
        # and 570 ms in a row, and each move made the canceller start over): two in a row must agree.
        candidate, self._candidate = self._candidate, best_lag
        if candidate is None or abs(best_lag - candidate) > AGREE_CHUNKS:
            return
        best_lag = (best_lag + candidate) // 2
        self.measured_ms = best_lag * 10
        target = best_lag - TARGET_DELAY_MS // 10 if best_lag * 10 > HOLD_BACK_AFTER_MS else 0
        if abs(target - self.delay_chunks) >= MIN_SHIFT_CHUNKS:
            logger.info("echo comes back %d ms late (match %.2f): reference held back %d ms", best_lag * 10, best, target * 10)
            self.delay_chunks = target


def _mono(frame: rtc.AudioFrame) -> np.ndarray:
    pcm = np.frombuffer(bytes(frame.data), dtype=np.int16)
    return pcm[:: frame.num_channels].copy() if frame.num_channels > 1 else pcm.copy()


def _rms(chunk: np.ndarray) -> float:
    return float(np.sqrt(np.mean((chunk.astype(np.float64) / 32768.0) ** 2))) if len(chunk) else 0.0


class EchoCancelledInput(io.AudioInput):
    """The visitor's microphone for the session (voice detection, speech to text, the realtime model),
    with the agent's echo taken out. `listeners` get the same frames (live captions)."""

    def __init__(self, source: io.AudioInput, canceller: EchoCanceller) -> None:
        super().__init__(label="EchoCancelled", source=source)
        self._aec = canceller
        self._ready: collections.deque[rtc.AudioFrame] = collections.deque()
        self.listeners: list[Callable[[rtc.AudioFrame], None]] = []

    async def __anext__(self) -> rtc.AudioFrame:
        while not self._ready:
            frame = await super().__anext__()
            frames = self._aec.process(frame)
            for f in frames:
                for listener in self.listeners:
                    with contextlib.suppress(Exception):
                        listener(f)
            self._ready.extend(frames)
        return self._ready.popleft()


class EchoReferenceOutput(io.AudioOutput):
    """Passes the agent's audio on unchanged and gives the echo canceller a copy as its reference."""

    def __init__(self, next_in_chain: io.AudioOutput, canceller: EchoCanceller) -> None:
        super().__init__(
            label="EchoReference", next_in_chain=next_in_chain, capabilities=io.AudioOutputCapabilities(pause=True)
        )
        self._aec = canceller

    @property
    def sample_rate(self) -> int | None:
        if self._sample_rate is not None:
            return self._sample_rate
        return self.next_in_chain.sample_rate if self.next_in_chain else None

    async def capture_frame(self, frame: rtc.AudioFrame) -> None:
        if self.next_in_chain:
            await self.next_in_chain.capture_frame(frame)
        await super().capture_frame(frame)
        with contextlib.suppress(Exception):
            self._aec.agent_audio(frame)

    def flush(self) -> None:
        super().flush()
        if self.next_in_chain:
            self.next_in_chain.flush()

    def clear_buffer(self) -> None:
        if self.next_in_chain:
            self.next_in_chain.clear_buffer()
        self._aec.agent_cleared()

    def pause(self) -> None:
        super().pause()
        self._aec.agent_paused(True)

    def resume(self) -> None:
        super().resume()
        self._aec.agent_paused(False)
