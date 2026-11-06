import { NextResponse } from "next/server";
import { apiError } from "@/lib/http";
import { getLiveConversation } from "@/lib/live";
import { getSession, requireWorkspace } from "@/lib/session";

// One live conversation with its messages so far, polled by /app/live/[id] every couple of seconds.

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await getSession())) return apiError(401, "unauthorized", "Sign in again.", NO_STORE);
  const ws = await requireWorkspace();
  const { id } = await ctx.params;
  if (!id || id.length > 128) return apiError(404, "not_found", "Conversation not found.", NO_STORE);
  const conversation = await getLiveConversation(ws.organizationId, ws.user.id, id);
  if (!conversation) return apiError(404, "not_found", "Conversation not found.", NO_STORE);
  return NextResponse.json({ conversation }, { headers: NO_STORE });
}
