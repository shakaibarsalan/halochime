"use client";

import { BookOpenCheck, Inbox, Keyboard, Languages, Mic, type LucideIcon } from "lucide-react";
import { memo, useEffect, useRef, useState, type CSSProperties } from "react";
import { cx } from "@/components/ui";
import { TalkToAgentButton } from "./demo";
import { lpFocus } from "./primitives";

/* ---- Script ------------------------------------------------------------------------------ */

type Who = "visitor" | "agent";
type Turn = { who: Who; text: string; typed?: boolean };

const TURNS: Turn[] = [
  { who: "agent", text: "Hi, I'm Tara. How can I help you today?" },
  { who: "visitor", text: "Do you have a slot on Saturday?" },
  { who: "agent", text: "Yes, we're open 9 to 5. Shall I ask the team to book you in?" },
  { who: "visitor", text: "Yes please, sam@example.com", typed: true },
  { who: "agent", text: "Done. The team will email you to confirm a time." },
];

type ChipId = "lang" | "source" | "typed" | "saved";

type Step = {
  turn: number;
  /** the turn's words (or typed characters) appear during this step */
  reveal?: boolean;
  /** time after the words are all in */
  hold: number;
  /** chips visible from the start of this step, and those added once the words are in */
  chips: ChipId[];
  chipsWhenDone?: ChipId[];
  /** everything fades out before the loop restarts */
  outro?: boolean;
};

const STEPS: Step[] = [
  { turn: 0, reveal: true, hold: 700, chips: [] },
  { turn: 0, hold: 650, chips: [] },
  { turn: 1, reveal: true, hold: 500, chips: [], chipsWhenDone: ["lang"] },
  { turn: 1, hold: 800, chips: ["lang"] },
  { turn: 2, reveal: true, hold: 900, chips: ["lang", "source"] },
  { turn: 2, hold: 700, chips: ["lang", "source"] },
  { turn: 3, reveal: true, hold: 500, chips: ["lang", "source"], chipsWhenDone: ["typed"] },
  { turn: 3, hold: 700, chips: ["lang", "source", "typed"] },
  { turn: 4, reveal: true, hold: 600, chips: ["lang", "source", "typed"], chipsWhenDone: ["saved"] },
  { turn: 4, hold: 3400, chips: ["lang", "source", "typed", "saved"] },
  { turn: 4, hold: 900, chips: [], outro: true },
];

/** The calm frame for reduced motion: the last reply, every chip, bars at rest. */
const FINAL_STEP = 9;
const WORD_MS = 190;
const CHAR_MS = 55;

const units = (t: Turn) => (t.typed ? t.text.length : t.text.split(" ").length);

/* ---- Waveform ---------------------------------------------------------------------------- */

const PER_SIDE = 36;

/** Small deterministic hash so server and client render identical bars. */
function rand(i: number, salt: number) {
  let t = (i * 2654435761 + salt * 40503) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const r2 = (n: number) => Math.round(n * 100) / 100;

type BarSpec = { amp: number; dur: number; delay: number };

function side(salt: number): BarSpec[] {
  return Array.from({ length: PER_SIDE }, (_, k) => {
    const d = k / (PER_SIDE - 1);
    const env = 0.16 + 0.84 * Math.pow(1 - d, 1.3);
    return {
      amp: r2(env * (0.7 + 0.3 * rand(k, salt))),
      dur: r2(0.8 + 0.7 * rand(k, salt + 1)),
      delay: -r2(rand(k, salt + 2) * 1.6),
    };
  });
}

/** Index 0 sits next to the orb on both sides. */
const LEFT = side(11);
const RIGHT = side(29);

function BarRow({ bars, dir }: { bars: BarSpec[]; dir: "left" | "right" }) {
  return (
    <div className={cx("flex h-full min-w-0 flex-1 items-center justify-between", dir === "left" && "flex-row-reverse")}>
      {bars.map((b, k) => (
        <span
          key={k}
          className={cx("lp-wave-bar", k % 2 === 1 && "max-md:hidden")}
          style={{ "--amp": b.amp, "--dur": `${b.dur}s`, "--delay": `${b.delay}s` } as CSSProperties}
        >
          <span />
        </span>
      ))}
    </div>
  );
}

/** Static markup: colour, amplitude and pausing come from data attributes on the parent. */
const Wave = memo(function Wave() {
  return (
    <>
      <BarRow bars={LEFT} dir="left" />
      <div className="w-[128px] shrink-0 md:w-[184px] lg:w-[224px]" />
      <BarRow bars={RIGHT} dir="right" />
    </>
  );
});

/* ---- Chips ------------------------------------------------------------------------------- */

const CHIPS: Record<ChipId, { icon: LucideIcon; label: string; value: string; tone: "cyan" | "violet" }> = {
  lang: { icon: Languages, label: "Talks in", value: "12 languages", tone: "cyan" },
  source: { icon: BookOpenCheck, label: "Answered from", value: "Opening hours", tone: "violet" },
  typed: { icon: Keyboard, label: "Typed during the call", value: "sam@example.com", tone: "cyan" },
  saved: { icon: Inbox, label: "For the team", value: "Message saved", tone: "violet" },
};

function Chip({ id, show, className }: { id: ChipId; show: boolean; className?: string }) {
  const c = CHIPS[id];
  return (
    <div className={cx("lp-chip", show && "is-on", className)}>
      <span
        className={cx(
          "grid size-7 shrink-0 place-items-center rounded-[9px] border md:size-8 md:rounded-[10px]",
          c.tone === "cyan" ? "border-[#22d3ee]/25 bg-[#22d3ee]/10 text-[#7ee8f7]" : "border-[#7c6cff]/30 bg-[#7c6cff]/15 text-[#c4bcff]",
        )}
      >
        <c.icon className="size-3.5 md:size-4" />
      </span>
      <span className="min-w-0 text-left leading-tight">
        <span className="block truncate text-[10.5px] font-medium text-white/60 md:text-[11px]">{c.label}</span>
        <span className="mt-0.5 block truncate text-[12.5px] font-medium text-white md:text-[13.5px]">{c.value}</span>
      </span>
    </div>
  );
}

/* ---- Captions ---------------------------------------------------------------------------- */

function Caption({ turn, count }: { turn: Turn; count: number }) {
  const n = units(turn);
  if (turn.typed) {
    const chars = [...turn.text];
    return (
      <p className="lp-caption">
        {chars.map((ch, i) => (
          <span key={i}>
            {i === count && count < n ? <span className="lp-caret" /> : null}
            <span className={i < count ? undefined : "opacity-0"}>{ch}</span>
          </span>
        ))}
      </p>
    );
  }
  const words = turn.text.split(" ");
  return (
    <p className="lp-caption">
      {words.map((w, i) => (
        <span key={i}>
          {i > 0 ? " " : null}
          <span className={cx("lp-word", i < count && "is-on")}>{w}</span>
        </span>
      ))}
    </p>
  );
}

function Speaker({ turn }: { turn: Turn }) {
  if (turn.who === "agent") {
    return (
      <span className="inline-flex items-center gap-2 rounded-full border border-[#7c6cff]/30 bg-[#7c6cff]/12 py-1 pl-1 pr-3 text-[12.5px] font-medium text-[#d4ceff]">
        <span className="lp-orb size-5" />
        Tara <span className="text-white/45">·</span> Lumen Dental
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-[#22d3ee]/25 bg-[#22d3ee]/10 py-1 pl-1.5 pr-3 text-[12.5px] font-medium text-[#a5f0fa]">
      <span className="grid size-5 place-items-center rounded-full bg-[#22d3ee]/20">
        {turn.typed ? <Keyboard className="size-3" /> : <Mic className="size-3" />}
      </span>
      {turn.typed ? "Visitor · typing" : "Visitor"}
    </span>
  );
}

/** Call length: restarts with each loop, freezes while the stage is off screen. */
function CallTimer({ started, running, resetKey }: { started: boolean; running: boolean; resetKey: number }) {
  const [s, setS] = useState(18);
  useEffect(() => {
    if (started) setS(0);
  }, [resetKey, started]);
  useEffect(() => {
    if (!running) return;
    const t = window.setInterval(() => setS((v) => v + 1), 1000);
    return () => window.clearInterval(t);
  }, [running]);
  return (
    <span className="tabular-nums">
      {Math.floor(s / 60)}:{String(s % 60).padStart(2, "0")}
    </span>
  );
}

/* ---- Stage ------------------------------------------------------------------------------- */

/**
 * The hero's "live call" card: a short made-up call on a dental clinic's site, shown as big
 * captions over a waveform, on a gentle loop. The orb opens the real demo widget.
 */
export function HeroStage({ demoKey }: { demoKey?: string }) {
  const [step, setStep] = useState(0);
  const [count, setCount] = useState(0);
  const [loop, setLoop] = useState(0);
  const [running, setRunning] = useState(false);
  const [visible, setVisible] = useState(true);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (reduce.matches) {
      setStep(FINAL_STEP);
      setCount(units(TURNS[STEPS[FINAL_STEP].turn]));
      return;
    }
    setRunning(true);
    const el = root.current;
    // Pause only while the card is off screen. Hidden tabs are already throttled by the browser,
    // and some embedded browsers never send a "visible again" event, which froze the loop.
    let io: IntersectionObserver | undefined;
    if (el && typeof IntersectionObserver !== "undefined") {
      io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { threshold: 0.1 });
      io.observe(el);
    }
    return () => io?.disconnect();
  }, []);

  const s = STEPS[step];
  const turn = TURNS[s.turn];
  const total = units(turn);
  const live = running && visible;

  // Words / characters come in one by one, then the step holds and moves on.
  useEffect(() => {
    if (!live) return;
    if (s.reveal && count < total) {
      const t = window.setTimeout(() => setCount((c) => c + 1), turn.typed ? CHAR_MS : WORD_MS);
      return () => window.clearTimeout(t);
    }
    const t = window.setTimeout(() => {
      const next = (step + 1) % STEPS.length;
      const nt = TURNS[STEPS[next].turn];
      setStep(next);
      setCount(STEPS[next].reveal ? 0 : units(nt));
      if (next === 0) setLoop((l) => l + 1);
    }, s.hold);
    return () => window.clearTimeout(t);
  }, [live, step, count, s, total, turn.typed]);

  const done = count >= total;
  const voice: Who | null = s.reveal && !turn.typed && !done ? turn.who : null;
  const chips = new Set<ChipId>([...s.chips, ...(done && s.chipsWhenDone ? s.chipsWhenDone : [])]);
  const on = (id: ChipId) => chips.has(id);

  return (
    <div ref={root} className="relative mx-auto w-full max-w-6xl motion-safe:animate-fade-up [animation-delay:240ms]">
      <p className="sr-only">
        Example call on a dental clinic&apos;s website: a visitor asks out loud for a slot on Saturday, Tara answers from
        the clinic&apos;s opening hours, the visitor types an email during the call, and Tara saves a message for the team.
      </p>

      {/* halo behind the card */}
      <div aria-hidden className="pointer-events-none absolute inset-x-[8%] -top-16 h-56 rounded-full bg-[#6a55ff]/30 blur-[90px]" />

      <div className="lp-stage relative rounded-[26px] px-4 pb-5 pt-4 md:rounded-[32px] md:px-8 md:pb-9 md:pt-6 lg:px-10 lg:pb-10 lg:pt-7">
        {/* voice-tinted glows */}
        <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]">
          <div
            className={cx(
              "absolute bottom-[-30%] left-1/2 h-[70%] w-[70%] -translate-x-1/2 rounded-full bg-[#22d3ee]/25 blur-[90px] transition-opacity duration-700",
              voice === "visitor" ? "opacity-100" : "opacity-0",
            )}
          />
          <div
            className={cx(
              "absolute bottom-[-30%] left-1/2 h-[75%] w-[75%] -translate-x-1/2 rounded-full bg-[#7c6cff]/35 blur-[90px] transition-opacity duration-700",
              voice === "agent" ? "opacity-100" : "opacity-40",
            )}
          />
        </div>

        {/* top bar */}
        <div aria-hidden className="relative flex items-center justify-between text-[12.5px] font-medium text-white/60">
          <span className="inline-flex items-center gap-2.5">
            <span className="relative grid size-2 place-items-center">
              <span className="absolute inset-0 rounded-full bg-emerald-400/60 motion-safe:animate-ripple" />
              <span className="relative size-2 rounded-full bg-emerald-400" />
            </span>
            <span className="text-white/85">Live call</span>
            <span className="hidden text-white/45 md:inline">lumen-dental.example</span>
          </span>
          <span className="inline-flex items-center gap-2">
            <span className="rounded-md border border-white/10 bg-white/[0.05] px-1.5 py-0.5 text-[11px] text-white/70">EN</span>
            <CallTimer started={running} running={live} resetKey={loop} />
          </span>
        </div>

        {/* captions */}
        <div
          aria-hidden
          className={cx(
            "relative mx-auto mt-6 flex max-w-[880px] flex-col items-center text-center transition-opacity duration-700 md:mt-8",
            s.outro ? "opacity-0" : "opacity-100",
          )}
        >
          <div key={`s-${s.turn}-${loop}`} className="motion-safe:animate-rise">
            <Speaker turn={turn} />
          </div>
          <div className="mt-3.5 min-h-[78px] w-full md:mt-4 md:min-h-[72px] lg:min-h-[90px]">
            <Caption key={`c-${s.turn}-${loop}`} turn={turn} count={count} />
          </div>
        </div>

        {/* waveform + orb */}
        <div className="relative mt-5 md:mt-7">
          <div
            aria-hidden
            className="lp-wave relative flex h-[128px] items-center md:h-[176px] lg:h-[208px]"
            data-voice={voice ?? undefined}
            data-paused={!live || undefined}
          >
            <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-gradient-to-r from-transparent via-white/10 to-transparent" />
            <Wave />
          </div>

          <div className="absolute inset-y-0 left-1/2 flex w-[128px] -translate-x-1/2 items-center justify-center md:w-[184px] lg:w-[224px]">
            <TalkToAgentButton
              demoKey={demoKey}
              className={cx(
                "group flex flex-col items-center gap-2 rounded-[28px] px-2 pb-2 pt-[22px] md:gap-2.5 md:pt-[26px]",
                lpFocus,
              )}
            >
              <span aria-hidden className="relative grid size-[68px] place-items-center md:size-[88px] lg:size-[104px]">
                <span className="absolute inset-0 rounded-full bg-[#7c6cff]/35 motion-safe:animate-ripple" />
                <span className="absolute inset-0 rounded-full bg-[#22d3ee]/20 motion-safe:animate-ripple [animation-delay:1.2s]" />
                <span
                  className={cx(
                    "lp-orb relative size-full shadow-[0_0_70px_-6px_rgb(124_108_255/0.9)] transition-transform duration-500 group-hover:scale-[1.06] group-active:scale-[0.97]",
                    voice ? "scale-[1.04]" : "scale-100",
                  )}
                />
              </span>
              <span className="whitespace-nowrap text-[12px] font-medium text-white/80 transition-colors group-hover:text-white md:text-[13.5px]">
                Tap to talk to Tara
              </span>
            </TalkToAgentButton>
          </div>

          {/* chips on desktop: corners of the waveform, away from captions and orb */}
          <div aria-hidden className="pointer-events-none absolute inset-0 hidden lg:block">
            <Chip id="lang" show={on("lang")} className="absolute left-0 top-0 xl:-left-16" />
            <Chip id="source" show={on("source")} className="absolute right-0 top-0 xl:-right-16" />
            <Chip id="typed" show={on("typed")} className="absolute bottom-0 left-0 xl:-left-10" />
            <Chip id="saved" show={on("saved")} className="absolute bottom-0 right-0 xl:-right-10" />
          </div>
        </div>

        {/* chips below the waveform: all four on tablets, the two that matter most on phones */}
        <div aria-hidden className="relative mx-auto mt-4 grid max-w-[540px] grid-cols-2 gap-2 md:mt-6 md:gap-3 lg:hidden">
          <Chip id="lang" show={on("lang")} className="min-w-0 max-md:hidden" />
          <Chip id="source" show={on("source")} className="min-w-0" />
          <Chip id="typed" show={on("typed")} className="min-w-0 max-md:hidden" />
          <Chip id="saved" show={on("saved")} className="min-w-0" />
        </div>
      </div>
    </div>
  );
}
