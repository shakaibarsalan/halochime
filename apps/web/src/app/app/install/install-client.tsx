"use client";

import { Check, CircleAlert, CircleCheck, CircleX, Copy, Search, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { SubmitButton } from "@/components/form-bits";
import { Input, Notice, Select, cx } from "@/components/ui";
import { checkSite, type CheckItem, type SiteCheckState } from "./actions";

// ---------------------------------------------------------------------------
// Code

export function CopyIconButton({ text, label, tone = "dark" }: { text: string; label: string; tone?: "dark" | "light" }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label={copied ? "Copied" : `Copy ${label}`}
      title={copied ? "Copied" : "Copy"}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          setCopied(false);
        }
      }}
      className={cx(
        "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2",
        tone === "dark"
          ? "text-slate-300 hover:bg-white/10 hover:text-white focus-visible:outline-brand-400"
          : "text-slate-600 hover:bg-slate-900/5 hover:text-slate-900 focus-visible:outline-brand-600",
      )}
    >
      {copied ? <Check className="size-3.5 text-emerald-400" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

/** Dark code block with a file label and copy button. Long lines scroll inside the block. */
export function CodeBlock({ code, label }: { code: string; label: string }) {
  return (
    <div className="overflow-hidden rounded-xl bg-ink ring-1 ring-slate-900/5">
      <div className="flex items-center justify-between gap-3 border-b border-white/[0.07] py-1.5 pl-3.5 pr-1.5">
        <span className="min-w-0 truncate font-mono text-[11px] text-slate-400" title={label}>
          {label}
        </span>
        <CopyIconButton text={code} label={label} />
      </div>
      <pre className="overflow-x-auto p-3.5 font-mono text-xs leading-5 text-slate-200 [scrollbar-width:thin]">
        <code>{code}</code>
      </pre>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Agent picker

export function AgentPicker({ agents, current }: { agents: { id: string; name: string; status: string }[]; current: string }) {
  const router = useRouter();
  return (
    <Select
      aria-label="Agent"
      value={current}
      onChange={(e) => router.replace(`/app/install?agent=${encodeURIComponent(e.target.value)}`, { scroll: false })}
      className="w-full sm:w-64"
    >
      {agents.map((a) => (
        <option key={a.id} value={a.id}>
          {a.name}
          {a.status === "published" ? "" : " (draft)"}
        </option>
      ))}
    </Select>
  );
}

// ---------------------------------------------------------------------------
// Platform tabs

export type PlatformTab = {
  id: string;
  label: string;
  summary: string;
  steps: ReactNode[];
  code: { label: string; code: string }[];
  notes?: ReactNode[];
};

const prose = "[&_b]:font-semibold [&_b]:text-slate-900 [&_code]:rounded [&_code]:bg-slate-100 [&_code]:px-1 [&_code]:py-px [&_code]:font-mono [&_code]:text-[12px] [&_code]:text-slate-800";

export function PlatformTabs({ platforms }: { platforms: PlatformTab[] }) {
  const [active, setActive] = useState(platforms[0]!.id);
  const uid = useId();
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const current = platforms.find((p) => p.id === active) ?? platforms[0]!;

  const onKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const next = e.key === "ArrowRight" ? i + 1 : e.key === "ArrowLeft" ? i - 1 : e.key === "Home" ? 0 : e.key === "End" ? platforms.length - 1 : null;
    if (next === null) return;
    e.preventDefault();
    const n = (next + platforms.length) % platforms.length;
    setActive(platforms[n]!.id);
    tabs.current[n]?.focus();
  };

  return (
    <div>
      <div className="relative border-b border-slate-100">
        <div
          role="tablist"
          aria-label="Platform"
          className="flex gap-1 overflow-x-auto px-3 py-2 [scrollbar-width:none] sm:flex-wrap sm:overflow-visible [&::-webkit-scrollbar]:hidden"
        >
          {platforms.map((p, i) => {
            const selected = p.id === active;
            return (
              <button
                key={p.id}
                ref={(el) => {
                  tabs.current[i] = el;
                }}
                type="button"
                role="tab"
                id={`${uid}-tab-${p.id}`}
                aria-selected={selected}
                aria-controls={`${uid}-panel`}
                tabIndex={selected ? 0 : -1}
                onClick={() => setActive(p.id)}
                onKeyDown={(e) => onKey(e, i)}
                className={cx(
                  "shrink-0 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-600",
                  selected ? "bg-brand-50 text-brand-800 ring-1 ring-brand-100" : "text-slate-600 hover:bg-slate-900/[0.04] hover:text-slate-900",
                )}
              >
                {p.label}
              </button>
            );
          })}
        </div>
        {/* Fade hints that the row scrolls on phones. */}
        <span aria-hidden className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-white sm:hidden" />
      </div>

      <div role="tabpanel" id={`${uid}-panel`} aria-labelledby={`${uid}-tab-${current.id}`} className="space-y-5 p-5">
        <p className="text-sm text-slate-500">{current.summary}</p>
        <ol className={cx("space-y-3", prose)}>
          {current.steps.map((s, i) => (
            <li key={i} className="flex gap-3 text-sm leading-6 text-slate-700">
              <span
                aria-hidden
                className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-brand-50 text-[11px] font-semibold tabular-nums text-brand-700 ring-1 ring-brand-100"
              >
                {i + 1}
              </span>
              <span className="min-w-0">{s}</span>
            </li>
          ))}
        </ol>
        <div className="space-y-3">
          {current.code.map((c) => (
            <CodeBlock key={c.label} label={c.label} code={c.code} />
          ))}
        </div>
        {current.notes?.length ? (
          <ul className={cx("space-y-1.5 rounded-xl bg-slate-50 px-4 py-3 ring-1 ring-slate-200/70", prose)}>
            {current.notes.map((n, i) => (
              <li key={i} className="flex gap-2 text-xs leading-5 text-slate-600">
                <CircleAlert className="mt-0.5 size-3.5 shrink-0 text-slate-400" aria-hidden />
                <span className="min-w-0">{n}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Check my site

const toneIcon = {
  ok: <CircleCheck className="size-4 text-emerald-600" aria-hidden />,
  warn: <TriangleAlert className="size-4 text-amber-600" aria-hidden />,
  bad: <CircleX className="size-4 text-red-600" aria-hidden />,
};
const toneLabel = { ok: "OK", warn: "Warning", bad: "Problem" };

function CheckRow({ item }: { item: CheckItem }) {
  return (
    <li className="flex gap-2.5">
      <span className="mt-0.5 shrink-0">
        {toneIcon[item.tone]}
        <span className="sr-only">{toneLabel[item.tone]}: </span>
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-slate-900 [overflow-wrap:anywhere]">{item.title}</span>
        {item.body ? <span className="mt-0.5 block text-xs leading-5 text-slate-500">{item.body}</span> : null}
      </span>
    </li>
  );
}

export function CheckSite({ agentId, agentHref, defaultUrl }: { agentId: string; agentHref: string; defaultUrl: string }) {
  const [state, action] = useActionState<SiteCheckState, FormData>(checkSite, null);
  const uid = useId();
  const allGood = state?.items && state.items.every((i) => i.tone === "ok");

  return (
    <div className="space-y-4">
      <form action={action} className="space-y-2" noValidate>
        <input type="hidden" name="agentId" value={agentId} />
        <label htmlFor={`${uid}-url`} className="block text-sm font-medium text-slate-800">
          Page address
        </label>
        <div className="flex gap-2">
          <Input
            key={agentId}
            id={`${uid}-url`}
            name="url"
            type="text"
            inputMode="url"
            autoComplete="url"
            spellCheck={false}
            placeholder="example.com"
            defaultValue={state?.input ?? defaultUrl}
            maxLength={2000}
            className="min-w-0 flex-1"
          />
          <SubmitButton pendingLabel="Checking..." variant="secondary" className="shrink-0">
            <Search aria-hidden />
            Check
          </SubmitButton>
        </div>
        <p className="text-xs leading-5 text-slate-500">We load the page once, like a browser would, and look for this agent&apos;s snippet.</p>
      </form>

      <div aria-live="polite">
        {state?.error ? <Notice tone="error">{state.error}</Notice> : null}
        {state?.items ? (
          <div className={cx("rounded-xl border p-4", allGood ? "border-emerald-200 bg-emerald-50/50" : "border-slate-200 bg-slate-50/60")}>
            <p className="mb-3 truncate text-xs text-slate-500" title={state.url}>
              {allGood ? "All set on " : "Results for "}
              <span className="font-medium text-slate-700">{state.url}</span>
            </p>
            <ul className="space-y-3">
              {state.items.map((item, i) => (
                <CheckRow key={i} item={item} />
              ))}
            </ul>
            {state.addDomain ? (
              <Link
                href={`${agentHref}#allowedDomains`}
                className="mt-4 inline-flex text-sm font-medium text-brand-700 underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
              >
                Add {state.addDomain} to allowed domains
              </Link>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
