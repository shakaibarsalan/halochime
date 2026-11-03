import { and, eq, sql } from "drizzle-orm";
import { after, NextResponse } from "next/server";
import { HandoffRequest } from "@talkfront/shared";
import { db } from "@/db";
import { conversations, handoffRequests } from "@/db/schema";
import { apiError, parseJson } from "@/lib/http";
import { handoffSaved } from "@/lib/events";
import { checkInternalAuth } from "@/lib/internal-auth";

// Emails and webhook retries run in after() and can take up to ~45 s.
export const maxDuration = 60;

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = checkInternalAuth(req);
  if (denied) return denied;
  const { id } = await ctx.params;
  const parsed = await parseJson(req, HandoffRequest);
  if ("response" in parsed) return parsed.response;
  const h = parsed.data;
  const name = h.name?.trim() || null;
  const email = h.email?.trim() || null;

  const phone = h.phone?.trim() || null;

  const found = await db.transaction(async (tx) => {
    // Remember who the visitor is on the conversation; newly confirmed details win over earlier ones.
    const [conv] = await tx
      .update(conversations)
      .set({
        handoffRequested: true,
        visitorName: sql`coalesce(${name}, ${conversations.visitorName})`,
        visitorEmail: sql`coalesce(${email}, ${conversations.visitorEmail})`,
      })
      .where(eq(conversations.id, id))
      .returning({ organizationId: conversations.organizationId });
    if (!conv) return null;

    // One open handoff per conversation: a second call means the visitor corrected or added details.
    const [open] = await tx
      .select({ id: handoffRequests.id })
      .from(handoffRequests)
      .where(and(eq(handoffRequests.conversationId, id), eq(handoffRequests.status, "open")))
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
      .values({
        organizationId: conv.organizationId,
        conversationId: id,
        name,
        email,
        phone,
        message: h.message,
      })
      .returning({ id: handoffRequests.id });
    return { handoffId: inserted!.id, created: true };
  });
  if (!found) return apiError(404, "not_found", "Conversation not found.");
  after(() => handoffSaved(found.handoffId, found.created));
  return NextResponse.json({ ok: true });
}
