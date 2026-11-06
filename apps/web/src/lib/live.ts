import "server-only";
import { TOPIC_STAFF } from "@talkfront/shared";
import { and, asc, desc, eq, gt, sql } from "drizzle-orm";
import { DataPacket_Kind, RoomServiceClient, type ParticipantInfo } from "livekit-server-sdk";
import { db } from "@/db";
import { agents, conversations, messages } from "@/db/schema";
import { livekitEnv } from "./env";
import { SESSION_LIMITS } from "./widget/limits";

// Live inbox: the workspace's conversations happening now, and the commands that let a team member take
// one over from the AI (the agent side is apps/agent/src/talkfront_agent/takeover.py).

/** Only conversations started this recently count as live: the same window as the session limits. */
export const LIVE_WINDOW_MIN = SESSION_LIMITS.activeWindowMin;
/** Messages sent to the live view at most (a call is at most an hour; this is far more than one holds). */
const MAX_LIVE_MESSAGES = 500;
const MAX_LIVE_ROWS = 100;

const liveWindow = () => sql`now() - make_interval(mins => ${LIVE_WINDOW_MIN})`;
const isLive = (organizationId: string) =>
  and(eq(conversations.organizationId, organizationId), eq(conversations.status, "active"), gt(conversations.startedAt, liveWindow()));

export type LiveRow = {
  id: string;
  agentName: string;
  mode: "voice" | "text";
  visitorName: string | null;
  visitorEmail: string | null;
  pageUrl: string | null;
  pageTitle: string | null;
  startedAt: string;
  lastVisitorLine: string | null;
  takenOverByName: string | null;
  takenOverByMe: boolean;
};

export async function countLive(organizationId: string): Promise<number> {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(conversations).where(isLive(organizationId));
  return Number(row?.n ?? 0);
}

export async function listLive(organizationId: string, userId: string): Promise<LiveRow[]> {
  const rows = await db
    .select({
      id: conversations.id,
      agentName: agents.name,
      mode: conversations.mode,
      visitorName: conversations.visitorName,
      visitorEmail: conversations.visitorEmail,
      pageUrl: conversations.pageUrl,
      pageTitle: conversations.pageTitle,
      startedAt: conversations.startedAt,
      takenOverByUserId: conversations.takenOverByUserId,
      takenOverByName: conversations.takenOverByName,
      lastVisitorLine: sql<string | null>`(
        select ${messages.content} from ${messages}
        where ${messages.conversationId} = ${conversations.id} and ${messages.role} = 'user'
        order by ${messages.createdAt} desc limit 1)`,
    })
    .from(conversations)
    .innerJoin(agents, eq(agents.id, conversations.agentId))
    .where(isLive(organizationId))
    .orderBy(desc(conversations.startedAt))
    .limit(MAX_LIVE_ROWS);
  return rows.map(({ takenOverByUserId, startedAt, ...r }) => ({
    ...r,
    startedAt: startedAt.toISOString(),
    takenOverByName: takenOverByUserId ? (r.takenOverByName ?? "A team member") : null,
    takenOverByMe: takenOverByUserId === userId,
  }));
}

export type LiveConversation = {
  id: string;
  live: boolean;
  agentName: string;
  mode: "voice" | "text";
  visitorName: string | null;
  visitorEmail: string | null;
  pageUrl: string | null;
  pageTitle: string | null;
  startedAt: string;
  takenOverByName: string | null;
  takenOverByMe: boolean;
  takenOverAt: string | null;
  messages: { id: string; role: "user" | "assistant" | "tool" | "system" | "staff"; content: string; createdAt: string }[];
};

/** One conversation of the workspace with its messages so far, or null when it is not theirs. */
export async function getLiveConversation(organizationId: string, userId: string, id: string): Promise<LiveConversation | null> {
  const [c] = await db
    .select({
      id: conversations.id,
      status: conversations.status,
      recent: sql<boolean>`${conversations.startedAt} > ${liveWindow()}`,
      agentName: agents.name,
      mode: conversations.mode,
      visitorName: conversations.visitorName,
      visitorEmail: conversations.visitorEmail,
      pageUrl: conversations.pageUrl,
      pageTitle: conversations.pageTitle,
      startedAt: conversations.startedAt,
      takenOverByUserId: conversations.takenOverByUserId,
      takenOverByName: conversations.takenOverByName,
      takenOverAt: conversations.takenOverAt,
    })
    .from(conversations)
    .innerJoin(agents, eq(agents.id, conversations.agentId))
    .where(and(eq(conversations.id, id), eq(conversations.organizationId, organizationId)))
    .limit(1);
  if (!c) return null;
  const rows = await db
    .select({ id: messages.id, role: messages.role, content: messages.content, createdAt: messages.createdAt })
    .from(messages)
    .where(eq(messages.conversationId, c.id))
    .orderBy(asc(messages.createdAt), asc(messages.id))
    .limit(MAX_LIVE_MESSAGES);
  const live = c.status === "active" && Boolean(c.recent);
  const held = live && c.takenOverByUserId !== null;
  return {
    id: c.id,
    live,
    agentName: c.agentName,
    mode: c.mode,
    visitorName: c.visitorName,
    visitorEmail: c.visitorEmail,
    pageUrl: c.pageUrl,
    pageTitle: c.pageTitle,
    startedAt: c.startedAt.toISOString(),
    takenOverByName: held ? (c.takenOverByName ?? "A team member") : null,
    takenOverByMe: held && c.takenOverByUserId === userId,
    takenOverAt: held && c.takenOverAt ? c.takenOverAt.toISOString() : null,
    messages: rows.map((m) => ({ ...m, createdAt: m.createdAt.toISOString() })),
  };
}

/** The conversation's room, when it is live in this workspace. */
export async function liveRoom(
  organizationId: string,
  id: string,
): Promise<{ roomName: string; takenOverByUserId: string | null } | null> {
  const [c] = await db
    .select({ roomName: conversations.roomName, takenOverByUserId: conversations.takenOverByUserId })
    .from(conversations)
    .where(and(eq(conversations.id, id), isLive(organizationId)))
    .limit(1);
  return c ?? null;
}

export async function setTakeover(
  organizationId: string,
  id: string,
  by: { userId: string; name: string } | null,
): Promise<void> {
  await db
    .update(conversations)
    .set(
      by
        ? { takenOverByUserId: by.userId, takenOverByName: by.name, takenOverAt: new Date() }
        : { takenOverByUserId: null, takenOverByName: null, takenOverAt: null },
    )
    .where(and(eq(conversations.id, id), eq(conversations.organizationId, organizationId)));
}

// ---------------------------------------------------------------------------------- LiveKit

export type StaffCommand =
  | { type: "takeover"; name: string }
  | { type: "say"; text: string; id: string; name: string }
  | { type: "release" };

export type SendResult = "sent" | "no_agent" | "not_configured" | "failed";

/** livekit.ParticipantInfo.Kind.AGENT (the enum is not exported by livekit-server-sdk). */
const PARTICIPANT_KIND_AGENT = 4;

/** Our agent worker in a room: an AGENT participant, or (older servers) one named "agent-...". */
export function isAgentParticipant(p: Pick<ParticipantInfo, "kind" | "identity">): boolean {
  return Number(p.kind) === PARTICIPANT_KIND_AGENT || p.identity.startsWith("agent-");
}

/**
 * Sends one command to the agent in the conversation's room, and to nobody else: the visitor never
 * receives these. The agent only acts on data sent by the server (see takeover.py).
 */
export async function sendStaffCommand(roomName: string, command: StaffCommand): Promise<SendResult> {
  const env = livekitEnv();
  if (!env) return "not_configured";
  const client = new RoomServiceClient(env.url.replace(/^ws/, "http"), env.apiKey, env.apiSecret);
  try {
    const participants = await client.listParticipants(roomName);
    const agent = participants.find(isAgentParticipant);
    if (!agent) return "no_agent";
    await client.sendData(roomName, new TextEncoder().encode(JSON.stringify(command)), DataPacket_Kind.RELIABLE, {
      destinationIdentities: [agent.identity],
      topic: TOPIC_STAFF,
    });
    return "sent";
  } catch (err) {
    // A room that is gone (the call just ended) lands here too.
    console.error("live inbox: staff command failed", err instanceof Error ? err.message : err);
    return "failed";
  }
}
