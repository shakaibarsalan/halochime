"""Tells the agent's own voice, picked up again by the visitor's microphone, from the visitor.

Browsers cancel most of the echo, but on laptop speakers some of it gets through, and speech to
text turns it into words. Those words then cut the agent off and become "visitor" turns it answers
("You're welcome!" to its own sentence). Speech that began while the agent was talking, or just
after, is its echo when it repeats the agent's words, or comes out in another script: Urdu spoken
by the agent comes back from speech to text as Hindi or as made-up Latin words, never as the Urdu
it said.

Words come late (speech to text needs a second or two), so stopping the agent on words alone
leaves it talking over the visitor. Loudness is quicker: at the visitor's microphone their own
voice is far louder than the agent's echo. While the agent talks, the guard learns how loud the
echo is; clearly louder speech is the visitor, and the agent may stop for it at once.
"""

from __future__ import annotations

import collections
import difflib
import time
import unicodedata
from collections.abc import Callable

import numpy as np

# Echo of the agent's last words can start this long after the agent's audio ends here: the
# visitor's playback buffer, the network both ways and the browser's own audio path.
ECHO_LAG_S = 1.0
# Audio timestamps place speech up to about half a second early against the agent's speaking state
# (measured: echo of the agent's first words "began" 0.1 to 0.3 s before it started speaking).
ECHO_LEAD_S = 0.7
# Words in another script only count as echo this close to the agent's speech: a visitor who
# switches to Urdu right after an English answer must be heard.
SCRIPT_LAG_S = 0.5
# Speech to text reports words this long after they end, roughly; places speech in time when its
# audio timestamps are unknown. A busy server can deliver words seconds late, so timestamps win.
STT_DELAY_S = 0.4
# What the agent said this long ago can't come back as echo any more.
SAID_WINDOW_S = 30.0
# Agent turns kept to place speech in time.
MAX_SPEECHES = 20
# Share of the heard letters that must repeat the agent's words, in order, to count as echo. Echo
# measures 0.8 to 1 even with speech to text mistakes; a visitor's own question about something the
# agent just mentioned stays near 0.6 at most.
ECHO_MIN_COVERAGE = 0.75
# Matching runs shorter than this are coincidence ("the", "ing", "about").
MIN_RUN_CHARS = 5
# Echo heard badly (distorted, cut by the browser's echo cancellation) repeats less, but most of its
# words are still the agent's.
LOOSE_COVERAGE = 0.6
LOOSE_SHARED_WORDS = 0.75
# Hindi and Urdu echo comes back with more words garbled ("डॉक फ्रंट" for "Talkfront").
LOOSE_SHARED_WORDS_NON_LATIN = 0.65
# Unfinished words that partly repeat the agent wait for their final words before they count: a
# single passed interim is enough to cut the agent off.
INTERIM_HOLD_COVERAGE = 0.5
# Up to this many words while the agent talks, any of them being the agent's is enough: short echo
# comes out the most garbled ("Asked me" for "Ask me"), and "stop" or "wait" still get through.
SHORT_WORDS = 2
# The agent's language is judged from its latest letters only (it may have just switched).
SCRIPT_SAMPLE_CHARS = 200

# Loudness, measured in windows of this length.
LEVEL_WINDOW_S = 0.1
# The echo's level is this percentile of the windows heard while the agent talks: its syllables
# rather than the gaps between words. Every such window counts: leaving loud ones out once let a
# level learned from silence call all of the echo "loud" (the agent answered itself in a loop).
# The visitor talking over the agent fills far fewer windows than a quarter, so it can't move this.
ECHO_LEVEL_PERCENTILE = 75
ECHO_LEVEL_HISTORY = 300
# Windows of agent speech needed before the echo's level is trusted (3 s).
ECHO_LEVEL_MIN_WINDOWS = 30
# The first moments of each agent turn carry no echo yet (it is still on its way back).
ECHO_ARRIVES_AFTER_S = 0.5
# The visitor talking over the agent: this many times louder than the echo (about 14 dB; the
# echo's own loudest syllables reach some 4 times its usual level) ...
LOUD_OVER_ECHO = 5.0
# ... and never quieter than this (about -30 dBFS; normal speech after the browser's gain is
# 0.05 to 0.15, while echo peaks of 0.015 to 0.03 stopped the agent in tests).
LOUD_MIN_RMS = 0.03
# Loud for this many windows in a row before it counts (a click or a cough is shorter).
LOUD_SUSTAIN_WINDOWS = 3
# Short dips between syllables don't end loud speech.
LOUD_GAP_WINDOWS = 2
# Words that began this close to loud speech are the visitor's, whatever they look like.
LOUD_TRUST_MARGIN_S = 0.3
# Loud speech must have been heard this recently to stop the agent now.
LOUD_FRESH_S = 0.4
# Possibly the visitor (a quieter voice too): this far over the echo, or half the loud minimum.
MAYBE_VISITOR_OVER_ECHO = 2.5
# While the agent talks and nothing like the visitor was heard for this long, the microphone audio
# held for the model is only echo and is dropped, so a visitor who then talks over the agent is
# heard without seconds of the agent's own voice in front (the model answered that instead).
HELD_AUDIO_ECHO_AFTER_S = 1.0
# Loud speech that turned out to be echo raises the bar by this much (up to LOUD_MAX_PENALTY).
LOUD_PENALTY_STEP = 1.6
LOUD_MAX_PENALTY = 10.0

def _words(text: str) -> list[str]:
    """Words, keeping vowel signs: a plain regex word split cuts Hindi "मासिक" into "म", "स", "क"
    and no Hindi echo ever matched."""
    words: list[str] = []
    current: list[str] = []
    for ch in text.lower():
        if ch.isalnum() or unicodedata.category(ch).startswith("M"):
            current.append(ch)
        elif current:
            words.append("".join(current))
            current = []
    if current:
        words.append("".join(current))
    return words


def _skeleton(word: str) -> str:
    """A word without its vowel signs and dots ("हूँ" and "हूं", "फ़" and "फ" become one): Hindi and
    Urdu echo comes back with exactly these spelled differently."""
    return "".join(ch for ch in unicodedata.normalize("NFKD", word) if not unicodedata.category(ch).startswith("M"))


def script_of(text: str) -> str | None:
    """The writing system most letters are in: LATIN, ARABIC, DEVANAGARI, CJK, ..."""
    counts: collections.Counter[str] = collections.Counter()
    for ch in text:
        if ch.isalpha():
            try:
                counts[unicodedata.name(ch).split(" ", 1)[0]] += 1
            except ValueError:
                continue
    return counts.most_common(1)[0][0] if counts else None


def echo_coverage(heard: str, said: str) -> float:
    """How much of ``heard`` repeats ``said`` in order, from 0 to 1. Spaces are ignored, so
    "talk front" still matches "Talkfront"."""
    a = "".join(_skeleton(w) for w in _words(heard))
    b = "".join(_skeleton(w) for w in _words(said))
    if not a or not b:
        return 0.0
    matcher = difflib.SequenceMatcher(None, a, b, autojunk=False)
    matched = sum(block.size for block in matcher.get_matching_blocks() if block.size >= MIN_RUN_CHARS)
    return matched / len(a)


class EchoGuard:
    def __init__(self, *, clock: Callable[[], float] = time.time) -> None:
        self._clock = clock
        self._said: collections.deque[tuple[float, str]] = collections.deque()
        # When the agent spoke: [start, end]; end is None while it is speaking.
        self._speeches: collections.deque[list[float | None]] = collections.deque(maxlen=MAX_SPEECHES)
        self.last_visitor_words_at = -1e9
        # Called each time real visitor words arrive (not echo).
        self.on_visitor_words: Callable[[], None] | None = None
        # Loudness of the visitor's microphone.
        self._window_sum = 0.0
        self._window_samples = 0
        self._window_target = 0
        self._echo_levels: collections.deque[float] = collections.deque(maxlen=ECHO_LEVEL_HISTORY)
        self._loud_run = 0
        self._quiet_run = 0
        self._loud_since = 0.0
        # Loud visitor speech: [start, end] in the same time base as speech to text timestamps.
        self._loud: collections.deque[list[float]] = collections.deque(maxlen=MAX_SPEECHES)
        self._loud_heard_at = -1e9
        self._loud_penalty = 1.0
        self._maybe_visitor_at = -1e9

    @property
    def agent_speaking(self) -> bool:
        return bool(self._speeches) and self._speeches[-1][1] is None

    def agent_said(self, text: str) -> None:
        if text:
            self._said.append((self._clock(), text))

    def set_agent_speaking(self, speaking: bool) -> None:
        now = self._clock()
        if speaking and not self.agent_speaking:
            self._speeches.append([now, None])
        elif not speaking and self.agent_speaking:
            self._speeches[-1][1] = now

    def visitor_silent_while_agent_spoke(self) -> bool:
        """No real visitor words since the agent last started speaking."""
        return not self._speeches or self.last_visitor_words_at < (self._speeches[-1][0] or 0.0)

    def _during_agent_speech(self, started_at: float, lag: float = ECHO_LAG_S) -> bool:
        for start, end in reversed(self._speeches):
            assert start is not None
            if start - ECHO_LEAD_S <= started_at and (end is None or started_at <= end + lag):
                return True
            if end is not None and end + lag < started_at:
                return False  # older turns ended even earlier
        return False

    # --- loudness -----------------------------------------------------------------------------

    def echo_level(self) -> float | None:
        if len(self._echo_levels) < ECHO_LEVEL_MIN_WINDOWS:
            return None
        return float(np.percentile(np.fromiter(self._echo_levels, dtype=np.float64), ECHO_LEVEL_PERCENTILE))

    def _loud_threshold(self) -> float | None:
        level = self.echo_level()
        return None if level is None else max(LOUD_MIN_RMS, level * LOUD_OVER_ECHO) * self._loud_penalty

    def hear_audio(self, pcm: np.ndarray, sample_rate: int, at: float) -> None:
        """Microphone audio (int16 samples) whose end is at ``at`` (speech to text time base)."""
        if not self._window_target:
            self._window_target = max(int(sample_rate * LEVEL_WINDOW_S), 1)
        samples = pcm.astype(np.float64) / 32768.0
        self._window_sum += float(np.dot(samples, samples))
        self._window_samples += len(samples)
        if self._window_samples < self._window_target:
            return
        rms = (self._window_sum / self._window_samples) ** 0.5
        self._window_sum = 0.0
        self._window_samples = 0
        self._level_window(rms, at)

    def _level_window(self, rms: float, at: float) -> None:
        threshold = self._loud_threshold()
        loud = self.agent_speaking and threshold is not None and rms > threshold
        level = self.echo_level()
        if level is None or rms > max(LOUD_MIN_RMS / 2, level * MAYBE_VISITOR_OVER_ECHO) * self._loud_penalty:
            self._maybe_visitor_at = self._clock()
        if self.agent_speaking and self._clock() - (self._speeches[-1][0] or 0.0) >= ECHO_ARRIVES_AFTER_S:
            self._echo_levels.append(rms)
        if loud:
            if self._loud_run == 0:
                self._loud_since = at - LEVEL_WINDOW_S
            self._loud_run += 1
            self._quiet_run = 0
            if self._loud_run >= LOUD_SUSTAIN_WINDOWS:
                if self._loud and self._loud[-1][1] >= self._loud_since - LEVEL_WINDOW_S:
                    self._loud[-1][1] = at
                else:
                    self._loud.append([self._loud_since, at])
                self._loud_heard_at = self._clock()
        else:
            self._quiet_run += 1
            if self._quiet_run > LOUD_GAP_WINDOWS:
                self._loud_run = 0

    def held_audio_is_echo(self) -> bool:
        """The agent is talking and nothing like the visitor was heard lately (no words either)."""
        now = self._clock()
        return (
            self.agent_speaking
            and self.echo_level() is not None
            and now - self._maybe_visitor_at > HELD_AUDIO_ECHO_AFTER_S
            and now - self.last_visitor_words_at > HELD_AUDIO_ECHO_AFTER_S
        )

    def visitor_loud_now(self) -> bool:
        """The visitor is talking, clearly louder than the agent's echo. Never during the agent's
        first turn (the greeting): it is when the echo's level is learned, and the browser's echo
        cancellation is still settling."""
        return (
            len(self._speeches) >= 2
            and self._loud_run >= LOUD_SUSTAIN_WINDOWS
            and self._clock() - self._loud_heard_at <= LOUD_FRESH_S
        )

    def loud_was_false(self) -> None:
        """The agent was stopped for loud speech and no words followed (it resumed)."""
        self._loud_was_echo()

    def _loud_was_echo(self) -> None:
        if self._loud_penalty < LOUD_MAX_PENALTY:
            self._loud_penalty = min(self._loud_penalty * LOUD_PENALTY_STEP, LOUD_MAX_PENALTY)

    def _during_loud_speech(self, started_at: float) -> bool:
        return any(
            start - LOUD_TRUST_MARGIN_S <= started_at <= end + LOUD_TRUST_MARGIN_S for start, end in self._loud
        )

    def _recent_said(self) -> str:
        cutoff = self._clock() - SAID_WINDOW_S
        while self._said and self._said[0][0] < cutoff:
            self._said.popleft()
        return "".join(chunk for _, chunk in self._said)

    def _began_at(self, started_at: float | None, duration: float) -> float:
        now = self._clock()
        if started_at is not None and now - 120 < started_at <= now:
            return started_at
        return now - max(duration, 0.0) - STT_DELAY_S

    def is_echo(
        self, heard: str, *, final: bool = True, started_at: float | None = None, duration: float = 0.0
    ) -> bool:
        """``started_at``: when the heard words began (wall clock, from their audio timestamps);
        else ``duration``, how long they took to say, places them back from now."""
        words = _words(heard)
        if not words:
            return False
        began = self._began_at(started_at, duration)
        if not self._during_agent_speech(began):
            return False
        said = self._recent_said()
        if not said:
            return False
        loud = self._during_loud_speech(began)
        if script_of(heard) != script_of(said[-SCRIPT_SAMPLE_CHARS:]):
            # Urdu over an English answer comes out in another script: loud, it is the visitor.
            return not loud and self._during_agent_speech(began, SCRIPT_LAG_S)
        coverage = echo_coverage(heard, said)
        if coverage >= ECHO_MIN_COVERAGE:
            if loud and final:
                self._loud_was_echo()
            return True
        said_words = {_skeleton(w) for w in _words(said)}
        shared = sum(_skeleton(w) in said_words for w in words) / len(words)
        if len(words) <= SHORT_WORDS and shared > 0:
            return True
        if not final:
            return coverage >= INTERIM_HOLD_COVERAGE
        needed = LOOSE_SHARED_WORDS if script_of(heard) == "LATIN" else LOOSE_SHARED_WORDS_NON_LATIN
        return coverage >= LOOSE_COVERAGE and shared >= needed

    def explain(
        self, heard: str, *, started_at: float | None = None, duration: float = 0.0
    ) -> dict[str, object] | None:
        """Why words near the agent's speech were (not) echo, without the words themselves (for logs)."""
        if not self._speeches:
            return None
        now = self._clock()
        start, end = self._speeches[-1]
        assert start is not None
        began = self._began_at(started_at, duration)
        if end is not None and began > end + 3.0:
            return None
        said = self._recent_said()
        words = _words(heard)
        said_words = set(_words(said))
        return {
            "words": len(words),
            "duration": round(duration, 2),
            "timed_by_audio": started_at is not None,
            "reported_after_begin": round(now - began, 2),
            "began_after_agent_start": round(began - start, 2),
            "began_after_agent_end": round(began - end, 2) if end is not None else None,
            "same_script": script_of(heard) == script_of(said[-SCRIPT_SAMPLE_CHARS:]),
            "coverage": round(echo_coverage(heard, said), 2),
            "words_in_said": sum(w in said_words for w in words),
            "said_last_age": round(now - self._said[-1][0], 2) if self._said else None,
            "loud": self._during_loud_speech(began),
            "echo_level": round(level, 4) if (level := self.echo_level()) is not None else None,
        }

    def heard(
        self, text: str, *, final: bool = True, started_at: float | None = None, duration: float = 0.0
    ) -> bool:
        """Checks words from speech to text. Returns True for the visitor's own words."""
        if self.is_echo(text, final=final, started_at=started_at, duration=duration):
            return False
        if text.strip():
            self.last_visitor_words_at = self._clock()
            if self.on_visitor_words is not None:
                self.on_visitor_words()
        return True


def spoken_duration(data: object) -> float:
    """How long a speech to text result took to say, from its word timestamps (0 if unknown)."""
    start = getattr(data, "start_time", 0.0) or 0.0
    end = getattr(data, "end_time", 0.0) or 0.0
    return max(end - start, 0.0)


def began_at(data: object, audio_started_at: float | None) -> float | None:
    """Wall clock time the words of a speech to text result began, from its audio timestamps
    (seconds since ``audio_started_at``). None when unknown."""
    start = getattr(data, "start_time", 0.0) or 0.0
    if audio_started_at is None or start <= 0:
        return None
    return audio_started_at + start
