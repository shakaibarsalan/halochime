import { MessagesSquare, Mic, type LucideIcon } from "lucide-react";
import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");
export { cx };

type Variant = "primary" | "secondary" | "danger" | "ghost" | "dark";
type Size = "sm" | "md" | "lg";

const variants: Record<Variant, string> = {
  primary:
    "bg-brand-600 text-white shadow-[0_1px_0_rgb(255_255_255/0.18)_inset,0_1px_2px_rgb(30_23_74/0.25)] hover:bg-brand-700 active:bg-brand-800 focus-visible:outline-brand-600",
  secondary:
    "bg-white text-slate-800 border border-slate-200 shadow-xs hover:bg-slate-50 hover:border-slate-300 active:bg-slate-100 focus-visible:outline-brand-600",
  danger:
    "bg-white text-red-700 border border-red-200 hover:bg-red-50 hover:border-red-300 active:bg-red-100 focus-visible:outline-red-600",
  ghost: "text-slate-700 hover:bg-slate-900/5 hover:text-slate-900 active:bg-slate-900/10 focus-visible:outline-brand-600",
  dark: "bg-ink text-white hover:bg-slate-800 active:bg-slate-700 focus-visible:outline-ink",
};

const sizes: Record<Size, string> = {
  sm: "h-8 px-3 text-xs rounded-lg",
  md: "h-9 px-3.5 text-sm rounded-lg",
  lg: "h-11 px-5 text-[15px] rounded-xl",
};

export const buttonClass = (variant: Variant = "primary", size: Size = "md") =>
  cx(
    "inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium transition-[background-color,border-color,color,box-shadow,transform] duration-150",
    "focus-visible:outline-2 focus-visible:outline-offset-2 disabled:pointer-events-none disabled:opacity-50",
    "[&_svg]:size-4 [&_svg]:shrink-0",
    sizes[size],
    variants[variant],
  );

export function Button({
  variant = "primary",
  size = "md",
  className,
  ...props
}: ComponentProps<"button"> & { variant?: Variant; size?: Size }) {
  return <button {...props} className={cx(buttonClass(variant, size), className)} />;
}

export function ButtonLink({
  variant = "primary",
  size = "md",
  className,
  ...props
}: ComponentProps<typeof Link> & { variant?: Variant; size?: Size }) {
  return <Link {...props} className={cx(buttonClass(variant, size), className)} />;
}

const field =
  "block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-xs outline-none transition-[border-color,box-shadow] " +
  "placeholder:text-slate-400 hover:border-slate-300 focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15 " +
  "aria-[invalid=true]:border-red-400 aria-[invalid=true]:focus:ring-red-500/15 " +
  "disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input {...props} className={cx(field, "h-9", className)} />;
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea {...props} className={cx(field, "min-h-24 leading-6", className)} />;
}

export function Select({ className, ...props }: ComponentProps<"select">) {
  return <select {...props} className={cx(field, "select-chevron h-9 appearance-none pr-9", className)} />;
}

export function Field({
  label,
  hint,
  error,
  htmlFor,
  children,
}: {
  label: string;
  hint?: ReactNode;
  error?: ReactNode;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-sm font-medium text-slate-800">
        {label}
      </label>
      {children}
      {error ? (
        <p className="text-xs font-medium text-red-600">{error}</p>
      ) : hint ? (
        <p className="text-xs leading-5 text-slate-500">{hint}</p>
      ) : null}
    </div>
  );
}

/** Accessible on/off switch backed by a real checkbox (so forms submit "on" as before). */
export function Toggle({
  name,
  value,
  defaultChecked,
  label,
  hint,
}: {
  name: string;
  value?: string;
  defaultChecked: boolean;
  label: string;
  hint?: ReactNode;
}) {
  return (
    <label className="group flex cursor-pointer items-start justify-between gap-4 rounded-xl border border-slate-200 bg-white px-4 py-3 transition-colors hover:border-slate-300 has-[:checked]:border-brand-200 has-[:checked]:bg-brand-50/40">
      <span className="min-w-0">
        <span className="block text-sm font-medium text-slate-900">{label}</span>
        {hint ? <span className="mt-0.5 block text-xs leading-5 text-slate-500">{hint}</span> : null}
      </span>
      <input type="checkbox" name={name} value={value} defaultChecked={defaultChecked} className="peer sr-only" />
      <span
        aria-hidden
        className="relative mt-0.5 h-5 w-9 shrink-0 rounded-full bg-slate-200 transition-colors peer-checked:bg-brand-600 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand-600 after:absolute after:left-0.5 after:top-0.5 after:size-4 after:rounded-full after:bg-white after:shadow-sm after:transition-transform peer-checked:after:translate-x-4"
      />
    </label>
  );
}

export function Card({ className, children, id }: { className?: string; children: ReactNode; id?: string }) {
  return (
    <section id={id} className={cx("rounded-2xl border border-slate-200/80 bg-white shadow-soft", className)}>
      {children}
    </section>
  );
}

export function CardHeader({
  title,
  description,
  action,
  icon: Icon,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  icon?: LucideIcon;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
      <div className="flex min-w-0 items-start gap-3">
        {Icon ? (
          <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-600 ring-1 ring-brand-100" aria-hidden>
            <Icon className="size-4" />
          </span>
        ) : null}
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold text-slate-900">{title}</h2>
          {description ? <p className="mt-0.5 text-sm text-slate-500">{description}</p> : null}
        </div>
      </div>
      {action}
    </div>
  );
}

/** Page title row. Stays on one line on phones: the title truncates, the action keeps its size. */
export function PageHeader({
  title,
  description,
  action,
  back,
  badge,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  back?: { href: string; label: string };
  badge?: ReactNode;
}) {
  return (
    <div className="mb-6 sm:mb-8">
      {back ? (
        <Link
          href={back.href}
          className="mb-3 inline-flex items-center gap-1 rounded-md text-sm text-slate-500 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
            <path d="m15 18-6-6 6-6" />
          </svg>
          {back.label}
        </Link>
      ) : null}
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <h1 className="min-w-0 truncate text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl" title={title}>
            {title}
          </h1>
          {badge}
        </div>
        {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
      </div>
      {description ? <p className="mt-1 text-sm text-slate-500">{description}</p> : null}
    </div>
  );
}

const badgeTones = {
  gray: "bg-slate-100 text-slate-700 ring-slate-500/15",
  green: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  amber: "bg-amber-50 text-amber-800 ring-amber-600/25",
  red: "bg-red-50 text-red-700 ring-red-600/20",
  blue: "bg-brand-50 text-brand-700 ring-brand-600/20",
} as const;

const dotTones = {
  gray: "bg-slate-400",
  green: "bg-emerald-500",
  amber: "bg-amber-500",
  red: "bg-red-500",
  blue: "bg-brand-500",
} as const;

export function Badge({
  tone = "gray",
  dot,
  icon: Icon,
  children,
}: {
  tone?: keyof typeof badgeTones;
  dot?: boolean;
  icon?: LucideIcon;
  children: ReactNode;
}) {
  return (
    <span
      className={cx(
        "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset",
        badgeTones[tone],
      )}
    >
      {dot ? <span className={cx("size-1.5 rounded-full", dotTones[tone])} aria-hidden /> : null}
      {Icon ? <Icon className="size-3" aria-hidden /> : null}
      <span className="inline-block first-letter:uppercase">{children}</span>
    </span>
  );
}

export function EmptyState({
  title,
  icon: Icon,
  action,
  children,
}: {
  title: string;
  icon?: LucideIcon;
  action?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center px-5 py-14 text-center">
      {Icon ? (
        <span className="mb-4 grid size-12 place-items-center rounded-2xl bg-gradient-to-br from-brand-50 to-orange-50 text-brand-600 ring-1 ring-brand-100" aria-hidden>
          <Icon className="size-5" />
        </span>
      ) : null}
      <p className="text-sm font-semibold text-slate-900">{title}</p>
      {children ? <div className="mt-1 max-w-sm text-sm text-slate-500">{children}</div> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

/** Table wrapper that scrolls sideways on small screens instead of squashing columns. */
export function Table({ children, minWidth = 640 }: { children: ReactNode; minWidth?: number }) {
  return (
    // relative: keeps absolutely positioned children (sr-only labels) from widening the page.
    <div className="relative overflow-x-auto">
      <table className="w-full text-left text-sm" style={{ minWidth }}>
        {children}
      </table>
    </div>
  );
}

export function Th({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <th
      className={cx(
        "border-b border-slate-200/80 bg-slate-50/70 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500 first:pl-5 last:pr-5",
        className,
      )}
    >
      {children}
    </th>
  );
}

export function Td({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <td className={cx("border-b border-slate-100 px-4 py-3 align-middle text-slate-700 first:pl-5 last:pr-5 [tr:last-child_&]:border-b-0", className)}>
      {children}
    </td>
  );
}

/** Table row with hover state. */
export function Tr({ children, className }: { children: ReactNode; className?: string }) {
  return <tr className={cx("transition-colors hover:bg-slate-50/80", className)}>{children}</tr>;
}

/** Truncated cell text with the full text on hover. */
export function Truncate({ text, className }: { text: string | null | undefined; className?: string }) {
  if (!text) return <span className="text-slate-400">-</span>;
  return (
    <span title={text} className={cx("block truncate", !className?.includes("max-w-") && "max-w-xs", className)}>
      {text}
    </span>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "error" | "success"; children: ReactNode }) {
  const tones = {
    info: "bg-brand-50 text-brand-800 border-brand-100",
    error: "bg-red-50 text-red-700 border-red-100",
    success: "bg-emerald-50 text-emerald-700 border-emerald-100",
  };
  return (
    <div role={tone === "error" ? "alert" : "status"} className={cx("rounded-lg border px-3 py-2 text-sm", tones[tone])}>
      {children}
    </div>
  );
}

/** Small label + value tile with an icon, for KPI rows. */
export function StatCard({
  label,
  value,
  href,
  icon: Icon,
  hint,
  tone = "brand",
}: {
  label: string;
  value: string;
  href: string;
  icon: LucideIcon;
  hint?: string;
  tone?: "brand" | "amber" | "red";
}) {
  const iconTone = {
    brand: "bg-brand-50 text-brand-600 ring-brand-100",
    amber: "bg-amber-50 text-amber-600 ring-amber-100",
    red: "bg-red-50 text-red-600 ring-red-100",
  }[tone];
  return (
    <Link
      href={href}
      className="group rounded-2xl border border-slate-200/80 bg-white p-4 shadow-soft transition-[border-color,box-shadow,transform] hover:-translate-y-px hover:border-brand-200 hover:shadow-lift focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 sm:p-5"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-xs font-medium text-slate-500 sm:text-sm" title={label}>
          {label}
        </p>
        <span className={cx("grid size-8 shrink-0 place-items-center rounded-lg ring-1", iconTone)} aria-hidden>
          <Icon className="size-4" />
        </span>
      </div>
      <p className="mt-2 text-2xl font-semibold tracking-tight text-slate-900 tabular-nums sm:text-[28px]">{value}</p>
      {hint ? <p className="mt-0.5 truncate text-xs text-slate-500">{hint}</p> : null}
    </Link>
  );
}

export function ModeBadge({ mode }: { mode: "voice" | "text" }) {
  return mode === "voice" ? (
    <Badge tone="blue" icon={Mic}>
      voice
    </Badge>
  ) : (
    <Badge tone="gray" icon={MessagesSquare}>
      text
    </Badge>
  );
}

export function AgentStatusBadge({ status }: { status: "draft" | "published" }) {
  return (
    <Badge tone={status === "published" ? "green" : "amber"} dot>
      {status}
    </Badge>
  );
}
