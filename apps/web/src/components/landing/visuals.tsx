import {
  AudioLines,
  BookOpenCheck,
  Check,
  Clock,
  Database,
  FileText,
  Globe,
  Hourglass,
  Inbox,
  Keyboard,
  Link2,
  Lock,
  MessageSquareText,
  Mic,
  PanelTop,
  Phone,
  Plus,
  SendHorizontal,
  ShieldCheck,
  Users,
  Zap,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { cx } from "@/components/ui";
import { CopySnippet } from "./client-bits";
import { Bars, Orb } from "./primitives";

/* ---- small shared pieces ------------------------------------------------------- */

function VisitorBubble({ children, typed, className }: { children: ReactNode; typed?: boolean; className?: string }) {
  return (
    <div className={cx("flex flex-col items-end gap-1", className)}>
      <p className="max-w-[86%] rounded-2xl rounded-br-md bg-[#5b45e3] px-3.5 py-2 text-[13px] leading-5 text-white">
        {typed ? null : <Mic className="-mt-0.5 mr-1.5 inline size-3 opacity-70" />}
        {children}
      </p>
      {typed ? (
        <span className="inline-flex items-center gap-1 text-[11px] text-white/55">
          <Keyboard className="size-3" />
          Typed during the call
        </span>
      ) : null}
    </div>
  );
}

function AgentBubble({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p
      className={cx(
        "max-w-[90%] rounded-2xl rounded-bl-md border border-white/10 bg-white/[0.07] px-3.5 py-2 text-[13px] leading-5 text-white/85",
        className,
      )}
    >
      {children}
    </p>
  );
}

function Chip({
  icon: Icon,
  children,
  tone = "violet",
  className,
}: {
  icon?: LucideIcon;
  children: ReactNode;
  tone?: "violet" | "cyan" | "green" | "muted";
  className?: string;
}) {
  const tones = {
    violet: "border-[#7c6cff]/35 bg-[#7c6cff]/12 text-[#cdc7ff]",
    cyan: "border-[#22d3ee]/30 bg-[#22d3ee]/10 text-[#8eeefc]",
    green: "border-emerald-400/30 bg-emerald-400/10 text-emerald-200",
    muted: "border-white/12 bg-white/[0.04] text-white/65",
  };
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[11px] font-medium",
        tones[tone],
        className,
      )}
    >
      {Icon ? <Icon className="size-3 shrink-0" /> : null}
      {children}
    </span>
  );
}

/* ---- Contact form vs Halochime --------------------------------------------------- */

const QUESTION = "Do you see children? And is parking free?";

export function ContactFormCard() {
  const fields = [
    { label: "Name", value: "Sam" },
    { label: "Email", value: "sam@example.com" },
  ];
  return (
    <div className="lp-card flex h-full flex-col rounded-3xl p-5 sm:p-7">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-base font-semibold text-white/80">A contact form</h3>
        <Chip icon={Clock} tone="muted">
          Waiting
        </Chip>
      </div>
      <div aria-hidden className="mt-6 space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          {fields.map((f) => (
            <div key={f.label}>
              <p className="text-[11px] font-medium text-white/50">{f.label}</p>
              <p className="mt-1 truncate rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-[13px] text-white/60">{f.value}</p>
            </div>
          ))}
        </div>
        <div>
          <p className="text-[11px] font-medium text-white/50">Message</p>
          <p className="mt-1 min-h-16 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-[13px] text-white/60">{QUESTION}</p>
        </div>
        <span className="inline-flex rounded-lg bg-white/10 px-4 py-2 text-[13px] font-medium text-white/60">Send message</span>
      </div>
      <div className="mt-6 flex items-start gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.03] p-4">
        <Hourglass className="mt-0.5 size-4 shrink-0 text-white/55" aria-hidden />
        <p className="text-sm text-white/70">&ldquo;Thanks! We&apos;ll reply in 24 to 48 hours.&rdquo;</p>
      </div>
      <p className="mt-auto pt-6 text-sm text-white/55">The visitor leaves, and maybe comes back.</p>
    </div>
  );
}

export function TalkfrontCard() {
  return (
    <div className="h-full rounded-3xl bg-gradient-to-b from-[#7c6cff]/70 via-white/10 to-[#22d3ee]/50 p-px shadow-[0_30px_90px_-30px_rgb(124_108_255/0.55)]">
      <div className="flex h-full flex-col rounded-[23px] bg-[#0c0c17] p-5 sm:p-7">
        <div className="flex items-center justify-between gap-3">
          <h3 className="flex items-center gap-2 text-base font-semibold text-white">
            <Orb className="size-5" />
            Halochime
          </h3>
          <Chip icon={Zap} tone="cyan">
            Answers in about 1.5 s
          </Chip>
        </div>
        <div aria-hidden className="mt-6 space-y-3">
          <VisitorBubble>{QUESTION}</VisitorBubble>
          <div className="space-y-1.5">
            <AgentBubble>Yes, we see children from age 3. Parking is free behind the clinic.</AgentBubble>
            <Chip icon={BookOpenCheck}>Answered from: FAQ</Chip>
          </div>
          <VisitorBubble>Could someone call me about braces?</VisitorBubble>
          <div className="space-y-1.5">
            <AgentBubble>Of course. I&apos;ve saved your number, and the team will get back to you.</AgentBubble>
            <Chip icon={Inbox} tone="green">
              Message saved for the team
            </Chip>
          </div>
        </div>
        <p className="mt-auto pt-6 text-sm text-white/70">The visitor gets an answer while still on your page.</p>
      </div>
    </div>
  );
}

/* ---- How it works ---------------------------------------------------------------- */

export function SourcesVisual() {
  const rows: { icon: LucideIcon; name: string; meta: string }[] = [
    { icon: MessageSquareText, name: "FAQ", meta: "Pasted text" },
    { icon: Globe, name: "lumen-dental.example/prices", meta: "Web page" },
    { icon: FileText, name: "opening-hours.md", meta: "File" },
  ];
  return (
    <div aria-hidden className="space-y-2">
      {rows.map((r) => (
        <div key={r.name} className="flex items-center gap-3 rounded-xl border border-white/10 bg-[#14141f] px-3 py-2">
          <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-white/[0.06] text-[#b3a9ff]">
            <r.icon className="size-3.5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[12.5px] font-medium text-white/90">{r.name}</span>
            <span className="block text-[11px] text-white/50">{r.meta}</span>
          </span>
          <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-emerald-300">
            <span className="size-1.5 rounded-full bg-emerald-400" />
            Ready
          </span>
        </div>
      ))}
      <div className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-white/15 px-3 py-2 text-[12px] font-medium text-white/55">
        <Plus className="size-3.5" />
        Add a source
      </div>
    </div>
  );
}

const SWATCHES = ["#7c6cff", "#22d3ee", "#14b8a6", "#f97316", "#e11d48"];

export function CustomizeVisual() {
  return (
    <div aria-hidden className="space-y-3">
      <div>
        <p className="text-[11px] font-medium text-white/50">Greeting</p>
        <p className="mt-1 truncate rounded-lg border border-[#7c6cff]/50 bg-[#14141f] px-3 py-2 text-[12.5px] text-white/90 ring-4 ring-[#7c6cff]/10">
          Hi! Ask me about bookings or prices.
          <span className="ml-px inline-block h-3.5 w-px translate-y-0.5 bg-white/80 motion-safe:animate-caret" />
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-lg border border-white/10 bg-[#14141f] px-3 py-2">
          <p className="text-[10.5px] text-white/50">Voice</p>
          <p className="mt-0.5 flex items-center gap-1.5 text-[12.5px] font-medium text-white/90">
            <AudioLines className="size-3.5 text-[#8eeefc]" />
            Warm
          </p>
        </div>
        <div className="rounded-lg border border-white/10 bg-[#14141f] px-3 py-2">
          <p className="text-[10.5px] text-white/50">Language</p>
          <p className="mt-0.5 flex items-center gap-1.5 text-[12.5px] font-medium text-white/90">
            <Globe className="size-3.5 text-[#8eeefc]" />
            Auto-detect
          </p>
        </div>
      </div>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-1.5">
          {SWATCHES.map((c, i) => (
            <span
              key={c}
              className={cx("size-5 rounded-full", i === 0 && "ring-2 ring-white ring-offset-2 ring-offset-[#0f0f19]")}
              style={{ background: c }}
            />
          ))}
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-[#5b45e3] px-3 py-1.5 text-[11.5px] font-medium text-white shadow-[0_8px_20px_-6px_rgb(124_108_255/0.8)]">
          <AudioLines className="size-3" />
          Talk to us
        </span>
      </div>
    </div>
  );
}

export function EmbedVisual({ src }: { src: string }) {
  const snippet = `<script src="${src}" data-key="pk_..." async></script>`;
  return (
    <div className="overflow-hidden rounded-xl border border-white/10 bg-[#0a0a12]">
      <div className="flex items-center justify-between gap-3 border-b border-white/[0.07] px-3 py-2">
        <div className="flex items-center gap-1.5" aria-hidden>
          <span className="size-2 rounded-full bg-white/15" />
          <span className="size-2 rounded-full bg-white/15" />
          <span className="size-2 rounded-full bg-white/15" />
          <span className="ml-1.5 text-[11px] text-white/50">index.html</span>
        </div>
        <CopySnippet text={snippet} />
      </div>
      <pre className="whitespace-pre-wrap px-3.5 py-3 font-mono text-[11.5px] leading-[1.7] text-white/75 [overflow-wrap:anywhere]">
        <code>
          <span className="text-white/45">{"<!-- before </body> -->"}</span>
          {"\n"}
          <span className="text-[#f0abfc]">{"<script"}</span> <span className="text-[#b3a9ff]">src</span>=
          <span className="text-[#8eeefc]">{`"${src}"`}</span>
          {"\n  "}
          <span className="text-[#b3a9ff]">data-key</span>=<span className="text-[#8eeefc]">{'"pk_..."'}</span>{" "}
          <span className="text-[#b3a9ff]">async</span>
          <span className="text-[#f0abfc]">{"></script>"}</span>
        </code>
      </pre>
    </div>
  );
}

/* ---- Feature bento ---------------------------------------------------------------- */

export function KnowledgeVisual() {
  return (
    <div aria-hidden className="space-y-3">
      <VisitorBubble>How much is a check-up?</VisitorBubble>
      <div className="space-y-1.5">
        <AgentBubble>A check-up and clean is $65 and takes about 40 minutes.</AgentBubble>
        <div className="flex flex-wrap gap-1.5">
          <Chip icon={Globe}>Prices page</Chip>
          <Chip icon={MessageSquareText}>FAQ</Chip>
        </div>
      </div>
      <VisitorBubble>Do you open on Sundays?</VisitorBubble>
      <AgentBubble>That isn&apos;t in my notes, so I won&apos;t guess. Want me to ask the team?</AgentBubble>
    </div>
  );
}

export function HandoffVisual() {
  return (
    <div aria-hidden className="rounded-2xl border border-white/10 bg-[#14141f] p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-2 text-[12.5px] font-semibold text-white">
          <span className="grid size-6 place-items-center rounded-md bg-emerald-400/15 text-emerald-300">
            <Inbox className="size-3.5" />
          </span>
          New message
        </span>
        <span className="text-[11px] text-white/50">just now</span>
      </div>
      <dl className="mt-3 space-y-1.5 text-[12px]">
        {[
          ["Name", "Sam"],
          ["Phone", "+1 555 0142"],
          ["About", "Braces for a 12 year old"],
        ].map(([k, v]) => (
          <div key={k} className="flex gap-3">
            <dt className="w-12 shrink-0 text-white/50">{k}</dt>
            <dd className="truncate text-white/85">{v}</dd>
          </div>
        ))}
      </dl>
      <span className="mt-3 inline-flex items-center gap-1.5 text-[11.5px] font-medium text-[#cdc7ff]">
        <FileText className="size-3.5" />
        Full transcript attached
      </span>
    </div>
  );
}

export function PageContextVisual() {
  return (
    <div aria-hidden className="space-y-2.5">
      <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-[#14141f] px-3 py-2">
        <Lock className="size-3 shrink-0 text-white/45" />
        <span className="min-w-0 truncate text-[12px] text-white/80">
          lumen-dental.example/<span className="text-[#8eeefc]">whitening</span>
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <Chip icon={PanelTop} tone="cyan">
          Page: Teeth whitening
        </Chip>
        <Chip icon={Link2} tone="muted">
          Started here
        </Chip>
      </div>
      <VisitorBubble>How long does this take?</VisitorBubble>
    </div>
  );
}

const LANGS = [
  "English",
  "Español",
  "Français",
  "Deutsch",
  "Português",
  "Italiano",
  "Nederlands",
  "हिन्दी",
  "اردو",
  "العربية",
  "Türkçe",
  "日本語",
];

export function LanguagesVisual() {
  return (
    <ul aria-hidden className="flex flex-wrap gap-1.5">
      <li className="inline-flex items-center gap-1.5 rounded-full border border-[#22d3ee]/35 bg-[#22d3ee]/10 px-2.5 py-1 text-[12px] font-medium text-[#8eeefc]">
        <Globe className="size-3" />
        Auto-detect
      </li>
      {LANGS.map((l) => (
        <li key={l} className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[12px] text-white/75">
          {l}
        </li>
      ))}
    </ul>
  );
}

export function TypeMidCallVisual() {
  return (
    <div aria-hidden className="rounded-2xl border border-white/10 bg-[#14141f] p-3.5">
      <div className="flex items-center gap-3">
        <span className="lp-orb grid size-9 place-items-center">
          <Bars className="h-3.5" bars={[0.4, 0.8, 0.55, 1, 0.6]} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[12.5px] font-semibold text-white">On a call</span>
          <span className="block text-[11px] text-white/50">01:12</span>
        </span>
        <span className="rounded-md border border-red-400/30 bg-red-400/10 px-2 py-0.5 text-[11px] font-semibold text-red-200">End</span>
      </div>
      <div className="mt-3 flex items-center gap-2 rounded-lg border border-[#7c6cff]/50 bg-[#0c0c16] px-3 py-2 ring-4 ring-[#7c6cff]/10">
        <span className="min-w-0 flex-1 truncate text-[12.5px] text-white/90">
          sam@example.com
          <span className="ml-px inline-block h-3.5 w-px translate-y-0.5 bg-white/80 motion-safe:animate-caret" />
        </span>
        <SendHorizontal className="size-3.5 text-[#b3a9ff]" />
      </div>
    </div>
  );
}

export function IdleTimerVisual() {
  return (
    <div aria-hidden className="flex items-center gap-4">
      <span className="relative grid size-16 shrink-0 place-items-center">
        <svg viewBox="0 0 36 36" className="absolute inset-0 -rotate-90">
          <circle cx="18" cy="18" r="16" fill="none" stroke="rgb(255 255 255 / 0.08)" strokeWidth="2.5" />
          <circle
            cx="18"
            cy="18"
            r="16"
            fill="none"
            stroke="url(#lp-timer)"
            strokeWidth="2.5"
            strokeLinecap="round"
            pathLength={100}
            strokeDasharray="100"
            className="motion-safe:animate-countdown"
            style={{ strokeDashoffset: 30 }}
          />
          <defs>
            <linearGradient id="lp-timer" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#7c6cff" />
              <stop offset="100%" stopColor="#22d3ee" />
            </linearGradient>
          </defs>
        </svg>
        <span className="text-[12px] font-semibold tabular-nums text-white">20 s</span>
      </span>
      <div className="min-w-0 space-y-1.5">
        <AgentBubble className="max-w-none">Are you still there?</AgentBubble>
        <Chip icon={Check} tone="muted">
          No reply, call ended
        </Chip>
      </div>
    </div>
  );
}

export function IsolationVisual() {
  return (
    <div aria-hidden className="grid items-center gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,0.95fr)]">
      <pre className="whitespace-pre-wrap rounded-xl border border-white/10 bg-[#0a0a12] px-3.5 py-3 font-mono text-[11.5px] leading-[1.75] text-white/70">
        <span className="text-white/45">/* your-site.css */</span>
        {"\n"}
        <span className="text-[#f0abfc]">button</span> {"{ all: "}
        <span className="text-[#8eeefc]">unset</span>
        {" }"}
        {"\n"}
        <span className="text-[#f0abfc]">p</span> {"{ font-size: "}
        <span className="text-[#8eeefc]">9px</span>
        {" }"}
        {"\n"}
        <span className="text-[#f0abfc]">*</span> {"{ color: "}
        <span className="text-[#8eeefc]">hotpink</span>
        {" }"}
      </pre>
      <div className="relative rounded-2xl border border-dashed border-[#22d3ee]/40 p-2.5 pt-3.5">
        <span className="absolute -top-2.5 left-3 inline-flex items-center gap-1 rounded-full bg-[#0f0f1a] px-2 text-[10.5px] font-medium text-[#8eeefc]">
          <ShieldCheck className="size-3" />
          Isolated
        </span>
        <div className="rounded-xl bg-white p-3 text-[12px]">
          <div className="flex items-center gap-2">
            <span className="lp-orb size-5" />
            <span className="font-semibold text-slate-900">Your agent</span>
          </div>
          <p className="mt-2 rounded-lg bg-slate-100 px-2.5 py-1.5 text-slate-700">Looks the same on every site.</p>
          <span className="mt-2 inline-flex rounded-md bg-[#5b45e3] px-2.5 py-1 text-[11px] font-medium text-white">Talk</span>
        </div>
      </div>
    </div>
  );
}

/* ---- Knowledge orbit -------------------------------------------------------------- */

type OrbitNode = { label: string; icon: LucideIcon; angle: number; soon?: boolean };

const ORBIT: OrbitNode[] = [
  { label: "FAQ", icon: MessageSquareText, angle: -90 },
  { label: "Website pages", icon: Globe, angle: 30 },
  { label: ".txt and .md files", icon: FileText, angle: 150 },
  { label: "CRM", icon: Users, angle: -30, soon: true },
  { label: "Phone", icon: Phone, angle: 90, soon: true },
  { label: "Database", icon: Database, angle: 210, soon: true },
];

const pos = (angle: number, radiusVar: string) => {
  const rad = (angle * Math.PI) / 180;
  const c = Math.cos(rad).toFixed(4);
  const s = Math.sin(rad).toFixed(4);
  return { left: `calc(50% + ${c} * var(${radiusVar}))`, top: `calc(50% + ${s} * var(${radiusVar}))` };
};

export function KnowledgeOrbit() {
  return (
    <div className="relative mx-auto aspect-square w-full max-w-[540px] [--ri:25%] [--ro:36%] sm:[--ri:27%] sm:[--ro:42%]">
      <div aria-hidden className="pointer-events-none absolute inset-[18%] rounded-full bg-[#7c6cff]/25 blur-[70px]" />
      {/* rings */}
      <div aria-hidden className="absolute inset-[calc(50%_-_var(--ri))] rounded-full border border-white/10" />
      <div aria-hidden className="absolute inset-[calc(50%_-_var(--ro))] rounded-full border border-dashed border-white/[0.09]" />
      {/* travelling dots */}
      <div aria-hidden className="absolute inset-[calc(50%_-_var(--ri))] motion-safe:animate-spin-slow">
        <span className="absolute -top-1 left-1/2 size-2 -translate-x-1/2 rounded-full bg-[#8eeefc] shadow-[0_0_12px_3px_rgb(34_211_238/0.6)]" />
      </div>
      <div aria-hidden className="absolute inset-[calc(50%_-_var(--ro))] motion-safe:animate-spin-slower">
        <span className="absolute -bottom-0.5 left-1/2 size-1.5 -translate-x-1/2 rounded-full bg-[#b3a9ff] shadow-[0_0_10px_2px_rgb(124_108_255/0.6)]" />
      </div>
      {/* centre */}
      <div aria-hidden className="absolute left-1/2 top-1/2 grid size-[20%] -translate-x-1/2 -translate-y-1/2 place-items-center sm:size-[26%]">
        <span className="absolute inset-0 rounded-full bg-[#7c6cff]/30 motion-safe:animate-ripple" />
        <span className="lp-orb relative grid size-full place-items-center shadow-[0_0_80px_-10px_rgb(124_108_255/0.8)] motion-safe:animate-breathe">
          <Bars className="h-[28%]" />
        </span>
      </div>
      {/* sources */}
      <ul aria-label="Knowledge sources" className="absolute inset-0">
        {ORBIT.map((n) => (
          <li
            key={n.label}
            style={pos(n.angle, n.soon ? "--ro" : "--ri")}
            className={cx(
              "absolute inline-flex -translate-x-1/2 -translate-y-1/2 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1.5 text-[11px] font-medium sm:gap-2 sm:py-2 sm:pl-2.5 sm:pr-3 sm:text-[13px]",
              n.soon
                ? "border-dashed border-white/15 bg-[#0b0b13] text-white/60"
                : "border-white/15 bg-[#13131f] text-white shadow-[0_10px_30px_-12px_rgb(124_108_255/0.6)]",
            )}
          >
            <n.icon className={cx("hidden size-3.5 shrink-0 sm:block", n.soon ? "text-white/45" : "text-[#8eeefc]")} aria-hidden />
            {n.label}
            {n.soon ? (
              <span className="rounded-full bg-white/[0.08] px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-white/60">Soon</span>
            ) : (
              <span className="sr-only">(available now)</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
