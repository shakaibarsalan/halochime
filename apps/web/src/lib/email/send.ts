import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { after } from "next/server";
import { TRIAL_SECONDS } from "@/db/schema";
import { codeEmail, inviteEmail, passwordChangedEmail, welcomeEmail, type CodePurpose, type Rendered } from "./templates";
import { sendEmail } from "./transport";

export const CODE_MINUTES = 10;

// Better Auth runs our send callbacks inside try/catch and swallows errors, so a caller that needs to
// know whether an email went out (the code screen, the invite form) runs the auth call inside
// trackDelivery() and reads the outcome afterwards.

type DeliveryScope = { sent: number; failed: number };
// On globalThis: the auth instance is shared process-wide, and Next can load this module more than once.
const g = globalThis as unknown as { __talkfrontEmailScope?: AsyncLocalStorage<DeliveryScope> };
const scopeStore = (g.__talkfrontEmailScope ??= new AsyncLocalStorage<DeliveryScope>());

export async function trackDelivery<T>(fn: () => Promise<T>): Promise<{ result: T; sent: number; failed: number }> {
  const scope: DeliveryScope = { sent: 0, failed: 0 };
  const result = await scopeStore.run(scope, fn);
  return { result, sent: scope.sent, failed: scope.failed };
}

function record(ok: boolean) {
  const scope = scopeStore.getStore();
  if (scope) ok ? scope.sent++ : scope.failed++;
}

/** Sends and never throws: for side effects (alerts, welcome, invites). Returns whether it went out. */
export async function sendQuietly(to: string, email: Rendered, replyTo?: string): Promise<boolean> {
  try {
    await sendEmail({ to, replyTo, ...email });
    record(true);
    return true;
  } catch (err) {
    record(false);
    console.error(`[email] ${email.template} could not be sent`, err instanceof Error ? err.message : err);
    return false;
  }
}

/** Runs after the response is sent when inside a request, otherwise right away. Never throws. */
export function inBackground(label: string, task: () => Promise<unknown>): void {
  const run = () => task().catch((err) => console.error(`[email] ${label} failed`, err));
  try {
    after(run);
  } catch {
    void run();
  }
}

/** Verification or password reset code. Throws on failure, so the code screen can say so. */
export async function sendCodeEmail(to: string, purpose: CodePurpose, code: string): Promise<void> {
  try {
    await sendEmail({ to, ...codeEmail({ purpose, code, email: to, minutes: CODE_MINUTES }) });
    record(true);
  } catch (err) {
    record(false);
    throw err;
  }
}

export function sendPasswordChangedEmail(user: { email: string; name?: string | null }): Promise<boolean> {
  return sendQuietly(user.email, passwordChangedEmail({ email: user.email, name: user.name, at: new Date() }));
}

export function sendWelcomeEmail(user: { email: string; name?: string | null }): Promise<boolean> {
  return sendQuietly(user.email, welcomeEmail({ email: user.email, name: user.name, trialMinutes: TRIAL_SECONDS / 60 }));
}

export function sendInviteEmail(data: {
  id: string;
  email: string;
  role: string;
  organization: { name: string };
  inviter: { user: { name?: string | null; email: string } };
  invitation: { expiresAt: Date };
}): Promise<boolean> {
  return sendQuietly(
    data.email,
    inviteEmail({
      invitationId: data.id,
      email: data.email,
      workspace: data.organization.name,
      role: data.role,
      inviterName: data.inviter.user.name,
      inviterEmail: data.inviter.user.email,
      expiresAt: new Date(data.invitation.expiresAt),
    }),
  );
}
