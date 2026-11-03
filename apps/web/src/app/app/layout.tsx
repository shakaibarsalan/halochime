import { and, count, eq } from "drizzle-orm";
import type { Metadata } from "next";
import { db } from "@/db";
import { handoffRequests } from "@/db/schema";
import { requireWorkspace } from "@/lib/session";
import { Sidebar } from "./sidebar";

export const metadata: Metadata = { title: { default: "Dashboard", template: "%s · Halochime" } };

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const ws = await requireWorkspace();
  const [open] = await db
    .select({ n: count() })
    .from(handoffRequests)
    .where(and(eq(handoffRequests.organizationId, ws.organizationId), eq(handoffRequests.status, "open")));
  return (
    <div className="min-h-dvh lg:flex">
      <Sidebar workspaceName={ws.organizationName} userEmail={ws.user.email} openHandoffs={open?.n ?? 0} />
      <main className="min-w-0 flex-1">
        <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-10 lg:py-10">{children}</div>
      </main>
    </div>
  );
}
