import { AudioLines, BookOpenCheck, Inbox } from "lucide-react";
import type { ReactNode } from "react";
import { Logo } from "./logo";

const POINTS = [
  { icon: AudioLines, text: "Visitors talk or type in one widget" },
  { icon: BookOpenCheck, text: "Answers come from your own knowledge" },
  { icon: Inbox, text: "Messages for your team when a person should follow up" },
];

/** Split layout used by sign-in, sign-up and onboarding: form on the left, brand panel on the right. */
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <div className="relative flex flex-col px-4 py-6 sm:px-8">
        <div className="aurora-wash pointer-events-none absolute inset-0 lg:hidden" aria-hidden />
        <div className="relative">
          <Logo />
        </div>
        <div className="relative flex flex-1 items-center justify-center py-10">
          <div className="w-full max-w-sm">{children}</div>
        </div>
        <p className="relative text-center text-xs text-slate-400 lg:text-left">© {new Date().getFullYear()} Halochime</p>
      </div>

      <aside className="relative hidden p-3 lg:block" aria-hidden>
        <div className="relative flex h-full bg-[#07070c] text-white flex-col justify-between overflow-hidden rounded-[28px] border border-white/[0.06] p-12">
          <div className="lp-grid pointer-events-none absolute inset-0" />
          <div className="pointer-events-none absolute -left-24 -top-32 size-[460px] rounded-full bg-[#5b45e3]/30 blur-[110px]" />
          <div className="pointer-events-none absolute -bottom-32 -right-20 size-[380px] rounded-full bg-[#22d3ee]/15 blur-[110px]" />

          <div className="relative grid size-28 place-items-center self-end">
            <span className="absolute inset-2 rounded-full bg-[#7c6cff]/35 motion-safe:animate-ripple" />
            <span className="absolute inset-2 rounded-full bg-[#22d3ee]/25 motion-safe:animate-ripple [animation-delay:1.2s]" />
            <span className="lp-orb relative size-24 shadow-[0_0_80px_-10px_rgb(124_108_255/0.85)]" />
          </div>

          <div className="relative max-w-md">
            <div className="mb-10 space-y-2.5 text-[13px] leading-5">
              <p className="ml-auto w-fit max-w-[80%] rounded-2xl rounded-br-md bg-[#5b45e3] px-3.5 py-2 text-white">
                Are you open this Saturday morning?
              </p>
              <p className="w-fit max-w-[88%] rounded-2xl rounded-bl-md border border-white/10 bg-white/[0.07] px-3.5 py-2 text-white/85">
                Yes, from 9am to 1pm. Shall I ask the team to book you in?
              </p>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-[#7c6cff]/35 bg-[#7c6cff]/12 px-2.5 py-0.5 text-[11px] font-medium text-[#cdc7ff]">
                <BookOpenCheck className="size-3" />
                Answered from: Opening hours
              </span>
            </div>
            <p className="text-5xl font-semibold leading-[1.02] tracking-[-0.04em] text-white xl:text-[56px]">
              <span className="lp-heading">Your website can </span>
              <span className="lp-accent pr-1">talk</span>
              <span className="lp-heading"> now.</span>
            </p>
            <ul className="mt-8 space-y-3">
              {POINTS.map((p) => (
                <li key={p.text} className="flex items-center gap-3 text-[15px] text-white/75">
                  <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-white/10 bg-white/[0.05] text-[#b3a9ff]">
                    <p.icon className="size-4" />
                  </span>
                  {p.text}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </aside>
    </div>
  );
}
