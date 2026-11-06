import "server-only";

// Voice notes: OpenAI speech to text for the visitor's note, and OpenAI text to speech for the reply.
// Needs OPENAI_API_KEY on the web app; without it WhatsApp still answers text messages.

export const TRANSCRIBE_MODEL = "gpt-4o-transcribe";
export const TTS_MODEL = "gpt-4o-mini-tts";
/** gpt-4o-mini-tts voices. The agent's realtime voice is used when it is one of these. */
const TTS_VOICES = new Set(["alloy", "ash", "ballad", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer", "verse", "marin", "cedar"]);
const TIMEOUT_MS = 30_000;

export const audioAvailable = () => Boolean(process.env.OPENAI_API_KEY);

export class AudioError extends Error {}

export const ttsVoiceFor = (voice: string | null | undefined) => (voice && TTS_VOICES.has(voice) ? voice : "marin");

function extensionFor(mimeType: string): string {
  const m = mimeType.toLowerCase();
  if (m.includes("ogg") || m.includes("opus")) return "ogg";
  if (m.includes("mpeg") || m.includes("mp3")) return "mp3";
  if (m.includes("mp4") || m.includes("m4a") || m.includes("aac")) return "m4a";
  if (m.includes("amr")) return "amr";
  if (m.includes("wav")) return "wav";
  return "ogg";
}

/** The visitor's words in the voice note. `language` is an ISO code hint ("en", "ur"), or omitted for auto. */
export async function transcribe(audio: Buffer, mimeType: string, language?: string): Promise<string> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new AudioError("OPENAI_API_KEY is not set.");
  const form = new FormData();
  form.append("model", TRANSCRIBE_MODEL);
  form.append("file", new Blob([new Uint8Array(audio)], { type: mimeType.split(";")[0] || "audio/ogg" }), `voice.${extensionFor(mimeType)}`);
  if (language && /^[a-z]{2}$/.test(language)) form.append("language", language);
  form.append("response_format", "json");
  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: form,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  }).catch((e) => {
    throw new AudioError(`Transcription failed (${e instanceof Error ? e.name : "network error"}).`);
  });
  if (!res.ok) throw new AudioError(`Transcription failed (HTTP ${res.status}).`);
  const body = (await res.json().catch(() => null)) as { text?: unknown } | null;
  return typeof body?.text === "string" ? body.text.trim() : "";
}

/** The reply as an Ogg/Opus voice note (what WhatsApp needs for a voice message). */
export async function synthesize(text: string, voice: string): Promise<Buffer> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new AudioError("OPENAI_API_KEY is not set.");
  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: TTS_MODEL,
      voice: ttsVoiceFor(voice),
      input: text.slice(0, 4000),
      response_format: "opus",
      instructions: "Speak naturally and warmly, like a helpful support person sending a short voice note.",
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  }).catch((e) => {
    throw new AudioError(`Voice reply failed (${e instanceof Error ? e.name : "network error"}).`);
  });
  if (!res.ok) throw new AudioError(`Voice reply failed (HTTP ${res.status}).`);
  return Buffer.from(await res.arrayBuffer());
}
