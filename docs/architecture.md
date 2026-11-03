# Architecture

```
Visitor's browser                     Halochime                                   Providers
┌──────────────────────┐   HTTPS    ┌──────────────────────────────┐
│ Business website     │──────────▶│ apps/web (Next.js)            │──▶ Postgres (Drizzle)
│  <script widget.js>  │  config,   │  dashboard + public widget API│
│  packages/widget     │  session   │  + internal API for the agent │──▶ Groq / Anthropic (summaries)
└─────────┬────────────┘            └──────────────▲───────────────┘
          │ WebRTC (LiveKit room)                   │ internal API (runtime, KB search,
          ▼                                         │ transcript, handoff, end)
┌──────────────────────┐  dispatch  ┌───────────────┴──────────────┐
│ LiveKit (Cloud or    │──────────▶│ apps/agent (Python worker)    │──▶ Deepgram STT + TTS
│ self-hosted server)  │◀──────────│ LiveKit Agents: VAD, turn      │──▶ Groq / Claude (replies)
└──────────────────────┘   audio    │ detection, interruptions, tools│
                                    └──────────────────────────────┘
```

## Why this shape

- **One brain for voice and text.** Both modes run through the same agent worker and the same prompt, so
  answers match whichever way the visitor chooses to talk.
- **Prompts and data live in the web app.** The agent asks the web app for its runtime config and calls it for
  knowledge search and logging. The database has one owner and the agent stays thin.
- **LiveKit for media.** WebRTC handles echo, noise and bad mobile networks far better than raw WebSocket audio,
  and LiveKit Agents gives semantic turn detection and interruption handling out of the box.
- **Swappable providers.** STT, LLM and TTS are per-agent settings, so cheaper or language-specific models can be
  added without touching the widget.
- **Multi-tenant from day one.** Every product row carries `organization_id`; every query filters on it.

## Folders

| Path | What |
|---|---|
| `apps/web` | Next.js app: marketing page, auth, dashboard, public widget API, internal API |
| `apps/agent` | Python LiveKit voice/text agent worker |
| `packages/widget` | Embeddable `<talkfront-widget>` web component, built to `apps/web/public/widget.js` |
| `packages/shared` | Zod contracts shared by web and widget |
| `docs` | Architecture, contracts, roadmap |
