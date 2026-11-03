"""Function tools the model can call: knowledge search and human handoff."""

from __future__ import annotations

import logging
import re

from livekit.agents import FunctionTool, function_tool
from livekit.agents.llm import RawFunctionTool

from .api import (
    ContractError,
    HandoffRequest,
    InternalApiError,
    KnowledgeResult,
    RuntimeConfig,
    TalkfrontApi,
    build_handoff_request,
)
from .embeddings import embed_query
from .lifecycle import HandoffDraft, TurnCounter
from .actions import build_action_tools

logger = logging.getLogger("talkfront.tools")

SEARCH_LIMIT = 3
ANSWER_LANGUAGE_NOTE = "(Answer in the language of the visitor's last message, translating this if needed.)"
RESULT_CONTENT_CHARS = 600

NOTHING_FOUND = (
    "No matching information was found in the knowledge base for this question. "
    "Do not guess: tell the visitor you don't have that information"
)
SEARCH_UNAVAILABLE = (
    "The knowledge base could not be searched right now. Do not guess: tell the visitor you "
    "can't look that up at the moment"
)


def format_results(results: list[KnowledgeResult]) -> str:
    """Compact text for the model: numbered results with title, optional URL and trimmed content."""
    blocks: list[str] = []
    for i, r in enumerate(results, start=1):
        title = r["title"].strip() or "Untitled"
        header = f"[{i}] {title}" + (f" ({r['url']})" if r.get("url") else "")
        content = " ".join(r["content"].split())
        if len(content) > RESULT_CONTENT_CHARS:
            content = content[: RESULT_CONTENT_CHARS - 1] + "…"
        blocks.append(f"{header}\n{content}")
    return "\n\n".join(blocks)


_SPOKEN_AT = re.compile(r"\s*(?:\(at\)|\bat the rate(?: of)?\b|\bat\b)\s*", re.IGNORECASE)
_SPOKEN_DOT = re.compile(r"\s*(?:\(dot\)|\bdot\b)\s*", re.IGNORECASE)


def normalize_spoken_email(raw: str) -> str:
    """'sam lee 42 at the rate gmail dot com' -> 'samlee42@gmail.com'.

    Speech to text (and some typists) spell addresses out; the team needs a real address,
    and reading back the normalized form lets the visitor catch mistakes.
    """
    email = raw.strip()
    if "@" not in email:
        email = _SPOKEN_AT.sub("@", email, count=1)
    email = _SPOKEN_DOT.sub(".", email)
    return re.sub(r"\s+", "", email).lower()


def format_handoff(request: HandoffRequest) -> str:
    parts = [f"{key}: {value}" for key, value in request.items() if key != "message" and value]
    parts.append(f"message: {request['message']}")
    return "; ".join(parts)


_SPOKEN_DOMAINS = {
    d: d.replace(".", " dot ")
    for d in ("gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "icloud.com", "live.com")
}
_SPOKEN_SYMBOLS = {".": "dot", "_": "underscore", "-": "dash", "+": "plus"}


def _spell(text: str) -> str:
    return " ".join(_SPOKEN_SYMBOLS.get(ch, ch.upper()) for ch in text)


def email_for_voice(email: str) -> str:
    """'samlee42@gmail.com' -> 'S A M L E E 4 2, at, gmail dot com' so TTS reads it letter by letter."""
    local, _, domain = email.partition("@")
    if not domain:
        return _spell(email)
    return f"{_spell(local)}, at, {_SPOKEN_DOMAINS.get(domain) or _spell(domain)}"


def phone_for_voice(phone: str) -> str:
    """'0303 2862895' -> '0 3 0 3, 2 8 6, 2 8 9 5'."""
    digits = re.sub(r"\D", "", phone)
    groups = [digits[:4], digits[4:7], digits[7:]] if len(digits) > 7 else [digits]
    return ", ".join(" ".join(g) for g in groups if g)


def voice_readback(request: HandoffRequest) -> str:
    parts = []
    if request.get("name"):
        parts.append(f"Your name is {request['name']}.")
    if request.get("email"):
        parts.append(f"Your email is {email_for_voice(request['email'])}.")
    if request.get("phone"):
        parts.append(f"Your phone number is {phone_for_voice(request['phone'])}.")
    parts.append(f"Your message: {request['message']}.")
    return " ".join(parts)


async def search_formatted(api: TalkfrontApi, conversation_id: str, query: str) -> str | None:
    """Knowledge results as text for the model, or None when nothing matched.

    Semantic + text search when the embedder answers in time; text only otherwise.
    Raises ContractError for an empty query and InternalApiError when search is down.
    """
    embedding = await embed_query(query)
    resp = await api.search_knowledge(conversation_id, query, limit=SEARCH_LIMIT, embedding=embedding)
    results = resp["results"]
    logger.info("knowledge search returned %d results (%s)", len(results), "hybrid" if embedding else "text only")
    if not results:
        return None
    # The knowledge is usually in English; without this, voice models answer in English after a search
    # even when the visitor spoke Urdu.
    return format_results(results) + "\n\n" + ANSWER_LANGUAGE_NOTE


def build_tools(
    api: TalkfrontApi, runtime: RuntimeConfig, turns: TurnCounter, draft: HandoffDraft | None = None
) -> list[FunctionTool | RawFunctionTool]:
    conversation_id = runtime.conversation_id
    handoff_hint = " and offer to connect them with a human." if runtime.agent.handoff_enabled else "."

    @function_tool
    async def search_knowledge(query: str) -> str:
        """Search this business's knowledge base (help articles, policies, product info).

        Results for each visitor message are attached automatically; call this when they are
        missing or don't cover the question, with a more specific query. Answer only from what it returns.

        Args:
            query: A short search query in the visitor's language, e.g. "refund policy for annual plans".
        """
        try:
            found = await search_formatted(api, conversation_id, query)
        except ContractError:
            return "The search query was empty. Ask the visitor what they are looking for."
        except InternalApiError as e:
            logger.warning("knowledge search failed: %s", e)
            return SEARCH_UNAVAILABLE + handoff_hint
        return found or NOTHING_FOUND + handoff_hint

    tools: list[FunctionTool | RawFunctionTool] = [search_knowledge]

    if runtime.agent.handoff_enabled:
        visitor = runtime.visitor
        draft = draft or HandoffDraft(turns)

        @function_tool
        async def request_human(
            message: str,
            name: str | None = None,
            email: str | None = None,
            phone: str | None = None,
        ) -> str:
            """Prepare a message for the team. This does NOT send it yet.

            Only use it when the visitor wants the team to follow up: they asked for a person, or
            agreed to leave a message after you offered. Never use it just because they shared
            contact details. After calling it, read the details back to the visitor and ask if
            they are correct. Call confirm_message only after they say yes. If they correct
            something, call request_human again with the corrected details.

            Args:
                message: What the visitor needs, written for the teammate. Must not be empty.
                name: The visitor's name, if known.
                email: The visitor's email address, if they gave one.
                phone: The visitor's phone number, if they gave one.
            """
            try:
                request = build_handoff_request(
                    message,
                    name=name or visitor.name,
                    email=normalize_spoken_email(email) if email else visitor.email,
                    phone=phone,
                )
            except ContractError:
                return "Ask the visitor what they need help with, then call request_human again with that as the message."
            if not request.get("email") and not request.get("phone"):
                return "Ask the visitor for an email address or phone number first, then call request_human again."
            draft.prepare(request)
            if runtime.mode == "voice":
                return (
                    f'Not sent yet. Say this read-back word for word, then ask if it is correct: "{voice_readback(request)}" '
                    "Only after the visitor confirms, call confirm_message. If something is wrong, ask them "
                    "to type it in the chat box under the microphone, or to say it again slowly."
                )
            return (
                f"Not sent yet. Read these details back to the visitor and ask if they are correct: "
                f"{format_handoff(request)}. Only after the visitor confirms, call confirm_message."
            )

        @function_tool
        async def confirm_message() -> str:
            """Send the message prepared with request_human. Only call this after the visitor
            has confirmed the details you read back to them."""
            request, reason = draft.take_confirmed()
            if reason is not None:
                return reason
            assert request is not None
            try:
                await api.request_handoff(conversation_id, request)  # type: ignore[arg-type]
            except InternalApiError as e:
                logger.warning("handoff request failed: %s", e)
                draft.restore(request)
                return (
                    "The message could not be sent right now. Apologise and ask the visitor to "
                    "try again in a moment or use the business's other contact options."
                )
            logger.info("handoff requested")
            return (
                "Sent: the team has the message. Tell the visitor briefly that the team will get "
                "back to them. Don't promise when or how: no 'shortly', 'soon' or 'today'."
            )

        tools.extend([request_human, confirm_message])

    # The business's own HTTP actions (actions.py); names never clash with the tools above.
    tools.extend(build_action_tools(api, runtime))
    return tools
