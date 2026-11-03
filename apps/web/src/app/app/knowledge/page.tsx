import { asc, desc, eq } from "drizzle-orm";
import { FileText, Globe, Library, Type } from "lucide-react";
import { Badge, Card, CardHeader, EmptyState, PageHeader, Table, Td, Th, Tr, Truncate } from "@/components/ui";
import { db } from "@/db";
import { agents, knowledgeSources } from "@/db/schema";
import { formatDateTime } from "@/lib/format";
import { requireWorkspace } from "@/lib/session";
import { AddSourceForms, DeleteSourceButton } from "./forms";

export const metadata = { title: "Knowledge" };
// Server Actions take the page's limit: a whole-site import runs for up to ~45 s, a 4 MB PDF a few seconds.
export const maxDuration = 60;

const statusTone = { ready: "green", processing: "blue", pending: "gray", failed: "red" } as const;
const typeIcon = { text: Type, url: Globe, file: FileText } as const;
const typeLabel = { text: "Text", url: "Web page", file: "File" } as const;

export default async function KnowledgePage() {
  const { organizationId } = await requireWorkspace();
  const [sources, agentList] = await Promise.all([
    db
      .select({
        id: knowledgeSources.id,
        type: knowledgeSources.type,
        title: knowledgeSources.title,
        url: knowledgeSources.url,
        status: knowledgeSources.status,
        error: knowledgeSources.error,
        chunkCount: knowledgeSources.chunkCount,
        charCount: knowledgeSources.charCount,
        agentName: agents.name,
        createdAt: knowledgeSources.createdAt,
      })
      .from(knowledgeSources)
      .leftJoin(agents, eq(agents.id, knowledgeSources.agentId))
      .where(eq(knowledgeSources.organizationId, organizationId))
      .orderBy(desc(knowledgeSources.createdAt)),
    db
      .select({ id: agents.id, name: agents.name })
      .from(agents)
      .where(eq(agents.organizationId, organizationId))
      .orderBy(asc(agents.createdAt)),
  ]);

  return (
    <>
      <PageHeader title="Knowledge" description="What your agents answer from. Shared sources are used by every agent." />
      <div className="space-y-6">
        <AddSourceForms agents={agentList} />
        <Card>
          <CardHeader
            title="Sources"
            icon={Library}
            description={`${sources.length} source${sources.length === 1 ? "" : "s"}`}
          />
          {sources.length === 0 ? (
            <EmptyState icon={Library} title="No knowledge yet">
              Paste your FAQ, upload a PDF or import your website above to get started.
            </EmptyState>
          ) : (
            <Table minWidth={600}>
              <thead>
                <tr>
                  <Th>Title</Th>
                  <Th>Used by</Th>
                  <Th>Status</Th>
                  <Th className="hidden xl:table-cell">Size</Th>
                  <Th className="hidden lg:table-cell">Added</Th>
                  <Th className="text-right">
                    <span className="sr-only">Actions</span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {sources.map((s) => {
                  const Icon = typeIcon[s.type];
                  return (
                    <Tr key={s.id}>
                      <Td>
                        <div className="flex items-center gap-3">
                          <span
                            className="grid size-8 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-500"
                            title={typeLabel[s.type]}
                          >
                            <Icon className="size-4" aria-hidden />
                            <span className="sr-only">{typeLabel[s.type]}</span>
                          </span>
                          <div className="min-w-0">
                            <Truncate text={s.title} className="font-medium text-slate-900" />
                            {s.url ? <Truncate text={s.url} className="text-xs text-slate-500" /> : null}
                            <span className="block text-xs text-slate-500 xl:hidden">
                              {s.chunkCount} chunks · {Math.round(s.charCount / 100) / 10}k chars
                            </span>
                          </div>
                        </div>
                      </Td>
                      <Td>
                        {s.agentName ? (
                          <Truncate text={`Only ${s.agentName}`} className="max-w-[12rem]" />
                        ) : (
                          <Badge tone="blue">All agents</Badge>
                        )}
                      </Td>
                      <Td>
                        <Badge tone={statusTone[s.status]} dot>
                          {s.status}
                        </Badge>
                        {s.error ? <Truncate text={s.error} className="mt-1 max-w-[14rem] text-xs text-red-600" /> : null}
                      </Td>
                      <Td className="hidden whitespace-nowrap tabular-nums text-slate-500 xl:table-cell">
                        {s.chunkCount} chunks · {Math.round(s.charCount / 100) / 10}k chars
                      </Td>
                      <Td className="hidden whitespace-nowrap text-slate-500 lg:table-cell">{formatDateTime(s.createdAt)}</Td>
                      <Td className="text-right">
                        <DeleteSourceButton id={s.id} title={s.title} />
                      </Td>
                    </Tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
