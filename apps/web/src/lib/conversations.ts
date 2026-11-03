import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { agents, conversations, organization, usageEvents, wallets } from "@/db/schema";

export async function getConversationWithAgent(conversationId: string) {
  const [row] = await db
    .select({ conversation: conversations, agent: agents, businessName: organization.name })
    .from(conversations)
    .innerJoin(agents, and(eq(agents.id, conversations.agentId), eq(agents.organizationId, conversations.organizationId)))
    .innerJoin(organization, eq(organization.id, conversations.organizationId))
    .where(eq(conversations.id, conversationId))
    .limit(1);
  return row ?? null;
}

/**
 * Safety net for conversations whose agent never reported the end (worker crashed or was
 * restarted mid-call): close them once they are well past the agent's time limit. Nothing is
 * billed, because the real duration is unknown.
 */
export async function sweepStaleConversations(): Promise<number> {
  const rows = await db.execute(sql`
    update ${conversations} c
       set status = 'ended', ended_at = now(), ended_reason = 'abandoned'
      from ${agents} a
     where a.id = c.agent_id
       and c.status = 'active'
       and c.started_at < now() - make_interval(secs => a.max_duration_sec + 600)
    returning c.id`);
  return rows.length;
}

/** Under this many seconds of voice left, owners and admins get a "running low" email. */
export const LOW_BALANCE_SECONDS = 5 * 60;

/**
 * Whether a deduction should trigger the low / out of minutes email: the first drop under
 * 5 minutes (until the balance goes up again), and again when it reaches 0.
 */
function needsLowBalanceEmail(before: number, after: number, notifiedAt: Date | null): boolean {
  if (after <= 0) return before > 0;
  return after < LOW_BALANCE_SECONDS && notifiedAt === null;
}

/**
 * Adds voice seconds (top up, refund, manual credit) and re-arms the low-balance email.
 * Any code that raises a balance must go through here or clear low_balance_notified_at itself.
 */
export async function creditWallet(
  organizationId: string,
  seconds: number,
  entry: { kind: "trial" | "topup"; note: string },
): Promise<void> {
  if (!Number.isInteger(seconds) || seconds <= 0) throw new Error("creditWallet: seconds must be a positive integer");
  await db.transaction(async (tx) => {
    await tx
      .insert(wallets)
      .values({ organizationId, balanceSeconds: seconds })
      .onConflictDoUpdate({
        target: wallets.organizationId,
        set: { balanceSeconds: sql`${wallets.balanceSeconds} + ${seconds}`, lowBalanceNotifiedAt: null },
      });
    await tx.insert(usageEvents).values({ organizationId, kind: entry.kind, seconds, note: entry.note });
  });
}

/** Voice is billed in whole minutes, rounded up. */
export const billableSeconds = (durationSec: number) => Math.ceil(Math.max(0, durationSec) / 60) * 60;

/**
 * Ends a conversation once. Only the call that flips status active -> ended bills, so retries
 * and duplicate /end calls are harmless. Returns null when the conversation does not exist.
 */
export async function endConversation(
  conversationId: string,
  input: { endedReason: string; durationSec: number },
): Promise<{ ended: boolean } | null> {
  return db.transaction(async (tx) => {
    const [conv] = await tx
      .select({ startedAt: conversations.startedAt })
      .from(conversations)
      .where(eq(conversations.id, conversationId))
      .limit(1);
    if (!conv) return null;

    // Never bill more than the wall-clock time since the session started (plus a minute of slack).
    const elapsed = Math.ceil((Date.now() - conv.startedAt.getTime()) / 1000) + 60;
    const durationSec = Math.min(input.durationSec, Math.max(0, elapsed));

    const [updated] = await tx
      .update(conversations)
      .set({ status: "ended", endedAt: new Date(), durationSec, endedReason: input.endedReason })
      .where(and(eq(conversations.id, conversationId), eq(conversations.status, "active")))
      .returning({ organizationId: conversations.organizationId, mode: conversations.mode });
    if (!updated) return { ended: false };

    if (updated.mode === "voice") {
      const seconds = billableSeconds(durationSec);
      if (seconds > 0) {
        const [wallet] = await tx
          .update(wallets)
          .set({ balanceSeconds: sql`${wallets.balanceSeconds} - ${seconds}` })
          .where(eq(wallets.organizationId, updated.organizationId))
          .returning({ balance: wallets.balanceSeconds, notifiedAt: wallets.lowBalanceNotifiedAt });
        if (wallet && needsLowBalanceEmail(wallet.balance + seconds, wallet.balance, wallet.notifiedAt)) {
          // now() is this transaction's time, the same as the usage row below gets: the email step
          // (lib/email/notify.ts) uses that match to know this call is the one that should warn.
          await tx
            .update(wallets)
            .set({ lowBalanceNotifiedAt: sql`now()` })
            .where(eq(wallets.organizationId, updated.organizationId));
        }
      }
      await tx.insert(usageEvents).values({
        organizationId: updated.organizationId,
        conversationId,
        kind: "voice_seconds",
        seconds: -seconds,
        note: `Voice call: ${durationSec}s, billed ${seconds / 60} min`,
      });
    } else {
      await tx.insert(usageEvents).values({
        organizationId: updated.organizationId,
        conversationId,
        kind: "text_session",
        seconds: 0,
        note: "Text chat",
      });
    }
    return { ended: true };
  });
}
