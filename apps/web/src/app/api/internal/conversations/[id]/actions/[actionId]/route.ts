import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { RunActionRequest, type RunActionResponse } from "@talkfront/shared";
import { db } from "@/db";
import { agentActions, conversations } from "@/db/schema";
import { runAction } from "@/lib/actions/runner";
import { findIntegrationTool, runIntegrationTool } from "@/lib/integrations/execute";
import { isIntegrationToolId, parseToolId } from "@/lib/integrations/tools";
import { apiError, parseJson } from "@/lib/http";
import { checkInternalAuth } from "@/lib/internal-auth";
import { rateLimit } from "@/lib/rate-limit";

// The voice agent calls this when the model uses one of the business's actions (docs/integrations.md §4)
// or an integration tool (ids starting with "int:", §6).
// Not recorded here: the agent writes one `tool` transcript row per call (transcript.describe_tool_call).

const CALLS_PER_WINDOW = 20;
const WINDOW_MS = 60_000;
/** Real bookings: at most 3 per conversation per hour. */
const BOOKINGS_PER_HOUR = 3;

// A business API may take up to 15 s (the action timeout).
export const maxDuration = 30;

const TOO_MANY: RunActionResponse = {
  ok: false,
  status: null,
  result: "Too many actions in a short time, so this one was not run. Wait a moment before trying again.",
};

/** Next.js may hand the segment over still percent-encoded ("int%3Ahubspot%3A..."). Ids never contain %. */
function segment(raw: string): string {
  if (!raw.includes("%")) return raw;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string; actionId: string }> }) {
  const denied = checkInternalAuth(req);
  if (denied) return denied;
  const { id, actionId: rawActionId } = await ctx.params;
  const actionId = segment(rawActionId);
  const parsed = await parseJson(req, RunActionRequest);
  if ("response" in parsed) return parsed.response;

  const [conv] = await db
    .select({
      id: conversations.id,
      agentId: conversations.agentId,
      organizationId: conversations.organizationId,
      status: conversations.status,
      mode: conversations.mode,
      visitorId: conversations.visitorId,
      visitorVerified: conversations.visitorVerified,
      visitorEmail: conversations.visitorEmail,
      visitorName: conversations.visitorName,
    })
    .from(conversations)
    .where(eq(conversations.id, id))
    .limit(1);
  if (!conv) return apiError(404, "not_found", "Conversation not found.");

  if (isIntegrationToolId(actionId)) {
    const ref = parseToolId(actionId);
    const found = ref ? await findIntegrationTool(ref, conv.organizationId, conv.agentId) : null;
    if (!ref || !found) return apiError(404, "not_found", "Action not found for this conversation's agent.");
    if (conv.status !== "active") return apiError(409, "conversation_ended", "This conversation has ended.");
    const limit = rateLimit(`action:${conv.id}`, CALLS_PER_WINDOW, WINDOW_MS);
    if (!limit.ok) return NextResponse.json(TOO_MANY);
    if ("op" in ref && ref.op === "book" && !rateLimit(`booking:${conv.id}`, BOOKINGS_PER_HOUR, 3_600_000).ok) {
      return NextResponse.json({ ok: false, status: null, result: "Several meetings were already booked in this conversation, so no more can be booked here." } satisfies RunActionResponse);
    }
    const started = Date.now();
    const verified = conv.visitorVerified;
    const run = await runIntegrationTool(found, parsed.data.arguments, {
      conversationId: conv.id,
      mode: conv.mode,
      visitor: {
        verified,
        id: verified ? conv.visitorId : null,
        email: verified ? conv.visitorEmail : null,
        name: verified ? conv.visitorName : null,
      },
    });
    console.info(`integration tool ${actionId} -> ${run.ok ? "ok" : "failed"} ${run.status ?? "-"} in ${Date.now() - started} ms`);
    const body: RunActionResponse = { ok: run.ok, status: run.status, result: run.result };
    return NextResponse.json(body);
  }

  const [action] = await db
    .select()
    .from(agentActions)
    .where(
      and(
        eq(agentActions.id, actionId),
        eq(agentActions.agentId, conv.agentId),
        eq(agentActions.organizationId, conv.organizationId),
      ),
    )
    .limit(1);
  if (!action) return apiError(404, "not_found", "Action not found for this conversation's agent.");
  if (!action.enabled) return apiError(409, "action_disabled", "This action is turned off.");
  if (conv.status !== "active") return apiError(409, "conversation_ended", "This conversation has ended.");

  // A model stuck in a loop must not hammer the business's API.
  const limit = rateLimit(`action:${conv.id}`, CALLS_PER_WINDOW, WINDOW_MS);
  if (!limit.ok) return NextResponse.json(TOO_MANY);

  const run = await runAction(action, parsed.data.arguments, {
    conversationId: conv.id,
    verifiedVisitorId: conv.visitorVerified ? conv.visitorId : null,
  });
  console.info(`action ${action.id} (${action.name}) -> ${run.ok ? "ok" : "failed"} ${run.status ?? "-"} in ${run.durationMs} ms`);
  const body: RunActionResponse = { ok: run.ok, status: run.status, result: run.result };
  return NextResponse.json(body);
}
