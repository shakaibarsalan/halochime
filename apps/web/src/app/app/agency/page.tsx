import { and, asc, count, eq, gte, inArray } from "drizzle-orm";
import { Bot, Building2, Inbox, MessagesSquare, Wallet } from "lucide-react";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { db } from "@/db";
import { agents, conversations, handoffRequests, member, organization, wallets, workspaceBranding } from "@/db/schema";
import { formatMinutes } from "@/lib/format";
import { requireWorkspace } from "@/lib/session";
import { SwitchWorkspaceButton } from "./switch-button";

export const metadata = { title: "Agency" };

const ROLE_LABEL: Record<string, string> = { owner: "Owner", admin: "Admin", member: "Member" };
const roleLabel = (r: string) =>
  r
    .split(",")
    .map((x) => ROLE_LABEL[x.trim()] ?? x.trim())
    .join(", ");

/** Every workspace the signed-in user belongs to, with its key numbers, and a quick switch. */
export default async function AgencyPage() {
  const ws = await requireWorkspace();
  const memberships = await db
    .select({ id: organization.id, name: organization.name, role: member.role })
    .from(member)
    .innerJoin(organization, eq(organization.id, member.organizationId))
    .where(eq(member.userId, ws.user.id))
    .orderBy(asc(organization.name));
  // Only workspaces this user is a member of: every query below is limited to these ids.
  const ids = memberships.map((m) => m.id);

  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const [convRows, walletRows, agentRows, handoffRows, brandRows] = ids.length
    ? await Promise.all([
        db
          .select({ org: conversations.organizationId, n: count() })
          .from(conversations)
          .where(and(inArray(conversations.organizationId, ids), gte(conversations.startedAt, monthStart)))
          .groupBy(conversations.organizationId),
        db.select({ org: wallets.organizationId, balance: wallets.balanceSeconds }).from(wallets).where(inArray(wallets.organizationId, ids)),
        db
          .select({ org: agents.organizationId, status: agents.status, n: count() })
          .from(agents)
          .where(inArray(agents.organizationId, ids))
          .groupBy(agents.organizationId, agents.status),
        db
          .select({ org: handoffRequests.organizationId, n: count() })
          .from(handoffRequests)
          .where(and(inArray(handoffRequests.organizationId, ids), eq(handoffRequests.status, "open")))
          .groupBy(handoffRequests.organizationId),
        db
          .select({ org: workspaceBranding.organizationId, brandName: workspaceBranding.brandName })
          .from(workspaceBranding)
          .where(inArray(workspaceBranding.organizationId, ids)),
      ])
    : [[], [], [], [], []];

  const conv = new Map(convRows.map((r) => [r.org, r.n]));
  const balance = new Map(walletRows.map((r) => [r.org, r.balance]));
  const handoffs = new Map(handoffRows.map((r) => [r.org, r.n]));
  const brand = new Map(brandRows.map((r) => [r.org, r.brandName?.trim() || null]));
  const agentCount = new Map<string, { all: number; live: number }>();
  for (const r of agentRows) {
    const c = agentCount.get(r.org) ?? { all: 0, live: 0 };
    c.all += r.n;
    if (r.status === "published") c.live += r.n;
    agentCount.set(r.org, c);
  }
  const month = new Intl.DateTimeFormat("en", { month: "long", timeZone: "UTC" }).format(now);
  const totals = {
    conversations: [...conv.values()].reduce((a, b) => a + b, 0),
    handoffs: [...handoffs.values()].reduce((a, b) => a + b, 0),
  };

  return (
    <>
      <PageHeader
        title="Agency"
        description={`All ${memberships.length} workspaces you belong to. ${totals.conversations} conversations in ${month}, ${totals.handoffs} open handoffs in total.`}
      />
      {memberships.length === 0 ? (
        <Card>
          <EmptyState title="No workspaces" icon={Building2} />
        </Card>
      ) : (
        <ul className="grid grid-cols-[minmax(0,1fr)] gap-4 md:grid-cols-2">
          {memberships.map((m) => {
            const current = m.id === ws.organizationId;
            const a = agentCount.get(m.id) ?? { all: 0, live: 0 };
            const secs = balance.get(m.id) ?? 0;
            const open = handoffs.get(m.id) ?? 0;
            const by = brand.get(m.id);
            return (
              <li key={m.id}>
                <Card className="flex h-full flex-col">
                  <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
                    <div className="min-w-0">
                      <p className="truncate text-[15px] font-semibold text-slate-900" title={m.name}>
                        {m.name}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-slate-500" title={by ? `${roleLabel(m.role)}, brand ${by}` : roleLabel(m.role)}>
                        {roleLabel(m.role)}
                        {by ? `, brand ${by}` : ""}
                      </p>
                    </div>
                    {current ? (
                      <Badge tone="green" dot>
                        Open now
                      </Badge>
                    ) : (
                      <SwitchWorkspaceButton organizationId={m.id} name={m.name} />
                    )}
                  </div>
                  <dl className="grid flex-1 grid-cols-2 gap-3 p-5">
                    <Stat icon={MessagesSquare} label={`In ${month}`} value={String(conv.get(m.id) ?? 0)} hint="conversations" />
                    <Stat
                      icon={Wallet}
                      label="Minutes left"
                      value={formatMinutes(secs).replace(" min", "")}
                      hint="voice minutes"
                      tone={secs <= 0 ? "red" : secs < 5 * 60 ? "amber" : undefined}
                    />
                    <Stat icon={Bot} label="Agents" value={String(a.all)} hint={`${a.live} live`} />
                    <Stat icon={Inbox} label="Handoffs" value={String(open)} hint="open" tone={open > 0 ? "amber" : undefined} />
                  </dl>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  hint,
  tone,
}: {
  icon: typeof Bot;
  label: string;
  value: string;
  hint: string;
  tone?: "red" | "amber";
}) {
  return (
    <div className="min-w-0 rounded-xl bg-slate-50 px-3 py-2.5 ring-1 ring-slate-200/70">
      <dt className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
        <Icon className="size-3.5 shrink-0" aria-hidden />
        <span className="truncate" title={label}>
          {label}
        </span>
      </dt>
      <dd
        className={
          "mt-1 text-xl font-semibold tabular-nums " + (tone === "red" ? "text-red-700" : tone === "amber" ? "text-amber-700" : "text-slate-900")
        }
      >
        {value}
      </dd>
      <dd className="truncate text-xs text-slate-500" title={hint}>
        {hint}
      </dd>
    </div>
  );
}
