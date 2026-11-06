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
| Their number -> us | Channels | Phone calls (their Twilio or SIP number) and WhatsApp (their Cloud API number) answered by the same agent |
| Us -> their services | Integrations | Ready-made tools on their own HubSpot, GoHighLevel, Zoho CRM, Cal.com, booking link or Postgres/MySQL database |

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
| `Halochime.setSwitch({ label, onSelect })` | Adds a button after Talk / Type that hands the visitor to something else on your page (your own help chat, say): clicking it ends the conversation, closes the panel, then calls `onSelect()`. `null` removes it; calling again replaces it. Label up to 40 characters |
| `Halochime.hide()` / `Halochime.show()` | Hides the whole widget (an open conversation ends; `open()` does nothing while hidden) / shows the launcher again, closed |
| `Halochime.offerHelp({ reason, message })` | Shows the proactive help bubble next to the launcher (e.g. after a failed checkout). Needs proactive help on for the agent. `reason` up to 60 characters, `message` up to 120 (default: the agent's offerHelp message). Never while the panel is open or a conversation runs; at most once per page and reason per visit (sessionStorage). Tapping it opens the panel and the next conversation carries the offer |

The token can also be given on the tag: `data-identity-token="eyJ..."` (server-rendered pages).
Pre-load queue: if `window.Halochime.q` is an array of `[method, ...args]` when the script loads, the loader
runs them in order after mounting (after `data-identity-token`, so a queued `identify` wins). After load,
`Halochime.q.push([...])` runs the call at once, so `window.Halochime.q.push(["identify", { token }])` works
before and after the script loads.

- The token is kept in memory only (never in storage) and is sent as `identityToken` in
  `POST /api/widget/session`. It applies to the next conversation; a live one keeps the identity it started with.
- The loader only checks the token looks like a JWT (3 base64url parts, at most 4,096 characters); anything else
  is ignored with a console warning. The server does the real check.

### Page help (proactive help and page guide)

Both are off by default and set per agent under **Page help** (owners and admins; table `agent_page_help`,
no row = off). The widget learns about them from `GET /api/widget/config` (`proactiveHelp`, `pageGuide`,
absent when off).

- **Proactive help.** Rules: "address contains / starts with / is exactly X" or "any page", after N seconds
  (0 to 600), with a bubble message. The first rule that fits the page wins; the widget checks the address
  every second, so single-page sites work. At most one rule bubble per page per visit, plus one per
  `offerHelp` reason; what was shown is kept in `sessionStorage` (`halochime.help.<agentId>`, memory only when
  storage is blocked). The bubble's message and reason go into `POST /api/widget/session` as `helpOffer`; the
  server keeps it (table `conversation_help_offers`) only when proactive help is on, and the runtime config
  then carries `helpOffer` plus a prompt section, so the agent opens with help about it (voice: an opener
  instead of the ready-made greeting).
- **Page guide.** When a conversation starts, and after the address changes or the page changes a lot
  (20+ nodes, batched 0.8 s, at most every 4 s), the widget sends the page's visible buttons, links and
  fields on topic `tf.page`: `{ path, title, elements: [{ id, role, label }] }`, at most 60, each role and
  label at most twice. Labels come from visible text, `aria-label`, the field's `<label>`, placeholder or
  title, never a field's value; password, card, PIN and similar fields are skipped. The agent adds the list
  to its instructions and has a `point_to(element_id, label)` tool that sends `tf.point` `{ id, label }`; the
  widget scrolls to the element and draws a ring with the label in the host page for 5 seconds (fixed
  overlay, no layout change, follows scrolling). On phones the full-screen panel slides down to its header
  meanwhile. Voice and text.

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

## 6. Channels (phone calls, WhatsApp)

Set up per agent on the Channels page (`/app/channels`) by owners and admins; members can look. Both are off
until the owner turns them on. Tables: `agent_channels` (one row per agent and kind; non-secret settings in
`config`, tokens encrypted in `secrets_encrypted` with `CHANNEL_INFO`, only the last 4 characters in
`secret_hints`) and `channel_inbound` (WhatsApp message ids already answered). Code: `apps/web/src/lib/channels/`.

Phone calls (LiveKit SIP):
- Saving a number stores it; Turn on creates a LiveKit inbound trunk for that number (optional allowed IP
  ranges, optional username and password we generate and show once) and an `individual` dispatch rule on that
  trunk only, which dispatches the agent (contracts.md, "Phone calls"). Turn off and Remove delete both; saving
  while on recreates them. Workspace delete removes them too (best effort).
- Twilio: Elastic SIP Trunking trunk, Origination URI `sip:<LIVEKIT_SIP_URI host>;transport=tcp`, the number
  on the trunk. Twilio sends no credentials on incoming calls, so use allowed addresses to restrict.
- Calls are voice conversations (channel `phone`), billed from the same wallet, limited like widget calls.

WhatsApp (Business Cloud API):
- The owner enters the Phone number ID, a permanent access token, the app secret and a verify token, and pastes
  the webhook URL `/api/channels/whatsapp/<channelId>` into Meta (subscribe to `messages`).
- GET answers Meta's `hub.challenge` when `hub.verify_token` matches. POST checks `X-Hub-Signature-256`
  (HMAC-SHA256 of the raw body with the app secret), answers 200 at once and handles messages in `after()`.
- Text, button and list replies are answered with text. Voice notes are downloaded with the token, written down
  with `gpt-4o-transcribe`, answered with text and (if on) a voice note made with `gpt-4o-mini-tts` as Ogg/Opus,
  sent with `audio.voice = true`. Other message types get a short "send text or a voice note" reply.
- One agent turn per message on the web side (`lib/channels/turn.ts`): the same prompt builder (channel
  `whatsapp`), knowledge looked up for each message, `search_knowledge`, `request_human` (one step: the model
  confirms the details in chat first) and the business's actions as tools. Model: the agent's own when it runs
  on Groq or OpenAI, then GPT-4o mini, then GPT-OSS 20B on Groq (Claude agents use the backups).
- One conversation per sender (channel `whatsapp`, mode `text`, `visitor_id` = their WhatsApp id) stays open
  until 24 hours pass without messages; it is then ended like a text chat (summary, emails, webhooks, a
  `text_session` usage row). The general stale sweep skips WhatsApp conversations.
- An empty wallet gets a polite "can't answer right now" (at most once per sender per 6 hours). Per sender:
  8 messages a minute and 60 an hour per server instance, and 30 a conversation in 10 minutes in the database.
  Repeated webhooks are answered once (`channel_inbound`).
## 7. Integrations (agent -> their CRM, calendar or database)

Dashboard page `/app/integrations` (owners/admins connect, edit, test, disconnect and edit queries; members see
status only). Each business brings its own credentials; nothing is shared across workspaces. Tables
`integrations` (one row per kind per workspace: `config` JSON, `secrets_encrypted`, `secret_hint`, `agent_ids`,
`log_conversations`, last test result) and `integration_queries` (database queries). Schema
`apps/web/src/db/schema/integrations.ts`; code `apps/web/src/lib/integrations/`; UI `app/app/integrations/`.

- Credentials are encrypted like action headers (`lib/actions/crypto.ts`, info `talkfront-integration-secrets`, the
  row id as additional data) and never sent back to the browser: the page shows "ends in abcd" (or the database
  `host:port/db`), and a blank field keeps the saved value. Disconnect deletes the row, its credentials and queries.
- Saving runs a test right away (one harmless read) and stores the result; "Test connection" runs it again
  (10 tests per user per minute).
- Only agents ticked under "Agents that may use it" get the tools. A new connection starts with every agent ticked.

### How the agent uses them (no agent changes)

The runtime (`GET /api/internal/runtime/:conversationId`) appends integration tools to `actions` after the
business's own actions, with ids in their own namespace (`int:<kind>:<op>`, `int:database:<queryId>`). A tool whose
name is already used by one of the agent's actions (or is reserved) is left out, so existing actions never change.
Loading never throws: if the tables are missing or anything fails, the agent just gets no integration tools.
The voice agent registers them like any action and calls `POST /api/internal/conversations/:id/actions/:actionId`
(the id arrives URL-encoded; the route decodes it). Ids starting with `int:` go to `lib/integrations/execute.ts`
(404 when the integration is not connected for this conversation's agent, 409 when the conversation ended); every
other id runs as a business action exactly as before. Same limit of 20 calls per conversation per minute; bookings
at most 3 per conversation per hour. Answers use `RunActionResponse`, cut to 4,000 characters.

| Integration | Credentials | Tools |
|---|---|---|
| HubSpot (CRM v3) | Private app access token (contacts read + write) | `hubspot_find_contact`, `hubspot_save_lead`, `hubspot_add_note` |
| GoHighLevel (API v2, `Version: 2021-07-28`) | Private integration token + location id | `gohighlevel_find_contact`, `gohighlevel_save_lead`, `gohighlevel_add_note` |
| Zoho CRM (API v7) | Client id, client secret, refresh token (Self Client, `ZohoCRM.modules.ALL`) + data centre | `zoho_find_contact`, `zoho_save_lead`, `zoho_add_note` |
| Cal.com (API v2) | API key + event type id + business time zone | `check_open_times`, `book_meeting` |
| Booking link | Any `https://` URL (+ optional label) | `get_booking_link` |
| Database | Postgres or MySQL connection string + SSL on/off | one tool per enabled query (its own name) |

CRM rules (`crm.ts`):
- Email or phone from the AI; with neither, the verified visitor's email (identity token) is used. Unverified
  emails from the conversation are not used as a default.
- `find_contact` returns the full record (name, email, phone, company, stage) only when the lookup is the verified
  visitor's own email. For any other email or phone it only says whether a contact exists (and its id), so a visitor
  can't read other people's details.
- `save_lead` searches by email then phone. New: created as a lead (HubSpot `lifecyclestage=lead`; GoHighLevel tag
  `halochime`, source `Halochime`; Zoho Leads with `Lead_Source=Chat`, `Last_Name` from the first name or "Unknown",
  `Company` "Not given" when missing). Existing: only empty fields are filled in, nothing is overwritten.
- `add_note` needs an existing contact ("save them as a lead first").
- Zoho access tokens are cached in memory per server instance for at most 45 minutes (refreshed once on a 401).
- Vendor errors come back as plain sentences ("HubSpot answered: the saved credentials were refused"), never
  with credentials.

Calendar (`calcom.ts`): `check_open_times` takes `start_date`, optional `end_date` (at most 14 days) and the
visitor's `time_zone` (default: the business's), and returns up to 30 future start times. `book_meeting` takes the
exact `start`, `name`, `email`, optional `time_zone` and `notes`; its description tells the model to read the details
back and wait for a clear yes first. `get_booking_link` returns the link (in voice: say where to book, don't read
the URL).

Conversation log: after the summary is written (`/end` route, next to emails and webhooks), every CRM with "Log
conversations" on whose agents include this conversation's agent finds or creates the contact (when an email or
phone is known: conversation, message for the team, or collected data) and adds the summary plus a dashboard link
as a note. Best effort: it never blocks or fails the route; failures are logged without credentials.

### Database queries

Owners write named queries: name (tool name, same rules as action names, not used by an action or another
integration), description for the AI, SQL and typed inputs. At most 20 queries.

- SQL rules (`sql.ts`, checked on save, on Try and before every run): exactly one statement starting with `SELECT`
  or `WITH`; no `;` anywhere; no write, lock or session words outside quotes and comments (`INSERT`, `UPDATE`,
  `DELETE`, `INTO`, `FOR UPDATE`, `COPY`, ...); no side-effect functions (`pg_sleep`, `pg_read_file`, `dblink`,
  `load_file`, `nextval`, ...); inputs written as `:name` (Postgres casts like `::date` are fine; `$1` and `?` are
  refused); every `:name` must be an input and every input must be used. Postgres may need a cast for an input it
  can't type, such as `:status::text is null`; the Try button says so.
- Inputs are bound as real driver parameters (`$1..` for Postgres, `?` for MySQL), never pasted into the SQL.
- An input marked "Signed-in user id" is hidden from the AI and always bound to the visitor's identity-token `sub`
  (`conversations.visitor_id` when `visitor_verified`); without a verified visitor the query refuses politely.
- Running (`db-connector.ts`): one connection per call (no pools), 5 s connect timeout, the query wrapped as
  `SELECT * FROM (<query>) AS halochime_q LIMIT 21`, in a read-only transaction with a 3 s statement timeout
  (Postgres `SET LOCAL statement_timeout`; MySQL `SET SESSION TRANSACTION READ ONLY` + `max_execution_time`, or
  MariaDB `max_statement_time`, plus a client-side timer). At most 20 rows go to the AI, cells cut to 500
  characters and the whole answer to 4,000. MariaDB ignores `ORDER BY` inside a subquery without `LIMIT`: add one.
- Hosts on private, loopback or link-local networks are refused (IP literals before connecting, names after DNS at
  connect time with the same rules as `safe-fetch.ts`). For local development only, `INTEGRATIONS_ALLOW_PRIVATE_DB=1`
  (ignored when `NODE_ENV=production`) allows a database on this machine.
- SSL on = encrypted without checking the certificate (like `sslmode=require`), with SNI so hosted poolers work.
- Drivers: the app's `postgres` package and `mysql2`.
- "Try" runs the query in the editor (saved or not) with sample values and a sample signed-in user id, and shows
  what the agent would read plus the database's own error for the owner (20 tries per user per minute).
