// Cost guards for test runs.

/** Test questions per agent (each run asks the agent and the judge once per question). */
export const MAX_TEST_CASES = 25;

const DEFAULT_RUNS_PER_DAY = 10;

/** Test runs per workspace in any 24 hours. AGENT_TEST_RUNS_PER_DAY overrides the default of 10. */
export function runsPerDay(): number {
  const raw = process.env.AGENT_TEST_RUNS_PER_DAY?.trim();
  if (!raw) return DEFAULT_RUNS_PER_DAY;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 && n <= 1000 ? n : DEFAULT_RUNS_PER_DAY;
}

/** A run still "running" after this long was cut off (server restart, time limit) and shows as stopped. */
export const STALE_RUN_MS = 10 * 60 * 1000;
