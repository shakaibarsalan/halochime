import { and, eq } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { db } from "@/db";
import { member, workspaceBranding } from "@/db/schema";
import { getAuth } from "@/lib/auth";

// The agency logo in the dashboard sidebar. Only for signed-in members of that workspace. ?v= changes
// with every new logo, so the browser may keep it for a long time (privately).
export async function GET(req: NextRequest) {
  const org = req.nextUrl.searchParams.get("org") ?? "";
  const notFound = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  if (!org || org.length > 100) return notFound();

  const session = await getAuth().api.getSession({ headers: req.headers }).catch(() => null);
  if (!session) return notFound();
  const [row] = await db
    .select({ type: workspaceBranding.logoContentType, data: workspaceBranding.logoData })
    .from(workspaceBranding)
    .innerJoin(member, and(eq(member.organizationId, workspaceBranding.organizationId), eq(member.userId, session.user.id)))
    .where(eq(workspaceBranding.organizationId, org))
    .limit(1);
  if (!row?.type || !row.data) return notFound();

  return new Response(Buffer.from(row.data, "base64"), {
    headers: {
      "Content-Type": row.type,
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'",
    },
  });
}
