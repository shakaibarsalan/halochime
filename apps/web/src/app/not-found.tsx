import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Bars, Eyebrow, lpButton } from "@/components/landing/primitives";
import { Logo } from "@/components/logo";
import { cx } from "@/components/ui";

export const metadata: Metadata = { title: "Page not found" };

/** 404 for unknown addresses and notFound() calls, in the landing page's dark look. */
export default function NotFound() {
  return (
    <div className="lp relative flex min-h-dvh flex-col overflow-hidden">
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="lp-hero-glow absolute inset-0" />
        <div className="lp-grid absolute inset-x-0 top-0 h-[620px]" />
      </div>

      <header className="relative mx-auto flex h-16 w-full max-w-6xl items-center px-4 sm:px-6">
        <Logo tone="dark" />
      </header>

      <main className="relative flex flex-1 items-center justify-center px-4 pb-20 pt-10 text-center sm:px-6">
        <div className="max-w-xl">
          <div aria-hidden className="relative mx-auto grid size-32 place-items-center">
            <span className="absolute -inset-6 rounded-full border border-white/[0.06]" />
            <span className="lp-orb relative grid size-24 place-items-center shadow-[0_0_90px_-12px_rgb(124_108_255/0.85)]">
              <Bars still className="h-7" bars={[0.18, 0.18, 0.18, 0.18, 0.18]} barClassName="w-[3px] bg-white/90" />
            </span>
          </div>
          <Eyebrow className="mt-10">Error 404</Eyebrow>
          <h1 className="lp-heading mt-4 text-balance text-[38px] font-semibold leading-[1.04] tracking-[-0.04em] sm:text-[52px]">
            This page has gone quiet
          </h1>
          <p className="mx-auto mt-5 max-w-md text-pretty text-base leading-7 text-white/65">
            Nothing lives at this address. It may be mistyped, or the page has moved.
          </p>
          <div className="mt-9 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center">
            <Link href="/" className={lpButton("white")}>
              <ArrowLeft aria-hidden />
              Back to home
            </Link>
            <Link href="/docs" className={lpButton("glass")}>
              Developer docs
            </Link>
          </div>
          <p className="mt-6 text-sm text-white/55">
            Looking for something specific?{" "}
            <Link href="/contact" className={cx("rounded font-medium text-[#cdc7ff] underline-offset-4 hover:underline", "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#b3a9ff]")}>
              Ask us
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
}
