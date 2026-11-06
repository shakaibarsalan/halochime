import {
  HELP_REASON_MAX,
  PROACTIVE_DELAY_MAX_SEC,
  PROACTIVE_MATCHES,
  PROACTIVE_MESSAGE_MAX,
  type ProactiveMatch,
  type WidgetProactiveHelp,
} from "@talkfront/shared";

// Proactive help: which rule fits the page, and "at most once per page per visit". Pure, so it can be
// checked without a browser (proactive.check.ts); widget.ts shows the bubble.

type Rule = WidgetProactiveHelp["rules"][number];

/** Lowercase path without a trailing slash ("/" stays "/"), so "/Pricing/" and "/pricing" are one page. */
export function normalizePath(path: string): string {
  const p = (path || "/").trim().toLowerCase();
  return p.length > 1 ? p.replace(/\/+$/, "") || "/" : p;
}

export function ruleMatches(rule: Pick<Rule, "match" | "path">, path: string): boolean {
  if (rule.match === "any") return true;
  const want = normalizePath(rule.path);
  if (!rule.path.trim()) return false;
  const here = normalizePath(path);
  if (rule.match === "exact") return here === want;
  if (rule.match === "starts_with") return here.startsWith(want);
  return here.includes(want);
}

/** The first rule that fits this page, or null. */
export function matchRule(rules: readonly Rule[], path: string): Rule | null {
  return rules.find((r) => ruleMatches(r, path)) ?? null;
}

/** Light runtime check of the config (no zod in the bundle). Bad rules are dropped. */
export function cleanProactive(raw: unknown): WidgetProactiveHelp | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as { rules?: unknown; defaultMessage?: unknown };
  const rules: Rule[] = [];
  for (const item of Array.isArray(r.rules) ? r.rules.slice(0, 20) : []) {
    if (!item || typeof item !== "object") continue;
    const x = item as Record<string, unknown>;
    const match = (PROACTIVE_MATCHES as readonly string[]).includes(x.match as string) ? (x.match as ProactiveMatch) : null;
    const message = typeof x.message === "string" ? x.message.trim().slice(0, PROACTIVE_MESSAGE_MAX) : "";
    const delay = typeof x.delaySec === "number" && Number.isFinite(x.delaySec) ? Math.round(x.delaySec) : 0;
    if (!match || !message) continue;
    rules.push({
      id: typeof x.id === "string" ? x.id.slice(0, 12) : String(rules.length),
      match,
      path: typeof x.path === "string" ? x.path : "",
      delaySec: Math.min(Math.max(delay, 0), PROACTIVE_DELAY_MAX_SEC),
      message,
    });
  }
  const defaultMessage = typeof r.defaultMessage === "string" ? r.defaultMessage.trim().slice(0, PROACTIVE_MESSAGE_MAX) : "";
  return { rules, defaultMessage: defaultMessage || "Need a hand? Tap here and ask us." };
}

/** offerHelp({ reason, message }) arguments, cleaned. Message falls back to the business's default. */
export function cleanOffer(raw: unknown, defaultMessage: string): { reason: string; message: string } {
  const o = raw && typeof raw === "object" ? (raw as { reason?: unknown; message?: unknown }) : {};
  const oneLine = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
  return {
    reason: oneLine(o.reason, HELP_REASON_MAX),
    message: oneLine(o.message, PROACTIVE_MESSAGE_MAX) || defaultMessage,
  };
}

/** What a shown bubble is remembered by: page rules share one slot per page, offerHelp one per reason. */
export function offerKey(path: string, source: "rule" | "api", reason = ""): string {
  return `${normalizePath(path)}|${source === "rule" ? "rule" : `api:${reason}`}`;
}

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const MAX_REMEMBERED = 100;

/**
 * Bubbles already shown in this visit (sessionStorage: a new tab or visit starts fresh). Storage can be
 * missing or throw (private mode, blocked site data): then it is remembered for this page load only.
 */
export class OfferMemory {
  private readonly key: string;
  private readonly store: KeyValueStore | null;
  private readonly local = new Set<string>();

  constructor(agentId: string, store: KeyValueStore | null) {
    this.key = `halochime.help.${agentId || "agent"}`;
    this.store = store;
  }

  private read(): string[] {
    try {
      const raw = this.store?.getItem(this.key);
      const list: unknown = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list.filter((x): x is string => typeof x === "string") : [];
    } catch {
      return [];
    }
  }

  shown(offer: string): boolean {
    return this.local.has(offer) || this.read().includes(offer);
  }

  remember(offer: string): void {
    this.local.add(offer);
    try {
      const list = this.read().filter((x) => x !== offer);
      list.push(offer);
      this.store?.setItem(this.key, JSON.stringify(list.slice(-MAX_REMEMBERED)));
    } catch {
      // storage full or blocked: the in-memory copy still keeps it to once per page load
    }
  }
}

/** sessionStorage, or null where reading it throws. */
export function sessionStore(): KeyValueStore | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}
