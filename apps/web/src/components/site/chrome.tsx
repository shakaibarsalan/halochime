import Link from "next/link";
import type { ReactNode } from "react";
import { lpFocus } from "@/components/landing/primitives";
import { Logo } from "@/components/logo";
import { cx } from "@/components/ui";
import { LEGAL_LINKS } from "@/lib/site";

// Header, intro band and footer for the public reading pages (privacy, terms, refunds, contact).
// Same look as /docs: a dark bar and intro like the landing page, then light pages for reading.

export const focusLight = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600";

const startFree = cx(
  "inline-flex h-9 items-center whitespace-nowrap rounded-[10px] px-4 text-[13.5px] font-semibold text-white",
  "bg-[linear-gradient(180deg,#7464fa_0%,#5340dc_100%)] shadow-[inset_0_1px_0_rgb(255_255_255/0.22),0_0_0_1px_rgb(124_108_255/0.5)] transition-[filter] hover:brightness-110",
  lpFocus,
);

const barLink = "rounded-md px-1 text-[13.5px] font-medium text-white/65 transition-colors hover:text-white";

export function SiteHeader({ label }: { label: string }) {
  return (
    <header className="lp sticky top-0 z-40 border-b border-white/[0.07] bg-[#07070c]/85 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-3 px-4 sm:px-6">
        <Logo tone="dark" />
        <span aria-hidden className="hidden h-5 w-px bg-white/10 sm:block" />
        <span className="hidden font-mono text-[12px] font-medium uppercase tracking-[0.14em] text-[#b3a9ff] sm:inline">{label}</span>
        <div className="ml-auto flex items-center gap-2 sm:gap-3">
          <Link href="/docs" className={cx("hidden sm:inline", barLink, lpFocus)}>
            Docs
          </Link>
          <Link href="/sign-in" className={cx(barLink, lpFocus)}>
            Sign in
          </Link>
          <Link href="/sign-up" className={startFree}>
            Start free
          </Link>
        </div>
      </div>
    </header>
  );
}

/** The dark intro band under the header: eyebrow, a title with an accent word, a short intro. */
export function PageHero({
  eyebrow,
  title,
  accent,
  children,
  meta,
}: {
  eyebrow: string;
  title: string;
  /** Optional last words of the title, in the italic accent. */
  accent?: string;
  children?: ReactNode;
  meta?: ReactNode;
}) {
  return (
    <div className="lp relative overflow-hidden">
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="lp-hero-glow absolute inset-0" />
        <div className="lp-grid absolute inset-x-0 top-0 h-[420px]" />
      </div>
      <div className="relative mx-auto max-w-7xl px-4 pb-12 pt-12 sm:px-6 sm:pb-14 sm:pt-16">
        <p className="inline-flex items-center gap-2 text-[13px] font-medium tracking-wide text-[#b3a9ff]">
          <span className="h-px w-5 bg-gradient-to-r from-transparent to-[#b3a9ff]" aria-hidden />
          {eyebrow}
        </p>
        <h1 className="mt-4 max-w-3xl text-balance text-[38px] font-semibold leading-[1.04] tracking-[-0.045em] sm:text-[56px]">
          <span className="lp-heading">{title}</span>
          {accent ? (
            <>
              {" "}
              <span className="lp-accent pr-[0.06em] font-display text-[1.1em] font-normal italic tracking-[-0.02em]">{accent}</span>
            </>
          ) : null}
        </h1>
        {children ? <div className="mt-5 max-w-2xl text-pretty text-base leading-7 text-white/65 sm:text-lg sm:leading-8">{children}</div> : null}
        {meta ? <div className="mt-6 text-sm text-white/50">{meta}</div> : null}
      </div>
    </div>
  );
}

const FOOTER_LINKS = [{ href: "/", label: "Home" }, { href: "/docs", label: "Docs" }, ...LEGAL_LINKS];

export function SiteFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="border-t border-slate-200/80">
      <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 px-4 py-8 text-sm text-slate-500 sm:flex-row sm:px-6">
        <Logo />
        <nav aria-label="Footer" className="flex flex-wrap justify-center gap-x-5 gap-y-2">
          {FOOTER_LINKS.map((l) => (
            <Link key={l.href} href={l.href} className={cx("rounded hover:text-slate-900", focusLight)}>
              {l.label}
            </Link>
          ))}
        </nav>
        <p>© {year} Halochime</p>
      </div>
    </footer>
  );
}
