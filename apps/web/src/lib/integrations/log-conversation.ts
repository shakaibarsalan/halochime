import "server-only";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { conversations, handoffRequests, integrations } from "@/db/schema";
import { appUrl } from "@/lib/env";
import { logSummary } from "./crm";
import { VendorError } from "./http";
import { crmClientFor, openSecrets } from "./store";
import { CRM_KINDS, KIND_LABELS, type CrmKind } from "./types";

/**
 * After a conversation ends (and after its summary): for every connected CRM with "log conversations"
 * on that this agent may use, find or create the contact (when an email or phone is known) and add the
 * summary as a note. Best effort: never throws; failures are logged without credentials.
 */
export async function logConversationToCrms(conversationId: string): Promise<void> {
  try {
    const [c] = await db
      .select({
        id: conversations.id,
        organizationId: conversations.organizationId,
        agentId: conversations.agentId,
        mode: conversations.mode,
        startedAt: conversations.startedAt,
        summary: conversations.summary,
        visitorName: conversations.visitorName,
        visitorEmail: conversations.visitorEmail,
        collectedData: conversations.collectedData,
      })
      .from(conversations)
      .where(eq(conversations.id, conversationId))
      .limit(1);
    if (!c?.summary?.trim()) return;

    const rows = await db
      .select()
      .from(integrations)
      .where(
        and(
          eq(integrations.organizationId, c.organizationId),
          inArray(integrations.kind, [...CRM_KINDS]),
          eq(integrations.logConversations, true),
          sql`${c.agentId} = ANY(${integrations.agentIds})`,
        ),
      );
    if (!rows.length) return;

    const [handoff] = await db
      .select({ name: handoffRequests.name, email: handoffRequests.email, phone: handoffRequests.phone })
      .from(handoffRequests)
      .where(eq(handoffRequests.conversationId, c.id))
      .orderBy(desc(handoffRequests.createdAt))
      .limit(1);

    const email = c.visitorEmail ?? handoff?.email ?? c.collectedData?.email ?? undefined;
    const phone = handoff?.phone ?? c.collectedData?.phone ?? undefined;
    if (!email && !phone) return;
    const name = c.visitorName ?? handoff?.name ?? c.collectedData?.visitor_name ?? null;
    const day = c.startedAt.toISOString().slice(0, 16).replace("T", " ");
    const heading = `Halochime ${c.mode === "voice" ? "call" : "chat"} on ${day} UTC: ${appUrl()}/app/conversations/${c.id}`;

    for (const row of rows) {
      const kind = row.kind as CrmKind;
      try {
        const client = crmClientFor(kind, row.config ?? {}, openSecrets(row));
        const outcome = await logSummary(client, { email, phone, name, summary: c.summary, heading });
        console.info(`crm log ${kind} for conversation ${c.id}: ${outcome}`);
      } catch (err) {
        const why = err instanceof VendorError ? `${err.status ?? "-"} ${err.message}` : "could not be set up (credentials unreadable or missing)";
        console.error(`crm log ${KIND_LABELS[kind]} failed for conversation ${c.id}: ${why}`);
      }
    }
  } catch (err) {
    console.error("crm log failed", (err as Error).message);
  }
}
