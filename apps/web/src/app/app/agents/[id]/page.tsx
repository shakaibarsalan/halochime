import { and, eq } from "drizzle-orm";
import { Code2, TriangleAlert } from "lucide-react";
import { notFound } from "next/navigation";
import { CopyButton } from "@/components/form-bits";
import { AgentStatusBadge, Card, CardHeader, PageHeader } from "@/components/ui";
import { db } from "@/db";
import { agents } from "@/db/schema";
import { readCollectFields } from "@/lib/collect";
import { appUrl } from "@/lib/env";
import { requireWorkspace } from "@/lib/session";
import { ActionsPanel } from "./actions-panel";
import { AgentEditor } from "./agent-editor";
import { CollectPanel } from "./collect-panel";
import { IdentityPanel } from "./identity-panel";
import { loadActionViews } from "./integrations-data";
import { canManageIntegrations } from "./roles";
import { TryIt } from "./try-it";

export const metadata = { title: "Agent" };

export default async function AgentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { organizationId, role } = await requireWorkspace();
  const [agent] = await db
    .select()
    .from(agents)
    .where(and(eq(agents.id, id), eq(agents.organizationId, organizationId)))
    .limit(1);
  if (!agent) notFound();
  const actions = await loadActionViews(organizationId, agent.id);
  const canManage = canManageIntegrations(role);

  const snippet = `<script src="${appUrl()}/widget.js" data-key="${agent.publicKey}" async></script>`;

  return (
    <>
      <PageHeader
        title={agent.name}
        back={{ href: "/app/agents", label: "Agents" }}
        badge={<AgentStatusBadge status={agent.status} />}
        description="Edit how this agent talks, what it looks like and where it runs."
      />

      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-6">
          <AgentEditor
            agent={{
              id: agent.id,
              name: agent.name,
              persona: agent.persona,
              instructions: agent.instructions,
              greeting: agent.greeting,
              language: agent.language,
              sttModel: agent.sttModel,
              ttsVoice: agent.ttsVoice,
              llmModel: agent.llmModel,
              maxDurationSec: agent.maxDurationSec,
              handoffEnabled: agent.handoffEnabled,
              handoffEmail: agent.handoffEmail ?? "",
              theme: agent.theme,
              imageUrl: agent.theme.imageVersion
                ? `/api/widget/image/${encodeURIComponent(agent.id)}?v=${agent.theme.imageVersion}`
                : null,
              modes: agent.modes,
              allowedDomains: agent.allowedDomains,
              published: agent.status === "published",
            }}
            canManage={canManage}
          />
          <CollectPanel agentId={agent.id} fields={readCollectFields(agent.collectFields)} canManage={canManage} />
          <IdentityPanel
            agentId={agent.id}
            hasSecret={agent.identitySecret !== null}
            canManage={canManage}
            scriptUrl={`${appUrl()}/widget.js`}
            publicKey={agent.publicKey}
          />
          <ActionsPanel agentId={agent.id} actions={actions} canManage={canManage} />
        </div>

        <div className="order-first grid content-start items-start gap-6 md:grid-cols-2 xl:sticky xl:top-10 xl:order-none xl:grid-cols-1 xl:self-start">
          <TryIt publicKey={agent.publicKey} />
          <Card id="embed">
            <CardHeader title="Embed" icon={Code2} description="Paste this before </body> on your website or user portal." />
            <div className="space-y-3 p-5">
              <pre className="whitespace-pre-wrap rounded-xl bg-ink p-3.5 font-mono text-xs leading-5 text-slate-200 [overflow-wrap:anywhere]">
                <code>{snippet}</code>
              </pre>
              <div className="flex items-center justify-between gap-3">
                <span className="min-w-0 truncate font-mono text-xs text-slate-500" title={agent.publicKey}>
                  {agent.publicKey}
                </span>
                <CopyButton text={snippet} label="Copy snippet" />
              </div>
              {agent.status !== "published" ? (
                <p className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 ring-1 ring-amber-200/70">
                  <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
                  Draft: it only loads here in the dashboard until you publish it.
                </p>
              ) : agent.allowedDomains.length === 0 ? (
                <p className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 ring-1 ring-amber-200/70">
                  <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
                  Add your website&apos;s domain under Where it runs so it can load there.
                </p>
              ) : null}
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
