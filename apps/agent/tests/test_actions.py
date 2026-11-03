import asyncio
import json

import httpx
import pytest
from livekit.agents import ToolError
from livekit.agents.llm import RawFunctionTool, ToolContext
from livekit.agents.llm.utils import prepare_function_arguments

from talkfront_agent.actions import BUILTIN_TOOL_NAMES, action_schema, build_action_tools
from talkfront_agent.api import (
    ActionSpec,
    ApiSettings,
    InternalApiError,
    TalkfrontApi,
    parse_run_action_response,
    parse_runtime_config,
)
from talkfront_agent.lifecycle import TurnCounter
from talkfront_agent.tools import build_tools
from talkfront_agent.transcript import describe_tool_call

from .test_metadata import runtime_payload

SECRET = "test-secret-not-real"

ORDER_SCHEMA = {
    "type": "object",
    "properties": {
        "order_id": {"type": "string", "description": "The order number"},
        "channel": {"type": "string", "enum": ["web", "store"]},
    },
    "required": ["order_id"],
    "additionalProperties": False,
}


def payload_with(actions=None, visitor=None, **extra):
    data = runtime_payload()
    if actions is not None:
        data["actions"] = actions
    if visitor is not None:
        data["visitor"] = visitor
    data.update(extra)
    return data


def order_action(**over):
    action = {
        "id": "act_1",
        "name": "check_order_status",
        "description": "Look up an order's status by its order number.",
        "parameters": ORDER_SCHEMA,
    }
    action.update(over)
    return action


def make_api(responder):
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return responder(request)

    api = TalkfrontApi(ApiSettings(base_url="http://web.test", secret=SECRET), transport=httpx.MockTransport(handler))
    return api, requests


def run(coro):
    return asyncio.run(coro)


# ---------------------------------------------------------------- runtime parsing


def test_parses_actions_and_verified_visitor():
    rt = parse_runtime_config(
        payload_with(
            actions=[order_action()],
            visitor={
                "id": "user_42",
                "name": "Sam Rivera",
                "email": "sam@example.com",
                "verified": True,
                "attributes": {"plan": "pro", "orders": 3, "vip": False, "nested": {"x": 1}},
            },
        )
    )
    assert rt.visitor.verified is True
    assert rt.visitor.attributes == {"plan": "pro", "orders": 3, "vip": False}
    assert len(rt.actions) == 1
    spec = rt.actions[0]
    assert spec.id == "act_1" and spec.name == "check_order_status"
    assert spec.parameters["required"] == ["order_id"]


def test_old_runtime_without_new_fields_still_parses():
    rt = parse_runtime_config(runtime_payload())
    assert rt.actions == ()
    assert rt.visitor.verified is False and rt.visitor.attributes == {}


def test_runtime_tolerates_extra_fields_and_skips_bad_actions():
    rt = parse_runtime_config(
        payload_with(
            actions=[
                order_action(extra="ignored", url="never sent"),
                "not an object",
                {"name": "no_id"},
                order_action(id="act_2", name="book_table", description=None, parameters=None),
            ],
            somethingNew={"a": 1},
        )
    )
    assert [a.id for a in rt.actions] == ["act_1", "act_2"]
    assert rt.actions[1].description == ""
    assert rt.actions[1].parameters == {"type": "object", "properties": {}}


def test_actions_not_a_list_is_ignored():
    assert parse_runtime_config(payload_with(actions={"oops": True})).actions == ()


# ---------------------------------------------------------------- tool building


def test_action_schema_is_the_raw_function_description():
    schema = action_schema(ActionSpec("act_1", "check_order_status", "  Look up\n an order. ", ORDER_SCHEMA))
    assert schema == {
        "name": "check_order_status",
        "description": "Look up an order.",
        "parameters": ORDER_SCHEMA,
    }


def test_action_schema_drops_required_names_without_properties():
    schema = action_schema(
        ActionSpec("a", "x_action", "", {"type": "object", "properties": {"a": {"type": "string"}}, "required": ["a", "b", 3]})
    )
    assert schema["parameters"]["required"] == ["a"]
    assert schema["description"]


def test_build_skips_builtin_duplicate_and_invalid_names():
    rt = parse_runtime_config(
        payload_with(
            actions=[
                order_action(),
                order_action(id="act_2"),  # same name again
                order_action(id="act_3", name="search_knowledge"),
                order_action(id="act_4", name="Bad-Name"),
                order_action(id="act_5", name="book_table"),
            ]
        )
    )
    api, _ = make_api(lambda req: httpx.Response(500))
    tools = build_action_tools(api, rt)
    assert [t.info.name for t in tools] == ["check_order_status", "book_table"]
    assert all(isinstance(t, RawFunctionTool) for t in tools)
    run(api.aclose())


def test_build_tools_adds_actions_after_builtins_without_clashes():
    rt = parse_runtime_config(payload_with(actions=[order_action(), order_action(id="act_9", name="confirm_message")]))
    api, _ = make_api(lambda req: httpx.Response(500))
    tools = build_tools(api, rt, TurnCounter())
    names = [t.info.name for t in tools]
    assert names == ["search_knowledge", "request_human", "confirm_message", "check_order_status"]
    # LiveKit's own registry accepts the set (it rejects duplicate names).
    ctx = ToolContext(tools)
    assert set(ctx.function_tools) == set(names)
    assert BUILTIN_TOOL_NAMES <= set(names)
    run(api.aclose())


# ---------------------------------------------------------------- calling


def _single_tool(responder, **action_over):
    rt = parse_runtime_config(payload_with(actions=[order_action(**action_over)]))
    api, requests = make_api(responder)
    (tool,) = build_action_tools(api, rt)
    return api, requests, tool


async def _call(tool, arguments: dict):
    """Call the tool the way LiveKit does: bind the JSON arguments, then await."""
    args, kwargs = prepare_function_arguments(fnc=tool, json_arguments=json.dumps(arguments))
    return await tool(*args, **kwargs)


def test_tool_posts_arguments_to_the_internal_route_and_returns_result():
    api, requests, tool = _single_tool(
        lambda req: httpx.Response(200, json={"ok": True, "status": 200, "result": '{"status":"shipped"}'})
    )
    out = run(_call(tool, {"order_id": "A-1001"}))
    assert out == '{"status":"shipped"}'
    req = requests[0]
    assert req.method == "POST"
    assert req.url.path == "/api/internal/conversations/conv_1/actions/act_1"
    assert req.headers["authorization"] == f"Bearer {SECRET}"
    assert json.loads(req.content) == {"arguments": {"order_id": "A-1001"}}
    run(api.aclose())


def test_tool_failure_becomes_a_tool_error_with_the_plain_reason():
    api, _, tool = _single_tool(
        lambda req: httpx.Response(200, json={"ok": False, "status": 404, "result": "The service answered with an error (HTTP 404)."})
    )
    with pytest.raises(ToolError) as info:
        run(_call(tool, {"order_id": "nope"}))
    assert "HTTP 404" in info.value.message
    assert "Do not guess" in info.value.message
    assert "take a message" in info.value.message  # handoff is enabled in the payload
    run(api.aclose())


def test_disabled_action_and_internal_errors_are_tool_errors():
    api, _, tool = _single_tool(
        lambda req: httpx.Response(409, json={"error": {"code": "action_disabled", "message": "off"}})
    )
    with pytest.raises(ToolError) as info:
        run(_call(tool, {"order_id": "A-1"}))
    assert "turned off" in info.value.message
    run(api.aclose())

    api, _, tool = _single_tool(lambda req: httpx.Response(500, text="boom"))
    with pytest.raises(ToolError) as info:
        run(_call(tool, {"order_id": "A-1"}))
    assert "could not be run" in info.value.message
    run(api.aclose())


def test_empty_success_result_gets_a_readable_answer():
    api, _, tool = _single_tool(lambda req: httpx.Response(200, json={"ok": True, "status": 204, "result": ""}))
    assert run(_call(tool, {"order_id": "A-1"})).startswith("Done.")
    run(api.aclose())


def test_run_action_is_not_retried_after_the_request_was_sent():
    calls = 0

    def responder(req):
        nonlocal calls
        calls += 1
        raise httpx.ReadTimeout("slow", request=req)

    api, _ = make_api(responder)
    with pytest.raises(InternalApiError):
        run(api.run_action("conv_1", "act_1", {"order_id": "A-1"}))
    assert calls == 1
    run(api.aclose())


def test_run_action_response_shape():
    assert parse_run_action_response({"ok": True, "status": None, "result": "x", "extra": 1}) == {
        "ok": True,
        "status": None,
        "result": "x",
    }
    for bad in ({"ok": "yes", "status": 200, "result": ""}, {"ok": True, "status": True, "result": ""}, {"ok": True, "status": 1}):
        with pytest.raises(Exception):
            parse_run_action_response(bad)


def test_transcript_gets_one_readable_line_per_action_call():
    line = describe_tool_call("check_order_status", '{"order_id": "A-1001"}', '{"status":"shipped"}', False)
    assert line == 'check_order_status {"order_id": "A-1001"} -> ok: {"status":"shipped"}'
    failed = describe_tool_call("check_order_status", '{"order_id": "x"}', "The action did not work: HTTP 404", True)
    assert failed.endswith("-> error: The action did not work: HTTP 404")
