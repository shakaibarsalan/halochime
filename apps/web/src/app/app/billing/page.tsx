import { desc, eq } from "drizzle-orm";
import { Receipt, Wallet } from "lucide-react";
import Link from "next/link";
import { Badge, Button, Card, CardHeader, cx, EmptyState, PageHeader, Table, Td, Th, Tr, Truncate } from "@/components/ui";
import { db } from "@/db";
import { usageEvents, wallets } from "@/db/schema";
import { formatDateTime, formatMinutes } from "@/lib/format";
import { requireWorkspace } from "@/lib/session";

export const metadata = { title: "Billing" };

const kindLabel = { trial: "Free trial", topup: "Top up", voice_seconds: "Voice call", text_session: "Text chat" } as const;

export default async function BillingPage() {
  const { organizationId } = await requireWorkspace();
  const [[wallet], events] = await Promise.all([
    db.select().from(wallets).where(eq(wallets.organizationId, organizationId)),
    db
      .select()
      .from(usageEvents)
      .where(eq(usageEvents.organizationId, organizationId))
      .orderBy(desc(usageEvents.createdAt))
      .limit(100),
  ]);
  const balance = wallet?.balanceSeconds ?? 0;

  return (
    <>
      <PageHeader title="Billing" description="Voice minutes are prepaid. Text chats are free during the beta." />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
        <Card className="h-fit overflow-hidden">
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
              {balance <= 0 ? "Voice is paused until you top up. Text chat still works." : "Voice calls are billed per started minute."}
            </p>
            <Button type="button" disabled className="w-full" title="Card payments are coming soon">
              Top up (soon)
            </Button>
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
