import { eq } from "drizzle-orm";
import { TakeoverRequest } from "@talkfront/shared";
import { db } from "@/db";
import { conversations } from "@/db/schema";
import { apiError, parseJson } from "@/lib/http";
import { checkInternalAuth } from "@/lib/internal-auth";

/**
 * The agent handed a taken over conversation back to the AI by itself (the team member sent nothing for
 * a few minutes), so the live inbox stops showing it as taken over. Idempotent.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = checkInternalAuth(req);
  if (denied) return denied;
  const { id } = await ctx.params;
  const parsed = await parseJson(req, TakeoverRequest);
  if ("response" in parsed) return parsed.response;

  const updated = await db
    .update(conversations)
    .set({ takenOverByUserId: null, takenOverByName: null, takenOverAt: null })
    .where(eq(conversations.id, id))
    .returning({ id: conversations.id });
  if (updated.length === 0) return apiError(404, "not_found", "Conversation not found.");
  return new Response(null, { status: 204 });
}
