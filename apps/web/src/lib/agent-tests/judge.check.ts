// Run: npx tsx src/lib/agent-tests/judge.check.ts (from apps/web)
import assert from "node:assert/strict";
import { judgeUserMessage, parseJudgeReply } from "./judge";
import { ANSWER_LANGUAGE_NOTE, AUTO_KNOWLEDGE_NOTE, cleanAnswer, formatResults, knowledgeNote, RESULT_CONTENT_CHARS, turnMessages } from "./pipeline";

// Plain JSON.
assert.deepEqual(parseJudgeReply('{"pass": true, "reason": "Says Saturday until 2 pm."}'), { pass: true, reason: "Says Saturday until 2 pm." });
assert.deepEqual(parseJudgeReply('{"pass": false, "reason": "Promises a refund."}'), { pass: false, reason: "Promises a refund." });
// Code fences and chatter around it.
assert.deepEqual(parseJudgeReply('Here you go:\n```json\n{"pass": false, "reason": "Misses the price"}\n```'), { pass: false, reason: "Misses the price" });
// Other spellings.
assert.deepEqual(parseJudgeReply('{"verdict": "PASS", "explanation": "ok"}'), { pass: true, reason: "ok" });
assert.deepEqual(parseJudgeReply('{"passed": "false", "reason": "  too\\n vague  "}'), { pass: false, reason: "too vague" });
assert.equal(parseJudgeReply('{"pass": true}')?.reason, "Covers what it must say.");
// Bare lines.
assert.deepEqual(parseJudgeReply("PASS: mentions the opening hours"), { pass: true, reason: "mentions the opening hours" });
assert.deepEqual(parseJudgeReply("**Fail** - says it delivers on Sunday"), { pass: false, reason: "says it delivers on Sunday" });
assert.equal(parseJudgeReply("Failed.")?.pass, false);
// Nothing usable.
assert.equal(parseJudgeReply(""), null);
assert.equal(parseJudgeReply("I am not sure."), null);
assert.equal(parseJudgeReply('{"pass": "maybe"}'), null);
assert.equal(parseJudgeReply("{not json"), null);
// A reason is capped and kept on one line.
assert.ok((parseJudgeReply(JSON.stringify({ pass: true, reason: "x".repeat(1000) }))?.reason.length ?? 0) <= 300);

// The judge input keeps the business text on one line inside its tags.
const msg = judgeUserMessage({ question: "Open\non Sunday?", mustSay: "No", mustNotSay: "", answer: "We are closed on Sundays." });
assert.ok(msg.includes("<question>Open on Sunday?</question>"));
assert.ok(msg.includes("<must_not_say></must_not_say>"));

// The knowledge note, as the live agent builds it.
assert.equal(knowledgeNote([]), null);
const note = knowledgeNote([
  { title: "Delivery", url: "https://example.com/delivery", content: "We  deliver\nMonday to Saturday." },
  { title: " ", url: null, content: "y".repeat(RESULT_CONTENT_CHARS + 50) },
]);
assert.ok(note);
assert.ok(note.startsWith(AUTO_KNOWLEDGE_NOTE));
assert.ok(note.endsWith(ANSWER_LANGUAGE_NOTE));
assert.ok(note.includes("[1] Delivery (https://example.com/delivery)\nWe deliver Monday to Saturday."));
assert.ok(note.includes("[2] Untitled\n"));
const long = formatResults([{ title: "t", url: null, content: "y".repeat(RESULT_CONTENT_CHARS + 50) }]);
assert.ok(long.endsWith("…"));
assert.equal(long.split("\n")[1]!.length, RESULT_CONTENT_CHARS);
assert.deepEqual(
  turnMessages("SYSTEM", "NOTE", "Q").map((m) => m.role),
  ["system", "system", "user"],
);
assert.deepEqual(
  turnMessages("SYSTEM", null, "Q").map((m) => m.role),
  ["system", "user"],
);
assert.equal(cleanAnswer("<think>hmm</think>  Hello  "), "Hello");

console.log("judge.check: ok");
