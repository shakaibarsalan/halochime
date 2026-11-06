import { CONVERSATION_OUTCOMES, SENTIMENTS, type ConversationOutcome, type Sentiment } from "@talkfront/shared";
import {
  ArrowUpRight,
  BookOpen,
  ChartColumn,
  CircleCheck,
  CircleQuestionMark,
  Flag,
  Gauge,
  Heart,
  Inbox,
  MessagesSquare,
  SearchX,
  Tag,
  Timer,
} from "lucide-react";
import Link from "next/link";
import { ButtonLink, Card, CardHeader, cx, EmptyState, ModeBadge, PageHeader, StatCard } from "@/components/ui";
import { OUTCOME_LABELS, OUTCOME_TONES, SENTIMENT_LABELS } from "@/lib/collect";
import { formatDateTime, formatDuration, formatMinutes } from "@/lib/format";
import { requireWorkspace } from "@/lib/session";
import { AgentFilter } from "./agent-filter";
import { analyticsHref, parsePeriod, PERIODS, type Period } from "./period";
import {
  getKnowledgeGaps,
  getMessagesLeft,
  getPerDay,
  getTopTopics,
  getTotals,
  getUnanswered,
  getVoiceSecondsBilled,
  getWorkspaceAgents,
  OUTCOME_KEYS,
  periodStart,
  type Scope,
  type Totals,
} from "./queries";

export const metadata = { title: "Analytics" };

const DAY_MS = 86_400_000;
const num = (v: number) => v.toLocaleString("en-US");
const plural = (v: number, one: string, many = `${one}s`) => `${num(v)} ${v === 1 ? one : many}`;

const dayMonth = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const weekdayDayMonth = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<{ days?: string; agent?: string }> }) {
  const { organizationId } = await requireWorkspace();
  const params = await searchParams;
  const days = parsePeriod(params.days);
  const workspaceAgents = await getWorkspaceAgents(organizationId);
  // Only this workspace's agents are accepted; anything else means "all agents".
  const agent = workspaceAgents.find((a) => a.id === params.agent) ?? null;
  const scope: Scope = { organizationId, agentId: agent?.id ?? null, since: periodStart(days) };

  const [totals, voiceSeconds, messagesLeft, perDay, topics, unanswered, gaps] = await Promise.all([
    getTotals(scope),
    getVoiceSecondsBilled(scope),
    getMessagesLeft(scope),
    getPerDay(scope),
    getTopTopics(scope),
    getUnanswered(scope),
    getKnowledgeGaps(scope),
  ]);

  const resolution = totals.withOutcome > 0 ? Math.round((totals.answered / totals.withOutcome) * 100) : null;
  const stats = [
    {
      label: "Conversations",
      value: num(totals.total),
      hint: `${num(totals.voice)} voice, ${num(totals.text)} text`,
      href: "/app/conversations",
      icon: MessagesSquare,
    },
    { label: "Voice minutes used", value: formatMinutes(voiceSeconds), hint: "As billed", href: "/app/billing", icon: Timer },
    {
      label: "Average call length",
      value: totals.avgVoiceSec != null ? formatDuration(totals.avgVoiceSec) : "-",
      hint: totals.voice > 0 ? "Voice calls" : "No voice calls yet",
      href: "/app/conversations",
      icon: Gauge,
    },
    {
      label: "Messages left",
      value: num(messagesLeft),
      hint: "For your team",
      href: "/app/handoffs",
      icon: Inbox,
      tone: messagesLeft > 0 ? ("amber" as const) : undefined,
    },
    {
      label: "Resolution rate",
      value: resolution != null ? `${resolution}%` : "-",
      hint: totals.withOutcome > 0 ? `${num(totals.answered)} of ${num(totals.withOutcome)} answered` : "No outcomes yet",
      href: "#outcomes",
      icon: CircleCheck,
    },
    {
      label: "Follow-ups needed",
      value: num(totals.followUps),
      hint: totals.followUps > 0 ? "Your team should act" : "None needed",
      href: "/app/conversations",
      icon: Flag,
      tone: totals.followUps > 0 ? ("amber" as const) : undefined,
    },
  ];

  return (
    <>
      <PageHeader
        title="Analytics"
        description={`${agent ? `${agent.name}, last` : "Last"} ${days} days. Days are in UTC.`}
        action={<PeriodTabs days={days} agentId={agent?.id ?? null} />}
      />

      {workspaceAgents.length > 1 ? (
        <div className="-mt-2 mb-5 flex sm:-mt-4">
          <AgentFilter agents={workspaceAgents} agentId={agent?.id ?? null} days={days} />
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:gap-4 xl:grid-cols-6">
        {stats.map((s) => (
          <StatCard key={s.label} {...s} />
        ))}
      </div>

      {totals.total === 0 ? (
        <Card className="mt-6">
          <EmptyState
            icon={ChartColumn}
            title={`No conversations in the last ${days} days`}
            action={
              <ButtonLink href={agent ? `/app/agents/${agent.id}?try=1` : "/app/agents"} variant="secondary">
                Try {agent ? "this agent" : "an agent"}
              </ButtonLink>
            }
          >
            Numbers, topics and gaps in your knowledge show up here once visitors start talking to your agent.
          </EmptyState>
        </Card>
      ) : (
        <>
          <Card className="mt-6">
            <CardHeader title="Conversations per day" icon={ChartColumn} description={plural(totals.total, "conversation") + ` in ${days} days`} />
            <PerDayChart rows={perDay} days={days} since={scope.since} />
          </Card>

          <div className="mt-6 grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-2">
            <TopTopics topics={topics} />
            <div className="grid grid-cols-[minmax(0,1fr)] content-start gap-6">
              <OutcomeBreakdown totals={totals} />
              <SentimentBreakdown totals={totals} />
            </div>
          </div>

          <div className="mt-6 grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-2">
            <Unanswered rows={unanswered} showAgent={!agent && workspaceAgents.length > 1} />
            <KnowledgeGaps gaps={gaps} />
          </div>
        </>
      )}
    </>
  );
}

function PeriodTabs({ days, agentId }: { days: Period; agentId: string | null }) {
  return (
    <nav aria-label="Period" className="inline-flex gap-1 rounded-xl bg-slate-900/[0.05] p-1">
      {PERIODS.map((d) => (
        <Link
          key={d}
          href={analyticsHref(d, agentId)}
          aria-current={days === d ? "page" : undefined}
          aria-label={`Last ${d} days`}
          className={cx(
            "whitespace-nowrap rounded-lg px-2.5 py-1.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-600 sm:px-3",
            days === d ? "bg-white text-slate-900 shadow-xs" : "text-slate-500 hover:text-slate-900",
          )}
        >
          <span className="sm:hidden">{d}d</span>
          <span className="max-sm:hidden">{d} days</span>
        </Link>
      ))}
    </nav>
  );
}

function PerDayChart({ rows, days, since }: { rows: { day: string; total: number; voice: number }[]; days: Period; since: Date }) {
  const byDay = new Map(rows.map((r) => [r.day, r]));
  const series = Array.from({ length: days }, (_, i) => {
    const date = new Date(since.getTime() + i * DAY_MS);
    const r = byDay.get(date.toISOString().slice(0, 10));
    return { date, total: r?.total ?? 0, voice: r?.voice ?? 0 };
  });
  const peak = Math.max(1, ...series.map((d) => d.total));
  const busiest = series.reduce((a, b) => (b.total > a.total ? b : a));
  const labelAt = new Set([0, Math.floor((days - 1) / 2), days - 1]);

  return (
    <div className="px-5 pb-5 pt-4">
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-brand-600" aria-hidden />
          Voice
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-brand-300" aria-hidden />
          Text
        </span>
        <span className="ml-auto tabular-nums">Busiest: {weekdayDayMonth.format(busiest.date)}, {plural(busiest.total, "conversation")}</span>
      </div>
      <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2">
        <div className="flex h-40 flex-col justify-between text-right text-[11px] tabular-nums text-slate-500" aria-hidden>
          <span>{num(peak)}</span>
          <span>0</span>
        </div>
        <div
          role="img"
          aria-label={`Conversations per day over the last ${days} days. Busiest day ${weekdayDayMonth.format(busiest.date)} with ${plural(busiest.total, "conversation")}.`}
          className={cx("flex h-40 min-w-0 flex-1 items-end border-b border-l border-slate-200", days > 30 ? "sm:gap-px" : "gap-0.5 sm:gap-1")}
        >
          {series.map((d) => (
            <div
              key={d.date.getTime()}
              title={`${weekdayDayMonth.format(d.date)}: ${plural(d.total, "conversation")} (${num(d.voice)} voice, ${num(d.total - d.voice)} text)`}
              className="group flex h-full min-w-0 flex-1 flex-col justify-end hover:bg-slate-100/80"
            >
              {d.total - d.voice > 0 ? (
                <div className="w-full rounded-t-[2px] bg-brand-300 group-hover:bg-brand-400" style={{ height: `${((d.total - d.voice) / peak) * 100}%` }} />
              ) : null}
              {d.voice > 0 ? (
                <div
                  className={cx("w-full bg-brand-600 group-hover:bg-brand-700", d.total === d.voice && "rounded-t-[2px]")}
                  style={{ height: `${(d.voice / peak) * 100}%` }}
                />
              ) : null}
            </div>
          ))}
        </div>
        <span aria-hidden />
        <div className="mt-1.5 flex justify-between text-[11px] text-slate-500" aria-hidden>
          {series.map((d, i) => (labelAt.has(i) ? <span key={i}>{dayMonth.format(d.date)}</span> : null))}
        </div>
      </div>
    </div>
  );
}

function Meter({ value, of, className }: { value: number; of: number; className: string }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100" aria-hidden>
      <div className={cx("h-full rounded-full", className)} style={{ width: `${of > 0 ? Math.max(2, (value / of) * 100) : 0}%` }} />
    </div>
  );
}

function TopTopics({ topics }: { topics: { topic: string; total: number; answered: number }[] }) {
  const top = topics[0]?.total ?? 0;
  return (
    <Card className="h-fit">
      <CardHeader title="Top topics" icon={Tag} description="What visitors asked about most." />
      {topics.length === 0 ? (
        <EmptyState icon={Tag} title="No topics yet">
          Topics appear once conversations end and are summarised.
        </EmptyState>
      ) : (
        <ol className="divide-y divide-slate-100">
          {topics.map((t) => (
            <li key={t.topic} className="px-5 py-3">
              <div className="flex items-baseline justify-between gap-3">
                <span title={t.topic} className="block min-w-0 truncate text-sm font-medium text-slate-900 first-letter:uppercase">
                  {t.topic}
                </span>
                <span className="shrink-0 text-sm font-semibold tabular-nums text-slate-900">{num(t.total)}</span>
              </div>
              <div className="mt-1.5">
                <Meter value={t.total} of={top} className="bg-brand-500" />
              </div>
              <p className={cx("mt-1 text-xs", t.answered === t.total ? "text-emerald-700" : "text-slate-500")}>
                {num(t.answered)} of {num(t.total)} answered
              </p>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

const TONE_BAR = { green: "bg-emerald-500", blue: "bg-brand-500", amber: "bg-amber-500", gray: "bg-slate-400", red: "bg-red-500" } as const;
const SENTIMENT_TONES = { positive: "green", neutral: "gray", negative: "red" } as const satisfies Record<Sentiment, keyof typeof TONE_BAR>;

function BreakdownRows({ rows, of }: { rows: { key: string; label: string; value: number; tone: keyof typeof TONE_BAR }[]; of: number }) {
  return (
    <ul className="space-y-3 px-5 py-4">
      {rows.map((r) => (
        <li key={r.key}>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="flex min-w-0 items-center gap-2 font-medium text-slate-800">
              <span className={cx("size-2 shrink-0 rounded-full", TONE_BAR[r.tone])} aria-hidden />
              <span className="truncate" title={r.label}>
                {r.label}
              </span>
            </span>
            <span className="shrink-0 tabular-nums text-slate-600">
              <span className="font-semibold text-slate-900">{num(r.value)}</span>
              <span className="ml-1.5 inline-block w-10 text-right">{of > 0 ? `${Math.round((r.value / of) * 100)}%` : "-"}</span>
            </span>
          </div>
          <div className="mt-1.5">
            <Meter value={r.value} of={of} className={TONE_BAR[r.tone]} />
          </div>
        </li>
      ))}
    </ul>
  );
}

function OutcomeBreakdown({ totals }: { totals: Totals }) {
  const missing = totals.total - totals.withOutcome;
  return (
    <Card id="outcomes" className="scroll-mt-6">
      <CardHeader title="Outcomes" icon={CircleCheck} description="How conversations ended." />
      {totals.withOutcome === 0 ? (
        <p className="px-5 py-6 text-sm text-slate-500">No outcomes yet. They are added when a conversation ends and is summarised.</p>
      ) : (
        <>
          <BreakdownRows
            of={totals.withOutcome}
            rows={CONVERSATION_OUTCOMES.map((o: ConversationOutcome) => ({
              key: o,
              label: OUTCOME_LABELS[o],
              value: totals[OUTCOME_KEYS[o]] as number,
              tone: OUTCOME_TONES[o],
            }))}
          />
          {missing > 0 ? (
            <p className="border-t border-slate-100 px-5 py-3 text-xs text-slate-500">
              {plural(missing, "conversation")} without an outcome (still live or not summarised) left out.
            </p>
          ) : null}
        </>
      )}
    </Card>
  );
}

function SentimentBreakdown({ totals }: { totals: Totals }) {
  const values: Record<Sentiment, number> = { positive: totals.positive, neutral: totals.neutral, negative: totals.negative };
  const known = values.positive + values.neutral + values.negative;
  return (
    <Card>
      <CardHeader title="Sentiment" icon={Heart} description="How visitors seemed by the end." />
      {known === 0 ? (
        <p className="px-5 py-6 text-sm text-slate-500">No sentiment yet. It is added when a conversation ends and is summarised.</p>
      ) : (
        <BreakdownRows
          of={known}
          rows={SENTIMENTS.map((s) => ({ key: s, label: SENTIMENT_LABELS[s], value: values[s], tone: SENTIMENT_TONES[s] }))}
        />
      )}
    </Card>
  );
}

type UnansweredRow = { id: string; startedAt: Date; mode: "voice" | "text"; topic: string | null; summary: string | null; agentName: string };

function Unanswered({ rows, showAgent }: { rows: UnansweredRow[]; showAgent: boolean }) {
  return (
    <Card id="unanswered" className="h-fit scroll-mt-6">
      <CardHeader title="Not answered" icon={CircleQuestionMark} description="Latest conversations the agent could not help with." />
      {rows.length === 0 ? (
        <EmptyState icon={CircleCheck} title="Nothing unanswered">
          Every summarised conversation in this period was answered, passed on or closed another way.
        </EmptyState>
      ) : (
        <ul className="divide-y divide-slate-100">
          {rows.map((c) => (
            <li key={c.id}>
              <Link
                href={`/app/conversations/${c.id}`}
                className="group block px-5 py-3 transition-colors hover:bg-slate-50/80 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-600"
              >
                <div className="flex items-center justify-between gap-3">
                  <span
                    title={c.topic ?? "No topic"}
                    className={cx(
                      "block min-w-0 truncate text-sm font-medium first-letter:uppercase group-hover:text-brand-700",
                      c.topic ? "text-slate-900" : "text-slate-500",
                    )}
                  >
                    {c.topic ?? "No topic"}
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5">
                    <ModeBadge mode={c.mode} />
                    <ArrowUpRight className="size-3.5 text-slate-400 group-hover:text-brand-700" aria-hidden />
                  </span>
                </div>
                {c.summary ? (
                  <p title={c.summary} className="mt-0.5 line-clamp-2 text-sm text-slate-600">
                    {c.summary}
                  </p>
                ) : null}
                <p className="mt-1 flex min-w-0 gap-1.5 text-xs text-slate-500">
                  <span className="shrink-0">{formatDateTime(c.startedAt)}</span>
                  {showAgent ? (
                    <span title={c.agentName} className="min-w-0 truncate">
                      · {c.agentName}
                    </span>
                  ) : null}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

type Gap = { key: string; query: string; conversationId: string; total: number; conversations: number; latestAt: Date | null };

function KnowledgeGaps({ gaps }: { gaps: Gap[] }) {
  return (
    <Card className="h-fit">
      <CardHeader
        title="Knowledge gaps"
        icon={SearchX}
        description="Searches that found nothing. Add these answers to your knowledge."
        action={
          <ButtonLink href="/app/knowledge" variant="secondary" size="sm">
            <BookOpen aria-hidden />
            Add knowledge
          </ButtonLink>
        }
      />
      {gaps.length === 0 ? (
        <EmptyState icon={SearchX} title="No gaps found">
          When the agent searches your knowledge and finds nothing, the search shows up here.
        </EmptyState>
      ) : (
        <ul className="divide-y divide-slate-100">
          {gaps.map((g) => (
            <li key={g.key} className="flex items-center justify-between gap-3 px-5 py-3">
              <div className="min-w-0">
                <p title={g.query} className="truncate text-sm font-medium text-slate-900">
                  &ldquo;{g.query}&rdquo;
                </p>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-slate-500">
                  <span>Last searched {formatDateTime(g.latestAt)}</span>
                  <Link
                    href={`/app/conversations/${g.conversationId}`}
                    className="inline-flex items-center gap-0.5 rounded font-medium text-brand-700 hover:underline focus-visible:outline-2 focus-visible:outline-brand-600"
                  >
                    View conversation
                    <ArrowUpRight className="size-3" aria-hidden />
                  </Link>
                </p>
              </div>
              <span
                className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold tabular-nums text-slate-700"
                title={`Searched ${plural(g.total, "time")} in ${plural(g.conversations, "conversation")}`}
              >
                {num(g.total)}×
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
