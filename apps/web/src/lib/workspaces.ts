import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  agents,
  conversations,
  handoffRequests,
  knowledgeSources,
  member,
  minuteRequests,
  session,
  trialGrants,
  usageEvents,
  wallets,
  webhookEndpoints,
} from "@/db/schema";
import { removeWorkspaceChannels } from "./channels/cleanup";

/** Whether the user already owns a workspace. Only their first own workspace gets the free trial. */
export async function ownsWorkspace(userId: string): Promise<boolean> {
  const rows = await db
    .select({ id: member.id })
    .from(member)
    .where(and(eq(member.userId, userId), eq(member.role, "owner")))
    .limit(1);
  return rows.length > 0;
}

/** Whether the user has had the free trial, even on a workspace that has been deleted since. */
export async function hadTrial(userId: string): Promise<boolean> {
  const rows = await db.select({ userId: trialGrants.userId }).from(trialGrants).where(eq(trialGrants.userId, userId)).limit(1);
  return rows.length > 0;
}

/** Whether the user belongs to any workspace (owner or not). */
export async function hasWorkspace(userId: string): Promise<boolean> {
  const rows = await db.select({ id: member.id }).from(member).where(eq(member.userId, userId)).limit(1);
  return rows.length > 0;
}

const isOwnerRole = (role: string) => role.split(",").some((r) => r.trim() === "owner");

/**
 * Deletes a workspace's own data, all or nothing. Runs from Better Auth's beforeDeleteOrganization hook
 * (lib/auth.ts), after it has checked the caller may delete it; Better Auth then removes the members,
 * invites and the organization row. Every table here would also go by ON DELETE CASCADE from the
 * organization, but Better Auth runs its deletes without a transaction: doing the heavy part here,
 * in one, means a failure leaves the workspace whole (and retryable), never memberless but full.
 *
 * Billing goes too: the wallet and its usage rows count seconds, not money. What was paid lives with
 * the payment provider and in the request and top-up emails, and the Refund Policy says unused minutes
 * are lost when a workspace is deleted. Kept: who had the free trial (trial_grants, per user).
 */
export async function deleteWorkspaceData(organizationId: string): Promise<void> {
  // Phone numbers connected in LiveKit (Channels page) are outside the database. Best effort, never throws.
  await removeWorkspaceChannels(organizationId);
  await db.transaction(async (tx) => {
    // Workspaces made before trial_grants existed: remember the trial for its first owner (who made it).
    const [trial] = await tx
      .select({ id: usageEvents.id })
      .from(usageEvents)
      .where(and(eq(usageEvents.organizationId, organizationId), eq(usageEvents.kind, "trial")))
      .limit(1);
    if (trial) {
      const members = await tx
        .select({ userId: member.userId, role: member.role })
        .from(member)
        .where(eq(member.organizationId, organizationId))
        .orderBy(asc(member.createdAt));
      const [recorded] = await tx
        .select({ userId: trialGrants.userId })
        .from(trialGrants)
        .where(eq(trialGrants.organizationId, organizationId))
        .limit(1);
      const firstOwner = members.find((m) => isOwnerRole(m.role));
      if (!recorded && firstOwner) {
        await tx.insert(trialGrants).values({ userId: firstOwner.userId, organizationId }).onConflictDoNothing();
      }
    }

    // Leaves first: minute requests point at usage rows, handoffs and usage rows at conversations.
    await tx.delete(minuteRequests).where(eq(minuteRequests.organizationId, organizationId));
    await tx.delete(usageEvents).where(eq(usageEvents.organizationId, organizationId));
    await tx.delete(handoffRequests).where(eq(handoffRequests.organizationId, organizationId));
    // Delivery log rows go with their endpoint.
    await tx.delete(webhookEndpoints).where(eq(webhookEndpoints.organizationId, organizationId));
    // Messages go with their conversation.
    await tx.delete(conversations).where(eq(conversations.organizationId, organizationId));
    // Chunks go with their source.
    await tx.delete(knowledgeSources).where(eq(knowledgeSources.organizationId, organizationId));
    // Pictures and actions go with their agent.
    await tx.delete(agents).where(eq(agents.organizationId, organizationId));
    await tx.delete(wallets).where(eq(wallets.organizationId, organizationId));
    // Other members' sessions (and this user's other devices) may have it open. It is a plain column, no FK.
    await tx.update(session).set({ activeOrganizationId: null }).where(eq(session.activeOrganizationId, organizationId));
  });
}
