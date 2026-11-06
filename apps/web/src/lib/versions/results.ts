// A/B test results per version. Pure, checked by results.check.ts.

/** Counts for one version, straight from the database (see loadTestResults). */
export type ArmCounts = {
  conversations: number;
  /** Conversations whose summary has an outcome (written when the conversation ends). */
  withOutcome: number;
  answered: number;
  ended: number;
  totalSeconds: number;
  totalMessages: number;
  positive: number;
  neutral: number;
  negative: number;
};

export type ArmStats = {
  conversations: number;
  /** Share of conversations with an outcome where the agent answered (0..1), null with no outcomes yet. */
  resolutionRate: number | null;
  avgSeconds: number | null;
  avgMessages: number | null;
  /** Positive minus negative, over conversations with a sentiment (-1..1), null with none. */
  sentimentScore: number | null;
  positiveShare: number | null;
  negativeShare: number | null;
};

export const EMPTY_COUNTS: ArmCounts = {
  conversations: 0,
  withOutcome: 0,
  answered: 0,
  ended: 0,
  totalSeconds: 0,
  totalMessages: 0,
  positive: 0,
  neutral: 0,
  negative: 0,
};

const ratio = (n: number, d: number) => (d > 0 ? n / d : null);

export function armStats(c: ArmCounts): ArmStats {
  const rated = c.positive + c.neutral + c.negative;
  return {
    conversations: c.conversations,
    resolutionRate: ratio(c.answered, c.withOutcome),
    avgSeconds: ratio(c.totalSeconds, c.ended),
    avgMessages: ratio(c.totalMessages, c.conversations),
    sentimentScore: ratio(c.positive - c.negative, rated),
    positiveShare: ratio(c.positive, rated),
    negativeShare: ratio(c.negative, rated),
  };
}

/** Below this many finished conversations per version a difference says little. */
export const MIN_FOR_LEADER = 20;

/**
 * The version ahead on resolution rate (then sentiment), or null while either side has too few
 * conversations with an outcome or they are level. Only a hint: the owner decides.
 */
export function leader(a: ArmCounts, b: ArmCounts): "a" | "b" | null {
  if (a.withOutcome < MIN_FOR_LEADER || b.withOutcome < MIN_FOR_LEADER) return null;
  const sa = armStats(a);
  const sb = armStats(b);
  const ra = sa.resolutionRate ?? 0;
  const rb = sb.resolutionRate ?? 0;
  if (Math.abs(ra - rb) >= 0.02) return ra > rb ? "a" : "b";
  const ta = sa.sentimentScore ?? 0;
  const tb = sb.sentimentScore ?? 0;
  if (Math.abs(ta - tb) >= 0.05) return ta > tb ? "a" : "b";
  return null;
}

export const percent = (x: number | null) => (x === null ? "-" : `${Math.round(x * 100)}%`);
