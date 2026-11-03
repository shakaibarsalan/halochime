"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { CollectField, CollectFields } from "@talkfront/shared";
import type { ActionState } from "@/components/form-bits";
import { db } from "@/db";
import { agents } from "@/db/schema";
import { readCollectFields } from "@/lib/collect";
import { requireWorkspace } from "@/lib/session";
import { canManageIntegrations } from "./roles";

const Payload = z.object({
  agentId: z.string().trim().min(1).max(128),
  /** The list the browser started from; a different saved list means someone else changed it meanwhile. */
  base: z.array(z.unknown()).max(50),
  fields: z.array(z.unknown()).max(50),
  message: z.string().max(60),
});

const same = (a: CollectField[], b: CollectField[]) => JSON.stringify(a) === JSON.stringify(b);

function issueText(issue: z.core.$ZodIssue | undefined, fields: unknown[]): string {
  if (!issue) return "Please check the field.";
  const [i] = issue.path;
  const label = typeof i === "number" ? (fields[i] as { label?: unknown } | undefined)?.label : undefined;
  const prefix = typeof label === "string" && label.trim() ? `${label.trim().slice(0, 60)}: ` : "";
  return prefix + issue.message;
}

/** Saves the agent's whole list of custom fields (add, edit, delete and reorder all send the new list). */
export async function saveCollectFields(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ws = await requireWorkspace();
  if (!canManageIntegrations(ws.role)) return { error: "Only owners and admins can change what is collected." };

  let payload: z.infer<typeof Payload>;
  try {
    const parsed = Payload.safeParse(JSON.parse(String(formData.get("payload") ?? "")));
    if (!parsed.success) return { error: "Could not read the form. Reload the page and try again." };
    payload = parsed.data;
  } catch {
    return { error: "Could not read the form. Reload the page and try again." };
  }

  const fields = CollectFields.safeParse(payload.fields);
  if (!fields.success) return { error: issueText(fields.error.issues[0], payload.fields) };
  // Options only belong to choice fields, and keep the order they were typed in.
  const next: CollectField[] = fields.data.map((f) => ({
    key: f.key,
    label: f.label,
    description: f.description,
    type: f.type,
    ...(f.type === "choice" ? { options: f.options ?? [] } : {}),
    ask: f.ask,
  }));

  const [agent] = await db
    .select({ id: agents.id, collectFields: agents.collectFields })
    .from(agents)
    .where(and(eq(agents.id, payload.agentId), eq(agents.organizationId, ws.organizationId)))
    .limit(1);
  if (!agent) return { error: "Agent not found." };
  if (!same(readCollectFields(agent.collectFields), readCollectFields(payload.base))) {
    return { error: "Someone else changed these fields just now. Reload the page to see their changes." };
  }

  await db
    .update(agents)
    .set({ collectFields: next })
    .where(and(eq(agents.id, agent.id), eq(agents.organizationId, ws.organizationId)));
  revalidatePath(`/app/agents/${agent.id}`);
  return { ok: true, message: payload.message || "Saved." };
}
