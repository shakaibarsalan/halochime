"use client";

import { Menu, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Logo } from "@/components/logo";
import { cx } from "@/components/ui";
import { TalkToAgentButton } from "./demo";
import { lpFocus } from "./primitives";

const LINKS = [
  { href: "#how-it-works", label: "How it works" },
  { href: "#features", label: "Features" },
  { href: "#talk", label: "Live demo" },
  { href: "#faq", label: "FAQ" },
];

const index = (i: number) => String(i + 1).padStart(2, "0");

/** Four bars that move while Tara is "online": the Halochime voice motif in miniature. */
function MiniWave({ className }: { className?: string }) {
  return (
    <span aria-hidden className={cx("flex h-3.5 items-center gap-[2px]", className)}>
      {[0.55, 1, 0.7, 0.85].map((h, i) => (
        <span
          key={i}
          className="w-[2px] rounded-full bg-current motion-safe:animate-[tf-nav-wave_1.1s_ease-in-out_infinite]"
          style={{ height: `${h * 100}%`, animationDelay: `${i * 140}ms` }}
        />
      ))}
    </span>
  );
}

const startFree = cx(
  "inline-flex h-9 items-center justify-center whitespace-nowrap rounded-[10px] px-4 text-[13.5px] font-semibold text-white",
  "bg-[linear-gradient(180deg,#7464fa_0%,#5340dc_100%)] shadow-[inset_0_1px_0_rgb(255_255_255/0.22),0_0_0_1px_rgb(124_108_255/0.5),0_10px_28px_-12px_rgb(124_108_255/0.9)]",
  "transition-[box-shadow,filter] duration-200 hover:brightness-110 hover:shadow-[inset_0_1px_0_rgb(255_255_255/0.3),0_0_0_1px_rgb(160_150_255/0.8),0_14px_36px_-12px_rgb(124_108_255/1)]",
  lpFocus,
);

/**
 * Full-width bar: transparent over the hero, solid once the visitor scrolls, with a thin reading
 * progress line. Numbered section links on the left, Tara's live status and the sign-up on the right.
 */
export function LandingNav({ demoKey }: { demoKey?: string }) {
  const [scrolled, setScrolled] = useState(false);
  const [progress, setProgress] = useState(0);
  const [active, setActive] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const onScroll = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      setScrolled(window.scrollY > 12);
      setProgress(max > 0 ? Math.min(1, window.scrollY / max) : 0);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  // The section crossing the upper third of the screen is the active one.
  useEffect(() => {
    const sections = LINKS.map((l) => document.querySelector<HTMLElement>(l.href)).filter((s): s is HTMLElement => !!s);
    if (sections.length === 0 || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        const hit = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (hit) setActive(`#${hit.target.id}`);
        else if (window.scrollY < window.innerHeight * 0.5) setActive(null);
      },
      { rootMargin: "-30% 0px -60% 0px" },
    );
    sections.forEach((s) => io.observe(s));
    return () => io.disconnect();
  }, []);

  // Full-screen phone menu: lock the page behind it, close on Escape, give focus back on close.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // The demo widget's launcher floats above everything; keep it out of the menu's way.
    const widget = document.querySelector<HTMLElement>("talkfront-widget");
    if (widget) widget.style.visibility = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      if (widget) widget.style.visibility = "";
      document.removeEventListener("keydown", onKey);
      menuButton.current?.focus();
    };
  }, [open]);

  return (
    <>
      <header
        className={cx(
          "sticky top-0 z-40 border-b transition-[background-color,border-color] duration-300",
          scrolled ? "border-white/[0.07] bg-[#07070c]/85 backdrop-blur-xl" : "border-transparent bg-transparent",
        )}
      >
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-4 sm:px-6">
          <Logo tone="dark" />

          <span aria-hidden className="hidden h-5 w-px bg-white/10 lg:block" />

          <nav aria-label="Main" className="hidden lg:block">
            <ul className="flex items-center gap-1">
              {LINKS.map((l, i) => {
                const isActive = active === l.href;
                return (
                  <li key={l.href}>
                    <a
                      href={l.href}
                      aria-current={isActive ? "true" : undefined}
                      className={cx(
                        "group inline-flex items-baseline gap-1.5 rounded-md px-2.5 py-1.5 text-[13.5px] font-medium transition-colors",
                        isActive ? "text-white" : "text-white/60 hover:text-white",
                        lpFocus,
                      )}
                    >
                      <span
                        className={cx(
                          "font-mono text-[10.5px] tabular-nums transition-colors",
                          isActive ? "text-[#22d3ee]" : "text-white/30 group-hover:text-[#b3a9ff]",
                        )}
                      >
                        {index(i)}
                      </span>
                      {l.label}
                    </a>
                  </li>
                );
              })}
            </ul>
          </nav>

          <div className="ml-auto flex shrink-0 items-center gap-2 sm:gap-3">
            <TalkToAgentButton
              demoKey={demoKey}
              className={cx(
                "hidden items-center gap-2 rounded-[10px] border border-[#22d3ee]/20 bg-[#22d3ee]/[0.06] px-3 py-2 text-[13px] font-medium text-[#a5f0fa] transition-colors hover:border-[#22d3ee]/40 hover:bg-[#22d3ee]/[0.1] md:inline-flex",
                lpFocus,
              )}
            >
              <span className="relative flex size-1.5" aria-hidden>
                <span className="absolute inset-0 rounded-full bg-[#22d3ee] motion-safe:animate-ping" />
                <span className="relative size-1.5 rounded-full bg-[#22d3ee]" />
              </span>
              Tara is online
              <MiniWave className="text-[#22d3ee]" />
            </TalkToAgentButton>

            <Link
              href="/docs"
              className={cx("hidden px-1 text-[13.5px] font-medium text-white/65 transition-colors hover:text-white sm:inline", lpFocus)}
            >
              Docs
            </Link>
            <Link
              href="/sign-in"
              className={cx("hidden px-1 text-[13.5px] font-medium text-white/65 transition-colors hover:text-white sm:inline", lpFocus)}
            >
              Sign in
            </Link>
            <Link href="/sign-up" className={startFree}>
              Start free
            </Link>
            <button
              ref={menuButton}
              type="button"
              aria-expanded={open}
              aria-controls="lp-mobile-menu"
              aria-label="Open menu"
              onClick={() => setOpen(true)}
              className={cx(
                "grid size-9 place-items-center rounded-[10px] border border-white/10 text-white/80 transition-colors hover:bg-white/[0.06] hover:text-white lg:hidden",
                lpFocus,
              )}
            >
              <Menu className="size-4" aria-hidden />
            </button>
          </div>
        </div>

        {/* Reading progress */}
        <span
          aria-hidden
          className={cx(
            "absolute bottom-[-1px] left-0 h-px origin-left bg-gradient-to-r from-[#7c6cff] via-[#a78bfa] to-[#22d3ee] transition-opacity duration-300",
            scrolled ? "opacity-100" : "opacity-0",
          )}
          style={{ width: `${progress * 100}%` }}
        />

      </header>

      {open ? (
        <div
          id="lp-mobile-menu"
          role="dialog"
          aria-modal="true"
          aria-label="Menu"
          className="fixed inset-0 z-50 flex flex-col bg-[#07070c] lg:hidden"
        >
          <div aria-hidden className="pointer-events-none absolute -top-24 left-1/2 size-[420px] -translate-x-1/2 rounded-full bg-[#7c6cff]/20 blur-[90px]" />
          <div className="relative flex h-16 items-center justify-between px-4 sm:px-6">
            <Logo tone="dark" />
            <button
              type="button"
              aria-label="Close menu"
              onClick={() => setOpen(false)}
              className={cx(
                "grid size-9 place-items-center rounded-[10px] border border-white/10 text-white/80 transition-colors hover:bg-white/[0.06] hover:text-white",
                lpFocus,
              )}
            >
              <X className="size-4" aria-hidden />
            </button>
          </div>
          <nav aria-label="Main" className="relative flex-1 overflow-y-auto px-6 pt-6">
            <ul className="space-y-1">
              {LINKS.map((l, i) => (
                <li key={l.href} className="motion-safe:animate-rise" style={{ animationDelay: `${60 + i * 50}ms` }}>
                  <a
                    href={l.href}
                    onClick={() => setOpen(false)}
                    className={cx(
                      "flex items-baseline gap-4 border-b border-white/[0.06] py-4 text-[28px] font-semibold tracking-tight",
                      active === l.href ? "text-white" : "text-white/80 hover:text-white",
                      lpFocus,
                    )}
                  >
                    <span className={cx("font-mono text-xs tabular-nums", active === l.href ? "text-[#22d3ee]" : "text-white/35")}>
                      {index(i)}
                    </span>
                    {l.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
          <div className="relative space-y-3 px-6 pb-8 pt-4">
            <TalkToAgentButton
              demoKey={demoKey}
              onActivate={() => setOpen(false)}
              className={cx(
                "flex w-full items-center justify-center gap-2.5 rounded-xl border border-[#22d3ee]/25 bg-[#22d3ee]/[0.08] py-3.5 text-[15px] font-medium text-[#a5f0fa]",
                lpFocus,
              )}
            >
              <MiniWave className="text-[#22d3ee]" />
              Talk to Tara
            </TalkToAgentButton>
            <Link
              href="/docs"
              className={cx("flex items-center justify-center py-1.5 text-[15px] font-medium text-white/70 transition-colors hover:text-white", lpFocus)}
            >
              Developer docs
            </Link>
            <div className="grid grid-cols-2 gap-3">
              <Link
                href="/sign-in"
                className={cx("flex items-center justify-center rounded-xl border border-white/10 py-3.5 text-[15px] font-medium text-white/85", lpFocus)}
              >
                Sign in
              </Link>
              <Link href="/sign-up" className={cx(startFree, "h-auto py-3.5 text-[15px]")}>
                Start free
              </Link>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
