import "server-only";
import { and, asc, eq, inArray } from "drizzle-orm";
import type { CollectedData, CollectedValue, CollectField, VisitorAttributes, WebhookEvent } from "@talkfront/shared";
import { db } from "@/db";
import { agents, conversations, handoffRequests, messages } from "@/db/schema";
import { orderCollected, readCollectFields } from "@/lib/collect";
import { appUrl } from "@/lib/env";
import { randomUrlSafe } from "@/lib/ids";

// Event bodies sent to webhook endpoints (docs/integrations.md, "Webhooks"). Field names are snake_case
// and every timestamp inside `data` is an ISO 8601 string in UTC; `created` on the envelope is unix seconds.
// Changing a field here changes a public contract: update the docs page (app/docs) and the spec too.

export type WebhookEnvelope = {
  id: string;
  type: WebhookEvent;
  created: number;
  workspace_id: string;
  data: Record<string, unknown>;
};

export type WebhookVisitor = {
  id: string | null;
  name: string | null;
  email: string | null;
  phone?: string | null;
  verified: boolean;
  attributes: VisitorAttributes;
};

export type ConversationEndedData = {
  conversation: {
    id: string;
    mode: "voice" | "text";
    channel: string;
    started_at: string;
    ended_at: string | null;
    duration_sec: number;
    ended_reason: string | null;
    summary: string | null;
    handoff_requested: boolean;
    page_url: string | null;
    page_title: string | null;
    dashboard_url: string;
  };
  agent: { id: string; name: string };
  visitor: WebhookVisitor;
  /**
   * What was gathered (built-in fields, then the agent's own under `custom` with their label and type);
   * null values = not mentioned. null when nothing could be collected (no messages, or the step failed).
   */
  collected: CollectedData | null;
  transcript: { role: "user" | "assistant"; content: string; created_at: string }[];
  test?: true;
};

export type HandoffData = {
  handoff: {
    id: string;
    status: "open" | "closed";
    message: string;
    created_at: string;
    dashboard_url: string;
  };
  visitor: WebhookVisitor;
  conversation: { id: string; page_url: string | null; dashboard_url: string } | null;
  agent: { id: string; name: string } | null;
};

/** Longest transcript sent in one event; longer conversations keep their last messages. */
const MAX_TRANSCRIPT = 500;

export const newEventId = () => `evt_${randomUrlSafe(24)}`;

export function envelope(type: WebhookEvent, workspaceId: string, data: Record<string, unknown>): WebhookEnvelope {
  return { id: newEventId(), type, created: Math.floor(Date.now() / 1000), workspace_id: workspaceId, data };
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);
export const conversationLink = (id: string) => `${appUrl()}/app/conversations/${encodeURIComponent(id)}`;
const handoffsLink = () => `${appUrl()}/app/handoffs`;

/** `conversation.ended` for a real conversation, or null when it no longer exists. */
export async function conversationEndedEvent(conversationId: string): Promise<WebhookEnvelope | null> {
  const [row] = await db
    .select({ c: conversations, agentName: agents.name, collectFields: agents.collectFields })
    .from(conversations)
    .innerJoin(agents, eq(agents.id, conversations.agentId))
    .where(eq(conversations.id, conversationId))
    .limit(1);
  if (!row) return null;
  const c = row.c;

  const lines = await db
    .select({ role: messages.role, content: messages.content, createdAt: messages.createdAt })
    .from(messages)
    .where(and(eq(messages.conversationId, c.id), inArray(messages.role, ["user", "assistant"])))
    .orderBy(asc(messages.createdAt));

  const data: ConversationEndedData = {
    conversation: {
      id: c.id,
      mode: c.mode,
      channel: c.channel,
      started_at: c.startedAt.toISOString(),
      ended_at: iso(c.endedAt),
      duration_sec: c.durationSec,
      ended_reason: c.endedReason,
      summary: c.summary,
      handoff_requested: c.handoffRequested,
      page_url: c.pageUrl,
      page_title: c.pageTitle,
      dashboard_url: conversationLink(c.id),
    },
    agent: { id: c.agentId, name: row.agentName },
    visitor: {
      id: c.visitorId,
      name: c.visitorName,
      email: c.visitorEmail,
      verified: c.visitorVerified,
      attributes: c.visitorAttributes ?? {},
    },
    collected: c.collectedData ? orderCollected(c.collectedData, readCollectFields(row.collectFields).map((f) => f.key)) : null,
    transcript: lines.slice(-MAX_TRANSCRIPT).map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
      created_at: m.createdAt.toISOString(),
    })),
  };
  return envelope("conversation.ended", c.organizationId, data);
}

/** `handoff.created` / `handoff.updated`, or null when the handoff no longer exists. */
export async function handoffEvent(handoffId: string, created: boolean): Promise<WebhookEnvelope | null> {
  const [row] = await db
    .select({ h: handoffRequests, c: conversations, agentName: agents.name })
    .from(handoffRequests)
    .leftJoin(conversations, eq(conversations.id, handoffRequests.conversationId))
    .leftJoin(agents, eq(agents.id, conversations.agentId))
    .where(eq(handoffRequests.id, handoffId))
    .limit(1);
  if (!row) return null;
  const { h, c } = row;

  const data: HandoffData = {
    handoff: {
      id: h.id,
      status: h.status,
      message: h.message,
      created_at: h.createdAt.toISOString(),
      dashboard_url: handoffsLink(),
    },
    visitor: {
      id: c?.visitorId ?? null,
      name: h.name ?? c?.visitorName ?? null,
      email: h.email ?? c?.visitorEmail ?? null,
      phone: h.phone,
      verified: c?.visitorVerified ?? false,
      attributes: c?.visitorAttributes ?? {},
    },
    conversation: c ? { id: c.id, page_url: c.pageUrl, dashboard_url: conversationLink(c.id) } : null,
    agent: c && row.agentName ? { id: c.agentId, name: row.agentName } : null,
  };
  return envelope(created ? "handoff.created" : "handoff.updated", h.organizationId, data);
}

/**
 * A realistic `conversation.ended` for "Send test event": invented visitor, real agent name when the
 * workspace has one, and `data.test = true` so receivers can skip it.
 */
export async function sampleConversationEndedEvent(workspaceId: string): Promise<WebhookEnvelope> {
  const [agentRow] = await db
    .select({ id: agents.id, name: agents.name, collectFields: agents.collectFields })
    .from(agents)
    .where(eq(agents.organizationId, workspaceId))
    .orderBy(asc(agents.createdAt))
    .limit(1);
  const agent = agentRow ? { id: agentRow.id, name: agentRow.name } : null;
  // The agent's own fields with sample values, so receivers can map them before a real conversation.
  const fields = agentRow ? readCollectFields(agentRow.collectFields) : [];
  const custom: CollectedData["custom"] = fields.length
    ? Object.fromEntries(fields.map((f) => [f.key, { label: f.label, type: f.type, value: sampleValue(f) }]))
    : { order_number: { label: "Order number", type: "text", value: "4471" } };
  const ended = new Date();
  const started = new Date(ended.getTime() - 94_000);
  const at = (sec: number) => new Date(started.getTime() + sec * 1000).toISOString();
  const id = `conv_test_${randomUrlSafe(12)}`;

  const data: ConversationEndedData = {
    conversation: {
      id,
      mode: "text",
      channel: "web",
      started_at: started.toISOString(),
      ended_at: ended.toISOString(),
      duration_sec: 94,
      ended_reason: "visitor_left",
      summary: "The visitor asked whether their order can still be changed. The agent explained the 2 hour window and offered a callback, which the visitor accepted.",
      handoff_requested: true,
      page_url: "https://example.com/orders",
      page_title: "Your orders",
      dashboard_url: conversationLink(id),
    },
    agent: agent ?? { id: "agent_test", name: "Support agent" },
    visitor: {
      id: "user_1042",
      name: "Alex Rivera",
      email: "alex@example.com",
      verified: true,
      attributes: { plan: "pro", open_orders: 1 },
    },
    collected: {
      visitor_name: "Alex Rivera",
      email: null,
      phone: "+1 555 0100",
      topic: "changing an order",
      outcome: "message_taken",
      follow_up_needed: true,
      sentiment: "neutral",
      custom,
    },
    transcript: [
      { role: "assistant", content: "Hi, how can I help today?", created_at: at(0) },
      { role: "user", content: "Can I still change my order? I picked the wrong size.", created_at: at(9) },
      {
        role: "assistant",
        content: "Orders can be changed within 2 hours of being placed. Yours was placed 3 hours ago, so I can ask the team to call you about it. Is that OK?",
        created_at: at(14),
      },
      { role: "user", content: "Yes please.", created_at: at(31) },
      { role: "assistant", content: "Done. Someone from the team will call you today.", created_at: at(36) },
    ],
    test: true,
  };
  return envelope("conversation.ended", workspaceId, data);
}

function sampleValue(f: CollectField): CollectedValue {
  switch (f.type) {
    case "number":
      return 2;
    case "yes_no":
      return true;
    case "date":
      return new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
    case "email":
      return "alex@example.com";
    case "phone":
      return "+1 555 0100";
    case "choice":
      return f.options?.[0] ?? null;
    default:
      return "Sample text";
  }
}
