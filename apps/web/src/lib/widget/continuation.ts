import "server-only";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { conversations, messages } from "@/db/schema";
import { earlierLines, type EarlierLine } from "@/lib/earlier-chat";

/** A chat is continued only from a conversation this recent (one page visit, not yesterday's chat). */
const MAX_AGE_MS = 6 * 60 * 60 * 1000;
/** How many conversations back one chat is followed (type, talk, type, ...). */
const MAX_CHAIN = 5;
/**
 * The earlier conversation's agent saves its last lines when it ends, usually within a second of the
 * visitor switching. The runtime request waits this long for that (the agent allows it 5 s in all).
 */
const WAIT_FOR_END_MS = 2500;
const POLL_MS = 250;
/** Messages read from the earlier conversations; the prompt keeps only the newest few anyway. */
const MAX_ROWS = 200;

type Agent = { id: string; organizationId: string };

/**
 * The conversation a new widget session may continue: same workspace, same agent, same visitor, from
 * the website widget and recent. Anything else is ignored (the session simply starts fresh).
 */
export async function continuableFrom(conversationId: string, agent: Agent, visitorId: string | null) {
  if (!visitorId) return null;
  const [row] = await db
    .select({
      id: conversations.id,
      visitorId: conversations.visitorId,
      visitorName: conversations.visitorName,
      visitorEmail: conversations.visitorEmail,
      channel: conversations.channel,
      startedAt: conversations.startedAt,
    })
    .from(conversations)
    .where(
      and(
        eq(conversations.id, conversationId),
        eq(conversations.organizationId, agent.organizationId),
        eq(conversations.agentId, agent.id),
      ),
    )
    .limit(1);
  if (!row || row.visitorId !== visitorId || row.channel !== "web") return null;
  if (Date.now() - row.startedAt.getTime() > MAX_AGE_MS) return null;
  return row;
}

/** What was said in the conversations this one continues, newest lines last. [] = nothing to carry over. */
export async function loadEarlierChat(c: {
  continuedFromId: string | null;
  organizationId: string;
  agentId: string;
}): Promise<EarlierLine[]> {
  const chain: { id: string; status: string }[] = [];
  let next = c.continuedFromId;
  while (next && chain.length < MAX_CHAIN && !chain.some((x) => x.id === next)) {
    const [row] = await db
      .select({ id: conversations.id, status: conversations.status, continuedFromId: conversations.continuedFromId })
      .from(conversations)
      .where(
        and(
          eq(conversations.id, next),
          eq(conversations.organizationId, c.organizationId),
          eq(conversations.agentId, c.agentId),
        ),
      )
      .limit(1);
    if (!row) break;
    chain.push(row);
    next = row.continuedFromId;
  }
  if (chain.length === 0) return [];
  if (chain[0]!.status === "active") await waitForEnd(chain[0]!.id);

  const rows = await db
    .select({ role: messages.role, content: messages.content })
    .from(messages)
    .where(inArray(messages.conversationId, chain.map((x) => x.id)))
    .orderBy(desc(messages.createdAt))
    .limit(MAX_ROWS);
  return earlierLines(rows.reverse());
}

async function waitForEnd(conversationId: string): Promise<void> {
  const deadline = Date.now() + WAIT_FOR_END_MS;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    const [row] = await db
      .select({ status: conversations.status })
      .from(conversations)
      .where(eq(conversations.id, conversationId))
      .limit(1);
    if (!row || row.status !== "active") return;
  }
  // Still running (the visitor switched mid-reply, or its agent is slow): use what is saved so far.
}
