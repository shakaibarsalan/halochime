"use server";

import { and, count, eq, or } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionState } from "@/components/form-bits";
import { db } from "@/db";
import { agentAbTests, agents, agentVersions } from "@/db/schema";
import { requireWorkspace } from "@/lib/session";
import { changedKeys, readSnapshot, snapshotFromAgent, snapshotUpdate } from "@/lib/versions/snapshot";
import { canManageIntegrations } from "../roles";

// Saved versions and A/B tests change what live visitors hear, so owners and admins only.

const MAX_VERSIONS_PER_AGENT = 50;

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function manager() {
  const ws = await requireWorkspace();
  return canManageIntegrations(ws.role) ? ws : null;
}

const paths = (agentId: string) => {
  revalidatePath(`/app/agents/${agentId}`);
  revalidatePath(`/app/agents/${agentId}/versions`);
};

async function loadAgent(tx: Tx | typeof db, agentId: string, organizationId: string) {
  const [agent] = await tx
    .select()
    .from(agents)
    .where(and(eq(agents.id, agentId), eq(agents.organizationId, organizationId)))
    .limit(1);
  return agent ?? null;
}

const SaveInput = z.object({
  agentId: z.string().min(1).max(100),
  name: z.string().trim().min(1, "Give the version a name.").max(80, "Use at most 80 characters."),
});

export async function saveVersion(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ws = await manager();
  if (!ws) return { error: "Only owners and admins can save versions." };
  const parsed = SaveInput.safeParse({ agentId: formData.get("agentId"), name: formData.get("name") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form." };
  const { agentId, name } = parsed.data;

  const agent = await loadAgent(db, agentId, ws.organizationId);
  if (!agent) return { error: "Agent not found." };
  const [{ n } = { n: 0 }] = await db
    .select({ n: count() })
    .from(agentVersions)
    .where(and(eq(agentVersions.agentId, agentId), eq(agentVersions.organizationId, ws.organizationId)));
  if (n >= MAX_VERSIONS_PER_AGENT) return { error: `Up to ${MAX_VERSIONS_PER_AGENT} versions per agent. Delete an old one first.` };

  await db.insert(agentVersions).values({
    organizationId: ws.organizationId,
    agentId,
    name,
    snapshot: snapshotFromAgent(agent),
    createdBy: ws.user.id,
  });
  paths(agentId);
  return { ok: true, message: `Saved as "${name}".` };
}

const VersionInput = z.object({ agentId: z.string().min(1).max(100), versionId: z.string().min(1).max(100) });

/**
 * Puts a version's setup back on the agent. The current setup is saved first as its own version
 * (unless it already matches), so a restore never loses work.
 */
export async function restoreVersion(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ws = await manager();
  if (!ws) return { error: "Only owners and admins can restore versions." };
  const parsed = VersionInput.safeParse({ agentId: formData.get("agentId"), versionId: formData.get("versionId") });
  if (!parsed.success) return { error: "Version not found." };
  const { agentId, versionId } = parsed.data;

  const result = await db.transaction(async (tx) => {
    const agent = await loadAgent(tx, agentId, ws.organizationId);
    if (!agent) return { error: "Agent not found." };
    const [version] = await tx
      .select()
      .from(agentVersions)
      .where(and(eq(agentVersions.id, versionId), eq(agentVersions.agentId, agentId), eq(agentVersions.organizationId, ws.organizationId)))
      .limit(1);
    if (!version) return { error: "Version not found." };
    const target = readSnapshot(version.snapshot, agent);
    if (changedKeys(snapshotFromAgent(agent), target).length === 0) {
      return { ok: true, message: `The agent already uses "${version.name}".` };
    }
    await keepCurrentSetup(tx, agent, ws.organizationId, ws.user.id, `Before restoring ${version.name}`);
    await tx
      .update(agents)
      .set(snapshotUpdate(target))
      .where(and(eq(agents.id, agentId), eq(agents.organizationId, ws.organizationId)));
    return { ok: true, message: `Restored "${version.name}". The previous setup was saved as a version.` };
  });
  paths(agentId);
  revalidatePath("/app/agents");
  return result;
}

/** Saves the agent's current setup as a version, unless a saved version already matches it. */
async function keepCurrentSetup(
  tx: Tx,
  agent: typeof agents.$inferSelect,
  organizationId: string,
  userId: string,
  name: string,
): Promise<void> {
  const current = snapshotFromAgent(agent);
  const saved = await tx
    .select({ snapshot: agentVersions.snapshot })
    .from(agentVersions)
    .where(and(eq(agentVersions.agentId, agent.id), eq(agentVersions.organizationId, organizationId)));
  if (saved.some((v) => changedKeys(readSnapshot(v.snapshot, agent), current).length === 0)) return;
  await tx.insert(agentVersions).values({
    organizationId,
    agentId: agent.id,
    name: name.slice(0, 80),
    snapshot: current,
    createdBy: userId,
  });
}

export async function deleteVersion(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ws = await manager();
  if (!ws) return { error: "Only owners and admins can delete versions." };
  const parsed = VersionInput.safeParse({ agentId: formData.get("agentId"), versionId: formData.get("versionId") });
  if (!parsed.success) return { error: "Version not found." };
  const { agentId, versionId } = parsed.data;

  // A version used by an A/B test keeps its results readable, so it stays.
  const [used] = await db
    .select({ id: agentAbTests.id })
    .from(agentAbTests)
    .where(
      and(
        eq(agentAbTests.organizationId, ws.organizationId),
        eq(agentAbTests.agentId, agentId),
        or(eq(agentAbTests.versionAId, versionId), eq(agentAbTests.versionBId, versionId)),
      ),
    )
    .limit(1);
  if (used) return { error: "This version was used in an A/B test, so it is kept with the test's results." };

  const gone = await db
    .delete(agentVersions)
    .where(and(eq(agentVersions.id, versionId), eq(agentVersions.agentId, agentId), eq(agentVersions.organizationId, ws.organizationId)))
    .returning({ id: agentVersions.id });
  if (gone.length === 0) return { error: "Version not found." };
  paths(agentId);
  return { ok: true, message: "Version deleted." };
}

// ---------------------------------------------------------------------------
// A/B tests

const StartInput = z
  .object({
    agentId: z.string().min(1).max(100),
    versionAId: z.string().min(1, "Choose version A.").max(100),
    versionBId: z.string().min(1, "Choose version B.").max(100),
    splitB: z.coerce.number().int("Use a whole number.").min(1, "Send at least 1% to version B.").max(99, "Keep at least 1% on version A."),
  })
  .refine((v) => v.versionAId !== v.versionBId, { message: "Choose two different versions." });

export async function startAbTest(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ws = await manager();
  if (!ws) return { error: "Only owners and admins can start A/B tests." };
  const parsed = StartInput.safeParse({
    agentId: formData.get("agentId"),
    versionAId: formData.get("versionAId") ?? "",
    versionBId: formData.get("versionBId") ?? "",
    splitB: formData.get("splitB"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form." };
  const { agentId, versionAId, versionBId, splitB } = parsed.data;

  const agent = await loadAgent(db, agentId, ws.organizationId);
  if (!agent) return { error: "Agent not found." };
  const versions = await db
    .select({ id: agentVersions.id })
    .from(agentVersions)
    .where(
      and(
        eq(agentVersions.agentId, agentId),
        eq(agentVersions.organizationId, ws.organizationId),
        or(eq(agentVersions.id, versionAId), eq(agentVersions.id, versionBId)),
      ),
    );
  if (versions.length !== 2) return { error: "Version not found." };

  try {
    await db.insert(agentAbTests).values({
      organizationId: ws.organizationId,
      agentId,
      versionAId,
      versionBId,
      splitB,
      startedBy: ws.user.id,
    });
  } catch (e) {
    // The one-running-test-per-agent index: someone started one at the same time.
    console.warn("start A/B test refused", e instanceof Error ? e.message : e);
    return { error: "This agent already runs an A/B test. End it first." };
  }
  paths(agentId);
  return { ok: true, message: "A/B test started. New conversations now get version A or B." };
}

const EndInput = z.object({
  agentId: z.string().min(1).max(100),
  testId: z.string().min(1).max(100),
  /** The version to keep, or "none" to stop without changing the agent. */
  keep: z.string().min(1).max(100),
});

/** Ends the running test. Keeping a version puts its setup on the agent (current setup saved first). */
export async function endAbTest(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ws = await manager();
  if (!ws) return { error: "Only owners and admins can end A/B tests." };
  const parsed = EndInput.safeParse({ agentId: formData.get("agentId"), testId: formData.get("testId"), keep: formData.get("keep") });
  if (!parsed.success) return { error: "Test not found." };
  const { agentId, testId, keep } = parsed.data;

  const result = await db.transaction(async (tx) => {
    const [test] = await tx
      .select()
      .from(agentAbTests)
      .where(
        and(
          eq(agentAbTests.id, testId),
          eq(agentAbTests.agentId, agentId),
          eq(agentAbTests.organizationId, ws.organizationId),
          eq(agentAbTests.status, "running"),
        ),
      )
      .for("update")
      .limit(1);
    if (!test) return { error: "This test has already ended." };
    if (keep !== "none" && keep !== test.versionAId && keep !== test.versionBId) return { error: "Choose version A or B." };

    let message = "Test ended. The agent keeps its current setup.";
    if (keep !== "none") {
      const agent = await loadAgent(tx, agentId, ws.organizationId);
      const [winner] = await tx
        .select()
        .from(agentVersions)
        .where(and(eq(agentVersions.id, keep), eq(agentVersions.agentId, agentId), eq(agentVersions.organizationId, ws.organizationId)))
        .limit(1);
      if (!agent || !winner) return { error: "Version not found." };
      const target = readSnapshot(winner.snapshot, agent);
      if (changedKeys(snapshotFromAgent(agent), target).length > 0) {
        await keepCurrentSetup(tx, agent, ws.organizationId, ws.user.id, `Before keeping ${winner.name}`);
        await tx
          .update(agents)
          .set(snapshotUpdate(target))
          .where(and(eq(agents.id, agentId), eq(agents.organizationId, ws.organizationId)));
      }
      message = `Test ended. The agent now uses "${winner.name}" for everyone.`;
    }
    await tx
      .update(agentAbTests)
      .set({ status: "ended", endedAt: new Date(), winnerVersionId: keep === "none" ? null : keep })
      .where(eq(agentAbTests.id, test.id));
    return { ok: true, message };
  });
  paths(agentId);
  revalidatePath("/app/agents");
  return result;
}
