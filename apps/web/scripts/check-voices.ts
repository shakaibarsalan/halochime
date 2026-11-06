// Owner only: confirms every curated ElevenLabs and Cartesia voice (src/lib/voices.ts) exists for the
// platform's accounts, and lists the ones that don't. Reads the keys from env and never prints them.
//
//   cd apps/web
//   npx tsx --env-file=.env.local scripts/check-voices.ts
//
// A voice that is "missing" should be replaced in VOICE_CATALOG (copy an id from the provider's voice
// library) before that provider is turned on. Agents that already use a missing voice fall back to
// the default voice.

import { PROVIDER_LABELS, VOICE_CATALOG, type VoiceProvider } from "../src/lib/voices";

const CARTESIA_VERSION = "2025-04-16";

async function exists(provider: VoiceProvider, id: string, key: string): Promise<"ok" | "missing" | string> {
  const res =
    provider === "elevenlabs"
      ? await fetch(`https://api.elevenlabs.io/v1/voices/${encodeURIComponent(id)}`, { headers: { "xi-api-key": key } })
      : await fetch(`https://api.cartesia.ai/voices/${encodeURIComponent(id)}`, {
          headers: { "X-API-Key": key, "Cartesia-Version": CARTESIA_VERSION },
        });
  if (res.ok) return "ok";
  if (res.status === 404 || res.status === 400) return "missing";
  return `HTTP ${res.status}`;
}

async function main() {
  const keys: Record<VoiceProvider, string | undefined> = {
    elevenlabs: process.env.ELEVENLABS_API_KEY,
    cartesia: process.env.CARTESIA_API_KEY,
  };
  let problems = 0;
  for (const provider of Object.keys(keys) as VoiceProvider[]) {
    const key = keys[provider];
    if (!key) {
      console.log(`${PROVIDER_LABELS[provider]}: key not set, skipped`);
      continue;
    }
    for (const v of VOICE_CATALOG.filter((x) => x.provider === provider)) {
      const result = await exists(provider, v.id, key).catch((e: unknown) => `error ${(e as Error).name}`);
      if (result !== "ok") problems += 1;
      console.log(`${PROVIDER_LABELS[provider]}  ${result.padEnd(8)}  ${v.name} (${v.id})`);
    }
  }
  process.exit(problems > 0 ? 1 : 0);
}

void main();
