import { and, eq } from "drizzle-orm";
import { after, NextResponse } from "next/server";
import { db } from "@/db";
import { agentChannels } from "@/db/schema";
import { noteChannelError, openWhatsappSecrets, type ChannelRow, whatsappConfig } from "@/lib/channels/store";
import { parseWebhookMessages, verifyChallenge, verifyWebhookSignature } from "@/lib/channels/whatsapp";
import { handleWhatsappMessage, sweepIdleWhatsappConversations } from "@/lib/channels/whatsapp-inbound";
import { clientIp } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";

// Public webhook for one WhatsApp channel (the URL the owner pastes into Meta's app dashboard).
// GET: Meta's verification (hub.challenge). POST: messages, signed with the app secret
// (X-Hub-Signature-256). Answers 200 at once and does the work in after(): Meta retries slow webhooks.

// Transcription, the model, the voice reply and handoff emails run in after().
export const maxDuration = 60;

const MAX_BODY_BYTES = 512 * 1024;
const MAX_MESSAGES_PER_WEBHOOK = 5;
const REQUESTS_PER_MINUTE_PER_IP = 120;

const notFound = () => new NextResponse("Not found", { status: 404 });

async function loadChannel(channelId: string): Promise<ChannelRow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(channelId)) return null;
  const [row] = await db
    .select()
    .from(agentChannels)
    .where(and(eq(agentChannels.id, channelId), eq(agentChannels.kind, "whatsapp")))
    .limit(1);
  return row ?? null;
}

export async function GET(req: Request, ctx: { params: Promise<{ channelId: string }> }) {
  if (!rateLimit(`wa-verify:${clientIp(req)}`, 30, 60_000).ok) return new NextResponse("Too many requests", { status: 429 });
  const channel = await loadChannel((await ctx.params).channelId);
  const secrets = channel ? openWhatsappSecrets(channel) : null;
  if (!channel || !secrets) return notFound();
  const challenge = verifyChallenge(new URL(req.url).searchParams, secrets.verifyToken);
  if (challenge === null) return new NextResponse("Forbidden", { status: 403 });
  return new NextResponse(challenge, { status: 200, headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" } });
}

export async function POST(req: Request, ctx: { params: Promise<{ channelId: string }> }) {
  if (!rateLimit(`wa-hook:${clientIp(req)}`, REQUESTS_PER_MINUTE_PER_IP, 60_000).ok) {
    return new NextResponse("Too many requests", { status: 429 });
  }
  const channel = await loadChannel((await ctx.params).channelId);
  if (!channel) return notFound();

  const raw = new Uint8Array(await req.arrayBuffer());
  if (raw.byteLength > MAX_BODY_BYTES) return new NextResponse("Payload too large", { status: 413 });

  const secrets = openWhatsappSecrets(channel);
  if (!secrets) {
    after(() => noteChannelError(channel.id, "A WhatsApp message came in but the saved tokens could not be read. Enter them again."));
    return new NextResponse("Not configured", { status: 503 });
  }
  if (!verifyWebhookSignature(raw, req.headers.get("x-hub-signature-256"), secrets.appSecret)) {
    after(() => noteChannelError(channel.id, "A webhook call had a wrong signature. Check that the app secret matches your Meta app."));
    return new NextResponse("Invalid signature", { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    return new NextResponse("Bad JSON", { status: 400 });
  }
  // Turned off: take the webhook (so Meta stops retrying) but answer nothing.
  if (!channel.enabled) return NextResponse.json({ ok: true });

  const inbound = parseWebhookMessages(payload, whatsappConfig(channel).phoneNumberId).slice(0, MAX_MESSAGES_PER_WEBHOOK);
  if (inbound.length) {
    after(async () => {
      for (const msg of inbound) await handleWhatsappMessage(channel, secrets, msg);
      await sweepIdleWhatsappConversations().catch((e) => console.error("whatsapp idle sweep failed", e));
    });
  }
  return NextResponse.json({ ok: true });
}
