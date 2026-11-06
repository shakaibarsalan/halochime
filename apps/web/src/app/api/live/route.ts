import { NextResponse } from "next/server";
import { apiError } from "@/lib/http";
import { countLive, listLive } from "@/lib/live";
import { getSession, requireWorkspace } from "@/lib/session";

// The live inbox list, polled by /app/live every few seconds (and ?count=1 by the sidebar badge).
// Signed-in members only, scoped to their active workspace.

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(req: Request) {
  if (!(await getSession())) return apiError(401, "unauthorized", "Sign in again.", NO_STORE);
  const ws = await requireWorkspace();
  if (new URL(req.url).searchParams.get("count") === "1") {
    return NextResponse.json({ count: await countLive(ws.organizationId) }, { headers: NO_STORE });
  }
  const conversations = await listLive(ws.organizationId, ws.user.id);
  return NextResponse.json({ count: conversations.length, conversations }, { headers: NO_STORE });
}
