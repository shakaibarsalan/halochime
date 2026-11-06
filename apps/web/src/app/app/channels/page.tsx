import { and, asc, eq } from "drizzle-orm";
import { Bot } from "lucide-react";
import { AgentStatusBadge, ButtonLink, Card, EmptyState, PageHeader } from "@/components/ui";
import { db } from "@/db";
import { agentChannels, agents } from "@/db/schema";
import { phoneChannelAvailable, phoneSipHost } from "@/lib/channels/livekit-sip";
import { audioAvailable } from "@/lib/channels/openai-audio";
import { originationUri } from "@/lib/channels/phone";
import { type ChannelRow, phoneConfig, whatsappConfig } from "@/lib/channels/store";
import { appUrl } from "@/lib/env";
import { requireWorkspace } from "@/lib/session";
import { canManageIntegrations } from "../agents/[id]/roles";
import { AgentPicker, type ChannelStatus, PhoneCard, type PhoneView, WhatsappCard, type WhatsappView } from "./channels-client";

export const metadata = { title: "Channels" };

const status = (row: ChannelRow | undefined): ChannelStatus => ({
  enabled: row?.enabled ?? false,
  lastEventAt: row?.lastEventAt?.toISOString() ?? null,
  lastError: row?.lastError ?? null,
  lastErrorAt: row?.lastErrorAt?.toISOString() ?? null,
});

export default async function ChannelsPage({ searchParams }: { searchParams: Promise<{ agent?: string }> }) {
  const ws = await requireWorkspace();
  const list = await db
    .select({ id: agents.id, name: agents.name, status: agents.status })
    .from(agents)
    .where(eq(agents.organizationId, ws.organizationId))
    .orderBy(asc(agents.createdAt));

  const header = <PageHeader title="Channels" description="Let the same agent answer phone calls and WhatsApp, not only your website." />;
  if (list.length === 0) {
    return (
      <>
        {header}
        <Card>
          <EmptyState
            title="Create an agent first"
            icon={Bot}
            action={
              <ButtonLink href="/app/agents">
                <Bot aria-hidden />
                Go to Agents
              </ButtonLink>
            }
          >
            Channels belong to an agent. Once you have one, you can connect a phone number and WhatsApp here.
          </EmptyState>
        </Card>
      </>
    );
  }

  const wanted = (await searchParams).agent;
  const agent = list.find((a) => a.id === wanted) ?? list.find((a) => a.status === "published") ?? list[0]!;
  const rows = await db
    .select()
    .from(agentChannels)
    .where(and(eq(agentChannels.organizationId, ws.organizationId), eq(agentChannels.agentId, agent.id)));
  const phoneRow = rows.find((r) => r.kind === "phone");
  const waRow = rows.find((r) => r.kind === "whatsapp");
  const host = phoneSipHost();

  // Only what the page needs: no tokens or passwords, only their last 4 characters.
  const phone: PhoneView = {
    ...status(phoneRow),
    available: phoneChannelAvailable(),
    sipHost: host,
    originationUri: host ? originationUri(host) : null,
    saved: phoneRow?.externalId
      ? {
          number: phoneRow.externalId,
          provider: phoneConfig(phoneRow).provider,
          allowedAddresses: phoneConfig(phoneRow).allowedAddresses,
          authUsername: phoneConfig(phoneRow).authUsername,
          passwordHint: phoneRow.secretHints.authPassword ?? null,
        }
      : null,
  };
  const whatsapp: WhatsappView = {
    ...status(waRow),
    audioAvailable: audioAvailable(),
    webhookUrl: waRow ? `${appUrl()}/api/channels/whatsapp/${waRow.id}` : null,
    saved: waRow
      ? { phoneNumberId: whatsappConfig(waRow).phoneNumberId, replyWithVoice: whatsappConfig(waRow).replyWithVoice, hints: waRow.secretHints }
      : null,
  };
  const canManage = canManageIntegrations(ws.role);

  return (
    <>
      {header}
      <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-sm font-medium text-slate-800">Agent</span>
          {list.length > 1 ? null : (
            <span className="truncate text-sm text-slate-600" title={agent.name}>
              {agent.name}
            </span>
          )}
          <AgentStatusBadge status={agent.status} />
        </div>
        {list.length > 1 ? <AgentPicker agents={list} current={agent.id} /> : null}
      </div>
      {!canManage ? (
        <p className="mb-6 text-sm text-slate-500">Only owners and admins can set up channels. You can see how they are set up.</p>
      ) : null}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 xl:grid-cols-2">
        <PhoneCard key={`phone-${agent.id}`} agentId={agent.id} view={phone} canManage={canManage} />
        <WhatsappCard key={`wa-${agent.id}`} agentId={agent.id} view={whatsapp} canManage={canManage} />
      </div>
    </>
  );
}
