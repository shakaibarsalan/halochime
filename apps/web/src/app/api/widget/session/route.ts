import { after, NextResponse } from "next/server";
import { sweepStaleConversations } from "@/lib/conversations";
import { type IdentityTokenClaims, WidgetSessionRequest, type WidgetSessionResponse } from "@talkfront/shared";
import { conversationHelpOffers, conversations } from "@/db/schema";
import { livekitEnv } from "@/lib/env";
import { clientIp, parseJson } from "@/lib/http";
import { dispatchAgent, mintVisitorToken, roomNameFor } from "@/lib/livekit";
import { rateLimit } from "@/lib/rate-limit";
import { openIdentitySecret, verifyIdentityToken } from "@/lib/identity";
import { cleanPageUrl, preflight, resolveWidgetAgent, widgetError } from "@/lib/widget/agent";
import { startSessionWithinLimits } from "@/lib/widget/limits";
import { pickVersion } from "@/lib/versions/server";
import { visitorKeyFor } from "@/lib/versions/split";
import { corsHeaders } from "@/lib/widget-origin";
import { acceptedHelpOffer } from "@/lib/page-help";
import { loadPageHelp } from "@/lib/widget/page-help";

// First, cheap layer: per IP, in memory, so per Vercel instance only. The real limits (per agent,
// per workspace, voice credit) are counted in the database by startSessionWithinLimits below.
const SESSIONS_PER_WINDOW = 10;
const WINDOW_MS = 10 * 60 * 1000;

export async function POST(req: Request) {
  // Before the agent is known the origin cannot be checked, so these early errors carry no CORS headers.
  const noCors = corsHeaders(null, false);

  const parsed = await parseJson(req, WidgetSessionRequest, noCors);
  if ("response" in parsed) return parsed.response;
  const input = parsed.data;

  const resolved = await resolveWidgetAgent(req, input.key);
  if ("response" in resolved) return resolved.response;
  const { agent, headers } = resolved;

  if (!agent.modes.includes(input.mode)) {
    return widgetError(400, "invalid_request", `This agent does not accept ${input.mode} sessions.`, headers);
  }

  // Counted after the origin check so the widget can read the 429 and show a friendly message.
  const limit = rateLimit(`session:${clientIp(req)}`, SESSIONS_PER_WINDOW, WINDOW_MS);
  if (!limit.ok) {
    headers.set("Retry-After", String(limit.retryAfterSec));
    return widgetError(429, "rate_limited", "Too many sessions from this network. Please try again later.", headers);
  }

  const lk = livekitEnv();
  if (!lk) {
    return widgetError(503, "not_configured", "Voice and chat are not configured yet (LiveKit keys missing).", headers);
  }

  const conversationId = crypto.randomUUID();
  const identity = await identifyVisitor(agent, input.identityToken);
  // A/B test running on this agent: this visitor's version (the same one every time during the test).
  const version = await pickVersion(agent, visitorKeyFor(input.visitorId, identity?.sub, conversationId));
  // Only looked up when the visitor came from the help bubble; kept only if proactive help is on.
  const helpOffer = input.helpOffer ? acceptedHelpOffer(await loadPageHelp(agent.id), input.helpOffer) : null;
  // Per-agent burst, per-workspace running conversations and (voice) credit for every running call,
  // counted and inserted under one lock so parallel requests cannot all slip past the limits.
  const refusal = await startSessionWithinLimits(
    { organizationId: agent.organizationId, agentId: agent.id, mode: input.mode },
    async (tx) => {
      await tx.insert(conversations).values({
        id: conversationId,
        organizationId: agent.organizationId,
        agentId: agent.id,
        mode: input.mode,
        visitorId: identity?.sub ?? input.visitorId ?? null,
        visitorName: identity?.name ?? null,
        visitorEmail: identity?.email ?? null,
        visitorVerified: identity !== null,
        visitorAttributes: identity?.attributes ?? null,
        pageUrl: cleanPageUrl(input.page?.url),
        pageTitle: input.page?.title ?? null,
        roomName: roomNameFor(conversationId),
        ...(version ? { agentVersionId: version.versionId, abTestId: version.testId } : {}),
      });
      if (helpOffer) {
        await tx.insert(conversationHelpOffers).values({
          conversationId,
          organizationId: agent.organizationId,
          source: helpOffer.source,
          reason: helpOffer.reason ?? null,
          message: helpOffer.message,
        });
      }
    },
  );
  if (refusal) {
    if (refusal.retryAfterSec) headers.set("Retry-After", String(refusal.retryAfterSec));
    return widgetError(refusal.status, refusal.code, refusal.message, headers);
  }

  const metadata = {
    conversationId,
    agentId: agent.id,
    organizationId: agent.organizationId,
    mode: input.mode,
    // The widget already played the greeting while the call connected; the agent must not say it again.
    ...(input.mode === "voice" && input.greetingPlayed === true ? { greetingPlayed: true } : {}),
  };
  const { token, roomName } = await mintVisitorToken(lk, metadata);
  // The agent is on its way while the visitor's browser connects (see dispatchAgent).
  after(() => dispatchAgent(lk, metadata));

  const body: WidgetSessionResponse = { conversationId, livekitUrl: lk.url, token, roomName };
  headers.set("Cache-Control", "no-store");
  after(() => sweepStaleConversations().catch((e) => console.error("stale conversation sweep failed", e)));
  return NextResponse.json(body, { headers });
}

/**
 * The signed-in visitor from the identity token, or null. A missing, invalid or expired token never
 * blocks the session: the visitor is simply anonymous. The reason is logged, never the token.
 */
async function identifyVisitor(
  agent: { id: string; identitySecret: string | null },
  token: string | undefined,
): Promise<IdentityTokenClaims | null> {
  if (!token) return null;
  if (!agent.identitySecret) {
    console.warn(`identity token ignored for agent ${agent.id}: no identity secret set`);
    return null;
  }
  let secret: string;
  try {
    secret = openIdentitySecret(agent.identitySecret, agent.id);
  } catch {
    console.error(`identity token ignored for agent ${agent.id}: the identity secret could not be decrypted`);
    return null;
  }
  const check = await verifyIdentityToken(token, secret);
  if (!check.ok) {
    console.warn(`identity token rejected for agent ${agent.id}: ${check.code}`);
    return null;
  }
  return check.claims;
}

export const OPTIONS = preflight;
