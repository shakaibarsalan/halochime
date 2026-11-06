import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { workspaceBranding } from "@/db/schema";
import type { BrandingRow } from "./powered-by";

/** The workspace's widget "by ..." settings, or null (Halochime). Never throws: a failed read means Halochime. */
export async function brandingRow(organizationId: string): Promise<BrandingRow | null> {
  try {
    const [row] = await db
      .select({
        poweredBy: workspaceBranding.poweredBy,
        poweredByLabel: workspaceBranding.poweredByLabel,
        poweredByUrl: workspaceBranding.poweredByUrl,
      })
      .from(workspaceBranding)
      .where(eq(workspaceBranding.organizationId, organizationId))
      .limit(1);
    return row ?? null;
  } catch (e) {
    console.error("branding lookup failed, showing Halochime", e instanceof Error ? e.message : e);
    return null;
  }
}

export type DashboardBrand = { name: string; logoUrl: string | null };

/** The agency brand shown in this workspace's dashboard sidebar, or null (Halochime logo). */
export async function dashboardBrand(organizationId: string): Promise<DashboardBrand | null> {
  try {
    const [row] = await db
      .select({ brandName: workspaceBranding.brandName, logoVersion: workspaceBranding.logoVersion })
      .from(workspaceBranding)
      .where(eq(workspaceBranding.organizationId, organizationId))
      .limit(1);
    const name = row?.brandName?.trim();
    if (!row || !name) return null;
    return {
      name,
      logoUrl: row.logoVersion ? `/api/branding/logo?org=${encodeURIComponent(organizationId)}&v=${row.logoVersion}` : null,
    };
  } catch (e) {
    console.error("dashboard brand lookup failed", e instanceof Error ? e.message : e);
    return null;
  }
}
