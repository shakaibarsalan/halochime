import { and, desc, eq } from "drizzle-orm";
import { ArrowUpRight, Check, Inbox, Mail, Phone, RotateCcw } from "lucide-react";
import Link from "next/link";
import { SubmitButton } from "@/components/form-bits";
import { Badge, Card, cx, EmptyState, PageHeader, Table, Td, Th, Tr, Truncate } from "@/components/ui";
import { db } from "@/db";
import { handoffRequests } from "@/db/schema";
import { formatDateTime } from "@/lib/format";
import { requireWorkspace } from "@/lib/session";
import { setHandoffStatus } from "./actions";

export const metadata = { title: "Handoffs" };

export default async function HandoffsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { organizationId } = await requireWorkspace();
  const status = (await searchParams).status === "closed" ? "closed" : "open";
  const rows = await db
    .select()
    .from(handoffRequests)
    .where(and(eq(handoffRequests.organizationId, organizationId), eq(handoffRequests.status, status)))
    .orderBy(desc(handoffRequests.createdAt))
    .limit(200);

  return (
    <>
      <PageHeader
        title="Handoffs"
        description="Messages visitors left for your team."
        action={
          <nav aria-label="Filter handoffs" className="inline-flex gap-1 rounded-xl bg-slate-900/[0.05] p-1">
            {(["open", "closed"] as const).map((s) => (
              <Link
                key={s}
                href={s === "open" ? "/app/handoffs" : "/app/handoffs?status=closed"}
                aria-current={status === s ? "page" : undefined}
                className={cx(
                  "rounded-lg px-3 py-1.5 text-sm font-medium capitalize transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-600",
                  status === s ? "bg-white text-slate-900 shadow-xs" : "text-slate-500 hover:text-slate-900",
                )}
              >
                {s}
              </Link>
            ))}
          </nav>
        }
      />
      <Card>
        {rows.length === 0 ? (
          <EmptyState icon={Inbox} title={status === "open" ? "Nothing waiting" : "No closed handoffs"}>
            {status === "open" ? "When a visitor asks for a person, their message lands here." : null}
          </EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Received</Th>
                <Th>From</Th>
                <Th>Message</Th>
                <Th>Status</Th>
                <Th className="text-right">
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((h) => (
                <Tr key={h.id}>
                  <Td className="whitespace-nowrap">
                    {formatDateTime(h.createdAt)}
                    {h.conversationId ? (
                      <Link
                        href={`/app/conversations/${h.conversationId}`}
                        className="mt-0.5 flex w-fit items-center gap-0.5 rounded text-xs font-medium text-brand-700 hover:underline focus-visible:outline-2 focus-visible:outline-brand-600"
                      >
                        View conversation
                        <ArrowUpRight className="size-3" aria-hidden />
                      </Link>
                    ) : null}
                  </Td>
                  <Td>
                    <Truncate text={h.name ?? "Unknown"} className="font-medium text-slate-900" />
                    {h.email ? (
                      <a
                        href={`mailto:${h.email}`}
                        title={h.email}
                        className="mt-0.5 flex max-w-xs items-center gap-1 truncate rounded text-xs text-brand-700 hover:underline focus-visible:outline-2 focus-visible:outline-brand-600"
                      >
                        <Mail className="size-3 shrink-0" aria-hidden />
                        <span className="truncate">{h.email}</span>
                      </a>
                    ) : null}
                    {h.phone ? (
                      <span className="mt-0.5 flex items-center gap-1 text-xs text-slate-500">
                        <Phone className="size-3 shrink-0" aria-hidden />
                        <Truncate text={h.phone} />
                      </span>
                    ) : null}
                  </Td>
                  <Td>
                    <Truncate text={h.message} className="max-w-md" />
                  </Td>
                  <Td>
                    <Badge tone={h.status === "open" ? "amber" : "gray"} dot>
                      {h.status}
                    </Badge>
                  </Td>
                  <Td className="text-right">
                    <form action={setHandoffStatus}>
                      <input type="hidden" name="id" value={h.id} />
                      <input type="hidden" name="status" value={h.status === "open" ? "closed" : "open"} />
                      <SubmitButton variant="secondary" size="sm" pendingLabel="...">
                        {h.status === "open" ? <Check aria-hidden /> : <RotateCcw aria-hidden />}
                        {h.status === "open" ? "Mark closed" : "Reopen"}
                      </SubmitButton>
                    </form>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
