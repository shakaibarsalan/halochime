import "server-only";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { safeNext } from "./safe-next";

/**
 * Sign-in and sign-up send people who are already signed in straight on: to `?next=` (e.g. an invite)
 * or the dashboard. The session is checked against the database, not just the cookie, so an expired or
 * revoked cookie shows the form instead of bouncing between here and /app.
 */
export async function redirectIfSignedIn(searchParams: Promise<{ next?: string | string[] }>): Promise<void> {
  const session = await getSession();
  if (!session) return;
  const { next } = await searchParams;
  redirect(safeNext(typeof next === "string" ? next : null, "/app"));
}
