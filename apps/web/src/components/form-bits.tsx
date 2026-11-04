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
    // Props first, so a passed disabled={false} can never re-enable the button while the action runs.
    <Button type="submit" {...props} disabled={pending || props.disabled} aria-busy={pending}>
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

/**
 * One-off success notice after a redirect, e.g. `?deleted=1`. Drops the query param right away so a
 * refresh or a copied link doesn't show it again, and fades like ActionMessage.
 */
export function FlashNotice({ message, param }: { message: string; param: string }) {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.has(param)) {
      url.searchParams.delete(param);
      window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    }
    const t = setTimeout(() => setVisible(false), 5000);
    return () => clearTimeout(t);
  }, [param]);
  if (!visible) return null;
  return (
    <div className="mb-4">
      <Notice tone="success">{message}</Notice>
    </div>
  );
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
