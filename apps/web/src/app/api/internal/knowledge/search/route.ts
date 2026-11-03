import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { KnowledgeSearchRequest, type KnowledgeSearchResponse } from "@talkfront/shared";
import { db } from "@/db";
import { conversations } from "@/db/schema";
import { apiError, parseJson } from "@/lib/http";
import { checkInternalAuth } from "@/lib/internal-auth";
import { searchKnowledge } from "@/lib/knowledge/search";

export async function POST(req: Request) {
  const denied = checkInternalAuth(req);
  if (denied) return denied;
  const parsed = await parseJson(req, KnowledgeSearchRequest);
  if ("response" in parsed) return parsed.response;
  const { conversationId, query, limit, embedding } = parsed.data;

  const [conv] = await db
    .select({ organizationId: conversations.organizationId, agentId: conversations.agentId })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1);
  if (!conv) return apiError(404, "not_found", "Conversation not found.");

  // With `embedding` (from the embedder), semantic and text results are fused; without it, text only.
  const body: KnowledgeSearchResponse = { results: await searchKnowledge(conv, query, limit, embedding) };
  return NextResponse.json(body);
}
