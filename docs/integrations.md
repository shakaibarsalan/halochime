# Integrations

How a business connects its website and systems to Halochime, and how Halochime connects to theirs.
Shapes live in `packages/shared/src/contracts.ts`; tables in `apps/web/src/db/schema/app.ts`
(migration `0002`). Change both sides together.

| Direction | Feature | What it is for |
|---|---|---|
| Their site -> us | Embed | One script tag on any website or portal |
| Their site -> us | JS API | Open/close the widget from their own buttons; sign in the visitor |
| Their server -> us | Identity token | Tell the agent who the logged-in user is (and facts like plan, orders) |
| Us -> their server | Actions | The agent calls their HTTP API during a conversation (order status, booking, CRM lookup) |
| Us -> their server | Webhooks | We POST events (conversation ended, message for the team) to their URL: CRM, Slack, Zapier, n8n |

## 1. Embed

```html
<script src="https://APP_URL/widget.js" data-key="pk_..." async></script>
```

- Paste before `</body>`. Works on any site that allows custom code: plain HTML, Next.js/React (`next/script`
  with `strategy="afterInteractive"`), WordPress (footer code plugin or theme), Shopify (`theme.liquid`),
  Webflow/Wix/Squarespace (custom code settings), Google Tag Manager (Custom HTML tag).
- How it renders on their page: the script defines a `<talkfront-widget>` custom element and appends it to
  `<body>`. All markup and CSS live inside its Shadow DOM, so the site's styles can't break the widget and
  the widget can't change the site. It loads async, fetches the agent's config, and connects voice/chat only
  when the visitor opens it.
- The agent only starts on hostnames listed in the agent's allowed domains (`example.com`, `*.example.com`).
- Content-Security-Policy, if the site has one: `script-src APP_URL`, `connect-src APP_URL wss://*.livekit.cloud
  https://*.livekit.cloud` (or the self-hosted LiveKit host), `style-src 'unsafe-inline'` (the widget's `<style>`
  sits inside its Shadow DOM), and microphone permission for voice (`Permissions-Policy: microphone=(self)` if
  they send that header). The Install page and /docs print these from `LIVEKIT_URL` (`cspSources()` in
  `app/docs/_content/platforms.tsx`).
- Step-by-step guides per platform live in `app/docs/_content/platforms.tsx`, shared by the dashboard Install
  page (`/app/install`, with "Check my site") and the public docs (`/docs`).

## 2. JS API

`window.Halochime` exists once the script has loaded. To call it earlier, queue calls:

```js
window.Halochime = window.Halochime || { q: [] };
// ...the loader replays queued calls, see below
```

| Call | Does |
|---|---|
| `Halochime.open()` | Opens the panel |
| `Halochime.close()` | Closes it |
| `Halochime.identify({ token })` | Signs in the visitor for the next conversation (identity token, section 3) |
| `Halochime.logout()` | Forgets the identity (call on sign-out) |

The token can also be given on the tag: `data-identity-token="eyJ..."` (server-rendered pages).
Pre-load queue: if `window.Halochime.q` is an array of `[method, ...args]` when the script loads, the loader
runs them in order after mounting (after `data-identity-token`, so a queued `identify` wins). After load,
`Halochime.q.push([...])` runs the call at once, so `window.Halochime.q.push(["identify", { token }])` works
before and after the script loads.

- The token is kept in memory only (never in storage) and is sent as `identityToken` in
  `POST /api/widget/session`. It applies to the next conversation; a live one keeps the identity it started with.
- The loader only checks the token looks like a JWT (3 base64url parts, at most 4,096 characters); anything else
  is ignored with a console warning. The server does the real check.

## 3. Identity token (portal users)

The business's **server** signs a JWT with the agent's identity secret (Agent -> Signed-in visitors, shown once,
can be regenerated or removed; owners and admins only). Never sign in the browser.

- Secret: `tfid_` + 48 random url-safe characters. Stored in `agents.identity_secret` encrypted the same way as
  action headers (below) but with HKDF info `talkfront-identity-secret`, bound to the agent id
  (`lib/identity.ts`). A plain (unencrypted) value still works, for hand-made dev rows.

- Algorithm: HS256 only. Header `{"alg":"HS256","typ":"JWT"}`.
- Claims (`IdentityTokenClaims`): `sub` (their user id, required), `name?`, `email?`,
  `attributes?` (flat object, keys `^[A-Za-z][A-Za-z0-9_]{0,39}$`, values string <= 500 chars / number /
  boolean, at most 30 keys), `iat`, `exp` (required, at most 24 h after `iat`, 60 s clock skew allowed;
  `iat` more than 60 s in the future is refused).

```js
// Node, on their server
import jwt from "jsonwebtoken";
const token = jwt.sign(
  { sub: user.id, name: user.name, email: user.email, attributes: { plan: "pro", open_orders: 2 } },
  process.env.HALOCHIME_IDENTITY_SECRET,
  { algorithm: "HS256", expiresIn: "1h" },
);
```

Checked in `POST /api/widget/session`:
- valid token -> `conversations.visitor_id = sub`, `visitor_name`, `visitor_email`, `visitor_attributes`,
  `visitor_verified = true`;
- invalid/expired token, or no secret set -> the session still starts as an anonymous visitor
  (never block the visitor), and a short reason code is logged server-side (`expired`, `bad_signature`,
  `too_long`, `bad_attributes`, ...), never the token.

The runtime (`RuntimeConfig.visitor`) carries `verified` and `attributes` (attributes only when verified); the
system prompt tells the agent who it is talking to and to treat verified facts as true, and never to read
attributes out unprompted. Unverified visitors: the prompt says to rely only on what they say.

The dashboard's "Check a token" box verifies a pasted token with the same code and shows the claims, or the
exact problem plus the (unverified) decoded claims.

## 4. Actions (agent -> their HTTP API)

Defined per agent in the dashboard (Agent -> Actions; owners and admins add, edit, test, turn off and
delete). Table `agent_actions`. Code: `lib/actions/` (`schema.ts` rules and JSON Schema, `crypto.ts`,
`runner.ts`), dashboard in `app/app/agents/[id]/actions-panel.tsx` + `http-actions.ts`.

- `name`: `^[a-z][a-z0-9_]{0,39}$`, unique per agent (the tool name the model sees). The agent's own tool
  names (`search_knowledge`, `request_human`, `confirm_message`) are refused, and skipped by the runtime and
  the voice agent if one ever gets in. At most 20 actions per agent, 20 inputs and 20 headers per action.
- `description`: when to use it, in plain words (the model reads it).
- `method`: `GET` (arguments go in the query string) or `POST` (arguments as a JSON body).
- `url`: `https://` only. Called with `safeRequest` (`lib/knowledge/safe-fetch.ts`): the same SSRF rules as knowledge import
  (no private, loopback or link-local addresses, checked after DNS). Test against public echo services.
- `headers`: e.g. `Authorization: Bearer ...`. Stored encrypted (AES-256-GCM, key derived from
  `BETTER_AUTH_SECRET` with HKDF-SHA256, info `talkfront-action-headers`, the action id as additional data).
  Format `v1.<iv>.<tag>.<ciphertext>` (base64url). Values are never sent back to the browser: the form shows
  the names, and a blank value keeps the saved one. `Host`, `Content-Type`, `Content-Length`, `Connection`,
  `Accept-Encoding`, `Transfer-Encoding`, `TE`, `Upgrade`, `Expect` and `X-Halochime-*` can't be set.
  Changing `BETTER_AUTH_SECRET` makes saved headers (and identity secrets) unreadable: the action then
  refuses to run and the dashboard asks for the headers again.
- `parameters`: `ActionParameter[]` -> JSON Schema `{ type: "object", properties, required,
  additionalProperties: false }` for the model (`enum` only for text inputs).
- `timeoutMs`: default 8000, min 1000, max 15000.

Arguments are checked against the parameters before any call: missing required values, wrong types and
values outside `enum` come back as `ok: false` with a sentence the model can act on ("Missing order_id. Ask
the visitor for it, then try again."). Unknown keys are dropped; `"3"` -> `3` and `"true"` -> `true` are
accepted; enum matching ignores case. JSON answers are compacted, HTML is reduced to text, then the result is
cut to 4,000 characters. Non-2xx -> `ok: false`, `status`, and "The service answered with an error (HTTP 404).
It said: ..."; network errors and timeouts -> `ok: false`, `status: null`, plain reason.

Flow: the runtime lists enabled actions (id, name, description, JSON schema; never URL or headers). The voice
agent registers one tool per action. When the model calls it, the agent POSTs
`/api/internal/conversations/:id/actions/:actionId` with `RunActionRequest`; the web app checks the action
belongs to the conversation's agent, validates the arguments against the parameters, calls the business's
URL with headers plus `X-Halochime-Conversation: <id>` and, when the visitor is verified,
`X-Halochime-Visitor: <sub>`, then answers `RunActionResponse` (body cut to 4,000 characters).

- Route errors: `404 not_found` (unknown conversation, or the action is not this agent's), `409 action_disabled`,
  `409 conversation_ended`. At most 20 calls per conversation per minute (then `ok: false`, not run).
- Every call is recorded once, by the voice agent: its `function_tools_executed` handler writes one `tool`
  transcript row per call (`describe_tool_call`: name, arguments, `ok`/`error` and the start of the result).
  The web route does not write transcript rows.
- Voice agent (`apps/agent/src/talkfront_agent/actions.py`): one `function_tool(raw_schema=...)` per action;
  a failed call raises `ToolError` with the plain reason plus "don't guess, offer a message" so the model says it.
- The dashboard "Test" button runs a saved action with sample arguments and shows the status, the request and
  what the agent would read. Test calls send `X-Halochime-Conversation: test_<random>` and never
  `X-Halochime-Visitor`.

## 5. Webhooks (we -> their URL)

Settings -> Webhooks (owners/admins manage, members read). Table `webhook_endpoints` (url, secret `whsec_` +
32 random bytes base64url, events, enabled; at most 10 per workspace) and `webhook_deliveries` (every attempt,
the last 20 per endpoint shown in Settings, rows older than 30 days pruned at most once an hour per instance).
Code: `lib/webhooks/` (`dispatch.ts`, `payloads.ts`, `sign.ts`); UI: `app/app/settings/webhooks*.tsx`.

Events (`WEBHOOK_EVENTS`); an endpoint with an empty `events` list gets every event, including future ones:
- `conversation.ended`: `data.conversation` (id, mode, channel, started_at, ended_at, duration_sec, ended_reason,
  summary, handoff_requested, page_url, page_title, dashboard_url), `data.agent` (id, name), `data.visitor`
  (id, name, email, verified, attributes), `data.collected` (below, or null), `data.transcript` (user/assistant
  messages only, the last 500: role, content, created_at). Sent after the summary step, so `summary` and
  `collected` may still be null.
- `handoff.created` / `handoff.updated`: `data.handoff` (id, status, message, created_at, dashboard_url),
  `data.visitor` (id, name, email, phone, verified, attributes), `data.conversation` (id, page_url,
  dashboard_url, or null), `data.agent` (id, name, or null).

Collected information (`data.collected`, also `conversations.collected_data`, migration `0003`). The summary step
(`lib/summary.ts`) makes one model call that returns `{ "summary": "...", "data": { ... } }` (Groq: `openai/gpt-oss-120b`
in JSON mode, once `qwen/qwen3.8-27b` on a 429; Anthropic when `ANTHROPIC_API_KEY` is set). Values are checked against
the field types in `lib/collect.ts`: unknown keys dropped, anything that doesn't fit -> null, null = not mentioned.
- Built-in, always: `visitor_name`, `email`, `phone`, `topic` (a few words), `outcome` (`answered` | `message_taken` |
  `not_answered` | `other`), `follow_up_needed` (true/false), `sentiment` (`positive` | `neutral` | `negative`).
- `custom`: the agent's own fields (Agent -> Information to collect; owners/admins edit, at most 15), keyed by field key:
  `{ "label", "type", "value" }`. Label and type are as they were when collected. `CollectField` in contracts: `key`
  `^[a-z][a-z0-9_]{0,39}$` (unique, not a built-in key), `label` <= 60, `description` <= 300 (what to look for),
  `type` `text` | `number` | `yes_no` | `date` | `email` | `phone` | `choice` (2-10 `options`), `ask`.
- Value types: text, number, yes_no -> boolean, date -> `YYYY-MM-DD` when a full date was given (else the visitor's
  words), email (lowercase), phone, choice -> one of the options exactly.
- Fields with `ask` on get one short "Things to find out" section in the runtime prompt (`lib/prompt.ts`).
- Empty `conversations.visitor_name` / `visitor_email` are filled from what was said; they stay unverified.

Request: `POST`, `Content-Type: application/json`, `User-Agent: Halochime-Webhooks/1`, `Halochime-Event`,
`Halochime-Event-Id`, body (times inside `data` are ISO 8601 UTC; `workspace_id` is the organization id):

```json
{ "id": "evt_...", "type": "conversation.ended", "created": 1761400000, "workspace_id": "...", "data": { } }
```

Signature header (Stripe-style): `Halochime-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>`
(`t` is fresh on each attempt). Receivers should reject `t` older than 5 minutes. Delivery: 10 s timeout,
success = any 2xx; up to 3 attempts (immediately, +2 s, +10 s) inside the same `after()` callback; same `id` on
every attempt; redirects are not followed (POST). Same SSRF rules as actions, and only `https://` URLs can be saved.
"Send test event" sends one attempt (no retries) of a sample `conversation.ended` with `data.test = true`, even
to a paused endpoint. Slack incoming webhooks need their own format, so the docs point Slack users to Zapier/n8n.
