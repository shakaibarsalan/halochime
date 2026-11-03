# Talkfront voice agent worker. Builds on amd64 and arm64 (e.g. Oracle Ampere).
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/app/.venv

RUN pip install --no-cache-dir uv==0.12.15 \
 && useradd --create-home --uid 10001 agent

WORKDIR /app
COPY pyproject.toml uv.lock README.md ./
RUN uv sync --frozen --no-dev --no-install-project
COPY src ./src
RUN uv sync --frozen --no-dev && chown -R agent:agent /app  && mkdir -p /home/agent/cache && chown agent:agent /home/agent/cache

USER agent
# Turn detector and VAD model files are baked into the image so workers start fast.
RUN uv run --no-sync python -m talkfront_agent download-files

CMD ["uv", "run", "--no-sync", "python", "-m", "talkfront_agent", "start"]
