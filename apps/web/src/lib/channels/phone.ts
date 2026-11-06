// Phone channel (LiveKit SIP): pure helpers, no server-only import so the check script can run them.

/** Room names of phone calls start with this; LiveKit adds "_<caller>_<random>" (individual dispatch rule). */
export const PHONE_ROOM_PREFIX = "tf-phone";

/** E.164: "+" then 8 to 15 digits, first digit not 0. Spaces, dashes, dots and brackets are dropped first. */
export function normalizePhoneNumber(raw: string): string | null {
  const compact = raw.trim().replace(/[\s().-]/g, "");
  const withPlus = compact.startsWith("00") ? `+${compact.slice(2)}` : compact;
  return /^\+[1-9]\d{7,14}$/.test(withPlus) ? withPlus : null;
}

/**
 * The project's SIP URI from LIVEKIT_SIP_URI (LiveKit Cloud: Settings, "SIP URI"), as the host only,
 * e.g. "abc123xyz.sip.livekit.cloud". Accepts "sip:host", "host" or "sip:host;transport=tcp".
 */
export function sipHost(raw: string | undefined): string | null {
  if (!raw) return null;
  const host = raw.trim().replace(/^sips?:/i, "").split(";")[0]!.trim().toLowerCase();
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+(:\d{1,5})?$/.test(host) ? host : null;
}

/** What the owner pastes into Twilio as the Origination URI (TCP, as LiveKit's Twilio guide says). */
export const originationUri = (host: string) => `sip:${host};transport=tcp`;

/** IPv4 address or IPv4 CIDR range ("54.172.60.0/30"). */
export function isIpv4OrCidr(value: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?:\/(\d{1,2}))?$/.exec(value.trim());
  if (!m) return false;
  if (m.slice(1, 5).some((o) => Number(o) > 255)) return false;
  return m[5] === undefined || Number(m[5]) <= 32;
}

/** Comma or newline separated list of addresses, cleaned. Returns the bad entries too, for the form. */
export function parseAllowedAddresses(raw: string): { ok: string[]; bad: string[] } {
  const items = [...new Set(raw.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean))];
  return { ok: items.filter(isIpv4OrCidr), bad: items.filter((s) => !isIpv4OrCidr(s)) };
}

/** Dispatch metadata the agent worker gets for every call on this channel (apps/agent phone.py). */
export type PhoneDispatchMetadata = {
  channel: "phone";
  agentId: string;
  organizationId: string;
  channelId: string;
};

export const phoneDispatchMetadata = (input: { agentId: string; organizationId: string; channelId: string }): PhoneDispatchMetadata => ({
  channel: "phone",
  agentId: input.agentId,
  organizationId: input.organizationId,
  channelId: input.channelId,
});

