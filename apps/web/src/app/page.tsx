import { ArrowRight, AudioLines, Globe, Languages, Mic, Plus, Timer, Zap, type LucideIcon } from "lucide-react";
import type { Metadata, Viewport } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { DemoWidget, TalkToAgentButton } from "@/components/landing/demo";
import { HeroStage } from "@/components/landing/hero-stage";
import { LandingNav } from "@/components/landing/nav";
import { Bars, Eyebrow, lpButton, lpFocus, Orb, SectionHeading } from "@/components/landing/primitives";
import {
  ContactFormCard,
  CustomizeVisual,
  EmbedVisual,
  HandoffVisual,
  IdleTimerVisual,
  IsolationVisual,
  KnowledgeOrbit,
  KnowledgeVisual,
  LanguagesVisual,
  PageContextVisual,
  SourcesVisual,
  TalkfrontCard,
  TypeMidCallVisual,
} from "@/components/landing/visuals";
import { Logo } from "@/components/logo";
import { cx } from "@/components/ui";
import { TRIAL_SECONDS } from "@/db/schema";
import { appUrl } from "@/lib/env";

const TRIAL_MIN = TRIAL_SECONDS / 60;

export const metadata: Metadata = {
  title: { absolute: "Halochime: a voice AI agent for your website" },
  description:
    "Visitors ask out loud or type. Halochime answers from your own knowledge and takes a message when your team should follow up. Add it with one script tag.",
};

export const viewport: Viewport = { themeColor: "#07070c", colorScheme: "dark" };

const NAV = [
  { href: "#how-it-works", label: "How it works" },
  { href: "#features", label: "Features" },
  { href: "#faq", label: "FAQ" },
];

const FACTS: { icon: LucideIcon; value: string; label: string }[] = [
  { icon: Zap, value: "~1.5 s", label: "for a voice reply" },
  { icon: Languages, value: "12", label: "languages, by voice and chat" },
  { icon: AudioLines, value: "Voice + text", label: "in one widget" },
  { icon: Timer, value: `${TRIAL_MIN} min`, label: "free to start, no card" },
];

const FAQ: { q: string; a: string }[] = [
  {
    q: "Do I need to change my website?",
    a: "No. You paste one script tag before </body>. The widget loads in its own isolated space, so it doesn't touch your page's styles or code.",
  },
  {
    q: "What does the agent know?",
    a: "Only what you give it: pasted text, pages imported from your website (one page or the whole site from its sitemap) and uploaded PDF, .txt or .md files. You can share knowledge with every agent or keep a source for one agent.",
  },
  {
    q: "What happens when it can't answer?",
    a: "It says it doesn't know rather than making something up. If you turn on message taking, it offers to collect the visitor's details and creates a handoff for your team.",
  },
  {
    q: "Which languages does it speak?",
    a: "It answers in English, Spanish, French, German, Portuguese, Italian, Dutch, Hindi, Urdu, Arabic, Turkish and Japanese, or matches the visitor's language automatically. That works by voice and by text with the realtime voices (the default); the classic voices speak English only.",
  },
  {
    q: "How is voice billed?",
    a: `Voice uses prepaid minutes, rounded up per started minute. New workspaces start with ${TRIAL_MIN} free minutes and no card. Text chats are free during the beta.`,
  },
  {
    q: "Can I control where the widget appears?",
    a: "Yes. Each agent only answers on the domains you allow, and drafts only load inside your dashboard until you publish them.",
  },
  {
    q: "Can I see what visitors asked?",
    a: "Every voice call and chat is saved with its transcript, the page it started on and a short summary, so you can review it in the dashboard.",
  },
];

const navLink = cx(
  "rounded-full px-3.5 py-2 text-sm font-medium text-white/70 transition-colors hover:bg-white/[0.06] hover:text-white",
  lpFocus,
);

function Step({ n, title, body, children }: { n: number; title: string; body: string; children: ReactNode }) {
  return (
    <li className="lp-card group flex flex-col rounded-3xl p-3 transition-colors hover:border-white/15 md:grid md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] md:items-center md:gap-2 lg:flex">
      <div className="relative flex h-64 flex-col justify-center overflow-hidden rounded-[18px] border border-white/[0.07] bg-[#0f0f19] p-4 sm:p-5">
        <div aria-hidden className="pointer-events-none absolute -right-10 -top-16 size-40 rounded-full bg-[#7c6cff]/15 blur-3xl" />
        <div className="relative">{children}</div>
      </div>
      <div className="px-3 pb-4 pt-5 md:py-4 lg:pb-4 lg:pt-5">
        <p className="text-xs font-semibold tracking-wide text-[#b3a9ff]">Step {n}</p>
        <h3 className="mt-1.5 text-lg font-semibold tracking-tight text-white">{title}</h3>
        <p className="mt-2 text-sm leading-6 text-white/65">{body}</p>
      </div>
    </li>
  );
}

function Bento({
  title,
  body,
  children,
  wide,
  className,
}: {
  title: string;
  body: string;
  children: ReactNode;
  wide?: boolean;
  className?: string;
}) {
  return (
    <li
      className={cx(
        "lp-card relative flex flex-col overflow-hidden rounded-3xl p-6 transition-colors hover:border-white/15 sm:p-7",
        wide && "lg:col-span-2 lg:grid lg:grid-cols-[0.85fr_1.15fr] lg:items-center lg:gap-10",
        className,
      )}
    >
      <div aria-hidden className="pointer-events-none absolute -left-16 -top-20 size-48 rounded-full bg-[#7c6cff]/10 blur-3xl" />
      <div className={cx("relative order-1", wide && "lg:order-2")}>{children}</div>
      <div className={cx("relative order-2 mt-6", wide && "lg:order-1 lg:mt-0")}>
        <h3 className="text-lg font-semibold tracking-tight text-white">{title}</h3>
        <p className="mt-2 text-sm leading-6 text-white/65">{body}</p>
      </div>
    </li>
  );
}

export default function LandingPage() {
  const demoKey = process.env.NEXT_PUBLIC_DEMO_AGENT_KEY?.trim() || undefined;
  const widgetSrc = `${appUrl()}/widget.js`;
  const year = new Date().getFullYear();

  return (
    <div className="lp min-h-dvh overflow-x-clip">
      {demoKey ? <DemoWidget demoKey={demoKey} /> : null}

      <a
        href="#main"
        className="sr-only z-[60] rounded-full bg-white px-4 py-2 text-sm font-medium text-[#0b0b14] focus:not-sr-only focus:fixed focus:left-4 focus:top-3"
      >
        Skip to content
      </a>

      {/* Nav ------------------------------------------------------------- */}
      <LandingNav demoKey={demoKey} />

      <main id="main">
        {/* Hero ------------------------------------------------------------ */}
        <section aria-labelledby="hero-title" className="relative pb-16 sm:pb-20 lg:pb-24">
          <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
            <div className="lp-hero-glow absolute inset-0" />
            <div className="lp-grid absolute inset-x-0 top-0 h-[760px]" />
          </div>

          <div className="relative mx-auto max-w-6xl px-4 pt-12 text-center sm:px-6 sm:pt-16 lg:pt-[72px]">
            <p className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] py-1 pl-1 pr-3.5 text-[13px] font-medium text-white/75 backdrop-blur-sm motion-safe:animate-fade-up">
              <Orb className="size-5" />
              Voice-first AI support for any website
            </p>
            <h1
              id="hero-title"
              className="mx-auto mt-6 max-w-[15ch] text-[46px] font-semibold leading-[0.98] tracking-[-0.05em] text-white motion-safe:animate-fade-up [animation-delay:60ms] sm:mt-7 sm:text-[72px] lg:text-[92px] lg:leading-[0.94]"
            >
              <span className="lp-heading">Your website</span>
              <br />
              <span className="lp-heading">can </span>
              <span className="lp-accent pr-[0.06em] font-display text-[1.12em] font-normal italic tracking-[-0.03em]">talk</span>
              <span className="lp-heading"> now.</span>
            </h1>
            <p className="mx-auto mt-6 max-w-[36rem] text-balance text-[17px] leading-[1.65] text-white/70 motion-safe:animate-fade-up [animation-delay:120ms] sm:mt-7 sm:text-lg sm:leading-8">
              Halochime answers your visitors out loud or in text, from your own knowledge, and takes a message when your team
              should follow up.
            </p>
            <div className="mx-auto mt-9 flex max-w-xs flex-col items-stretch justify-center gap-3 motion-safe:animate-fade-up [animation-delay:180ms] sm:max-w-none sm:flex-row sm:items-center">
              <TalkToAgentButton demoKey={demoKey} className={cx(lpButton("primary"), "pl-2")}>
                <span className="relative grid size-8 place-items-center">
                  <span className="absolute inset-0 rounded-full bg-white/25 motion-safe:animate-ripple" aria-hidden />
                  <Orb className="relative size-8 ring-1 ring-white/30" />
                </span>
                Talk to Tara
              </TalkToAgentButton>
              <Link href="/sign-up" className={lpButton("glass")}>
                Start free
                <ArrowRight className="transition-transform group-hover:translate-x-0.5" aria-hidden />
              </Link>
            </div>
            <p className="mt-5 flex flex-wrap items-center justify-center gap-x-2.5 gap-y-1 text-sm text-white/55 motion-safe:animate-fade-up [animation-delay:200ms]">
              <span>{TRIAL_MIN} free minutes</span>
              <span aria-hidden className="size-1 rounded-full bg-white/25" />
              <span>No card</span>
              <span aria-hidden className="size-1 rounded-full bg-white/25" />
              <span>One script tag</span>
            </p>
          </div>

          <div className="relative mt-14 px-4 sm:mt-16 sm:px-6 lg:mt-[72px]">
            <HeroStage demoKey={demoKey} />
          </div>
        </section>

        {/* Facts ----------------------------------------------------------- */}
        <section aria-label="Product facts" className="relative px-4 sm:px-6">
          <ul className="lp-card mx-auto grid max-w-6xl grid-cols-2 overflow-hidden rounded-2xl lg:grid-cols-4">
            {FACTS.map((f, i) => (
              <li
                key={f.label}
                className={cx(
                  "flex items-center gap-3.5 px-4 py-5 sm:px-6 sm:py-6",
                  i % 2 === 1 && "border-l border-white/[0.07]",
                  i >= 2 && "border-t border-white/[0.07] lg:border-t-0",
                  i === 2 && "lg:border-l",
                )}
              >
                <span className="hidden size-10 shrink-0 place-items-center rounded-xl border border-white/10 bg-white/[0.04] text-[#b3a9ff] sm:grid" aria-hidden>
                  <f.icon className="size-4.5" />
                </span>
                <span className="min-w-0">
                  <span className="block text-lg font-semibold tracking-tight text-white sm:text-xl">{f.value}</span>
                  <span className="block text-[13px] leading-5 text-white/60">{f.label}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>

        {/* Contact form vs Halochime ------------------------------------- */}
        <section aria-labelledby="compare-title" className="relative py-24 sm:py-32">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <SectionHeading
              id="compare-title"
              eyebrow="Why it matters"
              title="A contact form makes people wait. Halochime answers."
              body="Most questions on a website have an answer you already wrote down. Halochime gives it right away, in the visitor's own words, and saves the rest for your team."
            />
            <div className="mt-14 grid gap-5 md:grid-cols-2">
              <ContactFormCard />
              <TalkfrontCard />
            </div>
          </div>
        </section>

        {/* How it works ---------------------------------------------------- */}
        <section id="how-it-works" aria-labelledby="how-title" className="relative scroll-mt-20 py-24 sm:py-32">
          <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <SectionHeading
              id="how-title"
              eyebrow="How it works"
              title="Live on your site in three steps"
              body="No code beyond a single tag. Most of the work is telling the agent what your business already knows."
            />
            <ol className="mt-14 grid gap-5 lg:grid-cols-3">
              <Step
                n={1}
                title="Add your knowledge"
                body="Paste your FAQ, import your website or upload a PDF. Share it with every agent or keep it for one."
              >
                <SourcesVisual />
              </Step>
              <Step
                n={2}
                title="Make it yours"
                body="Set the name, greeting, persona and business rules. Pick a voice, a language, your colour and the button label."
              >
                <CustomizeVisual />
              </Step>
              <Step
                n={3}
                title="Paste one script tag"
                body="Add the snippet before </body> and list the domains it may load on. Publish, and visitors can start talking."
              >
                <EmbedVisual src={widgetSrc} />
              </Step>
            </ol>
          </div>
        </section>

        {/* Features -------------------------------------------------------- */}
        <section id="features" aria-labelledby="features-title" className="relative scroll-mt-20 pb-16 pt-24 sm:pb-20 sm:pt-32">
          <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <SectionHeading
              id="features-title"
              eyebrow="Features"
              title="A front desk on every page"
              body="One agent that listens, answers from what you taught it and knows when to hand over."
            />
            <ul className="mt-14 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
              <Bento
                wide
                title="Answers from your knowledge"
                body="Replies come from the content you added, and you can see which source it used. When the answer isn't there, it says so instead of guessing."
              >
                <KnowledgeVisual />
              </Bento>
              <Bento
                title="Takes messages for your team"
                body="When a question needs a person, it collects contact details and leaves a handoff, linked to the full transcript."
              >
                <HandoffVisual />
              </Bento>
              <Bento
                title="Knows the page they are on"
                body="Each conversation carries the page title and address, so the agent has context and you see where questions start."
              >
                <PageContextVisual />
              </Bento>
              <Bento
                title="Talks in 12 languages"
                body="It answers in the visitor's language, by voice and by text, including Urdu, Hindi and Arabic."
              >
                <LanguagesVisual />
              </Bento>
              <Bento
                title="Visitors can type mid-call"
                body="Spelling an email or an order number out loud is a pain. During a call, visitors can just type it."
              >
                <TypeMidCallVisual />
              </Bento>
              <Bento
                title="Idle calls end on their own"
                body="After a quiet spell the agent checks in. If nobody answers, it ends the call, so an open tab doesn't use your minutes."
              >
                <IdleTimerVisual />
              </Bento>
              <Bento
                wide
                className="md:col-span-2 lg:col-span-2"
                title="Works on any website"
                body="One script tag on any site, store or user portal. The widget runs in its own isolated space, so your styles and its styles never clash, and it only loads on the domains you allow."
              >
                <IsolationVisual />
              </Bento>
            </ul>
          </div>
        </section>

        {/* Knowledge orbit ------------------------------------------------- */}
        <section aria-labelledby="knowledge-title" className="relative py-12 sm:py-16">
          <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 sm:px-6 lg:grid-cols-[0.9fr_1.1fr] lg:gap-16">
            <div>
              <SectionHeading
                align="left"
                id="knowledge-title"
                eyebrow="Knowledge"
                title="Everything it says comes from you"
                body="Give the agent your FAQ, pages from your website and text files today. Your CRM, your database and phone calls are next."
              />
              <ul className="mt-8 space-y-3 text-[15px] text-white/75">
                <li className="flex items-center gap-3">
                  <span className="grid size-6 place-items-center rounded-full bg-[#22d3ee]/15 text-[#8eeefc]" aria-hidden>
                    <Globe className="size-3.5" />
                  </span>
                  Available now: FAQ, whole websites, PDF, .txt and .md files
                </li>
                <li className="flex items-center gap-3">
                  <span className="grid size-6 place-items-center rounded-full border border-dashed border-white/25 text-white/55" aria-hidden>
                    <Plus className="size-3.5" />
                  </span>
                  Soon: CRM, database and phone
                </li>
              </ul>
            </div>
            <KnowledgeOrbit />
          </div>
        </section>

        {/* Talk to Tara ---------------------------------------------------- */}
        <section id="talk" aria-labelledby="talk-title" className="relative scroll-mt-20 py-20 sm:py-28">
          <div aria-hidden className="pointer-events-none absolute inset-0">
            <div className="absolute left-1/2 top-[38%] h-[420px] w-[min(820px,100%)] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#5b45e3]/25 blur-[140px]" />
            <div className="absolute left-[60%] top-1/4 h-72 w-72 rounded-full bg-[#22d3ee]/12 blur-[110px]" />
          </div>
          <div className="relative mx-auto max-w-3xl px-4 text-center sm:px-6">
            <div aria-hidden className="relative mx-auto grid size-56 place-items-center sm:size-72">
              <span className="absolute -inset-10 rounded-full border border-white/[0.06] sm:-inset-14" />
              <span className="absolute -inset-20 rounded-full border border-white/[0.04] sm:-inset-28" />
              <span className="absolute inset-4 rounded-full bg-[#7c6cff]/30 motion-safe:animate-ripple" />
              <span className="absolute inset-4 rounded-full bg-[#22d3ee]/20 motion-safe:animate-ripple [animation-delay:1.2s]" />
              <span className="lp-orb relative grid size-40 place-items-center shadow-[0_0_120px_-10px_rgb(124_108_255/0.85)] motion-safe:animate-breathe sm:size-52">
                <Bars className="h-12 sm:h-14" bars={[0.35, 0.6, 0.9, 0.55, 1, 0.75, 0.5, 0.85, 0.4]} barClassName="w-[4px] bg-white" />
              </span>
            </div>
            <Eyebrow className="mt-14">Live demo</Eyebrow>
            <h2 id="talk-title" className="lp-heading mt-4 text-[40px] font-semibold leading-[1.02] tracking-[-0.04em] sm:text-6xl">
              Talk to Tara now
            </h2>
            <p className="mx-auto mt-5 max-w-xl text-pretty text-base leading-7 text-white/70 sm:text-lg sm:leading-8">
              Tara is the agent on this page, built with Halochime and running on the same widget you would add to your site.
              Ask her anything about Halochime.
            </p>
            <div className="mt-9 flex justify-center">
              {demoKey ? (
                <TalkToAgentButton demoKey={demoKey} className={cx(lpButton("white"), "h-14 px-7 text-base")}>
                  <Mic aria-hidden />
                  Start talking
                </TalkToAgentButton>
              ) : (
                <Link href="/sign-up" className={cx(lpButton("white"), "h-14 px-7 text-base")}>
                  Build your own agent
                  <ArrowRight aria-hidden />
                </Link>
              )}
            </div>
            <p className="mx-auto mt-5 flex max-w-md items-start justify-center gap-2 text-sm leading-6 text-white/55">
              <Mic className="mt-1 size-3.5 shrink-0" aria-hidden />
              {demoKey
                ? "Your browser will ask to use your microphone. Prefer typing? Switch to Type in the widget."
                : "The live demo isn't switched on here. Create a free agent and try it in your dashboard."}
            </p>
          </div>
        </section>

        {/* FAQ ------------------------------------------------------------- */}
        <section id="faq" aria-labelledby="faq-title" className="relative scroll-mt-20 py-24 sm:py-32">
          <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />
          <div className="mx-auto grid max-w-6xl gap-12 px-4 sm:px-6 lg:grid-cols-[0.8fr_1.2fr] lg:gap-16">
            <div className="lg:sticky lg:top-28 lg:self-start">
              <SectionHeading
                align="left"
                id="faq-title"
                eyebrow="FAQ"
                title="Questions, answered"
                body="Still unsure about something? Ask Tara out loud, or create an agent and try it on your own content."
              />
            </div>
            <div className="lp-card divide-y divide-white/[0.07] rounded-3xl">
              {FAQ.map((f) => (
                <details key={f.q} className="group">
                  <summary
                    className={cx(
                      "flex cursor-pointer items-center justify-between gap-4 rounded-3xl px-5 py-5 text-left text-[15px] font-medium text-white/90 transition-colors hover:text-white sm:px-7 sm:text-base",
                      "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#b3a9ff]",
                    )}
                  >
                    {f.q}
                    <span
                      className="grid size-7 shrink-0 place-items-center rounded-full border border-white/10 bg-white/[0.04] text-white/70 transition-[transform,background-color,color] duration-200 group-open:rotate-45 group-open:bg-[#7c6cff]/20 group-open:text-white group-hover:border-white/20"
                      aria-hidden
                    >
                      <Plus className="size-3.5" />
                    </span>
                  </summary>
                  <p className="-mt-1 px-5 pb-6 text-[15px] leading-7 text-white/65 sm:px-7 sm:pr-20">{f.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* Final CTA ------------------------------------------------------- */}
        <section aria-labelledby="cta-title" className="px-4 pb-20 sm:px-6 sm:pb-28">
          <div className="relative mx-auto max-w-6xl overflow-hidden rounded-[32px] border border-white/10 bg-[#0c0c17] px-6 py-16 text-center sm:rounded-[40px] sm:py-24">
            <div aria-hidden className="pointer-events-none absolute inset-0">
              <div className="lp-grid absolute inset-0 opacity-70" />
              <div className="absolute -bottom-40 left-1/2 h-[420px] w-[900px] -translate-x-1/2 rounded-full bg-[#5b45e3]/40 blur-[120px]" />
              <div className="absolute -bottom-24 left-[70%] h-64 w-80 rounded-full bg-[#22d3ee]/20 blur-[100px]" />
            </div>
            <Orb className="relative mx-auto size-12 motion-safe:animate-breathe" />
            <h2 id="cta-title" className="lp-heading relative mt-6 text-balance text-[38px] font-semibold leading-[1.02] tracking-[-0.04em] sm:text-6xl">
              Give your website a voice
            </h2>
            <p className="relative mx-auto mt-5 max-w-lg text-pretty text-base leading-7 text-white/70 sm:text-lg">
              Create an agent, add what you know, and test it in your dashboard in a few minutes.
            </p>
            <div className="relative mt-9 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center">
              <Link href="/sign-up" className={lpButton("white")}>
                Start free
                <ArrowRight aria-hidden />
              </Link>
              <Link href="/sign-in" className={lpButton("glass")}>
                Sign in
              </Link>
            </div>
            <p className="relative mt-5 text-sm text-white/55">{TRIAL_MIN} free minutes · No card needed</p>
          </div>
        </section>
      </main>

      <footer className="border-t border-white/[0.06]">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-6 px-4 py-10 sm:flex-row sm:px-6">
          <div className="flex flex-col items-center gap-2 sm:items-start">
            <Logo tone="dark" />
            <p className="text-sm text-white/55">Voice-first support for any website.</p>
          </div>
          <nav aria-label="Footer" className="flex flex-wrap justify-center gap-0.5">
            {NAV.map((l) => (
              <a key={l.href} href={l.href} className={cx(navLink, "text-white/60")}>
                {l.label}
              </a>
            ))}
            <Link href="/docs" className={cx(navLink, "text-white/60")}>
              Docs
            </Link>
            <Link href="/sign-in" className={cx(navLink, "text-white/60")}>
              Sign in
            </Link>
            <Link href="/sign-up" className={cx(navLink, "text-white/60")}>
              Start free
            </Link>
          </nav>
        </div>
        <p className="pb-8 text-center text-xs text-white/50">© {year} Halochime</p>
      </footer>
    </div>
  );
}
