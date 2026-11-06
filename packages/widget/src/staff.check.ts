/**
 * Checks for staff.ts (the widget has no test runner). Run from packages/widget:
 *
 *   npx tsx src/staff.check.ts
 *
 * Not part of the widget bundle (nothing imports it); it fails with an error when a check does.
 */
import { parseStaffNotice, parseStaffReply, staffLabel } from "./staff";

function same(actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`expected ${e}, got ${a}`);
}
const assert = { deepEqual: same, equal: same };

assert.deepEqual(parseStaffNotice('{"type":"joined","name":"Sam","text":"Sam from the team joined the chat"}'), {
  kind: "joined",
  text: "Sam from the team joined the chat",
});
assert.deepEqual(parseStaffNotice('{"type":"left","text":"  You\'re back with\\n Ava "}'), { kind: "left", text: "You're back with Ava" });
assert.equal(parseStaffNotice('{"type":"joined","text":"   "}'), null);
assert.equal(parseStaffNotice('{"type":"party","text":"hi"}'), null);
assert.equal(parseStaffNotice("not json"), null);
assert.equal(parseStaffNotice("[1,2]"), null);
assert.equal(parseStaffNotice('{"type":"joined","text":"' + "x".repeat(500) + '"}')?.text.length, 200);

assert.deepEqual(parseStaffReply('{"id":"m1","name":"Sam","text":"Hi! Let me check.\\nOne moment."}'), {
  id: "m1",
  name: "Sam",
  text: "Hi! Let me check.\nOne moment.",
});
assert.deepEqual(parseStaffReply('{"text":"Hello"}'), { id: "", name: "", text: "Hello" });
assert.equal(parseStaffReply('{"id":"m2","name":"Sam","text":""}'), null);
assert.equal(parseStaffReply('{"text":42}'), null);
assert.equal(parseStaffReply("null"), null);

assert.equal(staffLabel("Sam"), "Sam · Team");
assert.equal(staffLabel(""), "Team");

console.log("staff: all checks passed");
