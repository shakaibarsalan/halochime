import {
  BUILT_IN_COLLECT_KEYS,
  COLLECT_KEY_RE,
  CollectField as CollectFieldSchema,
  CONVERSATION_OUTCOMES,
  MAX_COLLECT_FIELDS,
  SENTIMENTS,
  type BuiltInCollectKey,
  type CollectedData,
  type CollectedValue,
  type CollectField,
  type CollectFieldType,
  type ConversationOutcome,
  type Sentiment,
} from "@talkfront/shared";

// Pure helpers for "information to collect" (no server imports): shared by the dashboard panel, the
// server actions, the summary step, the conversation page and the webhook payload.
// Spec: docs/integrations.md section 5.

export const COLLECT_TYPE_LABELS: Record<CollectFieldType, string> = {
  text: "Text",
  number: "Number",
  yes_no: "Yes or no",
  date: "Date",
  email: "Email",
  phone: "Phone",
  choice: "Choice",
};

/** Built-in fields as the dashboard shows them, in display order. */
export const BUILT_IN_FIELDS: { key: BuiltInCollectKey; label: string }[] = [
  { key: "visitor_name", label: "Name" },
  { key: "email", label: "Email" },
  { key: "phone", label: "Phone" },
  { key: "topic", label: "Topic" },
  { key: "outcome", label: "Outcome" },
  { key: "follow_up_needed", label: "Follow-up needed" },
  { key: "sentiment", label: "Sentiment" },
];

export const OUTCOME_LABELS: Record<ConversationOutcome, string> = {
  answered: "Answered",
  message_taken: "Message taken",
  not_answered: "Not answered",
  other: "Other",
};

/** Badge colours for each outcome in the dashboard. */
export const OUTCOME_TONES = { answered: "green", message_taken: "blue", not_answered: "amber", other: "gray" } as const satisfies Record<
  ConversationOutcome,
  string
>;

export const SENTIMENT_LABELS: Record<Sentiment, string> = {
  positive: "Positive",
  neutral: "Neutral",
  negative: "Negative",
};

const builtIn: readonly string[] = BUILT_IN_COLLECT_KEYS;
export const isBuiltInKey = (key: string) => builtIn.includes(key);

/** "Party size" -> "party_size". Always matches COLLECT_KEY_RE, or is "" for a label with no letters. */
export function keyFromLabel(label: string): string {
  let key = label
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (key && !/^[a-z]/.test(key)) key = `field_${key}`;
  key = key.slice(0, 40).replace(/_+$/, "");
  return COLLECT_KEY_RE.test(key) ? key : "";
}

// ---------------------------------------------------------------------------- coercion

const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}$/;
const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})/;

function text(raw: unknown, max: number): string | null {
  if (typeof raw === "number" && Number.isFinite(raw)) return String(raw);
  if (typeof raw !== "string") return null;
  const v = raw.replace(/[\u0000-\u001f\u007f\s]+/g, " ").trim();
  if (!v || /^(null|none|n\/a|unknown|not mentioned)$/i.test(v)) return null;
  return v.slice(0, max);
}

function number(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== "string") return null;
  const v = raw.trim().replace(/[\s,]/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(v)) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function yesNo(raw: unknown): boolean | null {
  if (typeof raw === "boolean") return raw;
  if (typeof raw !== "string") return null;
  const v = raw.trim().toLowerCase();
  if (["yes", "true", "y"].includes(v)) return true;
  if (["no", "false", "n"].includes(v)) return false;
  return null;
}

/** YYYY-MM-DD when it is a real calendar date; otherwise the visitor's own words (e.g. "early March"). */
function date(raw: unknown): string | null {
  const v = text(raw, 100);
  if (!v) return null;
  const m = ISO_DATE_RE.exec(v);
  if (!m) return v;
  const [, y, mo, d] = m;
  const dt = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
  const ok = dt.getUTCFullYear() === Number(y) && dt.getUTCMonth() === Number(mo) - 1 && dt.getUTCDate() === Number(d);
  return ok ? `${y}-${mo}-${d}` : null;
}

function email(raw: unknown): string | null {
  const v = text(raw, 320)?.replace(/\s+/g, "").toLowerCase();
  return v && EMAIL_RE.test(v) ? v : null;
}

function phone(raw: unknown): string | null {
  const v = text(raw, 40);
  if (!v || !/^[0-9+\-().\s]+$/.test(v)) return null;
  const digits = v.replace(/\D/g, "").length;
  return digits >= 5 && digits <= 20 ? v : null;
}

function choice(raw: unknown, options: string[]): string | null {
  const v = text(raw, 100)?.toLowerCase();
  if (!v) return null;
  return options.find((o) => o.toLowerCase() === v) ?? null;
}

/** One value from the extractor, checked against the field's type. Anything that doesn't fit -> null. */
export function coerceValue(type: CollectFieldType, raw: unknown, options: string[] = []): CollectedValue {
  switch (type) {
    case "text":
      return text(raw, 500);
    case "number":
      return number(raw);
    case "yes_no":
      return yesNo(raw);
    case "date":
      return date(raw);
    case "email":
      return email(raw);
    case "phone":
      return phone(raw);
    case "choice":
      return choice(raw, options);
  }
}

const oneOf = <T extends string>(raw: unknown, values: readonly T[]): T | null => {
  const v = typeof raw === "string" ? raw.trim().toLowerCase().replace(/[\s-]+/g, "_") : "";
  return (values as readonly string[]).includes(v) ? (v as T) : null;
};

/**
 * The extractor's `data` object -> what we store. Unknown keys are dropped, bad values become null,
 * and every defined field is present (null = not mentioned).
 */
export function coerceCollected(raw: unknown, fields: CollectField[]): CollectedData {
  const d = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const custom: CollectedData["custom"] = {};
  for (const f of fields) {
    if (isBuiltInKey(f.key)) continue;
    custom[f.key] = { label: f.label, type: f.type, value: coerceValue(f.type, d[f.key], f.options) };
  }
  return {
    visitor_name: text(d.visitor_name, 200),
    email: email(d.email),
    phone: phone(d.phone),
    topic: text(d.topic, 120),
    outcome: oneOf(d.outcome, CONVERSATION_OUTCOMES),
    follow_up_needed: yesNo(d.follow_up_needed),
    sentiment: oneOf(d.sentiment, SENTIMENTS),
    custom,
  };
}

/** Saved agents.collect_fields, defensively: rows edited by hand may not match the contract. */
export function readCollectFields(raw: unknown): CollectField[] {
  if (!Array.isArray(raw)) return [];
  const out: CollectField[] = [];
  for (const item of raw) {
    const f = CollectFieldSchema.safeParse(item);
    if (f.success && !out.some((x) => x.key === f.data.key)) out.push(f.data);
  }
  return out.slice(0, MAX_COLLECT_FIELDS);
}

/**
 * Stored data in a stable order: built-in fields first, then custom fields in the agent's current
 * order, then values of fields deleted since. Postgres jsonb does not keep key order, so anything
 * that shows or sends collected data goes through here.
 */
export function orderCollected(data: CollectedData, fieldKeys: string[]): CollectedData {
  const stored = data.custom ?? {};
  const keys = [...fieldKeys.filter((k) => k in stored), ...Object.keys(stored).filter((k) => !fieldKeys.includes(k))];
  return {
    visitor_name: data.visitor_name ?? null,
    email: data.email ?? null,
    phone: data.phone ?? null,
    topic: data.topic ?? null,
    outcome: data.outcome ?? null,
    follow_up_needed: data.follow_up_needed ?? null,
    sentiment: data.sentiment ?? null,
    custom: Object.fromEntries(keys.map((k) => [k, stored[k]!])),
  };
}

// ---------------------------------------------------------------------------- display

const shortDate = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** A stored value as text for the dashboard; null when not mentioned. */
export function displayValue(type: CollectFieldType, value: CollectedValue): string | null {
  if (value === null || value === "") return null;
  if (type === "yes_no" || typeof value === "boolean") return value ? "Yes" : "No";
  if (type === "date" && typeof value === "string") {
    const m = ISO_DATE_RE.exec(value);
    if (m && value.length === 10) return shortDate.format(new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))));
  }
  if (type === "number" && typeof value === "number") return value.toLocaleString("en");
  return String(value);
}
