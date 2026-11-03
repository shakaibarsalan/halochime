# Contracts

Three parts talk to each other. The TypeScript shapes live in
[`packages/shared/src/contracts.ts`](../packages/shared/src/contracts.ts). The Python agent copies
the internal shapes by hand in `apps/agent/src/talkfront_agent/api.py`, so change both together.

Errors from every API are `{ "error": { "code": "...", "message": "..." } }` with a 4xx/5xx status.

## 1. Widget → web (public)

The embed snippet:

```html
<script src="https://APP_URL/widget.js" data-key="pk_..." async></script>
```

| Call | Body / query | Returns |
|---|---|---|
| `GET /api/widget/config?key=pk_...` | | `WidgetConfigResponse` |
| `POST /api/widget/session` | `WidgetSessionRequest` | `WidgetSessionResponse` |

Rules for both:

- CORS: answer `OPTIONS`, and echo the request `Origin` only when it is allowed.
- Allowed origin = the agent's `allowedDomains` (exact host or `*.host`), plus the app's own origin
  (dashboard test), plus `localhost` / `127.0.0.1` when `NODE_ENV !== "production"`.
- The agent must be `published`, except when the request comes from the app's own origin (testing a draft).
- `session` refuses with `402 out_of_credit` when the workspace wallet is at or below 0 seconds and
  mode is `voice`.
- `session` creates the `conversations` row, then mints a LiveKit access token:
  - identity `visitor-<random>`, room `tf-<conversationId>`, grants: join, publish, subscribe, publish data
  - TTL 15 minutes for joining
  - `roomConfig.agents = [{ agentName: "talkfront-agent", metadata: JSON.stringify(DispatchMetadata) }]`
    so LiveKit dispatches our worker into that room.
- Basic abuse guard: at most 10 sessions per IP per 10 minutes (in-memory is fine for the skeleton).
- The widget sends `page.url` as origin + path only (query strings and hashes can carry tokens).

Error codes for the public API (the widget shows a friendly message per code):

| Status | `error.code` | When |
|---|---|---|
| 400 | `invalid_request` | body or query fails validation |
| 402 | `out_of_credit` | voice session with an empty wallet |
| 403 | `origin_not_allowed` | origin not in the allowed list (config and session both check) |
| 404 | `not_found` | unknown key, or agent not published (outside the app's own origin) |
| 429 | `rate_limited` | too many sessions from one IP |
| 503 | `not_configured` | LiveKit env vars missing |

## 2. Agent → web (internal)

Every call sends `Authorization: Bearer $INTERNAL_API_SECRET`. Compare it in constant time; reject
with 401 otherwise. These routes are never called by browsers, so no CORS.

| Call | Body | Returns |
|---|---|---|
| `GET /api/internal/runtime/:conversationId` | | `RuntimeConfig` |
| `POST /api/internal/knowledge/search` | `KnowledgeSearchRequest` | `KnowledgeSearchResponse` |
| `POST /api/internal/conversations/:id/messages` | `AppendMessagesRequest` | `204` |
| `POST /api/internal/conversations/:id/handoff` | `HandoffRequest` | `{ "ok": true }` |
| `POST /api/internal/conversations/:id/end` | `EndConversationRequest` | `{ "ok": true }` |

- `runtime` builds the full `systemPrompt` on the web side (persona, business rules, voice style,
  tool rules, visitor info). The agent never assembles prompts itself.
- `knowledge/search` only searches chunks of the conversation's workspace whose source is shared
  (`agent_id is null`) or belongs to that agent.
- `end` is idempotent: it marks the conversation ended, stores `durationSec`, deducts voice seconds
  from the wallet once (rounded up to whole minutes), writes a `usage_events` row, and in the background
  writes the summary and the collected information (`collected_data`, see integrations.md section 5) with
  Anthropic or Groq, then sends emails and webhooks.

## 3. Widget ↔ agent (LiveKit room)

- Voice mode: the widget publishes its microphone and plays the agent's audio track. Live captions
  come from LiveKit transcription text streams on topic `lk.transcription` (both the visitor's and the
  agent's words; the stream attributes say which participant and whether it is final).
- Text mode: the widget sends each message with `room.localParticipant.sendText(text, { topic: "lk.chat" })`.
  The agent runs without audio and replies on `lk.transcription`.
- The agent speaks/sends `RuntimeConfig.agent.greeting` first.
- Either side leaving ends the session. The agent then calls `/end`.

## Environment variables

| Name | Used by | Notes |
|---|---|---|
| `DATABASE_URL` | web | Postgres 15+ (docker compose gives `postgres://talkfront:talkfront@localhost:5544/talkfront`) |
| `BETTER_AUTH_SECRET` | web | 32+ random bytes |
| `BETTER_AUTH_URL`, `NEXT_PUBLIC_APP_URL` | web | e.g. `http://localhost:3000` |
| `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | web, agent | LiveKit Cloud project or self-hosted server |
| `INTERNAL_API_SECRET` | web, agent | shared secret for the internal API |
| `LIVEKIT_AGENT_NAME` | web, agent | optional, same on both; default `talkfront-agent` (use a dev name locally) |
| `TALKFRONT_API_URL` | agent | base URL of the web app |
| `DEEPGRAM_API_KEY` | agent | speech to text and text to speech |
| `GROQ_API_KEY` | agent, web | replies with Groq models (agent) and summaries (web) |
| `ANTHROPIC_API_KEY` | agent, web | replies with Claude models (agent) and summaries (web, preferred when set) |
