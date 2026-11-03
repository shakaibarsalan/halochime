import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { db } from "@/db";
import { member, organization } from "@/db/schema";
import { getAuth } from "./auth";

export const getSession = cache(async () => {
  // Read headers first: it marks the route dynamic before anything touches the database.
  const h = await headers();
  return getAuth().api.getSession({ headers: h });
});

/** Signed-in user or redirect to sign-in. */
export async function requireUser() {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  return session;
}

export type Workspace = {
  user: { id: string; name: string; email: string };
  organizationId: string;
  organizationName: string;
  role: string;
};

/**
 * The active workspace for this request, with membership verified against the database.
 * Falls back to the user's first workspace when none is active; sends users with none to onboarding.
 * Every dashboard query must filter by the returned organizationId.
 */
export const requireWorkspace = cache(async (): Promise<Workspace> => {
  const session = await requireUser();
  const userId = session.user.id;
  const activeId = session.session.activeOrganizationId ?? null;

  const rows = await db
    .select({ organizationId: member.organizationId, role: member.role, name: organization.name })
    .from(member)
    .innerJoin(organization, eq(organization.id, member.organizationId))
    .where(activeId ? and(eq(member.userId, userId), eq(member.organizationId, activeId)) : eq(member.userId, userId))
    .orderBy(asc(member.createdAt))
    .limit(1);

  let row = rows[0];
  if (!row && activeId) {
    // Active org is stale (removed from it); use any workspace they still belong to.
    [row] = await db
      .select({ organizationId: member.organizationId, role: member.role, name: organization.name })
      .from(member)
      .innerJoin(organization, eq(organization.id, member.organizationId))
      .where(eq(member.userId, userId))
      .orderBy(asc(member.createdAt))
      .limit(1);
  }
  if (!row) redirect("/onboarding");

  return {
    user: { id: userId, name: session.user.name, email: session.user.email },
    organizationId: row.organizationId,
    organizationName: row.name,
    role: row.role,
  };
});
