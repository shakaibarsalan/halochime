import { z } from "zod";

// What a saved agent version holds: how the agent talks (greeting, persona, rules, language, voice
// and models). Where it runs, its look, actions and collected fields stay with the agent itself.
// Pure: no database, so it is checked by snapshot.check.ts.

export const SNAPSHOT_KEYS = [
  "greeting",
  "persona",
  "instructions",
  "language",
  "sttModel",
  "ttsVoice",
  "llmModel",
  "temperature",
] as const;

export type AgentSnapshot = {
  greeting: string;
  persona: string;
  instructions: string;
  language: string;
  sttModel: string;
  ttsVoice: string;
  llmModel: string;
  temperature: number;
};

/** The agent columns a snapshot is made from (a row of the agents table has them all). */
export type SnapshotSource = AgentSnapshot;

const FIELDS = {
  greeting: z.string().max(500),
  persona: z.string().max(1000),
  instructions: z.string().max(8000),
  language: z.string().max(20),
  sttModel: z.string().max(100),
  ttsVoice: z.string().max(100),
  llmModel: z.string().max(100),
  temperature: z.number().min(0).max(2),
} as const;

/** Each field on its own: one broken field never throws away the others. */
function storedFields(raw: unknown): Partial<AgentSnapshot> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const o = raw as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of SNAPSHOT_KEYS) {
    const r = FIELDS[key].safeParse(o[key]);
    if (r.success) out[key] = r.data;
  }
  return out as Partial<AgentSnapshot>;
}

/** A copy of the agent's talking setup, with nothing else from the row. */
export function snapshotFromAgent(agent: SnapshotSource): AgentSnapshot {
  return {
    greeting: agent.greeting,
    persona: agent.persona,
    instructions: agent.instructions,
    language: agent.language,
    sttModel: agent.sttModel,
    ttsVoice: agent.ttsVoice,
    llmModel: agent.llmModel,
    temperature: agent.temperature,
  };
}

/**
 * A stored snapshot, read defensively: a field that is missing or broken (older versions, a hand
 * edit) takes the agent's current value, so a version can never leave the agent half set up.
 */
export function readSnapshot(raw: unknown, fallback: SnapshotSource): AgentSnapshot {
  const s = storedFields(raw);
  const base = snapshotFromAgent(fallback);
  return {
    greeting: s.greeting?.trim() ? s.greeting : base.greeting,
    persona: s.persona ?? base.persona,
    instructions: s.instructions ?? base.instructions,
    language: s.language || base.language,
    sttModel: s.sttModel || base.sttModel,
    ttsVoice: s.ttsVoice || base.ttsVoice,
    llmModel: s.llmModel || base.llmModel,
    temperature: s.temperature ?? base.temperature,
  };
}

/** The agent as a version runs it: the version's talking setup over everything else of the agent. */
export function applySnapshot<T extends SnapshotSource>(agent: T, snapshot: AgentSnapshot): T {
  return { ...agent, ...snapshotFromAgent(snapshot) };
}

/** The columns to write when a version is restored onto the agent (nothing outside the snapshot). */
export function snapshotUpdate(snapshot: AgentSnapshot): AgentSnapshot {
  return snapshotFromAgent(snapshot);
}

/** Which fields differ between two snapshots (for "what changed" in the versions list). */
export function changedKeys(a: AgentSnapshot, b: AgentSnapshot): (typeof SNAPSHOT_KEYS)[number][] {
  return SNAPSHOT_KEYS.filter((k) => a[k] !== b[k]);
}

export const SNAPSHOT_LABELS: Record<(typeof SNAPSHOT_KEYS)[number], string> = {
  greeting: "Greeting",
  persona: "Persona",
  instructions: "Business rules",
  language: "Language",
  sttModel: "Speech to text",
  ttsVoice: "Voice",
  llmModel: "Language model",
  temperature: "Temperature",
};
