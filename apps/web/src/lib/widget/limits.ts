import "server-only";
import { sql } from "drizzle-orm";
import type { ConversationMode, WidgetErrorCode } from "@talkfront/shared";
import { db, type Db } from "@/db";
import { conversations, wallets } from "@/db/schema";

// Limits for POST /api/widget/session, kept in the database (the `conversations` table), so they hold
// across every Vercel instance. The public key is in page HTML and Origin can be faked outside a
// browser, so these are what stop someone draining a business's minutes or running up platform costs.
// The in-memory per-IP limiter in the route stays in front as a cheap first layer.

export const SESSION_LIMITS = {
  /** New sessions per agent in the last minute (any mode, any status). */
  perAgentPerMinute: 60,
  /** Conversations running at once per workspace, by mode. */
  maxActiveVoice: 10,
  maxActiveText: 50,
  /**
   * Only conversations started this recently count as running. The longest call an owner can set is
   * 60 minutes (agents/actions.ts), plus 5 minutes of slack. A call that crashed without being closed
   * stops counting after this, even before the stale-conversation sweep ends it.
   */
  activeWindowMin: 65,
  /** Voice: the wallet must hold this many seconds for every call running plus the new one. */
  reserveSecondsPerCall: 60,
  /** Seconds a session request may wait for another one of the same workspace to finish its check. */
  lockWaitSec: 3,
} as const;

export type SessionLimits = { [K in keyof typeof SESSION_LIMITS]: number };

/** What the database says right now for one workspace + agent. */
export type SessionUsage = {
  /** Sessions this agent started in the last minute. */
  agentRecent: number;
  /** Workspace conversations still "active" and started within activeWindowMin. */
  activeVoice: number;
  activeText: number;
  /** Wallet balance; null when the workspace has no wallet row (treated as 0). */
  balanceSeconds: number | null;
};

export type LimitRefusal = {
  status: 402 | 429;
  code: Extract<WidgetErrorCode, "out_of_credit" | "rate_limited">;
  message: string;
  retryAfterSec?: number;
};

// ---------------------------------------------------------------------------------- pure helpers

/** Seconds of balance a new voice call needs: the reserve for every running call plus this one. */
export function voiceSecondsNeeded(activeVoice: number, limits: SessionLimits = SESSION_LIMITS): number {
  return (Math.max(0, activeVoice) + 1) * limits.reserveSecondsPerCall;
}

/**
 * Whether a new session may start, given current usage. null = yes, otherwise the refusal to send.
 * Order: a burst on the agent first; then, for voice, credit before "lines busy", because the widget
 * offers "Type instead" on out_of_credit, which is the more useful answer when both apply.
 * The widget shows its own copy per code (packages/widget/src/widget.ts errorText); the messages here
 * are for logs and API users.
 */
export function checkSessionLimits(
  mode: ConversationMode,
  usage: SessionUsage,
  limits: SessionLimits = SESSION_LIMITS,
): LimitRefusal | null {
  if (usage.agentRecent >= limits.perAgentPerMinute) {
    return {
      status: 429,
      code: "rate_limited",
      message: "This assistant is starting too many conversations right now. Please try again in a minute.",
      retryAfterSec: 60,
    };
  }
  if (mode === "voice") {
    if ((usage.balanceSeconds ?? 0) < voiceSecondsNeeded(usage.activeVoice, limits)) {
      // Same code and message as before these limits, so nothing changes for the widget or API users.
      return { status: 402, code: "out_of_credit", message: "This business is out of voice minutes." };
    }
    if (usage.activeVoice >= limits.maxActiveVoice) {
      return {
        status: 429,
        code: "rate_limited",
        message: "All voice lines for this business are busy. Please try again in a few minutes.",
        retryAfterSec: 60,
      };
    }
    return null;
  }
  if (usage.activeText >= limits.maxActiveText) {
    return {
      status: 429,
      code: "rate_limited",
      message: "This business has too many open chats right now. Please try again in a few minutes.",
      retryAfterSec: 60,
    };
  }
  return null;
}

// ---------------------------------------------------------------------------------- database

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * One query, on the conversations_org_started_idx index (organization_id, started_at): only this
 * workspace's conversations from the last activeWindowMin minutes are read. now() is the database
 * clock, so instance clock drift does not matter.
 */
async function readUsage(
  runner: Db | Tx,
  organizationId: string,
  agentId: string,
  limits: SessionLimits,
): Promise<SessionUsage> {
  const rows = await runner.execute<{
    agent_recent: number;
    active_voice: number;
    active_text: number;
    balance: number | null;
  }>(sql`
    select
      count(*) filter (where c.agent_id = ${agentId} and c.started_at > now() - interval '1 minute')::int as agent_recent,
      count(*) filter (where c.status = 'active' and c.mode = 'voice')::int as active_voice,
      count(*) filter (where c.status = 'active' and c.mode = 'text')::int as active_text,
      (select w.balance_seconds from ${wallets} w where w.organization_id = ${organizationId}) as balance
    from ${conversations} c
    where c.organization_id = ${organizationId}
      and c.started_at > now() - make_interval(mins => ${limits.activeWindowMin})`);
  const row = rows[0];
  return {
    agentRecent: Number(row?.agent_recent ?? 0),
    activeVoice: Number(row?.active_voice ?? 0),
    activeText: Number(row?.active_text ?? 0),
    balanceSeconds: row?.balance == null ? null : Number(row.balance),
  };
}

const BUSY: LimitRefusal = {
  status: 429,
  code: "rate_limited",
  message: "This business is getting a lot of conversations right now. Please try again in a moment.",
  retryAfterSec: 30,
};

/** Postgres "lock_not_available" (lock_timeout hit); drizzle may wrap the driver error in `cause`. */
function isLockTimeout(e: unknown): boolean {
  const code = (x: unknown) => (x && typeof x === "object" && "code" in x ? (x as { code: unknown }).code : undefined);
  return code(e) === "55P03" || code((e as { cause?: unknown } | null)?.cause) === "55P03";
}

/**
 * Checks the limits and, only when they allow it, runs `insert` (which must create the conversation
 * row with the given transaction). Returns null when the session was created, or the refusal.
 *
 * Counting and inserting happen under a per-workspace advisory lock, so a burst of parallel requests
 * cannot all see "9 calls running" and all start: each one counts the rows the previous one inserted.
 * A cheap unlocked check runs first, so once a workspace is at its limits, a flood of requests is
 * refused without queueing on the lock; lock_timeout keeps any queue short.
 */
export async function startSessionWithinLimits(
  input: { organizationId: string; agentId: string; mode: ConversationMode },
  insert: (tx: Tx) => Promise<unknown>,
  limits: SessionLimits = SESSION_LIMITS,
): Promise<LimitRefusal | null> {
  const { organizationId, agentId, mode } = input;

  const early = checkSessionLimits(mode, await readUsage(db, organizationId, agentId, limits), limits);
  if (early) return early;

  try {
    return await db.transaction(async (tx) => {
      // SET does not take bind parameters; the value is our own number, not input.
      await tx.execute(sql.raw(`set local lock_timeout = '${Math.max(1, Math.floor(limits.lockWaitSec))}s'`));
      // Transaction-scoped, so it is released on commit or rollback (also safe behind a pooler).
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${"widget-session:" + organizationId}, 0))`);
      const refusal = checkSessionLimits(mode, await readUsage(tx, organizationId, agentId, limits), limits);
      if (refusal) return refusal;
      await insert(tx);
      return null;
    });
  } catch (e) {
    if (isLockTimeout(e)) return BUSY;
    throw e;
  }
}
