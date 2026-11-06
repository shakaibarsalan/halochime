import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { conversations, handoffRequests } from "@/db/schema";

export type HandoffInput = { message: string; name?: string; email?: string; phone?: string };

/**
 * Saves the visitor's message for the team on a conversation (used by the voice agent's internal
 * route and by the WhatsApp turn). One open handoff per conversation: a second call means the visitor
 * corrected or added details. Returns null when the conversation does not exist. The caller fans out
 * the emails and webhooks with handoffSaved().
 */
export async function saveHandoff(
  conversationId: string,
  h: HandoffInput,
): Promise<{ handoffId: string; created: boolean } | null> {
  const name = h.name?.trim() || null;
  const email = h.email?.trim() || null;
  const phone = h.phone?.trim() || null;

  return db.transaction(async (tx) => {
    // Remember who the visitor is on the conversation; newly confirmed details win over earlier ones.
    const [conv] = await tx
      .update(conversations)
      .set({
        handoffRequested: true,
        visitorName: sql`coalesce(${name}, ${conversations.visitorName})`,
        visitorEmail: sql`coalesce(${email}, ${conversations.visitorEmail})`,
      })
      .where(eq(conversations.id, conversationId))
      .returning({ organizationId: conversations.organizationId });
    if (!conv) return null;

    const [open] = await tx
      .select({ id: handoffRequests.id })
      .from(handoffRequests)
      .where(and(eq(handoffRequests.conversationId, conversationId), eq(handoffRequests.status, "open")))
      .limit(1);
    if (open) {
      await tx
        .update(handoffRequests)
        .set({
          name: sql`coalesce(${name}, ${handoffRequests.name})`,
          email: sql`coalesce(${email}, ${handoffRequests.email})`,
          phone: sql`coalesce(${phone}, ${handoffRequests.phone})`,
          message: h.message,
        })
        .where(eq(handoffRequests.id, open.id));
      return { handoffId: open.id, created: false };
    }
    const [inserted] = await tx
      .insert(handoffRequests)
      .values({ organizationId: conv.organizationId, conversationId, name, email, phone, message: h.message })
      .returning({ id: handoffRequests.id });
    return { handoffId: inserted!.id, created: true };
  });
}
