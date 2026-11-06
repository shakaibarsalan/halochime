// Live inbox helpers with no server or browser dependencies (used by both, and by live-format.check.ts).

/** A team member's words to the visitor: at most this many characters (the agent cuts at the same length). */
export const MAX_STAFF_MESSAGE = 2000;

/** The agent hands the conversation back to the AI after this long with no word from the team member. */
export const AUTO_RELEASE_MIN = 3;

/**
 * The name the visitor sees ("Sam from the team joined the chat"): the first word of the member's name,
 * never their email. Empty when there is no usable name; the agent then says "Someone".
 */
export function visitorFacingName(name: string | null | undefined): string {
  const first = (name ?? "").trim().split(/\s+/)[0] ?? "";
  if (!first || first.includes("@")) return "";
  return first.slice(0, 60);
}

/** The member's name as the dashboard shows it to other members. */
export function memberDisplayName(name: string | null | undefined, email: string): string {
  const n = (name ?? "").trim();
  return (n || email.split("@")[0] || "A team member").slice(0, 80);
}

/** "just now", "4 min ago", "1 h 5 min ago": how long ago a conversation started. */
export function startedAgo(startedAt: Date | string, now: Date = new Date()): string {
  const ms = now.getTime() - new Date(startedAt).getTime();
  const min = Math.floor(Math.max(0, ms) / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  const rest = min % 60;
  return rest ? `${h} h ${rest} min ago` : `${h} h ago`;
}

/** Who the visitor is, as far as we know: name, else email, else null (shown as "Visitor"). */
export function visitorLabel(name: string | null | undefined, email: string | null | undefined): string | null {
  return name?.trim() || email?.trim() || null;
}

/** The page the conversation started on, short: its title, else its address without the scheme. */
export function pageLabel(url: string | null | undefined, title: string | null | undefined): string | null {
  if (title?.trim()) return title.trim();
  if (!url) return null;
  return url.replace(/^https?:\/\//i, "").replace(/\/$/, "") || null;
}
