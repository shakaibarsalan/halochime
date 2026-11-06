import "server-only";
import type { RunActionResponse } from "@talkfront/shared";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { integrationQueries, integrations } from "@/db/schema";
import { bookingLinkResult, calcomClient } from "./calcom";
import { runAddNote, runFindContact, runSaveLead, type VisitorContext } from "./crm";
import { DbError, runReadOnlyQuery } from "./db-connector";
import { parseConnectionString } from "./db-url";
import { bindQueryArgs, checkReadOnlySql, compileSql, formatRows } from "./sql";
import { crmClientFor, openSecrets, type IntegrationRow, type QueryRow } from "./store";
import type { ToolRef } from "./tools";
import { isCrmKind, type DbDialect, type DbQueryParameter } from "./types";

// Runs one integration tool for the internal action route (POST .../actions/int:...).

export type ToolContext = {
  conversationId: string;
  mode: "voice" | "text";
  visitor: VisitorContext & { id: string | null };
};

export type FoundTool = { ref: ToolRef; row: IntegrationRow; query: QueryRow | null };

/** The integration behind a tool id, if this agent may use it. null = not this agent's tool (404). */
export async function findIntegrationTool(ref: ToolRef, organizationId: string, agentId: string): Promise<FoundTool | null> {
  const [row] = await db
    .select()
    .from(integrations)
    .where(
      and(
        eq(integrations.organizationId, organizationId),
        eq(integrations.kind, ref.kind),
        sql`${agentId} = ANY(${integrations.agentIds})`,
      ),
    )
    .limit(1);
  if (!row) return null;
  if (!("queryId" in ref)) return { ref, row, query: null };
  const [query] = await db
    .select()
    .from(integrationQueries)
    .where(and(eq(integrationQueries.id, ref.queryId), eq(integrationQueries.integrationId, row.id), eq(integrationQueries.organizationId, organizationId)))
    .limit(1);
  return query ? { ref, row, query } : null;
}

const fail = (result: string, status: number | null = null): RunActionResponse => ({ ok: false, status, result });

/** Runs a saved database query (also used by the dashboard's Try button with a draft). */
export async function runDatabaseQuery(
  row: Pick<IntegrationRow, "id" | "secretsEncrypted" | "config">,
  query: { sql: string; parameters: DbQueryParameter[] },
  rawArgs: Record<string, unknown>,
  verifiedUserId: string | null,
): Promise<RunActionResponse & { detail?: string }> {
  const dialect = (row.config?.dialect === "mysql" ? "mysql" : "postgres") as DbDialect;
  const ssl = row.config?.ssl === true;
  const check = checkReadOnlySql(query.sql, dialect, query.parameters.map((p) => p.name));
  if (!check.ok) return { ...fail("This lookup is set up wrongly, so it was not run."), detail: check.reason };
  const compiled = compileSql(query.sql, dialect, check.placeholders);
  const bound = bindQueryArgs(query.parameters, compiled.order, rawArgs, verifiedUserId);
  if (!bound.ok) return { ...fail(bound.reason), detail: bound.reason };
  let secrets;
  try {
    secrets = openSecrets(row);
  } catch {
    return { ...fail("This database's saved settings could not be read. The business needs to enter them again."), detail: "The saved connection string could not be decrypted. Enter it again." };
  }
  const target = parseConnectionString(secrets.connectionString ?? "", dialect);
  if (!target.ok) return { ...fail("The database is not set up correctly."), detail: target.reason };
  try {
    const rows = await runReadOnlyQuery(dialect, target.target, ssl, compiled.text, bound.values);
    return { ok: true, status: 200, result: formatRows(rows) };
  } catch (err) {
    if (err instanceof DbError) {
      // Postgres names inputs $1, $2...: show the owner's :names instead.
      const detail = dialect === "postgres" ? err.detail.replace(/\$(\d+)/g, (m, n) => (compiled.order[Number(n) - 1] ? `:${compiled.order[Number(n) - 1]}` : m)) : err.detail;
      return { ...fail(err.forAi), detail };
    }
    console.error(`integration ${row.id}: query failed unexpectedly`, (err as Error).message);
    return { ...fail("The database lookup failed."), detail: "Unexpected error." };
  }
}

export async function runIntegrationTool(found: FoundTool, rawArgs: Record<string, unknown>, ctx: ToolContext): Promise<RunActionResponse> {
  const { ref, row } = found;
  const config = row.config ?? {};

  if (ref.kind === "booking_link") {
    const url = typeof config.url === "string" ? config.url : "";
    return url ? bookingLinkResult(url, ctx.mode) : fail("No booking link is set up.");
  }

  if ("queryId" in ref) {
    const q = found.query;
    if (!q || !q.enabled) return fail("This lookup is turned off right now.");
    const verifiedUserId = ctx.visitor.verified && ctx.visitor.id ? ctx.visitor.id : null;
    const run = await runDatabaseQuery(row, { sql: q.sql, parameters: (q.parameters ?? []) as DbQueryParameter[] }, rawArgs, verifiedUserId);
    if (!run.ok && run.detail) console.info(`integration query ${q.id} failed: ${run.detail.slice(0, 200)}`);
    return { ok: run.ok, status: run.status, result: run.result };
  }

  let secrets;
  try {
    secrets = openSecrets(row);
  } catch {
    console.error(`integration ${row.id}: saved credentials could not be decrypted`);
    return fail("This integration's saved settings could not be read, so it was not used. The business needs to connect it again.");
  }

  if (ref.kind === "calcom") {
    const eventTypeId = Number(config.eventTypeId);
    const timeZone = typeof config.timeZone === "string" ? config.timeZone : "UTC";
    if (!secrets.apiKey || !Number.isInteger(eventTypeId)) return fail("Booking is not set up correctly.");
    const cal = calcomClient({ apiKey: secrets.apiKey, eventTypeId, timeZone });
    return ref.op === "find_slots" ? cal.findSlots(rawArgs) : cal.book(rawArgs);
  }

  if (isCrmKind(ref.kind) && "op" in ref) {
    let client;
    try {
      client = crmClientFor(ref.kind, config, secrets);
    } catch {
      return fail("The CRM is not set up correctly.");
    }
    if (ref.op === "find_contact") return runFindContact(client, rawArgs, ctx.visitor);
    if (ref.op === "save_lead") return runSaveLead(client, rawArgs, ctx.visitor);
    return runAddNote(client, rawArgs, ctx.visitor, ctx.mode);
  }
  return fail("Unknown tool.");
}
