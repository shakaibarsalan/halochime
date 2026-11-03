import asyncio
import json
import re

import httpx
import pytest

from talkfront_agent.api import (
    ApiSettings,
    InternalApiError,
    TalkfrontApi,
    build_end_request,
    build_handoff_request,
    make_message,
)

from .test_metadata import runtime_payload

SECRET = "test-secret-not-real"
ISO_Z = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$")


class Recorder:
    def __init__(self, responder):
        self.requests: list[httpx.Request] = []
        self._responder = responder

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        return self._responder(request, len(self.requests))


def make_api(responder) -> tuple[TalkfrontApi, Recorder]:
    rec = Recorder(responder)
    api = TalkfrontApi(
        ApiSettings(base_url="http://web.test", secret=SECRET), transport=httpx.MockTransport(rec)
    )
    return api, rec


def body(req: httpx.Request):
    return json.loads(req.content)


def run(coro):
    return asyncio.run(coro)


def test_runtime_get_sends_bearer_and_parses():
    api, rec = make_api(lambda req, n: httpx.Response(200, json=runtime_payload()))
    rt = run(api.get_runtime("conv/1"))
    req = rec.requests[0]
    assert req.method == "GET"
    assert req.url.path == "/api/internal/runtime/conv%2F1" or req.url.raw_path == b"/api/internal/runtime/conv%2F1"
    assert req.headers["authorization"] == f"Bearer {SECRET}"
    assert rt.agent.name == "Ava"


def test_search_payload_shape():
    def responder(req, n):
        return httpx.Response(
            200,
            json={
                "results": [
                    {"chunkId": "c", "sourceId": "s", "title": "T", "url": None, "content": "x", "score": 0.9}
                ]
            },
        )

    api, rec = make_api(responder)
    resp = run(api.search_knowledge("conv_1", "  refund   policy ", limit=50))
    assert rec.requests[0].url.path == "/api/internal/knowledge/search"
    assert body(rec.requests[0]) == {"conversationId": "conv_1", "query": "refund policy", "limit": 8}
    assert resp["results"][0]["title"] == "T"


def test_append_messages_batches_of_100():
    api, rec = make_api(lambda req, n: httpx.Response(204))
    msgs = [make_message("user", f"m{i}", 1_700_000_000 + i) for i in range(230)]
    run(api.append_messages("conv_1", msgs))
    sizes = [len(body(r)["messages"]) for r in rec.requests]
    assert sizes == [100, 100, 30]
    first = body(rec.requests[0])["messages"][0]
    assert set(first) == {"role", "content", "createdAt"}
    assert ISO_Z.match(first["createdAt"])
    assert rec.requests[0].url.path == "/api/internal/conversations/conv_1/messages"


def test_message_content_is_capped():
    msg = make_message("assistant", "x" * 25_000)
    assert len(msg["content"]) == 20_000


def test_handoff_omits_missing_optionals():
    api, rec = make_api(lambda req, n: httpx.Response(200, json={"ok": True}))
    run(api.request_handoff("conv_1", build_handoff_request(" Wants a refund ", email="a@b.co", phone=" ")))
    assert body(rec.requests[0]) == {"message": "Wants a refund", "email": "a@b.co"}
    assert rec.requests[0].url.path == "/api/internal/conversations/conv_1/handoff"


def test_end_payload():
    api, rec = make_api(lambda req, n: httpx.Response(200, json={"ok": True}))
    run(api.end_conversation("conv_1", build_end_request("max_duration", 61.6)))
    assert body(rec.requests[0]) == {"endedReason": "max_duration", "durationSec": 62}
    assert build_end_request("error", -3)["durationSec"] == 0


def test_end_retries_once_on_network_error():
    def responder(req, n):
        if n == 1:
            raise httpx.ReadTimeout("slow", request=req)
        return httpx.Response(200, json={"ok": True})

    api, rec = make_api(responder)
    run(api.end_conversation("conv_1", build_end_request("visitor_left", 10)))
    assert len(rec.requests) == 2


def test_messages_do_not_retry_after_request_was_sent():
    def responder(req, n):
        raise httpx.ReadTimeout("slow", request=req)

    api, rec = make_api(responder)
    with pytest.raises(InternalApiError):
        run(api.append_messages("conv_1", [make_message("user", "hi")]))
    assert len(rec.requests) == 1


def test_messages_retry_on_connect_error():
    def responder(req, n):
        if n == 1:
            raise httpx.ConnectError("refused", request=req)
        return httpx.Response(204)

    api, rec = make_api(responder)
    run(api.append_messages("conv_1", [make_message("user", "hi")]))
    assert len(rec.requests) == 2


def test_http_error_raises_with_code():
    api, _ = make_api(
        lambda req, n: httpx.Response(401, json={"error": {"code": "unauthorized", "message": "nope"}})
    )
    with pytest.raises(InternalApiError) as ei:
        run(api.get_runtime("conv_1"))
    assert ei.value.status == 401 and ei.value.code == "unauthorized"
    assert SECRET not in str(ei.value)


def test_invalid_runtime_is_an_api_error():
    api, _ = make_api(lambda req, n: httpx.Response(200, json={"conversationId": "x"}))
    with pytest.raises(InternalApiError):
        run(api.get_runtime("conv_1"))


def test_settings_from_env(monkeypatch):
    monkeypatch.setenv("TALKFRONT_API_URL", "http://web.test/")
    monkeypatch.setenv("INTERNAL_API_SECRET", "s")
    assert ApiSettings.from_env().base_url == "http://web.test"
    monkeypatch.delenv("INTERNAL_API_SECRET")
    with pytest.raises(InternalApiError):
        ApiSettings.from_env()


def test_normalize_spoken_email():
    from talkfront_agent.tools import normalize_spoken_email

    assert normalize_spoken_email("sam lee 42 at the rate gmail dot com") == "samlee42@gmail.com"
    assert normalize_spoken_email("Ali at gmail dot com") == "ali@gmail.com"
    assert normalize_spoken_email("ali.khan@Example.com ") == "ali.khan@example.com"
    assert normalize_spoken_email("sara (at) mail (dot) pk") == "sara@mail.pk"


def test_voice_readback_spells_contact_details():
    from talkfront_agent.tools import email_for_voice, phone_for_voice, voice_readback

    assert email_for_voice("samlee42@gmail.com") == "S A M L E E 4 2, at, gmail dot com"
    assert email_for_voice("a.b@shop.pk") == "A dot B, at, S H O P dot P K"
    assert phone_for_voice("0303 2862895") == "0 3 0 3, 2 8 6, 2 8 9 5"
    text = voice_readback({"name": "Sara", "phone": "03001234567", "message": "Birthday order"})
    assert text == "Your name is Sara. Your phone number is 0 3 0 0, 1 2 3, 4 5 6 7. Your message: Birthday order."
