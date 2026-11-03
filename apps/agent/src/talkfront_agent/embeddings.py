"""Query embeddings from our own embedder service (apps/embedder), for semantic knowledge search.

Best effort by design: unset ``EMBEDDER_URL``, a timeout, a bad answer or any other failure gives
``None`` and the search runs on text only. A small LRU cache saves the call when the model searches
the same words twice in a conversation.

Env: ``EMBEDDER_URL`` (e.g. http://embedder:8090; unset = no embeddings), ``EMBEDDER_TOKEN`` (optional).
Logs never contain the query text or the token.
"""

from __future__ import annotations

import asyncio
import logging
import math
import os
import time
from collections import OrderedDict

import httpx

from .api import EMBEDDING_DIMENSIONS

logger = logging.getLogger("talkfront.embeddings")

EMBED_TIMEOUT_S = 1.5
CACHE_SIZE = 256


class EmbeddingClient:
    def __init__(
        self,
        base_url: str,
        *,
        token: str | None = None,
        timeout: float = EMBED_TIMEOUT_S,
        cache_size: int = CACHE_SIZE,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._headers = {"Accept": "application/json", "User-Agent": "talkfront-agent/0.1"}
        if token:
            self._headers["Authorization"] = f"Bearer {token}"
        self._timeout = timeout
        self._transport = transport
        self._cache: OrderedDict[str, list[float]] = OrderedDict()
        self._cache_size = cache_size
        # One client per event loop (tests and job processes each run their own loop).
        self._client: httpx.AsyncClient | None = None
        self._client_loop: asyncio.AbstractEventLoop | None = None

    def _http(self) -> httpx.AsyncClient:
        loop = asyncio.get_running_loop()
        if self._client is None or self._client_loop is not loop or self._client.is_closed:
            self._client = httpx.AsyncClient(
                base_url=self._base_url,
                headers=self._headers,
                timeout=httpx.Timeout(self._timeout),
                transport=self._transport,
            )
            self._client_loop = loop
        return self._client

    async def aclose(self) -> None:
        if self._client is not None and not self._client.is_closed:
            await self._client.aclose()
        self._client = None

    async def embed_query(self, query: str) -> list[float] | None:
        """The query's vector, or None when the embedder can't help right now."""
        text = " ".join(query.split())
        if not text:
            return None
        key = text.lower()
        cached = self._cache.get(key)
        if cached is not None:
            self._cache.move_to_end(key)
            return cached

        started = time.perf_counter()
        try:
            resp = await asyncio.wait_for(
                self._http().post("/embed", json={"texts": [text], "kind": "query"}),
                timeout=self._timeout,
            )
            resp.raise_for_status()
            vector = _parse_vector(resp.json())
        except (TimeoutError, asyncio.TimeoutError):
            logger.warning("embedder timed out after %.0f ms, searching text only", _ms(started))
            return None
        except Exception as e:  # noqa: BLE001 (never let embeddings break search)
            logger.warning("embedder failed (%s), searching text only", e.__class__.__name__)
            return None

        logger.debug("query embedded in %.0f ms", _ms(started))
        self._cache[key] = vector
        if len(self._cache) > self._cache_size:
            self._cache.popitem(last=False)
        return vector


def _ms(started: float) -> float:
    return (time.perf_counter() - started) * 1000


def _parse_vector(data: object) -> list[float]:
    if not isinstance(data, dict):
        raise ValueError("embedder response is not an object")
    vectors = data.get("vectors")
    if not isinstance(vectors, list) or len(vectors) != 1 or not isinstance(vectors[0], list):
        raise ValueError("embedder response has no vector")
    vector = vectors[0]
    if len(vector) != EMBEDDING_DIMENSIONS:
        raise ValueError(f"embedder returned {len(vector)} dimensions, expected {EMBEDDING_DIMENSIONS}")
    out: list[float] = []
    for x in vector:
        if isinstance(x, bool) or not isinstance(x, (int, float)) or not math.isfinite(x):
            raise ValueError("embedder vector has a non-number")
        out.append(float(x))
    return out


_default: EmbeddingClient | None = None
_default_loaded = False


def default_client() -> EmbeddingClient | None:
    """The process-wide client from env, or None when ``EMBEDDER_URL`` is unset."""
    global _default, _default_loaded
    if not _default_loaded:
        url = os.environ.get("EMBEDDER_URL", "").strip()
        token = os.environ.get("EMBEDDER_TOKEN", "").strip() or None
        _default = EmbeddingClient(url, token=token) if url else None
        _default_loaded = True
        logger.info("semantic search %s", "on" if _default else "off (EMBEDDER_URL not set)")
    return _default


async def embed_query(query: str) -> list[float] | None:
    """Shortcut used by the search tool: None when embeddings are off or failing."""
    client = default_client()
    if client is None:
        return None
    return await client.embed_query(query)


def reset_default_client() -> None:
    """For tests: re-read the environment on next use."""
    global _default, _default_loaded
    _default, _default_loaded = None, False
