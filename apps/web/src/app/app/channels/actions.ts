"use server";

import { and, eq, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionState } from "@/components/form-bits";
import { db } from "@/db";
import { agentChannels, agents, type PhoneChannelConfig, type WhatsappChannelConfig } from "@/db/schema";
import { createPhoneRouting, deletePhoneRouting, phoneChannelAvailable, PhoneSetupError } from "@/lib/channels/livekit-sip";
import { normalizePhoneNumber, parseAllowedAddresses } from "@/lib/channels/phone";
import {
  type ChannelRow,
  getChannel,
  lastFour,
  openChannelSecrets,
  openWhatsappSecrets,
  type PhoneSecrets,
  phoneConfig,
  sealChannelSecrets,
  type WhatsappSecrets,
  whatsappConfig,
} from "@/lib/channels/store";
import { isPhoneNumberId } from "@/lib/channels/whatsapp";
import { checkPhoneNumber, WhatsappApiError } from "@/lib/channels/whatsapp-api";
import { randomUrlSafe } from "@/lib/ids";
import { requireWorkspace } from "@/lib/session";
import { canManageIntegrations } from "../agents/[id]/roles";

// Channels page. Owners and admins set up and turn on channels (they hold the business's tokens and
// use its minutes); members can only look. Every action re-checks the role and that the agent belongs
// to the active workspace. Tokens are encrypted and never come back to the browser.

const PATH = "/app/channels";
const IdInput = z.string().trim().min(1).max(128);

async function managerAgent(agentId: unknown) {
  const ws = await requireWorkspace();
  if (!canManageIntegrations(ws.role)) return { error: "Only owners and admins can change channels." } as const;
  const id = IdInput.safeParse(agentId);
  if (!id.success) return { error: "Agent not found." } as const;
  const [agent] = await db
    .select({ id: agents.id, name: agents.name })
    .from(agents)
    .where(and(eq(agents.id, id.data), eq(agents.organizationId, ws.organizationId)))
    .limit(1);
  if (!agent) return { error: "Agent not found." } as const;
  return { ws, agent } as const;
}

const isUniqueViolation = (e: unknown) => {
  const code = (x: unknown) => (x && typeof x === "object" && "code" in x ? (x as { code: unknown }).code : undefined);
  return code(e) === "23505" || code((e as { cause?: unknown } | null)?.cause) === "23505";
};

const setupMessage = (e: unknown) => (e instanceof PhoneSetupError ? e.message : "Something went wrong with LiveKit. Please try again.");

// ------------------------------------------------------------------------------------------- phone

export type PhoneFormState = (ActionState & { password?: string; username?: string }) | null;

const PhoneInput = z.object({
  number: z.string().trim().min(1, "Enter the phone number.").max(40),
  provider: z.enum(["twilio", "other"]),
  allowedAddresses: z.string().max(2000),
  requireAuth: z.boolean(),
  newPassword: z.boolean(),
});

/** Makes LiveKit match the row: routing exists with the current settings while on, and is gone while off. */
async function syncPhoneRouting(row: ChannelRow, label: string): Promise<PhoneChannelConfig> {
  const cfg = phoneConfig(row);
  await deletePhoneRouting(cfg);
  const cleared: PhoneChannelConfig = { ...cfg, trunkId: null, dispatchRuleId: null };
  if (!row.enabled || !row.externalId) return cleared;
  const secrets = openChannelSecrets<PhoneSecrets>(row);
  const routing = await createPhoneRouting({
    channelId: row.id,
    agentId: row.agentId,
    organizationId: row.organizationId,
    number: row.externalId,
    allowedAddresses: cfg.allowedAddresses,
    auth: cfg.authUsername && secrets?.authPassword ? { username: cfg.authUsername, password: secrets.authPassword } : null,
    label,
  });
  return { ...cleared, ...routing };
}

export async function savePhoneChannel(_prev: PhoneFormState, formData: FormData): Promise<PhoneFormState> {
  const who = await managerAgent(formData.get("agentId"));
  if ("error" in who) return { error: who.error };
  const { ws, agent } = who;
  const parsed = PhoneInput.safeParse({
    number: String(formData.get("number") ?? ""),
    provider: formData.get("provider") === "other" ? "other" : "twilio",
    allowedAddresses: String(formData.get("allowedAddresses") ?? ""),
    requireAuth: formData.get("requireAuth") === "on",
    newPassword: formData.get("newPassword") === "on",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form." };
  const input = parsed.data;
  const number = normalizePhoneNumber(input.number);
  if (!number) return { error: "Enter the number in international format, starting with + and the country code, e.g. +14155550100." };
  const addresses = parseAllowedAddresses(input.allowedAddresses);
  if (addresses.bad.length) return { error: `Not an IP address or range: ${addresses.bad.slice(0, 3).join(", ")}` };
  if (addresses.ok.length > 50) return { error: "Up to 50 addresses." };

  const [taken] = await db
    .select({ id: agentChannels.id })
    .from(agentChannels)
    .where(and(eq(agentChannels.kind, "phone"), eq(agentChannels.externalId, number), ne(agentChannels.agentId, agent.id)))
    .limit(1);
  if (taken) return { error: "This number is already connected to another agent." };

  const existing = await getChannel(ws.organizationId, agent.id, "phone");
  const id = existing?.id ?? crypto.randomUUID();
  const oldCfg = existing ? phoneConfig(existing) : null;
  const oldSecrets = existing ? openChannelSecrets<PhoneSecrets>(existing) : null;

  // Username and password for providers that sign their calls (Twilio sends none on inbound calls).
  let username: string | null = null;
  let password: string | undefined;
  let shownPassword: string | undefined;
  if (input.requireAuth) {
    username = oldCfg?.authUsername ?? `hc${randomUrlSafe(10).replace(/[^A-Za-z0-9]/g, "x").toLowerCase()}`;
    password = !input.newPassword && oldSecrets?.authPassword ? oldSecrets.authPassword : randomUrlSafe(24).replace(/[-_]/g, "x");
    if (password !== oldSecrets?.authPassword) shownPassword = password;
  }
  const config: PhoneChannelConfig = {
    trunkId: oldCfg?.trunkId ?? null,
    dispatchRuleId: oldCfg?.dispatchRuleId ?? null,
    provider: input.provider,
    authUsername: username,
    allowedAddresses: addresses.ok,
  };
  const values = {
    externalId: number,
    config,
    secretsEncrypted: password ? sealChannelSecrets({ authPassword: password }, id) : null,
    secretHints: (password ? { authPassword: lastFour(password) } : {}) as Record<string, string>,
    lastError: null,
    lastErrorAt: null,
  };

  let row: ChannelRow;
  try {
    if (existing) {
      [row] = (await db.update(agentChannels).set(values).where(eq(agentChannels.id, id)).returning()) as [ChannelRow];
    } else {
      [row] = (await db
        .insert(agentChannels)
        .values({ id, organizationId: ws.organizationId, agentId: agent.id, kind: "phone", enabled: false, ...values })
        .returning()) as [ChannelRow];
    }
  } catch (e) {
    if (isUniqueViolation(e)) return { error: "This number is already connected to another agent." };
    throw e;
  }

  // Already on: LiveKit gets the new settings now.
  if (row.enabled) {
    try {
      const synced = await syncPhoneRouting(row, `${ws.organizationName} / ${agent.name}`);
      await db.update(agentChannels).set({ config: synced }).where(eq(agentChannels.id, id));
    } catch (e) {
      await db.update(agentChannels).set({ enabled: false, config: { ...config, trunkId: null, dispatchRuleId: null } }).where(eq(agentChannels.id, id));
      revalidatePath(PATH);
      return { error: `${setupMessage(e)} Phone calls are now off.` };
    }
  }
  revalidatePath(PATH);
  return {
    ok: true,
    message: row.enabled ? "Saved. Calls use the new settings now." : "Saved. Turn phone calls on when your number points to us.",
    ...(shownPassword && username ? { password: shownPassword, username } : {}),
  };
}

export async function setPhoneEnabled(agentId: string, enabled: boolean): Promise<ActionState> {
  const who = await managerAgent(agentId);
  if ("error" in who) return { error: who.error };
  const { ws, agent } = who;
  if (enabled && !phoneChannelAvailable()) return { error: "Phone calls are not available on this server yet." };
  const row = await getChannel(ws.organizationId, agent.id, "phone");
  if (!row?.externalId) return { error: "Save your number first." };
  const next = { ...row, enabled: enabled === true };
  try {
    const synced = await syncPhoneRouting(next, `${ws.organizationName} / ${agent.name}`);
    await db.update(agentChannels).set({ enabled: next.enabled, config: synced, lastError: null, lastErrorAt: null }).where(eq(agentChannels.id, row.id));
  } catch (e) {
    revalidatePath(PATH);
    return { error: setupMessage(e) };
  }
  revalidatePath(PATH);
  return { ok: true, message: next.enabled ? "Phone calls are on." : "Phone calls are off. Calls to the number are no longer answered." };
}

export async function removePhoneChannel(agentId: string): Promise<ActionState> {
  const who = await managerAgent(agentId);
  if ("error" in who) return { error: who.error };
  const row = await getChannel(who.ws.organizationId, who.agent.id, "phone");
  if (!row) return { ok: true, message: "Removed." };
  try {
    await deletePhoneRouting(phoneConfig(row));
  } catch (e) {
    return { error: setupMessage(e) };
  }
  await db.delete(agentChannels).where(eq(agentChannels.id, row.id));
  revalidatePath(PATH);
  return { ok: true, message: "Phone channel removed." };
}

// ------------------------------------------------------------------------------------------- WhatsApp

const WhatsappInput = z.object({
  phoneNumberId: z.string().trim().max(40),
  accessToken: z.string().trim().max(2000),
  appSecret: z.string().trim().max(200),
  verifyToken: z.string().trim().max(200),
  replyWithVoice: z.boolean(),
});

export async function saveWhatsappChannel(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const who = await managerAgent(formData.get("agentId"));
  if ("error" in who) return { error: who.error };
  const { ws, agent } = who;
  const parsed = WhatsappInput.safeParse({
    phoneNumberId: String(formData.get("phoneNumberId") ?? ""),
    accessToken: String(formData.get("accessToken") ?? ""),
    appSecret: String(formData.get("appSecret") ?? ""),
    verifyToken: String(formData.get("verifyToken") ?? ""),
    replyWithVoice: formData.get("replyWithVoice") === "on",
  });
  if (!parsed.success) return { error: "One of the values is too long." };
  const input = parsed.data;
  if (!isPhoneNumberId(input.phoneNumberId)) return { error: "Enter the Phone number ID from Meta (digits only, not the phone number itself)." };
  if (input.verifyToken && !/^[\x21-\x7e]{8,200}$/.test(input.verifyToken)) {
    return { error: "The verify token needs at least 8 characters, with no spaces." };
  }
  if (input.accessToken && input.accessToken.length < 20) return { error: "That access token looks too short." };
  if (input.appSecret && !/^[0-9a-f]{16,64}$/i.test(input.appSecret)) return { error: "The app secret is the hex string in your Meta app's Basic settings." };

  const [taken] = await db
    .select({ id: agentChannels.id })
    .from(agentChannels)
    .where(and(eq(agentChannels.kind, "whatsapp"), eq(agentChannels.externalId, input.phoneNumberId), ne(agentChannels.agentId, agent.id)))
    .limit(1);
  if (taken) return { error: "This WhatsApp number is already connected to another agent." };

  const existing = await getChannel(ws.organizationId, agent.id, "whatsapp");
  const id = existing?.id ?? crypto.randomUUID();
  const old = existing ? openWhatsappSecrets(existing) : null;
  // A blank field keeps what was saved.
  const secrets: WhatsappSecrets = {
    accessToken: input.accessToken || old?.accessToken || "",
    appSecret: input.appSecret || old?.appSecret || "",
    verifyToken: input.verifyToken || old?.verifyToken || "",
  };
  if (!secrets.accessToken || !secrets.appSecret || !secrets.verifyToken) {
    return { error: "Enter the access token, the app secret and a verify token." };
  }
  const config: WhatsappChannelConfig = { phoneNumberId: input.phoneNumberId, replyWithVoice: input.replyWithVoice };
  const values = {
    externalId: input.phoneNumberId,
    config,
    secretsEncrypted: sealChannelSecrets(secrets, id),
    secretHints: { accessToken: lastFour(secrets.accessToken), appSecret: lastFour(secrets.appSecret), verifyToken: lastFour(secrets.verifyToken) },
    lastError: null,
    lastErrorAt: null,
  };
  try {
    if (existing) await db.update(agentChannels).set(values).where(eq(agentChannels.id, id));
    else await db.insert(agentChannels).values({ id, organizationId: ws.organizationId, agentId: agent.id, kind: "whatsapp", enabled: false, ...values });
  } catch (e) {
    if (isUniqueViolation(e)) return { error: "This WhatsApp number is already connected to another agent." };
    throw e;
  }
  revalidatePath(PATH);
  return { ok: true, message: existing?.enabled ? "Saved." : "Saved. Paste the webhook URL into Meta, then turn WhatsApp on." };
}

export async function setWhatsappEnabled(agentId: string, enabled: boolean): Promise<ActionState> {
  const who = await managerAgent(agentId);
  if ("error" in who) return { error: who.error };
  const row = await getChannel(who.ws.organizationId, who.agent.id, "whatsapp");
  if (!row) return { error: "Save the WhatsApp details first." };
  if (enabled && !openWhatsappSecrets(row)) return { error: "The saved tokens could not be read. Enter them again and save." };
  await db.update(agentChannels).set({ enabled: enabled === true }).where(eq(agentChannels.id, row.id));
  revalidatePath(PATH);
  return { ok: true, message: enabled ? "WhatsApp is on." : "WhatsApp is off. New messages are not answered." };
}

export async function checkWhatsappConnection(agentId: string): Promise<ActionState> {
  const who = await managerAgent(agentId);
  if ("error" in who) return { error: who.error };
  const row = await getChannel(who.ws.organizationId, who.agent.id, "whatsapp");
  const secrets = row ? openWhatsappSecrets(row) : null;
  if (!row || !secrets) return { error: "Save the WhatsApp details first." };
  try {
    const info = await checkPhoneNumber({ accessToken: secrets.accessToken, phoneNumberId: whatsappConfig(row).phoneNumberId });
    const label = [info.verifiedName, info.displayPhoneNumber].filter(Boolean).join(", ");
    return { ok: true, message: label ? `Connected: ${label}.` : "Connected." };
  } catch (e) {
    return { error: e instanceof WhatsappApiError ? e.message : "Could not reach WhatsApp." };
  }
}

export async function removeWhatsappChannel(agentId: string): Promise<ActionState> {
  const who = await managerAgent(agentId);
  if ("error" in who) return { error: who.error };
  await db
    .delete(agentChannels)
    .where(and(eq(agentChannels.organizationId, who.ws.organizationId), eq(agentChannels.agentId, who.agent.id), eq(agentChannels.kind, "whatsapp")));
  revalidatePath(PATH);
  return { ok: true, message: "WhatsApp channel removed. Remove the webhook in Meta too." };
}
