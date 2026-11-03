# Roadmap

## Phase 1: MVP (this skeleton grows into it)

- [ ] Sign up, workspace (one per business), team invites
- [ ] Agent setup: name, persona, business rules, greeting, language, voice
- [ ] Knowledge: paste text/FAQ, add a web page URL, upload .txt/.md (PDF next)
- [ ] Widget: one script tag, voice + text, live captions, brand colour, allowed domains
- [ ] Voice engine: LiveKit room, Deepgram STT/TTS, Claude Haiku replies, interruptions, turn detection
- [ ] Conversations: transcript, summary, page the visitor was on
- [ ] Handoff: "leave a message" captured as a lead, emailed to the business
- [ ] Wallet: free trial minutes, usage per conversation, Stripe top-up
- [ ] Better retrieval: embeddings (pgvector) + full-text, website crawl from sitemap, PDF parsing

## Phase 2

- Verified logged-in user: the business server signs a short HS256 token, the widget passes it, we trust only that
- CRM connectors: HubSpot, GoHighLevel, Zoho (look up the contact, log the conversation, create leads)
- Database connector: read-only, owner-defined named queries with parameters, user id always bound to the verified user, small pool, strict timeouts
- Custom API actions (the business's own endpoints as tools), n8n / Make
- Live human takeover inbox, calendar booking, analytics (top questions, unanswered questions, resolution rate)
- More STT/TTS choices per language (Urdu, Arabic, Hindi), ElevenLabs / Cartesia voices

## Phase 3

- Same agent on a phone number (Twilio / SIP) and WhatsApp voice notes
- Brand voice cloning
- Proactive voice help on failed checkout or pricing pages
- Page-aware guide that points at buttons on the page
- Agency white-label, AI test callers before publishing, versions with A/B traffic split
- Shopify and WordPress plugins
