"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { cx } from "@/components/ui";
import { lpFocus } from "./primitives";

/** Copy button for the dark code card. */
export function CopySnippet({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 2000);
        } catch {
          setCopied(false);
        }
      }}
      className={cx(
        "inline-flex h-7 items-center gap-1.5 rounded-md border border-white/10 bg-white/[0.06] px-2.5 text-xs font-medium text-white/80 transition-colors hover:border-white/20 hover:bg-white/[0.1] hover:text-white",
        lpFocus,
      )}
    >
      {copied ? <Check className="size-3.5 text-emerald-300" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
      {copied ? "Copied" : "Copy"}
      <span className="sr-only" role="status">
        {copied ? "Snippet copied" : ""}
      </span>
    </button>
  );
}
