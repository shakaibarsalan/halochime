import asyncio
import json

import httpx
import pytest
from livekit.agents.llm.utils import prepare_function_arguments

from talkfront_agent import embeddings, tools
from talkfront_agent.api import (
    EMBEDDING_DIMENSIONS,
    ApiSettings,
    TalkfrontApi,
    build_search_request,
    parse_runtime_config,
)
from talkfront_agent.embeddings import EmbeddingClient
from talkfront_agent.lifecycle import TurnCounter

from .test_metadata import runtime_payload

VECTOR = [0.01 * (i % 7) for i in range(EMBEDDING_DIMENSIONS)]
SEARCH_OK = {"results": [{"chunkId": "c", "sourceId": "s", "title": "T", "url": None, "content": "x", "score": 0.9}]}


def run(coro):
    return asyncio.run(coro)


def embedder(responder, **kw):
    calls: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        return responder(request)

    return EmbeddingClient("http://embedder.test", transport=httpx.MockTransport(handler), **kw), calls


def ok(request: httpx.Request) -> httpx.Response:
    return httpx.Response(200, json={"model": "m", "dimensions": EMBEDDING_DIMENSIONS, "vectors": [VECTOR]})


# ---------------------------------------------------------------- client


def test_embeds_query_with_kind_and_token():
    client, calls = embedder(ok, token="tok-not-real")
    assert run(client.embed_query("  does it   speak Urdu ")) == VECTOR
    req = calls[0]
    assert req.url.path == "/embed"
    assert json.loads(req.content) == {"texts": ["does it speak Urdu"], "kind": "query"}
    assert req.headers["authorization"] == "Bearer tok-not-real"


def test_no_token_header_when_unset():
    client, calls = embedder(ok)
    run(client.embed_query("hi"))
    assert "authorization" not in calls[0].headers


def test_cache_saves_the_second_call():
    client, calls = embedder(ok)

    async def twice():
        a = await client.embed_query("Opening hours")
        b = await client.embed_query("opening   HOURS")
        return a, b

    a, b = run(twice())
    assert a == b == VECTOR
    assert len(calls) == 1


def test_cache_is_bounded():
    client, calls = embedder(ok, cache_size=2)

    async def go():
        for q in ("a", "b", "c", "a"):
            await client.embed_query(q)

    run(go())
    assert len(calls) == 4  # "a" was evicted by "c"


@pytest.mark.parametrize(
    "responder",
    [
        lambda r: httpx.Response(500, json={"error": {"code": "embed_failed"}}),
        lambda r: httpx.Response(401, json={"error": {"code": "unauthorized"}}),
        lambda r: httpx.Response(200, text="not json"),
        lambda r: httpx.Response(200, json={"vectors": []}),
        lambda r: httpx.Response(200, json={"vectors": [[0.1, 0.2]]}),
        lambda r: httpx.Response(200, json={"vectors": [["x"] * EMBEDDING_DIMENSIONS]}),
        lambda r: httpx.Response(200, json=[1, 2]),
    ],
)
def test_bad_answers_give_none(responder):
    client, _ = embedder(responder)
    assert run(client.embed_query("hi")) is None


def test_network_error_gives_none():
    def boom(request):
        raise httpx.ConnectError("refused", request=request)

    client, _ = embedder(boom)
    assert run(client.embed_query("hi")) is None


def test_timeout_gives_none_quickly():
    class Slow(httpx.AsyncBaseTransport):
        async def handle_async_request(self, request):
            await asyncio.sleep(5)
            return ok(request)

    client = EmbeddingClient("http://embedder.test", timeout=0.05, transport=Slow())

    async def timed():
        loop = asyncio.get_running_loop()
        started = loop.time()
        out = await client.embed_query("hi")
        return out, loop.time() - started

    out, elapsed = run(timed())
    assert out is None and elapsed < 1.0


def test_failures_are_not_cached():
    state = {"n": 0}

    def flaky(request):
        state["n"] += 1
        return httpx.Response(503) if state["n"] == 1 else ok(request)

    client, _ = embedder(flaky)

    async def go():
        return await client.embed_query("hi"), await client.embed_query("hi")

    assert run(go()) == (None, VECTOR)


def test_empty_query_skips_the_call():
    client, calls = embedder(ok)
    assert run(client.embed_query("   ")) is None
    assert calls == []


def test_env_unset_means_no_embeddings(monkeypatch):
    monkeypatch.delenv("EMBEDDER_URL", raising=False)
    embeddings.reset_default_client()
    try:
        assert embeddings.default_client() is None
        assert run(embeddings.embed_query("hi")) is None
    finally:
        embeddings.reset_default_client()


def test_env_set_builds_client(monkeypatch):
    monkeypatch.setenv("EMBEDDER_URL", "http://embedder:8090/")
    monkeypatch.setenv("EMBEDDER_TOKEN", "tok-not-real")
    embeddings.reset_default_client()
    try:
        client = embeddings.default_client()
        assert client is not None and client is embeddings.default_client()
    finally:
        embeddings.reset_default_client()


# ---------------------------------------------------------------- search request + tool


def test_search_request_includes_embedding_only_when_valid():
    assert build_search_request("c", "q", 3, VECTOR)["embedding"] == VECTOR
    assert "embedding" not in build_search_request("c", "q", 3)
    assert "embedding" not in build_search_request("c", "q", 3, [0.1, 0.2])


def _search_tool(responder):
    requests: list[httpx.Request] = []

    def handler(request):
        requests.append(request)
        return responder(request)

    api = TalkfrontApi(ApiSettings(base_url="http://web.test", secret="s-not-real"), transport=httpx.MockTransport(handler))
    rt = parse_runtime_config(runtime_payload())
    tool = next(t for t in tools.build_tools(api, rt, TurnCounter()) if t.info.name == "search_knowledge")
    return tool, requests


async def _call(tool, arguments):
    args, kwargs = prepare_function_arguments(fnc=tool, json_arguments=json.dumps(arguments))
    return await tool(*args, **kwargs)


def test_tool_sends_query_embedding(monkeypatch):
    async def fake_embed(query):
        assert query == "does it speak Urdu"
        return VECTOR

    monkeypatch.setattr(tools, "embed_query", fake_embed)
    tool, requests = _search_tool(lambda r: httpx.Response(200, json=SEARCH_OK))
    out = run(_call(tool, {"query": "does it speak Urdu"}))
    sent = json.loads(requests[0].content)
    assert sent["embedding"] == VECTOR and sent["query"] == "does it speak Urdu"
    assert "[1] T" in out


def test_tool_searches_text_only_when_embedder_fails(monkeypatch):
    async def no_embed(query):
        return None

    monkeypatch.setattr(tools, "embed_query", no_embed)
    tool, requests = _search_tool(lambda r: httpx.Response(200, json=SEARCH_OK))
    out = run(_call(tool, {"query": "refund policy"}))
    assert "embedding" not in json.loads(requests[0].content)
    assert "[1] T" in out
