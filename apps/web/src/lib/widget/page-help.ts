import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { agentPageHelp } from "@/db/schema";
import { readPageHelp, type PageHelpSettings } from "../page-help";

/** The agent's page help settings (both features off when nothing is saved). */
export async function loadPageHelp(agentId: string): Promise<PageHelpSettings> {
  const [row] = await db
    .select({ proactive: agentPageHelp.proactive, pageGuide: agentPageHelp.pageGuide })
    .from(agentPageHelp)
    .where(eq(agentPageHelp.agentId, agentId))
    .limit(1);
  return readPageHelp(row);
}
