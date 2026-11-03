"""Entry point.

    python -m talkfront_embedder            # serve HTTP on :8090 and run the backfill loop
    python -m talkfront_embedder download   # fetch the pinned model files (image build step)

Environment (all optional):
    DATABASE_URL           Postgres for the backfill loop; unset = HTTP only
    EMBEDDER_TOKEN         bearer token for POST /embed; unset = open (keep the port private)
    EMBEDDER_HOST          default 0.0.0.0
    EMBEDDER_PORT          default 8090
    EMBEDDER_THREADS       onnxruntime threads, default 1
    EMBEDDER_MODEL_DIR     default <app>/model
    EMBEDDER_BATCH         chunks per backfill round, default 32
    EMBEDDER_POLL_SECONDS  idle wait between backfill rounds, default 5
"""

from __future__ import annotations

import logging
import os
import signal
import sys
import threading
import time
from pathlib import Path

DEFAULT_MODEL_DIR = Path(__file__).resolve().parents[2] / "model"


def _env_int(name: str, default: int) -> int:
    raw = os.environ.get(name, "").strip()
    return int(raw) if raw else default


def _env_float(name: str, default: float) -> float:
    raw = os.environ.get(name, "").strip()
    return float(raw) if raw else default


def serve() -> None:
    from .backfill import Backfill
    from .model import Embedder
    from .server import make_handler, make_server

    log = logging.getLogger("talkfront.embedder")
    model_dir = Path(os.environ.get("EMBEDDER_MODEL_DIR", "").strip() or DEFAULT_MODEL_DIR)
    started = time.perf_counter()
    embedder = Embedder(model_dir, threads=_env_int("EMBEDDER_THREADS", 1))
    embedder.embed(["warm up"], "query")
    log.info("loaded %s in %.1f s", embedder.model_name, time.perf_counter() - started)

    backfill = None
    database_url = os.environ.get("DATABASE_URL", "").strip()
    if database_url:
        backfill = Backfill(
            embedder,
            database_url,
            batch_size=_env_int("EMBEDDER_BATCH", 32),
            poll_seconds=_env_float("EMBEDDER_POLL_SECONDS", 5.0),
        )
        threading.Thread(target=backfill.run, name="backfill", daemon=True).start()
    else:
        log.warning("DATABASE_URL is not set: serving HTTP only, no backfill")

    token = os.environ.get("EMBEDDER_TOKEN", "").strip() or None
    handler = make_handler(
        embedder, token, lambda: {"backfill": backfill.stats.as_dict() if backfill else None}
    )
    host = os.environ.get("EMBEDDER_HOST", "0.0.0.0").strip() or "0.0.0.0"
    port = _env_int("EMBEDDER_PORT", 8090)
    httpd = make_server(host, port, handler)

    def shutdown(signum: int, _frame: object) -> None:
        log.info("signal %d, shutting down", signum)
        if backfill:
            backfill.stop()
        threading.Thread(target=httpd.shutdown, daemon=True).start()

    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT, shutdown)
    log.info("listening on %s:%d (token %s)", host, port, "on" if token else "off")
    httpd.serve_forever(poll_interval=0.5)
    httpd.server_close()


def main(argv: list[str]) -> None:
    logging.basicConfig(
        level=os.environ.get("LOG_LEVEL", "INFO").upper(),
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    if argv[:1] == ["download"]:
        from .download import main as download_main

        download_main(argv[1:])
    elif not argv or argv[:1] == ["serve"]:
        serve()
    else:
        raise SystemExit(f"unknown command {argv[0]!r}; use 'serve' or 'download'")


if __name__ == "__main__":
    main(sys.argv[1:])
