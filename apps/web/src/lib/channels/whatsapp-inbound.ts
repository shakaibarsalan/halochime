import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { agents, channelInbound, conversations, messages, organization, wallets } from "@/db/schema";
import { realtimeVoiceName, voiceEngine } from "@/lib/agent-defaults";
import { endConversation } from "@/lib/conversations";
import { conversationEnded, handoffSaved } from "@/lib/events";
import { rateLimit } from "@/lib/rate-limit";
import { summarizeConversation } from "@/lib/summary";
import { startSessionWithinLimits } from "@/lib/widget/limits";
import { audioAvailable, synthesize, transcribe } from "./openai-audio";
import { type ChannelRow, noteChannelError, noteChannelEvent, type WhatsappSecrets, whatsappConfig } from "./store";
import { FALLBACK_REPLY, runTextTurn } from "./turn";
import { type InboundMessage, toSpokenText, toWhatsappText, WHATSAPP_IDLE_MS } from "./whatsapp";
import { downloadMedia, markRead, sendText, sendVoiceNote, uploadVoice, WhatsappApiError } from "./whatsapp-api";

// One WhatsApp message in, one answer out (text, plus a voice note for a voice note). Runs in after()
// of the webhook route, so Meta gets its 200 at once. Every reply here is plain and short.

/** Per sender, in memory (per instance): a burst cap and an hourly cap. */
const SENDER_PER_MINUTE = 8;
const SENDER_PER_HOUR = 60;
/** Per sender, in the database: user messages in one conversation over 10 minutes. */
const SENDER_DB_PER_10_MIN = 30;
/** "Out of credit" and similar notices go to one sender at most this often. */
const NOTICE_EVERY_MS = 6 * 60 * 60 * 1000;
const IDLE_SWEEP_BATCH = 20;

export const TEXTS = {
  outOfCredit: "Sorry, we can't answer messages here right now. Please try again later or contact us another way.",
  busy: "Sorry, we're getting a lot of messages right now. Please try again in a few minutes.",
  unsupported: "I can read text messages and listen to voice notes. Please send your question as a message or a voice note.",
  noVoice: "Sorry, I can't listen to voice notes right now. Please type your question instead.",
  unheard: "Sorry, I couldn't make out that voice note. Could you send it again, or type your question?",
};

type Creds = { accessToken: string; phoneNumberId: string };

const lastActivity = sql<Date>`coalesce((select max(m.created_at) from ${messages} m where m.conversation_id = ${conversations.id}), ${conversations.startedAt})`;

/** The visitor's open WhatsApp conversation, with when it was last used. */
async function openConversation(agentId: string, sender: string) {
  const [row] = await db
    .select({ id: conversations.id, startedAt: conversations.startedAt, lastAt: lastActivity })
    .from(conversations)
    .where(
      and(
        eq(conversations.agentId, agentId),
        eq(conversations.channel, "whatsapp"),
        eq(conversations.visitorId, sender),
        eq(conversations.status, "active"),
      ),
    )
    .orderBy(desc(conversations.startedAt))
    .limit(1);
  return row ? { ...row, lastAt: new Date(row.lastAt) } : null;
}

/**
 * Ends one conversation the way the voice agent's /end does (text: a usage row, nothing billed).
 * Returns the follow-up (summary, then emails and webhooks) to run when there is time, or null.
 */
async function endIdleConversation(id: string, startedAt: Date, lastAt: Date): Promise<(() => Promise<void>) | null> {
  const durationSec = Math.max(0, Math.round((lastAt.getTime() - startedAt.getTime()) / 1000));
  const result = await endConversation(id, { endedReason: "visitor_left", durationSec });
  if (!result?.ended) return null;
  return async () => {
    await summarizeConversation(id).catch((e) => console.error("summary failed", e));
    await conversationEnded(id);
  };
}

async function closeConversation(id: string, startedAt: Date, lastAt: Date): Promise<void> {
  const followUp = await endIdleConversation(id, startedAt, lastAt);
  if (followUp) await followUp();
}

/**
 * WhatsApp conversations stay open for 24 hours without messages (the general stale sweep skips them).
 * This closes the ones past that, a few at a time. Called after each webhook.
 */
export async function sweepIdleWhatsappConversations(): Promise<number> {
  const rows = await db
    .select({ id: conversations.id, startedAt: conversations.startedAt, lastAt: lastActivity })
    .from(conversations)
    .where(
      and(
        eq(conversations.channel, "whatsapp"),
        eq(conversations.status, "active"),
        sql`${lastActivity} < now() - make_interval(secs => ${WHATSAPP_IDLE_MS / 1000})`,
      ),
    )
    .limit(IDLE_SWEEP_BATCH);
  for (const r of rows) {
    await closeConversation(r.id, r.startedAt, new Date(r.lastAt)).catch((e) => console.error("whatsapp idle close failed", e));
  }
  return rows.length;
}

async function notify(creds: Creds, to: string, key: string, text: string): Promise<void> {
  if (!rateLimit(`wa-notice:${key}`, 1, NOTICE_EVERY_MS).ok) return;
  await sendText(creds, to, text);
}

export async function handleWhatsappMessage(channel: ChannelRow, secrets: WhatsappSecrets, msg: InboundMessage): Promise<void> {
  const cfg = whatsappConfig(channel);
  const creds: Creds = { accessToken: secrets.accessToken, phoneNumberId: cfg.phoneNumberId };

  // Each message once, even when Meta sends the webhook again.
  const fresh = await db
    .insert(channelInbound)
    .values({ channelId: channel.id, externalMessageId: msg.id })
    .onConflictDoNothing()
    .returning({ id: channelInbound.externalMessageId });
  if (!fresh.length) return;

  const senderKey = `${channel.id}:${msg.from}`;
  if (!rateLimit(`wa-min:${senderKey}`, SENDER_PER_MINUTE, 60_000).ok || !rateLimit(`wa-hour:${senderKey}`, SENDER_PER_HOUR, 3_600_000).ok) {
    console.warn(`whatsapp sender over the rate limit on channel ${channel.id}; message ignored`);
    return;
  }

  const followUps: FollowUp[] = [];
  try {
    await answer(channel, creds, msg, senderKey, followUps);
  } catch (e) {
    const message = e instanceof WhatsappApiError ? e.message : "The message could not be answered.";
    console.error(`whatsapp message on channel ${channel.id} failed:`, e instanceof Error ? e.message : e);
    await noteChannelError(channel.id, message);
  } finally {
    for (const f of followUps) await f().catch((e) => console.error("whatsapp conversation follow-up failed", e));
  }
}

type FollowUp = () => Promise<void>;

async function answer(channel: ChannelRow, creds: Creds, msg: InboundMessage, senderKey: string, followUps: FollowUp[]): Promise<void> {
  void markRead(creds, msg.id);

  const [row] = await db
    .select({ agent: agents, businessName: organization.name })
    .from(agents)
    .innerJoin(organization, eq(organization.id, agents.organizationId))
    .where(and(eq(agents.id, channel.agentId), eq(agents.organizationId, channel.organizationId)))
    .limit(1);
  if (!row) return;
  const { agent, businessName } = row;

  if (msg.type === "unsupported") {
    await notify(creds, msg.from, `unsupported:${senderKey}`, TEXTS.unsupported);
    return;
  }

  // WhatsApp answers cost the business (model, voice): an empty wallet stops them, politely.
  const [wallet] = await db
    .select({ balance: wallets.balanceSeconds })
    .from(wallets)
    .where(eq(wallets.organizationId, channel.organizationId))
    .limit(1);
  if ((wallet?.balance ?? 0) <= 0) {
    await notify(creds, msg.from, `credit:${senderKey}`, TEXTS.outOfCredit);
    return;
  }

  // The visitor's words: the text, or the voice note written down.
  let text: string;
  if (msg.type === "audio") {
    if (!audioAvailable()) {
      await sendText(creds, msg.from, TEXTS.noVoice);
      return;
    }
    const media = await downloadMedia(creds.accessToken, msg.mediaId).catch(async (e) => {
      console.warn("voice note download failed", e instanceof Error ? e.message : e);
      await noteChannelError(channel.id, e instanceof WhatsappApiError ? e.message : "A voice note could not be downloaded.");
      return null;
    });
    const hint = /^[a-z]{2}$/.test(agent.language) ? agent.language : undefined;
    text = media
      ? await transcribe(media.data, media.mimeType, hint).catch((e) => {
          console.warn("voice note transcription failed", e instanceof Error ? e.message : e);
          return "";
        })
      : "";
    if (!text) {
      await sendText(creds, msg.from, TEXTS.unheard);
      return;
    }
  } else {
    text = msg.text;
  }

  // Find the open conversation (24 hours since its last message), or start one within the limits.
  const picked: { id: string | null } = { id: null };
  const open = await openConversation(agent.id, msg.from);
  if (open && Date.now() - open.lastAt.getTime() < WHATSAPP_IDLE_MS) {
    picked.id = open.id;
  } else {
    // The old one ends now; its summary and emails wait until this message is answered.
    if (open) {
      const followUp = await endIdleConversation(open.id, open.startedAt, open.lastAt);
      if (followUp) followUps.push(followUp);
    }
    const newId = crypto.randomUUID();
    const refusal = await startSessionWithinLimits(
      { organizationId: channel.organizationId, agentId: agent.id, mode: "text" },
      async (tx) => {
        // Another message from the same sender may have opened one while this waited for the lock.
        const [raced] = await tx
          .select({ id: conversations.id })
          .from(conversations)
          .where(
            and(
              eq(conversations.agentId, agent.id),
              eq(conversations.channel, "whatsapp"),
              eq(conversations.visitorId, msg.from),
              eq(conversations.status, "active"),
            ),
          )
          .limit(1);
        if (raced) {
          picked.id = raced.id;
          return;
        }
        await tx.insert(conversations).values({
          id: newId,
          organizationId: channel.organizationId,
          agentId: agent.id,
          mode: "text",
          channel: "whatsapp",
          // Their WhatsApp id (international number, digits only). Not verified by the business.
          visitorId: msg.from,
          visitorName: msg.profileName,
          roomName: `wa-${newId}`,
        });
        picked.id = newId;
      },
    );
    if (refusal) {
      await notify(creds, msg.from, `busy:${senderKey}`, refusal.code === "out_of_credit" ? TEXTS.outOfCredit : TEXTS.busy);
      return;
    }
  }
  if (!picked.id) return;
  const convId = picked.id;

  // Database cap per sender (holds across instances, unlike the in-memory one).
  const [recent] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(messages)
    .where(and(eq(messages.conversationId, convId), eq(messages.role, "user"), sql`${messages.createdAt} > now() - interval '10 minutes'`));
  if (Number(recent?.n ?? 0) >= SENDER_DB_PER_10_MIN) {
    console.warn(`whatsapp sender over the conversation cap on channel ${channel.id}; message ignored`);
    return;
  }

  await db.insert(messages).values({ conversationId: convId, role: "user", content: text.slice(0, 20_000), createdAt: new Date() });

  const [conv] = await db
    .select({ visitorName: conversations.visitorName, visitorEmail: conversations.visitorEmail })
    .from(conversations)
    .where(eq(conversations.id, convId))
    .limit(1);

  let reply = FALLBACK_REPLY;
  let handoffs: { handoffId: string; created: boolean }[] = [];
  try {
    const out = await runTextTurn({
      conversation: { id: convId, organizationId: channel.organizationId, agentId: agent.id, visitorName: conv?.visitorName ?? null, visitorEmail: conv?.visitorEmail ?? null },
      agent,
      businessName,
      channel: "whatsapp",
      visitorPhone: `+${msg.from}`,
      latestText: text,
    });
    reply = out.reply;
    handoffs = out.handoffs;
  } catch (e) {
    console.error("whatsapp turn failed", e instanceof Error ? e.message : e);
    await noteChannelError(channel.id, "The assistant could not answer a message (no language model answered).");
    await db.insert(messages).values({ conversationId: convId, role: "assistant", content: reply, createdAt: new Date() });
  }

  await sendText(creds, msg.from, toWhatsappText(reply));

  if (msg.type === "audio" && whatsappConfig(channel).replyWithVoice && audioAvailable()) {
    try {
      const voice = voiceEngine(agent.ttsVoice) === "realtime" ? realtimeVoiceName(agent.ttsVoice) : "marin";
      const spoken = toSpokenText(reply);
      if (spoken) {
        const audio = await synthesize(spoken, voice);
        const mediaId = await uploadVoice(creds, audio);
        await sendVoiceNote(creds, msg.from, mediaId);
      }
    } catch (e) {
      // The text reply already went out.
      console.warn("whatsapp voice reply failed", e instanceof Error ? e.message : e);
      await noteChannelError(channel.id, e instanceof WhatsappApiError ? e.message : "The voice note reply could not be made; the text reply was sent.");
    }
  }

  await noteChannelEvent(channel.id);
  for (const h of handoffs) await handoffSaved(h.handoffId, h.created);
}
