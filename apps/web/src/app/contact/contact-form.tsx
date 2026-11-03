"use client";

import { CircleCheck } from "lucide-react";
import { startTransition, useActionState, useState } from "react";
import { Button, Field, Input, Notice, Select, Textarea } from "@/components/ui";
import { sendContactMessage } from "./actions";
import { type ContactState, HONEYPOT, type Topic, TOPICS } from "./topics";

/** The contact form. "Send another message" mounts a fresh form, which also clears the last result. */
export function ContactForm({ defaultTopic }: { defaultTopic: Topic }) {
  const [round, setRound] = useState(0);
  return <ContactFormBody key={round} defaultTopic={defaultTopic} onAgain={() => setRound((r) => r + 1)} />;
}

function ContactFormBody({ defaultTopic, onAgain }: { defaultTopic: Topic; onAgain: () => void }) {
  const [state, action, pending] = useActionState<ContactState, FormData>(sendContactMessage, null);
  const [topic, setTopic] = useState<Topic>(defaultTopic);
  const fields = state && !state.ok ? (state.fields ?? {}) : {};
  const hint = TOPICS.find((t) => t.value === topic)?.hint;

  if (state?.ok) {
    return (
      <div role="status" className="flex flex-col items-center px-2 py-8 text-center">
        <span className="grid size-12 place-items-center rounded-2xl bg-emerald-50 text-emerald-600 ring-1 ring-emerald-100" aria-hidden>
          <CircleCheck className="size-5" />
        </span>
        <h2 className="mt-4 text-lg font-semibold tracking-tight text-slate-900">Message sent</h2>
        <p className="mt-1.5 max-w-sm text-sm leading-6 text-slate-600">
          Thanks for writing. We&apos;ll reply by email to <span className="font-medium text-slate-900 [overflow-wrap:anywhere]">{state.email}</span>.
        </p>
        <Button type="button" variant="secondary" className="mt-6" onClick={onAgain}>
          Send another message
        </Button>
      </div>
    );
  }

  return (
    <form
      className="relative space-y-5"
      // Submitted by hand, not through the form's action prop: React resets a form after its action
      // runs, which would wipe what the visitor typed whenever there is an error to fix.
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => action(data));
      }}
    >
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Your name" htmlFor="contact-name" error={fields.name}>
          <Input
            id="contact-name"
            name="name"
            autoComplete="name"
            required
            maxLength={100}
            className="h-10"
            aria-invalid={fields.name ? true : undefined}
          />
        </Field>
        <Field label="Email" htmlFor="contact-email" error={fields.email}>
          <Input
            id="contact-email"
            name="email"
            type="email"
            autoComplete="email"
            inputMode="email"
            required
            maxLength={320}
            placeholder="you@business.com"
            className="h-10"
            aria-invalid={fields.email ? true : undefined}
          />
        </Field>
      </div>
      <Field label="Topic" htmlFor="contact-topic" error={fields.topic}>
        <Select
          id="contact-topic"
          name="topic"
          value={topic}
          onChange={(e) => setTopic(e.target.value as Topic)}
          className="h-10"
          aria-invalid={fields.topic ? true : undefined}
        >
          {TOPICS.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Message" htmlFor="contact-message" error={fields.message} hint={hint}>
        <Textarea
          id="contact-message"
          name="message"
          required
          minLength={10}
          maxLength={5000}
          rows={6}
          className="min-h-36"
          aria-invalid={fields.message ? true : undefined}
        />
      </Field>

      {/* Hidden from people and screen readers; bots that fill every field give themselves away. */}
      <div aria-hidden className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label htmlFor="contact-website">Leave this field empty</label>
        <input id="contact-website" name={HONEYPOT} type="text" tabIndex={-1} autoComplete="off" defaultValue="" />
      </div>

      {state && !state.ok ? <Notice tone="error">{state.error}</Notice> : null}

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs leading-5 text-slate-500">We reply by email, to the address above.</p>
        <Button type="submit" size="lg" disabled={pending} aria-busy={pending} className="sm:min-w-40">
          {pending ? "Sending..." : "Send message"}
        </Button>
      </div>
    </form>
  );
}
