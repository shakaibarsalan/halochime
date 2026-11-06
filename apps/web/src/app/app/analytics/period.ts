// Plain helpers shared by the analytics page (server) and its agent filter (client).

export const PERIODS = [7, 30, 90] as const;
export type Period = (typeof PERIODS)[number];
export const DEFAULT_PERIOD: Period = 30;

export function parsePeriod(v: string | undefined): Period {
  const n = Number(v);
  return (PERIODS as readonly number[]).includes(n) ? (n as Period) : DEFAULT_PERIOD;
}

/** /app/analytics with the chosen period and agent; the defaults are left out of the URL. */
export function analyticsHref(days: Period, agentId: string | null): string {
  const q = new URLSearchParams();
  if (days !== DEFAULT_PERIOD) q.set("days", String(days));
  if (agentId) q.set("agent", agentId);
  const s = q.toString();
  return s ? `/app/analytics?${s}` : "/app/analytics";
}
