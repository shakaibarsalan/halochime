import { and, asc, eq } from "drizzle-orm";
import { PageHeader, Notice } from "@/components/ui";
import { db } from "@/db";
import { agents, integrationQueries, integrations } from "@/db/schema";
import { formatDateTime } from "@/lib/format";
import { openSecrets } from "@/lib/integrations/store";
import { INTEGRATION_KINDS, type DbQueryParameter, type IntegrationKind } from "@/lib/integrations/types";
import { requireWorkspace } from "@/lib/session";
import { canManageIntegrations } from "../agents/[id]/roles";
import { IntegrationsBoard, type IntegrationView, type QueryView } from "./integrations-board";

export const metadata = { title: "Integrations" };

async function load(organizationId: string, withSql: boolean) {
  const rows = await db.select().from(integrations).where(eq(integrations.organizationId, organizationId));
  const dbRow = rows.find((r) => r.kind === "database");
  const queries = dbRow
    ? await db
        .select()
        .from(integrationQueries)
        .where(and(eq(integrationQueries.integrationId, dbRow.id), eq(integrationQueries.organizationId, organizationId)))
        .orderBy(asc(integrationQueries.createdAt))
    : [];
  const views: Partial<Record<IntegrationKind, IntegrationView>> = {};
  for (const r of rows) {
    let unreadable = false;
    try {
      openSecrets(r);
    } catch {
      unreadable = true;
    }
    views[r.kind] = {
      kind: r.kind,
      config: r.config ?? {},
      secretHint: r.secretHint,
      secretsUnreadable: unreadable,
      agentIds: r.agentIds,
      logConversations: r.logConversations,
      lastTest: r.lastTestedAt ? { ok: r.lastTestOk === true, message: r.lastTestMessage ?? "", at: formatDateTime(r.lastTestedAt) } : null,
    };
  }
  const queryViews: QueryView[] = queries.map((q) => ({
    id: q.id,
    name: q.name,
    description: q.description,
    // Members see the names only.
    sql: withSql ? q.sql : "",
    parameters: (q.parameters ?? []) as DbQueryParameter[],
    enabled: q.enabled,
  }));
  return { views, queryViews };
}

export default async function IntegrationsPage() {
  const ws = await requireWorkspace();
  const canManage = canManageIntegrations(ws.role);
  const agentList = await db
    .select({ id: agents.id, name: agents.name })
    .from(agents)
    .where(eq(agents.organizationId, ws.organizationId))
    .orderBy(asc(agents.createdAt));

  let data: Awaited<ReturnType<typeof load>> | null = null;
  try {
    data = await load(ws.organizationId, canManage);
  } catch (err) {
    // Before the integrations tables exist (deploy before migration) the page says so instead of failing.
    console.error("integrations page could not load", (err as Error).message);
  }

  return (
    <>
      <PageHeader
        title="Integrations"
        description={
          canManage
            ? "Connect your CRM, calendar or database. Your agents can then save leads, book meetings and look up records during a conversation."
            : "What this workspace's agents are connected to. Only owners and admins can change integrations."
        }
      />
      {data ? (
        <IntegrationsBoard kinds={[...INTEGRATION_KINDS]} views={data.views} queries={data.queryViews} agents={agentList} canManage={canManage} />
      ) : (
        <Notice tone="error">Integrations could not be loaded right now. Try again in a few minutes.</Notice>
      )}
    </>
  );
}
