# Deploying Halochime

Production today:

| Piece | Where | Notes |
|---|---|---|
| Web app (dashboard, widget API, internal API, `widget.js`) | Vercel, personal team `shakaib`, project `talkfront`, region `bom1` (Mumbai) | https://halochime.vercel.app |
| Postgres 17 + pgvector | Oracle Ampere server, container `talkfront-db`, port 5544 | TLS only for the app role, admin role local only |
| Voice agent worker | Same server, container `talkfront-agent` | Talks to LiveKit Cloud and the web app's internal API |

Both containers are capped (`cpus`, `mem_limit`) because the server also runs other projects.

## Server layout (`~/talkfront` on the server)

```
docker-compose.yml   # from deploy/server/
pg_hba.conf          # from deploy/server/
db-init/             # from deploy/server/ (runs once, creates the app role)
certs/               # self-signed TLS cert for Postgres (owned by uid 999)
db.env               # POSTGRES_PASSWORD, APP_DB_PASSWORD (secret, chmod 600)
agent.env            # TALKFRONT_API_URL, INTERNAL_API_SECRET, LIVEKIT_*, DEEPGRAM_API_KEY, GROQ_API_KEY
agent/               # copy of apps/agent (build context)
embedder.env         # DATABASE_URL for the embedder (secret, chmod 600)
embedder/            # copy of apps/embedder (build context)
```

Secrets live only in `db.env`, `agent.env`, the Vercel project's environment variables, and the
git-ignored `deploy/.env.production` on the developer machine. Never commit them.

## Update the voice agent

```bash
tar --exclude=.venv --exclude=__pycache__ --exclude=.env --exclude=tests -czf - -C apps/agent . \
  | ssh ubuntu@SERVER 'rm -rf ~/talkfront/agent && mkdir -p ~/talkfront/agent && tar -xzf - -C ~/talkfront/agent'
ssh ubuntu@SERVER 'cd ~/talkfront && docker compose build agent && docker compose up -d agent'
```

## Embedder (semantic search)

Container `talkfront-embedder` runs `apps/embedder`: multilingual-e5-small (int8 ONNX, 384 numbers per text)
on CPU. It embeds knowledge chunks in the background and the visitor's question when the agent searches.
No published port; the agent reaches it at `http://embedder:8090` on the compose network. Capped at
`cpus: 0.5`, `mem_limit: 1g` (it uses about 270 to 340 MB). The image builds on the server itself (ARM64).

First deploy. On the developer machine, from the repo root:

```bash
tar --exclude=.venv --exclude=__pycache__ --exclude=.env --exclude=tests --exclude=model \
    --exclude=.pytest_cache -czf - -C apps/embedder . \
  | ssh ubuntu@SERVER 'rm -rf ~/talkfront/embedder && mkdir -p ~/talkfront/embedder && tar -xzf - -C ~/talkfront/embedder'
scp deploy/server/docker-compose.yml ubuntu@SERVER:~/talkfront/docker-compose.yml
```

On the server (`ssh ubuntu@SERVER`, then `cd ~/talkfront`):

```bash
# embedder.env, once: the app role over TLS to the db container (password URL-encoded)
( set -a; . ./db.env; set +a; umask 077
  python3 -c 'import os, urllib.parse as u; print("DATABASE_URL=postgres://talkfront_app:" + u.quote(os.environ["APP_DB_PASSWORD"], safe="") + "@db:5432/talkfront?sslmode=require")' > embedder.env )

# Build (downloads the model files, about 125 MB, sha256 checked) and start
docker compose build embedder && docker compose up -d embedder

# Check: "loaded multilingual-e5-small-int8", "backfill connected", then "embedded N chunks ... 0 left"
docker compose logs --tail 20 embedder
docker exec talkfront-embedder /app/.venv/bin/python -c 'import urllib.request; print(urllib.request.urlopen("http://127.0.0.1:8090/health").read().decode())'
docker stats --no-stream talkfront-embedder
```

Then update the voice agent as above (it now has `embeddings.py`), and recreate it so it gets
`EMBEDDER_URL` from the compose file: `docker compose up -d agent`. This drops live calls, so pick a quiet
moment. The web app (Vercel) needs the new `lib/knowledge/search.ts`; the order does not matter: an
old web app ignores the `embedding` field, and an agent without `EMBEDDER_URL` sends none.

Later updates: copy the build context again, then `docker compose build embedder && docker compose up -d embedder`. If you set `EMBEDDER_TOKEN` in `embedder.env`, put the same value in
`agent.env`.

Turn it off: `docker compose stop embedder`. The agent's embed call fails fast and search runs on text
only (the agent logs "embedder failed ... searching text only"). Chunks keep their vectors.

Expected on the Ampere server (estimated from laptop numbers, not measured there yet): a query takes
about 20 to 40 ms, a typical chunk (about 200 tokens) about 0.2 to 0.4 s at `cpus: 0.5`, so 1,000 chunks
take about 5 minutes the first time. The loop embeds one chunk at a time and lets queries go first.

## Update the web app

Push to `main` is not wired to Vercel yet; deploy with the CLI from a clean checkout:

```bash
VERCEL_ORG_ID=<team id> VERCEL_PROJECT_ID=<project id> vercel deploy --prod --yes
```

## Database migrations

```bash
ssh -f -N -L 15544:127.0.0.1:5544 ubuntu@SERVER
cd apps/web && DATABASE_URL="postgres://talkfront_app:<APP_DB_PASSWORD>@127.0.0.1:15544/talkfront?sslmode=require" npx drizzle-kit migrate
```

## Local development next to production

Local and production share the LiveKit project, so set `LIVEKIT_AGENT_NAME=talkfront-agent-dev` in both
`apps/web/.env.local` and `apps/agent/.env`. Local calls then never reach the production worker.
