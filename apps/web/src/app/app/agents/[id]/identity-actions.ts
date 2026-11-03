"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { IdentityTokenClaims } from "@talkfront/shared";
import type { ActionState } from "@/components/form-bits";
import { db } from "@/db";
import { agents } from "@/db/schema";
import { newIdentitySecret, openIdentitySecret, sealIdentitySecret, verifyIdentityToken } from "@/lib/identity";
import { requireWorkspace } from "@/lib/session";
import { canManageIntegrations } from "./roles";

const AgentId = z.string().trim().min(1).max(128);

export type SecretState = (ActionState & { secret?: string }) | null;

/** Creates or replaces the identity secret. The plain secret is returned once and never again. */
export async function createIdentitySecret(_prev: SecretState, formData: FormData): Promise<SecretState> {
  const ws = await requireWorkspace();
  if (!canManageIntegrations(ws.role)) return { error: "Only owners and admins can change the identity secret." };
  const agentId = AgentId.safeParse(formData.get("agentId"));
  if (!agentId.success) return { error: "Agent not found." };

  const secret = newIdentitySecret();
  const updated = await db
    .update(agents)
    .set({ identitySecret: sealIdentitySecret(secret, agentId.data) })
    .where(and(eq(agents.id, agentId.data), eq(agents.organizationId, ws.organizationId)))
    .returning({ id: agents.id });
  if (updated.length === 0) return { error: "Agent not found." };
  revalidatePath(`/app/agents/${agentId.data}`);
  return { ok: true, secret };
}

export async function removeIdentitySecret(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ws = await requireWorkspace();
  if (!canManageIntegrations(ws.role)) return { error: "Only owners and admins can change the identity secret." };
  const agentId = AgentId.safeParse(formData.get("agentId"));
  if (!agentId.success) return { error: "Agent not found." };
  const updated = await db
    .update(agents)
    .set({ identitySecret: null })
    .where(and(eq(agents.id, agentId.data), eq(agents.organizationId, ws.organizationId)))
    .returning({ id: agents.id });
  if (updated.length === 0) return { error: "Agent not found." };
  revalidatePath(`/app/agents/${agentId.data}`);
  return { ok: true, message: "Secret removed. Visitors now start as anonymous." };
}

export type TokenCheckState =
  | null
  | { error: string }
  | { valid: true; claims: IdentityTokenClaims }
  | { valid: false; reason: string; decoded?: Record<string, unknown> };

/** Dashboard tester: checks a pasted token against this agent's secret. Reading only, so any member may use it. */
export async function checkIdentityToken(_prev: TokenCheckState, formData: FormData): Promise<TokenCheckState> {
  const ws = await requireWorkspace();
  const agentId = AgentId.safeParse(formData.get("agentId"));
  if (!agentId.success) return { error: "Agent not found." };
  const token = String(formData.get("token") ?? "").trim();
  if (!token) return { error: "Paste a token first." };
  if (token.length > 4096) return { valid: false, reason: "The token is longer than 4,096 characters. Keep attributes small." };

  const [agent] = await db
    .select({ identitySecret: agents.identitySecret })
    .from(agents)
    .where(and(eq(agents.id, agentId.data), eq(agents.organizationId, ws.organizationId)))
    .limit(1);
  if (!agent) return { error: "Agent not found." };
  if (!agent.identitySecret) return { error: "Create a secret first." };

  let secret: string;
  try {
    secret = openIdentitySecret(agent.identitySecret, agentId.data);
  } catch {
    return { error: "The saved secret could not be read. Regenerate it." };
  }
  const check = await verifyIdentityToken(token, secret);
  return check.ok ? { valid: true, claims: check.claims } : { valid: false, reason: check.reason, decoded: check.decoded };
}
