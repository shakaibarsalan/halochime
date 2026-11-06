"use server";

import { and, count, eq, gt } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionState } from "@/components/form-bits";
import { db } from "@/db";
import { agents, agentTestCases, agentTestRuns, agentVersions } from "@/db/schema";
import { canAnswer, canJudge } from "@/lib/agent-tests/models";
import { executeRun } from "@/lib/agent-tests/run";
import { MAX_TEST_CASES, runsPerDay, STALE_RUN_MS } from "@/lib/agent-tests/limits";
import { requireWorkspace } from "@/lib/session";
import { readSnapshot } from "@/lib/versions/snapshot";
import { canManageIntegrations } from "../roles";

// Test runs cost model calls, so only owners and admins write tests and run them.

async function manager() {
  const ws = await requireWorkspace();
  return canManageIntegrations(ws.role) ? ws : null;
}

async function ownAgent(agentId: string, organizationId: string) {
  const [agent] = await db
    .select()
    .from(agents)
    .where(and(eq(agents.id, agentId), eq(agents.organizationId, organizationId)))
    .limit(1);
  return agent ?? null;
}

const CaseInput = z.object({
  agentId: z.string().min(1).max(100),
  question: z.string().trim().min(3, "Write the visitor's question.").max(1000, "Keep the question under 1,000 characters."),
  mustSay: z.string().trim().max(1000, "Keep it under 1,000 characters."),
  mustNotSay: z.string().trim().max(1000, "Keep it under 1,000 characters."),
});

export async function addTestCase(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ws = await manager();
  if (!ws) return { error: "Only owners and admins can change tests." };
  const parsed = CaseInput.safeParse({
    agentId: formData.get("agentId"),
    question: formData.get("question") ?? "",
    mustSay: formData.get("mustSay") ?? "",
    mustNotSay: formData.get("mustNotSay") ?? "",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form." };
  const f = parsed.data;
  if (!f.mustSay && !f.mustNotSay) return { error: "Say what a good answer must say, or must not say." };
  if (!(await ownAgent(f.agentId, ws.organizationId))) return { error: "Agent not found." };

  const [{ n } = { n: 0 }] = await db
    .select({ n: count() })
    .from(agentTestCases)
    .where(and(eq(agentTestCases.agentId, f.agentId), eq(agentTestCases.organizationId, ws.organizationId)));
  if (n >= MAX_TEST_CASES) return { error: `Up to ${MAX_TEST_CASES} test questions per agent.` };

  await db.insert(agentTestCases).values({
    organizationId: ws.organizationId,
    agentId: f.agentId,
    question: f.question,
    mustSay: f.mustSay,
    mustNotSay: f.mustNotSay,
  });
  revalidatePath(`/app/agents/${f.agentId}/tests`);
  return { ok: true, message: "Test question added." };
}

const DeleteInput = z.object({ agentId: z.string().min(1).max(100), caseId: z.string().min(1).max(100) });

export async function deleteTestCase(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ws = await manager();
  if (!ws) return { error: "Only owners and admins can change tests." };
  const parsed = DeleteInput.safeParse({ agentId: formData.get("agentId"), caseId: formData.get("caseId") });
  if (!parsed.success) return { error: "Test not found." };
  const gone = await db
    .delete(agentTestCases)
    .where(
      and(
        eq(agentTestCases.id, parsed.data.caseId),
        eq(agentTestCases.agentId, parsed.data.agentId),
        eq(agentTestCases.organizationId, ws.organizationId),
      ),
    )
    .returning({ id: agentTestCases.id });
  if (gone.length === 0) return { error: "Test not found." };
  revalidatePath(`/app/agents/${parsed.data.agentId}/tests`);
  return { ok: true, message: "Test question removed." };
}

const RunInput = z.object({ agentId: z.string().min(1).max(100), versionId: z.string().max(100) });

export async function runTests(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ws = await manager();
  if (!ws) return { error: "Only owners and admins can run tests." };
  const parsed = RunInput.safeParse({ agentId: formData.get("agentId"), versionId: formData.get("versionId") ?? "" });
  if (!parsed.success) return { error: "Agent not found." };
  const { agentId, versionId } = parsed.data;
  if (!canAnswer() || !canJudge()) return { error: "Tests need a model key on the server (Groq, OpenAI or Anthropic)." };

  const agent = await ownAgent(agentId, ws.organizationId);
  if (!agent) return { error: "Agent not found." };

  let version: { id: string; name: string; snapshot: unknown } | null = null;
  if (versionId) {
    const [v] = await db
      .select({ id: agentVersions.id, name: agentVersions.name, snapshot: agentVersions.snapshot })
      .from(agentVersions)
      .where(and(eq(agentVersions.id, versionId), eq(agentVersions.agentId, agentId), eq(agentVersions.organizationId, ws.organizationId)))
      .limit(1);
    if (!v) return { error: "Version not found." };
    version = v;
  }

  const [{ n: cases } = { n: 0 }] = await db
    .select({ n: count() })
    .from(agentTestCases)
    .where(and(eq(agentTestCases.agentId, agentId), eq(agentTestCases.organizationId, ws.organizationId)));
  if (cases === 0) return { error: "Add a test question first." };

  // Counted in the database, so the cap holds across server instances. Failed runs count too.
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [[{ n: today } = { n: 0 }], [busy]] = await Promise.all([
    db
      .select({ n: count() })
      .from(agentTestRuns)
      .where(and(eq(agentTestRuns.organizationId, ws.organizationId), gt(agentTestRuns.createdAt, dayAgo))),
    db
      .select({ id: agentTestRuns.id })
      .from(agentTestRuns)
      .where(
        and(
          eq(agentTestRuns.agentId, agentId),
          eq(agentTestRuns.status, "running"),
          gt(agentTestRuns.createdAt, new Date(Date.now() - STALE_RUN_MS)),
        ),
      )
      .limit(1),
  ]);
  const cap = runsPerDay();
  if (today >= cap) return { error: `That's the ${cap} test runs for today in this workspace. You can run more tomorrow.` };
  if (busy) return { error: "Tests for this agent are already running. Wait for them to finish." };

  const [run] = await db
    .insert(agentTestRuns)
    .values({
      organizationId: ws.organizationId,
      agentId,
      versionId: version?.id ?? null,
      versionName: version?.name ?? null,
      startedBy: ws.user.id,
    })
    .returning({ id: agentTestRuns.id });

  await executeRun(run!.id, agent, version ? readSnapshot(version.snapshot, agent) : null);

  const [done] = await db
    .select({ status: agentTestRuns.status, total: agentTestRuns.total, passed: agentTestRuns.passed, error: agentTestRuns.error })
    .from(agentTestRuns)
    .where(eq(agentTestRuns.id, run!.id))
    .limit(1);
  revalidatePath(`/app/agents/${agentId}/tests`);
  if (!done || done.status === "failed") return { error: done?.error ?? "The run failed. Try again." };
  return { ok: true, message: `${done.passed} of ${done.total} passed.` };
}
