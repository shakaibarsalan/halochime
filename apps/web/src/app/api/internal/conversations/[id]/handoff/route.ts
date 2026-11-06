import { after, NextResponse } from "next/server";
import { HandoffRequest } from "@talkfront/shared";
import { saveHandoff } from "@/lib/handoff";
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

  const found = await saveHandoff(id, parsed.data);
  if (!found) return apiError(404, "not_found", "Conversation not found.");
  after(() => handoffSaved(found.handoffId, found.created));
  return NextResponse.json({ ok: true });
}
