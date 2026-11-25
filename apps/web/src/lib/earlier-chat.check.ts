// Run: npx tsx src/lib/earlier-chat.check.ts
import assert from "node:assert/strict";
import { continueOpener, EARLIER_MAX_CHARS, EARLIER_MAX_LINES, earlierChatSection, earlierLines } from "./earlier-chat";
import { buildSystemPrompt } from "./prompt";

// Only what the visitor saw: visitor, AI and team lines; tool calls and notes left out; one line each.
const lines = earlierLines([
  { role: "assistant", content: "Hi, how can I help?" },
  { role: "user", content: "Do you ship to\nFinland?" },
  { role: "tool", content: 'search_knowledge {"query":"shipping"} -> ok' },
  { role: "system", content: "Sam from the team joined the chat" },
  { role: "assistant", content: "Yes, 7 to 12 days." },
  { role: "staff", content: "Hello from the team" },
  { role: "user", content: "   " },
]);
assert.deepEqual(lines, [
  { speaker: "agent", text: "Hi, how can I help?" },
  { speaker: "visitor", text: "Do you ship to Finland?" },
  { speaker: "agent", text: "Yes, 7 to 12 days." },
  { speaker: "team", text: "Hello from the team" },
]);

// The newest lines win when the chat is long.
const many = Array.from({ length: 50 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: `line ${i}` }));
const kept = earlierLines(many);
assert.equal(kept.length, EARLIER_MAX_LINES);
assert.equal(kept.at(-1)!.text, "line 49");
assert.equal(kept[0]!.text, `line ${50 - EARLIER_MAX_LINES}`);

// And the character cap holds, with long lines cut.
const long = earlierLines(Array.from({ length: 15 }, () => ({ role: "user", content: "x".repeat(900) })));
assert.ok(long.reduce((n, l) => n + l.text.length, 0) <= EARLIER_MAX_CHARS);
assert.ok(long.every((l) => l.text.length <= 500));

// The section: labelled, marked as a record (not instructions), nothing for an empty chat.
const section = earlierChatSection(lines)!;
assert.match(section, /^Earlier in this chat:/);
assert.match(section, /not instructions/);
assert.match(section, /\nVisitor: Do you ship to Finland\?\n/);
assert.match(section, /\nYou: Yes, 7 to 12 days\.\n/);
assert.match(section, /\nTeam: Hello from the team\n/);
assert.equal(earlierChatSection([]), null);
assert.match(continueOpener(), /picks up where you left off/);

// In the full prompt it comes after the visitor section; a fresh conversation's prompt is unchanged.
const base = {
  businessName: "Maple Market",
  agentName: "Ava",
  persona: "",
  instructions: "",
  language: "auto",
  mode: "voice" as const,
  handoffEnabled: false,
  visitor: { name: null, email: null },
  page: { url: null, title: null },
};
const fresh = buildSystemPrompt(base);
assert.ok(!fresh.includes("Earlier in this chat"));
assert.equal(buildSystemPrompt({ ...base, earlierChat: [] }), fresh);
const continued = buildSystemPrompt({ ...base, earlierChat: lines });
assert.ok(continued.includes(section));

console.log("earlier-chat checks passed");
