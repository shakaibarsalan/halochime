// Run: npx tsx src/lib/versions/split.check.ts (from apps/web)
import assert from "node:assert/strict";
import { assignArm, bucketFor, BUCKETS, clampSplit, visitorKeyFor } from "./split";

// Deterministic and sticky: the same test and visitor always land in the same arm.
for (let i = 0; i < 200; i++) {
  const v = `v_visitor${i}`;
  const first = assignArm("test-1", v, 30);
  for (let k = 0; k < 5; k++) assert.equal(assignArm("test-1", v, 30), first, "same visitor, same arm");
  const b = bucketFor("test-1", v);
  assert.equal(bucketFor("test-1", v), b);
  assert.ok(b >= 0 && b < BUCKETS);
}

// Respects the percentage (within a small margin over many visitors).
for (const split of [1, 10, 25, 50, 75, 90, 99]) {
  const n = 20_000;
  let onB = 0;
  for (let i = 0; i < n; i++) if (assignArm("test-split", `visitor-${i}`, split) === "b") onB++;
  const share = (onB / n) * 100;
  assert.ok(Math.abs(share - split) < 1.5, `split ${split}% gave ${share.toFixed(2)}%`);
}

// Edges: 0% never B, 100% always B; odd input is clamped.
for (let i = 0; i < 500; i++) {
  assert.equal(assignArm("t", `x${i}`, 0), "a");
  assert.equal(assignArm("t", `x${i}`, 100), "b");
}
assert.equal(clampSplit(-5), 0);
assert.equal(clampSplit(150), 100);
assert.equal(clampSplit(Number.NaN), 50);
assert.equal(clampSplit(33.6), 34);

// Raising the split only moves visitors from A to B, never back.
for (let i = 0; i < 2000; i++) {
  const v = `grow-${i}`;
  if (assignArm("t2", v, 30) === "b") assert.equal(assignArm("t2", v, 60), "b");
}

// A new test reshuffles: assignments are independent across tests.
let same = 0;
for (let i = 0; i < 2000; i++) if (assignArm("test-a", `s${i}`, 50) === assignArm("test-b", `s${i}`, 50)) same++;
assert.ok(same > 850 && same < 1150, `tests should be independent, ${same} of 2000 matched`);

// Visitor key: widget id first, then the signed-in id, then a one-off key.
assert.equal(visitorKeyFor("v_abc12345", "user-1", "conv-1"), "v_abc12345");
assert.equal(visitorKeyFor(undefined, "user-1", "conv-1"), "user-1");
assert.equal(visitorKeyFor("  ", null, "conv-1"), "once:conv-1");

console.log("split.check: ok");
