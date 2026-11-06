import "server-only";
import { VOICE_PROVIDERS, type VoiceProvider } from "./voices";

const KEY_ENV: Record<VoiceProvider, string> = { elevenlabs: "ELEVENLABS_API_KEY", cartesia: "CARTESIA_API_KEY" };

/**
 * Providers whose voices the agent editor shows: the key is set on the web app too, or VOICE_PROVIDERS
 * lists the provider (e.g. "elevenlabs,cartesia") when the key lives only on the voice server.
 * Read at request time so turning one on needs only an env change and a redeploy.
 */
export function enabledVoiceProviders(): VoiceProvider[] {
  const listed = (process.env.VOICE_PROVIDERS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return VOICE_PROVIDERS.filter((p) => Boolean(process.env[KEY_ENV[p]]) || listed.includes(p));
}

/** The platform's ElevenLabs key, needed on the web app to create and delete cloned voices. */
export function elevenLabsKey(): string | null {
  return process.env.ELEVENLABS_API_KEY || null;
}
