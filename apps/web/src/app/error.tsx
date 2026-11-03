"use client";

import { RotateCcw } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";
import { Bars, Eyebrow, lpButton } from "@/components/landing/primitives";
import { Logo } from "@/components/logo";

/** Error boundary for every page under the root layout. Offers a retry and a way home. */
export default function ErrorPage({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  // Server errors arrive with a digest that matches the server log line; nothing else is shown.
  const digest = error instanceof Error && "digest" in error && typeof error.digest === "string" ? error.digest : null;

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
              <Bars still className="h-7" bars={[0.3, 0.75, 0.18, 0.55, 0.3]} barClassName="w-[3px] bg-white/90" />
            </span>
          </div>
          <Eyebrow className="mt-10">Something went wrong</Eyebrow>
          <h1 className="lp-heading mt-4 text-balance text-[38px] font-semibold leading-[1.04] tracking-[-0.04em] sm:text-[52px]">
            We lost the line for a moment
          </h1>
          <p className="mx-auto mt-5 max-w-md text-pretty text-base leading-7 text-white/65">
            This page hit an error. Try again, and if it keeps happening, let us know what you were doing.
          </p>
          <div className="mt-9 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center">
            <button type="button" onClick={() => retry()} className={lpButton("white")}>
              <RotateCcw aria-hidden />
              Try again
            </button>
            <Link href="/" className={lpButton("glass")}>
              Back to home
            </Link>
            <Link href="/contact" className={lpButton("glass")}>
              Contact us
            </Link>
          </div>
          {digest ? <p className="mt-6 font-mono text-xs text-white/40">Reference: {digest}</p> : null}
        </div>
      </main>
    </div>
  );
}
