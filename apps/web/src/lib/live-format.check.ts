// Run: npx tsx src/lib/live-format.check.ts (from apps/web)
import assert from "node:assert/strict";
import { memberDisplayName, pageLabel, startedAgo, visitorFacingName, visitorLabel } from "./live-format";

assert.equal(visitorFacingName("Sam Lee"), "Sam");
assert.equal(visitorFacingName("  Priya  "), "Priya");
assert.equal(visitorFacingName("sam@example.com"), "");
assert.equal(visitorFacingName(""), "");
assert.equal(visitorFacingName(null), "");

assert.equal(memberDisplayName("Sam Lee", "sam@example.com"), "Sam Lee");
assert.equal(memberDisplayName("", "sam@example.com"), "sam");

const now = new Date("2026-11-06T10:00:00Z");
assert.equal(startedAgo(new Date("2026-11-06T09:59:40Z"), now), "just now");
assert.equal(startedAgo("2026-11-06T09:56:00Z", now), "4 min ago");
assert.equal(startedAgo("2026-11-06T09:00:00Z", now), "1 h ago");
assert.equal(startedAgo("2026-11-06T08:55:00Z", now), "1 h 5 min ago");
assert.equal(startedAgo("2026-11-06T10:01:00Z", now), "just now"); // clock drift

assert.equal(visitorLabel("Ana", "ana@example.com"), "Ana");
assert.equal(visitorLabel(null, "ana@example.com"), "ana@example.com");
assert.equal(visitorLabel(" ", null), null);

assert.equal(pageLabel("https://shop.example.com/pricing/", null), "shop.example.com/pricing");
assert.equal(pageLabel("https://shop.example.com/", "Pricing"), "Pricing");
assert.equal(pageLabel(null, null), null);

console.log("live-format: all checks passed");
