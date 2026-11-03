import "server-only";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { createAuthMiddleware } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { emailOTP, organization } from "better-auth/plugins";
import { getDb } from "@/db";
import * as schema from "@/db/schema/auth";
import { CODE_MINUTES, inBackground, sendCodeEmail, sendInviteEmail, sendPasswordChangedEmail, sendWelcomeEmail } from "./email/send";
import { appUrl, isProduction } from "./env";

/**
 * Better Auth endpoints the browser may not call. Codes are only sent and email codes only checked
 * through our own server actions (app/(auth)/actions.ts: rate limited; verifying also checks the
 * account's password), invites only go through app/app/settings (limited), and the passwordless and
 * change-email flows aren't offered. Server-side `auth.api` calls still work.
 */
const DISABLED_PATHS = [
  "/send-verification-email",
  "/email-otp/send-verification-otp",
  "/email-otp/verify-email",
  "/organization/invite-member",
  "/email-otp/request-password-reset",
  "/forget-password/email-otp",
  "/email-otp/check-verification-otp",
  "/sign-in/email-otp",
  "/email-otp/request-email-change",
  "/email-otp/change-email",
  "/request-password-reset",
];

function createAuth() {
  return betterAuth({
    baseURL: process.env.BETTER_AUTH_URL || appUrl(),
    // Dev only: 127.0.0.1:3000 is a second cookie jar, so two people can test signed in as different users.
    trustedOrigins: isProduction() ? [] : ["http://127.0.0.1:3000"],
    database: drizzleAdapter(getDb(), { provider: "pg", schema }),
    disabledPaths: DISABLED_PATHS,
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== "/sign-up/email") return;
        // Someone may have signed up with this address and never verified it (maybe not its owner).
        // Start over with the new sign-up, so a stranger's password can't sit on the real owner's
        // account once they verify. Unverified users can't sign in, so they own nothing yet.
        const email = typeof ctx.body?.email === "string" ? ctx.body.email.trim().toLowerCase() : "";
        if (!email) return;
        const existing = await ctx.context.internalAdapter.findUserByEmail(email);
        if (existing && !existing.user.emailVerified) await ctx.context.internalAdapter.deleteUser(existing.user.id);
      }),
    },
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      // No session until the email is verified with a code (sign-up and sign-in both ask for it).
      requireEmailVerification: true,
      revokeSessionsOnPasswordReset: true,
      onPasswordReset: async ({ user }) => {
        inBackground("password changed email", () => sendPasswordChangedEmail(user));
      },
    },
    emailVerification: {
      // The code screen sends the code itself, so a failed send can be shown to the user.
      sendOnSignUp: false,
      sendOnSignIn: false,
      autoSignInAfterVerification: true,
      afterEmailVerification: async (user) => {
        inBackground("welcome email", () => sendWelcomeEmail(user));
      },
    },
    plugins: [
      organization({
        allowUserToCreateOrganization: true,
        // Plenty for real businesses; stops scripted workspace creation (each can send invite emails).
        organizationLimit: 10,
        // Emailed, and the dashboard still shows a copyable link (createInvite in app/app/settings/actions.ts).
        sendInvitationEmail: async (data) => {
          await sendInviteEmail(data);
        },
        invitationExpiresIn: 60 * 60 * 24 * 7,
        // Inviting the same email again replaces the old link instead of failing.
        cancelPendingInvitationsOnReInvite: true,
      }),
      emailOTP({
        otpLength: 6,
        expiresIn: CODE_MINUTES * 60,
        allowedAttempts: 5,
        // Resending gives the same code (with a fresh expiry), so an older email still works.
        storeOTP: "encrypted",
        resendStrategy: "reuse",
        // Replaces link verification: any verification email Better Auth sends is a code.
        overrideDefaultEmailVerification: true,
        // Codes never create accounts; sign-up is email + password.
        disableSignUp: true,
        // Per IP for verify / reset attempts (Better Auth applies it in production).
        rateLimit: { window: 60, max: 5 },
        sendVerificationOTP: async ({ email, otp, type }) => {
          if (type === "email-verification") await sendCodeEmail(email, "verify", otp);
          else if (type === "forget-password") await sendCodeEmail(email, "reset", otp);
          // "sign-in" and "change-email" codes aren't offered (their endpoints are disabled).
        },
      }),
      // Must stay last: lets server actions set the auth cookies.
      nextCookies(),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;

const globalForAuth = globalThis as unknown as { __talkfrontAuth?: Auth };
let devAuth: Auth | undefined;

/** Built on first use so `next build` needs neither a database nor BETTER_AUTH_SECRET. */
export function getAuth(): Auth {
  // Dev: cached per module, so editing this file or the email code it calls takes effect on hot
  // reload (an instance on globalThis would keep the old callbacks until a restart).
  if (!isProduction()) return (devAuth ??= createAuth());
  return (globalForAuth.__talkfrontAuth ??= createAuth());
}
