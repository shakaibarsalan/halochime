import type { ConversationOutcome } from "@talkfront/shared";
import { count, desc, eq, sql } from "drizzle-orm";
import { ChevronLeft, ChevronRight, Flag, MessagesSquare } from "lucide-react";
import Link from "next/link";
import { Badge, ButtonLink, Card, EmptyState, ModeBadge, PageHeader, Table, Td, Th, Tr, Truncate } from "@/components/ui";
import { db } from "@/db";
import { agents, conversations } from "@/db/schema";
import { OUTCOME_LABELS, OUTCOME_TONES } from "@/lib/collect";
import { formatDateTime, formatDuration } from "@/lib/format";
import { requireWorkspace } from "@/lib/session";

export const metadata = { title: "Conversations" };

const PAGE_SIZE = 50;

export default async function ConversationsPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const { organizationId } = await requireWorkspace();
  const page = Math.max(1, Number.parseInt((await searchParams).page ?? "1", 10) || 1);

  const [rows, [total]] = await Promise.all([
    db
      .select({
        id: conversations.id,
        startedAt: conversations.startedAt,
        mode: conversations.mode,
        status: conversations.status,
        durationSec: conversations.durationSec,
        pageUrl: conversations.pageUrl,
        summary: conversations.summary,
        handoffRequested: conversations.handoffRequested,
        visitorName: conversations.visitorName,
        outcome: sql<ConversationOutcome | null>`${conversations.collectedData}->>'outcome'`,
        followUp: sql<boolean>`coalesce((${conversations.collectedData}->>'follow_up_needed')::boolean, false)`,
        agentName: agents.name,
      })
      .from(conversations)
      .innerJoin(agents, eq(agents.id, conversations.agentId))
      .where(eq(conversations.organizationId, organizationId))
      .orderBy(desc(conversations.startedAt))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
    db.select({ n: count() }).from(conversations).where(eq(conversations.organizationId, organizationId)),
  ]);
  const pages = Math.max(1, Math.ceil((total?.n ?? 0) / PAGE_SIZE));
  const showPage = rows.some((c) => c.pageUrl);
  const showSummary = rows.some((c) => c.summary);

  return (
    <>
      <PageHeader title="Conversations" description="Every voice call and chat, newest first." />
      <Card>
        {rows.length === 0 ? (
          <EmptyState
            icon={MessagesSquare}
            title="No conversations yet"
            action={
              <ButtonLink href="/app/agents" variant="secondary">
                Try an agent
              </ButtonLink>
            }
          >
            They show up here as soon as a visitor starts talking.
          </EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Started</Th>
                <Th>Agent</Th>
                <Th>Mode</Th>
                <Th>Duration</Th>
                {showPage ? <Th className="hidden xl:table-cell">Page</Th> : null}
                {showSummary ? <Th>Summary</Th> : null}
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <Tr key={c.id}>
                  <Td className="whitespace-nowrap">
                    <Link
                      href={`/app/conversations/${c.id}`}
                      className="rounded font-medium text-slate-900 hover:text-brand-700 hover:underline focus-visible:outline-2 focus-visible:outline-brand-600"
                    >
                      {formatDateTime(c.startedAt)}
                    </Link>
                    {c.status === "active" || c.handoffRequested || shownOutcome(c) || c.followUp ? (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {c.status === "active" ? (
                          <Badge tone="green" dot>
                            live
                          </Badge>
                        ) : null}
                        {c.handoffRequested ? <Badge tone="amber">handoff</Badge> : null}
                        <OutcomeBadges outcome={shownOutcome(c)} followUp={c.followUp} />
                      </div>
                    ) : null}
                  </Td>
                  <Td>
                    <Truncate text={c.agentName} className="max-w-[12rem]" />
                    {c.visitorName ? <Truncate text={c.visitorName} className="text-xs text-slate-500" /> : null}
                  </Td>
                  <Td>
                    <ModeBadge mode={c.mode} />
                  </Td>
                  <Td className="whitespace-nowrap tabular-nums">{formatDuration(c.durationSec)}</Td>
                  {showPage ? (
                    <Td className="hidden xl:table-cell">
                      <Truncate text={c.pageUrl} className="max-w-[14rem] text-slate-500" />
                    </Td>
                  ) : null}
                  {showSummary ? (
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
      {pages > 1 ? (
        <div className="mt-4 flex items-center justify-between text-sm text-slate-500">
          <span>
            Page {page} of {pages}
          </span>
          <div className="flex gap-2">
            {page > 1 ? (
              <ButtonLink href={`/app/conversations?page=${page - 1}`} variant="secondary" size="sm">
                <ChevronLeft aria-hidden />
                Newer
              </ButtonLink>
            ) : null}
            {page < pages ? (
              <ButtonLink href={`/app/conversations?page=${page + 1}`} variant="secondary" size="sm">
                Older
                <ChevronRight aria-hidden />
              </ButtonLink>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}

/** The outcome badge, unless it would repeat the handoff badge (a message was taken). */
function shownOutcome(c: { outcome: ConversationOutcome | null; handoffRequested: boolean }): ConversationOutcome | null {
  if (!c.outcome || !(c.outcome in OUTCOME_LABELS)) return null;
  return c.outcome === "message_taken" && c.handoffRequested ? null : c.outcome;
}

function OutcomeBadges({ outcome, followUp }: { outcome: ConversationOutcome | null; followUp: boolean }) {
  return (
    <>
      {outcome ? (
        <Badge tone={OUTCOME_TONES[outcome]} dot>
          {OUTCOME_LABELS[outcome]}
        </Badge>
      ) : null}
      {followUp ? (
        <span
          title="Follow-up needed"
          className="inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-600/25"
        >
          <Flag className="size-3" aria-hidden />
          <span className="sr-only">Follow-up needed</span>
        </span>
      ) : null}
    </>
  );
}
