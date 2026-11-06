import "server-only";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { integrationQueries, integrations } from "@/db/schema";
import { decryptSecret, encryptSecret, INTEGRATION_INFO } from "@/lib/actions/crypto";
import type { CrmClient } from "./crm";
import { goHighLevelClient } from "./gohighlevel";
import { hubspotClient } from "./hubspot";
import { buildIntegrationTools, type RuntimeTool } from "./tools";
import { ZOHO_DATA_CENTRES, type CrmKind, type DbQueryParameter, type ZohoDataCentre } from "./types";
import { zohoClient } from "./zoho";

// Loading integrations and opening their credentials (server only).

export type IntegrationRow = typeof integrations.$inferSelect;
export type QueryRow = typeof integrationQueries.$inferSelect;
export type Secrets = Record<string, string>;

export const sealSecrets = (secrets: Secrets, rowId: string): string | null =>
  Object.keys(secrets).length ? encryptSecret(JSON.stringify(secrets), INTEGRATION_INFO, rowId) : null;

/** Throws when the saved credentials can't be decrypted (e.g. BETTER_AUTH_SECRET changed). */
export function openSecrets(row: Pick<IntegrationRow, "id" | "secretsEncrypted">): Secrets {
  if (!row.secretsEncrypted) return {};
  const parsed: unknown = JSON.parse(decryptSecret(row.secretsEncrypted, INTEGRATION_INFO, row.id));
  const out: Secrets = {};
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    for (const [k, v] of Object.entries(parsed)) if (typeof v === "string") out[k] = v;
  }
  return out;
}

const str = (v: unknown) => (typeof v === "string" ? v : "");

/** The CRM client for a row of a CRM kind. Throws when a credential is missing. */
export function crmClientFor(kind: CrmKind, config: Record<string, unknown>, secrets: Secrets): CrmClient {
  if (kind === "hubspot") {
    if (!secrets.accessToken) throw new Error("missing token");
    return hubspotClient(secrets.accessToken);
  }
  if (kind === "gohighlevel") {
    if (!secrets.token || !str(config.locationId)) throw new Error("missing token");
    return goHighLevelClient(secrets.token, str(config.locationId));
  }
  const dc = str(config.dataCentre) as ZohoDataCentre;
  if (!secrets.clientId || !secrets.clientSecret || !secrets.refreshToken || !ZOHO_DATA_CENTRES.includes(dc)) throw new Error("missing token");
  return zohoClient({ clientId: secrets.clientId, clientSecret: secrets.clientSecret, refreshToken: secrets.refreshToken, dataCentre: dc });
}

/** Integrations this agent may use, with the database's queries. */
export async function integrationsForAgent(organizationId: string, agentId: string): Promise<{ row: IntegrationRow; queries: QueryRow[] }[]> {
  const rows = await db
    .select()
    .from(integrations)
    .where(and(eq(integrations.organizationId, organizationId), sql`${agentId} = ANY(${integrations.agentIds})`));
  const dbIds = rows.filter((r) => r.kind === "database").map((r) => r.id);
  const queries = dbIds.length
    ? await db
        .select()
        .from(integrationQueries)
        .where(and(eq(integrationQueries.organizationId, organizationId), inArray(integrationQueries.integrationId, dbIds)))
        .orderBy(asc(integrationQueries.createdAt))
    : [];
  return rows.map((row) => ({ row, queries: queries.filter((q) => q.integrationId === row.id) }));
}

/**
 * The runtime tools of one agent's integrations. Never throws: if anything goes wrong (for example
 * before the integrations tables exist) the agent simply gets no integration tools.
 */
export async function loadIntegrationTools(organizationId: string, agentId: string, taken: Iterable<string>): Promise<RuntimeTool[]> {
  try {
    const list = await integrationsForAgent(organizationId, agentId);
    return buildIntegrationTools(
      list.map(({ row, queries }) => ({
        kind: row.kind,
        config: row.config ?? {},
        queries: queries.map((q) => ({
          id: q.id,
          name: q.name,
          description: q.description,
          parameters: (q.parameters ?? []) as DbQueryParameter[],
          enabled: q.enabled,
        })),
      })),
      taken,
    );
  } catch (err) {
    console.error("integration tools could not be loaded", (err as Error).message);
    return [];
  }
}
