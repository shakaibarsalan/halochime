import "server-only";
import type { ConversationOutcome } from "@talkfront/shared";
import { and, count, desc, eq, gte, inArray, like, max, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { agents, conversations, handoffRequests, messages, usageEvents } from "@/db/schema";

// Analytics for one workspace (and optionally one of its agents) since a given time.
// Everything is a SQL aggregate: no conversation rows are loaded except the short "unanswered" list.
// Every query filters on organizationId; the agent id must already be checked to belong to it.

export type Scope = { organizationId: string; agentId: string | null; since: Date };

const DAY_MS = 86_400_000;

/** Start of the UTC day `days - 1` days ago, so "last 7 days" is today plus the 6 days before. */
export function periodStart(days: number, now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - (days - 1) * DAY_MS);
}

const cd = conversations.collectedData;
const outcome = sql`${cd}->>'outcome'`;
const n = (cond: SQL) => sql<number>`count(*) filter (where ${cond})`.mapWith(Number);

function conversationWhere(s: Scope, ...extra: SQL[]) {
  return and(
    eq(conversations.organizationId, s.organizationId),
    gte(conversations.startedAt, s.since),
    s.agentId ? eq(conversations.agentId, s.agentId) : undefined,
    ...extra,
  );
}

/** Ids of the chosen agent's conversations, for tables that only link to a conversation. */
const agentConversationIds = (s: Scope, agentId: string) =>
  db
    .select({ id: conversations.id })
    .from(conversations)
    .where(and(eq(conversations.organizationId, s.organizationId), eq(conversations.agentId, agentId)));

export async function getTotals(s: Scope) {
  const [row] = await db
    .select({
      total: count(),
      voice: n(sql`${conversations.mode} = 'voice'`),
      text: n(sql`${conversations.mode} = 'text'`),
      avgVoiceSec: sql<number | null>`avg(${conversations.durationSec}) filter (where ${conversations.mode} = 'voice' and ${conversations.status} = 'ended' and ${conversations.durationSec} > 0)`.mapWith(
        Number,
      ),
      withOutcome: n(sql`${outcome} in ('answered', 'message_taken', 'not_answered', 'other')`),
      answered: n(sql`${outcome} = 'answered'`),
      messageTaken: n(sql`${outcome} = 'message_taken'`),
      notAnswered: n(sql`${outcome} = 'not_answered'`),
      other: n(sql`${outcome} = 'other'`),
      // jsonb comparison, not a ::boolean cast, so an odd value can never break the query.
      followUps: n(sql`${cd}->'follow_up_needed' = 'true'::jsonb`),
      positive: n(sql`${cd}->>'sentiment' = 'positive'`),
      neutral: n(sql`${cd}->>'sentiment' = 'neutral'`),
      negative: n(sql`${cd}->>'sentiment' = 'negative'`),
    })
    .from(conversations)
    .where(conversationWhere(s));
  return row!;
}

/** Billed voice seconds (what the wallet was charged), from the usage ledger like the Billing page. */
export async function getVoiceSecondsBilled(s: Scope): Promise<number> {
  const [row] = await db
    .select({ seconds: sql<number>`coalesce(-sum(${usageEvents.seconds}), 0)`.mapWith(Number) })
    .from(usageEvents)
    .where(
      and(
        eq(usageEvents.organizationId, s.organizationId),
        eq(usageEvents.kind, "voice_seconds"),
        gte(usageEvents.createdAt, s.since),
        s.agentId ? inArray(usageEvents.conversationId, agentConversationIds(s, s.agentId)) : undefined,
      ),
    );
  return row?.seconds ?? 0;
}

export async function getMessagesLeft(s: Scope): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(handoffRequests)
    .where(
      and(
        eq(handoffRequests.organizationId, s.organizationId),
        gte(handoffRequests.createdAt, s.since),
        s.agentId ? inArray(handoffRequests.conversationId, agentConversationIds(s, s.agentId)) : undefined,
      ),
    );
  return row?.n ?? 0;
}

const dayKey = sql<string>`to_char(${conversations.startedAt} at time zone 'UTC', 'YYYY-MM-DD')`;

/** Conversations per UTC day; days with none are missing (the page fills them in). */
export function getPerDay(s: Scope) {
  return db
    .select({ day: dayKey, total: count(), voice: n(sql`${conversations.mode} = 'voice'`) })
    .from(conversations)
    .where(conversationWhere(s))
    .groupBy(dayKey);
}

// Topic as one comparable string: whitespace collapsed, trimmed, lower-cased.
const topicKey = sql<string>`lower(btrim(regexp_replace(${cd}->>'topic', '\\s+', ' ', 'g')))`;

export function getTopTopics(s: Scope) {
  return db
    .select({ topic: topicKey, total: count(), answered: n(sql`${outcome} = 'answered'`) })
    .from(conversations)
    .where(conversationWhere(s, sql`jsonb_typeof(${cd}->'topic') = 'string'`, sql`${topicKey} <> ''`))
    .groupBy(topicKey)
    .orderBy(desc(count()), topicKey)
    .limit(10);
}

export function getUnanswered(s: Scope) {
  return db
    .select({
      id: conversations.id,
      startedAt: conversations.startedAt,
      mode: conversations.mode,
      topic: sql<string | null>`nullif(btrim(${cd}->>'topic'), '')`,
      summary: conversations.summary,
      agentName: agents.name,
    })
    .from(conversations)
    .innerJoin(agents, eq(agents.id, conversations.agentId))
    .where(conversationWhere(s, sql`${outcome} = 'not_answered'`))
    .orderBy(desc(conversations.startedAt))
    .limit(10);
}

// A knowledge search that found nothing is saved by the agent (transcript.py describe_tool_call) as
//   search_knowledge {"query": "refunds"} -> ok: No matching information was found in the knowledge base ...
// The JSON is json.dumps output, cut to 200 characters with a trailing "…" when long. The capture is the
// query as a JSON string body (\" and \\ still escaped); the page unescapes it for display.
const NO_RESULTS_RE = `^search_knowledge \\{"query": "(.*)(?:"\\}|…) -> ok: No matching information`;
const gapQuery = sql<string>`substring(${messages.content} from ${sql.raw(`'${NO_RESULTS_RE}'`)})`;
const gapKey = sql<string>`lower(btrim(regexp_replace(${gapQuery}, '\\s+', ' ', 'g')))`;

export async function getKnowledgeGaps(s: Scope) {
  const rows = await db
    .select({
      key: gapKey,
      // The wording of the latest search in the group, and the conversation it came from.
      query: sql<string>`(array_agg(${gapQuery} order by ${messages.createdAt} desc))[1]`,
      conversationId: sql<string>`(array_agg(${conversations.id} order by ${messages.createdAt} desc))[1]`,
      total: count(),
      conversations: sql<number>`count(distinct ${conversations.id})`.mapWith(Number),
      latestAt: max(messages.createdAt),
    })
    .from(messages)
    .innerJoin(conversations, eq(conversations.id, messages.conversationId))
    .where(
      conversationWhere(
        s,
        eq(messages.role, "tool"),
        like(messages.content, "search_knowledge %"),
        like(messages.content, "%-> ok: No matching information%"),
      ),
    )
    .groupBy(gapKey)
    .having(sql`${gapKey} <> ''`)
    .orderBy(desc(count()), desc(max(messages.createdAt)))
    .limit(15);
  return rows.map((r) => ({ ...r, query: unescapeJsonString(r.query) }));
}

function unescapeJsonString(body: string): string {
  try {
    const v: unknown = JSON.parse(`"${body}"`);
    if (typeof v === "string") return v;
  } catch {
    // Cut mid escape (a long query); fall through to the simple replacements.
  }
  return body.replace(/\\(["\\/])/g, "$1");
}

export function getWorkspaceAgents(organizationId: string) {
  return db.select({ id: agents.id, name: agents.name }).from(agents).where(eq(agents.organizationId, organizationId)).orderBy(agents.name);
}

export type Totals = Awaited<ReturnType<typeof getTotals>>;
export const OUTCOME_KEYS: Record<ConversationOutcome, keyof Totals> = {
  answered: "answered",
  message_taken: "messageTaken",
  not_answered: "notAnswered",
  other: "other",
};
