// Run: npx tsx src/lib/versions/snapshot.check.ts (from apps/web)
import assert from "node:assert/strict";
import { armStats, EMPTY_COUNTS, leader, MIN_FOR_LEADER, percent } from "./results";
import { applySnapshot, changedKeys, readSnapshot, SNAPSHOT_KEYS, snapshotFromAgent, snapshotUpdate } from "./snapshot";

const agent = {
  id: "agent-1",
  organizationId: "org-1",
  name: "Support agent",
  publicKey: "pk_test",
  allowedDomains: ["example.com"],
  greeting: "Hi there!",
  persona: "a friendly agent",
  instructions: "Never promise refunds.",
  language: "en",
  sttModel: "nova-3",
  ttsVoice: "openai:marin",
  llmModel: "openai/gpt-oss-20b",
  temperature: 0.4,
  maxDurationSec: 900,
  handoffEnabled: true,
};

// A snapshot keeps exactly the talking setup.
const snap = snapshotFromAgent(agent);
assert.deepEqual(Object.keys(snap).sort(), [...SNAPSHOT_KEYS].sort());
assert.equal(snap.greeting, "Hi there!");
assert.equal((snap as Record<string, unknown>).allowedDomains, undefined);
assert.equal((snap as Record<string, unknown>).maxDurationSec, undefined);

// JSON round trip (as stored in jsonb) reads back the same.
assert.deepEqual(readSnapshot(JSON.parse(JSON.stringify(snap)), agent), snap);

// Apply: version fields win, everything else stays the agent's own.
const version = { ...snap, greeting: "Hello from B", ttsVoice: "aura-2-thalia-en", temperature: 0.9, language: "auto" };
const applied = applySnapshot(agent, version);
assert.equal(applied.greeting, "Hello from B");
assert.equal(applied.ttsVoice, "aura-2-thalia-en");
assert.equal(applied.temperature, 0.9);
assert.equal(applied.language, "auto");
assert.equal(applied.id, "agent-1");
assert.deepEqual(applied.allowedDomains, ["example.com"]);
assert.equal(applied.maxDurationSec, 900);
assert.equal(applied.handoffEnabled, true);
assert.equal(agent.greeting, "Hi there!", "apply never changes the agent object");

// Restore writes only snapshot columns.
assert.deepEqual(Object.keys(snapshotUpdate(version)).sort(), [...SNAPSHOT_KEYS].sort());

// Broken or partial stored data falls back to the agent's current values.
assert.deepEqual(readSnapshot(null, agent), snap);
assert.deepEqual(readSnapshot("nonsense", agent), snap);
const mixed = readSnapshot({ greeting: "Only greeting", temperature: "hot" }, agent);
assert.equal(mixed.greeting, "Only greeting", "a broken field does not throw away the good ones");
assert.equal(mixed.temperature, 0.4, "the broken field takes the agent's value");
const partial = readSnapshot({ greeting: "Only greeting" }, agent);
assert.equal(partial.greeting, "Only greeting");
assert.equal(partial.persona, agent.persona);
assert.equal(readSnapshot({ greeting: "   " }, agent).greeting, "Hi there!", "an empty greeting is never restored");
assert.equal(readSnapshot({ instructions: "" }, agent).instructions, "", "empty business rules are a real choice");

// Differences.
assert.deepEqual(changedKeys(snap, snap), []);
assert.deepEqual(changedKeys(snap, version).sort(), ["greeting", "language", "temperature", "ttsVoice"]);

// Results per version.
const s = armStats({ ...EMPTY_COUNTS, conversations: 10, withOutcome: 8, answered: 6, ended: 9, totalSeconds: 900, totalMessages: 50, positive: 4, neutral: 3, negative: 1 });
assert.equal(s.resolutionRate, 0.75);
assert.equal(s.avgSeconds, 100);
assert.equal(s.avgMessages, 5);
assert.equal(s.sentimentScore, 3 / 8);
assert.equal(percent(s.positiveShare), "50%");
assert.deepEqual(armStats(EMPTY_COUNTS), {
  conversations: 0,
  resolutionRate: null,
  avgSeconds: null,
  avgMessages: null,
  sentimentScore: null,
  positiveShare: null,
  negativeShare: null,
});
const arm = (withOutcome: number, answered: number, positive = 0, negative = 0) => ({ ...EMPTY_COUNTS, conversations: withOutcome, withOutcome, answered, positive, negative });
assert.equal(leader(arm(MIN_FOR_LEADER - 1, 19), arm(50, 10)), null, "too few to call");
assert.equal(leader(arm(40, 30), arm(40, 20)), "a");
assert.equal(leader(arm(40, 20), arm(40, 30)), "b");
assert.equal(leader(arm(40, 20, 10, 0), arm(40, 20, 0, 10)), "a", "level on resolution: sentiment decides");
assert.equal(leader(arm(40, 20), arm(40, 20)), null);

console.log("snapshot.check: ok");
