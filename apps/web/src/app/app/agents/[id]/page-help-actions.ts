"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ProactiveHelpSettings } from "@talkfront/shared";
import type { ActionState } from "@/components/form-bits";
import { db } from "@/db";
import { agentPageHelp, agents } from "@/db/schema";
import { requireWorkspace } from "@/lib/session";
import { canManageIntegrations } from "./roles";

const Payload = z.object({
  agentId: z.string().trim().min(1).max(128),
  proactive: z.unknown(),
  pageGuide: z.boolean(),
});

/** Saves the agent's page help settings (proactive help bubble and page guide). Owners and admins only. */
export async function savePageHelp(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ws = await requireWorkspace();
  if (!canManageIntegrations(ws.role)) return { error: "Only owners and admins can change page help." };

  let payload: z.infer<typeof Payload>;
  try {
    const parsed = Payload.safeParse(JSON.parse(String(formData.get("payload") ?? "")));
    if (!parsed.success) return { error: "Could not read the form. Reload the page and try again." };
    payload = parsed.data;
  } catch {
    return { error: "Could not read the form. Reload the page and try again." };
  }

  const proactive = ProactiveHelpSettings.safeParse(payload.proactive);
  if (!proactive.success) {
    const issue = proactive.error.issues[0];
    const rule = issue?.path[0] === "rules" && typeof issue.path[1] === "number" ? `Rule ${issue.path[1] + 1}: ` : "";
    return { error: rule + (issue?.message ?? "Please check the form.") };
  }
  // "Any page" rules keep no path.
  const value = {
    ...proactive.data,
    rules: proactive.data.rules.map((r) => ({ ...r, path: r.match === "any" ? "" : r.path })),
  };

  const [agent] = await db
    .select({ id: agents.id })
    .from(agents)
    .where(and(eq(agents.id, payload.agentId), eq(agents.organizationId, ws.organizationId)))
    .limit(1);
  if (!agent) return { error: "Agent not found." };

  await db
    .insert(agentPageHelp)
    .values({ agentId: agent.id, organizationId: ws.organizationId, proactive: value, pageGuide: payload.pageGuide })
    .onConflictDoUpdate({
      target: agentPageHelp.agentId,
      set: { proactive: value, pageGuide: payload.pageGuide, updatedAt: new Date() },
    });
  revalidatePath(`/app/agents/${agent.id}`);
  return { ok: true, message: "Page help saved." };
}
