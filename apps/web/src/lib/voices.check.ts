// Run: npx tsx src/lib/voices.check.ts (from apps/web)
import assert from "node:assert/strict";
import {
  audioType,
  catalogValue,
  cloneValue,
  isSelectableVoice,
  providerVoiceFor,
  runtimeVoice,
  speaksManyLanguages,
  VOICE_CATALOG,
  voiceGroups,
  voiceKind,
} from "./voices";

const base = [
  { value: "openai:marin", label: "Marin" },
  { value: "openai:cedar", label: "Cedar" },
  { value: "aura-2-thalia-en", label: "Thalia" },
];
const sarah = "elevenlabs:EXAVITQu4vr4xnSDxMaL";
const hindiWoman = "cartesia:c1abd502-9231-4558-a054-10ac950c356d";

// Catalog: unique values, ids in the shapes the agent accepts, Urdu, Hindi and Arabic covered by both.
const values = VOICE_CATALOG.map(catalogValue);
assert.equal(new Set(values).size, values.length, "catalog values are unique");
for (const v of VOICE_CATALOG) {
  assert.match(v.id, v.provider === "elevenlabs" ? /^[A-Za-z0-9]{20}$/ : /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/, v.name);
}
for (const lang of ["Urdu", "Hindi", "Arabic"]) {
  for (const p of ["elevenlabs", "cartesia"] as const) {
    assert.ok(VOICE_CATALOG.some((v) => v.provider === p && v.speaks.includes(lang)), `${p} has a ${lang} voice`);
  }
}

// Kinds.
assert.equal(voiceKind("openai:marin"), "realtime");
assert.equal(voiceKind("aura-2-thalia-en"), "deepgram");
assert.equal(voiceKind(sarah), "elevenlabs");
assert.equal(voiceKind(hindiWoman), "cartesia");
assert.equal(voiceKind("clone:abc"), "clone");
assert.equal(speaksManyLanguages("aura-2-thalia-en"), false);
assert.equal(speaksManyLanguages(sarah), true);

// Picker: providers only when on; clones only with ElevenLabs on; the current voice always listed.
const labels = (g: ReturnType<typeof voiceGroups>) => g.map((x) => x.label);
assert.deepEqual(labels(voiceGroups({ base, enabled: [], clones: [{ id: "c1", name: "Desk" }], current: "openai:marin" })), [
  "Realtime (fastest)",
  "Classic (English only)",
]);
const on = voiceGroups({ base, enabled: ["elevenlabs", "cartesia"], clones: [{ id: "c1", name: "Desk" }], current: "openai:marin" });
assert.deepEqual(labels(on), ["Realtime (fastest)", "Classic (English only)", "Your brand voices", "ElevenLabs", "Cartesia"]);
assert.equal(on[2]!.options[0]!.value, "clone:c1");
const off = voiceGroups({ base, enabled: [], clones: [], current: sarah });
assert.equal(off[0]!.label, "Current voice");
assert.match(off[0]!.options[0]!.label, /ElevenLabs is off/);
assert.equal(voiceGroups({ base, enabled: ["cartesia"], clones: [], current: hindiWoman })[0]!.label, "Realtime (fastest)");

// Saving: listed voices, the unchanged current voice, and only this workspace's clones.
const sel = (value: string, enabled: ("elevenlabs" | "cartesia")[], current = "openai:marin", cloneIds = ["c1"]) =>
  isSelectableVoice(value, { base, enabled, cloneIds, current });
assert.equal(sel("openai:cedar", []), true);
assert.equal(sel(sarah, []), false, "ElevenLabs off: not selectable");
assert.equal(sel(sarah, ["elevenlabs"]), true);
assert.equal(sel(sarah, ["cartesia"]), false);
assert.equal(sel("elevenlabs:NotInTheCatalog12345", ["elevenlabs"]), false, "unknown voice id");
assert.equal(sel(sarah, [], sarah), true, "unchanged current voice is kept");
assert.equal(sel("clone:c1", ["elevenlabs"]), true);
assert.equal(sel("clone:other-workspace", ["elevenlabs"]), false);
assert.equal(sel("clone:c1", []), false);
assert.equal(sel("aura-2-made-up-en", []), false);

// Runtime voice block: provider voices carry the default voice as the fallback.
assert.deepEqual(runtimeVoice("openai:cedar", "en"), { engine: "realtime", realtimeVoice: "cedar", deepgramVoice: "aura-2-thalia-en", providerVoice: null });
assert.deepEqual(runtimeVoice("aura-2-orion-en", "en"), { engine: "classic", realtimeVoice: "marin", deepgramVoice: "aura-2-orion-en", providerVoice: null });
assert.deepEqual(runtimeVoice(sarah, "hi").providerVoice, { provider: "elevenlabs", voiceId: "EXAVITQu4vr4xnSDxMaL", model: "eleven_flash_v2_5", language: "hi" });
assert.equal(runtimeVoice(sarah, "hi").engine, "realtime");
assert.deepEqual(providerVoiceFor(sarah, "ur"), { provider: "elevenlabs", voiceId: "EXAVITQu4vr4xnSDxMaL", model: "eleven_v4_turbo", language: "ur" });
assert.deepEqual(providerVoiceFor(sarah, "auto"), { provider: "elevenlabs", voiceId: "EXAVITQu4vr4xnSDxMaL", model: "eleven_v4_turbo", language: null });
assert.deepEqual(providerVoiceFor(hindiWoman, "auto"), { provider: "cartesia", voiceId: "c1abd502-9231-4558-a054-10ac950c356d", model: "sonic-3.6", language: "hi" });
assert.equal(providerVoiceFor(hindiWoman, "ur")!.language, "ur");
assert.equal(providerVoiceFor("elevenlabs:NotInTheCatalog12345", "en"), null);
assert.equal(providerVoiceFor(cloneValue("c1"), "en", null), null, "deleted clone: default voice");
assert.deepEqual(providerVoiceFor(cloneValue("c1"), "ar", { providerVoiceId: "abcDEF1234567890wxyz" }), {
  provider: "elevenlabs",
  voiceId: "abcDEF1234567890wxyz",
  model: "eleven_flash_v2_5",
  language: "ar",
});

// Audio samples are judged by their bytes.
const bytes = (head: number[] | string) =>
  Uint8Array.from([...(typeof head === "string" ? [...head].map((c) => c.charCodeAt(0)) : head), ...new Array(16).fill(0)]);
assert.equal(audioType(bytes("ID3")), "audio/mpeg");
assert.equal(audioType(bytes([0xff, 0xfb])), "audio/mpeg");
assert.equal(audioType(bytes("RIFF\0\0\0\0WAVE")), "audio/wav");
assert.equal(audioType(bytes([0x1a, 0x45, 0xdf, 0xa3])), "audio/webm");
assert.equal(audioType(bytes("OggS")), "audio/ogg");
assert.equal(audioType(bytes("\0\0\0\x20ftypM4A ")), "audio/mp4");
assert.equal(audioType(bytes("fLaC")), "audio/flac");
assert.equal(audioType(bytes("%PDF-1.7")), null);
assert.equal(audioType(new Uint8Array(4)), null);

console.log("voices: all checks passed");
