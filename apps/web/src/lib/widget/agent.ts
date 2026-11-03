import "server-only";
import { and, eq } from "drizzle-orm";
import type { WidgetErrorCode } from "@talkfront/shared";
import { db } from "@/db";
import { agents, member } from "@/db/schema";
import { getAuth } from "../auth";
import { apiError } from "../http";
import { checkOrigin, corsHeaders, requestOrigin } from "../widget-origin";

type Agent = typeof agents.$inferSelect;

/** Public widget API errors use only the codes in docs/contracts.md §1. */
export const widgetError = (status: number, code: WidgetErrorCode, message: string, headers?: HeadersInit) =>
  apiError(status, code, message, headers);

/**
 * Shared checks for the public widget API: find the agent by public key, check the Origin,
 * and hide drafts (404) unless the request comes from the dashboard itself: the app's own Origin
 * AND a signed-in user who is a member of the agent's workspace. Origin alone is not proof, since
 * any script outside a browser can send any Origin; the session cookie is.
 */
export async function resolveWidgetAgent(
  req: Request,
  key: string | null,
): Promise<{ agent: Agent; headers: Headers } | { response: Response }> {
  const origin = requestOrigin(req);
  const noCors = corsHeaders(null, false);
  if (!key || key.length < 8 || key.length > 100) {
    return { response: widgetError(400, "invalid_request", "Missing or invalid key.", noCors) };
  }
  const [agent] = await db.select().from(agents).where(eq(agents.publicKey, key)).limit(1);
  if (!agent) return { response: widgetError(404, "not_found", "No agent with this key.", noCors) };

  const check = checkOrigin(origin, agent.allowedDomains);
  if (!check.allowed) {
    return { response: widgetError(403, "origin_not_allowed", "This website is not allowed to use this agent.", noCors) };
  }
  const headers = corsHeaders(origin, true);
  if (agent.status !== "published" && !(check.isAppOrigin && (await isWorkspaceMember(req, agent.organizationId)))) {
    return { response: widgetError(404, "not_found", "No agent with this key.", headers) };
  }
  return { agent, headers };
}

/**
 * Whether the request carries a dashboard session of a user in this workspace. Only called for
 * drafts, so published agents never pay for it. Any failure counts as "no" (the draft stays hidden).
 */
async function isWorkspaceMember(req: Request, organizationId: string): Promise<boolean> {
  try {
    const session = await getAuth().api.getSession({ headers: req.headers });
    if (!session) return false;
    const [row] = await db
      .select({ id: member.id })
      .from(member)
      .where(and(eq(member.userId, session.user.id), eq(member.organizationId, organizationId)))
      .limit(1);
    return Boolean(row);
  } catch (e) {
    console.error("draft agent session check failed", e);
    return false;
  }
}

/** Preflight: the key isn't known here, so any origin may ask; the real request is checked. */
export function preflight(req: Request) {
  const origin = req.headers.get("origin");
  return new Response(null, { status: 204, headers: corsHeaders(origin, Boolean(origin)) });
}

/** Keeps only origin + path of the visitor's page; query strings and hashes can carry tokens. */
export function cleanPageUrl(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return `${u.origin}${u.pathname}`.slice(0, 2048);
  } catch {
    return null;
  }
}
