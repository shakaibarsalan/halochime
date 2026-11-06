import { createHash } from "node:crypto";

// A/B split assignment. Pure and deterministic: the same test and visitor always get the same arm,
// so the config request (greeting shown before the chat) and the session request agree without
// storing anything, and a returning visitor keeps their version for the whole test.

export type Arm = "a" | "b";

/** Buckets per test: 10,000 so a split can be set in whole percent and still be exact. */
export const BUCKETS = 10_000;

/** The visitor's bucket (0 to 9,999) in this test. A new test reshuffles visitors. */
export function bucketFor(testId: string, visitorKey: string): number {
  const digest = createHash("sha256").update(`${testId}\u0000${visitorKey}`).digest();
  return digest.readUInt32BE(0) % BUCKETS;
}

/** Whole percent of visitors on version B, clamped to 0..100. */
export function clampSplit(splitB: number): number {
  if (!Number.isFinite(splitB)) return 50;
  return Math.min(100, Math.max(0, Math.round(splitB)));
}

/** Which version this visitor gets: B for the first splitB percent of buckets, A for the rest. */
export function assignArm(testId: string, visitorKey: string, splitB: number): Arm {
  return bucketFor(testId, visitorKey) < clampSplit(splitB) * (BUCKETS / 100) ? "b" : "a";
}

/**
 * The key a visitor is split by: the widget's own visitor id first (the config request has only that
 * one), then the signed-in user id, then a one-off id (that visitor is split per conversation).
 */
export function visitorKeyFor(widgetVisitorId: string | null | undefined, identitySub: string | null | undefined, fallback: string): string {
  const id = widgetVisitorId?.trim() || identitySub?.trim();
  return id ? id : `once:${fallback}`;
}
