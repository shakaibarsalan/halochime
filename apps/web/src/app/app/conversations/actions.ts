"use server";

import { and, eq, inArray, or, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { ActionState } from "@/components/form-bits";
import { db } from "@/db";
import { conversations, handoffRequests, webhookDeliveries, webhookEndpoints } from "@/db/schema";
import { requireWorkspace } from "@/lib/session";
import { canDeleteConversations } from "./roles";

const IdInput = z.string().trim().min(1).max(128);

/**
 * Deletes one ended conversation of the active workspace and everything that holds its content:
 * messages (ON DELETE CASCADE), plus its handoff requests and the webhook log entries about it, whose
 * FKs would only unlink them, so they are deleted here. Billing stays: usage_events.conversation_id is
 * ON DELETE SET NULL, so the minutes a call used stay in the ledger, just without the link.
 * A live conversation can't be deleted: ending it is what bills it, and that needs the row.
 */
export async function deleteConversation(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ws = await requireWorkspace();
  if (!canDeleteConversations(ws.role)) return { error: "Only owners and admins can delete conversations." };
  const id = IdInput.safeParse(formData.get("conversationId"));
  if (!id.success) return { error: "Conversation not found." };
  const organizationId = ws.organizationId;

  const outcome = await db.transaction(async (tx) => {
    const [conv] = await tx
      .select({ id: conversations.id, status: conversations.status })
      .from(conversations)
      .where(and(eq(conversations.id, id.data), eq(conversations.organizationId, organizationId)))
      .limit(1)
      .for("update");
    if (!conv) return "not_found" as const;
    if (conv.status !== "ended") return "live" as const;

    const handoffs = await tx
      .delete(handoffRequests)
      .where(and(eq(handoffRequests.conversationId, conv.id), eq(handoffRequests.organizationId, organizationId)))
      .returning({ id: handoffRequests.id });

    // conversation.ended carries the transcript and visitor details; handoff events carry the visitor's message.
    const handoffIds = handoffs.map((h) => h.id);
    await tx
      .delete(webhookDeliveries)
      .where(
        and(
          eq(webhookDeliveries.organizationId, organizationId),
          inArray(
            webhookDeliveries.endpointId,
            tx.select({ id: webhookEndpoints.id }).from(webhookEndpoints).where(eq(webhookEndpoints.organizationId, organizationId)),
          ),
          or(
            sql`${webhookDeliveries.payload} #>> '{data,conversation,id}' = ${conv.id}`,
            handoffIds.length ? inArray(sql`${webhookDeliveries.payload} #>> '{data,handoff,id}'`, handoffIds) : undefined,
          ),
        ),
      );

    await tx.delete(conversations).where(and(eq(conversations.id, conv.id), eq(conversations.organizationId, organizationId)));
    return "deleted" as const;
  });

  if (outcome === "not_found") return { error: "Conversation not found. It may have been deleted already." };
  if (outcome === "live") return { error: "This conversation is still live. You can delete it once it ends." };
  // Overview counts and the sidebar's open handoffs badge change too.
  revalidatePath("/app", "layout");
  redirect("/app/conversations?deleted=1");
}
