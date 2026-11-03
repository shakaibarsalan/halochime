"use client";

import { Check, ChevronDown, Copy } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { cx } from "@/components/ui";

// Small interactive pieces of the public docs. Everything else on /docs is server-rendered.

const focus = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600";

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label={copied ? "Copied" : `Copy ${label}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          setCopied(false);
        }
      }}
      className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-slate-400 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#b3a9ff]"
    >
      {copied ? <Check className="size-3.5 text-emerald-400" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
      <span aria-hidden>{copied ? "Copied" : "Copy"}</span>
    </button>
  );
}

export type Sample = { label: string; code: string };

/**
 * Dark code block. With several samples it becomes tabs (e.g. Node / Python / PHP).
 * Long lines scroll inside the block, never the page.
 */
export function Code({ samples, caption }: { samples: Sample[]; caption?: string }) {
  const [i, setI] = useState(0);
  const uid = useId();
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const current = samples[i] ?? samples[0]!;
  const many = samples.length > 1;

  const onKey = (e: KeyboardEvent<HTMLButtonElement>, at: number) => {
    const next = e.key === "ArrowRight" ? at + 1 : e.key === "ArrowLeft" ? at - 1 : null;
    if (next === null) return;
    e.preventDefault();
    const n = (next + samples.length) % samples.length;
    setI(n);
    tabs.current[n]?.focus();
  };

  return (
    <figure className="my-5 overflow-hidden rounded-xl bg-[#0d0d16] shadow-[0_1px_0_rgb(255_255_255/0.04)_inset,0_10px_30px_-18px_rgb(15_18_34/0.6)] ring-1 ring-black/5">
      <div className="flex items-center justify-between gap-2 border-b border-white/[0.07] pl-2 pr-1.5">
        {many ? (
          <div role="tablist" aria-label={caption ?? "Language"} className="flex min-w-0 gap-0.5 overflow-x-auto py-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {samples.map((s, at) => (
              <button
                key={s.label}
                ref={(el) => {
                  tabs.current[at] = el;
                }}
                type="button"
                role="tab"
                id={`${uid}-t${at}`}
                aria-selected={at === i}
                aria-controls={`${uid}-p`}
                tabIndex={at === i ? 0 : -1}
                onClick={() => setI(at)}
                onKeyDown={(e) => onKey(e, at)}
                className={cx(
                  "shrink-0 whitespace-nowrap rounded-md px-2.5 py-1 font-mono text-[11.5px] transition-colors focus-visible:outline-2 focus-visible:outline-[#b3a9ff]",
                  at === i ? "bg-white/10 text-white" : "text-slate-400 hover:bg-white/5 hover:text-slate-200",
                )}
              >
                {s.label}
              </button>
            ))}
          </div>
        ) : (
          <figcaption className="min-w-0 truncate py-2 pl-1.5 font-mono text-[11.5px] text-slate-400">{current.label}</figcaption>
        )}
        <CopyButton text={current.code} label={current.label} />
      </div>
      <pre
        id={many ? `${uid}-p` : undefined}
        role={many ? "tabpanel" : undefined}
        aria-labelledby={many ? `${uid}-t${i}` : undefined}
        tabIndex={0}
        className="overflow-x-auto p-4 font-mono text-[12.5px] leading-[1.7] text-slate-200 [scrollbar-width:thin] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#b3a9ff]"
      >
        <code>{current.code}</code>
      </pre>
    </figure>
  );
}

export type TocItem = { id: string; label: string; children?: { id: string; label: string }[] };

/** Section links with the current section highlighted (desktop sidebar). */
export function Toc({ items }: { items: TocItem[] }) {
  const [active, setActive] = useState(items[0]?.id ?? "");

  useEffect(() => {
    const ids = items.flatMap((i) => [i.id, ...(i.children?.map((c) => c.id) ?? [])]);
    const els = ids.map((id) => document.getElementById(id)).filter((e): e is HTMLElement => !!e);
    if (!els.length || typeof IntersectionObserver === "undefined") return;
    const visible = new Map<string, number>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) visible.set(e.target.id, e.boundingClientRect.top);
          else visible.delete(e.target.id);
        }
        // The heading nearest the top of the reading band wins; otherwise keep the last one passed.
        const first = [...visible.entries()].sort((a, b) => a[1] - b[1])[0];
        if (first) setActive(first[0]);
        else {
          const passed = els.filter((el) => el.getBoundingClientRect().top < 120).pop();
          if (passed) setActive(passed.id);
        }
      },
      { rootMargin: "-80px 0px -65% 0px" },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [items]);

  const parentOf = (id: string) => items.find((i) => i.id === id || i.children?.some((c) => c.id === id))?.id;
  const activeParent = parentOf(active);

  return (
    <nav aria-label="On this page" className="text-[13.5px]">
      <p className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500">On this page</p>
      <ul className="space-y-0.5 border-l border-slate-200">
        {items.map((item) => {
          const isActive = active === item.id;
          const open = activeParent === item.id;
          return (
            <li key={item.id}>
              <a
                href={`#${item.id}`}
                aria-current={isActive ? "location" : undefined}
                className={cx(
                  "-ml-px block border-l py-1 pl-3.5 transition-colors",
                  isActive || open ? "border-brand-600 font-medium text-slate-900" : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-900",
                  focus,
                )}
              >
                {item.label}
              </a>
              {item.children && open ? (
                <ul className="mb-1 space-y-0.5">
                  {item.children.map((c) => (
                    <li key={c.id}>
                      <a
                        href={`#${c.id}`}
                        aria-current={active === c.id ? "location" : undefined}
                        className={cx(
                          "block py-0.5 pl-7 text-[12.5px] transition-colors",
                          active === c.id ? "text-brand-700" : "text-slate-500 hover:text-slate-900",
                          focus,
                        )}
                      >
                        {c.label}
                      </a>
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Phones and tablets: a collapsible "On this page" list that closes after a jump. */
export function MobileToc({ items }: { items: TocItem[] }) {
  const ref = useRef<HTMLDetailsElement>(null);
  return (
    <details ref={ref} className="group rounded-xl border border-slate-200 bg-white shadow-xs lg:hidden">
      <summary
        className={cx(
          "flex cursor-pointer list-none items-center justify-between gap-3 rounded-xl px-4 py-3 text-sm font-medium text-slate-900 [&::-webkit-details-marker]:hidden",
          focus,
        )}
      >
        On this page
        <ChevronDown className="size-4 text-slate-400 transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      <ul className="border-t border-slate-100 px-2 py-2">
        {items.map((item) => (
          <li key={item.id}>
            <a
              href={`#${item.id}`}
              onClick={() => ref.current?.removeAttribute("open")}
              className={cx("block rounded-lg px-2.5 py-2 text-sm text-slate-700 hover:bg-slate-50 hover:text-slate-900", focus)}
            >
              {item.label}
            </a>
          </li>
        ))}
      </ul>
    </details>
  );
}
