import "server-only";
import { createHash } from "node:crypto";
import { appUrl } from "@/lib/env";

// The greeting as audio, so the widget can play it the moment the visitor taps Talk instead of after
// the call has connected (2 to 5 s of silence). Same model, voice and instructions as the agent's own
// greeting audio (apps/agent/src/talkfront_agent/greeting_cache.py), so it sounds like the rest of the call.
export const GREETING_TTS_MODEL = "gpt-4o-mini-tts";
export const GREETING_TTS_INSTRUCTIONS = "Warm, friendly and natural, like a helpful person answering a call.";

/** "openai:marin" -> "marin". Only realtime voices get a widget greeting. */
export function realtimeVoiceName(ttsVoice: string): string | null {
  return ttsVoice.startsWith("openai:") && ttsVoice.length > 7 ? ttsVoice.slice(7) : null;
}

/** Changes with the greeting text and the voice, so the audio URL (and every cache) changes too. */
export function greetingAudioVersion(voice: string, greeting: string): string {
  return createHash("sha256")
    .update(`${GREETING_TTS_MODEL}|${voice}|${GREETING_TTS_INSTRUCTIONS}|${greeting}`)
    .digest("hex")
    .slice(0, 16);
}

/** The URL the widget preloads, or null when the agent has no spoken greeting to play. */
export function greetingAudioUrl(agent: { id: string; ttsVoice: string; greeting: string; modes: string[] }): string | null {
  const voice = realtimeVoiceName(agent.ttsVoice);
  const greeting = agent.greeting.trim();
  if (!voice || !greeting || !agent.modes.includes("voice") || !process.env.OPENAI_API_KEY) return null;
  return `${appUrl()}/api/widget/greeting/${encodeURIComponent(agent.id)}?v=${greetingAudioVersion(voice, greeting)}`;
}
