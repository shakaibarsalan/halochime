"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Button, Field, Input, Notice } from "@/components/ui";
import { authClient } from "@/lib/auth-client";
import { sendCode, type SendCodeResult } from "./actions";
import { CodeStep, codeErrorMessage } from "./code-step";
import { rememberEmail, safeNext, withNext } from "./safe-next";

const linkClass =
  "rounded font-medium text-brand-600 hover:text-brand-700 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600";

export function AuthForm({ mode }: { mode: "sign-in" | "sign-up" }) {
  const router = useRouter();
  const params = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // Typed values survive "Use a different email" (the password is asked for again).
  const [values, setValues] = useState({ name: "", email: "" });
  const [codeStep, setCodeStep] = useState<{ email: string; sent: SendCodeResult } | null>(null);
  const isSignUp = mode === "sign-up";
  // Where to go afterwards (e.g. back to an invite). Validated, and carried across every step and screen.
  const next = safeNext(params.get("next"), "");
  const fromInvite = next.startsWith("/invite/");
  const otherHref = withNext(isSignUp ? "/sign-in" : "/sign-up", next);
  const notice = params.get("reset") === "1" && !isSignUp ? "Your password was changed. Sign in with your new password." : null;
  // New accounts go to onboarding unless they came from somewhere (an invite), so they aren't asked to make a workspace first.
  const destination = next || (isSignUp ? "/onboarding" : "/app");

  async function startCodeStep(email: string) {
    const sent = await sendCode(email, "verify");
    setCodeStep({ email, sent });
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const form = new FormData(e.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");
    const name = String(form.get("name") ?? "").trim();
    setValues({ name, email });

    if (isSignUp) {
      // With verification required, this never signs in, and never says whether the email is taken.
      const { error } = await authClient.signUp.email({ email, password, name: name || email.split("@")[0]! });
      if (error) {
        setError(error.message || "Something went wrong. Please try again.");
        setPending(false);
        return;
      }
      await startCodeStep(email);
      setPending(false);
      return;
    }

    const { error } = await authClient.signIn.email({ email, password });
    if (error) {
      if (error.code === "EMAIL_NOT_VERIFIED") {
        await startCodeStep(email);
        setPending(false);
        return;
      }
      setError(error.status === 429 ? "Too many tries. Wait a minute, then try again." : error.message || "Something went wrong. Please try again.");
      setPending(false);
      return;
    }
    router.replace(destination);
    router.refresh();
  }

  if (codeStep) {
    return (
      <CodeStep
        email={codeStep.email}
        purpose="verify"
        initial={codeStep.sent}
        submitLabel="Verify email"
        pendingLabel="Verifying..."
        onBack={() => setCodeStep(null)}
        onSubmit={async (otp) => {
          const { error } = await authClient.emailOtp.verifyEmail({ email: codeStep.email, otp });
          if (error) return codeErrorMessage(error);
          router.replace(destination);
          router.refresh();
          return null;
        }}
        footer={
          isSignUp ? (
            <p>
              Already have an account?{" "}
              <Link href={otherHref} className={linkClass}>
                Sign in
              </Link>
            </p>
          ) : null
        }
      />
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <div className="mb-8">
        <h1 className="font-display text-4xl leading-tight tracking-tight text-slate-900">
          {isSignUp ? "Create your account" : "Welcome back"}
        </h1>
        <p className="mt-2 text-sm text-slate-500">
          {fromInvite
            ? `${isSignUp ? "Create an account" : "Sign in"} with the email your invite was sent to. You'll go straight back to the invite.`
            : isSignUp
              ? "Set up a voice agent for your business in a few minutes."
              : "Sign in to your Halochime workspace."}
        </p>
      </div>
      {notice ? <Notice tone="success">{notice}</Notice> : null}
      {isSignUp ? (
        <Field label="Your name" htmlFor="name">
          <Input id="name" name="name" autoComplete="name" maxLength={100} className="h-10" defaultValue={values.name} />
        </Field>
      ) : null}
      <Field label="Email" htmlFor="email">
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          maxLength={320}
          className="h-10"
          placeholder="you@business.com"
          defaultValue={values.email}
        />
      </Field>
      <div className="space-y-1.5">
        <div className="flex items-baseline justify-between gap-3">
          <label htmlFor="password" className="block text-sm font-medium text-slate-800">
            Password
          </label>
          {!isSignUp ? (
            <Link
              href={withNext("/forgot-password", next)}
              className={`${linkClass} text-sm`}
              onClick={(e) => {
                const input = e.currentTarget.closest("form")?.querySelector<HTMLInputElement>("#email");
                rememberEmail(input?.value.trim() ?? "");
              }}
            >
              Forgot password?
            </Link>
          ) : null}
        </div>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete={isSignUp ? "new-password" : "current-password"}
          required
          minLength={8}
          maxLength={128}
          className="h-10"
        />
        {isSignUp ? <p className="text-xs leading-5 text-slate-500">At least 8 characters.</p> : null}
      </div>
      {error ? <Notice tone="error">{error}</Notice> : null}
      <Button type="submit" size="lg" className="w-full" disabled={pending} aria-busy={pending}>
        {pending ? "Please wait..." : isSignUp ? "Create account" : "Sign in"}
      </Button>
      <p className="text-center text-sm text-slate-500">
        {isSignUp ? "Already have an account? " : "New to Halochime? "}
        <Link href={otherHref} className={linkClass}>
          {isSignUp ? "Sign in" : "Create an account"}
        </Link>
      </p>
    </form>
  );
}
