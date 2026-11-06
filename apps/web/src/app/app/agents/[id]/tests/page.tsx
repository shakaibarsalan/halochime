import { and, asc, count, desc, eq, gt, inArray } from "drizzle-orm";
import { CircleCheck, CircleX, ClipboardCheck, History, Info, Play } from "lucide-react";
import { notFound } from "next/navigation";
import { Badge, Card, CardHeader, EmptyState, PageHeader } from "@/components/ui";
import { db } from "@/db";
import { agents, agentTestCases, agentTestResults, agentTestRuns, agentVersions } from "@/db/schema";
import { MAX_TEST_CASES, runsPerDay, STALE_RUN_MS } from "@/lib/agent-tests/limits";
import { canAnswer, canJudge } from "@/lib/agent-tests/models";
import { formatDateTime } from "@/lib/format";
import { requireWorkspace } from "@/lib/session";
import { canManageIntegrations } from "../roles";
import { AddCaseForm, DeleteCaseButton, RunTestsForm } from "./forms";

export const metadata = { title: "Tests" };
// "Run tests" waits for every answer and verdict (about 25 questions, 3 at a time).
export const maxDuration = 120;

const HISTORY = 10;

export default async function TestsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { organizationId, role } = await requireWorkspace();
  const [agent] = await db
    .select({ id: agents.id, name: agents.name })
    .from(agents)
    .where(and(eq(agents.id, id), eq(agents.organizationId, organizationId)))
    .limit(1);
  if (!agent) notFound();
  const canManage = canManageIntegrations(role);

  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [cases, versions, runs, [{ n: runsToday } = { n: 0 }]] = await Promise.all([
    db
      .select()
      .from(agentTestCases)
      .where(and(eq(agentTestCases.agentId, agent.id), eq(agentTestCases.organizationId, organizationId)))
      .orderBy(asc(agentTestCases.createdAt)),
    db
      .select({ id: agentVersions.id, name: agentVersions.name })
      .from(agentVersions)
      .where(and(eq(agentVersions.agentId, agent.id), eq(agentVersions.organizationId, organizationId)))
      .orderBy(desc(agentVersions.createdAt)),
    db
      .select()
      .from(agentTestRuns)
      .where(and(eq(agentTestRuns.agentId, agent.id), eq(agentTestRuns.organizationId, organizationId)))
      .orderBy(desc(agentTestRuns.createdAt))
      .limit(HISTORY),
    db
      .select({ n: count() })
      .from(agentTestRuns)
      .where(and(eq(agentTestRuns.organizationId, organizationId), gt(agentTestRuns.createdAt, dayAgo))),
  ]);
  const results = runs.length
    ? await db
        .select()
        .from(agentTestResults)
        .where(
          inArray(
            agentTestResults.runId,
            runs.map((r) => r.id),
          ),
        )
        .orderBy(asc(agentTestResults.position))
    : [];
  const byRun = new Map<string, typeof results>();
  for (const r of results) byRun.set(r.runId, [...(byRun.get(r.runId) ?? []), r]);

  const cap = runsPerDay();
  const ready = canAnswer() && canJudge();
  const disabledReason = !ready
    ? "Tests need a model key on the server (Groq, OpenAI or Anthropic)."
    : cases.length === 0
      ? "Add a test question first."
      : null;
  const now = Date.now();

  return (
    <>
      <PageHeader
        title="Test suite"
        back={{ href: `/app/agents/${agent.id}`, label: agent.name }}
        description="Questions a visitor might ask and what a good answer must say. Run them before you publish a change."
      />

      <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
        <Card>
          <CardHeader
            title="Run tests"
            icon={Play}
            description="Each question goes through the agent's real text chat setup: its prompt, knowledge search and model. A second model then marks the answer."
          />
          <div className="space-y-3 p-5">
            {canManage ? (
              <RunTestsForm
                agentId={agent.id}
                versions={versions}
                left={Math.max(0, cap - runsToday)}
                cap={cap}
                disabledReason={disabledReason}
              />
            ) : (
              <p className="text-sm text-slate-500">Only owners and admins can run tests.</p>
            )}
            <p className="flex items-start gap-2 text-xs leading-5 text-slate-500">
              <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              Tests use text chat for a visitor who is not signed in. Actions and taking a message are not carried out,
              so questions about orders or bookings show what the agent says before it would check.
            </p>
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Test questions"
            icon={ClipboardCheck}
            description={`${cases.length} of ${MAX_TEST_CASES}.`}
          />
          {canManage ? (
            <div className="border-b border-slate-100 p-5">
              <AddCaseForm agentId={agent.id} full={cases.length >= MAX_TEST_CASES} />
            </div>
          ) : null}
          {cases.length === 0 ? (
            <EmptyState title="No test questions yet" icon={ClipboardCheck}>
              {canManage ? "Add the questions your visitors ask most, and what the right answer is." : "Owners and admins can add test questions."}
            </EmptyState>
          ) : (
            <ul className="divide-y divide-slate-100">
              {cases.map((c) => (
                <li key={c.id} className="flex items-start gap-3 px-5 py-3.5">
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="text-sm font-medium text-slate-900 [overflow-wrap:anywhere]">{c.question}</p>
                    {c.mustSay ? (
                      <p className="text-xs leading-5 text-slate-600 [overflow-wrap:anywhere]">
                        <span className="font-medium text-emerald-700">Must say:</span> {c.mustSay}
                      </p>
                    ) : null}
                    {c.mustNotSay ? (
                      <p className="text-xs leading-5 text-slate-600 [overflow-wrap:anywhere]">
                        <span className="font-medium text-red-700">Must not say:</span> {c.mustNotSay}
                      </p>
                    ) : null}
                  </div>
                  {canManage ? <DeleteCaseButton agentId={agent.id} caseId={c.id} /> : null}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="Results" icon={History} description={`The last ${HISTORY} runs for this agent.`} />
          {runs.length === 0 ? (
            <EmptyState title="No runs yet" icon={History}>
              Results show here after the first run.
            </EmptyState>
          ) : (
            <div className="divide-y divide-slate-100">
              {runs.map((run, i) => {
                const stopped = run.status === "running" && now - run.createdAt.getTime() > STALE_RUN_MS;
                const rows = byRun.get(run.id) ?? [];
                return (
                  <details key={run.id} className="group" open={i === 0}>
                    <summary className="flex cursor-pointer list-none items-center gap-3 px-5 py-3.5 hover:bg-slate-50/80 focus-visible:bg-slate-50 focus-visible:outline-none [&::-webkit-details-marker]:hidden">
                      <svg viewBox="0 0 24 24" className="size-4 shrink-0 text-slate-400 transition-transform group-open:rotate-90" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                        <path d="m9 18 6-6-6-6" />
                      </svg>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-slate-900" title={run.versionName ? `Version: ${run.versionName}` : "Current settings"}>
                          {run.versionName ? `Version: ${run.versionName}` : "Current settings"}
                        </p>
                        <p className="truncate text-xs text-slate-500" title={run.model ?? undefined}>
                          {formatDateTime(run.createdAt)}
                          {run.model ? `, ${run.model}` : ""}
                        </p>
                      </div>
                      <RunBadge status={stopped ? "stopped" : run.status} passed={run.passed} total={run.total} />
                    </summary>
                    <div className="space-y-2 px-5 pb-4">
                      {run.error ? <p className="text-sm text-red-700">{run.error}</p> : null}
                      {run.status === "running" && !stopped ? <p className="text-sm text-slate-500">Still running. Refresh in a moment.</p> : null}
                      {stopped ? <p className="text-sm text-slate-500">This run was cut off before it finished. Run the tests again.</p> : null}
                      {rows.map((r) => (
                        <div key={r.id} className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5">
                          <div className="flex items-start gap-2">
                            {r.pass ? (
                              <CircleCheck className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-label="Passed" />
                            ) : (
                              <CircleX className="mt-0.5 size-4 shrink-0 text-red-600" aria-label="Failed" />
                            )}
                            <div className="min-w-0 flex-1 space-y-1.5">
                              <p className="text-sm font-medium text-slate-900 [overflow-wrap:anywhere]">{r.question}</p>
                              <p className="text-xs leading-5 text-slate-600 [overflow-wrap:anywhere]">
                                <span className="font-medium">{r.pass ? "Pass" : "Fail"}:</span> {r.reason}
                              </p>
                              {r.answer ? (
                                <p className="whitespace-pre-wrap rounded-lg bg-white p-2.5 text-sm leading-6 text-slate-700 ring-1 ring-slate-200/80 [overflow-wrap:anywhere]">
                                  {r.answer}
                                </p>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </details>
                );
              })}
            </div>
          )}
        </Card>
      </div>
    </>
  );
}

function RunBadge({ status, passed, total }: { status: "running" | "done" | "failed" | "stopped"; passed: number; total: number }) {
  if (status === "running") return <Badge tone="blue" dot>Running</Badge>;
  if (status === "stopped") return <Badge tone="gray">Stopped</Badge>;
  if (status === "failed") return <Badge tone="red" dot>Failed</Badge>;
  return (
    <Badge tone={passed === total ? "green" : passed === 0 ? "red" : "amber"} dot>
      {`${passed} of ${total} passed`}
    </Badge>
  );
}
