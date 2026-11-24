import "server-only";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { agents, conversations, organization } from "@/db/schema";
import { rateLimit } from "../rate-limit";
import { managerEmails } from "./notify";
import { sendQuietly } from "./send";
import { staffReplyEmail } from "./templates";

// When a team member replies in a live (taken-over) chat and the visitor has shared an email
// address, the visitor also gets the reply by email: they may already have closed the page.
// One email per reply, at most 10 per conversation per hour, so a busy chat never floods an inbox.
// No timers or queues: this runs on serverless hosts, where nothing may run after the response.

const Email = z.email().max(320);

async function deliver(organizationId: string, conversationId: string, messages: string[]): Promise<void> {
  if (messages.length === 0) return;
  if (!rateLimit(`staff-reply-email:${conversationId}`, 10, 3_600_000).ok) return;
  const [row] = await db
    .select({
      visitorEmail: conversations.visitorEmail,
      visitorName: conversations.visitorName,
      pageUrl: conversations.pageUrl,
      workspace: organization.name,
      handoffEmail: agents.handoffEmail,
    })
    .from(conversations)
    .innerJoin(organization, eq(organization.id, conversations.organizationId))
    .leftJoin(agents, eq(agents.id, conversations.agentId))
    .where(and(eq(conversations.id, conversationId), eq(conversations.organizationId, organizationId)))
    .limit(1);
  if (!row?.visitorEmail) return;
  const to = Email.safeParse(row.visitorEmail.trim());
  if (!to.success) return;

  // Replies from the visitor should reach the business, never Halochime's own inbox.
  const custom = row.handoffEmail ? Email.safeParse(row.handoffEmail.trim()) : null;
  const replyTo = custom?.success ? custom.data : (await managerEmails(organizationId))[0];
  const pageUrl = row.pageUrl && /^https?:\/\//i.test(row.pageUrl) ? row.pageUrl : null;

  await sendQuietly(
    to.data,
    staffReplyEmail({
      workspace: row.workspace,
      visitorName: row.visitorName,
      messages,
      pageUrl,
      replyable: Boolean(replyTo),
    }),
    replyTo,
  );
}

/** Call after a staff message reached the live chat. Never throws. */
export async function emailStaffReply(opts: {
  organizationId: string;
  conversationId: string;
  text: string;
}): Promise<void> {
  try {
    await deliver(opts.organizationId, opts.conversationId, [opts.text]);
  } catch (err) {
    console.error("[email] staff reply email failed", err);
  }
}
