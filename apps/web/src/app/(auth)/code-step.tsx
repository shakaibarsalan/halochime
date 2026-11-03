"use client";

import { ArrowLeft, KeyRound, MailCheck } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button, Notice, cx } from "@/components/ui";
import { sendCode, type SendCodeResult } from "./actions";

export const CODE_LENGTH = 6;

/** Focus only where it won't pop up a keyboard (mouse/trackpad devices). */
export function focusOnDesktop(el: HTMLElement | null) {
  if (el && typeof window !== "undefined" && window.matchMedia("(pointer: fine)").matches) el.focus();
}

/** Better Auth error -> a sentence for the code screen. */
export function codeErrorMessage(err: { code?: string; status?: number; message?: string } | null | undefined): string {
  if (!err) return "Something went wrong. Please try again.";
  if (err.status === 429) return "Too many tries. Wait a minute, then try again.";
  switch (err.code) {
    case "OTP_EXPIRED":
      return "That code has expired. Send a new one below.";
    case "TOO_MANY_ATTEMPTS":
      return "Too many wrong tries. Send a new code below.";
    case "INVALID_OTP":
      return "That code didn't work. Check the email, or send a new code.";
    default:
      return err.message || "Something went wrong. Please try again.";
  }
}

/**
 * Six boxes backed by one real input, so typing, pasting a whole code ("123 456" or "Code: 123456")
 * and the phone's one-time-code autofill all work.
 */
export function CodeInput({
  id,
  value,
  onChange,
  onComplete,
  invalid,
  busy,
  describedBy,
}: {
  id: string;
  value: string;
  onChange: (code: string) => void;
  onComplete?: (code: string) => void;
  invalid?: boolean;
  /** Checking the code: read-only (not disabled), so focus and the phone keyboard stay put. */
  busy?: boolean;
  describedBy?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);
  useEffect(() => focusOnDesktop(ref.current), []);

  const active = Math.min(value.length, CODE_LENGTH - 1);
  const toEnd = () => {
    const el = ref.current;
    if (el) requestAnimationFrame(() => el.setSelectionRange(el.value.length, el.value.length));
  };

  return (
    <div className="group relative">
      <input
        ref={ref}
        id={id}
        name="code"
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]*"
        spellCheck={false}
        value={value}
        readOnly={busy}
        aria-busy={busy || undefined}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        onChange={(e) => {
          const digits = e.target.value.replace(/\D/g, "").slice(0, CODE_LENGTH);
          onChange(digits);
          if (digits.length === CODE_LENGTH && digits !== value) onComplete?.(digits);
        }}
        onFocus={() => {
          setFocused(true);
          toEnd();
        }}
        onClick={toEnd}
        onBlur={() => setFocused(false)}
        // 16px text so iOS doesn't zoom in; the input itself is invisible over the boxes.
        className="absolute inset-0 z-10 h-full w-full cursor-text bg-transparent text-base text-transparent caret-transparent opacity-0 outline-none"
      />
      <div className="grid grid-cols-6 gap-2 sm:gap-2.5" aria-hidden>
        {Array.from({ length: CODE_LENGTH }, (_, i) => {
          const isActive = focused && i === active;
          const char = value[i];
          return (
            <div
              key={i}
              className={cx(
                "relative grid h-13 place-items-center rounded-xl border bg-white text-2xl font-semibold tabular-nums text-slate-900 shadow-xs transition-[border-color,box-shadow]",
                invalid
                  ? "border-red-300"
                  : isActive
                    ? "border-brand-500 ring-4 ring-brand-500/15"
                    : char
                      ? "border-slate-300"
                      : "border-slate-200 group-hover:border-slate-300",
                isActive && invalid && "ring-4 ring-red-500/15",
                busy && "text-slate-400",
              )}
            >
              {char ?? (isActive ? <span className="h-6 w-px bg-slate-900 motion-safe:animate-caret" /> : null)}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function useCountdown(initialSec: number) {
  const [left, setLeft] = useState(initialSec);
  useEffect(() => {
    if (left <= 0) return;
    const t = setTimeout(() => setLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearTimeout(t);
  }, [left]);
  return [left, setLeft] as const;
}

/**
 * "Check your email" screen: code boxes, resend with a cooldown, and a way back.
 * `onSubmit` returns an error message, or null when it worked (the caller then navigates away).
 */
export function CodeStep({
  email,
  purpose,
  initial,
  onSubmit,
  onBack,
  backLabel = "Use a different email",
  submitLabel,
  pendingLabel,
  autoSubmit = true,
  canSubmit = true,
  children,
  footer,
}: {
  email: string;
  purpose: "verify" | "reset";
  initial: SendCodeResult;
  onSubmit: (code: string) => Promise<string | null>;
  onBack: () => void;
  backLabel?: string;
  submitLabel: string;
  pendingLabel: string;
  autoSubmit?: boolean;
  canSubmit?: boolean;
  /** Extra fields under the code (the new password when resetting). */
  children?: ReactNode;
  footer?: ReactNode;
}) {
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(initial.ok ? null : initial.error);
  // Red boxes only when the code itself was wrong, not when sending failed.
  const [badCode, setBadCode] = useState(false);
  const [info, setInfo] = useState<string | null>(
    initial.ok && initial.recent ? "We sent a code to this email a moment ago. Use the code in that email." : null,
  );
  const [resending, setResending] = useState(false);
  const [cooldown, setCooldown] = useCountdown(initial.ok ? initial.cooldownSec : (initial.retryAfterSec ?? 0));
  const Icon = purpose === "reset" ? KeyRound : MailCheck;

  async function submit(value: string) {
    if (pending || value.length !== CODE_LENGTH) return;
    setPending(true);
    setError(null);
    setInfo(null);
    const err = await onSubmit(value);
    if (err) {
      setError(err);
      setBadCode(true);
      setCode("");
      setPending(false);
    }
    // On success the caller navigates; stay "pending" so the button doesn't flash back.
  }

  async function resend() {
    setResending(true);
    setError(null);
    setBadCode(false);
    setInfo(null);
    const r = await sendCode(email, purpose);
    setResending(false);
    if (r.ok) {
      setInfo(r.recent ? "We sent a code a moment ago. Use the code in that email." : "Sent again. Check your inbox for the newest email.");
      setCooldown(r.cooldownSec);
    } else {
      setError(r.error);
      setCooldown(r.retryAfterSec ?? 0);
    }
  }

  return (
    <div>
      <span className="grid size-11 place-items-center rounded-xl bg-brand-50 text-brand-600 ring-1 ring-brand-100" aria-hidden>
        <Icon className="size-5" />
      </span>
      <h1 className="mt-5 font-display text-4xl leading-tight tracking-tight text-slate-900">Check your email</h1>
      <p id="code-help" className="mt-2 text-sm leading-6 text-slate-500">
        We sent a {CODE_LENGTH}-digit code to <span className="break-all font-medium text-slate-800">{email}</span>.{" "}
        {purpose === "reset" ? "Enter it with your new password." : "Enter it to verify your email."} It expires in 10
        minutes.
      </p>

      <form
        className="mt-7 space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          void submit(code);
        }}
      >
        <div className="space-y-1.5">
          <label htmlFor="code" className="block text-sm font-medium text-slate-800">
            Code
          </label>
          <CodeInput
            id="code"
            value={code}
            onChange={(v) => {
              setCode(v);
              if (badCode) {
                setBadCode(false);
                setError(null);
              }
            }}
            onComplete={autoSubmit ? (v) => void submit(v) : undefined}
            invalid={badCode}
            busy={pending}
            describedBy="code-help"
          />
        </div>
        {children}
        {error ? <Notice tone="error">{error}</Notice> : info ? <Notice tone="success">{info}</Notice> : null}
        <Button
          type="submit"
          size="lg"
          className="w-full"
          disabled={pending || code.length !== CODE_LENGTH || !canSubmit}
          aria-busy={pending}
        >
          {pending ? pendingLabel : submitLabel}
        </Button>
      </form>

      <div className="mt-6 space-y-3 text-sm text-slate-500">
        <p>
          Didn&apos;t get it? Check your spam folder, or{" "}
          {cooldown > 0 ? (
            <span className="tabular-nums text-slate-400">resend in {cooldown}s</span>
          ) : (
            <button
              type="button"
              onClick={resend}
              disabled={resending}
              className="rounded font-medium text-brand-600 hover:text-brand-700 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:text-slate-400 disabled:no-underline"
            >
              {resending ? "sending..." : "resend the code"}
            </button>
          )}
          .
        </p>
        {footer}
        <button
          type="button"
          onClick={onBack}
          className="-ml-1 inline-flex items-center gap-1.5 rounded-md px-1 py-0.5 font-medium text-slate-600 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
        >
          <ArrowLeft className="size-4" aria-hidden />
          {backLabel}
        </button>
      </div>
    </div>
  );
}
