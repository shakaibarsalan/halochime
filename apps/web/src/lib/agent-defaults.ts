import { newPublicKey } from "./ids";

/** Values for a brand-new agent; everything else uses the column defaults in db/schema/app.ts. */
export function newAgentValues(organizationId: string, businessName: string, name = "Support agent") {
  return {
    organizationId,
    name,
    publicKey: newPublicKey(),
    allowedDomains: [] as string[],
    greeting: `Hi, thanks for visiting ${businessName}. How can I help you today?`,
    llmModel: DEFAULT_LLM_MODEL,
    ttsVoice: DEFAULT_VOICE,
  };
}

export const STT_MODELS = [
  { value: "nova-3", label: "Deepgram Nova-3 (recommended)" },
  { value: "nova-2", label: "Deepgram Nova-2" },
];

/** OpenAI speech-to-speech model behind the "realtime" voices: no separate speech to text or text to speech. */
export const REALTIME_MODEL = "gpt-realtime-2.1-mini";
const REALTIME_PREFIX = "openai:";

/** "realtime" voices talk directly (fastest, many languages); "classic" ones go Deepgram -> model -> Deepgram (English). */
export function voiceEngine(voice: string): "realtime" | "classic" {
  return voice.startsWith(REALTIME_PREFIX) ? "realtime" : "classic";
}
export const realtimeVoiceName = (voice: string) => voice.slice(REALTIME_PREFIX.length);

export const DEFAULT_VOICE = "openai:marin";

export const TTS_VOICES = [
  { value: "openai:marin", label: "Marin (realtime: fastest, speaks many languages, female)" },
  { value: "openai:cedar", label: "Cedar (realtime: fastest, speaks many languages, male)" },
  { value: "openai:coral", label: "Coral (realtime, female)" },
  { value: "openai:sage", label: "Sage (realtime, female)" },
  { value: "openai:ash", label: "Ash (realtime, male)" },
  { value: "openai:verse", label: "Verse (realtime, male)" },
  { value: "aura-2-thalia-en", label: "Thalia (classic, English only, female)" },
  { value: "aura-2-andromeda-en", label: "Andromeda (classic, English only, female)" },
  { value: "aura-2-helena-en", label: "Helena (classic, English only, female)" },
  { value: "aura-2-apollo-en", label: "Apollo (classic, English only, male)" },
  { value: "aura-2-arcas-en", label: "Arcas (classic, English only, male)" },
  { value: "aura-2-orion-en", label: "Orion (classic, English only, male)" },
];

type LlmProvider = "anthropic" | "groq" | "openai";

/** The voice agent needs the matching key (OPENAI_API_KEY, GROQ_API_KEY or ANTHROPIC_API_KEY) for the provider. */
export const LLM_MODELS: { value: string; label: string; provider: LlmProvider }[] = [
  { value: "openai/gpt-oss-20b", label: "GPT-OSS 20B on Groq (fastest, recommended)", provider: "groq" },
  { value: "gpt-4o-mini", label: "GPT-4o mini on OpenAI (steady, slower first words)", provider: "openai" },
  { value: "qwen/qwen3.8-27b", label: "Qwen 3.8 27B on Groq (quickest first words, less careful with multi-step tasks)", provider: "groq" },
  { value: "openai/gpt-oss-120b", label: "GPT-OSS 120B on Groq (smarter, slower)", provider: "groq" },
  { value: "claude-haiku-5-5", label: "Claude Haiku 5.5 (needs an Anthropic key)", provider: "anthropic" },
  { value: "claude-sonnet-5-5", label: "Claude Sonnet 5.5 (needs an Anthropic key)", provider: "anthropic" },
];

// Used for text chats and classic voices (realtime voices have their own model). Measured from the
// server: GPT-OSS 20B on Groq starts answering in 0.35-0.6 s, GPT-4o mini 0.9 s, GPT-4.1 mini 1.3 s.
// The voice worker falls back to other models when one is rate limited or down.
// Qwen skipped steps of the take-a-message flow in tests, so it is not the default.
export const DEFAULT_LLM_MODEL = "openai/gpt-oss-20b";

export function llmProvider(model: string): LlmProvider {
  return LLM_MODELS.find((m) => m.value === model)?.provider ?? (model.startsWith("claude") ? "anthropic" : "groq");
}
