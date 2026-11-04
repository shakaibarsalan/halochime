import { BookOpen, ReceiptText, ShieldCheck, type LucideIcon } from "lucide-react";
import type { Metadata, Viewport } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { focusLight, PageHero, SiteFooter, SiteHeader } from "@/components/site/chrome";
import { cx } from "@/components/ui";
import { ContactForm } from "./contact-form";
import { isTopic } from "./topics";

export const metadata: Metadata = {
  title: "Contact",
  description: "Questions about Halochime, buying voice minutes, refunds, or deleting your data. Send us a message.",
  alternates: { canonical: "/contact" },
};

export const viewport: Viewport = { themeColor: "#07070c" };

const linkClass = cx(
  "rounded-sm font-medium text-brand-700 underline decoration-brand-300 underline-offset-[3px] hover:decoration-brand-600",
  focusLight,
);

function Tip({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children: ReactNode }) {
  return (
    <li className="flex gap-3.5">
      <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-600 ring-1 ring-brand-100" aria-hidden>
        <Icon className="size-4" />
      </span>
      <div className="min-w-0">
        <p className="text-[15px] font-semibold text-slate-900">{title}</p>
        <p className="mt-1 text-sm leading-6 text-slate-600">{children}</p>
      </div>
    </li>
  );
}

export default async function ContactPage({ searchParams }: { searchParams: Promise<{ topic?: string | string[] }> }) {
  const requested = (await searchParams).topic;
  const topic = isTopic(requested) ? requested : "support";

  return (
    <div className="min-h-dvh bg-canvas text-slate-800">
      <a
        href="#content"
        className="sr-only z-[60] rounded-full bg-white px-4 py-2 text-sm font-medium text-slate-900 shadow focus:not-sr-only focus:fixed focus:left-4 focus:top-3"
      >
        Skip to content
      </a>
      <SiteHeader label="Contact" />
      <PageHero eyebrow="Contact" title="Talk to a" accent="person.">
        <p>Questions about Halochime, buying voice minutes, a refund or your data. We read every message and reply by email.</p>
      </PageHero>

      <main id="content" className="mx-auto max-w-7xl px-4 py-10 sm:px-6 sm:py-14">
        <div className="grid grid-cols-[minmax(0,1fr)] gap-10 lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-16">
          <section aria-labelledby="form-title" className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-soft sm:p-7">
            <h2 id="form-title" className="mb-6 text-lg font-semibold tracking-tight text-slate-900">
              Send us a message
            </h2>
            <ContactForm defaultTopic={topic} />
          </section>

          <aside aria-label="Before you write">
            <ul className="space-y-7 lg:pt-2">
              <Tip icon={ReceiptText} title="Buying voice minutes">
                Choose Billing and tell us the workspace and how many minutes you want. We send a payment link, then add the
                minutes. Refunds follow the{" "}
                <Link href="/refund-policy" className={linkClass}>
                  Refund Policy
                </Link>
                .
              </Tip>
              <Tip icon={ShieldCheck} title="Deleting your data">
                Owners can delete conversations and whole workspaces in the dashboard. For your account, or to have us do it,
                choose Privacy or data deletion and write from the email on your account. We delete within 30 days. See the{" "}
                <Link href="/privacy#deletion" className={linkClass}>
                  Privacy Policy
                </Link>
                .
              </Tip>
              <Tip icon={BookOpen} title="Setting up the widget">
                The{" "}
                <Link href="/docs" className={linkClass}>
                  developer docs
                </Link>{" "}
                cover the script tag, identity tokens, actions and webhooks.
              </Tip>
            </ul>
          </aside>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
