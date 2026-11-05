"""Internal API client (agent -> web) and the shapes it exchanges.

These types mirror ``packages/shared/src/contracts.ts`` by hand (see docs/contracts.md, section 2).
Change both sides together.

Logging rule: log method, path, status and timing only. Never log the bearer secret, prompts,
search queries, knowledge content or transcript text at info level.
"""

from __future__ import annotations

import json
import logging
import os
import time
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any, Literal, NotRequired, TypedDict, cast, get_args
from urllib.parse import quote

import httpx

logger = logging.getLogger("talkfront.api")

AGENT_NAME = "talkfront-agent"
TOPIC_CHAT = "lk.chat"
TOPIC_TRANSCRIPTION = "lk.transcription"

ConversationMode = Literal["voice", "text"]
MessageRole = Literal["user", "assistant", "tool", "system"]
EndedReason = Literal["visitor_left", "agent_ended", "max_duration", "out_of_credit", "error"]

_MODES: tuple[str, ...] = get_args(ConversationMode)
ENDED_REASONS: tuple[str, ...] = get_args(EndedReason)

# Limits copied from the zod schemas.
MAX_MESSAGE_CONTENT = 20_000
MAX_MESSAGES_PER_BATCH = 100
MAX_QUERY_LEN = 500
MAX_SEARCH_LIMIT = 8
EMBEDDING_DIMENSIONS = 384  # packages/shared/src/constants.ts
MAX_HANDOFF_MESSAGE = 4000
MAX_HANDOFF_NAME = 200
MAX_HANDOFF_EMAIL = 320
MAX_HANDOFF_PHONE = 50

RUNTIME_TIMEOUT_S = 5.0
SEARCH_TIMEOUT_S = 3.0
WRITE_TIMEOUT_S = 4.0
# The web app gives the business's URL at most 15 s (docs/integrations.md §4), plus time for itself.
ACTION_TIMEOUT_S = 20.0


class ContractError(ValueError):
    """A payload did not match the shared contract."""


# ---------------------------------------------------------------------------
# DispatchMetadata (LiveKit dispatch metadata JSON)
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class DispatchMetadata:
    conversation_id: str
    agent_id: str
    organization_id: str
    mode: ConversationMode
    # The widget already played the greeting (its own audio copy) while the call connected.
    greeting_played: bool = False


def parse_dispatch_metadata(raw: str | bytes | None) -> DispatchMetadata:
    """Parse the JSON the web app puts in ``roomConfig.agents[].metadata``."""
    if not raw:
        raise ContractError("dispatch metadata is empty")
    try:
        data = json.loads(raw)
    except (TypeError, ValueError) as e:
        raise ContractError(f"dispatch metadata is not valid JSON: {e.__class__.__name__}") from None
    if not isinstance(data, dict):
        raise ContractError("dispatch metadata must be a JSON object")

    def req_str(key: str) -> str:
        value = data.get(key)
        if not isinstance(value, str) or not value:
            raise ContractError(f"dispatch metadata field '{key}' must be a non-empty string")
        return value

    mode = req_str("mode")
    if mode not in _MODES:
        raise ContractError(f"dispatch metadata field 'mode' must be one of {_MODES}")
    return DispatchMetadata(
        conversation_id=req_str("conversationId"),
        agent_id=req_str("agentId"),
        organization_id=req_str("organizationId"),
        mode=cast(ConversationMode, mode),
        greeting_played=data.get("greetingPlayed") is True,
    )


# ---------------------------------------------------------------------------
# RuntimeConfig (GET /api/internal/runtime/:conversationId)
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class SttConfig:
    provider: Literal["deepgram"]
    model: str
    language: str


LlmProvider = Literal["anthropic", "groq", "openai"]
_LLM_PROVIDERS: tuple[str, ...] = ("anthropic", "groq", "openai")


@dataclass(frozen=True)
class LlmConfig:
    provider: LlmProvider
    model: str
    temperature: float


@dataclass(frozen=True)
class TtsConfig:
    provider: Literal["deepgram"]
    voice: str


@dataclass(frozen=True)
class VoiceConfig:
    """Voice calls: "realtime" = one OpenAI speech-to-speech model; "classic" = stt -> llm -> tts."""

    engine: Literal["realtime", "classic"] = "classic"
    realtime_model: str = "gpt-realtime-2.1-mini"
    realtime_voice: str = "marin"
    # Names to recognise in speech (business and agent name).
    vocabulary: tuple[str, ...] = ()


@dataclass(frozen=True)
class AgentRuntime:
    id: str
    name: str
    greeting: str
    system_prompt: str
    stt: SttConfig
    llm: LlmConfig
    tts: TtsConfig
    max_duration_sec: int
    handoff_enabled: bool
    voice: VoiceConfig = field(default_factory=VoiceConfig)


AttributeValue = str | int | float | bool


@dataclass(frozen=True)
class VisitorInfo:
    id: str | None
    name: str | None
    email: str | None
    # True when the fields came from a valid identity token (the business vouches for them).
    verified: bool = False
    attributes: dict[str, AttributeValue] = field(default_factory=dict)


@dataclass(frozen=True)
class ActionSpec:
    """One of the business's HTTP actions. No URL or headers: the web app makes the call."""

    id: str
    name: str
    description: str
    # JSON Schema (type "object") for the arguments.
    parameters: dict[str, Any]


@dataclass(frozen=True)
class RuntimeConfig:
    conversation_id: str
    mode: ConversationMode
    agent: AgentRuntime
    visitor: VisitorInfo
    actions: tuple[ActionSpec, ...] = ()


def _obj(data: Any, path: str) -> dict[str, Any]:
    if not isinstance(data, dict):
        raise ContractError(f"'{path}' must be an object")
    return data


def _str(data: dict[str, Any], key: str, path: str, *, allow_empty: bool = True) -> str:
    value = data.get(key)
    if not isinstance(value, str) or (not allow_empty and not value):
        raise ContractError(f"'{path}.{key}' must be a string")
    return value


def _nullable_str(data: dict[str, Any], key: str, path: str) -> str | None:
    value = data.get(key)
    if value is not None and not isinstance(value, str):
        raise ContractError(f"'{path}.{key}' must be a string or null")
    return value


def _literal(data: dict[str, Any], key: str, path: str, allowed: tuple[str, ...]) -> str:
    value = data.get(key)
    if value not in allowed:
        raise ContractError(f"'{path}.{key}' must be one of {allowed}")
    return cast(str, value)


def parse_runtime_config(data: Any) -> RuntimeConfig:
    root = _obj(data, "runtime")
    agent = _obj(root.get("agent"), "agent")
    stt = _obj(agent.get("stt"), "agent.stt")
    llm = _obj(agent.get("llm"), "agent.llm")
    tts = _obj(agent.get("tts"), "agent.tts")
    visitor = _obj(root.get("visitor"), "visitor")

    temperature = llm.get("temperature")
    if isinstance(temperature, bool) or not isinstance(temperature, (int, float)):
        raise ContractError("'agent.llm.temperature' must be a number")
    if not 0 <= temperature <= 1:
        raise ContractError("'agent.llm.temperature' must be between 0 and 1")

    max_duration = agent.get("maxDurationSec")
    if isinstance(max_duration, bool) or not isinstance(max_duration, int) or max_duration <= 0:
        raise ContractError("'agent.maxDurationSec' must be a positive integer")

    handoff = agent.get("handoffEnabled")
    if not isinstance(handoff, bool):
        raise ContractError("'agent.handoffEnabled' must be a boolean")

    return RuntimeConfig(
        conversation_id=_str(root, "conversationId", "runtime", allow_empty=False),
        mode=cast(ConversationMode, _literal(root, "mode", "runtime", _MODES)),
        agent=AgentRuntime(
            id=_str(agent, "id", "agent", allow_empty=False),
            name=_str(agent, "name", "agent"),
            greeting=_str(agent, "greeting", "agent"),
            system_prompt=_str(agent, "systemPrompt", "agent"),
            stt=SttConfig(
                provider=cast(Literal["deepgram"], _literal(stt, "provider", "agent.stt", ("deepgram",))),
                model=_str(stt, "model", "agent.stt", allow_empty=False),
                language=_str(stt, "language", "agent.stt", allow_empty=False),
            ),
            llm=LlmConfig(
                provider=cast(LlmProvider, _literal(llm, "provider", "agent.llm", _LLM_PROVIDERS)),
                model=_str(llm, "model", "agent.llm", allow_empty=False),
                temperature=float(temperature),
            ),
            tts=TtsConfig(
                provider=cast(Literal["deepgram"], _literal(tts, "provider", "agent.tts", ("deepgram",))),
                voice=_str(tts, "voice", "agent.tts", allow_empty=False),
            ),
            max_duration_sec=max_duration,
            handoff_enabled=handoff,
            voice=_parse_voice(agent.get("voice")),
        ),
        visitor=VisitorInfo(
            id=_nullable_str(visitor, "id", "visitor"),
            name=_nullable_str(visitor, "name", "visitor"),
            email=_nullable_str(visitor, "email", "visitor"),
            verified=visitor.get("verified") is True,
            attributes=_parse_attributes(visitor.get("attributes")),
        ),
        actions=_parse_actions(root.get("actions")),
    )


def _parse_voice(value: Any) -> VoiceConfig:
    """Lenient: an older web app sends no voice block, which means the classic engine."""
    if not isinstance(value, dict):
        return VoiceConfig()
    engine = value.get("engine")
    model = value.get("realtimeModel")
    voice = value.get("realtimeVoice")
    words = value.get("vocabulary")
    vocabulary = tuple(w.strip()[:60] for w in words if isinstance(w, str) and w.strip())[:10] if isinstance(words, list) else ()
    return VoiceConfig(
        vocabulary=vocabulary,
        engine="realtime" if engine == "realtime" else "classic",
        realtime_model=model if isinstance(model, str) and model else VoiceConfig.realtime_model,
        realtime_voice=voice if isinstance(voice, str) and voice else VoiceConfig.realtime_voice,
    )


def _parse_attributes(value: Any) -> dict[str, AttributeValue]:
    """Flat facts about a signed-in visitor. Anything that is not a plain value is dropped."""
    if not isinstance(value, dict):
        return {}
    return {
        k: v
        for k, v in value.items()
        if isinstance(k, str) and isinstance(v, (str, int, float, bool))
    }


def _parse_actions(value: Any) -> tuple[ActionSpec, ...]:
    """Lenient on purpose: one malformed action is skipped (and logged), the call still starts."""
    if value is None:
        return ()
    if not isinstance(value, list):
        logger.warning("runtime 'actions' is not a list; ignoring it")
        return ()
    out: list[ActionSpec] = []
    for i, item in enumerate(value):
        if not isinstance(item, dict):
            logger.warning("runtime actions[%d] is not an object; skipped", i)
            continue
        action_id, name = item.get("id"), item.get("name")
        description, parameters = item.get("description"), item.get("parameters")
        if not (isinstance(action_id, str) and action_id and isinstance(name, str) and name):
            logger.warning("runtime actions[%d] has no id or name; skipped", i)
            continue
        if not isinstance(parameters, dict):
            parameters = {"type": "object", "properties": {}}
        out.append(
            ActionSpec(
                id=action_id,
                name=name,
                description=description if isinstance(description, str) else "",
                parameters=parameters,
            )
        )
    return tuple(out)


# ---------------------------------------------------------------------------
# Request / response shapes (wire format, camelCase like the TS contracts)
# ---------------------------------------------------------------------------


class KnowledgeSearchRequest(TypedDict):
    conversationId: str
    query: str
    limit: int
    # Query vector from the embedder (EMBEDDING_DIMENSIONS numbers); turns on semantic search.
    embedding: NotRequired[list[float]]


class KnowledgeResult(TypedDict):
    chunkId: str
    sourceId: str
    title: str
    url: str | None
    content: str
    score: float


class KnowledgeSearchResponse(TypedDict):
    results: list[KnowledgeResult]


class TranscriptMessage(TypedDict):
    role: MessageRole
    content: str
    createdAt: str


class AppendMessagesRequest(TypedDict):
    messages: list[TranscriptMessage]


class HandoffRequest(TypedDict):
    message: str
    name: NotRequired[str]
    email: NotRequired[str]
    phone: NotRequired[str]


class EndConversationRequest(TypedDict):
    endedReason: EndedReason
    durationSec: int


class RunActionRequest(TypedDict):
    arguments: dict[str, Any]


class RunActionResponse(TypedDict):
    # False when the call failed (network, timeout, non-2xx); `result` then explains in plain words.
    ok: bool
    status: int | None
    result: str


def parse_run_action_response(data: Any) -> RunActionResponse:
    root = _obj(data, "action")
    ok = root.get("ok")
    if not isinstance(ok, bool):
        raise ContractError("'action.ok' must be a boolean")
    status = root.get("status")
    if isinstance(status, bool) or (status is not None and not isinstance(status, int)):
        raise ContractError("'action.status' must be an integer or null")
    return {"ok": ok, "status": status, "result": _str(root, "result", "action")}


def iso_utc(ts: float | None = None) -> str:
    """Timestamp in the form zod's ``z.string().datetime()`` accepts (UTC, ``Z`` suffix)."""
    dt = datetime.fromtimestamp(ts if ts is not None else time.time(), tz=UTC)
    return dt.isoformat(timespec="milliseconds").replace("+00:00", "Z")


def make_message(role: MessageRole, content: str, created_at: float | None = None) -> TranscriptMessage:
    if len(content) > MAX_MESSAGE_CONTENT:
        content = content[: MAX_MESSAGE_CONTENT - 1] + "…"
    return {"role": role, "content": content, "createdAt": iso_utc(created_at)}


def build_search_request(
    conversation_id: str, query: str, limit: int = 5, embedding: list[float] | None = None
) -> KnowledgeSearchRequest:
    query = " ".join(query.split())[:MAX_QUERY_LEN]
    if not query:
        raise ContractError("query must not be empty")
    body: KnowledgeSearchRequest = {
        "conversationId": conversation_id,
        "query": query,
        "limit": max(1, min(MAX_SEARCH_LIMIT, int(limit))),
    }
    # A vector of the wrong size would fail validation and lose the whole search: send text only.
    if embedding is not None and len(embedding) == EMBEDDING_DIMENSIONS:
        body["embedding"] = embedding
    return body


def build_handoff_request(
    message: str,
    *,
    name: str | None = None,
    email: str | None = None,
    phone: str | None = None,
) -> HandoffRequest:
    message = message.strip()[:MAX_HANDOFF_MESSAGE]
    if not message:
        raise ContractError("handoff message must not be empty")
    req: HandoffRequest = {"message": message}
    # zod .optional() accepts a missing key, not null: only send fields that have a value.
    if name and name.strip():
        req["name"] = name.strip()[:MAX_HANDOFF_NAME]
    if email and email.strip():
        req["email"] = email.strip()[:MAX_HANDOFF_EMAIL]
    if phone and phone.strip():
        req["phone"] = phone.strip()[:MAX_HANDOFF_PHONE]
    return req


def build_end_request(reason: EndedReason, duration_sec: float) -> EndConversationRequest:
    if reason not in ENDED_REASONS:
        raise ContractError(f"unknown ended reason {reason!r}")
    return {"endedReason": reason, "durationSec": max(0, int(round(duration_sec)))}


def parse_search_response(data: Any) -> KnowledgeSearchResponse:
    root = _obj(data, "search")
    results = root.get("results")
    if not isinstance(results, list):
        raise ContractError("'search.results' must be an array")
    out: list[KnowledgeResult] = []
    for i, r in enumerate(results):
        item = _obj(r, f"results[{i}]")
        score = item.get("score", 0)
        out.append(
            {
                "chunkId": _str(item, "chunkId", f"results[{i}]"),
                "sourceId": _str(item, "sourceId", f"results[{i}]"),
                "title": _str(item, "title", f"results[{i}]"),
                "url": _nullable_str(item, "url", f"results[{i}]"),
                "content": _str(item, "content", f"results[{i}]"),
                "score": float(score) if isinstance(score, (int, float)) else 0.0,
            }
        )
    return {"results": out}


# ---------------------------------------------------------------------------
# HTTP client
# ---------------------------------------------------------------------------


class InternalApiError(Exception):
    """The internal API answered with an error, or could not be reached."""

    def __init__(self, message: str, *, status: int | None = None, code: str | None = None):
        super().__init__(message)
        self.status = status
        self.code = code


@dataclass(frozen=True)
class ApiSettings:
    base_url: str
    secret: str

    @classmethod
    def from_env(cls) -> ApiSettings:
        base_url = os.environ.get("TALKFRONT_API_URL", "").strip().rstrip("/")
        secret = os.environ.get("INTERNAL_API_SECRET", "").strip()
        missing = [
            name
            for name, value in (("TALKFRONT_API_URL", base_url), ("INTERNAL_API_SECRET", secret))
            if not value
        ]
        if missing:
            raise InternalApiError(f"missing environment variables: {', '.join(missing)}")
        return cls(base_url=base_url, secret=secret)


# "Network error" retry policy:
#  - idempotent calls (GET runtime, POST search, POST end) retry once on any transport error;
#  - non-idempotent writes (messages, handoff) retry once only when the request never left
#    (connect errors), so a slow-but-delivered batch is not stored twice.
_CONNECT_ERRORS = (httpx.ConnectError, httpx.ConnectTimeout)


class TalkfrontApi:
    def __init__(
        self,
        settings: ApiSettings,
        *,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._client = httpx.AsyncClient(
            base_url=settings.base_url,
            headers={
                "Authorization": f"Bearer {settings.secret}",
                "Accept": "application/json",
                "User-Agent": "talkfront-agent/0.1",
            },
            timeout=httpx.Timeout(WRITE_TIMEOUT_S),
            transport=transport,
        )

    async def aclose(self) -> None:
        await self._client.aclose()

    async def __aenter__(self) -> TalkfrontApi:
        return self

    async def __aexit__(self, *exc: object) -> None:
        await self.aclose()

    @staticmethod
    def _conv_path(conversation_id: str, suffix: str) -> str:
        return f"/api/internal/conversations/{quote(conversation_id, safe='')}/{suffix}"

    async def _request(
        self,
        method: str,
        path: str,
        *,
        json_body: Any = None,
        timeout: float,
        idempotent: bool,
    ) -> httpx.Response:
        retry_on = (httpx.TransportError,) if idempotent else _CONNECT_ERRORS
        attempts = 2
        for attempt in range(1, attempts + 1):
            started = time.perf_counter()
            try:
                resp = await self._client.request(method, path, json=json_body, timeout=timeout)
            except retry_on as e:
                elapsed = (time.perf_counter() - started) * 1000
                if attempt < attempts:
                    logger.warning(
                        "internal api %s %s network error (%s) after %.0f ms, retrying",
                        method, path, e.__class__.__name__, elapsed,
                    )
                    continue
                logger.error(
                    "internal api %s %s failed: %s after %.0f ms",
                    method, path, e.__class__.__name__, elapsed,
                )
                raise InternalApiError(f"{method} {path} failed: {e.__class__.__name__}") from e
            except httpx.TransportError as e:
                logger.error("internal api %s %s failed: %s", method, path, e.__class__.__name__)
                raise InternalApiError(f"{method} {path} failed: {e.__class__.__name__}") from e

            elapsed = (time.perf_counter() - started) * 1000
            if resp.is_success:
                logger.debug("internal api %s %s -> %d (%.0f ms)", method, path, resp.status_code, elapsed)
                return resp

            code, message = _error_details(resp)
            logger.error(
                "internal api %s %s -> %d %s (%.0f ms)", method, path, resp.status_code, code or "", elapsed
            )
            raise InternalApiError(
                f"{method} {path} -> {resp.status_code}: {message or code or 'error'}",
                status=resp.status_code,
                code=code,
            )
        raise AssertionError("unreachable")

    @staticmethod
    def _json(resp: httpx.Response, what: str) -> Any:
        try:
            return resp.json()
        except ValueError:
            raise InternalApiError(f"{what}: response is not JSON", status=resp.status_code) from None

    async def get_runtime(self, conversation_id: str) -> RuntimeConfig:
        path = f"/api/internal/runtime/{quote(conversation_id, safe='')}"
        resp = await self._request("GET", path, timeout=RUNTIME_TIMEOUT_S, idempotent=True)
        try:
            return parse_runtime_config(self._json(resp, "runtime"))
        except ContractError as e:
            logger.error("runtime config does not match the contract: %s", e)
            raise InternalApiError(f"invalid runtime config: {e}") from e

    async def search_knowledge(
        self, conversation_id: str, query: str, limit: int = 5, embedding: list[float] | None = None
    ) -> KnowledgeSearchResponse:
        body = build_search_request(conversation_id, query, limit, embedding)
        resp = await self._request(
            "POST", "/api/internal/knowledge/search", json_body=body, timeout=SEARCH_TIMEOUT_S, idempotent=True
        )
        try:
            return parse_search_response(self._json(resp, "search"))
        except ContractError as e:
            raise InternalApiError(f"invalid search response: {e}") from e

    async def append_messages(self, conversation_id: str, messages: list[TranscriptMessage]) -> None:
        """POST one or more batches (at most 100 messages each). Expects 204."""
        for start in range(0, len(messages), MAX_MESSAGES_PER_BATCH):
            body: AppendMessagesRequest = {"messages": messages[start : start + MAX_MESSAGES_PER_BATCH]}
            await self._request(
                "POST",
                self._conv_path(conversation_id, "messages"),
                json_body=body,
                timeout=WRITE_TIMEOUT_S,
                idempotent=False,
            )

    async def request_handoff(self, conversation_id: str, request: HandoffRequest) -> None:
        await self._request(
            "POST",
            self._conv_path(conversation_id, "handoff"),
            json_body=request,
            timeout=WRITE_TIMEOUT_S,
            idempotent=False,
        )

    async def end_conversation(self, conversation_id: str, request: EndConversationRequest) -> None:
        # /end is idempotent on the web side, so any network error is safe to retry.
        await self._request(
            "POST",
            self._conv_path(conversation_id, "end"),
            json_body=request,
            timeout=WRITE_TIMEOUT_S,
            idempotent=True,
        )

    async def run_action(
        self, conversation_id: str, action_id: str, arguments: dict[str, Any]
    ) -> RunActionResponse:
        """Ask the web app to call one of the business's actions. Not idempotent (it may create
        or change something), so it only retries when the request never left."""
        body: RunActionRequest = {"arguments": arguments}
        resp = await self._request(
            "POST",
            self._conv_path(conversation_id, f"actions/{quote(action_id, safe='')}"),
            json_body=body,
            timeout=ACTION_TIMEOUT_S,
            idempotent=False,
        )
        try:
            return parse_run_action_response(self._json(resp, "action"))
        except ContractError as e:
            raise InternalApiError(f"invalid action response: {e}") from e


def _error_details(resp: httpx.Response) -> tuple[str | None, str | None]:
    try:
        data = resp.json()
    except ValueError:
        return None, None
    err = data.get("error") if isinstance(data, dict) else None
    if isinstance(err, dict):
        code = err.get("code")
        message = err.get("message")
        return (code if isinstance(code, str) else None, message if isinstance(message, str) else None)
    return None, None
