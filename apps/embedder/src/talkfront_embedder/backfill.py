"""Background loop: embeds knowledge chunks that have no embedding yet, or one from another model.

One DB connection, autocommit. Survives DB restarts and errors with exponential backoff.
Logs counts and timings only, never chunk text or the connection string.
"""

from __future__ import annotations

import logging
import threading
import time
from dataclasses import dataclass, field
from typing import Any, Protocol

import numpy as np

logger = logging.getLogger("talkfront.embedder.backfill")

SELECT_PENDING = """
select c.id, coalesce(s.title, ''), c.content
from knowledge_chunks c
join knowledge_sources s on s.id = c.source_id
where (c.embedding is null or c.embedding_model is distinct from %(model)s)
  and not (c.id = any(%(skip)s::text[]))
order by (c.embedding is not null), c.created_at, c.position
limit %(limit)s
"""

UPDATE_EMBEDDING = """
update knowledge_chunks set embedding = %s::vector, embedding_model = %s where id = %s
"""

COUNT_PENDING = """
select count(*) from knowledge_chunks where embedding is null or embedding_model is distinct from %(model)s
"""


class EmbedsPassages(Protocol):
    model_name: str

    def embed(self, texts: list[str], kind: Any) -> np.ndarray: ...
    def wait_for_queries(self, timeout: float = 5.0) -> None: ...


def passage_text(title: str, content: str) -> str:
    """What gets embedded for a chunk: the source title, then the chunk. The tokenizer truncates."""
    title = " ".join(title.split())
    content = content.strip()
    return f"{title}\n{content}" if title else content


def vector_literal(vec: np.ndarray) -> str:
    return "[" + ",".join(f"{x:.7g}" for x in vec.tolist()) + "]"


@dataclass
class BackfillStats:
    embedded: int = 0
    failed: int = 0
    last_batch_ms: float = 0.0
    last_error: str | None = None
    db_ok: bool = False
    pending: int | None = None
    started_at: float = field(default_factory=time.time)

    def as_dict(self) -> dict[str, Any]:
        return {
            "embedded": self.embedded,
            "failed": self.failed,
            "pending": self.pending,
            "lastBatchMs": round(self.last_batch_ms, 1),
            "dbOk": self.db_ok,
            "lastError": self.last_error,
        }


class Backfill:
    def __init__(
        self,
        embedder: EmbedsPassages,
        database_url: str,
        *,
        batch_size: int = 32,
        poll_seconds: float = 5.0,
        max_backoff_seconds: float = 60.0,
        connect: Any = None,
    ) -> None:
        self.embedder = embedder
        self.database_url = database_url
        self.batch_size = batch_size
        self.poll_seconds = poll_seconds
        self.max_backoff_seconds = max_backoff_seconds
        self.stats = BackfillStats()
        self._stop = threading.Event()
        self._skip: set[str] = set()  # chunks that failed to embed in this process; retried after restart
        self._connect = connect or self._default_connect

    def _default_connect(self) -> Any:
        import psycopg

        # Keepalives + statement timeout: a dead network or a stuck query raises instead of hanging.
        return psycopg.connect(
            self.database_url,
            autocommit=True,
            connect_timeout=10,
            application_name="talkfront-embedder",
            keepalives=1,
            keepalives_idle=30,
            keepalives_interval=10,
            keepalives_count=3,
            options="-c statement_timeout=30000",
        )

    def stop(self) -> None:
        self._stop.set()

    def run_once(self, conn: Any) -> int:
        """Embeds one batch. Returns how many chunks were written."""
        model = self.embedder.model_name
        with conn.cursor() as cur:
            cur.execute(SELECT_PENDING, {"model": model, "skip": list(self._skip), "limit": self.batch_size})
            rows = cur.fetchall()
        if not rows:
            self.stats.pending = 0
            return 0
        started = time.perf_counter()
        updates: list[tuple[str, str, str]] = []
        for chunk_id, title, content in rows:
            if self._stop.is_set():
                break
            # One passage at a time: on a CPU with one thread batching gains little, and a live
            # query never waits behind more than one chunk.
            self.embedder.wait_for_queries()
            try:
                vec = self.embedder.embed([passage_text(title, content)], "passage")[0]
            except Exception as e:  # noqa: BLE001 (one bad chunk must not stop the loop)
                self._skip.add(chunk_id)
                self.stats.failed += 1
                logger.error("embedding chunk %s failed: %s", chunk_id, e.__class__.__name__)
                continue
            updates.append((vector_literal(vec), model, chunk_id))
        if updates:
            with conn.cursor() as cur:
                cur.executemany(UPDATE_EMBEDDING, updates)
        elapsed = (time.perf_counter() - started) * 1000
        self.stats.embedded += len(updates)
        self.stats.last_batch_ms = elapsed
        with conn.cursor() as cur:
            cur.execute(COUNT_PENDING, {"model": model})
            self.stats.pending = int(cur.fetchone()[0])
        logger.info(
            "embedded %d chunks in %.0f ms (%.0f ms each), %s left",
            len(updates), elapsed, elapsed / max(1, len(updates)), self.stats.pending,
        )
        return len(updates)

    def run(self) -> None:
        backoff = 1.0
        conn = None
        while not self._stop.is_set():
            try:
                if conn is None or conn.closed:
                    conn = self._connect()
                    self.stats.db_ok = True
                    self.stats.last_error = None
                    logger.info("backfill connected to the database")
                written = self.run_once(conn)
                backoff = 1.0
                if written < self.batch_size:
                    self._stop.wait(self.poll_seconds)
            except Exception as e:  # noqa: BLE001 (DB restarts, network errors, bad rows)
                self.stats.db_ok = False
                self.stats.last_error = e.__class__.__name__
                logger.warning("backfill error (%s), retrying in %.0f s", e.__class__.__name__, backoff)
                if conn is not None:
                    try:
                        conn.close()
                    except Exception:  # noqa: BLE001
                        pass
                    conn = None
                self._stop.wait(backoff)
                backoff = min(self.max_backoff_seconds, backoff * 2)
        if conn is not None:
            try:
                conn.close()
            except Exception:  # noqa: BLE001
                pass
