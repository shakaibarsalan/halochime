import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { member } from "@/db/schema";

/** Whether the user already owns a workspace. Only their first own workspace gets the free trial. */
export async function ownsWorkspace(userId: string): Promise<boolean> {
  const rows = await db
    .select({ id: member.id })
    .from(member)
    .where(and(eq(member.userId, userId), eq(member.role, "owner")))
    .limit(1);
  return rows.length > 0;
}

/** Whether the user belongs to any workspace (owner or not). */
export async function hasWorkspace(userId: string): Promise<boolean> {
  const rows = await db.select({ id: member.id }).from(member).where(eq(member.userId, userId)).limit(1);
  return rows.length > 0;
}
