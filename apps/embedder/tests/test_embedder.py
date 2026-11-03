"""Unit tests: request parsing, HTTP handler, backfill loop with a fake DB, and (when the model
files are present) the real model's prefixes, normalisation and tokenizer ids."""

from __future__ import annotations

import json
import threading
import urllib.error
import urllib.request
from pathlib import Path

import numpy as np
import pytest

from talkfront_embedder.backfill import Backfill, passage_text, vector_literal
from talkfront_embedder.model import DIMENSIONS
from talkfront_embedder.server import BadRequest, make_handler, make_server, parse_embed_request

MODEL_DIR = Path(__file__).resolve().parents[1] / "model"
HAVE_MODEL = (MODEL_DIR / "model.onnx").exists() and (MODEL_DIR / "sentencepiece.bpe.model").exists()


class FakeEmbedder:
    model_name = "fake-model"

    def __init__(self, fail_on: str | None = None) -> None:
        self.calls: list[tuple[list[str], str]] = []
        self.fail_on = fail_on

    def embed(self, texts: list[str], kind: str) -> np.ndarray:
        self.calls.append((texts, kind))
        if self.fail_on and any(self.fail_on in t for t in texts):
            raise RuntimeError("boom")
        out = np.zeros((len(texts), DIMENSIONS), dtype=np.float32)
        out[:, 0] = 1.0
        return out

    def wait_for_queries(self, timeout: float = 5.0) -> None:
        pass


# -- request parsing ------------------------------------------------------------------------------


def test_parse_embed_request_ok():
    texts, kind = parse_embed_request(json.dumps({"texts": ["hi"], "kind": "passage"}).encode())
    assert texts == ["hi"] and kind == "passage"


def test_parse_embed_request_defaults_to_query():
    assert parse_embed_request(b'{"texts": ["hi"]}')[1] == "query"


@pytest.mark.parametrize(
    "body",
    [
        b"not json",
        b"[]",
        b'{"texts": []}',
        b'{"texts": "hi"}',
        b'{"texts": [""]}',
        b'{"texts": [1]}',
        b'{"texts": ["a"], "kind": "doc"}',
        json.dumps({"texts": ["a"] * 65}).encode(),
    ],
)
def test_parse_embed_request_rejects(body: bytes):
    with pytest.raises(BadRequest):
        parse_embed_request(body)


# -- HTTP -------------------------------------------------------------------------------------------


@pytest.fixture
def http():
    def start(token: str | None):
        emb = FakeEmbedder()
        httpd = make_server("127.0.0.1", 0, make_handler(emb, token, lambda: {"backfill": None}))
        threading.Thread(target=httpd.serve_forever, daemon=True).start()
        servers.append(httpd)
        return f"http://127.0.0.1:{httpd.server_address[1]}", emb

    servers: list = []
    yield start
    for s in servers:
        s.shutdown()
        s.server_close()


def _post(url: str, body: dict, headers: dict | None = None) -> tuple[int, dict]:
    req = urllib.request.Request(
        url, data=json.dumps(body).encode(), headers={"Content-Type": "application/json", **(headers or {})}
    )
    try:
        with urllib.request.urlopen(req, timeout=5) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())


def test_http_embed_and_health(http):
    base, emb = http(None)
    status, data = _post(base + "/embed", {"texts": ["a", "b"], "kind": "query"})
    assert status == 200
    assert data["model"] == "fake-model" and data["dimensions"] == DIMENSIONS
    assert len(data["vectors"]) == 2 and len(data["vectors"][0]) == DIMENSIONS
    assert emb.calls == [(["a", "b"], "query")]
    with urllib.request.urlopen(base + "/health", timeout=5) as r:
        health = json.loads(r.read())
    assert health["ok"] is True and health["backfill"] is None


def test_http_token_required(http):
    base, emb = http("s3cret")
    assert _post(base + "/embed", {"texts": ["a"]})[0] == 401
    assert _post(base + "/embed", {"texts": ["a"]}, {"Authorization": "Bearer nope"})[0] == 401
    status, _ = _post(base + "/embed", {"texts": ["a"]}, {"Authorization": "Bearer s3cret"})
    assert status == 200
    assert len(emb.calls) == 1


def test_http_bad_request_and_404(http):
    base, _ = http(None)
    status, data = _post(base + "/embed", {"texts": []})
    assert status == 400 and data["error"]["code"] == "invalid_request"
    assert _post(base + "/nope", {"texts": ["a"]})[0] == 404


# -- backfill ---------------------------------------------------------------------------------------


class FakeCursor:
    def __init__(self, db: FakeDb) -> None:
        self.db = db
        self._result: list = []

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, query: str, params: dict) -> None:
        if self.db.fail_next:
            self.db.fail_next = False
            raise ConnectionError("db down")
        if "select c.id" in query:
            skip = set(params["skip"])
            pending = [
                r for r in self.db.rows if r["model"] != params["model"] and r["id"] not in skip
            ]
            self._result = [(r["id"], r["title"], r["content"]) for r in pending[: params["limit"]]]
        elif "count(*)" in query:
            self._result = [(sum(1 for r in self.db.rows if r["model"] != params["model"]),)]

    def executemany(self, query: str, params: list) -> None:
        for vec, model, chunk_id in params:
            for r in self.db.rows:
                if r["id"] == chunk_id:
                    r["vec"], r["model"] = vec, model

    def fetchall(self):
        return self._result

    def fetchone(self):
        return self._result[0]


class FakeDb:
    def __init__(self, rows: list[dict]) -> None:
        self.rows = rows
        self.closed = False
        self.fail_next = False

    def cursor(self):
        return FakeCursor(self)

    def close(self):
        self.closed = True


def _rows(n: int, model: str | None = None) -> list[dict]:
    return [{"id": f"c{i}", "title": "T", "content": f"text {i}", "model": model, "vec": None} for i in range(n)]


def test_backfill_embeds_pending_in_batches():
    db = FakeDb(_rows(5) + _rows(1, "fake-model"))
    db.rows[-1]["id"] = "done"
    emb = FakeEmbedder()
    bf = Backfill(emb, "postgres://unused", batch_size=2, connect=lambda: db)
    assert bf.run_once(db) == 2
    assert bf.run_once(db) == 2
    assert bf.run_once(db) == 1
    assert bf.run_once(db) == 0
    assert all(r["model"] == "fake-model" for r in db.rows)
    assert all(kind == "passage" for _, kind in emb.calls)
    assert emb.calls[0][0] == ["T\ntext 0"]
    assert bf.stats.embedded == 5 and bf.stats.pending == 0


def test_backfill_reembeds_other_model():
    db = FakeDb(_rows(2, "old-model"))
    bf = Backfill(FakeEmbedder(), "x", connect=lambda: db)
    assert bf.run_once(db) == 2
    assert {r["model"] for r in db.rows} == {"fake-model"}


def test_backfill_skips_a_chunk_that_fails():
    db = FakeDb(_rows(3))
    db.rows[1]["content"] = "poison"
    bf = Backfill(FakeEmbedder(fail_on="poison"), "x", connect=lambda: db)
    assert bf.run_once(db) == 2
    assert bf.run_once(db) == 0  # the failed one is not retried in a loop
    assert bf.stats.failed == 1


def test_backfill_survives_db_errors():
    db = FakeDb(_rows(1))
    connects = {"n": 0}

    def connect():
        connects["n"] += 1
        if connects["n"] == 1:
            raise ConnectionError("refused")
        if connects["n"] == 2:
            db.fail_next = True
        return db

    bf = Backfill(FakeEmbedder(), "x", poll_seconds=0.01, max_backoff_seconds=0.01, connect=connect)
    t = threading.Thread(target=bf.run, daemon=True)
    t.start()
    for _ in range(300):
        if db.rows[0]["model"] == "fake-model":
            break
        threading.Event().wait(0.01)
    bf.stop()
    t.join(timeout=2)
    assert db.rows[0]["model"] == "fake-model"
    assert connects["n"] >= 3


def test_passage_text_and_vector_literal():
    assert passage_text("  Opening   hours ", " Open 9 to 5 ") == "Opening hours\nOpen 9 to 5"
    assert passage_text("", "x") == "x"
    lit = vector_literal(np.array([0.5, -1.0, 1e-8], dtype=np.float32))
    assert lit.startswith("[") and lit.endswith("]") and len(lit.strip("[]").split(",")) == 3


# -- real model (skipped when the model files are not downloaded) -----------------------------------


@pytest.mark.skipif(not HAVE_MODEL, reason="model files not downloaded (python -m talkfront_embedder download)")
def test_real_model():
    from talkfront_embedder.model import Embedder

    e = Embedder(MODEL_DIR)
    # Known XLM-R ids (checked against the Hugging Face fast tokenizer).
    assert e._tokenizer.encode("query: hello") == [0, 41, 1294, 12, 33600, 31, 2]
    long_ids = e._tokenizer.encode("word " * 2000)
    assert len(long_ids) == 512 and long_ids[0] == 0 and long_ids[-1] == 2

    q = e.embed(["does it speak Urdu", "کیا یہ اردو بولتا ہے"], "query")
    p = e.embed(["We support English, Urdu and Arabic.", "We open at 9am every day."], "passage")
    assert q.shape == (2, DIMENSIONS)
    assert np.allclose(np.linalg.norm(q, axis=1), 1.0, atol=1e-4)
    sims = q @ p.T
    assert sims[0, 0] > sims[0, 1] and sims[1, 0] > sims[1, 1]
    # The prefix matters: the same text as a passage is a different vector.
    assert float(e.embed(["hello"], "query")[0] @ e.embed(["hello"], "passage")[0]) < 0.999



@pytest.mark.skipif(not HAVE_MODEL, reason="model files not downloaded")
def test_real_model_keeps_order_across_groups():
    from talkfront_embedder.model import Embedder

    e = Embedder(MODEL_DIR)
    texts = ["long " * 600, "short one", "medium text " * 40, "another short"]
    together = e.embed(texts, "passage")
    alone = np.vstack([e.embed([t], "passage") for t in texts])
    assert np.allclose(together, alone, atol=1e-6)  # one text per run: identical
