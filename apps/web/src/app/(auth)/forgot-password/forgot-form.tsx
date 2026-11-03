"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Button, Field, Input, Notice } from "@/components/ui";
import { authClient } from "@/lib/auth-client";
import { sendCode, type SendCodeResult } from "../actions";
import { CodeStep, codeErrorMessage } from "../code-step";
import { recallEmail, safeNext, withNext } from "../safe-next";

const linkClass =
  "rounded font-medium text-brand-600 hover:text-brand-700 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600";

/** Forgot password: email -> code + new password -> signed in (or back to sign-in with a notice). */
export function ForgotPasswordForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"), "");
  const signInHref = withNext("/sign-in", next);
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [step, setStep] = useState<{ email: string; sent: SendCodeResult } | null>(null);
  const [password, setPassword] = useState("");
  // Only complain about length once the field has been left, not while typing.
  const [passwordTouched, setPasswordTouched] = useState(false);

  // Carry over the email typed on the sign-in screen.
  useEffect(() => {
    const remembered = recallEmail();
    if (remembered) setEmail(remembered);
  }, []);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const address = email.trim();
    const sent = await sendCode(address, "reset");
    setPending(false);
    // Only a bad address stays here; the code screen shows send errors next to the resend timer.
    if (!sent.ok && !sent.retryAfterSec) {
      setError(sent.error);
      return;
    }
    setPassword("");
    setPasswordTouched(false);
    setStep({ email: address, sent });
  }

  if (step) {
    const tooShort = passwordTouched && password.length > 0 && password.length < 8;
    return (
      <CodeStep
        email={step.email}
        purpose="reset"
        initial={step.sent}
        autoSubmit={false}
        canSubmit={password.length >= 8}
        submitLabel="Set new password"
        pendingLabel="Saving..."
        onBack={() => setStep(null)}
        onSubmit={async (otp) => {
          const { error } = await authClient.emailOtp.resetPassword({ email: step.email, otp, password });
          if (error) {
            if (error.code === "PASSWORD_TOO_SHORT" || error.code === "PASSWORD_TOO_LONG") return error.message || "Choose a different password.";
            return codeErrorMessage(error);
          }
          // Reset signs out every device; sign straight back in here with the new password.
          const signIn = await authClient.signIn.email({ email: step.email, password });
          if (signIn.error) {
            router.replace(`${signInHref}${signInHref.includes("?") ? "&" : "?"}reset=1`);
            return null;
          }
          router.replace(next || "/app");
          router.refresh();
          return null;
        }}
        footer={
          <p>
            Remembered it?{" "}
            <Link href={signInHref} className={linkClass}>
              Back to sign in
            </Link>
          </p>
        }
      >
        <Field
          label="New password"
          htmlFor="new-password"
          error={tooShort ? "Use at least 8 characters." : undefined}
          hint="At least 8 characters. You'll be signed out on other devices."
        >
          <Input
            id="new-password"
            name="new-password"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            maxLength={128}
            className="h-10"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onBlur={() => setPasswordTouched(true)}
            aria-invalid={tooShort || undefined}
          />
        </Field>
      </CodeStep>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <div className="mb-8">
        <h1 className="font-display text-4xl leading-tight tracking-tight text-slate-900">Reset your password</h1>
        <p className="mt-2 text-sm text-slate-500">
          Enter the email you sign in with. We&apos;ll send you a code to choose a new password.
        </p>
      </div>
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
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </Field>
      {error ? <Notice tone="error">{error}</Notice> : null}
      <Button type="submit" size="lg" className="w-full" disabled={pending} aria-busy={pending}>
        {pending ? "Sending code..." : "Send code"}
      </Button>
      <p className="text-center text-sm text-slate-500">
        Remembered it?{" "}
        <Link href={signInHref} className={linkClass}>
          Back to sign in
        </Link>
      </p>
    </form>
  );
}
