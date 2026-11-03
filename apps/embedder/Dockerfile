# Talkfront embedder: multilingual-e5-small (int8 ONNX) on CPU. Builds on amd64 and arm64 (e.g. Oracle Ampere).
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/app/.venv \
    EMBEDDER_MODEL_DIR=/app/model \
    MALLOC_ARENA_MAX=2

RUN pip install --no-cache-dir uv==0.12.15 \
 && useradd --create-home --uid 10002 embedder

WORKDIR /app
COPY pyproject.toml uv.lock README.md ./
RUN uv sync --frozen --no-dev --no-install-project
COPY src ./src
RUN uv sync --frozen --no-dev

# Model files are baked into the image (pinned revision, sha256 checked), so start-up needs no network.
ARG EMBEDDER_VARIANT=int8
RUN /app/.venv/bin/python -m talkfront_embedder download --variant "$EMBEDDER_VARIANT" \
 && chown -R embedder:embedder /app

USER embedder
EXPOSE 8090
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["/app/.venv/bin/python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8090/health', timeout=4)"]

# Python directly (not `uv run`) so SIGTERM reaches the process and no extra process sits in memory.
CMD ["/app/.venv/bin/python", "-m", "talkfront_embedder"]
