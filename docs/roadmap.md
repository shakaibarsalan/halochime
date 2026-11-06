# Roadmap

Status on 6 Nov 2026: Phase 1 is done and live; Phase 2 is partly done; Phase 3 has not started.

## Phase 1: MVP (done, live)

- [x] Sign up, workspace (one per business), team invites (also Google sign-in and email codes)
- [x] Agent setup: name, persona, business rules, greeting, language, voice (plus launcher icon, theme, dark mode)
- [x] Knowledge: paste text/FAQ, add a web page URL, upload .txt/.md and PDF
- [x] Widget: one script tag, voice + text, live captions, brand colour, allowed domains (plus a switch/hide/show API)
- [x] Voice engine: LiveKit room, OpenAI realtime voice (Deepgram + Claude as the backup path), interruptions, turn detection, server-side echo cancellation, instant greeting
- [x] Conversations: transcript, summary, page the visitor was on
- [x] Handoff: "leave a message" captured as a lead, emailed to the business
- [x] Wallet: free trial minutes, usage per conversation; top-up is "Request minutes" with a payment link sent by hand (Stripe checkout not built)
- [x] Better retrieval: embeddings (pgvector) + full-text, website crawl from sitemap, PDF parsing

## Phase 2 (partly done)

- [x] Verified logged-in user: the business server signs a short HS256 token, the widget passes it, we trust only that
- [ ] CRM connectors: HubSpot, GoHighLevel, Zoho (look up the contact, log the conversation, create leads)
- [ ] Database connector: read-only, owner-defined named queries with parameters, user id always bound to the verified user, small pool, strict timeouts
- [x] Custom API actions (the business's own endpoints as tools) and signed webhooks; n8n / Make work through these
- [ ] Live human takeover inbox (the handoff inbox for left messages exists), calendar booking, analytics (top questions, unanswered questions, resolution rate)
- [ ] More STT/TTS choices per language, ElevenLabs / Cartesia voices (the realtime voice already speaks Urdu, Arabic, Hindi and more)

## Phase 3 (not started)

- [ ] Same agent on a phone number (Twilio / SIP) and WhatsApp voice notes
- [ ] Brand voice cloning
- [ ] Proactive voice help on failed checkout or pricing pages
- [ ] Page-aware guide that points at buttons on the page
- [ ] Agency white-label, AI test callers before publishing, versions with A/B traffic split
- [ ] Shopify and WordPress plugins (install guides for both are in the docs)
