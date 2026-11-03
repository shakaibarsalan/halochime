"use server";

import { and, count, eq, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ActionParameter } from "@talkfront/shared";
import type { ActionState } from "@/components/form-bits";
import { db } from "@/db";
import { agentActions, agents } from "@/db/schema";
import { clampTimeout, openHeaders, runAction, sealHeaders, type ActionHeaders } from "@/lib/actions/runner";
import {
  ACTION_NAME_RE,
  HEADER_NAME_RE,
  isReservedHeader,
  MAX_ACTIONS_PER_AGENT,
  MAX_HEADER_VALUE,
  MAX_HEADERS,
  MAX_PARAMETERS,
  MAX_TIMEOUT_MS,
  RESERVED_ACTION_NAMES,
} from "@/lib/actions/schema";
import { checkUrl, FetchError } from "@/lib/knowledge/safe-fetch";
import { randomUrlSafe } from "@/lib/ids";
import { rateLimit } from "@/lib/rate-limit";
import { requireWorkspace } from "@/lib/session";
import { canManageIntegrations } from "./roles";

const Id = z.string().trim().min(1).max(128);
const reserved: readonly string[] = RESERVED_ACTION_NAMES;

const ActionForm = z.object({
  agentId: Id,
  actionId: Id.nullable(),
  name: z
    .string()
    .trim()
    .regex(ACTION_NAME_RE, "Name: start with a lowercase letter, then lowercase letters, numbers or _ (at most 40).")
    .refine((n) => !reserved.includes(n), "That name is used by the agent itself. Pick another one."),
  description: z.string().trim().min(1, "Describe when the agent should use this action.").max(1000, "Description: at most 1,000 characters."),
  method: z.enum(["GET", "POST"]),
  url: z.string().trim().min(1, "Enter the URL to call.").max(2048, "URL: at most 2,048 characters."),
  timeoutSec: z.number().int("Timeout: whole seconds.").min(1, "Timeout: at least 1 second.").max(MAX_TIMEOUT_MS / 1000, "Timeout: at most 15 seconds."),
  enabled: z.boolean(),
  parameters: z.array(ActionParameter).max(MAX_PARAMETERS, `At most ${MAX_PARAMETERS} inputs.`),
  headers: z
    .array(
      z.object({
        name: z.string().trim().max(100),
        value: z.string().max(MAX_HEADER_VALUE, `Header values: at most ${MAX_HEADER_VALUE} characters.`),
        /** Name of a saved header this row came from; a blank value keeps that header's saved value. */
        keep: z.string().max(100).nullable(),
      }),
    )
    .max(MAX_HEADERS, `At most ${MAX_HEADERS} headers.`),
});

export type SaveActionState = (ActionState & { savedId?: string }) | null;

function paramIssue(path: PropertyKey[]): string | null {
  if (path[0] !== "parameters" || typeof path[1] !== "number") return null;
  const field = path[2];
  const n = path[1] + 1;
  if (field === "name") return `Input ${n}: name must start with a lowercase letter, then lowercase letters, numbers or _ (at most 40).`;
  if (field === "description") return `Input ${n}: description is at most 300 characters.`;
  if (field === "enum") return `Input ${n}: at most 20 allowed values, each up to 100 characters.`;
  return `Input ${n} is not valid.`;
}

export async function saveHttpAction(_prev: SaveActionState, formData: FormData): Promise<SaveActionState> {
  const ws = await requireWorkspace();
  if (!canManageIntegrations(ws.role)) return { error: "Only owners and admins can change actions." };

  let payload: unknown;
  try {
    payload = JSON.parse(String(formData.get("payload") ?? ""));
  } catch {
    return { error: "Could not read the form. Reload the page and try again." };
  }
  const parsed = ActionForm.safeParse(payload);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { error: (issue && paramIssue(issue.path)) ?? issue?.message ?? "Please check the form." };
  }
  const f = parsed.data;

  let url: URL;
  try {
    url = checkUrl(f.url);
  } catch (err) {
    return { error: err instanceof FetchError ? err.message : "That is not a valid URL." };
  }
  if (url.protocol !== "https:") return { error: "The URL must start with https://." };
  if (url.hash) return { error: "Remove the # part from the URL." };

  // Inputs: unique names, enums only for text, no empty allowed values.
  const params: ActionParameter[] = [];
  for (const [i, p] of f.parameters.entries()) {
    if (params.some((x) => x.name === p.name)) return { error: `Two inputs are called ${p.name}. Use different names.` };
    const values = p.type === "string" ? [...new Set((p.enum ?? []).map((v) => v.trim()).filter(Boolean))] : [];
    if (p.type === "string" && p.enum?.length && !values.length) return { error: `Input ${i + 1}: allowed values are empty.` };
    params.push({ name: p.name, type: p.type, description: p.description.trim(), required: p.required, ...(values.length ? { enum: values } : {}) });
  }

  const [agent] = await db
    .select({ id: agents.id })
    .from(agents)
    .where(and(eq(agents.id, f.agentId), eq(agents.organizationId, ws.organizationId)))
    .limit(1);
  if (!agent) return { error: "Agent not found." };

  let existing: typeof agentActions.$inferSelect | undefined;
  if (f.actionId) {
    [existing] = await db
      .select()
      .from(agentActions)
      .where(and(eq(agentActions.id, f.actionId), eq(agentActions.agentId, agent.id), eq(agentActions.organizationId, ws.organizationId)))
      .limit(1);
    if (!existing) return { error: "This action no longer exists. Reload the page." };
  } else {
    const [{ n }] = await db.select({ n: count() }).from(agentActions).where(eq(agentActions.agentId, agent.id));
    if ((n ?? 0) >= MAX_ACTIONS_PER_AGENT) return { error: `An agent can have at most ${MAX_ACTIONS_PER_AGENT} actions.` };
  }

  const [clash] = await db
    .select({ id: agentActions.id })
    .from(agentActions)
    .where(
      and(
        eq(agentActions.agentId, agent.id),
        eq(agentActions.name, f.name),
        existing ? ne(agentActions.id, existing.id) : undefined,
      ),
    )
    .limit(1);
  if (clash) return { error: `This agent already has an action called ${f.name}.` };

  // Headers: a blank value on a saved header keeps its saved value.
  let saved: ActionHeaders = {};
  if (existing?.headersEncrypted) {
    try {
      saved = openHeaders(existing);
    } catch {
      saved = {};
    }
  }
  const savedLower = new Map(Object.entries(saved).map(([k, v]) => [k.toLowerCase(), v]));
  const headers: ActionHeaders = {};
  for (const h of f.headers) {
    if (!h.name && !h.value) continue;
    if (!HEADER_NAME_RE.test(h.name)) return { error: `"${h.name.slice(0, 40) || "(empty)"}" is not a valid header name.` };
    if (isReservedHeader(h.name)) return { error: `${h.name} is set by Halochime and can't be changed here.` };
    if (Object.keys(headers).some((k) => k.toLowerCase() === h.name.toLowerCase())) return { error: `The header ${h.name} is listed twice.` };
    if (/[\r\n\0]/.test(h.value)) return { error: `The value of ${h.name} can't contain line breaks.` };
    let value = h.value.trim();
    if (!value && h.keep) value = savedLower.get(h.keep.toLowerCase()) ?? "";
    if (!value) return { error: h.keep ? `The saved value of ${h.name} could not be read. Enter it again.` : `Enter a value for the header ${h.name}.` };
    headers[h.name] = value;
  }

  const values = {
    name: f.name,
    description: f.description,
    method: f.method,
    url: url.toString(),
    parameters: params,
    enabled: f.enabled,
    timeoutMs: clampTimeout(f.timeoutSec * 1000),
  };
  let id: string;
  try {
    if (existing) {
      id = existing.id;
      await db
        .update(agentActions)
        .set({ ...values, headersEncrypted: sealHeaders(headers, id) })
        .where(and(eq(agentActions.id, id), eq(agentActions.organizationId, ws.organizationId)));
    } else {
      id = crypto.randomUUID();
      await db.insert(agentActions).values({
        id,
        organizationId: ws.organizationId,
        agentId: agent.id,
        ...values,
        headersEncrypted: sealHeaders(headers, id),
      });
    }
  } catch (err) {
    if (/agent_actions_agent_name_uq/.test(String((err as { message?: string })?.message ?? err))) {
      return { error: `This agent already has an action called ${f.name}.` };
    }
    console.error("saving action failed", (err as Error).message);
    return { error: "Could not save the action." };
  }
  revalidatePath(`/app/agents/${agent.id}`);
  return { ok: true, message: existing ? "Action saved." : "Action added.", savedId: id };
}

async function findAction(organizationId: string, agentId: string, actionId: string) {
  const [row] = await db
    .select()
    .from(agentActions)
    .where(and(eq(agentActions.id, actionId), eq(agentActions.agentId, agentId), eq(agentActions.organizationId, organizationId)))
    .limit(1);
  return row ?? null;
}

export async function deleteHttpAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ws = await requireWorkspace();
  if (!canManageIntegrations(ws.role)) return { error: "Only owners and admins can change actions." };
  const agentId = Id.safeParse(formData.get("agentId"));
  const actionId = Id.safeParse(formData.get("actionId"));
  if (!agentId.success || !actionId.success) return { error: "Action not found." };
  const deleted = await db
    .delete(agentActions)
    .where(and(eq(agentActions.id, actionId.data), eq(agentActions.agentId, agentId.data), eq(agentActions.organizationId, ws.organizationId)))
    .returning({ id: agentActions.id });
  if (deleted.length === 0) return { error: "Action not found." };
  revalidatePath(`/app/agents/${agentId.data}`);
  return { ok: true, message: "Action deleted." };
}

export async function setHttpActionEnabled(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ws = await requireWorkspace();
  if (!canManageIntegrations(ws.role)) return { error: "Only owners and admins can change actions." };
  const agentId = Id.safeParse(formData.get("agentId"));
  const actionId = Id.safeParse(formData.get("actionId"));
  if (!agentId.success || !actionId.success) return { error: "Action not found." };
  const enabled = formData.get("enabled") === "true";
  const updated = await db
    .update(agentActions)
    .set({ enabled })
    .where(and(eq(agentActions.id, actionId.data), eq(agentActions.agentId, agentId.data), eq(agentActions.organizationId, ws.organizationId)))
    .returning({ id: agentActions.id });
  if (updated.length === 0) return { error: "Action not found." };
  revalidatePath(`/app/agents/${agentId.data}`);
  return { ok: true, message: enabled ? "Turned on." : "Turned off." };
}

export type TestActionState =
  | null
  | { error: string }
  | {
      ok: boolean;
      status: number | null;
      result: string;
      durationMs: number;
      request: { method: "GET" | "POST"; url: string; body: string | null };
      conversationId: string;
    };

/** Runs a saved action once with the sample arguments typed in the dashboard. */
export async function testHttpAction(_prev: TestActionState, formData: FormData): Promise<TestActionState> {
  const ws = await requireWorkspace();
  if (!canManageIntegrations(ws.role)) return { error: "Only owners and admins can test actions." };
  const agentId = Id.safeParse(formData.get("agentId"));
  const actionId = Id.safeParse(formData.get("actionId"));
  if (!agentId.success || !actionId.success) return { error: "Action not found." };
  let args: Record<string, unknown>;
  try {
    const raw: unknown = JSON.parse(String(formData.get("args") ?? "{}"));
    args = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  } catch {
    return { error: "Could not read the sample values." };
  }
  const limit = rateLimit(`action-test:${ws.user.id}`, 20, 60_000);
  if (!limit.ok) return { error: `Too many tests. Try again in ${limit.retryAfterSec} seconds.` };

  const action = await findAction(ws.organizationId, agentId.data, actionId.data);
  if (!action) return { error: "Action not found. Reload the page." };

  // Test calls carry a conversation id starting with "test_", so your server can tell them apart.
  const conversationId = `test_${randomUrlSafe(16)}`;
  const run = await runAction(action, args, { conversationId, verifiedVisitorId: null });
  return { ok: run.ok, status: run.status, result: run.result, durationMs: run.durationMs, request: run.request, conversationId };
}
