# Halochime

A voice-first support agent that any business can put on its website or user portal with one script tag.
Visitors just talk (or type). The agent answers from the business's own knowledge, and later from its CRM
and database, and hands off to a human when it should.

Status: Phase 1 skeleton. See [docs/roadmap.md](docs/roadmap.md).

## How it fits together

- `apps/web`: Next.js dashboard, public widget API, internal API for the agent
- `apps/agent`: Python LiveKit worker that listens, thinks and speaks
- `packages/widget`: the embeddable `<talkfront-widget>`
- `packages/shared`: contracts shared by web and widget

Details: [docs/architecture.md](docs/architecture.md) and [docs/contracts.md](docs/contracts.md).

## Run it locally

Needs Node 22+, Python 3.11+ with [uv](https://docs.astral.sh/uv/), and Docker (or any Postgres 15+).

```bash
npm install
npm run db:up                      # Postgres on localhost:5544
cp apps/web/.env.example apps/web/.env.local   # then fill it in
npm run db:migrate
npm run dev                        # builds the widget, then http://localhost:3000
```

Voice agent, in a second terminal:

```bash
cd apps/agent
cp .env.example .env               # then fill it in
uv sync
uv run python -m talkfront_agent download-files   # one-time model download
uv run python -m talkfront_agent dev
```

Keys you need for voice: a LiveKit project (URL, API key, secret), a Deepgram key, and a Groq key (or an Anthropic key for Claude models).
Without them the dashboard still runs; starting a voice or text session shows a clear "not configured" error.

## Embed

```html
<script src="https://YOUR_APP_URL/widget.js" data-key="pk_..." async></script>
```

The dashboard shows the exact snippet for each agent, and the agent only answers on the domains you allow.

## License

Copyright (C) 2026 Shakaib Arsalan.

Halochime is free software: you can use, change and share it under the terms of the
[GNU Affero General Public License v3](LICENSE) (AGPL-3.0-only). If you run a changed version as a
service for others, the AGPL asks you to offer them its source code too.
Icons and other parts from other projects are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

