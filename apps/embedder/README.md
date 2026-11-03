# Halochime embedder

Turns text into 384-number vectors so knowledge search can match meaning, not just words.
Runs on our own server, on CPU, with no API key.

- **Model:** `intfloat/multilingual-e5-small`, the int8 ONNX export from the model authors, pinned to a
  revision and checked by sha256 at build time. 100+ languages, including English, Urdu, Hindi and Arabic.
- **Runtime:** onnxruntime (CPU, one thread) + SentencePiece. No PyTorch, no web framework.
- **Process:** one HTTP server on port 8090 plus a background loop that embeds knowledge chunks.

## Why this model

| | multilingual-e5-small int8 (chosen) | paraphrase-multilingual-MiniLM-L12-v2 | multilingual-e5-base/large |
|---|---|---|---|
| Size of vectors | 384 (matches the DB column) | 384 | 768 / 1024 (would need a migration) |
| Built for search (query vs passage) | yes | no, built for sentence similarity | yes |
| Urdu, Hindi, Arabic | yes | yes | yes |
| Model file | 118 MB | 470 MB fp32 | 1.1 GB / 2.2 GB |
| Memory in the container | about 270 MB idle, 340 MB peak | more | 1 GB+ |

int8 vs fp32 of the same model: vectors agree to cosine 0.99+ and the ranking was the same on our test
questions, at a quarter of the size. Both run on x86 and ARM64 (onnxruntime ships aarch64 wheels).

The tokenizer is the model's SentencePiece file instead of `tokenizer.json`: the token ids are identical
(checked on English, Urdu, Hindi, Arabic, CJK, emoji and 512-token texts) but it uses about 300 MB less memory.

## HTTP

```
POST /embed   {"texts": ["..."], "kind": "query" | "passage"}   (1 to 64 texts)
           -> {"model": "multilingual-e5-small-int8", "dimensions": 384, "vectors": [[...], ...]}
GET  /health  -> {"ok": true, "model": "...", "dimensions": 384, "backfill": {"embedded", "pending", "dbOk", ...}}
```

- `kind` adds e5's `query: ` / `passage: ` prefix. Use `query` for a visitor's question.
- Vectors are L2-normalised, so cosine similarity = dot product.
- Set `EMBEDDER_TOKEN` to require `Authorization: Bearer <token>` on `/embed`. On the server the port is
  not published at all, so only containers on the same Docker network can reach it.
- Logs show path, status, counts and timing, never the texts.

## Background loop

Every 5 seconds it looks for chunks where `embedding is null` or `embedding_model` is not the current model,
takes up to 32, embeds `source title + chunk text` (truncated to 512 tokens), and writes `embedding` and
`embedding_model`. It embeds one chunk at a time and waits for any live query first, so a visitor's
question never queues behind a batch. DB errors and restarts are retried with backoff (1 s up to 60 s).
`DATABASE_URL` unset = HTTP only.

Changing the model (or the variant) changes `embedding_model`, so every chunk is re-embedded automatically.
Until that finishes, old vectors are still compared with new query vectors, so do it at a quiet time.

## Environment

See `.env.example`. All optional: `DATABASE_URL`, `EMBEDDER_TOKEN`, `EMBEDDER_PORT` (8090),
`EMBEDDER_THREADS` (1), `EMBEDDER_BATCH` (32), `EMBEDDER_POLL_SECONDS` (5).

## Local

```bash
cd apps/embedder
uv sync
uv run python -m talkfront_embedder download        # once: model files into ./model (about 125 MB)
DATABASE_URL=postgres://talkfront:talkfront@localhost:5544/talkfront uv run python -m talkfront_embedder
uv run pytest -q
```

Or with Docker from the repo root: `docker compose up -d embedder` (listens on 127.0.0.1:8090).
Then set `EMBEDDER_URL=http://127.0.0.1:8090` in `apps/agent/.env`.

## Numbers

Measured on a laptop (x86) in Docker with `cpus: 0.5`, `mem_limit: 1g`, through HTTP:

| | Docker, 0.5 CPU |
|---|---|
| Query (10 to 20 tokens) | p50 26 ms, p90 67 ms, max 89 ms |
| Query while the loop re-embeds chunks | p50 36 ms, p90 73 ms, max 209 ms |
| Chunk of about 200 tokens | about 190 ms |
| Chunk of 512 tokens (the maximum) | about 1.1 s |
| Memory (RSS) | 266 MB after start, 335 MB after 64 chunks of 512 tokens |
| Start-up (load the model) | 6 to 20 s |

One Ampere ARM core (estimate, not measured on the server): about the same to 1.5x slower per token
than this laptop core for int8, so a query is about 20 to 40 ms and a typical chunk about 0.2 to 0.4 s at
`cpus: 0.5`. The arm64 image was built and run here under emulation (too slow to time): its int8 vectors
are even closer to the fp32 model (cosine 0.999 on our test questions) than x86's (0.996).

Every text runs on its own. The int8 model quantises activations per run, so batching texts (with
padding) would change their vectors slightly; on one thread it is also no faster.
