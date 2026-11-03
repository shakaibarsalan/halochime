"""The business's own HTTP actions as function tools (docs/integrations.md, section 4).

Each action from the runtime becomes one raw-schema tool: the model sees the action's name,
description and JSON Schema; calling it POSTs the arguments to the web app, which validates them
and makes the HTTP call (the agent never sees the URL or headers).

The transcript gets exactly one ``tool`` row per call from the ``function_tools_executed`` handler
in agent.py (``describe_tool_call``); nothing here or on the web side records it again.
"""

from __future__ import annotations

import logging
import re
from typing import Any

from livekit.agents import ToolError, function_tool
from livekit.agents.llm import RawFunctionTool

from .api import ActionSpec, InternalApiError, RuntimeConfig, TalkfrontApi

logger = logging.getLogger("talkfront.actions")

# Tool names the agent already defines in tools.py. An action with one of these names is skipped.
BUILTIN_TOOL_NAMES = frozenset({"search_knowledge", "request_human", "confirm_message"})
ACTION_NAME = re.compile(r"^[a-z][a-z0-9_]{0,39}$")
MAX_DESCRIPTION = 1000

EMPTY_RESULT = "Done. The service returned no data."


def _failure_hint(runtime: RuntimeConfig) -> str:
    return (
        " Do not guess the answer. Tell the visitor plainly that you can't check this right now"
        + (" and offer to take a message for the team." if runtime.agent.handoff_enabled else ".")
    )


def action_schema(spec: ActionSpec) -> dict[str, Any]:
    """The raw function description the LLM plugin sends: name, description, JSON Schema."""
    params = spec.parameters if isinstance(spec.parameters, dict) else {}
    properties = params.get("properties")
    required = params.get("required")
    schema: dict[str, Any] = {
        "type": "object",
        "properties": properties if isinstance(properties, dict) else {},
    }
    if isinstance(required, list):
        schema["required"] = [r for r in required if isinstance(r, str) and r in schema["properties"]]
    if params.get("additionalProperties") is False:
        schema["additionalProperties"] = False
    description = " ".join(spec.description.split())[:MAX_DESCRIPTION] or f"Call the business's {spec.name} action."
    return {"name": spec.name, "description": description, "parameters": schema}


def _make_tool(api: TalkfrontApi, runtime: RuntimeConfig, spec: ActionSpec) -> RawFunctionTool:
    conversation_id = runtime.conversation_id

    async def run(raw_arguments: dict[str, object]) -> str:
        args = dict(raw_arguments) if isinstance(raw_arguments, dict) else {}
        try:
            resp = await api.run_action(conversation_id, spec.id, args)
        except InternalApiError as e:
            logger.warning("action %s could not be run: %s", spec.name, e)
            if e.code == "action_disabled":
                raise ToolError("This action is turned off right now." + _failure_hint(runtime)) from None
            raise ToolError("The action could not be run right now." + _failure_hint(runtime)) from None
        logger.info("action %s -> %s %s", spec.name, "ok" if resp["ok"] else "failed", resp["status"])
        if not resp["ok"]:
            raise ToolError(f"The action did not work: {resp['result']}" + _failure_hint(runtime))
        return resp["result"] or EMPTY_RESULT

    return function_tool(run, raw_schema=action_schema(spec))


def build_action_tools(api: TalkfrontApi, runtime: RuntimeConfig) -> list[RawFunctionTool]:
    """One tool per action. Names that are invalid, built in, or repeated are skipped (and logged)."""
    tools: list[RawFunctionTool] = []
    seen: set[str] = set()
    for spec in runtime.actions:
        if not ACTION_NAME.match(spec.name):
            logger.warning("action %s skipped: invalid tool name", spec.id)
            continue
        if spec.name in BUILTIN_TOOL_NAMES or spec.name in seen:
            logger.warning("action %s skipped: tool name %s is already used", spec.id, spec.name)
            continue
        seen.add(spec.name)
        tools.append(_make_tool(api, runtime, spec))
    if tools:
        logger.info("registered %d action tools", len(tools))
    return tools
