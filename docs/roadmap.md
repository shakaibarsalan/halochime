# Roadmap

Status on 6 Nov 2026: everything on this list is built and live. Some parts only start working once a business (or the
platform owner) connects an outside account; those are marked "needs".

## Phase 1: MVP (done, live)

- [x] Sign up, workspace (one per business), team invites (also Google sign-in and email codes)
- [x] Agent setup: name, persona, business rules, greeting, language, voice (plus launcher icon, theme, dark mode)
- [x] Knowledge: paste text/FAQ, add a web page URL, upload .txt/.md and PDF
- [x] Widget: one script tag, voice + text, live captions, brand colour, allowed domains (plus a switch/hide/show API)
- [x] Voice engine: LiveKit room, OpenAI realtime voice (Deepgram + an LLM as the backup path), interruptions, turn detection, server-side echo cancellation, instant greeting
- [x] Conversations: transcript, summary, page the visitor was on
- [x] Handoff: "leave a message" captured as a lead, emailed to the business
- [x] Wallet: free trial minutes, usage per conversation; top-up is "Request minutes" with a payment link sent by hand (Stripe checkout not built)
- [x] Better retrieval: embeddings (pgvector) + full-text, website crawl from sitemap, PDF parsing

## Phase 2 (done, live)

- [x] Verified logged-in user: the business server signs a short HS256 token, the widget passes it, we trust only that
- [x] CRM connectors: HubSpot, GoHighLevel, Zoho (find contact, save lead, add note, log each conversation) on /app/integrations. Needs: each business's own CRM credentials
- [x] Database connector: Postgres/MySQL, owner-written read-only named queries, signed-in user id always bound from the verified visitor, 3 s timeout, 20 rows
- [x] Custom API actions (the business's own endpoints as tools) and signed webhooks; n8n / Make work through these
- [x] Live human takeover inbox (/app/live), calendar booking (Cal.com or any booking link), analytics (/app/analytics: top topics, not answered, knowledge gaps, resolution rate)
- [x] More voices: ElevenLabs and Cartesia voices (Urdu, Arabic, Hindi, English). Needs: ELEVENLABS_API_KEY / CARTESIA_API_KEY on the platform

## Phase 3 (done, live)

- [x] Same agent on a phone number (LiveKit SIP with the business's Twilio or SIP number) and WhatsApp text + voice notes (Cloud API) on /app/channels. Needs: LIVEKIT_SIP_URI on the platform; each business's own number / Meta app
- [x] Brand voice cloning (ElevenLabs instant clone with consent). Needs: ELEVENLABS_API_KEY
- [x] Proactive voice help on chosen pages and Halochime.offerHelp() (e.g. after a failed checkout)
- [x] Page-aware guide: the agent sees the page's buttons and links and highlights the one the visitor asks about
- [x] Agency white-label (/app/agency, own name or no "by Halochime"), test suites before publishing (AI-judged), versions with A/B traffic split
- [x] WordPress plugin (download on the Install page) and a Shopify theme app extension. Needs for Shopify: a Partner account to deploy it

## Next ideas

- Stripe checkout for top-ups instead of payment links
- Outbound phone calls and WhatsApp message templates
- Voice test callers (today's test suites use text)
