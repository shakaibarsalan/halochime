// Live inbox: a person from the business took the conversation over from the AI. The agent tells the
// widget when they join or leave (TOPIC_NOTICE) and, in text chats, sends their replies (TOPIC_STAFF_REPLY).
// Pure parsing and wording, checked by staff.check.ts.

/** A small centred line in the conversation, e.g. "Sam from the team joined the chat". */
export interface StaffNotice {
  kind: "joined" | "left";
  text: string;
}

/** A text chat reply written by a team member. */
export interface StaffReply {
  id: string;
  /** Their first name as the visitor sees it ("" when unknown). */
  name: string;
  text: string;
}

const MAX_NOTICE = 200;
const MAX_NAME = 60;
const MAX_TEXT = 4000;

function parse(raw: string): Record<string, unknown> | null {
  try {
    const v: unknown = JSON.parse(raw);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

export function parseStaffNotice(raw: string): StaffNotice | null {
  const msg = parse(raw);
  if (!msg || (msg.type !== "joined" && msg.type !== "left")) return null;
  const text = str(msg.text, MAX_NOTICE).replace(/\s+/g, " ");
  return text ? { kind: msg.type, text } : null;
}

export function parseStaffReply(raw: string): StaffReply | null {
  const msg = parse(raw);
  if (!msg) return null;
  const text = str(msg.text, MAX_TEXT);
  if (!text) return null;
  return { id: str(msg.id, 100), name: str(msg.name, MAX_NAME).replace(/\s+/g, " "), text };
}

/** The label above a team member's reply: "Sam · Team", or "Team" without a name. */
export function staffLabel(name: string): string {
  return name ? `${name} · Team` : "Team";
}
