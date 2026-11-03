import { and, desc, eq } from "drizzle-orm";
import { Clock, Receipt, Wallet } from "lucide-react";
import Link from "next/link";
import { Badge, Card, CardHeader, cx, EmptyState, PageHeader, Table, Td, Th, Tr, Truncate } from "@/components/ui";
import { db } from "@/db";
import { minuteRequests, usageEvents, wallets } from "@/db/schema";
import { formatDateTime, formatMinutes } from "@/lib/format";
import { requireWorkspace } from "@/lib/session";
import { RequestMinutesForm } from "./request-form";
import { canRequestMinutes } from "./roles";

export const metadata = { title: "Billing" };

const kindLabel = { trial: "Free trial", topup: "Top up", voice_seconds: "Voice call", text_session: "Text chat" } as const;

const dayMonth = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const dayMonthYear = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
/** "3 Nov", with the year when it isn't this year. UTC, like the rest of the dashboard. */
const shortDate = (d: Date) => (d.getUTCFullYear() === new Date().getUTCFullYear() ? dayMonth : dayMonthYear).format(d);

export default async function BillingPage() {
  const { organizationId, role } = await requireWorkspace();
  const [[wallet], events, [openRequest]] = await Promise.all([
    db.select().from(wallets).where(eq(wallets.organizationId, organizationId)),
    db
      .select()
      .from(usageEvents)
      .where(eq(usageEvents.organizationId, organizationId))
      .orderBy(desc(usageEvents.createdAt))
      .limit(100),
    db
      .select({ minutes: minuteRequests.minutes, createdAt: minuteRequests.createdAt, requesterEmail: minuteRequests.requesterEmail })
      .from(minuteRequests)
      .where(and(eq(minuteRequests.organizationId, organizationId), eq(minuteRequests.status, "open")))
      .orderBy(desc(minuteRequests.createdAt))
      .limit(1),
  ]);
  const balance = wallet?.balanceSeconds ?? 0;
  const canRequest = canRequestMinutes(role);

  return (
    <>
      <PageHeader title="Billing" description="Voice minutes are prepaid. Text chats are free during the beta." />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
        <Card id="request-minutes" className="h-fit scroll-mt-6 overflow-hidden">
          <div className="aurora-surface relative px-5 pb-5 pt-4 text-white">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-white/85">Voice balance</p>
              <Wallet className="size-4 text-white/80" aria-hidden />
            </div>
            <p className="mt-3 text-4xl font-semibold tracking-tight tabular-nums">{formatMinutes(balance)}</p>
            {balance <= 0 ? (
              <span className="mt-2 inline-flex rounded-full bg-white/95 px-2 py-0.5 text-xs font-semibold text-red-700">Voice paused</span>
            ) : null}
          </div>
          <div className="space-y-4 p-5">
            <p className="text-sm text-slate-500">
              {balance <= 0
                ? "Voice is paused until more minutes are added. Text chat still works."
                : "Voice calls are billed per started minute."}
            </p>
            {openRequest ? (
              <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-3">
                <p className="flex items-start gap-2 text-sm font-medium text-amber-950">
                  <Clock className="mt-0.5 size-4 shrink-0 text-amber-700" aria-hidden />
                  <span title={formatDateTime(openRequest.createdAt)}>
                    Requested {openRequest.minutes.toLocaleString("en-US")} minutes on {shortDate(openRequest.createdAt)}, waiting for
                    payment
                  </span>
                </p>
                <p className="mt-1 pl-6 text-xs leading-5 text-amber-900">
                  We&apos;ll email a payment link to <span className="break-all font-medium">{openRequest.requesterEmail}</span>. The
                  minutes are added once it&apos;s paid.
                </p>
              </div>
            ) : null}
          </div>
          <div className="border-t border-slate-100 p-5">
            <h2 className="text-[15px] font-semibold text-slate-900">Request minutes</h2>
            {canRequest ? (
              <div className="mt-3">
                <RequestMinutesForm hasOpenRequest={Boolean(openRequest)} />
              </div>
            ) : (
              <p className="mt-1 text-sm text-slate-500">
                Only owners and admins can request minutes. Ask one of them if this workspace needs more.
              </p>
            )}
          </div>
        </Card>
        <Card>
          <CardHeader title="Usage" icon={Receipt} description="Latest 100 entries." />
          {events.length === 0 ? (
            <EmptyState icon={Receipt} title="No usage yet">Voice calls and top ups will be listed here.</EmptyState>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Date</Th>
                  <Th>Type</Th>
                  <Th>Details</Th>
                  <Th className="text-right">Minutes</Th>
                </tr>
              </thead>
              <tbody>
                {events.map((e) => (
                  <Tr key={e.id}>
                    <Td className="whitespace-nowrap">{formatDateTime(e.createdAt)}</Td>
                    <Td>
                      <Badge tone={e.seconds > 0 ? "green" : "gray"}>{kindLabel[e.kind]}</Badge>
                    </Td>
                    <Td>
                      {e.conversationId ? (
                        <Link
                          href={`/app/conversations/${e.conversationId}`}
                          className="block rounded text-brand-700 hover:underline focus-visible:outline-2 focus-visible:outline-brand-600"
                        >
                          <Truncate text={e.note ?? "Conversation"} />
                        </Link>
                      ) : (
                        <Truncate text={e.note} />
                      )}
                    </Td>
                    <Td className={cx("text-right tabular-nums", e.seconds < 0 ? "text-slate-900" : "text-emerald-700")}>
                      {e.seconds > 0 ? "+" : ""}
                      {formatMinutes(e.seconds)}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
