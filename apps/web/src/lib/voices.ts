// Voices from ElevenLabs and Cartesia (curated) and the workspace's own cloned brand voices.
// Pure logic with no server-only imports, so the agent editor and the checks can use it too.
//
// Stored in agents.tts_voice as:
//   "openai:<name>"        realtime voice (default; see agent-defaults.ts)
//   "aura-2-...-en"        classic Deepgram voice
//   "elevenlabs:<id>"      curated ElevenLabs voice
//   "cartesia:<id>"        curated Cartesia voice
//   "clone:<voice_clones.id>"  the workspace's cloned voice (an ElevenLabs instant voice clone)
// ElevenLabs, Cartesia and cloned voices speak through the classic pipeline (speech to text -> model ->
// that voice). When the voice server lacks the provider's key it uses the default realtime voice.

export type VoiceProvider = "elevenlabs" | "cartesia";
export const VOICE_PROVIDERS: readonly VoiceProvider[] = ["elevenlabs", "cartesia"];
export const PROVIDER_LABELS: Record<VoiceProvider, string> = { elevenlabs: "ElevenLabs", cartesia: "Cartesia" };

export type CatalogVoice = {
  provider: VoiceProvider;
  id: string;
  name: string;
  gender: "female" | "male";
  /** Short note shown in the picker, e.g. "warm, British". */
  style: string;
  /** Language the voice is native in. Cartesia speaks in this language when the agent is on auto. */
  native: string;
  /** Languages it is picked for in the list ("Urdu, Hindi, Arabic, English"). */
  speaks: string;
};

// ElevenLabs default voices: they work with every model, and the models below speak Urdu, Hindi and Arabic
// with them (Flash v2.5 for Hindi and Arabic, v4 Turbo also for Urdu). The ids are ElevenLabs' public
// default voices; scripts/check-voices.mjs confirms each one against the account.
// Cartesia: native Hindi and Arabic voices, and English ones. Sonic 3.6 speaks Urdu too, best with a Hindi voice.
export const VOICE_CATALOG: readonly CatalogVoice[] = [
  { provider: "elevenlabs", id: "EXAVITQu4vr4xnSDxMaL", name: "Sarah", gender: "female", style: "warm, clear", native: "en", speaks: "Urdu, Hindi, Arabic, English" },
  { provider: "elevenlabs", id: "cgSgspJ2msm6clMCkdW9", name: "Jessica", gender: "female", style: "young, bright", native: "en", speaks: "Urdu, Hindi, Arabic, English" },
  { provider: "elevenlabs", id: "Xb7hH8MSUJpSbSDYk0k2", name: "Alice", gender: "female", style: "calm, British", native: "en", speaks: "Urdu, Hindi, Arabic, English" },
  { provider: "elevenlabs", id: "XrExE9yKIg1WjnnlVkGX", name: "Matilda", gender: "female", style: "friendly", native: "en", speaks: "Urdu, Hindi, Arabic, English" },
  { provider: "elevenlabs", id: "JBFqnCBsd6RMkjVDRZzb", name: "George", gender: "male", style: "warm, British", native: "en", speaks: "Urdu, Hindi, Arabic, English" },
  { provider: "elevenlabs", id: "nPczCjzI2devNBz1zQrb", name: "Brian", gender: "male", style: "deep, steady", native: "en", speaks: "Urdu, Hindi, Arabic, English" },
  { provider: "elevenlabs", id: "cjVigY5qzO86Huf0OWal", name: "Eric", gender: "male", style: "friendly", native: "en", speaks: "Urdu, Hindi, Arabic, English" },
  { provider: "elevenlabs", id: "onwK4e9ZLuTAKqWW03F9", name: "Daniel", gender: "male", style: "calm, British", native: "en", speaks: "Urdu, Hindi, Arabic, English" },
  { provider: "cartesia", id: "c1abd502-9231-4558-a054-10ac950c356d", name: "Hindi Narrator Woman", gender: "female", style: "native Hindi", native: "hi", speaks: "Hindi, Urdu" },
  { provider: "cartesia", id: "95d51f79-c397-46f9-b49a-23763d3eaa2d", name: "Hinglish Speaking Lady", gender: "female", style: "Hindi and English mix", native: "hi", speaks: "Hindi, Urdu, English" },
  { provider: "cartesia", id: "ac7ee4fa-25db-420d-bfff-f590d740aeb2", name: "Hindi Calm Man", gender: "male", style: "native Hindi", native: "hi", speaks: "Hindi, Urdu" },
  { provider: "cartesia", id: "92f27ee5-d8b9-4c0a-a0c2-f401f6ab0a72", name: "Reem", gender: "female", style: "Gulf Arabic", native: "ar", speaks: "Arabic" },
  { provider: "cartesia", id: "98bf39ce-b44a-49d7-9794-fb9a9329fd11", name: "Rania", gender: "female", style: "Modern Standard Arabic", native: "ar", speaks: "Arabic" },
  { provider: "cartesia", id: "f9f9f472-6247-4403-9abe-616f7c407c63", name: "Raed", gender: "male", style: "Gulf Arabic", native: "ar", speaks: "Arabic" },
  { provider: "cartesia", id: "f786b574-daa5-4673-aa0c-cbe3e8534c02", name: "Katie", gender: "female", style: "friendly", native: "en", speaks: "English" },
  { provider: "cartesia", id: "79a125e8-cd45-4c13-8a67-188112f4dd22", name: "British Lady", gender: "female", style: "British", native: "en", speaks: "English" },
  { provider: "cartesia", id: "a167e0f3-df7e-4d52-a9c3-f949145efdab", name: "Customer Support Man", gender: "male", style: "support desk", native: "en", speaks: "English" },
];

/** At most this many cloned voices per workspace. */
export const MAX_VOICE_CLONES = 3;
export const CLONE_PREFIX = "clone:";

export type VoiceKind = "realtime" | "deepgram" | VoiceProvider | "clone";

export function voiceKind(value: string): VoiceKind {
  if (value.startsWith("openai:")) return "realtime";
  if (value.startsWith("elevenlabs:")) return "elevenlabs";
  if (value.startsWith("cartesia:")) return "cartesia";
  if (value.startsWith(CLONE_PREFIX)) return "clone";
  return "deepgram";
}

export const catalogValue = (v: Pick<CatalogVoice, "provider" | "id">) => `${v.provider}:${v.id}`;
export const cloneValue = (cloneId: string) => `${CLONE_PREFIX}${cloneId}`;
export const cloneIdOf = (value: string) => (value.startsWith(CLONE_PREFIX) ? value.slice(CLONE_PREFIX.length) : null);

export function catalogVoice(value: string): CatalogVoice | null {
  return VOICE_CATALOG.find((v) => catalogValue(v) === value) ?? null;
}

/** ElevenLabs Flash v2.5 is the fastest; it doesn't speak Urdu, so Urdu and "match the visitor" use v4 Turbo. */
export const ELEVENLABS_FAST_MODEL = "eleven_flash_v2_5";
export const ELEVENLABS_WIDE_MODEL = "eleven_v4_turbo";
export const CARTESIA_MODEL = "sonic-3.6";

export function elevenLabsModel(agentLanguage: string): string {
  return agentLanguage === "auto" || agentLanguage === "ur" ? ELEVENLABS_WIDE_MODEL : ELEVENLABS_FAST_MODEL;
}

/** What the voice server gets for an ElevenLabs, Cartesia or cloned voice. */
export type ProviderVoice = { provider: VoiceProvider; voiceId: string; model: string; language: string | null };

/**
 * The provider voice for an agent's stored voice, or null for realtime and Deepgram voices and for voices
 * that no longer exist (an unknown catalog id, a deleted clone): those speak with the default voice.
 * `clone` is the workspace's clone row for a "clone:" value (looked up by the caller, scoped to the workspace).
 */
export function providerVoiceFor(
  value: string,
  agentLanguage: string,
  clone?: { providerVoiceId: string } | null,
): ProviderVoice | null {
  const language = agentLanguage === "auto" ? null : agentLanguage;
  const kind = voiceKind(value);
  if (kind === "clone") {
    if (!clone?.providerVoiceId) return null;
    return { provider: "elevenlabs", voiceId: clone.providerVoiceId, model: elevenLabsModel(agentLanguage), language };
  }
  if (kind !== "elevenlabs" && kind !== "cartesia") return null;
  const voice = catalogVoice(value);
  if (!voice) return null;
  if (voice.provider === "elevenlabs") {
    return { provider: "elevenlabs", voiceId: voice.id, model: elevenLabsModel(agentLanguage), language };
  }
  // Cartesia needs a language: the agent's, or the voice's own when the agent matches the visitor.
  return { provider: "cartesia", voiceId: voice.id, model: CARTESIA_MODEL, language: language ?? voice.native };
}

/** Realtime voices and the ElevenLabs/Cartesia/cloned ones speak many languages; Deepgram ones only English. */
export const speaksManyLanguages = (value: string) => voiceKind(value) !== "deepgram";

export type VoiceOption = { value: string; label: string };
export type VoiceGroup = { label: string; options: VoiceOption[] };
export type CloneView = { id: string; name: string };

export function catalogLabel(v: CatalogVoice): string {
  return `${v.name} (${v.gender}, ${v.style}; ${v.speaks})`;
}

/**
 * The voice picker: realtime and Deepgram voices always, a provider's voices only when it is turned on
 * (its key is set), and the workspace's clones when ElevenLabs is on. The agent's current voice is always
 * listed, so saving the form never changes it by accident.
 */
export function voiceGroups(opts: {
  base: VoiceOption[];
  enabled: readonly VoiceProvider[];
  clones: CloneView[];
  current: string;
}): VoiceGroup[] {
  const realtime = opts.base.filter((o) => voiceKind(o.value) === "realtime");
  const classic = opts.base.filter((o) => voiceKind(o.value) === "deepgram");
  const groups: VoiceGroup[] = [
    { label: "Realtime (fastest)", options: realtime },
    { label: "Classic (English only)", options: classic },
  ];
  if (opts.enabled.includes("elevenlabs") && opts.clones.length > 0) {
    groups.push({ label: "Your brand voices", options: opts.clones.map((c) => ({ value: cloneValue(c.id), label: `${c.name} (your cloned voice)` })) });
  }
  for (const provider of VOICE_PROVIDERS) {
    if (!opts.enabled.includes(provider)) continue;
    groups.push({
      label: PROVIDER_LABELS[provider],
      options: VOICE_CATALOG.filter((v) => v.provider === provider).map((v) => ({ value: catalogValue(v), label: catalogLabel(v) })),
    });
  }
  const listed = groups.some((g) => g.options.some((o) => o.value === opts.current));
  if (!listed && opts.current) {
    groups.unshift({ label: "Current voice", options: [{ value: opts.current, label: currentLabel(opts.current) }] });
  }
  return groups.filter((g) => g.options.length > 0);
}

function currentLabel(value: string): string {
  const kind = voiceKind(value);
  const voice = catalogVoice(value);
  if (voice) return `${catalogLabel(voice)}: ${PROVIDER_LABELS[voice.provider]} is off, so the default voice is used`;
  if (kind === "clone") return "Brand voice (deleted or off): the default voice is used";
  return value;
}

/** May a save store this voice? Any listed option, or the agent's current voice unchanged. */
export function isSelectableVoice(
  value: string,
  opts: { base: VoiceOption[]; enabled: readonly VoiceProvider[]; cloneIds: string[]; current: string },
): boolean {
  if (value === opts.current) return true;
  if (opts.base.some((o) => o.value === value)) return true;
  const kind = voiceKind(value);
  if (kind === "clone") return opts.enabled.includes("elevenlabs") && opts.cloneIds.includes(cloneIdOf(value) ?? "");
  if (kind === "elevenlabs" || kind === "cartesia") return opts.enabled.includes(kind) && catalogVoice(value) !== null;
  return false;
}

/** The voice block of the runtime config for an agent's stored voice. */
export function runtimeVoice(
  value: string,
  agentLanguage: string,
  clone?: { providerVoiceId: string } | null,
  defaults = { realtimeVoice: "marin", deepgramVoice: "aura-2-thalia-en" },
): {
  engine: "realtime" | "classic";
  realtimeVoice: string;
  deepgramVoice: string;
  providerVoice: ProviderVoice | null;
} {
  const kind = voiceKind(value);
  if (kind === "realtime") {
    return { engine: "realtime", realtimeVoice: value.slice("openai:".length) || defaults.realtimeVoice, deepgramVoice: defaults.deepgramVoice, providerVoice: null };
  }
  if (kind === "deepgram") {
    return { engine: "classic", realtimeVoice: defaults.realtimeVoice, deepgramVoice: value, providerVoice: null };
  }
  // A provider voice; the engine fields say what to use when the voice server can't (the default voice).
  return {
    engine: "realtime",
    realtimeVoice: defaults.realtimeVoice,
    deepgramVoice: defaults.deepgramVoice,
    providerVoice: providerVoiceFor(value, agentLanguage, clone),
  };
}

/** Largest voice sample for a clone (server actions accept 5 MB; Vercel refuses bodies over ~4.5 MB). */
export const VOICE_SAMPLE_MAX_BYTES = 4 * 1024 * 1024;
/** Smaller than this is too short to clone (a few seconds of speech). */
export const VOICE_SAMPLE_MIN_BYTES = 16 * 1024;

/** MP3, WAV, WebM, Ogg, MP4/M4A or FLAC, judged by the file's first bytes (never by its name or the browser's claim). */
export function audioType(b: Uint8Array): string | null {
  const ascii = (from: number, to: number) => String.fromCharCode(...b.subarray(from, to));
  if (b.length < 12) return null;
  if (ascii(0, 3) === "ID3" || (b[0] === 0xff && (b[1]! & 0xe0) === 0xe0)) return "audio/mpeg";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WAVE") return "audio/wav";
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return "audio/webm";
  if (ascii(0, 4) === "OggS") return "audio/ogg";
  if (ascii(4, 8) === "ftyp") return "audio/mp4";
  if (ascii(0, 4) === "fLaC") return "audio/flac";
  return null;
}

export const AUDIO_EXTENSIONS: Record<string, string> = {
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mp4": "m4a",
  "audio/flac": "flac",
};

export const CLONE_CONSENT_TEXT =
  "This is my own voice, or the person whose voice this is has given me permission to clone it for our support agent. I will not use it to imitate anyone else.";
