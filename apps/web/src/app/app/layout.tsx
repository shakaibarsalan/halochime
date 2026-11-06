import { and, count, eq } from "drizzle-orm";
import type { Metadata } from "next";
import { db } from "@/db";
import { handoffRequests, member } from "@/db/schema";
import { dashboardBrand } from "@/lib/branding/server";
import { requireWorkspace } from "@/lib/session";
import { Sidebar } from "./sidebar";

export const metadata: Metadata = { title: { default: "Dashboard", template: "%s · Halochime" } };

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const ws = await requireWorkspace();
  const [[open], [workspaces], brand] = await Promise.all([
    db
      .select({ n: count() })
      .from(handoffRequests)
      .where(and(eq(handoffRequests.organizationId, ws.organizationId), eq(handoffRequests.status, "open"))),
    db.select({ n: count() }).from(member).where(eq(member.userId, ws.user.id)),
    dashboardBrand(ws.organizationId),
  ]);
  return (
    <div className="min-h-dvh lg:flex">
      <Sidebar
        workspaceName={ws.organizationName}
        userEmail={ws.user.email}
        openHandoffs={open?.n ?? 0}
        brand={brand}
        showAgency={(workspaces?.n ?? 0) > 1}
      />
      <main className="min-w-0 flex-1">
        <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-10 lg:py-10">{children}</div>
      </main>
    </div>
  );
}
