import { eq } from "drizzle-orm";
import { AppendMessagesRequest } from "@talkfront/shared";
import { db } from "@/db";
import { conversations, messages } from "@/db/schema";
import { apiError, parseJson } from "@/lib/http";
import { checkInternalAuth } from "@/lib/internal-auth";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = checkInternalAuth(req);
  if (denied) return denied;
  const { id } = await ctx.params;
  const parsed = await parseJson(req, AppendMessagesRequest);
  if ("response" in parsed) return parsed.response;

  const [conv] = await db.select({ id: conversations.id }).from(conversations).where(eq(conversations.id, id)).limit(1);
  if (!conv) return apiError(404, "not_found", "Conversation not found.");

  await db.insert(messages).values(
    parsed.data.messages.map((m) => ({
      conversationId: id,
      role: m.role,
      content: m.content,
      createdAt: new Date(m.createdAt),
    })),
  );
  return new Response(null, { status: 204 });
}
