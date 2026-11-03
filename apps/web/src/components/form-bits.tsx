"use client";

import { useEffect, useState, type ComponentProps } from "react";
import { useFormStatus } from "react-dom";
import { Button, Notice } from "./ui";

export type ActionState = { ok?: boolean; error?: string; message?: string } | null;

/** Submit button that disables itself while its form's server action runs. */
export function SubmitButton({
  children,
  pendingLabel,
  ...props
}: ComponentProps<typeof Button> & { pendingLabel?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending || props.disabled} aria-busy={pending} {...props}>
      {pending ? (pendingLabel ?? "Saving...") : children}
    </Button>
  );
}

/** Shows the result of a server action; success messages fade after a few seconds. */
export function ActionMessage({ state }: { state: ActionState }) {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    setVisible(true);
    if (state?.ok) {
      const t = setTimeout(() => setVisible(false), 4000);
      return () => clearTimeout(t);
    }
  }, [state]);
  if (!state || !visible) return null;
  if (state.error) return <Notice tone="error">{state.error}</Notice>;
  if (state.message) return <Notice tone="success">{state.message}</Notice>;
  return null;
}

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          setCopied(false);
        }
      }}
    >
      {copied ? "Copied" : label}
    </Button>
  );
}
