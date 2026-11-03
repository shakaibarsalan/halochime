import { count, desc, eq } from "drizzle-orm";
import { Bot, Plus } from "lucide-react";
import Link from "next/link";
import { SubmitButton } from "@/components/form-bits";
import { AgentStatusBadge, Card, EmptyState, PageHeader, Table, Td, Th, Tr, Truncate } from "@/components/ui";
import { db } from "@/db";
import { agents, conversations } from "@/db/schema";
import { formatDateTime } from "@/lib/format";
import { languageLabel } from "@/lib/languages";
import { requireWorkspace } from "@/lib/session";
import { createAgent } from "./actions";

export const metadata = { title: "Agents" };

export default async function AgentsPage() {
  const { organizationId } = await requireWorkspace();
  const rows = await db
    .select({
      id: agents.id,
      name: agents.name,
      status: agents.status,
      language: agents.language,
      allowedDomains: agents.allowedDomains,
      updatedAt: agents.updatedAt,
      conversations: count(conversations.id),
    })
    .from(agents)
    .leftJoin(conversations, eq(conversations.agentId, agents.id))
    .where(eq(agents.organizationId, organizationId))
    .groupBy(agents.id)
    .orderBy(desc(agents.createdAt));

  const showDomains = rows.some((a) => a.allowedDomains.length > 0);

  return (
    <>
      <PageHeader
        title="Agents"
        description="Each agent has its own persona, voice, widget look and embed key."
        action={
          <form action={createAgent}>
            <SubmitButton pendingLabel="Creating...">
              <Plus aria-hidden />
              New agent
            </SubmitButton>
          </form>
        }
      />
      <Card>
        {rows.length === 0 ? (
          <EmptyState
            icon={Bot}
            title="No agents yet"
            action={
              <form action={createAgent}>
                <SubmitButton pendingLabel="Creating...">
                  <Plus aria-hidden />
                  Create your first agent
                </SubmitButton>
              </form>
            }
          >
            Create one to get your embed snippet.
          </EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Status</Th>
                <Th>Language</Th>
                {showDomains ? <Th>Allowed domains</Th> : null}
                <Th>Conversations</Th>
                <Th>Updated</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <Tr key={a.id}>
                  <Td>
                    <Link
                      href={`/app/agents/${a.id}`}
                      className="group flex items-center gap-3 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
                    >
                      <span className="orb size-8 shrink-0" aria-hidden />
                      <Truncate text={a.name} className="max-w-[14rem] font-medium text-slate-900 group-hover:text-brand-700 group-hover:underline" />
                    </Link>
                  </Td>
                  <Td>
                    <AgentStatusBadge status={a.status} />
                  </Td>
                  <Td>{languageLabel(a.language)}</Td>
                  {showDomains ? (
                    <Td>
                      <Truncate text={a.allowedDomains.join(", ") || null} className="font-mono text-xs" />
                    </Td>
                  ) : null}
                  <Td className="tabular-nums">{a.conversations}</Td>
                  <Td className="whitespace-nowrap">{formatDateTime(a.updatedAt)}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
