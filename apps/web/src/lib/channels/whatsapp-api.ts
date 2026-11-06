import "server-only";
import { GRAPH_BASE } from "./whatsapp";

// WhatsApp Business Cloud API calls with the business's own token. Errors carry Meta's short message
// and code only (never the token, never a response body with personal data).

export class WhatsappApiError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly code: number | null = null,
  ) {
    super(message);
  }
}

const TIMEOUT_MS = 15_000;
/** Voice notes we accept from visitors (OpenAI transcription takes up to 25 MB). */
export const MAX_INBOUND_AUDIO_BYTES = 10 * 1024 * 1024;

type Creds = { accessToken: string; phoneNumberId: string };

async function graph(path: string, token: string, init: RequestInit = {}): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(`${GRAPH_BASE}/${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (e) {
    throw new WhatsappApiError(`Could not reach WhatsApp (${e instanceof Error ? e.name : "network error"}).`, null);
  }
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const err = body && typeof body === "object" && "error" in body ? (body as { error?: { message?: unknown; code?: unknown } }).error : undefined;
    const message = typeof err?.message === "string" ? err.message.slice(0, 200) : `HTTP ${res.status}`;
    throw new WhatsappApiError(`WhatsApp said: ${message}`, res.status, typeof err?.code === "number" ? err.code : null);
  }
  return body;
}

/** Meta media URLs are on its own CDN; anything else is refused (the token goes with the request). */
function isMetaMediaUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === "https:" && /(^|\.)(fbsbx\.com|facebook\.com|whatsapp\.net|fbcdn\.net)$/i.test(u.hostname);
  } catch {
    return false;
  }
}

/** Downloads a visitor's media (voice note) by id. */
export async function downloadMedia(token: string, mediaId: string): Promise<{ data: Buffer; mimeType: string }> {
  const info = (await graph(encodeURIComponent(mediaId), token)) as { url?: unknown; mime_type?: unknown; file_size?: unknown } | null;
  const url = typeof info?.url === "string" ? info.url : "";
  if (!isMetaMediaUrl(url)) throw new WhatsappApiError("WhatsApp gave an unexpected media address.", null);
  if (typeof info?.file_size === "number" && info.file_size > MAX_INBOUND_AUDIO_BYTES) {
    throw new WhatsappApiError("The voice note is too long.", null);
  }
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: "error",
      cache: "no-store",
    });
  } catch (e) {
    throw new WhatsappApiError(`Could not download the voice note (${e instanceof Error ? e.name : "network error"}).`, null);
  }
  if (!res.ok) throw new WhatsappApiError(`Could not download the voice note (HTTP ${res.status}).`, res.status);
  const data = Buffer.from(await res.arrayBuffer());
  if (data.length > MAX_INBOUND_AUDIO_BYTES) throw new WhatsappApiError("The voice note is too long.", null);
  const mimeType = typeof info?.mime_type === "string" ? info.mime_type : res.headers.get("content-type") || "audio/ogg";
  return { data, mimeType };
}

/** Uploads our voice reply (Ogg/Opus) and returns its media id. */
export async function uploadVoice(creds: Creds, audio: Buffer): Promise<string> {
  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("type", "audio/ogg");
  form.append("file", new Blob([new Uint8Array(audio)], { type: "audio/ogg" }), "reply.ogg");
  const body = (await graph(`${encodeURIComponent(creds.phoneNumberId)}/media`, creds.accessToken, { method: "POST", body: form })) as {
    id?: unknown;
  } | null;
  if (typeof body?.id !== "string") throw new WhatsappApiError("WhatsApp did not return a media id.", null);
  return body.id;
}

async function sendMessage(creds: Creds, payload: Record<string, unknown>): Promise<void> {
  await graph(`${encodeURIComponent(creds.phoneNumberId)}/messages`, creds.accessToken, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", ...payload }),
  });
}

export function sendText(creds: Creds, to: string, text: string, replyTo?: string): Promise<void> {
  return sendMessage(creds, {
    to,
    type: "text",
    text: { body: text, preview_url: false },
    ...(replyTo ? { context: { message_id: replyTo } } : {}),
  });
}

/** `voice: true` makes WhatsApp show it as a voice note (Ogg/Opus mono only). */
export function sendVoiceNote(creds: Creds, to: string, mediaId: string): Promise<void> {
  return sendMessage(creds, { to, type: "audio", audio: { id: mediaId, voice: true } });
}

/** Blue ticks on the visitor's message while we work on the answer. Failure is harmless. */
export async function markRead(creds: Creds, messageId: string): Promise<void> {
  await graph(`${encodeURIComponent(creds.phoneNumberId)}/messages`, creds.accessToken, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", status: "read", message_id: messageId }),
  }).catch(() => undefined);
}

/** Dashboard "Check connection": reads the phone number's display name with the saved token. */
export async function checkPhoneNumber(creds: Creds): Promise<{ displayPhoneNumber: string | null; verifiedName: string | null }> {
  const body = (await graph(`${encodeURIComponent(creds.phoneNumberId)}?fields=display_phone_number,verified_name`, creds.accessToken)) as {
    display_phone_number?: unknown;
    verified_name?: unknown;
  } | null;
  return {
    displayPhoneNumber: typeof body?.display_phone_number === "string" ? body.display_phone_number : null,
    verifiedName: typeof body?.verified_name === "string" ? body.verified_name : null,
  };
}
