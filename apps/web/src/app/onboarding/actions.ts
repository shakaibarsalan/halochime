"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { agents, TRIAL_SECONDS, trialGrants, usageEvents, wallets } from "@/db/schema";
import type { ActionState } from "@/components/form-bits";
import { newAgentValues } from "@/lib/agent-defaults";
import { getAuth } from "@/lib/auth";
import { randomUrlSafe } from "@/lib/ids";
import { requireUser } from "@/lib/session";
import { hadTrial, ownsWorkspace } from "@/lib/workspaces";

const Input = z.object({ name: z.string().trim().min(2, "Use at least 2 characters.").max(80) });

function slugify(name: string) {
  const base = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `${base || "workspace"}-${randomUrlSafe(6).toLowerCase().replace(/[^a-z0-9]/g, "x")}`;
}

export async function createWorkspace(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireUser();
  const parsed = Input.safeParse({ name: formData.get("name") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid name." };
  const name = parsed.data.name;

  // Checked before the new workspace exists (the user becomes its owner). trial_grants remembers trials of
  // deleted workspaces; owning a workspace covers trials given before that table existed.
  const [owns, hadOne] = await Promise.all([ownsWorkspace(session.user.id), hadTrial(session.user.id)]);
  const eligible = !owns && !hadOne;
  const auth = getAuth();
  const h = await headers();
  let organizationId: string;
  try {
    const org = await auth.api.createOrganization({ body: { name, slug: slugify(name) }, headers: h });
    if (!org) return { error: "Could not create the workspace." };
    organizationId = org.id;
  } catch (err) {
    console.error("createOrganization failed", err);
    return { error: "Could not create the workspace. Please try again." };
  }

  // Wallet (with the free trial on a first own workspace), its ledger row, and a first agent, all or nothing.
  const agentId = await db.transaction(async (tx) => {
    // Claiming the grant decides: of two workspaces made at the same moment, only one gets the trial.
    const trial =
      eligible &&
      (
        await tx
          .insert(trialGrants)
          .values({ userId: session.user.id, organizationId })
          .onConflictDoNothing()
          .returning({ userId: trialGrants.userId })
      ).length > 0;
    await tx.insert(wallets).values({ organizationId, balanceSeconds: trial ? TRIAL_SECONDS : 0 }).onConflictDoNothing();
    if (trial) {
      await tx.insert(usageEvents).values({
        organizationId,
        kind: "trial",
        seconds: TRIAL_SECONDS,
        note: `Free trial: ${TRIAL_SECONDS / 60} minutes`,
      });
    }
    const [agent] = await tx.insert(agents).values(newAgentValues(organizationId, name)).returning({ id: agents.id });
    return agent!.id;
  });

  await auth.api.setActiveOrganization({ body: { organizationId }, headers: h });
  redirect(`/app/agents/${agentId}`);
}
