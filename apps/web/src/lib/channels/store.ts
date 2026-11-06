import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  agentChannels,
  type PhoneChannelConfig,
  type WhatsappChannelConfig,
} from "@/db/schema";
import { CHANNEL_INFO, decryptSecret, encryptSecret } from "@/lib/actions/crypto";

export type ChannelRow = typeof agentChannels.$inferSelect;
export type PhoneSecrets = { authPassword?: string };
export type WhatsappSecrets = { accessToken: string; appSecret: string; verifyToken: string };

/** Encrypts a channel's secrets as one JSON value, bound to the row id. */
export function sealChannelSecrets(secrets: PhoneSecrets | WhatsappSecrets, rowId: string): string {
  return encryptSecret(JSON.stringify(secrets), CHANNEL_INFO, rowId);
}

/**
 * The saved secrets, or null when there are none or they cannot be opened (BETTER_AUTH_SECRET changed,
 * row tampered with). Never throws and never puts the value in an error: a JSON parse error would
 * echo the decrypted text.
 */
export function openChannelSecrets<T extends PhoneSecrets | WhatsappSecrets>(row: Pick<ChannelRow, "id" | "secretsEncrypted">): T | null {
  if (!row.secretsEncrypted) return null;
  let plain: string;
  try {
    plain = decryptSecret(row.secretsEncrypted, CHANNEL_INFO, row.id);
  } catch {
    return null;
  }
  try {
    const value: unknown = JSON.parse(plain);
    return value && typeof value === "object" && !Array.isArray(value) ? (value as T) : null;
  } catch {
    return null;
  }
}

export function openWhatsappSecrets(row: Pick<ChannelRow, "id" | "secretsEncrypted">): WhatsappSecrets | null {
  const s = openChannelSecrets<WhatsappSecrets>(row);
  if (!s || typeof s.accessToken !== "string" || typeof s.appSecret !== "string" || typeof s.verifyToken !== "string") return null;
  return s;
}

export const lastFour = (value: string) => value.slice(-4);

export const phoneConfig = (row: ChannelRow) => row.config as PhoneChannelConfig;
export const whatsappConfig = (row: ChannelRow) => row.config as WhatsappChannelConfig;

/** One channel of a workspace's agent. Every dashboard read and write goes through this scope. */
export async function getChannel(organizationId: string, agentId: string, kind: "phone" | "whatsapp"): Promise<ChannelRow | null> {
  const [row] = await db
    .select()
    .from(agentChannels)
    .where(and(eq(agentChannels.organizationId, organizationId), eq(agentChannels.agentId, agentId), eq(agentChannels.kind, kind)))
    .limit(1);
  return row ?? null;
}

/** Records a problem for the dashboard (short, never a token or a provider body). */
export async function noteChannelError(channelId: string, message: string): Promise<void> {
  await db
    .update(agentChannels)
    .set({ lastError: message.slice(0, 300), lastErrorAt: new Date() })
    .where(eq(agentChannels.id, channelId))
    .catch((e) => console.error("could not save channel error", e instanceof Error ? e.message : e));
}

export async function noteChannelEvent(channelId: string): Promise<void> {
  await db
    .update(agentChannels)
    .set({ lastEventAt: new Date() })
    .where(eq(agentChannels.id, channelId))
    .catch((e) => console.error("could not save channel event time", e instanceof Error ? e.message : e));
}
