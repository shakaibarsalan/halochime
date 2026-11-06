import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { agentChannels } from "@/db/schema";
import { deletePhoneRouting } from "./livekit-sip";
import { phoneConfig } from "./store";

/**
 * Before a workspace is deleted: remove its phone numbers' trunks and dispatch rules from LiveKit (the
 * rows go with the workspace by cascade, LiveKit would keep routing calls). Best effort, never throws:
 * a leftover trunk only sends calls to the agent, which then finds no channel and hangs up.
 */
export async function removeWorkspaceChannels(organizationId: string): Promise<void> {
  try {
    const rows = await db
      .select()
      .from(agentChannels)
      .where(and(eq(agentChannels.organizationId, organizationId), eq(agentChannels.kind, "phone")));
    for (const row of rows) {
      await deletePhoneRouting(phoneConfig(row)).catch((e) =>
        console.error(`could not remove LiveKit phone routing of channel ${row.id}`, e instanceof Error ? e.message : e),
      );
    }
  } catch (e) {
    console.error("channel cleanup before workspace delete failed", e instanceof Error ? e.message : e);
  }
}
