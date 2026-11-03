import { and, asc, count, desc, eq, notLike, sum } from "drizzle-orm";
import {
  ArrowRight,
  BookOpen,
  Check,
  Code2,
  Globe,
  Inbox,
  MessagesSquare,
  Mic,
  Palette,
  Plus,
  Sparkles,
  Timer,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import {
  Badge,
  ButtonLink,
  Card,
  CardHeader,
  cx,
  EmptyState,
  ModeBadge,
  PageHeader,
  StatCard,
  Table,
  Td,
  Th,
  Tr,
  Truncate,
} from "@/components/ui";
import { db } from "@/db";
import { agents, conversations, handoffRequests, knowledgeSources, usageEvents, wallets } from "@/db/schema";
import { appOrigin } from "@/lib/env";
import { formatDateTime, formatDuration, formatMinutes } from "@/lib/format";
import { requireWorkspace } from "@/lib/session";

export const metadata = { title: "Overview" };

type Step = { title: string; body: string; href: string; cta: string; done: boolean; icon: LucideIcon };

export default async function OverviewPage() {
  const { organizationId } = await requireWorkspace();

  const [[convCount], [voiceUsed], [wallet], [openHandoffs], recent, [sourceCount], agentRows, [external]] = await Promise.all([
    db.select({ n: count() }).from(conversations).where(eq(conversations.organizationId, organizationId)),
    db
      .select({ seconds: sum(usageEvents.seconds) })
      .from(usageEvents)
      .where(and(eq(usageEvents.organizationId, organizationId), eq(usageEvents.kind, "voice_seconds"))),
    db.select({ balance: wallets.balanceSeconds }).from(wallets).where(eq(wallets.organizationId, organizationId)),
    db
      .select({ n: count() })
      .from(handoffRequests)
      .where(and(eq(handoffRequests.organizationId, organizationId), eq(handoffRequests.status, "open"))),
    db
      .select({
        id: conversations.id,
        startedAt: conversations.startedAt,
        mode: conversations.mode,
        durationSec: conversations.durationSec,
        summary: conversations.summary,
        agentName: agents.name,
      })
      .from(conversations)
      .innerJoin(agents, eq(agents.id, conversations.agentId))
      .where(eq(conversations.organizationId, organizationId))
      .orderBy(desc(conversations.startedAt))
      .limit(5),
    // Getting-started checklist inputs: all cheap, indexed by organization.
    db.select({ n: count() }).from(knowledgeSources).where(eq(knowledgeSources.organizationId, organizationId)),
    db
      .select({
        id: agents.id,
        status: agents.status,
        allowedDomains: agents.allowedDomains,
        createdAt: agents.createdAt,
        updatedAt: agents.updatedAt,
      })
      .from(agents)
      .where(eq(agents.organizationId, organizationId))
      .orderBy(asc(agents.createdAt)),
    // A conversation that started on a page outside this app means the snippet is installed somewhere.
    db
      .select({ n: count() })
      .from(conversations)
      .where(and(eq(conversations.organizationId, organizationId), notLike(conversations.pageUrl, `${appOrigin()}%`))),
  ]);

  const usedSeconds = -Number(voiceUsed?.seconds ?? 0);
  const balance = wallet?.balance ?? 0;
  const handoffs = openHandoffs?.n ?? 0;
  const stats = [
    { label: "Conversations", value: String(convCount?.n ?? 0), href: "/app/conversations", icon: MessagesSquare },
    { label: "Voice minutes used", value: formatMinutes(usedSeconds), href: "/app/billing", icon: Timer },
    {
      label: "Wallet balance",
      value: formatMinutes(balance),
      href: "/app/billing",
      icon: Wallet,
      tone: balance <= 0 ? ("red" as const) : undefined,
      hint: balance <= 0 ? "Voice is paused" : undefined,
    },
    {
      label: "Open handoffs",
      value: String(handoffs),
      href: "/app/handoffs",
      icon: Inbox,
      tone: handoffs > 0 ? ("amber" as const) : undefined,
      hint: handoffs > 0 ? "Waiting for your team" : undefined,
    },
  ];

  const firstAgent = agentRows[0];
  const agentHref = firstAgent ? `/app/agents/${firstAgent.id}` : "/app/agents";
  const steps: Step[] = [
    {
      title: "Add knowledge",
      body: "Paste your FAQ or import a page so the agent has something to answer from.",
      href: "/app/knowledge",
      cta: "Add knowledge",
      done: (sourceCount?.n ?? 0) > 0,
      icon: BookOpen,
    },
    {
      title: "Customise your agent and widget",
      body: "Greeting, persona, voice, colour and button label.",
      href: agentHref,
      cta: "Open agent",
      done: agentRows.some((a) => a.updatedAt.getTime() - a.createdAt.getTime() > 1000),
      icon: Palette,
    },
    {
      title: "Publish and allow your domain",
      body: "Agents only load on the domains you list, and only once published.",
      href: agentHref,
      cta: "Publish",
      done: agentRows.some((a) => a.status === "published" && a.allowedDomains.length > 0),
      icon: Globe,
    },
    {
      title: "Install the snippet",
      body: "Paste the script tag before </body> on your site or user portal.",
      href: agentHref,
      cta: "Get snippet",
      done: (external?.n ?? 0) > 0,
      icon: Code2,
    },
    {
      title: "Test a conversation",
      body: "Talk or type to your agent right in the dashboard.",
      href: firstAgent ? `${agentHref}?try=1` : "/app/agents",
      cta: "Try it",
      done: (convCount?.n ?? 0) > 0,
      icon: Mic,
    },
  ];
  const doneCount = steps.filter((s) => s.done).length;
  const allDone = doneCount === steps.length;
  const nextIndex = steps.findIndex((s) => !s.done);

  return (
    <>
      <PageHeader
        title="Overview"
        description="How your agents are doing."
        action={
          <ButtonLink href="/app/agents">
            <Plus aria-hidden />
            <span className="hidden sm:inline">Manage agents</span>
            <span className="sm:hidden">Agents</span>
          </ButtonLink>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        {stats.map((s) => (
          <StatCard key={s.label} {...s} />
        ))}
      </div>

      {allDone ? null : (
        <Card className="mt-6 overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 bg-gradient-to-r from-brand-50/70 via-white to-orange-50/50 px-5 py-4">
            <div className="flex min-w-0 items-center gap-3">
              <span className="orb size-8 shrink-0 shadow-[0_4px_12px_-2px_rgb(109_94_252/0.5)]" aria-hidden />
              <div className="min-w-0">
                <h2 className="text-[15px] font-semibold text-slate-900">Get your agent live</h2>
                <p className="text-sm text-slate-500">
                  {doneCount} of {steps.length} done
                </p>
              </div>
            </div>
            <div
              className="h-2 w-full overflow-hidden rounded-full bg-slate-200/70 sm:w-48"
              role="progressbar"
              aria-label="Getting started progress"
              aria-valuemin={0}
              aria-valuemax={steps.length}
              aria-valuenow={doneCount}
            >
              <div
                className="h-full rounded-full bg-gradient-to-r from-brand-600 via-violet-500 to-orange-300 transition-[width]"
                style={{ width: `${(doneCount / steps.length) * 100}%` }}
              />
            </div>
          </div>
          <ol className="divide-y divide-slate-100">
            {steps.map((s, i) => (
              <li key={s.title} className={cx("flex items-center gap-4 px-5 py-3.5", i === nextIndex && "bg-brand-50/30")}>
                <span
                  className={cx(
                    "grid size-7 shrink-0 place-items-center rounded-full text-xs font-semibold",
                    s.done
                      ? "bg-emerald-500 text-white"
                      : i === nextIndex
                        ? "bg-white text-brand-700 ring-2 ring-brand-500"
                        : "bg-white text-slate-400 ring-1 ring-slate-300",
                  )}
                >
                  {s.done ? <Check className="size-3.5" strokeWidth={3} aria-hidden /> : i + 1}
                  <span className="sr-only">{s.done ? " (done)" : " (to do)"}</span>
                </span>
                <div className="min-w-0 flex-1">
                  <p className={cx("text-sm font-medium", s.done ? "text-slate-500 line-through decoration-slate-300" : "text-slate-900")}>
                    {s.title}
                  </p>
                  {s.done ? null : <p className="mt-0.5 hidden text-xs text-slate-500 sm:block">{s.body}</p>}
                </div>
                {s.done ? null : (
                  <ButtonLink href={s.href} variant={i === nextIndex ? "primary" : "secondary"} size="sm" className="shrink-0">
                    {s.cta}
                    <ArrowRight aria-hidden className="max-sm:hidden" />
                  </ButtonLink>
                )}
              </li>
            ))}
          </ol>
        </Card>
      )}

      <Card className="mt-6">
        <CardHeader
          title="Recent conversations"
          icon={MessagesSquare}
          action={
            recent.length > 0 ? (
              <ButtonLink href="/app/conversations" variant="secondary" size="sm">
                View all
              </ButtonLink>
            ) : null
          }
        />
        {recent.length === 0 ? (
          <EmptyState
            icon={Sparkles}
            title="No conversations yet"
            action={
              <ButtonLink href={firstAgent ? `${agentHref}?try=1` : "/app/agents"} variant="secondary">
                <Mic aria-hidden />
                Try your agent
              </ButtonLink>
            }
          >
            Add the embed snippet to your site, or use Try it on an agent.
          </EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Started</Th>
                <Th>Agent</Th>
                <Th>Mode</Th>
                <Th>Duration</Th>
                {recent.some((c) => c.summary) ? <Th>Summary</Th> : null}
              </tr>
            </thead>
            <tbody>
              {recent.map((c) => (
                <Tr key={c.id}>
                  <Td className="whitespace-nowrap">
                    <Link href={`/app/conversations/${c.id}`} className="rounded font-medium text-slate-900 hover:text-brand-700 hover:underline focus-visible:outline-2 focus-visible:outline-brand-600">
                      {formatDateTime(c.startedAt)}
                    </Link>
                  </Td>
                  <Td>
                    <Truncate text={c.agentName} className="max-w-[12rem]" />
                  </Td>
                  <Td>
                    <ModeBadge mode={c.mode} />
                  </Td>
                  <Td className="whitespace-nowrap tabular-nums">{formatDuration(c.durationSec)}</Td>
                  {recent.some((r) => r.summary) ? (
                    <Td>
                      <Truncate text={c.summary} />
                    </Td>
                  ) : null}
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}

