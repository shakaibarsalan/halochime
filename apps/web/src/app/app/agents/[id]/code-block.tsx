"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { cx } from "@/components/ui";

/** Dark code block with a copy button, matching the Embed snippet. */
export function CodeBlock({ code, label, className }: { code: string; label: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className={cx("group relative", className)}>
      <pre className="whitespace-pre-wrap rounded-xl bg-ink p-3.5 pr-12 font-mono text-xs leading-5 text-slate-200 [overflow-wrap:anywhere] [scrollbar-width:thin]">
        <code>{code}</code>
      </pre>
      <button
        type="button"
        aria-label={copied ? "Copied" : `Copy ${label}`}
        title={copied ? "Copied" : "Copy"}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(code);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          } catch {
            setCopied(false);
          }
        }}
        className="absolute right-2 top-2 grid size-8 place-items-center rounded-lg bg-white/10 text-slate-300 transition-colors hover:bg-white/20 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-400"
      >
        {copied ? <Check className="size-4 text-emerald-300" aria-hidden /> : <Copy className="size-4" aria-hidden />}
      </button>
    </div>
  );
}
