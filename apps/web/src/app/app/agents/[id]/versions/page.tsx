import { and, desc, eq } from "drizzle-orm";
import { FlaskConical, History, Info } from "lucide-react";
import { notFound } from "next/navigation";
import { Badge, Card, CardHeader, EmptyState, PageHeader, Table, Td, Th, Tr, Truncate } from "@/components/ui";
import { db } from "@/db";
import { agentAbTests, agents, agentVersions, user } from "@/db/schema";
import { formatDateTime, formatDuration } from "@/lib/format";
import { requireWorkspace } from "@/lib/session";
import { armStats, EMPTY_COUNTS, leader, MIN_FOR_LEADER, percent, type ArmCounts } from "@/lib/versions/results";
import { loadTestResults } from "@/lib/versions/server";
import { changedKeys, readSnapshot, SNAPSHOT_LABELS, snapshotFromAgent, type AgentSnapshot } from "@/lib/versions/snapshot";
import { canManageIntegrations } from "../roles";
import { EndTestButtons, SaveVersionForm, StartTestForm, VersionRowActions } from "./forms";

export const metadata = { title: "Versions" };

const PAST_TESTS = 10;

export default async function VersionsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { organizationId, role } = await requireWorkspace();
  const [agent] = await db
    .select()
    .from(agents)
    .where(and(eq(agents.id, id), eq(agents.organizationId, organizationId)))
    .limit(1);
  if (!agent) notFound();
  const canManage = canManageIntegrations(role);

  const [versions, tests] = await Promise.all([
    db
      .select({
        id: agentVersions.id,
        name: agentVersions.name,
        snapshot: agentVersions.snapshot,
        createdAt: agentVersions.createdAt,
        createdBy: user.name,
      })
      .from(agentVersions)
      .leftJoin(user, eq(user.id, agentVersions.createdBy))
      .where(and(eq(agentVersions.agentId, agent.id), eq(agentVersions.organizationId, organizationId)))
      .orderBy(desc(agentVersions.createdAt)),
    db
      .select()
      .from(agentAbTests)
      .where(and(eq(agentAbTests.agentId, agent.id), eq(agentAbTests.organizationId, organizationId)))
      .orderBy(desc(agentAbTests.startedAt))
      .limit(PAST_TESTS + 1),
  ]);
  const results = await loadTestResults(
    organizationId,
    tests.map((t) => t.id),
  );

  const current = snapshotFromAgent(agent);
  const byId = new Map(versions.map((v) => [v.id, { ...v, snapshot: readSnapshot(v.snapshot, agent) }]));
  const running = tests.find((t) => t.status === "running") ?? null;
  const past = tests.filter((t) => t.status === "ended").slice(0, PAST_TESTS);
  const nameOf = (vid: string | null) => (vid ? (byId.get(vid)?.name ?? "Deleted version") : "-");
  const countsOf = (testId: string, vid: string): ArmCounts => results.get(testId)?.get(vid) ?? EMPTY_COUNTS;

  return (
    <>
      <PageHeader
        title="Versions and A/B tests"
        back={{ href: `/app/agents/${agent.id}`, label: agent.name }}
        description="Save how the agent talks as a named version, put an old one back, or let two versions share visitors and compare them."
      />

      <div className="space-y-6">
        {running ? (
          <Card>
            <CardHeader
              title="A/B test running"
              icon={FlaskConical}
              description={`Since ${formatDateTime(running.startedAt)}. ${100 - running.splitB}% of visitors get A, ${running.splitB}% get B, and each visitor keeps theirs.`}
              action={<Badge tone="green" dot>Running</Badge>}
            />
            <ResultsTable
              rows={[
                { arm: "A", name: nameOf(running.versionAId), counts: countsOf(running.id, running.versionAId) },
                { arm: "B", name: nameOf(running.versionBId), counts: countsOf(running.id, running.versionBId) },
              ]}
            />
            <div className="space-y-3 border-t border-slate-100 p-5">
              <LeaderNote a={countsOf(running.id, running.versionAId)} b={countsOf(running.id, running.versionBId)} />
              {canManage ? (
                <EndTestButtons
                  agentId={agent.id}
                  testId={running.id}
                  a={{ id: running.versionAId, name: nameOf(running.versionAId) }}
                  b={{ id: running.versionBId, name: nameOf(running.versionBId) }}
                  suggested={leader(countsOf(running.id, running.versionAId), countsOf(running.id, running.versionBId))}
                />
              ) : (
                <p className="text-xs text-slate-500">Only owners and admins can end the test.</p>
              )}
              <p className="flex items-start gap-2 text-xs leading-5 text-slate-500">
                <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                While the test runs, changes you save on the agent page do not reach test conversations: they use the
                two saved versions. Actions, collected fields, limits and the widget look are shared by both.
              </p>
            </div>
          </Card>
        ) : canManage ? (
          <Card>
            <CardHeader
              title="Start an A/B test"
              icon={FlaskConical}
              description="New conversations are split between two saved versions. Each visitor keeps the same version until the test ends."
            />
            <div className="p-5">
              <StartTestForm agentId={agent.id} versions={versions.map((v) => ({ id: v.id, name: v.name }))} />
            </div>
          </Card>
        ) : null}

        <Card>
          <CardHeader
            title="Saved versions"
            icon={History}
            description="A version keeps the greeting, persona, business rules, language, voice and models."
          />
          {canManage ? (
            <div className="border-b border-slate-100 p-5">
              <SaveVersionForm agentId={agent.id} disabled={false} />
            </div>
          ) : null}
          {versions.length === 0 ? (
            <EmptyState title="No versions yet" icon={History}>
              {canManage ? "Save the current setup to keep a copy you can come back to." : "Owners and admins can save versions."}
            </EmptyState>
          ) : (
            <Table minWidth={canManage ? 720 : 560}>
              <thead>
                <tr>
                  <Th>Name</Th>
                  <Th>Differs from now</Th>
                  <Th>Saved</Th>
                  {canManage ? (
                    <Th className="text-right">
                      <span className="sr-only">Actions</span>
                    </Th>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {[...byId.values()].map((v) => (
                  <Tr key={v.id}>
                    <Td>
                      <Truncate text={v.name} className="max-w-56 font-medium text-slate-900" />
                      <VersionDetails snapshot={v.snapshot} />
                    </Td>
                    <Td>
                      <Differences now={current} saved={v.snapshot} />
                    </Td>
                    <Td className="whitespace-nowrap">
                      <span className="block">{formatDateTime(v.createdAt)}</span>
                      {v.createdBy ? <Truncate text={`by ${v.createdBy}`} className="max-w-40 text-xs text-slate-500" /> : null}
                    </Td>
                    {canManage ? (
                      <Td className="text-right">
                        <VersionRowActions agentId={agent.id} versionId={v.id} name={v.name} />
                      </Td>
                    ) : null}
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>

        {past.length > 0 ? (
          <Card>
            <CardHeader title="Past A/B tests" icon={FlaskConical} description="Results stay here after a test ends." />
            <div className="divide-y divide-slate-100">
              {past.map((t) => (
                <div key={t.id}>
                  <div className="flex flex-wrap items-center justify-between gap-2 px-5 pt-4 text-sm">
                    <p className="text-slate-600">
                      {formatDateTime(t.startedAt)} to {formatDateTime(t.endedAt)}, {t.splitB}% on B
                    </p>
                    {t.winnerVersionId ? (
                      <Badge tone="blue">
                        Kept {t.winnerVersionId === t.versionAId ? "A" : "B"}
                      </Badge>
                    ) : (
                      <Badge tone="gray">No change</Badge>
                    )}
                  </div>
                  <ResultsTable
                    rows={[
                      { arm: "A", name: nameOf(t.versionAId), counts: countsOf(t.id, t.versionAId) },
                      { arm: "B", name: nameOf(t.versionBId), counts: countsOf(t.id, t.versionBId) },
                    ]}
                  />
                </div>
              ))}
            </div>
          </Card>
        ) : null}
      </div>
    </>
  );
}

function ResultsTable({ rows }: { rows: { arm: string; name: string; counts: ArmCounts }[] }) {
  return (
    <Table minWidth={680}>
      <thead>
        <tr>
          <Th>Version</Th>
          <Th className="text-right">Conversations</Th>
          <Th className="text-right">Resolved</Th>
          <Th className="text-right">Avg length</Th>
          <Th className="text-right">Avg messages</Th>
          <Th className="text-right">Sentiment</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const s = armStats(r.counts);
          return (
            <Tr key={r.arm}>
              <Td>
                <div className="flex min-w-0 items-center gap-2">
                  <Badge tone={r.arm === "A" ? "gray" : "blue"}>{r.arm}</Badge>
                  <Truncate text={r.name} className="max-w-52 font-medium text-slate-900" />
                </div>
              </Td>
              <Td className="text-right tabular-nums">{s.conversations}</Td>
              <Td className="text-right tabular-nums">
                <span title={`${r.counts.answered} answered of ${r.counts.withOutcome} with an outcome`}>{percent(s.resolutionRate)}</span>
              </Td>
              <Td className="text-right tabular-nums">{s.avgSeconds === null ? "-" : formatDuration(s.avgSeconds)}</Td>
              <Td className="text-right tabular-nums">{s.avgMessages === null ? "-" : s.avgMessages.toFixed(1)}</Td>
              <Td className="text-right tabular-nums">
                <span title={`${r.counts.positive} positive, ${r.counts.neutral} neutral, ${r.counts.negative} negative`}>
                  {s.positiveShare === null ? "-" : `${percent(s.positiveShare)} positive, ${percent(s.negativeShare)} negative`}
                </span>
              </Td>
            </Tr>
          );
        })}
      </tbody>
    </Table>
  );
}

function LeaderNote({ a, b }: { a: ArmCounts; b: ArmCounts }) {
  const lead = leader(a, b);
  if (lead) {
    return (
      <p className="text-sm text-slate-700">
        Version <span className="font-semibold">{lead.toUpperCase()}</span> is ahead on resolved conversations so far.
        It is a hint, not proof: keep the one you like.
      </p>
    );
  }
  return (
    <p className="text-sm text-slate-600">
      No clear leader yet. Resolved means the summary says the agent answered; wait for at least {MIN_FOR_LEADER} finished
      conversations on each version before you choose.
    </p>
  );
}

function Differences({ now, saved }: { now: AgentSnapshot; saved: AgentSnapshot }) {
  const keys = changedKeys(now, saved);
  if (keys.length === 0) return <Badge tone="green">Same as now</Badge>;
  const text = keys.map((k) => SNAPSHOT_LABELS[k]).join(", ");
  return <Truncate text={text} className="max-w-64 text-sm" />;
}

function VersionDetails({ snapshot }: { snapshot: AgentSnapshot }) {
  const rows: [string, string][] = [
    ["Greeting", snapshot.greeting],
    ["Persona", snapshot.persona],
    ["Business rules", snapshot.instructions || "(none)"],
    ["Language", snapshot.language],
    ["Voice", snapshot.ttsVoice],
    ["Language model", `${snapshot.llmModel}, temperature ${snapshot.temperature}`],
    ["Speech to text", snapshot.sttModel],
  ];
  return (
    <details className="group mt-1">
      <summary className="w-fit cursor-pointer rounded text-xs font-medium text-brand-700 hover:text-brand-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600">
        <span className="group-open:hidden">Show setup</span>
        <span className="hidden group-open:inline">Hide setup</span>
      </summary>
      <dl className="mt-2 max-w-md space-y-1.5 rounded-lg bg-slate-50 p-3 text-xs ring-1 ring-slate-200/70">
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt className="font-medium text-slate-500">{k}</dt>
            <dd className="whitespace-pre-wrap text-slate-800 [overflow-wrap:anywhere]">{v}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
