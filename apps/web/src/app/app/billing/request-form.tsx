"use client";

import { Send } from "lucide-react";
import { startTransition, useActionState, useEffect, useState, type FormEvent } from "react";
import { Button, Field, Input, Notice, Textarea, cx } from "@/components/ui";
import { requestMinutes } from "./actions";
import { MAX_REQUEST_MINUTES, MIN_REQUEST_MINUTES, MINUTE_PRESETS, NOTE_MAX } from "./roles";

const OPTIONS = [...MINUTE_PRESETS.map((m) => ({ value: String(m), label: `${m.toLocaleString("en-US")} min` })), { value: "custom", label: "Custom" }];
const DEFAULT_PRESET = "300";

export function RequestMinutesForm({ hasOpenRequest }: { hasOpenRequest: boolean }) {
  const [state, action, pending] = useActionState(requestMinutes, null);
  const [preset, setPreset] = useState(DEFAULT_PRESET);
  const [custom, setCustom] = useState("");
  const [note, setNote] = useState("");

  // Fresh form after a sent request; on an error everything typed stays.
  useEffect(() => {
    if (!state?.ok) return;
    setPreset(DEFAULT_PRESET);
    setCustom("");
    setNote("");
  }, [state]);

  // Submitted by hand (not <form action>) so React doesn't reset the fields when the server says no.
  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    startTransition(() => action(data));
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <fieldset disabled={pending} className="min-w-0 space-y-4">
        <fieldset className="min-w-0">
          <legend className="block text-sm font-medium text-slate-800">Minutes</legend>
          <div className="mt-1.5 grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-2">
            {OPTIONS.map((o) => (
              <label
                key={o.value}
                className={cx(
                  "flex h-9 cursor-pointer items-center justify-center rounded-lg border border-slate-200 bg-white px-2 text-sm font-medium text-slate-700 shadow-xs transition-colors",
                  "hover:border-slate-300 hover:bg-slate-50",
                  "has-[:checked]:border-brand-500 has-[:checked]:bg-brand-50 has-[:checked]:text-brand-800",
                  "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand-600",
                  "has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60",
                )}
              >
                <input
                  type="radio"
                  name="preset"
                  value={o.value}
                  checked={preset === o.value}
                  onChange={() => setPreset(o.value)}
                  className="sr-only"
                />
                {o.label}
              </label>
            ))}
          </div>
        </fieldset>

        {preset === "custom" ? (
          <Field
            label="How many minutes?"
            htmlFor="request-custom"
            hint={`A whole number from ${MIN_REQUEST_MINUTES} to ${MAX_REQUEST_MINUTES.toLocaleString("en-US")}.`}
          >
            <Input
              id="request-custom"
              name="customMinutes"
              type="number"
              inputMode="numeric"
              required
              min={MIN_REQUEST_MINUTES}
              max={MAX_REQUEST_MINUTES}
              step={1}
              placeholder="500"
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
            />
          </Field>
        ) : null}

        <Field label="Note (optional)" htmlFor="request-note" hint="For example invoice details, or when you need the minutes.">
          <Textarea
            id="request-note"
            name="note"
            rows={3}
            maxLength={NOTE_MAX}
            className="min-h-20"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>
      </fieldset>

      <Button type="submit" className="w-full" disabled={pending} aria-busy={pending}>
        <Send aria-hidden />
        {pending ? "Sending..." : "Request minutes"}
      </Button>

      {state?.error ? <Notice tone="error">{state.error}</Notice> : null}
      {state?.ok && state.message ? <Notice tone="success">{state.message}</Notice> : null}

      <p className="text-xs leading-5 text-slate-500">
        We email you a payment link, and add the minutes once it's paid.
        {hasOpenRequest ? " A new request replaces the open one." : ""}
      </p>
    </form>
  );
}
