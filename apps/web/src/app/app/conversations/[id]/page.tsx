import { and, asc, eq } from "drizzle-orm";
import type { CollectedData, CollectedValue, CollectFieldType } from "@talkfront/shared";
import { ClipboardList, FileText, Flag, Info, ListTree } from "lucide-react";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { Badge, Card, CardHeader, cx, EmptyState, ModeBadge, PageHeader } from "@/components/ui";
import { db } from "@/db";
import { agents, conversations, messages } from "@/db/schema";
import { displayValue, orderCollected, OUTCOME_LABELS, OUTCOME_TONES, readCollectFields, SENTIMENT_LABELS } from "@/lib/collect";
import { formatDateTime, formatDuration } from "@/lib/format";
import { requireWorkspace } from "@/lib/session";
import { canDeleteConversations } from "../roles";
import { DeleteConversationButton } from "./delete-button";

export const metadata = { title: "Conversation" };

export default async function ConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { organizationId, role } = await requireWorkspace();
  const [row] = await db
    .select({ c: conversations, agentName: agents.name, collectFields: agents.collectFields })
    .from(conversations)
    .innerJoin(agents, eq(agents.id, conversations.agentId))
    .where(and(eq(conversations.id, id), eq(conversations.organizationId, organizationId)))
    .limit(1);
  if (!row) notFound();
  const { c } = row;

  const transcript = await db
    .select({ id: messages.id, role: messages.role, content: messages.content, createdAt: messages.createdAt })
    .from(messages)
    .where(eq(messages.conversationId, c.id))
    .orderBy(asc(messages.createdAt));

  const details: [string, React.ReactNode][] = [
    ["Agent", row.agentName],
    ["Mode", <ModeBadge key="m" mode={c.mode} />],
    ...(c.channel === "phone" || c.channel === "whatsapp"
      ? ([
          ["Channel", c.channel === "phone" ? "Phone call" : "WhatsApp"],
          ["From", c.visitorId ? (c.channel === "whatsapp" ? `+${c.visitorId}` : c.visitorId) : "Hidden number"],
        ] as [string, React.ReactNode][])
      : []),
    ["Started", formatDateTime(c.startedAt)],
    ["Duration", c.status === "active" ? "In progress" : formatDuration(c.durationSec)],
    ["Ended because", c.endedReason?.replace(/_/g, " ") ?? "-"],
    ["Visitor", [c.visitorName, c.visitorEmail].filter(Boolean).join(" · ") || "Anonymous"],
    [
      "Page",
      c.pageUrl && /^https?:\/\//i.test(c.pageUrl) ? (
        <a key="p" href={c.pageUrl} target="_blank" rel="noreferrer noopener" title={c.pageUrl} className="block truncate text-brand-700 hover:underline">
          {c.pageTitle || c.pageUrl}
        </a>
      ) : (
        "-"
      ),
    ],
  ];

  return (
    <>
      <PageHeader
        title="Conversation"
        back={{ href: "/app/conversations", label: "Conversations" }}
        description={`${row.agentName} · ${formatDateTime(c.startedAt)}`}
        action={canDeleteConversations(role) ? <DeleteConversationButton conversationId={c.id} live={c.status === "active"} /> : undefined}
        badge={
          <>
            {c.status === "active" ? (
              <Badge tone="green" dot>
                live
              </Badge>
            ) : null}
            {c.handoffRequested ? <Badge tone="amber">handoff requested</Badge> : null}
          </>
        }
      />

      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card>
          <CardHeader title="Transcript" icon={ListTree} description={`${transcript.length} message${transcript.length === 1 ? "" : "s"}`} />
          {transcript.length === 0 ? (
            <EmptyState icon={ListTree} title="No messages recorded" />
          ) : (
            <ol className="space-y-3 p-4 sm:p-5">
              {transcript.map((m) => (
                <li key={m.id} className={cx("flex", m.role === "user" ? "justify-end" : "justify-start")}>
                  <div
                    className={cx(
                      "max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-sm leading-6",
                      m.role === "user" && "rounded-br-md bg-brand-600 text-white",
                      m.role === "assistant" && "rounded-bl-md border border-slate-200/80 bg-slate-50 text-slate-900",
                      // A person from the team who took the conversation over (live inbox).
                      m.role === "staff" && "rounded-bl-md border border-amber-200 bg-amber-50 text-slate-900",
                      (m.role === "tool" || m.role === "system") && "rounded-lg border border-dashed border-slate-200 bg-white font-mono text-xs text-slate-500",
                    )}
                  >
                    {m.role === "tool" || m.role === "system" ? <span className="mr-1 font-semibold">{m.role}:</span> : null}
                    {m.role === "staff" ? <span className="block text-[11px] font-semibold text-amber-800">Team</span> : null}
                    {m.content}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Summary" icon={FileText} />
            <p className="p-5 text-sm leading-6 text-slate-700">
              {c.summary ?? (c.status === "active" ? "Written when the conversation ends." : "No summary.")}
            </p>
          </Card>
          <CollectedCard status={c.status} data={c.collectedData} fieldOrder={readCollectFields(row.collectFields).map((f) => f.key)} />
          <Card>
            <CardHeader title="Details" icon={Info} />
            <dl className="divide-y divide-slate-100 text-sm">
              {details.map(([label, value]) => (
                <div key={label} className="flex items-center justify-between gap-4 px-5 py-2.5">
                  <dt className="shrink-0 text-slate-500">{label}</dt>
                  <dd className="min-w-0 text-right text-slate-900">{value}</dd>
                </div>
              ))}
            </dl>
          </Card>
        </div>
      </div>
    </>
  );
}

function NotMentioned() {
  return <span className="text-slate-400">Not mentioned</span>;
}

function CollectedValueText({ type, value }: { type: CollectFieldType; value: CollectedValue }) {
  const text = displayValue(type, value);
  if (text === null) return <NotMentioned />;
  if (type === "email" && typeof value === "string") {
    return (
      <a href={`mailto:${value}`} className="text-brand-700 hover:underline">
        {text}
      </a>
    );
  }
  if (type === "phone" && typeof value === "string") {
    return (
      <a href={`tel:${value.replace(/[^\d+]/g, "")}`} className="text-brand-700 hover:underline">
        {text}
      </a>
    );
  }
  return <>{text}</>;
}

/**
 * What the summary step gathered. Custom fields follow the agent's current order; values for fields
 * deleted since keep the label they had and come last. Fields added later are not shown.
 */
function CollectedCard({ status, data, fieldOrder }: { status: "active" | "ended"; data: CollectedData | null; fieldOrder: string[] }) {
  let body: ReactNode;
  if (status === "active") {
    body = <p className="p-5 text-sm leading-6 text-slate-500">Collected when the conversation ends.</p>;
  } else if (!data) {
    body = <p className="p-5 text-sm leading-6 text-slate-500">Nothing was collected for this conversation.</p>;
  } else {
    const { custom } = orderCollected(data, fieldOrder);
    const keys = Object.keys(custom);
    const rows: [string, ReactNode][] = [
      ["Topic", data.topic ?? <NotMentioned key="t" />],
      ["Sentiment", data.sentiment ? SENTIMENT_LABELS[data.sentiment] : <NotMentioned key="s" />],
      ["Name", data.visitor_name ?? <NotMentioned key="n" />],
      ["Email", <CollectedValueText key="e" type="email" value={data.email} />],
      ["Phone", <CollectedValueText key="p" type="phone" value={data.phone} />],
      ...keys.map((k): [string, ReactNode] => [custom[k]!.label, <CollectedValueText key={k} type={custom[k]!.type} value={custom[k]!.value} />]),
    ];
    body = (
      <>
        {data.outcome || data.follow_up_needed !== null ? (
          <div className="flex flex-wrap gap-1.5 px-5 pt-4">
            {data.outcome ? (
              <Badge tone={OUTCOME_TONES[data.outcome]} dot>
                {OUTCOME_LABELS[data.outcome]}
              </Badge>
            ) : null}
            {data.follow_up_needed ? (
              <Badge tone="amber" icon={Flag}>
                Follow-up needed
              </Badge>
            ) : data.follow_up_needed === false ? (
              <Badge tone="gray">No follow-up</Badge>
            ) : null}
          </div>
        ) : null}
        <dl className="divide-y divide-slate-100 pt-1.5 text-sm">
          {rows.map(([label, value], i) => (
            <div key={`${label}-${i}`} className="flex items-start justify-between gap-4 px-5 py-2.5">
              <dt className="max-w-[45%] shrink-0 text-slate-500 [overflow-wrap:anywhere]">{label}</dt>
              <dd className="min-w-0 text-right text-slate-900 [overflow-wrap:anywhere]">{value}</dd>
            </div>
          ))}
        </dl>
      </>
    );
  }
  return (
    <Card>
      <CardHeader title="Collected information" icon={ClipboardList} />
      {body}
    </Card>
  );
}
