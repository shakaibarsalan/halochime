const dateTime = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });

/** Server-rendered dates are shown in UTC so server and browser agree. */
export const formatDateTime = (d: Date | null | undefined) => (d ? `${dateTime.format(d)} UTC` : "-");

export function formatDuration(totalSec: number): string {
  const s = Math.max(0, Math.round(totalSec));
  const m = Math.floor(s / 60);
  const rest = s % 60;
  return m > 0 ? `${m}m ${rest.toString().padStart(2, "0")}s` : `${rest}s`;
}

/** Wallet seconds as minutes, e.g. 1830 -> "30.5 min". Negative balances show as negative. */
export function formatMinutes(seconds: number): string {
  const min = seconds / 60;
  const text = Number.isInteger(min) ? String(min) : min.toFixed(1);
  return `${text} min`;
}
