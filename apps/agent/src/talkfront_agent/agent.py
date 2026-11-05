"""The LiveKit worker: one job per conversation room (``tf-<conversationId>``)."""

from __future__ import annotations

import asyncio
import contextlib
import dataclasses
import logging
import os
import re
import time
import warnings
from collections.abc import Callable

import numpy as np

from livekit.agents import (
    NOT_GIVEN,
    Agent,
    AgentServer,
    AgentSession,
    CloseEvent,
    CloseReason,
    ConversationItemAddedEvent,
    FunctionToolsExecutedEvent,
    JobContext,
    JobProcess,
    RunContext,
    UserStateChangedEvent,
    function_tool,
    llm,
    room_io,
    stt,
)
from livekit.plugins import anthropic, deepgram, groq, openai, silero

with warnings.catch_warnings():
    # The plugin is deprecated in favour of livekit.agents.inference.TurnDetector (an audio
    # end-of-turn model that prefers LiveKit Cloud). We use the pinned text-based multilingual
    # model, which runs locally. It must be imported at module level so its model is
    # registered with the worker's inference process.
    warnings.simplefilter("ignore", DeprecationWarning)
    from livekit.plugins.turn_detector.multilingual import MultilingualModel

from .api import (
    AGENT_NAME,
    ApiSettings,
    ContractError,
    DispatchMetadata,
    EndedReason,
    InternalApiError,
    RuntimeConfig,
    TalkfrontApi,
    build_end_request,
    parse_dispatch_metadata,
)
from . import greeting_cache
from .echo import EchoGuard, began_at, spoken_duration
from .lifecycle import EndReason, HandoffDraft, OnceGuard, TurnCounter
from .live_captions import TOPIC_REPLY_CUT, LiveCaptions, send_json
from .tools import build_tools, search_formatted
from .transcript import TranscriptBuffer, describe_tool_call

logger = logging.getLogger("talkfront.agent")

DEFAULT_LLM_MODELS = {"anthropic": "claude-haiku-5-5", "groq": "openai/gpt-oss-20b", "openai": "gpt-4o-mini"}
# Backups after the agent's own model, fastest first (first words measured from the server: Groq
# 0.2-0.6 s, GPT-4o mini 0.9 s, Gemini flash-lite 1-1.8 s). A model is used only if its key is set.
# Each Groq model has its own tokens-per-minute limit (free tier: 8k), so they back each other up.
FALLBACK_MODELS: list[tuple[str, str]] = [
    ("groq", "openai/gpt-oss-20b"),
    ("groq", "qwen/qwen3.8-27b"),
    ("groq", "openai/gpt-oss-120b"),
    ("openai", "gpt-4o-mini"),
    ("gemini", "gemini-3.5-flash-lite"),
]
_PROVIDER_KEYS = {"groq": "GROQ_API_KEY", "openai": "OPENAI_API_KEY", "gemini": "GEMINI_API_KEY", "anthropic": "ANTHROPIC_API_KEY"}
GEMINI_OPENAI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/"
# Realtime voice: who decides the visitor has finished. REALTIME_TURN env:
#   "livekit" (default)  our own voice detection + Deepgram words + turn detector. A turn needs real
#                        words, so noise, typing or the agent's own voice leaking back never become a
#                        "visitor message" (OpenAI's detector did that in real calls: "Altyazı", "好").
#   "silence:<ms>"       OpenAI answers after that much silence (faster, but reacts to noise);
#   "semantic:<low|medium|high|auto>"  OpenAI judges by meaning (fewer cut-offs, ~2 s slower in tests).
REALTIME_TURN_DEFAULT = "livekit"
# Speech probability needed to count as the visitor talking (OpenAI default 0.5). Higher ignores
# background noise and the agent's own voice leaking back, which cut replies short in real calls.
REALTIME_VAD_THRESHOLD = 0.6
# The full model (not mini): in a 4 Nov test, mini wrote spoken Urdu down as Bengali and Korean.
REALTIME_TRANSCRIBE_MODEL = "gpt-4o-transcribe"
# Instructions plus the recent part of the call: keeps each turn small and fast.
MAX_CONTEXT_ITEMS = 24
GOODBYE_TEXT = (
    "We've reached the time limit for this conversation. Thanks for chatting with us, goodbye!"
)
GOODBYE_PLAYOUT_TIMEOUT_S = 20.0
# After the agent's goodbye has played, wait this long before closing so the last word isn't cut.
GOODBYE_GRACE_S = 0.6
# end_call waits at most this long for the visitor's latest words to be transcribed (realtime).
END_CALL_TRANSCRIPT_WAIT_S = 2.5
VISITOR_LINK_TIMEOUT_S = 30
# Idle handling: (seconds of quiet before "are you still there?", then seconds before ending).
# An open but idle call would otherwise run to the max duration and use the business's minutes.
IDLE_LIMITS_S = {"voice": (30.0, 20.0), "text": (240.0, 60.0)}
STILL_THERE_TEXT = "Are you still there?"
IDLE_GOODBYE_TEXT = (
    "It seems you've stepped away, so I'll end our conversation now. "
    "You're welcome to reach out again anytime. Goodbye!"
)
# Words speech to text should expect when visitors spell out contact details (nova-3 keyterms).
CONTACT_KEYTERMS = ["gmail", "hotmail", "outlook", "yahoo", "icloud", "at the rate", "dot com"]
SESSION_CLOSE_WAIT_S = 3.0

# Models that still accept a non-default `temperature`. Claude 4.7+ and the 5.x family
# (including the default claude-haiku-5-5) reject anything but the default, so for those we
# leave temperature unset and let the system prompt steer the style.
_TEMPERATURE_MODELS = re.compile(r"^claude-(3[-.]|(opus|sonnet|haiku)-4(-[0-6])?(-\d{8})?$)")


def accepts_temperature(model: str) -> bool:
    return bool(_TEMPERATURE_MODELS.match(model))


def _groq_llm(model: str, temperature: float) -> groq.LLM:
    # Reads GROQ_API_KEY. gpt-oss reasons before answering ("low" keeps voice replies quick);
    # Qwen 3 must not think out loud, or the voice would read the thinking.
    effort = "low" if model.startswith("openai/gpt-oss") else "none" if model.startswith("qwen/") else NOT_GIVEN
    # No retries per model: on a rate limit the fallback moves to the next model right away.
    return groq.LLM(model=model, temperature=temperature, reasoning_effort=effort, max_retries=0)  # type: ignore[arg-type]


def _llm_for(provider: str, model: str, temperature: float) -> llm.LLM:
    if provider == "groq":
        return _groq_llm(model, temperature)
    if provider == "openai":
        # Reads OPENAI_API_KEY. No retries: on an error the fallback moves to the next model at once.
        return openai.LLM(model=model, temperature=temperature, max_retries=0)  # type: ignore[call-arg]
    if provider == "gemini":
        return openai.LLM(
            model=model,
            api_key=os.environ["GEMINI_API_KEY"],
            base_url=GEMINI_OPENAI_BASE_URL,
            temperature=temperature,
            max_retries=0,  # type: ignore[call-arg]
        )
    temp = temperature if accepts_temperature(model) else NOT_GIVEN
    if temp is NOT_GIVEN:
        logger.debug("model %s takes no temperature; ignoring configured %.2f", model, temperature)
    return anthropic.LLM(model=model, temperature=temp)


def build_llm(runtime: RuntimeConfig) -> llm.LLM:
    """The agent's model first, then every backup whose key is set, so a rate limit or an outage
    on one provider moves the reply to the next instead of leaving the visitor in silence."""
    cfg = runtime.agent.llm
    model = cfg.model or DEFAULT_LLM_MODELS[cfg.provider]
    chain = [(cfg.provider, model)] + [
        (p, m) for p, m in FALLBACK_MODELS if m != model and os.environ.get(_PROVIDER_KEYS[p])
    ]
    llms = [_llm_for(p, m, cfg.temperature) for p, m in chain]
    if len(llms) == 1:
        return llms[0]
    return llm.FallbackAdapter(llms, attempt_timeout=10.0, max_retry_per_llm=0, retry_interval=0.3)


# Realtime connects even when the OpenAI account can't serve (no credit, bad key, outage) and then
# stays silent. So each worker process checks OpenAI with a tiny request at start and every few
# minutes, and voice calls use the classic engine while it fails.
REALTIME_PROBE_EVERY_S = 300.0
_openai_health = {"ok": True, "checked_at": 0.0, "running": False}


def _probe_openai() -> bool:
    import json
    import urllib.error
    import urllib.request

    body = json.dumps(
        {"model": "gpt-4o-mini", "max_completion_tokens": 1, "messages": [{"role": "user", "content": "ok"}]}
    ).encode()
    req = urllib.request.Request(
        "https://api.openai.com/v1/chat/completions",
        data=body,
        headers={"Authorization": f"Bearer {os.environ.get('OPENAI_API_KEY', '')}", "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=6) as resp:
            return resp.status == 200
    except urllib.error.HTTPError as e:
        logger.warning("OpenAI check failed with HTTP %s; voice uses the classic engine", e.code)
        return False
    except Exception as e:  # network trouble: try again next time
        logger.warning("OpenAI check failed (%s); voice uses the classic engine", type(e).__name__)
        return False


def refresh_openai_health(block: bool = False) -> None:
    if not os.environ.get("OPENAI_API_KEY") or _openai_health["running"]:
        return

    def run() -> None:
        _openai_health["running"] = True
        try:
            _openai_health["ok"] = _probe_openai()
            _openai_health["checked_at"] = time.monotonic()
        finally:
            _openai_health["running"] = False

    if block:
        run()
    else:
        import threading

        threading.Thread(target=run, name="talkfront-openai-check", daemon=True).start()


def use_realtime(runtime: RuntimeConfig) -> bool:
    if runtime.mode != "voice" or runtime.agent.voice.engine != "realtime" or not os.environ.get("OPENAI_API_KEY"):
        return False
    if time.monotonic() - float(_openai_health["checked_at"]) > REALTIME_PROBE_EVERY_S:
        refresh_openai_health()  # in the background; this call uses the last result
    return bool(_openai_health["ok"])


def build_realtime_model(runtime: RuntimeConfig) -> llm.RealtimeModel:
    """One OpenAI model listens, thinks and speaks: no separate speech to text or voice, and it speaks
    the visitor's language. Captions come from its own transcription of the visitor."""
    from openai.types import realtime as rt  # the OpenAI SDK ships with the plugin

    voice = runtime.agent.voice
    return openai.realtime.RealtimeModel(
        model=voice.realtime_model,
        voice=voice.realtime_voice,
        # No transcription prompt: on silence the transcriber returned the prompt itself as the
        # visitor's words ("BudsBridge, Support agent"). Live captions get the names instead.
        input_audio_transcription=rt.AudioTranscription(model=REALTIME_TRANSCRIBE_MODEL),
        input_audio_noise_reduction="near_field",
        turn_detection=realtime_turn_detection(realtime_turn_spec()),
    )


def realtime_turn_spec() -> str:
    return os.environ.get("REALTIME_TURN") or REALTIME_TURN_DEFAULT


def realtime_turn_detection(spec: str):  # type: ignore[no-untyped-def]
    from openai.types import realtime as rt

    kind, _, value = spec.partition(":")
    if kind == "livekit":
        return None  # OpenAI's detector off: the session's own turn detection commits the audio
    if kind == "semantic":
        eagerness = value if value in ("low", "medium", "high", "auto") else "auto"
        return rt.realtime_audio_input_turn_detection.SemanticVad(
            type="semantic_vad", create_response=True, eagerness=eagerness, interrupt_response=True  # type: ignore[arg-type]
        )
    silence_ms = int(value) if value.isdigit() and 200 <= int(value) <= 2000 else 600
    return rt.realtime_audio_input_turn_detection.ServerVad(
        type="server_vad", create_response=True, interrupt_response=True,
        threshold=REALTIME_VAD_THRESHOLD, prefix_padding_ms=300, silence_duration_ms=silence_ms,
    )


# Knowledge is looked up for every visitor message before the model answers, so a factual answer
# takes one model call instead of two (search tool call, then the answer). It runs inside llm_node
# so preemptive generation still works: changing the chat context earlier would cancel it.
AUTO_SEARCH_TIMEOUT_S = 1.5
AUTO_SEARCH_MIN_CHARS = 6
AUTO_SEARCH_CACHE = 16
AUTO_KNOWLEDGE_NOTE = (
    "Knowledge base results for the visitor's next message. The search is already done: answer from "
    "these. Call search_knowledge only if they clearly don't cover the question, and then with "
    "different, more specific words. Never guess.\n\n"
)


# Realtime: a sentence of the agent's own echo with no visitor words for this long means the
# microphone audio held for the model is only echo, and is dropped.
ECHO_CLEAR_AFTER_S = 2.0
# Searched once at the start of a call to warm up the knowledge search (its results are not used).
WARMUP_QUERY = "What can you help me with?"
# Long enough for the note's events to be queued on the connection, far shorter than OpenAI's reply.
NOTE_SEND_WAIT_S = 0.03


def _log_note_failure(task: asyncio.Task[None]) -> None:
    if not task.cancelled() and task.exception() is not None:
        logger.warning("could not add the knowledge note: %s", type(task.exception()).__name__)


_TRANSCRIPT_EVENTS = (
    stt.SpeechEventType.INTERIM_TRANSCRIPT,
    stt.SpeechEventType.PREFLIGHT_TRANSCRIPT,
    stt.SpeechEventType.FINAL_TRANSCRIPT,
)


class TalkfrontAgent(Agent):
    def __init__(  # type: ignore[no-untyped-def]
        self,
        *,
        api: TalkfrontApi | None = None,
        conversation_id: str = "",
        realtime: bool = False,
        echo: EchoGuard | None = None,
        **kwargs,
    ) -> None:
        super().__init__(**kwargs)
        self._api = api
        self._conversation_id = conversation_id
        self._realtime = realtime
        self._echo = echo
        # Called when a whole sentence of the agent's own voice came back from the visitor's speakers.
        self.on_echo: Callable[[], None] | None = None
        # Visitor message -> results. Preemptive attempts and tool steps of one turn reuse the search.
        self._knowledge: dict[str, asyncio.Task[str | None]] = {}

    def _knowledge_for(self, text: str) -> asyncio.Task[str | None]:
        key = " ".join(text.lower().split())
        task = self._knowledge.get(key)
        if task is None:
            task = asyncio.ensure_future(self._search(text))
            self._knowledge[key] = task
            while len(self._knowledge) > AUTO_SEARCH_CACHE:
                self._knowledge.pop(next(iter(self._knowledge)))
        return task

    async def _search(self, text: str) -> str | None:
        assert self._api is not None
        started = time.perf_counter()
        try:
            found = await asyncio.wait_for(
                search_formatted(self._api, self._conversation_id, text), AUTO_SEARCH_TIMEOUT_S
            )
        except (ContractError, InternalApiError, asyncio.TimeoutError) as e:
            logger.warning("automatic knowledge search skipped: %s", type(e).__name__)
            return None
        logger.info("automatic knowledge search took %.0f ms", (time.perf_counter() - started) * 1000)
        return found

    async def on_user_turn_completed(self, turn_ctx, new_message) -> None:  # type: ignore[no-untyped-def]
        """Realtime voices have no llm_node: put the knowledge for this turn into the model's context
        before it answers, so a factual answer needs no search tool round trip (about 2 s)."""
        if not self._realtime or self._api is None:
            return
        metrics = new_message.metrics or {}
        self.turn_done_at = time.monotonic()
        logger.info(
            "realtime turn ended: end_of_turn_delay=%s transcription_delay=%s",
            round(metrics.get("end_of_turn_delay") or -1, 3),
            round(metrics.get("transcription_delay") or -1, 3),
        )
        text = (new_message.text_content or "").strip()
        if len(text) < AUTO_SEARCH_MIN_CHARS:
            return
        found = await asyncio.shield(self._knowledge_for(text))
        ctx = self.chat_ctx.copy()
        # Only the latest note stays: older ones answered older questions and only cost tokens.
        ctx.items[:] = [
            i for i in ctx.items
            if not (isinstance(i, llm.ChatMessage) and i.role == "system" and (i.text_content or "").startswith(AUTO_KNOWLEDGE_NOTE[:40]))
        ]
        if found:
            ctx.add_message(role="system", content=AUTO_KNOWLEDGE_NOTE + found)
        # Don't wait for OpenAI to confirm the note (~270 ms): the note's events go out on the same
        # connection before the reply request, so the model has it when it starts answering.
        task = asyncio.ensure_future(self.update_chat_ctx(ctx))
        task.add_done_callback(_log_note_failure)
        await asyncio.wait({task}, timeout=NOTE_SEND_WAIT_S)

    def prefetch_knowledge(self, text: str) -> None:
        """Start the search as soon as the visitor's words are final, before the turn is decided."""
        if self._realtime and self._api is not None and len(text.strip()) >= AUTO_SEARCH_MIN_CHARS:
            self._knowledge_for(text)

    async def stt_node(self, audio, model_settings):  # type: ignore[no-untyped-def]
        """Speech to text without the agent's own voice. Echo words would cut the agent off and become
        visitor turns it answers; without words LiveKit neither interrupts nor ends a turn."""
        interim_passed = False
        audio_started_at = self._audio_started_at()
        async for ev in Agent.default.stt_node(self, self._hear_levels(audio), model_settings):
            if (
                self._echo is not None
                and isinstance(ev, stt.SpeechEvent)
                and ev.type in _TRANSCRIPT_EVENTS
                and ev.alternatives
            ):
                alt = ev.alternatives[0]
                timing = {"started_at": began_at(alt, audio_started_at), "duration": spoken_duration(alt)}
                final = ev.type == stt.SpeechEventType.FINAL_TRANSCRIPT
                if not self._echo.heard(alt.text, final=final, **timing):
                    if ev.type == stt.SpeechEventType.FINAL_TRANSCRIPT:
                        logger.info("ignored the agent's own voice from the visitor's microphone")
                        if self.on_echo is not None:
                            self.on_echo()
                    if interim_passed:
                        # Take back interim words already passed on for this sentence.
                        interim_passed = False
                        yield dataclasses.replace(
                            ev,
                            type=stt.SpeechEventType.INTERIM_TRANSCRIPT,
                            alternatives=[dataclasses.replace(ev.alternatives[0], text="")],
                        )
                    continue
                interim_passed = ev.type != stt.SpeechEventType.FINAL_TRANSCRIPT
                why = self._echo.explain(alt.text, **timing)
                if why is not None:
                    logger.info("visitor words near the agent's speech (%s): %s", ev.type.value, why)
            yield ev

    async def _hear_levels(self, audio):  # type: ignore[no-untyped-def]
        """Passes the visitor's audio on to speech to text, measuring how loud it is on the way."""
        # Speech to text timestamps count audio from when its stream opens, which is now.
        opened = time.time()
        position = 0.0
        cleared_at = 0.0
        async for frame in audio:
            position += frame.samples_per_channel / frame.sample_rate
            if self._echo is not None:
                with contextlib.suppress(Exception):
                    pcm = np.frombuffer(frame.data, dtype=np.int16)
                    if frame.num_channels > 1:
                        pcm = pcm[:: frame.num_channels]
                    self._echo.hear_audio(pcm, frame.sample_rate, opened + position)
                    if self._realtime and position - cleared_at >= 1.0 and self._echo.held_audio_is_echo():
                        cleared_at = position
                        self.realtime_llm_session.clear_audio()
            yield frame

    def _audio_started_at(self) -> float | None:
        """The time speech to text timestamps count from, worked out as LiveKit's own stt node does
        when it opens the stream."""
        try:
            activity = self._get_activity_or_raise()
            recognition = activity._audio_recognition
            if recognition is not None and recognition._input_started_at is not None:
                return float(recognition._input_started_at)
            recorder = activity.session._recorder_io
            if recorder and recorder.recording_started_at:
                return float(recorder.recording_started_at)
            return float(activity.session._started_at) if activity.session._started_at else time.time()
        except Exception:
            return None

    async def transcription_node(self, text, model_settings):  # type: ignore[no-untyped-def]
        async for delta in Agent.default.transcription_node(self, text, model_settings):
            if self._echo is not None:
                self._echo.agent_said(str(delta))
            yield delta

    async def llm_node(self, chat_ctx, tools, model_settings):  # type: ignore[no-untyped-def]
        # Send only the instructions and the recent turns; the full history stays in the session.
        trimmed = chat_ctx.copy().truncate(max_items=MAX_CONTEXT_ITEMS)
        if self._api is not None:
            last_user = next(
                (
                    i
                    for i in range(len(trimmed.items) - 1, -1, -1)
                    if isinstance(trimmed.items[i], llm.ChatMessage) and trimmed.items[i].role == "user"
                ),
                None,
            )
            if last_user is not None:
                text = (trimmed.items[last_user].text_content or "").strip()
                if len(text) >= AUTO_SEARCH_MIN_CHARS:
                    # shield: a cancelled preemptive attempt must not cancel the shared search.
                    found = await asyncio.shield(self._knowledge_for(text))
                    if found:
                        note = llm.ChatMessage(role="system", content=[AUTO_KNOWLEDGE_NOTE + found])
                        trimmed.items.insert(last_user, note)
        async for chunk in Agent.default.llm_node(self, trimmed, tools, model_settings):
            yield chunk


_LATENCY_KEYS = ("end_of_turn_delay", "llm_node_ttft", "tts_node_ttfb", "e2e_latency")
# On the visitor's message: how long after they stopped talking we decided the turn was over.
_VISITOR_TURN_KEYS = ("end_of_turn_delay", "transcription_delay", "on_user_turn_completed_delay")


def _log_turn_latency(report: llm.chat_context.MetricsReport, keys: tuple[str, ...] = _LATENCY_KEYS) -> None:
    """One line per turn: how long the visitor waited and where the time went (seconds)."""
    values = {k: round(v, 3) for k in keys if isinstance(v := report.get(k), (int, float))}
    if values:
        logger.info("%s latency %s", "turn" if keys is _LATENCY_KEYS else "visitor turn", values)


def gate_interruptions(session: AgentSession, echo: EchoGuard) -> bool:
    """LiveKit stops (pauses) the agent on voice activity; with min_words 0 it would stop for the
    agent's own echo too. Let it stop only for the visitor: words that passed the echo filter, or
    speech clearly louder than the echo. Returns False when LiveKit's internals are not as expected
    (then interruptions work as LiveKit's own, without the gate)."""
    activity = getattr(session, "_activity", None)
    original = getattr(activity, "_interrupt_by_audio_activity", None)
    if activity is None or original is None:
        return False

    last = {"reason": ""}
    stopped_for_loudness = {"at": 0.0}

    @session.on("agent_false_interruption")
    def _on_false_interruption(ev) -> None:  # type: ignore[no-untyped-def]
        # Stopped for loudness, but no words came: that loudness was not the visitor.
        if time.time() - stopped_for_loudness["at"] < 5.0:
            echo.loud_was_false()
            logger.info("agent resumed: the loud sound was not the visitor; echo bar raised")

    def gated() -> None:
        recognition = activity._audio_recognition
        has_words = bool(recognition is not None and recognition._current_transcript.strip())
        speaking = activity.current_speech is not None
        loud = echo.visitor_loud_now()
        reason = "words" if has_words else "loud" if loud else ""
        report = speaking and reason != last["reason"] and bool(reason)
        if speaking and reason != last["reason"]:
            last["reason"] = reason
        if speaking and reason == "loud":
            stopped_for_loudness["at"] = time.time()
        if not speaking or has_words or loud:
            original()
        if report:
            speech = activity.current_speech
            logger.info(
                "visitor talking over the agent (%s): stop asked; state=%s paused=%s interrupted=%s "
                "audio_interruption=%s allow=%s",
                reason,
                session.agent_state,
                activity._paused_speech is not None,
                getattr(speech, "interrupted", None),
                activity._interruption_by_audio_activity_enabled,
                getattr(speech, "allow_interruptions", None),
            )

    activity._interrupt_by_audio_activity = gated
    return True


def on_audio_commit(rt_session: llm.RealtimeSession, callback: Callable[[], None], *, server_turns: bool) -> None:
    """Calls `callback` each time the visitor's held audio goes to the realtime model as one message
    (the model transcribes each one). LiveKit's turn detection sends it with commit_audio; with
    OpenAI's own turn detection the server commits when it hears the visitor stop."""
    if server_turns:
        rt_session.on("input_speech_stopped", lambda _ev: callback())
        return
    original = rt_session.commit_audio

    def commit_audio() -> None:
        held = getattr(rt_session, "_pushed_duration_s", None)
        original()
        # The plugin sends nothing while under 100 ms of audio is held: then no message is made.
        if held is None or getattr(rt_session, "_pushed_duration_s", None) != held:
            with contextlib.suppress(Exception):  # never break the turn over a display nicety
                callback()

    rt_session.commit_audio = commit_audio  # type: ignore[method-assign]


def reply_played_s(metrics: llm.chat_context.MetricsReport | None) -> float | None:
    """Seconds of a reply's voice the visitor heard, when LiveKit measured it."""
    started = (metrics or {}).get("started_speaking_at")
    stopped = (metrics or {}).get("stopped_speaking_at")
    if isinstance(started, (int, float)) and isinstance(stopped, (int, float)) and stopped >= started:
        return round(stopped - started, 2)
    return None


def build_session(runtime: RuntimeConfig, proc: JobProcess, *, realtime: bool = False) -> AgentSession:
    agent_cfg = runtime.agent
    if realtime:
        if realtime_turn_spec() != "livekit":
            return AgentSession(llm=build_realtime_model(runtime))
        # Turns come from our side: Silero hears speech, Deepgram turns it into words, the turn
        # detector decides the visitor is done, then the audio goes to the model. No words, no turn.
        stt_cfg = agent_cfg.stt
        english = stt_cfg.language.startswith("en")
        return AgentSession(
            llm=build_realtime_model(runtime),
            stt=deepgram.STT(
                model=stt_cfg.model,
                language=stt_cfg.language,
                keyterm=[*CONTACT_KEYTERMS, *agent_cfg.voice.vocabulary] if english else NOT_GIVEN,
            ),
            vad=proc.userdata.get("vad") or silero.VAD.load(min_silence_duration=VAD_MIN_SILENCE_S),
            turn_handling={
                "turn_detection": MultilingualModel(),
                # At least 0.6 s of quiet before a turn ends: at 0.3 s a natural pause split "How fast do
                # you reply | after I tap the talk button?" into two turns (4 Nov), the first reply was
                # thrown away and the model answered the meaningless tail.
                "endpointing": {"mode": "dynamic", "min_delay": 0.6, "max_delay": 1.3},
                # The visitor's voice stops the agent: real words, or speech clearly louder than the
                # agent's own echo (decided in gate_interruptions; words come a second or two late).
                # Noise and the echo don't, and a stop without words resumes the reply.
                "interruption": {
                    "enabled": True,
                    "min_duration": 0.3,
                    "min_words": 0,
                    "resume_false_interruption": True,
                    "false_interruption_timeout": 1.5,
                },
            },
        )
    if runtime.mode == "text":
        # No STT/TTS/VAD: text arrives on lk.chat, replies go out on lk.transcription.
        return AgentSession(llm=build_llm(runtime), vad=None)

    vad = proc.userdata.get("vad") or silero.VAD.load(min_silence_duration=VAD_MIN_SILENCE_S)
    # Deepgram reads DEEPGRAM_API_KEY; the LLM plugin reads ANTHROPIC_API_KEY or GROQ_API_KEY.
    stt_cfg = agent_cfg.stt
    # Keyterm prompting is a nova-3 feature; only send it for English to avoid rejected requests.
    keyterm = CONTACT_KEYTERMS if stt_cfg.model.startswith("nova-3") and stt_cfg.language.startswith("en") else NOT_GIVEN
    return AgentSession(
        stt=deepgram.STT(model=stt_cfg.model, language=stt_cfg.language, keyterm=keyterm),
        llm=build_llm(runtime),
        tts=deepgram.TTS(model=agent_cfg.tts.voice),
        vad=vad,
        turn_handling={
            "turn_detection": MultilingualModel(),
            "interruption": {"enabled": True},
            # Decide quickly that the visitor has finished: at most 1 s of waiting when the turn
            # detector is unsure (the default 3 s felt like the agent was stuck; calls showed it is
            # unsure on most turns). "dynamic" learns each visitor's pauses during the call.
            "endpointing": {"mode": "dynamic", "min_delay": 0.3, "max_delay": 1.0},
            # Start the likely reply (text and voice) while the end of the turn is still being
            # confirmed. One attempt per turn: every attempt is an LLM request, and rate limits are tight.
            "preemptive_generation": {"enabled": True, "preemptive_tts": True, "max_retries": 1},
        },
    )


def room_options_for(mode: str) -> room_io.RoomOptions:
    common = {
        "text_input": True,  # lk.chat
        "text_output": True,  # lk.transcription
        "close_on_disconnect": True,  # visitor leaving closes the session
        "delete_room_on_close": True,  # rooms are single-use (tf-<conversationId>)
    }
    if mode == "text":
        return room_io.RoomOptions(audio_input=False, audio_output=False, **common)
    return room_io.RoomOptions(audio_input=True, audio_output=True, **common)


def _reason_from_close(reason: CloseReason) -> EndedReason | None:
    if reason == CloseReason.PARTICIPANT_DISCONNECTED:
        return "visitor_left"
    if reason == CloseReason.ERROR:
        return "error"
    if reason in (CloseReason.USER_INITIATED, CloseReason.TASK_COMPLETED):
        return "agent_ended"
    return None  # JOB_SHUTDOWN: decided when finalizing


def _metadata_from_job(ctx: JobContext) -> DispatchMetadata:
    raw = ctx.job.metadata
    if not raw:
        # Local testing (console / connect) has no dispatch metadata.
        raw = os.environ.get("TALKFRONT_DISPATCH_METADATA", "")
    return parse_dispatch_metadata(raw)


_GOODBYE_WORDS = re.compile(
    r"\b(bye|goodbye|good bye|see you|see ya|that'?s all|that is all|that'?ll be all|nothing else|no more|i'?m done|i am done|hang ?up|disconnect|(end|ends|ended|close|cut|stop|finish)( the| this)? (call|chat|conversation)|(call|chat|conversation) (never |doesn'?t |does not |didn'?t )?(end|ends|ended|stop|stops)|"
    r"thanks?|thank you|cheers|khuda ?hafiz|allah ?hafiz|alvida|shukriya|shukria|bas)\b"
    r"|خدا حافظ|اللہ حافظ|شکریہ|الوداع|बाय|धन्यवाद|अलविदा|शुक्रिया|مع السلامة|شكرا|وداعا",
    re.IGNORECASE,
)


def sounds_like_goodbye(*texts: str) -> bool:
    """The visitor's latest words include a goodbye, thanks or a request to end (English, Urdu, Hindi, Arabic)."""
    return any(_GOODBYE_WORDS.search(t or "") for t in texts)


# How long the visitor must be silent before speech counts as paused (silero default 0.55 s).
# The turn detector then decides whether they are done, so this can be short.
VAD_MIN_SILENCE_S = 0.3


def prewarm(proc: JobProcess) -> None:
    proc.userdata["vad"] = silero.VAD.load(min_silence_duration=VAD_MIN_SILENCE_S)
    refresh_openai_health(block=True)


# shutdown_process_timeout: the final flush + /end need a few seconds after the room closes.
# Starting a job process (plugins, onnxruntime, Silero) can take over 10 s on Windows; the default
# 10 s initialize timeout made the first spawn fail and retry.
server = AgentServer(setup_fnc=prewarm, shutdown_process_timeout=25.0, initialize_process_timeout=30.0)


# LIVEKIT_AGENT_NAME lets a dev worker share a LiveKit project with production without taking its calls.
@server.rtc_session(agent_name=os.environ.get("LIVEKIT_AGENT_NAME") or AGENT_NAME)
async def entrypoint(ctx: JobContext) -> None:
    try:
        meta = _metadata_from_job(ctx)
    except ContractError as e:
        logger.error("cannot start: %s", e)
        ctx.shutdown(reason="invalid dispatch metadata")
        return

    ctx.log_context_fields = {"conversation_id": meta.conversation_id, "mode": meta.mode}

    try:
        api = TalkfrontApi(ApiSettings.from_env())
    except InternalApiError as e:
        logger.error("cannot start: %s", e)
        ctx.shutdown(reason="internal api not configured")
        return

    end_reason = EndReason()
    end_once = OnceGuard()
    started_at: float | None = None
    session: AgentSession | None = None
    session_closed = asyncio.Event()
    transcript = TranscriptBuffer(lambda rows: api.append_messages(meta.conversation_id, rows))
    background: list[asyncio.Task[None]] = []

    async def _finalize() -> None:
        for task in background:
            task.cancel()
        if session is not None and not session_closed.is_set():
            # The framework closes the session in its own shutdown callback; give it a moment so
            # the last turns land in the transcript.
            with contextlib.suppress(asyncio.TimeoutError):
                await asyncio.wait_for(session_closed.wait(), SESSION_CLOSE_WAIT_S)
        await transcript.aclose()

        # No recorded reason means the job itself shut down (room closed/emptied), which in
        # practice is the visitor going away.
        reason = end_reason.resolve("visitor_left")
        duration = time.monotonic() - started_at if started_at is not None else 0.0
        try:
            await api.end_conversation(meta.conversation_id, build_end_request(reason, duration))
            logger.info("conversation ended: %s after %ds", reason, round(duration))
        except InternalApiError as e:
            logger.error("could not report conversation end (%s): %s", reason, e)
        finally:
            await api.aclose()

    async def finalize(_shutdown_reason: str = "") -> None:
        await end_once.run(_finalize)

    ctx.add_shutdown_callback(finalize)

    try:
        runtime = await api.get_runtime(meta.conversation_id)
    except InternalApiError as e:
        logger.error("runtime config fetch failed, leaving the room: %s", e)
        end_reason.set("error")
        ctx.shutdown(reason="runtime config unavailable")
        return

    if runtime.mode != meta.mode:
        logger.warning("dispatch mode %s differs from runtime mode %s; using runtime", meta.mode, runtime.mode)

    last_visitor_text = {"text": "", "previous": ""}
    realtime = use_realtime(runtime)
    session = build_session(runtime, ctx.proc, realtime=realtime)
    logger.info("voice engine: %s", "realtime" if realtime else "classic" if runtime.mode == "voice" else "text")

    def speak(text: str, *, allow_interruptions: bool = True):  # type: ignore[no-untyped-def]
        """Say a fixed sentence. A realtime model has no separate voice, so it is asked to say it.
        With server-side turn detection every reply must stay interruptible."""
        if realtime:
            return session.generate_reply(instructions=f'Say exactly this, word for word, and nothing else: "{text}"')
        return session.say(text, allow_interruptions=allow_interruptions)

    turns = TurnCounter()
    activity = {"any": time.monotonic(), "user": time.monotonic()}

    def _touch(by_user: bool) -> None:
        now = time.monotonic()
        activity["any"] = now
        if by_user:
            activity["user"] = now

    # Realtime transcripts arrive after the model has already started answering, so tools that need
    # "the visitor replied" (confirm_message, end_call) would lag a turn. Count the turn when they speak.
    speech_turns = {"started": 0, "transcribed": 0}
    transcript_arrived = asyncio.Event()
    # Realtime: the visitor's transcript can arrive after the agent has started answering. Save it at
    # the moment they stopped talking, so the saved conversation reads in the order it was spoken.
    last_speech_end = {"t": 0.0, "used": 0.0}
    # Voice activity alone is not the visitor speaking: the agent's own voice from their speakers
    # sets it off too. Their speech counts once speech to text hears their words (not echo).
    echo = EchoGuard()
    visitor_speech = {"speaking": False, "words": False, "ended_at": 0.0}

    @session.on("user_state_changed")
    def _on_user_state(ev: UserStateChangedEvent) -> None:
        if ev.new_state == "speaking":
            visitor_speech.update(speaking=True, words=False)
        elif ev.old_state == "speaking":
            visitor_speech.update(speaking=False, ended_at=time.time())
            if visitor_speech["words"]:
                last_speech_end["t"] = visitor_speech["ended_at"]

    def _on_visitor_words() -> None:
        if visitor_speech["words"]:
            return
        visitor_speech["words"] = True
        if not visitor_speech["speaking"]:
            # The words came in after the voice activity ended.
            last_speech_end["t"] = visitor_speech["ended_at"]
        _touch(by_user=True)
        if realtime:
            turns.user_turn()
            speech_turns["started"] += 1
            transcript_arrived.clear()

    echo.on_visitor_words = _on_visitor_words

    def _clear_echo_audio() -> None:
        """Realtime: drop the agent's own voice the microphone picked up, so the model doesn't hear
        it again in front of the visitor's next words."""
        with contextlib.suppress(Exception):
            agent.realtime_llm_session.clear_audio()

    @session.on("agent_state_changed")
    def _on_agent_state_for_echo(ev) -> None:  # type: ignore[no-untyped-def]
        echo.set_agent_speaking(ev.new_state == "speaking")
        if realtime and ev.old_state == "speaking" and echo.visitor_silent_while_agent_spoke():
            _clear_echo_audio()

    def _on_echo() -> None:
        # A sentence of echo, and the visitor said nothing lately: the held audio is only echo.
        if realtime and time.time() - echo.last_visitor_words_at > ECHO_CLEAR_AFTER_S and not echo.visitor_loud_now():
            _clear_echo_audio()

    @session.on("agent_state_changed")
    def _on_agent_speaking(ev) -> None:  # type: ignore[no-untyped-def]
        done = getattr(agent, "turn_done_at", None)
        if realtime and ev.new_state == "speaking" and done:
            logger.info("realtime reply started %.0f ms after the turn ended", (time.monotonic() - done) * 1000)
            agent.turn_done_at = None

    # Notices to the widget still being sent (kept so they are not garbage collected half way).
    notices: set[asyncio.Task[None]] = set()

    def _show_reply_cut(item: llm.ChatMessage) -> None:
        """The visitor talked over this reply and it stopped part way. Its bubble looked like any
        finished reply, so the next one read as the agent changing its mind mid-sentence: tell the
        widget, which marks it as cut or takes it away when it was barely heard."""
        text = (item.text_content or "").strip()
        try:
            visitor = session.room_io.linked_participant
        except Exception:
            visitor = None
        if not text or visitor is None:
            return
        payload: dict[str, object] = {"text": text}
        played = reply_played_s(item.metrics)
        if played is not None:
            payload["played_s"] = played
        task = asyncio.ensure_future(send_json(ctx.room, visitor.identity, TOPIC_REPLY_CUT, payload))
        notices.add(task)
        task.add_done_callback(notices.discard)

    @session.on("conversation_item_added")
    def _on_item(ev: ConversationItemAddedEvent) -> None:
        item = ev.item
        if isinstance(item, llm.ChatMessage) and item.role in ("user", "assistant"):
            _touch(by_user=item.role == "user")
            # Voice only: replies are shown as they are spoken, so a cut one stops on screen too.
            if item.role == "assistant" and item.interrupted and runtime.mode == "voice":
                _show_reply_cut(item)
            if item.role == "user":
                turns.user_turn()
                last_visitor_text["previous"] = last_visitor_text["text"]
                last_visitor_text["text"] = item.text_content or ""
                speech_turns["transcribed"] = speech_turns["started"]
                transcript_arrived.set()
            text = item.text_content
            created_at = item.created_at
            ended = last_speech_end["t"]
            if item.role == "user" and realtime and ended > last_speech_end["used"]:
                created_at = min(created_at, ended)
                last_speech_end["used"] = ended
            if text:
                transcript.add(item.role, text, created_at)
            if item.metrics:
                _log_turn_latency(item.metrics, _LATENCY_KEYS if item.role == "assistant" else _VISITOR_TURN_KEYS)

    @session.on("function_tools_executed")
    def _on_tools(ev: FunctionToolsExecutedEvent) -> None:
        for call, output in ev.zipped():
            transcript.add(
                "tool",
                describe_tool_call(
                    call.name,
                    call.arguments,
                    output.output if output is not None else None,
                    output.is_error if output is not None else False,
                ),
                call.created_at,
            )

    @session.on("close")
    def _on_close(ev: CloseEvent) -> None:
        session_closed.set()
        mapped = _reason_from_close(ev.reason)
        if mapped is not None:
            end_reason.set(mapped)
        if ev.error is not None:
            logger.error("session closed with error: %s", ev.error)
        ctx.shutdown(reason=f"session closed: {ev.reason.value}")

    draft = HandoffDraft(turns)
    end_call_blocked_at_turn = -1

    async def _end_call(ctx: RunContext) -> str:
        nonlocal end_call_blocked_at_turn
        # A message the visitor wanted to leave must not be lost: refuse once per visitor turn while
        # it is prepared but unsent. If they say they don't want it, the next call ends the conversation.
        # Realtime: the words that prompted this may not be transcribed yet; give them a moment.
        if realtime and speech_turns["transcribed"] < speech_turns["started"]:
            with contextlib.suppress(asyncio.TimeoutError):
                await asyncio.wait_for(transcript_arrived.wait(), END_CALL_TRANSCRIPT_WAIT_S)
        # Models sometimes end a call on "Hi, can you hear me?": only end after the visitor's own goodbye.
        # The goodbye may be one turn back ("thank you so much" ... "so the call never ends?").
        if not sounds_like_goodbye(last_visitor_text["text"], last_visitor_text["previous"]):
            logger.info("end_call refused: the visitor did not say goodbye")
            return "Not ended: the visitor has not said goodbye. Don't end the conversation; answer what they said."
        if draft.pending and end_call_blocked_at_turn != turns.user_turns:
            end_call_blocked_at_turn = turns.user_turns
            logger.info("end_call refused: a prepared message is not sent yet")
            return (
                "Not ended yet: the message for the team is prepared but not sent. In one short, friendly "
                "sentence, ask whether you should send it before they go (don't say you can't send it or can't "
                "end the call). If they say yes, call confirm_message and then end_call; if no, call end_call again."
            )
        end_reason.set("agent_ended")
        logger.info("agent is ending the conversation")
        # The goodbye is spoken on this same speech handle; close once it has played. The room is
        # deleted on close, so the widget shows the conversation as ended.
        ctx.speech_handle.add_done_callback(
            lambda _: asyncio.get_running_loop().call_later(GOODBYE_GRACE_S, session.shutdown)
        )
        return "Say a short, warm goodbye in one sentence."

    end_call = function_tool(
        _end_call,
        name="end_call",
        description=(
            "End the conversation. Use it when the visitor says goodbye, thanks you and has nothing else, or "
            "asks you to hang up or end the chat. After calling it, say one short goodbye; nothing else."
        ),
    )

    agent = TalkfrontAgent(
        instructions=runtime.agent.system_prompt,
        tools=[*build_tools(api, runtime, turns, draft), end_call],
        api=api,
        conversation_id=runtime.conversation_id,
        realtime=realtime,
        echo=echo if runtime.mode == "voice" else None,
    )
    agent.on_echo = _on_echo
    # The first knowledge search of a call is slow (about 650 ms against 60 to 100 ms later: cold
    # connections and a cold serverless function). Do one now, while the visitor is still joining.
    agent.prefetch_knowledge(WARMUP_QUERY)

    joined_at = time.time()
    try:
        # record=False: LiveKit Cloud keeps no audio, transcripts or traces of calls, whatever the project
        # setting says (the Privacy Policy promises we don't record call audio).
        await session.start(agent=agent, room=ctx.room, room_options=room_options_for(runtime.mode), record=False)
    except Exception:
        logger.exception("session failed to start")
        end_reason.set("error")
        ctx.shutdown(reason="session start failed")
        return

    transcript.start()
    if realtime and realtime_turn_spec() == "livekit" and not gate_interruptions(session, echo):
        logger.warning("interruption gate not installed: the agent's echo may cut its replies")

    # Replies go to the visitor RoomIO is linked to, so wait for that link before greeting. If the
    # visitor never arrives (closed the page while we joined), leave without billing anything.
    def _visitor_linked() -> bool:
        try:
            return session.room_io.linked_participant is not None
        except Exception:
            return True  # can't tell; don't end the call over it

    deadline = time.monotonic() + VISITOR_LINK_TIMEOUT_S
    while not _visitor_linked() and time.monotonic() < deadline:
        await asyncio.sleep(0.05)
    if not _visitor_linked():
        logger.info("visitor never joined within %ds; leaving", VISITOR_LINK_TIMEOUT_S)
        end_reason.set("visitor_left")
        ctx.shutdown(reason="visitor never joined")
        return

    if realtime:
        stt_language = runtime.agent.stt.language
        captions = LiveCaptions(
            ctx.room,
            language=stt_language,
            keyterms=list(runtime.agent.voice.vocabulary) if stt_language.startswith("en") else [],
            on_final=agent.prefetch_knowledge,
            is_echo=echo.is_echo,
        )
        try:
            captions.start(session.room_io.linked_participant)  # type: ignore[arg-type]
            if captions._task is not None:
                background.append(captions._task)
            # A caption turn ends exactly when the model gets that audio as a message, so caption turn n
            # and the model's transcript n are the same words (one visitor bubble, parts in order).
            on_audio_commit(
                agent.realtime_llm_session, captions.committed, server_turns=realtime_turn_spec() != "livekit"
            )
        except Exception as e:
            logger.warning("live captions not started: %s", type(e).__name__)

    started_at = time.monotonic()
    greeting = runtime.agent.greeting.strip()
    if greeting and runtime.mode == "text":
        # A text chat starts with the visitor's first message, and the widget already shows the
        # greeting above it. Saying it now would land after their question, so only record it.
        transcript.add("assistant", greeting, joined_at)
    elif greeting and meta.greeting_played:
        # The widget played this greeting from its own copy the moment the visitor tapped Talk (the call
        # takes 2 to 5 s to connect). Don't say it again: record it and tell the model it was said.
        transcript.add("assistant", greeting, joined_at)
        said = agent.chat_ctx.copy()
        said.add_message(role="assistant", content=greeting)
        told = asyncio.ensure_future(agent.update_chat_ctx(said))
        told.add_done_callback(
            lambda t: t.cancelled()
            or t.exception() is None
            or logger.warning("model not told about the widget's greeting: %s", type(t.exception()).__name__)
        )
    elif greeting:
        voice = runtime.agent.voice.realtime_voice
        audio = greeting_cache.cached(voice, greeting) if realtime else None
        if audio is not None:
            # Ready-made audio: the visitor hears the greeting at once instead of after the model
            # has been asked to say it (about 2 s).
            handle = session.say(greeting, audio=greeting_cache.frames(audio))

            def _greeting_said(_handle) -> None:  # type: ignore[no-untyped-def]
                # The model did not say it itself; tell it, so its first answer doesn't greet again.
                task = asyncio.ensure_future(agent.update_chat_ctx(agent.chat_ctx))
                task.add_done_callback(
                    lambda t: t.cancelled()
                    or t.exception() is None
                    or logger.warning("model not told about the greeting: %s", type(t.exception()).__name__)
                )

            handle.add_done_callback(_greeting_said)
        else:
            speak(greeting)
            if realtime:
                greeting_cache.make_in_background(voice, greeting)

    async def _max_duration_watch(limit: int) -> None:
        await asyncio.sleep(limit)
        if not end_reason.set("max_duration"):
            return
        logger.info("max duration of %ds reached, saying goodbye", limit)
        try:
            handle = speak(GOODBYE_TEXT, allow_interruptions=False)
            await asyncio.wait_for(handle.wait_for_playout(), GOODBYE_PLAYOUT_TIMEOUT_S)
        except Exception as e:  # the session may already be closing
            logger.warning("goodbye was not delivered: %s", e)
        session.shutdown(drain=True)

    background.append(
        asyncio.create_task(_max_duration_watch(runtime.agent.max_duration_sec), name="talkfront_max_duration")
    )

    async def _idle_watch(check_in_after: float, end_after: float) -> None:
        checked_in_at: float | None = None
        while True:
            await asyncio.sleep(2)
            if end_reason.value is not None:
                return  # ending already (goodbye, time limit): no more check-ins
            if getattr(session, "agent_state", None) in ("speaking", "thinking"):
                _touch(by_user=False)  # a long answer is not the visitor being idle
                continue
            now = time.monotonic()
            if checked_in_at is not None and activity["user"] > checked_in_at:
                checked_in_at = None  # the visitor came back
            idle = now - activity["any"]
            if checked_in_at is None and idle >= check_in_after:
                checked_in_at = now
                speak(STILL_THERE_TEXT)
            elif checked_in_at is not None and idle >= end_after:
                if not end_reason.set("visitor_left"):
                    return
                logger.info("visitor idle; ending the conversation")
                try:
                    handle = speak(IDLE_GOODBYE_TEXT, allow_interruptions=False)
                    await asyncio.wait_for(handle.wait_for_playout(), GOODBYE_PLAYOUT_TIMEOUT_S)
                except Exception as e:  # the session may already be closing
                    logger.warning("idle goodbye was not delivered: %s", e)
                session.shutdown(drain=True)
                return

    background.append(asyncio.create_task(_idle_watch(*IDLE_LIMITS_S[runtime.mode]), name="talkfront_idle"))
