import { Info, TriangleAlert } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { MobileToc, Toc, type TocItem } from "@/app/docs/docs-client";
import { cx } from "@/components/ui";
import { focusLight, PageHero, SiteFooter, SiteHeader } from "./chrome";

// Reading pieces for the legal pages, in the same type scale as /docs.

export type { TocItem };

export function H2({ id, n, children }: { id: string; n: number; children: ReactNode }) {
  return (
    <div className="mb-4">
      <p className="font-mono text-[11.5px] font-medium uppercase tracking-[0.14em] text-brand-600">{String(n).padStart(2, "0")}</p>
      <h2 id={id} className="group mt-2 scroll-mt-24 text-[24px] font-semibold leading-tight tracking-[-0.03em] text-slate-950 sm:text-[28px]">
        <a href={`#${id}`} className={cx("rounded-md", focusLight)}>
          {children}
          <span aria-hidden className="ml-2 text-slate-300 opacity-0 transition-opacity group-hover:opacity-100">
            #
          </span>
        </a>
      </h2>
    </div>
  );
}

export function H3({ children }: { children: ReactNode }) {
  return <h3 className="mb-2 mt-8 text-[17px] font-semibold tracking-[-0.015em] text-slate-900">{children}</h3>;
}

export function P({ children }: { children: ReactNode }) {
  return <p className="my-4 text-[15.5px] leading-[1.75] text-slate-700">{children}</p>;
}

export function B({ children }: { children: ReactNode }) {
  return <b className="font-semibold text-slate-900">{children}</b>;
}

export function A({ href, children }: { href: string; children: ReactNode }) {
  const external = /^https?:/.test(href);
  return (
    <Link
      href={href}
      target={external ? "_blank" : undefined}
      rel={external ? "noreferrer" : undefined}
      className={cx("rounded-sm font-medium text-brand-700 underline decoration-brand-300 underline-offset-[3px] hover:decoration-brand-600", focusLight)}
    >
      {children}
    </Link>
  );
}

export function List({ children, ordered }: { children: ReactNode; ordered?: boolean }) {
  const Tag = ordered ? "ol" : "ul";
  return (
    <Tag
      className={cx(
        "my-4 space-y-2 pl-5 text-[15.5px] leading-[1.7] text-slate-700 marker:text-slate-400",
        ordered ? "list-decimal marker:font-medium marker:text-brand-600" : "list-disc",
      )}
    >
      {children}
    </Tag>
  );
}

export function Callout({ tone = "info", children }: { tone?: "info" | "warn"; children: ReactNode }) {
  const Icon = tone === "warn" ? TriangleAlert : Info;
  return (
    <div
      className={cx(
        "my-5 flex gap-3 rounded-xl border px-4 py-3.5 text-[14.5px] leading-[1.65]",
        tone === "warn" ? "border-amber-200 bg-amber-50/70 text-amber-900" : "border-brand-100 bg-brand-50/60 text-slate-700",
      )}
    >
      <Icon className={cx("mt-1 size-4 shrink-0", tone === "warn" ? "text-amber-600" : "text-brand-600")} aria-hidden />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function DataTable({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <div className="my-5 overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <table className={cx("w-full text-left text-[14px]", head.length > 2 && "min-w-[560px]")}>
        <thead>
          <tr>
            {head.map((h) => (
              <th key={h} className="border-b border-slate-200 bg-slate-50/80 px-4 py-2.5 text-[11.5px] font-semibold uppercase tracking-wider text-slate-500">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="align-top">
              {r.map((cell, j) => (
                <td key={j} className={cx("border-b border-slate-100 px-4 py-3 leading-6 text-slate-700 [tr:last-child_&]:border-b-0", j === 0 && "font-medium text-slate-900")}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Section({ children, first }: { children: ReactNode; first?: boolean }) {
  return <section className={cx(!first && "mt-12 border-t border-slate-200/80 pt-10 sm:mt-14 sm:pt-12")}>{children}</section>;
}

/** A whole legal page: header, intro band, "On this page" list and the reading column. */
export function LegalPage({
  label,
  eyebrow,
  title,
  accent,
  intro,
  updated,
  toc,
  children,
}: {
  label: string;
  eyebrow: string;
  title: string;
  accent?: string;
  intro: ReactNode;
  updated: { label: string; iso: string };
  toc: TocItem[];
  children: ReactNode;
}) {
  return (
    <div className="min-h-dvh bg-canvas text-slate-800">
      <a
        href="#content"
        className="sr-only z-[60] rounded-full bg-white px-4 py-2 text-sm font-medium text-slate-900 shadow focus:not-sr-only focus:fixed focus:left-4 focus:top-3"
      >
        Skip to content
      </a>
      <SiteHeader label={label} />
      <PageHero
        eyebrow={eyebrow}
        title={title}
        accent={accent}
        meta={
          <>
            Last updated <time dateTime={updated.iso}>{updated.label}</time>
          </>
        }
      >
        {intro}
      </PageHero>

      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:grid lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-14 xl:gap-20">
        <aside className="hidden lg:block">
          <div className="sticky top-24 max-h-[calc(100dvh-7rem)] overflow-y-auto py-12 [scrollbar-width:none]">
            <Toc items={toc} />
          </div>
        </aside>
        <main id="content" className="min-w-0 max-w-[46rem] py-10 sm:py-12">
          <MobileToc items={toc} />
          <div className="mt-8 lg:mt-0">{children}</div>
        </main>
      </div>

      <SiteFooter />
    </div>
  );
}
