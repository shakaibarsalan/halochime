"use server";

import { and, count, eq, inArray, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionState } from "@/components/form-bits";
import { db } from "@/db";
import { agentActions, agents, integrationQueries, integrations } from "@/db/schema";
import { ACTION_NAME_RE, MAX_PARAMETERS, RESERVED_ACTION_NAMES } from "@/lib/actions/schema";
import { runDatabaseQuery } from "@/lib/integrations/execute";
import { blockedHostReason, describeTarget, parseConnectionString } from "@/lib/integrations/db-url";
import { checkReadOnlySql } from "@/lib/integrations/sql";
import { openSecrets, sealSecrets, type Secrets } from "@/lib/integrations/store";
import { testConnection } from "@/lib/integrations/test-connection";
import { bookingLinkTool, calcomTools, crmTools } from "@/lib/integrations/tools";
import {
  ConfigSchemas,
  CRM_KINDS,
  DbQueryParameter,
  INTEGRATION_KINDS,
  isCrmKind,
  KIND_LABELS,
  lastFour,
  MAX_QUERIES,
  MAX_QUERY_SQL,
  SECRET_FIELDS,
  SecretSchemas,
  type DbDialect,
  type IntegrationKind,
} from "@/lib/integrations/types";
import { isBlockedAddress } from "@/lib/knowledge/safe-fetch";
import { rateLimit } from "@/lib/rate-limit";
import { requireWorkspace } from "@/lib/session";
import { canManageIntegrations } from "../agents/[id]/roles";

const PATH = "/app/integrations";
const Id = z.string().trim().min(1).max(128);
const NOT_ALLOWED = "Only owners and admins can change integrations.";

function readPayload(formData: FormData): unknown {
  try {
    return JSON.parse(String(formData.get("payload") ?? ""));
  } catch {
    return undefined;
  }
}

const firstIssue = (e: z.ZodError) => e.issues[0]?.message ?? "Please check the form.";

async function findRow(organizationId: string, kind: IntegrationKind) {
  const [row] = await db
    .select()
    .from(integrations)
    .where(and(eq(integrations.organizationId, organizationId), eq(integrations.kind, kind)))
    .limit(1);
  return row ?? null;
}

const allowPrivateDb = () => process.env.NODE_ENV !== "production" && process.env.INTEGRATIONS_ALLOW_PRIVATE_DB === "1";

// ---------------------------------------------------------------------------- connect / edit

const SaveForm = z.object({
  kind: z.enum(INTEGRATION_KINDS),
  config: z.record(z.string(), z.unknown()),
  /** Blank values keep the saved ones. */
  secrets: z.record(z.string(), z.string().max(2000)),
  agentIds: z.array(Id).max(200),
  logConversations: z.boolean(),
});

export type SaveIntegrationState = (ActionState & { tested?: boolean }) | null;

export async function saveIntegration(_prev: SaveIntegrationState, formData: FormData): Promise<SaveIntegrationState> {
  const ws = await requireWorkspace();
  if (!canManageIntegrations(ws.role)) return { error: NOT_ALLOWED };
  const parsed = SaveForm.safeParse(readPayload(formData));
  if (!parsed.success) return { error: "Could not read the form. Reload the page and try again." };
  const f = parsed.data;
  const kind = f.kind;

  const config = ConfigSchemas[kind].safeParse(f.config);
  if (!config.success) return { error: firstIssue(config.error) };

  const existing = await findRow(ws.organizationId, kind);
  let saved: Secrets = {};
  if (existing) {
    try {
      saved = openSecrets(existing);
    } catch {
      saved = {};
    }
  }
  const merged: Secrets = {};
  for (const field of SECRET_FIELDS[kind]) {
    const typed = f.secrets[field.key]?.trim();
    const value = typed || saved[field.key];
    if (value) merged[field.key] = value;
  }
  const secrets = SecretSchemas[kind].safeParse(merged);
  if (!secrets.success) {
    const missing = SECRET_FIELDS[kind].find((x) => !merged[x.key]);
    return { error: missing && existing ? `Enter the ${missing.label.toLowerCase()} again: the saved one could not be read.` : firstIssue(secrets.error) };
  }

  let hint: string | null = null;
  if (kind === "database") {
    const dialect = (config.data as { dialect: DbDialect }).dialect;
    const target = parseConnectionString(merged.connectionString ?? "", dialect);
    if (!target.ok) return { error: target.reason };
    if (!allowPrivateDb()) {
      const blocked = blockedHostReason(target.target.host, isBlockedAddress);
      if (blocked) return { error: blocked };
    }
    hint = describeTarget(target.target);
  } else {
    const main = SECRET_FIELDS[kind].at(-1);
    hint = main ? lastFour(merged[main.key] ?? "") : null;
  }

  // Only this workspace's agents.
  const wanted = [...new Set(f.agentIds)];
  const agentIds = wanted.length
    ? (
        await db
          .select({ id: agents.id })
          .from(agents)
          .where(and(eq(agents.organizationId, ws.organizationId), inArray(agents.id, wanted)))
      ).map((a) => a.id)
    : [];

  const values = {
    config: config.data as Record<string, unknown>,
    secretHint: hint,
    agentIds,
    logConversations: isCrmKind(kind) ? f.logConversations : false,
    lastTestedAt: null,
    lastTestOk: null,
    lastTestMessage: null,
  };
  let id: string;
  try {
    if (existing) {
      id = existing.id;
      await db
        .update(integrations)
        .set({ ...values, secretsEncrypted: sealSecrets(merged, id) })
        .where(and(eq(integrations.id, id), eq(integrations.organizationId, ws.organizationId)));
    } else {
      id = crypto.randomUUID();
      await db.insert(integrations).values({ id, organizationId: ws.organizationId, kind, ...values, secretsEncrypted: sealSecrets(merged, id) });
    }
  } catch (err) {
    if (/integrations_org_kind_uq/.test(String((err as { message?: string })?.message ?? err))) {
      return { error: `${KIND_LABELS[kind]} is already connected. Reload the page.` };
    }
    console.error("saving integration failed", (err as Error).message);
    return { error: "Could not save. Try again." };
  }

  // Check it right away, so the owner sees at once whether the credentials work.
  let message = existing ? "Saved." : `${KIND_LABELS[kind]} connected.`;
  let tested = false;
  if (kind !== "booking_link" && rateLimit(`integration-test:${ws.user.id}`, 10, 60_000).ok) {
    const test = await testConnection(kind, values.config, merged);
    await db
      .update(integrations)
      .set({ lastTestedAt: new Date(), lastTestOk: test.ok, lastTestMessage: test.message.slice(0, 500) })
      .where(and(eq(integrations.id, id), eq(integrations.organizationId, ws.organizationId)));
    tested = true;
    message += test.ok ? ` ${test.message}` : "";
    if (!test.ok) {
      revalidatePath(PATH);
      return { error: `Saved, but the test failed: ${test.message}`, tested };
    }
  }
  revalidatePath(PATH);
  return { ok: true, message, tested };
}

export async function disconnectIntegration(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ws = await requireWorkspace();
  if (!canManageIntegrations(ws.role)) return { error: NOT_ALLOWED };
  const kind = z.enum(INTEGRATION_KINDS).safeParse(formData.get("kind"));
  if (!kind.success) return { error: "Integration not found." };
  const deleted = await db
    .delete(integrations)
    .where(and(eq(integrations.organizationId, ws.organizationId), eq(integrations.kind, kind.data)))
    .returning({ id: integrations.id });
  if (!deleted.length) return { error: "It was already disconnected. Reload the page." };
  revalidatePath(PATH);
  return { ok: true, message: `${KIND_LABELS[kind.data]} disconnected. Its saved credentials were deleted.` };
}

export async function testIntegration(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ws = await requireWorkspace();
  if (!canManageIntegrations(ws.role)) return { error: "Only owners and admins can test integrations." };
  const kind = z.enum(INTEGRATION_KINDS).safeParse(formData.get("kind"));
  if (!kind.success) return { error: "Integration not found." };
  const limit = rateLimit(`integration-test:${ws.user.id}`, 10, 60_000);
  if (!limit.ok) return { error: `Too many tests. Try again in ${limit.retryAfterSec} seconds.` };
  const row = await findRow(ws.organizationId, kind.data);
  if (!row) return { error: "Not connected. Reload the page." };
  let secrets: Secrets;
  try {
    secrets = openSecrets(row);
  } catch {
    return { error: "The saved credentials could not be read. Enter them again and save." };
  }
  const test = await testConnection(kind.data, row.config ?? {}, secrets);
  await db
    .update(integrations)
    .set({ lastTestedAt: new Date(), lastTestOk: test.ok, lastTestMessage: test.message.slice(0, 500) })
    .where(and(eq(integrations.id, row.id), eq(integrations.organizationId, ws.organizationId)));
  revalidatePath(PATH);
  return test.ok ? { ok: true, message: test.message } : { error: test.message };
}

// ---------------------------------------------------------------------------- database queries

const reserved: readonly string[] = RESERVED_ACTION_NAMES;
/** Names the other integrations' tools use. */
const INTEGRATION_TOOL_NAMES = new Set([...CRM_KINDS.flatMap((k) => crmTools(k)), ...calcomTools(), bookingLinkTool("")].map((t) => t.name));

const QueryDraft = z.object({
  sql: z.string().max(MAX_QUERY_SQL + 100),
  parameters: z.array(DbQueryParameter).max(MAX_PARAMETERS, `At most ${MAX_PARAMETERS} inputs.`),
});

const QueryForm = QueryDraft.extend({
  queryId: Id.nullable(),
  name: z
    .string()
    .trim()
    .regex(ACTION_NAME_RE, "Name: start with a lowercase letter, then lowercase letters, numbers or _ (at most 40).")
    .refine((n) => !reserved.includes(n), "That name is used by the agent itself. Pick another one.")
    .refine((n) => !INTEGRATION_TOOL_NAMES.has(n), "That name is used by another integration. Pick another one."),
  description: z.string().trim().min(1, "Describe when the agent should use this query.").max(1000, "Description: at most 1,000 characters."),
  enabled: z.boolean(),
});

function paramIssue(path: PropertyKey[]): string | null {
  if (path[0] !== "parameters" || typeof path[1] !== "number") return null;
  const n = path[1] + 1;
  if (path[2] === "name") return `Input ${n}: name must start with a lowercase letter, then lowercase letters, numbers or _ (at most 40).`;
  if (path[2] === "description") return `Input ${n}: description is at most 300 characters.`;
  return `Input ${n} is not valid.`;
}

/** Unique names; a verified user id input is always required and never yes / no. */
function cleanParameters(list: DbQueryParameter[]): { ok: true; params: DbQueryParameter[] } | { ok: false; reason: string } {
  const out: DbQueryParameter[] = [];
  for (const [i, p] of list.entries()) {
    if (out.some((x) => x.name === p.name)) return { ok: false, reason: `Two inputs are called ${p.name}. Use different names.` };
    if (p.verifiedUserId && p.type === "boolean") return { ok: false, reason: `Input ${i + 1}: a signed-in user id can't be a yes / no value.` };
    out.push({
      name: p.name,
      type: p.type,
      description: p.description.trim(),
      required: p.verifiedUserId ? true : p.required,
      ...(p.verifiedUserId ? { verifiedUserId: true } : {}),
    });
  }
  return { ok: true, params: out };
}

export type SaveQueryState = (ActionState & { savedId?: string }) | null;

export async function saveDbQuery(_prev: SaveQueryState, formData: FormData): Promise<SaveQueryState> {
  const ws = await requireWorkspace();
  if (!canManageIntegrations(ws.role)) return { error: NOT_ALLOWED };
  const parsed = QueryForm.safeParse(readPayload(formData));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { error: (issue && paramIssue(issue.path)) ?? issue?.message ?? "Please check the form." };
  }
  const f = parsed.data;
  const row = await findRow(ws.organizationId, "database");
  if (!row) return { error: "Connect the database first." };
  const params = cleanParameters(f.parameters);
  if (!params.ok) return { error: params.reason };
  const dialect = (row.config?.dialect === "mysql" ? "mysql" : "postgres") as DbDialect;
  const check = checkReadOnlySql(f.sql, dialect, params.params.map((p) => p.name));
  if (!check.ok) return { error: check.reason };

  let existing: typeof integrationQueries.$inferSelect | undefined;
  if (f.queryId) {
    [existing] = await db
      .select()
      .from(integrationQueries)
      .where(and(eq(integrationQueries.id, f.queryId), eq(integrationQueries.integrationId, row.id), eq(integrationQueries.organizationId, ws.organizationId)))
      .limit(1);
    if (!existing) return { error: "This query no longer exists. Reload the page." };
  } else {
    const [{ n }] = await db.select({ n: count() }).from(integrationQueries).where(eq(integrationQueries.integrationId, row.id));
    if ((n ?? 0) >= MAX_QUERIES) return { error: `At most ${MAX_QUERIES} queries.` };
  }

  const [twin] = await db
    .select({ id: integrationQueries.id })
    .from(integrationQueries)
    .where(and(eq(integrationQueries.integrationId, row.id), eq(integrationQueries.name, f.name), existing ? ne(integrationQueries.id, existing.id) : undefined))
    .limit(1);
  if (twin) return { error: `There is already a query called ${f.name}.` };
  const [action] = await db
    .select({ agent: agents.name })
    .from(agentActions)
    .innerJoin(agents, eq(agents.id, agentActions.agentId))
    .where(and(eq(agentActions.organizationId, ws.organizationId), eq(agentActions.name, f.name)))
    .limit(1);
  if (action) return { error: `The agent ${action.agent} already has an action called ${f.name}. Pick another name.` };

  const values = { name: f.name, description: f.description, sql: f.sql.trim(), parameters: params.params, enabled: f.enabled };
  let id: string;
  try {
    if (existing) {
      id = existing.id;
      await db.update(integrationQueries).set(values).where(and(eq(integrationQueries.id, id), eq(integrationQueries.organizationId, ws.organizationId)));
    } else {
      id = crypto.randomUUID();
      await db.insert(integrationQueries).values({ id, organizationId: ws.organizationId, integrationId: row.id, ...values });
    }
  } catch (err) {
    if (/integration_queries_integration_name_uq/.test(String((err as { message?: string })?.message ?? err))) {
      return { error: `There is already a query called ${f.name}.` };
    }
    console.error("saving query failed", (err as Error).message);
    return { error: "Could not save the query." };
  }
  revalidatePath(PATH);
  return { ok: true, message: existing ? "Query saved." : "Query added.", savedId: id };
}

async function queryAction(formData: FormData, change: (organizationId: string, queryId: string) => Promise<{ id: string }[]>): Promise<ActionState> {
  const ws = await requireWorkspace();
  if (!canManageIntegrations(ws.role)) return { error: NOT_ALLOWED };
  const queryId = Id.safeParse(formData.get("queryId"));
  if (!queryId.success) return { error: "Query not found." };
  const changed = await change(ws.organizationId, queryId.data);
  if (!changed.length) return { error: "Query not found. Reload the page." };
  revalidatePath(PATH);
  return { ok: true };
}

export async function deleteDbQuery(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const res = await queryAction(formData, (org, id) =>
    db
      .delete(integrationQueries)
      .where(and(eq(integrationQueries.id, id), eq(integrationQueries.organizationId, org)))
      .returning({ id: integrationQueries.id }),
  );
  return res?.ok ? { ok: true, message: "Query deleted." } : res;
}

export async function setDbQueryEnabled(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const enabled = formData.get("enabled") === "true";
  const res = await queryAction(formData, (org, id) =>
    db
      .update(integrationQueries)
      .set({ enabled })
      .where(and(eq(integrationQueries.id, id), eq(integrationQueries.organizationId, org)))
      .returning({ id: integrationQueries.id }),
  );
  return res?.ok ? { ok: true, message: enabled ? "Turned on." : "Turned off." } : res;
}

export type TryQueryState = null | { error: string } | { ok: boolean; result: string; detail: string | null; durationMs: number };

const TryForm = QueryDraft.extend({
  args: z.record(z.string(), z.string().max(1000)),
  userId: z.string().trim().max(200),
});

/** Runs the query in the editor (saved or not) with sample values, as the owner. */
export async function tryDbQuery(_prev: TryQueryState, formData: FormData): Promise<TryQueryState> {
  const ws = await requireWorkspace();
  if (!canManageIntegrations(ws.role)) return { error: "Only owners and admins can try queries." };
  const parsed = TryForm.safeParse(readPayload(formData));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { error: (issue && paramIssue(issue.path)) ?? issue?.message ?? "Please check the form." };
  }
  const limit = rateLimit(`query-try:${ws.user.id}`, 20, 60_000);
  if (!limit.ok) return { error: `Too many tries. Try again in ${limit.retryAfterSec} seconds.` };
  const row = await findRow(ws.organizationId, "database");
  if (!row) return { error: "Connect the database first." };
  const params = cleanParameters(parsed.data.parameters);
  if (!params.ok) return { error: params.reason };
  const args = Object.fromEntries(Object.entries(parsed.data.args).filter(([, v]) => v !== ""));
  const started = Date.now();
  const run = await runDatabaseQuery(row, { sql: parsed.data.sql, parameters: params.params }, args, parsed.data.userId || null);
  return { ok: run.ok, result: run.result, detail: run.ok ? null : (run.detail ?? null), durationMs: Date.now() - started };
}
