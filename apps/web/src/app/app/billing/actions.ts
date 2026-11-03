"use server";

import { and, eq, gt, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionState } from "@/components/form-bits";
import { db } from "@/db";
import { minuteRequests, wallets } from "@/db/schema";
import { inBackground, sendQuietly } from "@/lib/email/send";
import { minutesRequestedEmail, minutesRequestOwnerEmail } from "@/lib/email/templates";
import { supportAddress } from "@/lib/email/transport";
import { rateLimit } from "@/lib/rate-limit";
import { requireWorkspace } from "@/lib/session";
import { canRequestMinutes, MAX_REQUEST_MINUTES, MIN_REQUEST_MINUTES, NOTE_MAX } from "./roles";

// Voice minutes are sold by hand: the request emails the Halochime owner, who replies with a payment
// link and, once paid, credits the minutes (scripts/credit-minutes.ts). No prices live in the app.

const range = `Enter between ${MIN_REQUEST_MINUTES} and ${MAX_REQUEST_MINUTES.toLocaleString("en-US")} minutes.`;

const RequestInput = z.object({
  minutes: z.coerce
    .number({ error: range })
    .int("Use a whole number of minutes.")
    .min(MIN_REQUEST_MINUTES, range)
    .max(MAX_REQUEST_MINUTES, range),
  note: z.string().trim().max(NOTE_MAX, `Keep the note under ${NOTE_MAX} characters.`),
});

/** Per server instance (lib/rate-limit.ts), plus a daily cap in the database that holds across instances. */
const PER_HOUR = 3;
const PER_DAY = 6;

class OwnerEmailFailed extends Error {}

const isUniqueViolation = (err: unknown) => {
  const e = err as { code?: string; cause?: { code?: string } } | null;
  return e?.code === "23505" || e?.cause?.code === "23505";
};

export async function requestMinutes(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ws = await requireWorkspace();
  if (!canRequestMinutes(ws.role)) return { error: "Only owners and admins can request minutes. Ask one of them." };

  const preset = formData.get("preset");
  const minutes = preset === "custom" ? formData.get("customMinutes") : preset;
  const note = formData.get("note");
  const parsed = RequestInput.safeParse({ minutes: minutes ?? "", note: typeof note === "string" ? note : "" });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form." };

  const limit = rateLimit(`minutes-request:${ws.organizationId}`, PER_HOUR, 60 * 60 * 1000);
  if (!limit.ok) {
    const wait = Math.max(1, Math.ceil(limit.retryAfterSec / 60));
    return { error: `You've sent a few requests already. Try again in ${wait} ${wait === 1 ? "minute" : "minutes"}.` };
  }

  const [[wallet], [today]] = await Promise.all([
    db.select({ balance: wallets.balanceSeconds }).from(wallets).where(eq(wallets.organizationId, ws.organizationId)),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(minuteRequests)
      .where(and(eq(minuteRequests.organizationId, ws.organizationId), gt(minuteRequests.createdAt, sql`now() - interval '1 day'`))),
  ]);
  if ((today?.n ?? 0) >= PER_DAY) {
    return { error: "That's the most requests for one day. To change your open request, reply to our confirmation email." };
  }

  const to = supportAddress();
  if (!to) {
    console.error("[billing] minutes request not sent: set SUPPORT_EMAIL or EMAIL_FROM");
    return { error: "Requests can't be sent right now. Please try again later." };
  }

  const { minutes: amount, note: text } = parsed.data;
  const requester = { name: ws.user.name, email: ws.user.email };
  try {
    // The owner email goes out inside the transaction: if it fails, nothing is saved and the open
    // request (if any) stays as it was, so the page never shows a request the owner never got.
    await db.transaction(async (tx) => {
      const [replaced] = await tx
        .update(minuteRequests)
        .set({ status: "replaced", closedAt: sql`now()` })
        .where(and(eq(minuteRequests.organizationId, ws.organizationId), eq(minuteRequests.status, "open")))
        .returning({ minutes: minuteRequests.minutes, createdAt: minuteRequests.createdAt });
      await tx.insert(minuteRequests).values({
        organizationId: ws.organizationId,
        requestedBy: ws.user.id,
        requesterName: requester.name,
        requesterEmail: requester.email,
        minutes: amount,
        note: text || null,
      });
      const email = minutesRequestOwnerEmail({
        workspace: ws.organizationName,
        workspaceId: ws.organizationId,
        requester,
        minutes: amount,
        note: text || null,
        balanceSeconds: wallet?.balance ?? 0,
        replaces: replaced ?? null,
      });
      // Reply-To the requester, so the owner can answer with the payment link straight away.
      if (!(await sendQuietly(to, email, requester.email))) throw new OwnerEmailFailed();
    });
  } catch (err) {
    if (err instanceof OwnerEmailFailed) return { error: "We couldn't send your request. Please try again in a few minutes." };
    if (isUniqueViolation(err)) return { error: "Another request was sent at the same moment. Refresh the page to see it." };
    console.error("[billing] minutes request failed", err);
    return { error: "Could not send your request. Please try again." };
  }

  // Replies to the confirmation reach the owner too.
  inBackground("minutes request confirmation", () =>
    sendQuietly(
      requester.email,
      minutesRequestedEmail({ email: requester.email, name: requester.name, workspace: ws.organizationName, minutes: amount }),
      to,
    ),
  );
  revalidatePath("/app/billing");
  return { ok: true, message: `Request sent. We'll email a payment link to ${requester.email}.` };
}
