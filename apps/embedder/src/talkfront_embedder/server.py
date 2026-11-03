"""Tiny HTTP API on the standard library (no framework).

    POST /embed   {"texts": [...] (1..64), "kind": "query" | "passage"}
                  -> {"model": str, "dimensions": 384, "vectors": [[...], ...]}
    GET  /health  -> {"ok": true, "model": str, "dimensions": 384, "backfill": {...}}

When EMBEDDER_TOKEN is set, /embed needs ``Authorization: Bearer <token>``. /health is open
(it shows counts only). Request logs carry path, status, sizes and timing, never the texts.
"""

from __future__ import annotations

import hmac
import json
import logging
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Callable

from .model import DIMENSIONS

logger = logging.getLogger("talkfront.embedder.http")

MAX_TEXTS = 64
MAX_TEXT_CHARS = 8_000  # the model reads at most 512 tokens anyway
MAX_BODY_BYTES = 1_000_000
KINDS = ("query", "passage")


class BadRequest(ValueError):
    pass


def parse_embed_request(body: bytes) -> tuple[list[str], str]:
    try:
        data = json.loads(body)
    except (ValueError, UnicodeDecodeError):
        raise BadRequest("body must be JSON") from None
    if not isinstance(data, dict):
        raise BadRequest("body must be a JSON object")
    texts = data.get("texts")
    kind = data.get("kind", "query")
    if kind not in KINDS:
        raise BadRequest("kind must be 'query' or 'passage'")
    if not isinstance(texts, list) or not (1 <= len(texts) <= MAX_TEXTS):
        raise BadRequest(f"texts must be an array of 1 to {MAX_TEXTS} strings")
    out: list[str] = []
    for t in texts:
        if not isinstance(t, str) or not t.strip():
            raise BadRequest("every text must be a non-empty string")
        out.append(t[:MAX_TEXT_CHARS])
    return out, kind


def make_handler(embedder: Any, token: str | None, health_extra: Callable[[], dict[str, Any]]):
    expected = f"Bearer {token}".encode() if token else None

    class Handler(BaseHTTPRequestHandler):
        server_version = "talkfront-embedder/0.1"
        sys_version = ""
        protocol_version = "HTTP/1.1"

        def log_message(self, format: str, *args: Any) -> None:  # noqa: A002 (stdlib signature)
            pass  # replaced by the one-line log in _send

        def _send(self, status: int, payload: dict[str, Any], started: float, info: str = "") -> None:
            body = json.dumps(payload, separators=(",", ":")).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            ms = (time.perf_counter() - started) * 1000
            level = logging.INFO if status < 500 else logging.ERROR
            if self.path != "/health":
                logger.log(level, "%s %s -> %d %s(%.0f ms)", self.command, self.path, status, info, ms)

        def _error(self, status: int, code: str, message: str, started: float) -> None:
            self._send(status, {"error": {"code": code, "message": message}}, started)

        def do_GET(self) -> None:  # noqa: N802
            started = time.perf_counter()
            if self.path != "/health":
                return self._error(404, "not_found", "Not found.", started)
            self._send(
                200,
                {"ok": True, "model": embedder.model_name, "dimensions": DIMENSIONS, **health_extra()},
                started,
            )

        def do_POST(self) -> None:  # noqa: N802
            started = time.perf_counter()
            if self.path != "/embed":
                return self._error(404, "not_found", "Not found.", started)
            if expected is not None:
                got = (self.headers.get("Authorization") or "").encode()
                if not hmac.compare_digest(got, expected):
                    return self._error(401, "unauthorized", "Missing or wrong bearer token.", started)
            try:
                length = int(self.headers.get("Content-Length") or "0")
            except ValueError:
                length = -1
            if length <= 0 or length > MAX_BODY_BYTES:
                self.close_connection = True
                return self._error(413 if length > 0 else 400, "invalid_request", "Bad body size.", started)
            try:
                texts, kind = parse_embed_request(self.rfile.read(length))
            except BadRequest as e:
                return self._error(400, "invalid_request", str(e), started)
            try:
                vectors = embedder.embed(texts, kind)
            except Exception as e:  # noqa: BLE001
                logger.exception("embedding failed: %s", e.__class__.__name__)
                return self._error(500, "embed_failed", "Embedding failed.", started)
            payload = {
                "model": embedder.model_name,
                "dimensions": DIMENSIONS,
                "vectors": [[round(float(x), 7) for x in row] for row in vectors],
            }
            self._send(200, payload, started, f"{len(texts)} {kind} ")

    return Handler


class Server(ThreadingHTTPServer):
    daemon_threads = True
    request_queue_size = 64


def make_server(host: str, port: int, handler: type[BaseHTTPRequestHandler]) -> Server:
    return Server((host, port), handler)

