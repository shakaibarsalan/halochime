# Halochime agent

The Python LiveKit worker that talks to visitors. LiveKit dispatches it (explicitly, as
`talkfront-agent`) into each conversation room `tf-<conversationId>`. It reads the
`DispatchMetadata` JSON, asks the web app for the runtime config, then runs one session:

- **voice**: Deepgram STT, Claude (Anthropic) replies, Deepgram TTS, Silero VAD, the LiveKit
  multilingual turn detector, interruptions on. Captions go out on `lk.transcription`.
- **text**: no audio. Visitor messages arrive on `lk.chat`, replies go out on `lk.transcription`.

Tools: `search_knowledge` (always) and `request_human` (when handoff is enabled). The greeting is
said/sent first. User, assistant and tool turns are posted to `/messages` every 5 s and on
shutdown; `/end` is posted exactly once with the duration and reason. After `maxDurationSec` the
agent says goodbye and ends with `max_duration`.

Contracts: [docs/contracts.md](../../docs/contracts.md) sections 2 and 3. The Python shapes live in
`src/talkfront_agent/api.py` and must match `packages/shared/src/contracts.ts`.

## Run

```bash
cp .env.example .env               # then fill it in
uv sync
uv run python -m talkfront_agent download-files   # one-time model download (turn detector)
uv run python -m talkfront_agent dev              # or: start (production), console, connect
uv run pytest                                      # offline tests
```

`dev`/`start`/`console`/`connect` use LiveKit's Python CLI, which livekit-agents 1.8 marks as
deprecated in favour of the `lk agent ...` CLI; it still works.

## Files

| File | What |
|---|---|
| `agent.py` | `AgentServer`, entrypoint, session wiring, shutdown |
| `api.py` | internal API client and contract types |
| `tools.py` | function tools |
| `transcript.py` | batched transcript upload |
| `lifecycle.py` | once-only shutdown guard, end reason |
