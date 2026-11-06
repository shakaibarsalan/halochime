import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { agentAbTests, agentVersions, conversations } from "@/db/schema";
import { EMPTY_COUNTS, type ArmCounts } from "./results";
import { readSnapshot, type AgentSnapshot, type SnapshotSource } from "./snapshot";
import { assignArm } from "./split";

export type RunningTest = {
  id: string;
  splitB: number;
  a: { id: string; name: string; snapshot: unknown };
  b: { id: string; name: string; snapshot: unknown };
};

const versionA = alias(agentVersions, "version_a");
const versionB = alias(agentVersions, "version_b");

/** The agent's running A/B test with both versions, or null. One indexed lookup. */
export async function runningTestFor(agentId: string, organizationId: string): Promise<RunningTest | null> {
  const [row] = await db
    .select({
      id: agentAbTests.id,
      splitB: agentAbTests.splitB,
      aId: versionA.id,
      aName: versionA.name,
      aSnapshot: versionA.snapshot,
      bId: versionB.id,
      bName: versionB.name,
      bSnapshot: versionB.snapshot,
    })
    .from(agentAbTests)
    .innerJoin(versionA, and(eq(versionA.id, agentAbTests.versionAId), eq(versionA.agentId, agentAbTests.agentId)))
    .innerJoin(versionB, and(eq(versionB.id, agentAbTests.versionBId), eq(versionB.agentId, agentAbTests.agentId)))
    .where(
      and(
        eq(agentAbTests.agentId, agentId),
        eq(agentAbTests.organizationId, organizationId),
        eq(agentAbTests.status, "running"),
      ),
    )
    .limit(1);
  if (!row) return null;
  return {
    id: row.id,
    splitB: row.splitB,
    a: { id: row.aId, name: row.aName, snapshot: row.aSnapshot },
    b: { id: row.bId, name: row.bName, snapshot: row.bSnapshot },
  };
}

export type PickedVersion = { testId: string; versionId: string; snapshot: AgentSnapshot };

/**
 * The version this visitor gets while the agent runs an A/B test, or null (no test: the agent's own
 * settings, exactly as before). Never throws: a failed lookup means the agent's own settings.
 */
export async function pickVersion(
  agent: SnapshotSource & { id: string; organizationId: string },
  visitorKey: string,
): Promise<PickedVersion | null> {
  try {
    const test = await runningTestFor(agent.id, agent.organizationId);
    if (!test) return null;
    const v = assignArm(test.id, visitorKey, test.splitB) === "b" ? test.b : test.a;
    return { testId: test.id, versionId: v.id, snapshot: readSnapshot(v.snapshot, agent) };
  } catch (e) {
    console.error("A/B version lookup failed, using the agent's own settings", e instanceof Error ? e.message : e);
    return null;
  }
}

/** The saved snapshot of a conversation's version (scoped to its agent), or null. */
export async function conversationSnapshot(
  versionId: string | null,
  agent: SnapshotSource & { id: string; organizationId: string },
): Promise<AgentSnapshot | null> {
  if (!versionId) return null;
  const [v] = await db
    .select({ snapshot: agentVersions.snapshot })
    .from(agentVersions)
    .where(
      and(
        eq(agentVersions.id, versionId),
        eq(agentVersions.agentId, agent.id),
        eq(agentVersions.organizationId, agent.organizationId),
      ),
    )
    .limit(1);
  return v ? readSnapshot(v.snapshot, agent) : null;
}

/** Snapshots of the versions in the agent's running test (for checking a greeting audio URL). */
export async function runningTestSnapshots(agent: SnapshotSource & { id: string; organizationId: string }): Promise<AgentSnapshot[]> {
  const test = await runningTestFor(agent.id, agent.organizationId);
  if (!test) return [];
  return [test.a, test.b].map((v) => readSnapshot(v.snapshot, agent));
}

/** Counts per version for some A/B tests of one workspace: test id -> version id -> counts. */
export async function loadTestResults(organizationId: string, testIds: string[]): Promise<Map<string, Map<string, ArmCounts>>> {
  const out = new Map<string, Map<string, ArmCounts>>();
  if (testIds.length === 0) return out;
  const rows = await db
    .select({
      testId: conversations.abTestId,
      versionId: conversations.agentVersionId,
      conversations: sql<number>`count(*)::int`,
      withOutcome: sql<number>`(count(*) filter (where ${conversations.collectedData}->>'outcome' is not null))::int`,
      answered: sql<number>`(count(*) filter (where ${conversations.collectedData}->>'outcome' = 'answered'))::int`,
      ended: sql<number>`(count(*) filter (where ${conversations.status} = 'ended'))::int`,
      totalSeconds: sql<number>`(coalesce(sum(${conversations.durationSec}) filter (where ${conversations.status} = 'ended'), 0))::int`,
      totalMessages: sql<number>`(coalesce(sum((select count(*) from messages m where m.conversation_id = ${conversations.id} and m.role in ('user', 'assistant'))), 0))::int`,
      positive: sql<number>`(count(*) filter (where ${conversations.collectedData}->>'sentiment' = 'positive'))::int`,
      neutral: sql<number>`(count(*) filter (where ${conversations.collectedData}->>'sentiment' = 'neutral'))::int`,
      negative: sql<number>`(count(*) filter (where ${conversations.collectedData}->>'sentiment' = 'negative'))::int`,
    })
    .from(conversations)
    .where(and(eq(conversations.organizationId, organizationId), inArray(conversations.abTestId, testIds)))
    .groupBy(conversations.abTestId, conversations.agentVersionId);
  for (const r of rows) {
    if (!r.testId || !r.versionId) continue;
    const perTest = out.get(r.testId) ?? new Map<string, ArmCounts>();
    perTest.set(r.versionId, {
      ...EMPTY_COUNTS,
      conversations: Number(r.conversations),
      withOutcome: Number(r.withOutcome),
      answered: Number(r.answered),
      ended: Number(r.ended),
      totalSeconds: Number(r.totalSeconds),
      totalMessages: Number(r.totalMessages),
      positive: Number(r.positive),
      neutral: Number(r.neutral),
      negative: Number(r.negative),
    });
    out.set(r.testId, perTest);
  }
  return out;
}
