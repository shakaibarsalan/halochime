"use client";

import { X } from "lucide-react";
import { type FormEvent, type ReactNode, startTransition, useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button, cx } from "@/components/ui";

export const subtle = "text-slate-500 hover:bg-slate-900/5 hover:text-slate-900";

export const chip =
  "flex min-h-9 cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 shadow-xs transition-colors hover:border-slate-300 has-[:checked]:border-brand-300 has-[:checked]:bg-brand-50 has-[:checked]:text-brand-800 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand-600";

/**
 * useActionState driven from onSubmit instead of <form action>: a form action resets the form when it
 * finishes, which puts controlled inputs out of sync with React state.
 */
export function useSubmitAction<S>(fn: (prev: Awaited<S>, data: FormData) => S | Promise<S>, initial: Awaited<S>) {
  const [state, dispatch, pending] = useActionState<S, FormData>(fn, initial);
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    startTransition(() => dispatch(data));
  };
  return [state, onSubmit, pending] as const;
}

export function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button type="button" variant="ghost" size="sm" onClick={onClick} aria-label={label} title={label} className={cx("size-8 px-0", subtle)}>
      <X aria-hidden />
    </Button>
  );
}

/** Submit button for small one-click forms (turn off, delete, disconnect), with an optional confirm. */
export function SmallFormButton({
  children,
  label,
  className,
  confirmText,
  variant = "ghost",
}: {
  children: ReactNode;
  label: string;
  className?: string;
  confirmText?: string;
  variant?: "ghost" | "secondary" | "danger";
}) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      variant={variant}
      size="sm"
      disabled={pending}
      aria-busy={pending}
      aria-label={label}
      title={label}
      className={className}
      onClick={(e) => {
        if (confirmText && !window.confirm(confirmText)) e.preventDefault();
      }}
    >
      {children}
    </Button>
  );
}

/** Controlled on/off switch (the shared Toggle is uncontrolled). */
export function Switch({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: ReactNode }) {
  return (
    <label className="group flex cursor-pointer items-start justify-between gap-4 rounded-xl border border-slate-200 bg-white px-4 py-3 transition-colors hover:border-slate-300 has-[:checked]:border-brand-200 has-[:checked]:bg-brand-50/40">
      <span className="min-w-0">
        <span className="block text-sm font-medium text-slate-900">{label}</span>
        {hint ? <span className="mt-0.5 block text-xs leading-5 text-slate-500">{hint}</span> : null}
      </span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="peer sr-only" />
      <span
        aria-hidden
        className="relative mt-0.5 h-5 w-9 shrink-0 rounded-full bg-slate-200 transition-colors peer-checked:bg-brand-600 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand-600 after:absolute after:left-0.5 after:top-0.5 after:size-4 after:rounded-full after:bg-white after:shadow-sm after:transition-transform peer-checked:after:translate-x-4"
      />
    </label>
  );
}
