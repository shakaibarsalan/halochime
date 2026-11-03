import type { ReactNode } from "react";
import { cx } from "@/components/ui";

/** Focus ring that stays visible on the dark landing. */
export const lpFocus = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#b3a9ff]";

type LpVariant = "primary" | "glass" | "white";
type LpSize = "sm" | "md" | "lg";

export function lpButton(variant: LpVariant = "primary", size: LpSize = "lg") {
  return cx(
    "group relative inline-flex items-center justify-center gap-2.5 whitespace-nowrap rounded-full font-medium",
    "transition-[background-color,border-color,color,box-shadow,transform] duration-200 [&_svg]:size-4 [&_svg]:shrink-0",
    lpFocus,
    size === "lg" && "h-12 px-6 text-[15px]",
    size === "md" && "h-10 px-5 text-sm",
    size === "sm" && "h-9 px-4 text-sm",
    variant === "primary" &&
      "bg-[linear-gradient(180deg,#6f5ff8_0%,#5340dc_100%)] text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.22),0_0_0_1px_rgb(124_108_255/0.55),0_12px_32px_-10px_rgb(124_108_255/0.75)] hover:-translate-y-px hover:shadow-[inset_0_1px_0_rgb(255_255_255/0.3),0_0_0_1px_rgb(160_150_255/0.8),0_16px_44px_-10px_rgb(124_108_255/0.95)] active:translate-y-0",
    variant === "glass" &&
      "border border-white/12 bg-white/[0.04] text-white hover:border-white/25 hover:bg-white/[0.08] active:bg-white/[0.12]",
    variant === "white" &&
      "bg-white text-[#0b0b14] shadow-[0_12px_32px_-12px_rgb(255_255_255/0.45)] hover:-translate-y-px hover:bg-[#eceaff] active:translate-y-0",
  );
}

export function Orb({ className }: { className?: string }) {
  return <span className={cx("lp-orb inline-block shrink-0", className)} aria-hidden />;
}

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cx("inline-flex items-center gap-2 text-[13px] font-medium tracking-wide text-[#b3a9ff]", className)}>
      <span className="h-px w-5 bg-gradient-to-r from-transparent to-[#b3a9ff]" aria-hidden />
      {children}
    </p>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  body,
  id,
  align = "center",
}: {
  eyebrow: string;
  title: ReactNode;
  body?: ReactNode;
  id: string;
  align?: "center" | "left";
}) {
  return (
    <div className={cx("max-w-2xl", align === "center" ? "mx-auto text-center" : "text-left")}>
      <Eyebrow>{eyebrow}</Eyebrow>
      <h2
        id={id}
        className="lp-heading mt-4 text-balance text-[34px] font-semibold leading-[1.05] tracking-[-0.035em] sm:text-5xl"
      >
        {title}
      </h2>
      {body ? <p className="mt-4 text-pretty text-base leading-7 text-white/65 sm:text-lg sm:leading-8">{body}</p> : null}
    </div>
  );
}

/** Small animated waveform. Decorative. */
export function Bars({
  bars = [0.45, 0.8, 0.6, 1, 0.7, 0.9, 0.5],
  className,
  barClassName = "bg-white",
  still = false,
}: {
  bars?: number[];
  className?: string;
  barClassName?: string;
  still?: boolean;
}) {
  return (
    <span className={cx("flex items-center gap-[3px]", className)} aria-hidden>
      {bars.map((h, i) => (
        <span
          key={i}
          className={cx("w-[3px] rounded-full", barClassName, !still && "motion-safe:animate-bar")}
          style={{ height: `${h * 100}%`, animationDelay: `${i * 0.11}s` }}
        />
      ))}
    </span>
  );
}
