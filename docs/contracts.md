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
| `GET /api/widget/config?key=pk_...&vid=...` | `vid` optional: the widget's visitor id | `WidgetConfigResponse` |
| `POST /api/widget/session` | `WidgetSessionRequest` | `WidgetSessionResponse` |

A/B tests (agent versions): while an agent runs a test, `session` picks version A or B for each new
conversation from a hash of the test id and the visitor id (the widget's `visitorId`, else the identity
token's `sub`), stores it on the conversation, and the runtime config serves that version's greeting,
persona, business rules, language, voice and models. `config` with `vid` shows the same version's
greeting, so the greeting on screen matches the conversation. Without a running test nothing changes.

`poweredBy` follows the workspace's white label setting: Halochime (default, no setting), absent
(hidden), or the agency's own name and link.

Rules for both:

- CORS: answer `OPTIONS`, and echo the request `Origin` only when it is allowed.
- Allowed origin = the agent's `allowedDomains` (exact host or `*.host`), plus the app's own origin
  (dashboard test), plus `localhost` / `127.0.0.1` when `NODE_ENV !== "production"`.
- The agent must be `published`, except when the request comes from the app's own origin AND carries a
  signed-in session of a member of the agent's workspace (the dashboard's test widget; the widget sends
  cookies only to its own origin).
- `session` refuses a `voice` session with `402 out_of_credit` unless the wallet holds 60 seconds for
  every voice call already running in the workspace plus this one (`lib/widget/limits.ts`).
- `session` creates the `conversations` row, then mints a LiveKit access token:
  - identity `visitor-<random>`, room `tf-<conversationId>`, grants: join, publish, subscribe, publish data
  - TTL 15 minutes for joining
  - `roomConfig.agents = [{ agentName: "talkfront-agent", metadata: JSON.stringify(DispatchMetadata) }]`
    so LiveKit dispatches our worker into that room.
- Abuse guards: at most 10 sessions per IP per 10 minutes (in-memory, first cheap layer); then, counted
  in the database under a per-workspace lock: at most 60 new sessions per agent per minute, 10 running
  voice calls and 50 running text chats per workspace ("running" = not ended and started in the last
  65 minutes).
- The widget sends `page.url` as origin + path only (query strings and hashes can carry tokens).

Error codes for the public API (the widget shows a friendly message per code):

| Status | `error.code` | When |
|---|---|---|
| 400 | `invalid_request` | body or query fails validation |
| 402 | `out_of_credit` | voice session without enough minutes (see above) |
| 403 | `origin_not_allowed` | origin not in the allowed list (config and session both check) |
| 404 | `not_found` | unknown key, or agent not published (outside a signed-in member's dashboard) |
| 429 | `rate_limited` | too many sessions from one IP, too many new sessions for the agent, or the workspace's running-call limit is full (with `Retry-After`) |
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
| `POST /api/internal/conversations/:id/takeover` | `TakeoverRequest` | `204` |
| `POST /api/internal/phone/calls` | `{ agentId, organizationId, channelId, roomName, callerNumber?, calledNumber?, trunkId?, callId? }` | `{ "conversationId": "..." }` |

- `runtime` builds the full `systemPrompt` on the web side (persona, business rules, voice style,
  tool rules, visitor info). The agent never assembles prompts itself, with one exception: with
  `pageGuide` on, it appends the visitor's current page (from `tf.page`, it changes during the conversation)
  as a "Current page" section (apps/agent/src/talkfront_agent/page_guide.py).
- `runtime` also says `pageGuide: true` (page guide on) and `helpOffer: { reason, message, opener }` (the
  visitor came from the help bubble; voice calls start with `opener` instead of the greeting). Both absent
  when off.
- `knowledge/search` only searches chunks of the conversation's workspace whose source is shared
  (`agent_id is null`) or belongs to that agent.
- `end` is idempotent: it marks the conversation ended, stores `durationSec`, deducts voice seconds
  from the wallet once (rounded up to whole minutes), writes a `usage_events` row, and in the background
  writes the summary and the collected information (`collected_data`, see integrations.md section 5) with
  Anthropic or Groq, then sends emails and webhooks.
- `messages` roles: `user`, `assistant`, `tool`, `system`, and `staff` (a person from the business who
  took the conversation over in the live inbox). The visitor's, staff and system lines are sent within
  about a second, so the live inbox shows them as they happen; the rest every few seconds.
- `takeover` (`{ "state": "released" }`): the agent handed a taken over conversation back to the AI by
  itself, after 3 minutes with no word from the team member. It clears the takeover columns. Idempotent.

- `phone/calls` opens the conversation of a phone call (channel `phone`, mode `voice`, the caller's number
  as `visitor_id`), with the same limits and minutes check as a widget voice call. Refusals use the widget
  codes: 402 `out_of_credit`, 429 `rate_limited`; 404 / 409 `channel_disabled` when the channel is gone or off;
  403 when `trunkId` is not the channel's trunk. Idempotent per `roomName`. The agent then tells the caller
  one sentence and hangs up (apps/agent `phone.py`).

### Phone calls (LiveKit SIP)

A phone call has no widget session. The dispatch rule the Channels page creates (one per number, type
`individual`, room prefix `tf-phone`, the number's own inbound trunk only) dispatches the worker with this
metadata instead of `DispatchMetadata`:

```json
{ "channel": "phone", "agentId": "...", "organizationId": "...", "channelId": "..." }
```

The worker waits for the SIP participant (`sip.phoneNumber`, `sip.trunkPhoneNumber`, `sip.trunkID`,
`sip.callID` attributes), calls `phone/calls`, then runs the normal voice flow. For a SIP caller the
widget-only features are off: live captions, the ready-made greeting audio, the `tf.reply_cut` notice.

## 3. Widget ↔ agent (LiveKit room)

- Voice mode: the widget publishes its microphone and plays the agent's audio track. Live captions
  come from LiveKit transcription text streams on topic `lk.transcription` (both the visitor's and the
  agent's words; the stream attributes say which participant and whether it is final).
- Text mode: the widget sends each message with `room.localParticipant.sendText(text, { topic: "lk.chat" })`.
  The agent runs without audio and replies on `lk.transcription`.
- The agent speaks/sends `RuntimeConfig.agent.greeting` first.
- Page guide (only when on): the widget sends `tf.page` (JSON `{ path, title, elements: [{ id, role, label }] }`)
  to the agent; the agent sends `tf.point` (JSON `{ id, label }`) to highlight one of those elements.
- Either side leaving ends the session. The agent then calls `/end`.

### Live inbox (a person from the team takes over)

- The dashboard (`/app/live`) sends commands to the agent alone with LiveKit's server API
  (`RoomServiceClient.sendData`, reliable, topic `tf.staff`, to the agent's identity only), JSON:
  `{ "type": "takeover", "name" }`, `{ "type": "say", "text", "id", "name" }`, `{ "type": "release" }`.
  `name` is the member's first name as the visitor sees it. The agent acts only on data sent by the
  server (no sending participant), never on data a visitor's browser publishes on that topic.
- While taken over the AI does not answer, check in or end the call. The visitor's words are saved as
  usual. "say": voice calls speak the text in the agent's voice (normal agent captions); text chats send
  it on `tf.staff_reply` (JSON `{ id, name, text }`). Saved with role `staff`.
- The agent tells the widget on `tf.notice` (JSON `{ type: "joined" | "left", text, name }`) and saves
  the same words as `system` lines: "Sam from the team joined the chat", "You're back with Ava".
- After 3 minutes with no command the agent hands back by itself and calls `takeover` (section 2).
  The model's chat history keeps what the team member said, so the AI carries on from there.

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
| `LIVEKIT_SIP_URI` | web | optional; the LiveKit project's SIP URI (Cloud dashboard, Settings), e.g. `sip:abc123.sip.livekit.cloud`. Without it phone calls stay unavailable |
| `OPENAI_API_KEY` | web | optional for WhatsApp: voice notes (gpt-4o-transcribe, gpt-4o-mini-tts) and replies when the agent's model is not on Groq |
| `DEEPGRAM_API_KEY` | agent | speech to text and text to speech |
| `GROQ_API_KEY` | agent, web | replies with Groq models (agent) and summaries (web) |
| `ANTHROPIC_API_KEY` | agent, web | replies with Claude models (agent) and summaries (web, preferred when set) |
| `ELEVENLABS_API_KEY` | agent, web | optional: ElevenLabs voices (agent speaks with them; web shows them and creates/deletes brand voice clones) |
| `CARTESIA_API_KEY` | agent, web | optional: Cartesia voices (agent speaks with them; web shows them when set) |
| `VOICE_PROVIDERS` | web | optional: `elevenlabs,cartesia` shows those voices without putting the key on the web app (cloning still needs `ELEVENLABS_API_KEY` there) |
