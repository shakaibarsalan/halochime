// WhatsApp Business Cloud API (Meta): pure helpers for the webhook, no server-only import so the
// check script can run them. Network calls are in whatsapp-api.ts.

import { createHmac, timingSafeEqual } from "node:crypto";

/** Graph API version used for media and messages. */
export const GRAPH_VERSION = "v25.0";
export const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

/**
 * Meta signs each webhook POST with the app secret: header `X-Hub-Signature-256: sha256=<hex HMAC-SHA256
 * of the raw body>`. The raw bytes must be used, before any JSON parsing. Constant time compare.
 */
export function verifyWebhookSignature(rawBody: Uint8Array | string, header: string | null, appSecret: string): boolean {
  if (!header || !appSecret) return false;
  const match = /^sha256=([0-9a-f]{64})$/i.exec(header.trim());
  if (!match) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody).digest();
  const given = Buffer.from(match[1]!, "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** For tests and docs: the header Meta would send for this body. */
export const signWebhookBody = (rawBody: Uint8Array | string, appSecret: string) =>
  `sha256=${createHmac("sha256", appSecret).update(rawBody).digest("hex")}`;

/**
 * The verification GET Meta sends when the webhook URL is saved: hub.mode=subscribe, hub.verify_token,
 * hub.challenge. Returns the challenge to echo back when the token matches, else null.
 */
export function verifyChallenge(params: URLSearchParams, verifyToken: string): string | null {
  if (params.get("hub.mode") !== "subscribe" || !verifyToken) return null;
  const token = params.get("hub.verify_token") ?? "";
  const a = Buffer.from(token);
  const b = Buffer.from(verifyToken);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const challenge = params.get("hub.challenge") ?? "";
  // Meta sends a number; never echo anything that could be markup.
  return /^[A-Za-z0-9_-]{1,200}$/.test(challenge) ? challenge : null;
}

export type InboundMessage = {
  /** wamid..., unique per message: used to answer each message once. */
  id: string;
  /** Sender's WhatsApp id (their phone number in international format, digits only). */
  from: string;
  /** Sender's profile name, when Meta sends one. Not verified. */
  profileName: string | null;
  /** Unix seconds from Meta. */
  timestamp: number;
} & (
  | { type: "text"; text: string }
  | { type: "audio"; mediaId: string; mimeType: string; voice: boolean }
  | { type: "unsupported"; original: string }
);

const MAX_TEXT = 4000;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown, max = 200): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

/**
 * The messages in a webhook payload addressed to `phoneNumberId`. Status updates (sent, delivered,
 * read), other numbers' messages and anything malformed are left out. Never throws.
 */
export function parseWebhookMessages(payload: unknown, phoneNumberId: string): InboundMessage[] {
  if (!isObj(payload) || payload.object !== "whatsapp_business_account" || !Array.isArray(payload.entry)) return [];
  const out: InboundMessage[] = [];
  for (const entry of payload.entry) {
    if (!isObj(entry) || !Array.isArray(entry.changes)) continue;
    for (const change of entry.changes) {
      if (!isObj(change) || change.field !== "messages" || !isObj(change.value)) continue;
      const value = change.value;
      if (!isObj(value.metadata) || value.metadata.phone_number_id !== phoneNumberId) continue;
      const names = new Map<string, string>();
      if (Array.isArray(value.contacts)) {
        for (const c of value.contacts) {
          const waId = isObj(c) ? str(c.wa_id, 32) : null;
          const name = isObj(c) && isObj(c.profile) ? str(c.profile.name, 200) : null;
          if (waId && name) names.set(waId, name);
        }
      }
      if (!Array.isArray(value.messages)) continue;
      for (const m of value.messages) {
        const parsed = parseOne(m, names);
        if (parsed) out.push(parsed);
      }
    }
  }
  return out;
}

function parseOne(m: unknown, names: Map<string, string>): InboundMessage | null {
  if (!isObj(m)) return null;
  const id = str(m.id, 200);
  const from = str(m.from, 32);
  if (!id || !from || !/^\d{6,20}$/.test(from)) return null;
  const ts = Number(m.timestamp);
  const base = { id, from, profileName: names.get(from) ?? null, timestamp: Number.isFinite(ts) ? ts : Math.floor(Date.now() / 1000) };
  const type = typeof m.type === "string" ? m.type : "";
  if (type === "text" && isObj(m.text)) {
    const body = typeof m.text.body === "string" ? m.text.body.trim().slice(0, MAX_TEXT) : "";
    return body ? { ...base, type: "text", text: body } : null;
  }
  if (type === "audio" && isObj(m.audio)) {
    const mediaId = str(m.audio.id, 200);
    if (!mediaId) return null;
    return {
      ...base,
      type: "audio",
      mediaId,
      mimeType: str(m.audio.mime_type, 100) ?? "audio/ogg",
      voice: m.audio.voice === true,
    };
  }
  // Buttons and list replies carry text the visitor picked.
  if (type === "button" && isObj(m.button)) {
    const t = str(m.button.text, MAX_TEXT);
    return t ? { ...base, type: "text", text: t } : null;
  }
  if (type === "interactive" && isObj(m.interactive)) {
    const reply = isObj(m.interactive.button_reply) ? m.interactive.button_reply : isObj(m.interactive.list_reply) ? m.interactive.list_reply : null;
    const t = reply ? str(reply.title, MAX_TEXT) : null;
    return t ? { ...base, type: "text", text: t } : null;
  }
  return { ...base, type: "unsupported", original: type.slice(0, 40) || "unknown" };
}

/** Meta's phone number id: digits only. */
export const isPhoneNumberId = (v: string) => /^\d{5,30}$/.test(v);

/**
 * WhatsApp shows plain text with its own light formatting (*bold*, _italic_). Model replies sometimes
 * carry Markdown anyway: make it read cleanly, and keep under WhatsApp's 4096 character limit.
 */
export function toWhatsappText(reply: string): string {
  const text = reply
    .replace(/\*\*(.+?)\*\*/g, "*$1*")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, "$1 ($2)")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text.length > 4000 ? `${text.slice(0, 3997)}...` : text;
}

/** The same reply for a voice note: no links, no formatting marks. */
export function toSpokenText(reply: string): string {
  return reply
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[*_~`#>]+/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 3000);
}

/** How long a WhatsApp conversation stays open without messages before a new one starts. */
export const WHATSAPP_IDLE_MS = 24 * 60 * 60 * 1000;

/** Whether the open conversation is still the current one, given its last activity. */
export const isConversationFresh = (lastActivity: Date, now = new Date()) => now.getTime() - lastActivity.getTime() < WHATSAPP_IDLE_MS;
