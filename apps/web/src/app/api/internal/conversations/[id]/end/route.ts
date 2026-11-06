import { after, NextResponse } from "next/server";
import { EndConversationRequest } from "@talkfront/shared";
import { endConversation } from "@/lib/conversations";
import { conversationEnded } from "@/lib/events";
import { logConversationToCrms } from "@/lib/integrations/log-conversation";
import { apiError, parseJson } from "@/lib/http";
import { checkInternalAuth } from "@/lib/internal-auth";
import { summarizeConversation } from "@/lib/summary";

// Emails and webhook retries run in after() and can take up to ~45 s.
export const maxDuration = 60;

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = checkInternalAuth(req);
  if (denied) return denied;
  const { id } = await ctx.params;
  const parsed = await parseJson(req, EndConversationRequest);
  if ("response" in parsed) return parsed.response;

  const result = await endConversation(id, parsed.data);
  if (!result) return apiError(404, "not_found", "Conversation not found.");
  // Only the call that actually ended it summarizes and notifies; repeats stay cheap.
  if (result.ended) {
    after(async () => {
      // Summary first (no-op without an Anthropic or Groq key), so emails and webhooks can include it.
      await summarizeConversation(id).catch((err) => console.error("summary failed", err));
      // Next to emails and webhooks (not after them, so it fits in maxDuration): connected CRMs with
      // "log conversations" on get the summary as a note. Best effort, never throws.
      await Promise.all([conversationEnded(id), logConversationToCrms(id)]);
    });
  }
  return NextResponse.json({ ok: true });
}
