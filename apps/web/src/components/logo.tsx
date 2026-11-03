import Link from "next/link";
import { cx } from "./ui";

/**
 * The Halochime mark: a chat bubble with three voice bars, on a gradient tile. The gradient is CSS on
 * the tile and the SVG uses flat fills, so any number of logos can share a page without SVG id clashes.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cx(
        "relative flex size-7 shrink-0 rounded-[8px]",
        "shadow-[0_2px_8px_-2px_rgb(91_69_227/0.55),inset_0_1px_0_rgb(255_255_255/0.3)]",
        className,
      )}
      style={{
        background:
          "radial-gradient(circle at 30% 18%, rgb(255 255 255 / 0.34), transparent 55%), linear-gradient(155deg, #9d8cff 0%, #5b45e3 52%, #22d3ee 100%)",
      }}
    >
      <svg viewBox="1 1 30 30" className="size-full">
        <path
          d="M11 7.5h10a5.5 5.5 0 0 1 5.5 5.5v4a5.5 5.5 0 0 1-5.5 5.5h-6.2l-4.1 3.3c-.5.4-1.2 0-1.2-.6v-2.9A5.5 5.5 0 0 1 5.5 17v-4A5.5 5.5 0 0 1 11 7.5Z"
          fill="#fff"
        />
        <rect x="11.2" y="12.6" width="2.2" height="4.8" rx="1.1" fill="#5b45e3" />
        <rect x="14.9" y="10.6" width="2.2" height="8.8" rx="1.1" fill="#5b45e3" />
        <rect x="18.6" y="12" width="2.2" height="6" rx="1.1" fill="#5b45e3" />
      </svg>
    </span>
  );
}

export function Logo({
  href = "/",
  className,
  tone = "light",
}: {
  href?: string;
  className?: string;
  /** "dark" for dark backgrounds (the landing page). */
  tone?: "light" | "dark";
}) {
  return (
    <Link
      href={href}
      aria-label="Halochime home"
      className={cx(
        "inline-flex items-center gap-2.5 rounded-lg text-[19px] leading-none tracking-[-0.035em] focus-visible:outline-2 focus-visible:outline-offset-4",
        tone === "dark" ? "text-white focus-visible:outline-[#b3a9ff]" : "text-slate-900 focus-visible:outline-brand-600",
        className,
      )}
    >
      <LogoMark />
      <span>
        <span className="font-bold">halo</span>
        <span className={cx("font-medium", tone === "dark" ? "text-white/60" : "text-slate-900/55")}>chime</span>
      </span>
    </Link>
  );
}
