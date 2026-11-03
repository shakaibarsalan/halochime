import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { agents, conversations, handoffRequests, member, organization, user, wallets } from "@/db/schema";
import { LOW_BALANCE_SECONDS } from "../conversations";
import { sendQuietly } from "./send";
import { handoffEmail, lowMinutesEmail } from "./templates";

// Emails about what happened in conversations. Called from after() via lib/events.ts.
// Both functions never throw: they log and return.

/** Emails of the workspace's owners and admins (roles can be a comma list, e.g. "owner,admin"). */
async function managerEmails(organizationId: string): Promise<string[]> {
  const rows = await db
    .select({ email: user.email, role: member.role })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(eq(member.organizationId, organizationId));
  const emails = rows
    .filter((r) => r.role.split(",").some((x) => ["owner", "admin"].includes(x.trim())))
    .map((r) => r.email.toLowerCase());
  return [...new Set(emails)];
}

const Email = z.email().max(320);

/** A visitor left a message for the team (`created`), or corrected/added details to an open one. */
export async function emailOnHandoff(handoffId: string, created: boolean): Promise<void> {
  try {
    const [row] = await db
      .select({
        handoff: handoffRequests,
        workspace: organization.name,
        agentName: agents.name,
        handoffEmail: agents.handoffEmail,
      })
      .from(handoffRequests)
      .innerJoin(organization, eq(organization.id, handoffRequests.organizationId))
      .leftJoin(
        conversations,
        and(eq(conversations.id, handoffRequests.conversationId), eq(conversations.organizationId, handoffRequests.organizationId)),
      )
      .leftJoin(agents, eq(agents.id, conversations.agentId))
      .where(eq(handoffRequests.id, handoffId))
      .limit(1);
    if (!row) return;
    const h = row.handoff;

    const custom = row.handoffEmail ? Email.safeParse(row.handoffEmail.trim()) : null;
    const to = custom?.success ? [custom.data] : await managerEmails(h.organizationId);
    if (to.length === 0) return;

    const visitorEmail = h.email ? Email.safeParse(h.email.trim()) : null;
    const replyTo = visitorEmail?.success ? visitorEmail.data : undefined;
    const email = handoffEmail({
      created,
      workspace: row.workspace,
      agentName: row.agentName ?? "your agent",
      conversationId: h.conversationId,
      visitor: { name: h.name, email: h.email, phone: h.phone },
      replyable: Boolean(replyTo),
      message: h.message,
      reason: custom?.success ? "handoff-email" : "manager",
    });
    for (const address of to) await sendQuietly(address, email, replyTo);
  } catch (err) {
    console.error("[email] handoff email failed", err);
  }
}

/**
 * Low / out of voice minutes. endConversation() marks the wallet (low_balance_notified_at) in the
 * same transaction that deducts the call, when the balance first drops under 5 minutes or reaches 0.
 * That transaction's timestamp equals the call's usage_events.created_at, so only the call that set
 * the mark sends the email, and it goes out once per drop.
 */
export async function emailOnConversationEnded(conversationId: string): Promise<void> {
  try {
    const rows = await db.execute<{
      organization_id: string;
      balance_seconds: number;
      notified: boolean | null;
      triggered: boolean | null;
      workspace: string;
    }>(sql`
      select w.organization_id, w.balance_seconds, o.name as workspace,
             w.low_balance_notified_at is not null as notified,
             w.low_balance_notified_at = u.created_at as triggered
        from usage_events u
        join wallets w on w.organization_id = u.organization_id
        join organization o on o.id = u.organization_id
       where u.conversation_id = ${conversationId} and u.kind = 'voice_seconds'
       limit 1`);
    const w = rows[0];
    if (!w) return;

    // Balance went back up some other way (top up, manual change): re-arm the warning.
    if (w.notified && w.balance_seconds >= LOW_BALANCE_SECONDS) {
      await db
        .update(wallets)
        .set({ lowBalanceNotifiedAt: null })
        .where(and(eq(wallets.organizationId, w.organization_id), sql`${wallets.balanceSeconds} >= ${LOW_BALANCE_SECONDS}`));
      return;
    }
    if (!w.triggered) return;

    const to = await managerEmails(w.organization_id);
    const email = lowMinutesEmail({ workspace: w.workspace, balanceSeconds: w.balance_seconds });
    for (const address of to) await sendQuietly(address, email);
  } catch (err) {
    console.error("[email] low minutes email failed", err);
  }
}
