"use server";

import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { z } from "zod";
import { db } from "@/db";
import { user } from "@/db/schema";
import { getAuth } from "@/lib/auth";
import { trackDelivery } from "@/lib/email/send";
import { rateLimit } from "@/lib/rate-limit";

/** `recent`: nothing new was sent because a code went to this address under a minute ago (it still works). */
export type SendCodeResult =
  | { ok: true; cooldownSec: number; recent?: boolean }
  | { ok: false; error: string; retryAfterSec?: number };

const RESEND_COOLDOWN_SEC = 60;
const SEND_FAILED = "We couldn't send the email just now. Please try again in a minute.";

const Input = z.object({
  email: z.string().trim().toLowerCase().max(320).pipe(z.email()),
  purpose: z.enum(["verify", "reset"]),
});

async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
}

const wait = (sec: number) =>
  sec >= 90
    ? `Please wait about ${Math.ceil(sec / 60)} minutes and try again.`
    : `Please wait ${sec} ${sec === 1 ? "second" : "seconds"} and try again.`;

/**
 * Sends a 6-digit code: "verify" (sign-up / unverified sign-in) or "reset" (forgot password).
 * The answer is the same whether or not the account exists, so it can't be used to find accounts.
 * Unlike Better Auth's own endpoint, it tells the user when the email could not be sent.
 */
export async function sendCode(email: string, purpose: "verify" | "reset"): Promise<SendCodeResult> {
  const parsed = Input.safeParse({ email, purpose });
  if (!parsed.success) return { ok: false, error: "Enter a valid email address." };
  const { email: address } = parsed.data;

  // One code per address per minute, at most 6 an hour, and 20 sends per IP per 10 minutes.
  const cooldown = rateLimit(`code:cooldown:${purpose}:${address}`, 1, RESEND_COOLDOWN_SEC * 1000);
  if (!cooldown.ok) return { ok: true, cooldownSec: cooldown.retryAfterSec, recent: true };
  const blocked = [
    rateLimit(`code:hour:${purpose}:${address}`, 6, 60 * 60 * 1000),
    rateLimit(`code:ip:${await clientIp()}`, 20, 10 * 60 * 1000),
  ].find((l) => !l.ok);
  if (blocked) return { ok: false, error: `Too many codes requested. ${wait(blocked.retryAfterSec)}`, retryAfterSec: blocked.retryAfterSec };

  const [account] = await db
    .select({ verified: user.emailVerified })
    .from(user)
    .where(eq(user.email, address))
    .limit(1);
  // Unknown address, or nothing to verify: answer as if sent, after a pause like a real send.
  if (!account || (purpose === "verify" && account.verified)) {
    await new Promise((r) => setTimeout(r, 300 + Math.random() * 700));
    return { ok: true, cooldownSec: RESEND_COOLDOWN_SEC };
  }

  const auth = getAuth();
  try {
    const { failed } = await trackDelivery(() =>
      purpose === "verify"
        ? auth.api.sendVerificationOTP({ body: { email: address, type: "email-verification" } })
        : auth.api.requestPasswordResetEmailOTP({ body: { email: address } }),
    );
    if (failed > 0) {
      return { ok: false, error: SEND_FAILED, retryAfterSec: RESEND_COOLDOWN_SEC };
    }
  } catch (err) {
    console.error("sendCode failed", err);
    return { ok: false, error: SEND_FAILED, retryAfterSec: RESEND_COOLDOWN_SEC };
  }
  return { ok: true, cooldownSec: RESEND_COOLDOWN_SEC };
}

export type VerifyCodeResult = { ok: true } | { ok: false; code?: string; status?: number; message?: string };

const VerifyInput = z.object({
  email: z.string().trim().toLowerCase().max(320).pipe(z.email()),
  otp: z.string().trim().regex(/^\d{6}$/),
  password: z.string().min(1).max(128),
});

const WRONG_PASSWORD = "That doesn't match the password for this email. Go back and enter it again.";

/**
 * Verifies a sign-up (or unverified sign-in) code, but only for the person who chose the account's
 * password. Better Auth checks the code by address alone, and a stranger may have signed up again with
 * the same address since (that replaces an unverified account), so the code must not verify, and sign
 * the owner into, an account whose password someone else set. The browser can't call Better Auth's
 * verify endpoint directly (lib/auth.ts DISABLED_PATHS).
 */
export async function verifyEmailCode(email: string, otp: string, password: string): Promise<VerifyCodeResult> {
  const parsed = VerifyInput.safeParse({ email, otp, password });
  if (!parsed.success) return { ok: false, code: "INVALID_OTP" };
  const { email: address } = parsed.data;

  const blocked = [
    rateLimit(`verify:ip:${await clientIp()}`, 20, 10 * 60 * 1000),
    rateLimit(`verify:email:${address}`, 10, 10 * 60 * 1000),
  ].find((l) => !l.ok);
  if (blocked) return { ok: false, status: 429 };

  const auth = getAuth();
  const ctx = await auth.$context;
  const found = await ctx.internalAdapter.findUserByEmail(address, { includeAccounts: true });
  const hash = found?.accounts.find((a) => a.providerId === "credential")?.password;
  // Already verified (or no such account): nothing to verify here; they sign in normally.
  if (!found || found.user.emailVerified || !hash) return { ok: false, code: "INVALID_OTP" };
  if (!(await ctx.password.verify({ hash, password: parsed.data.password }))) {
    return { ok: false, message: WRONG_PASSWORD };
  }

  let result: Awaited<ReturnType<typeof auth.api.verifyEmailOTP>>;
  try {
    result = await auth.api.verifyEmailOTP({ body: { email: address, otp: parsed.data.otp }, headers: await headers() });
  } catch (err) {
    const e = err as { body?: { code?: string; message?: string }; statusCode?: number };
    return { ok: false, code: e.body?.code, message: e.body?.message, status: e.statusCode };
  }
  // The account was replaced between the password check and the code check: undo the sign-in.
  if (result.user.id !== found.user.id) {
    if (result.token) await ctx.internalAdapter.deleteSession(result.token);
    await ctx.internalAdapter.updateUser(result.user.id, { emailVerified: false });
    return { ok: false, message: WRONG_PASSWORD };
  }
  return { ok: true };
}
