import { eq } from "drizzle-orm";
import { after, NextResponse } from "next/server";
import { sweepStaleConversations } from "@/lib/conversations";
import { type IdentityTokenClaims, WidgetSessionRequest, type WidgetSessionResponse } from "@talkfront/shared";
import { db } from "@/db";
import { conversations, wallets } from "@/db/schema";
import { livekitEnv } from "@/lib/env";
import { clientIp, parseJson } from "@/lib/http";
import { dispatchAgent, mintVisitorToken, roomNameFor } from "@/lib/livekit";
import { rateLimit } from "@/lib/rate-limit";
import { openIdentitySecret, verifyIdentityToken } from "@/lib/identity";
import { cleanPageUrl, preflight, resolveWidgetAgent, widgetError } from "@/lib/widget/agent";
import { corsHeaders } from "@/lib/widget-origin";

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

  if (input.mode === "voice") {
    const [wallet] = await db
      .select({ balance: wallets.balanceSeconds })
      .from(wallets)
      .where(eq(wallets.organizationId, agent.organizationId))
      .limit(1);
    if (!wallet || wallet.balance <= 0) {
      return widgetError(402, "out_of_credit", "This business is out of voice minutes.", headers);
    }
  }

  const conversationId = crypto.randomUUID();
  const identity = await identifyVisitor(agent, input.identityToken);
  await db.insert(conversations).values({
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
  });

  const metadata = { conversationId, agentId: agent.id, organizationId: agent.organizationId, mode: input.mode };
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
