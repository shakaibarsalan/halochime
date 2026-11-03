import { ArrowRight, ArrowUpRight, Info, TriangleAlert } from "lucide-react";
import type { Metadata, Viewport } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { lpFocus } from "@/components/landing/primitives";
import { Logo } from "@/components/logo";
import { cx } from "@/components/ui";
import { appUrl } from "@/lib/env";
import { LEGAL_LINKS, OG_IMAGE } from "@/lib/site";
import { Code, MobileToc, Toc, type TocItem } from "./docs-client";
import { cspSources, embedSnippet, platformGuides } from "./_content/platforms";

export const metadata: Metadata = {
  title: "Developer docs",
  description:
    "Install the Halochime widget on any website, control it with JavaScript, sign in your users with identity tokens, let the agent call your API with actions, and receive signed webhooks.",
  alternates: { canonical: "/docs" },
  openGraph: {
    title: "Halochime developer docs",
    description: "One script tag, a small JavaScript API, identity tokens, actions and signed webhooks.",
    type: "article",
    siteName: "Halochime",
    url: "/docs",
    images: [OG_IMAGE],
  },
  twitter: {
    card: "summary_large_image",
    title: "Halochime developer docs",
    description: "One script tag, a small JavaScript API, identity tokens, actions and signed webhooks.",
  },
};

export const viewport: Viewport = { themeColor: "#07070c" };

const KEY = "pk_your_public_key";

const TOC: TocItem[] = [
  { id: "getting-started", label: "Getting started" },
  { id: "how-it-works", label: "How it works on your site" },
  { id: "platforms", label: "Platform guides" },
  { id: "javascript-api", label: "JavaScript API" },
  {
    id: "identity",
    label: "Identity tokens",
    children: [
      { id: "identity-claims", label: "Claims" },
      { id: "identity-signing", label: "Sign on your server" },
      { id: "identity-widget", label: "Pass it to the widget" },
    ],
  },
  {
    id: "actions",
    label: "Actions",
    children: [
      { id: "actions-define", label: "Define an action" },
      { id: "actions-request", label: "The request we send" },
      { id: "actions-response", label: "Your response" },
    ],
  },
  {
    id: "webhooks",
    label: "Webhooks",
    children: [
      { id: "webhooks-events", label: "Events" },
      { id: "webhooks-request", label: "The request" },
      { id: "webhooks-payloads", label: "Payloads" },
      { id: "webhooks-verify", label: "Verify the signature" },
      { id: "webhooks-delivery", label: "Retries and delivery log" },
    ],
  },
  { id: "security", label: "Security and CSP" },
  { id: "limits", label: "Limits" },
];

// ---------------------------------------------------------------------------
// Reading components

function H2({ id, eyebrow, children }: { id: string; eyebrow: string; children: ReactNode }) {
  return (
    <div className="mb-5">
      <p className="font-mono text-[11.5px] font-medium uppercase tracking-[0.14em] text-brand-600">{eyebrow}</p>
      <h2 id={id} className="group mt-2 scroll-mt-24 text-[28px] font-semibold leading-tight tracking-[-0.03em] text-slate-950 sm:text-[32px]">
        <a href={`#${id}`} className={cx("rounded-md", lpFocusLight)}>
          {children}
          <span aria-hidden className="ml-2 text-slate-300 opacity-0 transition-opacity group-hover:opacity-100">
            #
          </span>
        </a>
      </h2>
    </div>
  );
}

function H3({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <h3 id={id} className="group mb-3 mt-10 scroll-mt-24 text-lg font-semibold tracking-[-0.015em] text-slate-900">
      {id ? (
        <a href={`#${id}`} className={cx("rounded-md", lpFocusLight)}>
          {children}
          <span aria-hidden className="ml-1.5 text-slate-300 opacity-0 transition-opacity group-hover:opacity-100">
            #
          </span>
        </a>
      ) : (
        children
      )}
    </h3>
  );
}

const lpFocusLight = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600";

function P({ children }: { children: ReactNode }) {
  return <p className="my-4 text-[15.5px] leading-[1.75] text-slate-700">{children}</p>;
}

function C({ children }: { children: ReactNode }) {
  return (
    <code className="rounded-md border border-slate-200/80 bg-white px-1.5 py-0.5 font-mono text-[0.84em] text-slate-800 [overflow-wrap:anywhere]">
      {children}
    </code>
  );
}

function A({ href, children }: { href: string; children: ReactNode }) {
  const external = /^https?:/.test(href);
  return (
    <Link
      href={href}
      target={external ? "_blank" : undefined}
      rel={external ? "noreferrer" : undefined}
      className={cx("font-medium text-brand-700 underline decoration-brand-300 underline-offset-[3px] hover:decoration-brand-600", lpFocusLight, "rounded-sm")}
    >
      {children}
    </Link>
  );
}

function List({ children, ordered }: { children: ReactNode; ordered?: boolean }) {
  const Tag = ordered ? "ol" : "ul";
  return (
    <Tag
      className={cx(
        "my-4 space-y-2 pl-5 text-[15.5px] leading-[1.7] text-slate-700 marker:text-slate-400",
        ordered ? "list-decimal marker:font-medium marker:text-brand-600" : "list-disc",
      )}
    >
      {children}
    </Tag>
  );
}

function Callout({ tone = "info", children }: { tone?: "info" | "warn"; children: ReactNode }) {
  const Icon = tone === "warn" ? TriangleAlert : Info;
  return (
    <div
      className={cx(
        "my-5 flex gap-3 rounded-xl border px-4 py-3.5 text-[14.5px] leading-[1.65]",
        tone === "warn" ? "border-amber-200 bg-amber-50/70 text-amber-900" : "border-brand-100 bg-brand-50/60 text-slate-700",
      )}
    >
      <Icon className={cx("mt-1 size-4 shrink-0", tone === "warn" ? "text-amber-600" : "text-brand-600")} aria-hidden />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function DataTable({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <div className="my-5 overflow-x-auto rounded-xl border border-slate-200 bg-white [scrollbar-width:thin]">
      <table className={cx("w-full text-left text-[14px]", head.length > 2 && "min-w-[520px]")}>
        <thead>
          <tr>
            {head.map((h) => (
              <th key={h} className="border-b border-slate-200 bg-slate-50/80 px-4 py-2.5 text-[11.5px] font-semibold uppercase tracking-wider text-slate-500">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="align-top">
              {r.map((cell, j) => (
                <td key={j} className="border-b border-slate-100 px-4 py-3 leading-6 text-slate-700 [tr:last-child_&]:border-b-0">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Section({ children, first }: { children: ReactNode; first?: boolean }) {
  return <section className={cx(!first && "mt-16 border-t border-slate-200/80 pt-14 sm:mt-20 sm:pt-16")}>{children}</section>;
}

// ---------------------------------------------------------------------------
// Example payloads (keep in step with lib/webhooks/payloads.ts)

const json = (v: unknown) => JSON.stringify(v, null, 2);

function examples(base: string) {
  const conv = "c0a8f2d4-6b1e-4f7a-9c3d-2e5b8a1f4d70";
  const ended = {
    id: "evt_Qm2Xr8LbT1vN0aYk3dWfE5sJ",
    type: "conversation.ended",
    created: 1793001600,
    workspace_id: "Wk3n9QpX2rT7vB1mY8sL4dF6hJ0cA5eG",
    data: {
      conversation: {
        id: conv,
        mode: "voice",
        channel: "web",
        started_at: "2026-10-26T09:58:26.000Z",
        ended_at: "2026-10-26T10:00:00.000Z",
        duration_sec: 94,
        ended_reason: "visitor_left",
        summary: "The visitor asked whether their order can still be changed. The agent explained the 2 hour window and offered a callback.",
        handoff_requested: true,
        page_url: "https://example.com/orders",
        page_title: "Your orders",
        dashboard_url: `${base}/app/conversations/${conv}`,
      },
      agent: { id: "5d1c7e9a-0b3f-4e2d-8a6c-1f9e3b7d5a20", name: "Support agent" },
      visitor: {
        id: "user_1042",
        name: "Alex Rivera",
        email: "alex@example.com",
        verified: true,
        attributes: { plan: "pro", open_orders: 1 },
      },
      collected: {
        visitor_name: "Alex Rivera",
        email: null,
        phone: "+1 555 0100",
        topic: "changing an order",
        outcome: "message_taken",
        follow_up_needed: true,
        sentiment: "neutral",
        custom: {
          order_number: { label: "Order number", type: "text", value: "4471" },
          new_size: { label: "New size", type: "choice", value: "M" },
        },
      },
      transcript: [
        { role: "assistant", content: "Hi, how can I help today?", created_at: "2026-10-26T09:58:26.000Z" },
        { role: "user", content: "Can I still change my order?", created_at: "2026-10-26T09:58:35.000Z" },
        { role: "assistant", content: "Orders can be changed within 2 hours. Shall I ask the team to call you?", created_at: "2026-10-26T09:58:40.000Z" },
        { role: "user", content: "Yes please.", created_at: "2026-10-26T09:58:57.000Z" },
      ],
    },
  };
  const handoff = {
    id: "evt_7pKd0RwZ3mHq9TbV2xNcL4fG",
    type: "handoff.created",
    created: 1793001562,
    workspace_id: "Wk3n9QpX2rT7vB1mY8sL4dF6hJ0cA5eG",
    data: {
      handoff: {
        id: "b7e3c1a9-5f2d-4c8e-9a1b-6d4f2e8c0a37",
        status: "open",
        message: "Please call about changing order 4471.",
        created_at: "2026-10-26T09:59:22.000Z",
        dashboard_url: `${base}/app/handoffs`,
      },
      visitor: {
        id: "user_1042",
        name: "Alex Rivera",
        email: "alex@example.com",
        phone: "+1 555 0100",
        verified: true,
        attributes: { plan: "pro", open_orders: 1 },
      },
      conversation: { id: conv, page_url: "https://example.com/orders", dashboard_url: `${base}/app/conversations/${conv}` },
      agent: { id: "5d1c7e9a-0b3f-4e2d-8a6c-1f9e3b7d5a20", name: "Support agent" },
    },
  };
  return { ended: json(ended), handoff: json(handoff) };
}

const NODE_VERIFY = `import crypto from "node:crypto";
import express from "express";

const app = express();
const secret = process.env.HALOCHIME_WEBHOOK_SECRET; // whsec_...

function verifyHalochime(rawBody, header, secret, toleranceSec = 300) {
  const parts = Object.fromEntries((header ?? "").split(",").map((p) => p.trim().split("=")));
  const t = Number(parts.t);
  if (!Number.isInteger(t) || Math.abs(Date.now() / 1000 - t) > toleranceSec) return false;
  const expected = crypto.createHmac("sha256", secret).update(\`\${t}.\${rawBody}\`).digest();
  const given = Buffer.from(parts.v1 ?? "", "hex");
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

// Read the raw body: parsed and re-serialized JSON would not match the signature.
app.post("/halochime", express.raw({ type: "application/json" }), (req, res) => {
  const raw = req.body.toString("utf8");
  if (!verifyHalochime(raw, req.get("Halochime-Signature"), secret)) {
    return res.sendStatus(400);
  }
  const event = JSON.parse(raw);
  res.sendStatus(200); // answer first, then do the work
  // event.id is the same on every retry: skip ids you have already handled.
  console.log(event.type, event.data);
});

app.listen(3000);`;

const PY_VERIFY = `import hashlib
import hmac
import json
import os
import time

from flask import Flask, abort, request

app = Flask(__name__)
SECRET = os.environ["HALOCHIME_WEBHOOK_SECRET"]  # whsec_...


def verify_halochime(raw_body: bytes, header: str, secret: str, tolerance: int = 300) -> bool:
    try:
        parts = dict(p.strip().split("=", 1) for p in header.split(","))
        t = int(parts["t"])
    except (KeyError, ValueError):
        return False
    if abs(time.time() - t) > tolerance:
        return False
    signed = f"{t}.".encode() + raw_body
    expected = hmac.new(secret.encode(), signed, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, parts.get("v1", ""))


@app.post("/halochime")
def halochime():
    raw = request.get_data()  # the raw bytes, not request.json
    if not verify_halochime(raw, request.headers.get("Halochime-Signature", ""), SECRET):
        abort(400)
    event = json.loads(raw)
    # event["id"] is the same on every retry: skip ids you have already handled.
    print(event["type"])
    return "", 200`;

const NODE_SIGN = `// On your server. npm install jsonwebtoken
import jwt from "jsonwebtoken";

export function halochimeToken(user) {
  return jwt.sign(
    {
      sub: String(user.id),
      name: user.name,
      email: user.email,
      attributes: { plan: user.plan, open_orders: user.openOrders },
    },
    process.env.HALOCHIME_IDENTITY_SECRET,
    { algorithm: "HS256", expiresIn: "1h" }, // adds iat and exp
  );
}`;

const PY_SIGN = `# On your server. pip install PyJWT
import os
import time

import jwt


def halochime_token(user) -> str:
    now = int(time.time())
    return jwt.encode(
        {
            "sub": str(user.id),
            "name": user.name,
            "email": user.email,
            "attributes": {"plan": user.plan, "open_orders": user.open_orders},
            "iat": now,
            "exp": now + 3600,
        },
        os.environ["HALOCHIME_IDENTITY_SECRET"],
        algorithm="HS256",
    )`;

const PHP_SIGN = `<?php
// On your server. composer require firebase/php-jwt
use Firebase\\JWT\\JWT;

function halochime_token($user): string
{
    $now = time();
    return JWT::encode([
        'sub' => (string) $user->id,
        'name' => $user->name,
        'email' => $user->email,
        'attributes' => ['plan' => $user->plan, 'open_orders' => $user->open_orders],
        'iat' => $now,
        'exp' => $now + 3600,
    ], getenv('HALOCHIME_IDENTITY_SECRET'), 'HS256');
}`;

// ---------------------------------------------------------------------------

export default function DocsPage() {
  const base = appUrl();
  const snippet = embedSnippet(base, KEY);
  const csp = cspSources(base);
  const guides = platformGuides(base, KEY);
  const ex = examples(base);
  const year = new Date().getFullYear();

  return (
    <div className="min-h-dvh bg-canvas text-slate-800">
      <a
        href="#content"
        className="sr-only z-[60] rounded-full bg-white px-4 py-2 text-sm font-medium text-slate-900 shadow focus:not-sr-only focus:fixed focus:left-4 focus:top-3"
      >
        Skip to content
      </a>

      <header className="lp sticky top-0 z-40 border-b border-white/[0.07] bg-[#07070c]/85 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-3 px-4 sm:px-6">
          <Logo tone="dark" />
          <span aria-hidden className="h-5 w-px bg-white/10" />
          <span className="font-mono text-[12px] font-medium uppercase tracking-[0.14em] text-[#b3a9ff]">Docs</span>
          <div className="ml-auto flex items-center gap-1 sm:gap-3">
            <Link href="/" className={cx("hidden rounded-md px-1 text-[13.5px] font-medium text-white/65 transition-colors hover:text-white sm:inline", lpFocus)}>
              Home
            </Link>
            <Link href="/sign-in" className={cx("rounded-md px-2 text-[13.5px] font-medium text-white/65 transition-colors hover:text-white", lpFocus)}>
              Sign in
            </Link>
            <Link
              href="/sign-up"
              className={cx(
                "inline-flex h-9 items-center whitespace-nowrap rounded-[10px] px-4 text-[13.5px] font-semibold text-white",
                "bg-[linear-gradient(180deg,#7464fa_0%,#5340dc_100%)] shadow-[inset_0_1px_0_rgb(255_255_255/0.22),0_0_0_1px_rgb(124_108_255/0.5)] transition-[filter] hover:brightness-110",
                lpFocus,
              )}
            >
              Start free
            </Link>
          </div>
        </div>
      </header>

      {/* Intro, dark like the landing page */}
      <div className="lp relative overflow-hidden">
        <div aria-hidden className="pointer-events-none absolute inset-0">
          <div className="lp-hero-glow absolute inset-0" />
          <div className="lp-grid absolute inset-x-0 top-0 h-[520px]" />
        </div>

        <div className="relative mx-auto max-w-7xl px-4 pb-14 pt-12 sm:px-6 sm:pb-16 sm:pt-16">
          <p className="inline-flex items-center gap-2 text-[13px] font-medium tracking-wide text-[#b3a9ff]">
            <span className="h-px w-5 bg-gradient-to-r from-transparent to-[#b3a9ff]" aria-hidden />
            Developer docs
          </p>
          <h1 className="mt-4 max-w-3xl text-balance text-[38px] font-semibold leading-[1.04] tracking-[-0.045em] sm:text-[56px]">
            <span className="lp-heading">Put Halochime on your site, then connect it to </span>
            <span className="lp-accent pr-[0.06em] font-display text-[1.1em] font-normal italic tracking-[-0.02em]">your systems.</span>
          </h1>
          <p className="mt-5 max-w-2xl text-pretty text-base leading-7 text-white/65 sm:text-lg sm:leading-8">
            One script tag adds the voice and chat agent. A small JavaScript API, identity tokens, actions and signed webhooks
            let it know your users, look things up and tell your other tools what happened.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <a
              href="#getting-started"
              className={cx(
                "inline-flex h-11 items-center gap-2 rounded-full bg-white px-5 text-[15px] font-medium text-[#0b0b14] transition-colors hover:bg-[#eceaff]",
                lpFocus,
              )}
            >
              Get started
              <ArrowRight className="size-4" aria-hidden />
            </a>
            <a
              href="#webhooks"
              className={cx(
                "inline-flex h-11 items-center gap-2 rounded-full border border-white/12 bg-white/[0.04] px-5 text-[15px] font-medium text-white transition-colors hover:border-white/25 hover:bg-white/[0.08]",
                lpFocus,
              )}
            >
              Webhooks
            </a>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:grid lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-14 xl:gap-20">
        <aside className="hidden lg:block">
          <div className="sticky top-24 max-h-[calc(100dvh-7rem)] overflow-y-auto py-12 [scrollbar-width:none]">
            <Toc items={TOC} />
          </div>
        </aside>

        <main id="content" className="min-w-0 max-w-[46rem] py-10 sm:py-12">
          <MobileToc items={TOC} />

          {/* 1 ------------------------------------------------------------ */}
          <Section first>
            <div className="mt-8 lg:mt-0" />
            <H2 id="getting-started" eyebrow="01">
              Getting started
            </H2>
            <P>You need a Halochime workspace and about five minutes. Nothing to install on your server.</P>
            <List ordered>
              <li>
                <A href="/sign-up">Create a workspace</A> and an agent. Give it knowledge: paste text, import pages from your
                site, or upload PDF, .txt or .md files.
              </li>
              <li>
                Open the agent, add your website under <b className="font-semibold text-slate-900">Where it runs</b> (for
                example <C>example.com</C>) and switch on <b className="font-semibold text-slate-900">Published</b>.
              </li>
              <li>
                Go to <b className="font-semibold text-slate-900">Install</b> in the dashboard, copy your snippet and paste it
                before <C>&lt;/body&gt;</C> on your site.
              </li>
              <li>
                Use <b className="font-semibold text-slate-900">Check my site</b> on the Install page to confirm the snippet,
                the key and the domain are right.
              </li>
            </List>
            <Code samples={[{ label: "HTML", code: snippet }]} />
            <P>
              <C>data-key</C> is the agent&apos;s public key. It is safe to show in your page source: it only starts the agent
              on your allowed domains.
            </P>
          </Section>

          {/* 2 ------------------------------------------------------------ */}
          <Section>
            <H2 id="how-it-works" eyebrow="02">
              How it works on your site
            </H2>
            <List>
              <li>
                The script defines a <C>&lt;talkfront-widget&gt;</C> element and adds it to <C>&lt;body&gt;</C>. Its markup
                and styles live in a Shadow DOM, so your CSS can&apos;t break the widget and the widget can&apos;t change your
                page.
              </li>
              <li>
                The tag is <C>async</C>: your page never waits for it. It loads the agent&apos;s settings, shows a small
                launcher, and only connects voice or chat when a visitor opens it.
              </li>
              <li>
                It starts only on hostnames in the agent&apos;s allowed domains. <C>example.com</C> matches only that host;{" "}
                <C>*.example.com</C> matches its subdomains but not <C>example.com</C> itself, so add both if you use both.
              </li>
              <li>Drafts only load inside your dashboard. Publish the agent to go live.</li>
              <li>
                Visitors can talk or type in their own language: realtime voices and text chat cover 12 languages. Classic voices reply in English.
              </li>
              <li>
                With each conversation we keep the page it started on, as origin and path only. Query strings and
                fragments are dropped because they can carry tokens.
              </li>
            </List>
            <Callout>
              Add the script once per page. If it is included twice, the second copy does nothing.
            </Callout>
          </Section>

          {/* 3 ------------------------------------------------------------ */}
          <Section>
            <H2 id="platforms" eyebrow="03">
              Platform guides
            </H2>
            <P>
              Replace <C>{KEY}</C> with your agent&apos;s key, or copy the ready-made version from the Install page in your
              dashboard.
            </P>
            <div className="mt-6 divide-y divide-slate-200 overflow-hidden rounded-2xl border border-slate-200 bg-white">
              {guides.map((g) => (
                <details key={g.id} id={`platform-${g.id}`} className="group scroll-mt-24">
                  <summary
                    className={cx(
                      "flex cursor-pointer list-none items-center gap-3 px-5 py-4 transition-colors hover:bg-slate-50/80 [&::-webkit-details-marker]:hidden",
                      lpFocusLight,
                      "focus-visible:-outline-offset-2",
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-[15px] font-semibold text-slate-900">{g.label}</span>
                      <span className="block text-sm text-slate-500">{g.summary}</span>
                    </span>
                    <ArrowRight className="size-4 shrink-0 text-slate-400 transition-transform group-open:rotate-90" aria-hidden />
                  </summary>
                  <div className="border-t border-slate-100 px-5 pb-5 pt-1 [&_b]:font-semibold [&_b]:text-slate-900 [&_:not(pre)>code]:rounded [&_:not(pre)>code]:bg-slate-100 [&_:not(pre)>code]:px-1 [&_:not(pre)>code]:font-mono [&_:not(pre)>code]:text-[0.86em] [&_:not(pre)>code]:text-slate-800">
                    <List ordered>
                      {g.steps.map((s, i) => (
                        <li key={i}>{s}</li>
                      ))}
                    </List>
                    <Code samples={g.code.map((c) => ({ label: c.label, code: c.code }))} />
                    {g.notes?.map((n, i) => (
                      <p key={i} className="mt-2 flex gap-2 text-sm leading-6 text-slate-600">
                        <Info className="mt-1 size-3.5 shrink-0 text-slate-400" aria-hidden />
                        <span>{n}</span>
                      </p>
                    ))}
                  </div>
                </details>
              ))}
            </div>
          </Section>

          {/* 4 ------------------------------------------------------------ */}
          <Section>
            <H2 id="javascript-api" eyebrow="04">
              JavaScript API
            </H2>
            <P>
              Once the script has loaded, <C>window.Halochime</C> has these methods:
            </P>
            <DataTable
              head={["Call", "What it does"]}
              rows={[
                [<C key="o">Halochime.open()</C>, "Opens the panel."],
                [<C key="c">Halochime.close()</C>, "Closes it."],
                [<C key="i">{"Halochime.identify({ token })"}</C>, <>Signs in the visitor for their next conversation with an <a href="#identity" className="font-medium text-brand-700 underline underline-offset-2">identity token</a>.</>],
                [<C key="l">Halochime.logout()</C>, "Forgets the signed-in visitor. Call it when your user signs out."],
              ]}
            />
            <H3>Call it before the script loads</H3>
            <P>
              The tag is async, so your code may run first. Push calls onto a queue instead: the script runs them in order once
              it is ready, and after that the same <C>push</C> runs them straight away.
            </P>
            <Code
              samples={[
                {
                  label: "JavaScript",
                  code: `window.Halochime = window.Halochime || { q: [] };

// Works before and after widget.js has loaded:
document.querySelector("#help-button").addEventListener("click", () => {
  window.Halochime.q.push(["open"]);
});`,
                },
              ]}
            />
            <H3>Open it from your own button</H3>
            <Code
              samples={[
                {
                  label: "HTML",
                  code: `<button type="button" onclick="Halochime.open()">Talk to us</button>

${snippet}`,
                },
              ]}
            />
            <P>
              Pages rendered on your server can pass the identity token on the tag instead of calling <C>identify</C>:
            </P>
            <Code
              samples={[
                {
                  label: "HTML",
                  code: `<script src="${base}/widget.js" data-key="${KEY}"
        data-identity-token="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." async></script>`,
                },
              ]}
            />
          </Section>

          {/* 5 ------------------------------------------------------------ */}
          <Section>
            <H2 id="identity" eyebrow="05">
              Identity tokens
            </H2>
            <P>
              On a page where your users are signed in, such as a customer portal, tell the agent who it is talking to. Your
              server signs a short-lived token for the user and the widget passes it on. The agent then knows who it is
              talking to, treats the facts you include as true, and never reads them out unprompted.
            </P>
            <Callout tone="warn">
              Sign tokens on your server only. The identity secret (Agent &rsaquo; Identity) must never reach the browser,
              your front-end bundle or a public repository. If it leaks, regenerate it.
            </Callout>
            <H3 id="identity-claims">Claims</H3>
            <P>
              A JWT signed with <b className="font-semibold text-slate-900">HS256</b> (no other algorithm is accepted), header{" "}
              <C>{`{"alg":"HS256","typ":"JWT"}`}</C>.
            </P>
            <DataTable
              head={["Claim", "Required", "Rules"]}
              rows={[
                [<C key="s">sub</C>, "Yes", "Your user id, as a string. Up to 200 characters."],
                [<C key="n">name</C>, "No", "Up to 200 characters."],
                [<C key="e">email</C>, "No", "Up to 320 characters."],
                [
                  <C key="a">attributes</C>,
                  "No",
                  <>A flat object of facts, such as plan or open orders. Up to 30 keys; keys start with a letter and use letters, numbers or <C>_</C> (up to 40 characters); values are strings up to 500 characters, numbers or booleans.</>,
                ],
                [<C key="i">iat</C>, "Yes", "Issued at, in seconds since 1970."],
                [<C key="x">exp</C>, "Yes", "Expiry. At most 24 hours after iat. We allow 60 seconds of clock difference."],
              ]}
            />
            <H3 id="identity-signing">Sign on your server</H3>
            <Code
              caption="Language"
              samples={[
                { label: "Node", code: NODE_SIGN },
                { label: "Python", code: PY_SIGN },
                { label: "PHP", code: PHP_SIGN },
              ]}
            />
            <H3 id="identity-widget">Pass it to the widget</H3>
            <Code
              samples={[
                {
                  label: "JavaScript",
                  code: `// After your user signs in (token comes from your server):
window.Halochime = window.Halochime || { q: [] };
window.Halochime.q.push(["identify", { token }]);

// When they sign out:
window.Halochime.q.push(["logout"]);`,
                },
              ]}
            />
            <List>
              <li>The token applies to the next conversation the visitor starts. Sign a fresh one on each page load.</li>
              <li>
                If a token is missing, expired or wrong, the conversation still starts, as an anonymous visitor. Visitors are
                never blocked.
              </li>
              <li>
                Signed-in visitors show as verified in webhook events, and your user id is sent to your actions in the{" "}
                <C>X-Halochime-Visitor</C> header.
              </li>
            </List>
          </Section>

          {/* 6 ------------------------------------------------------------ */}
          <Section>
            <H2 id="actions" eyebrow="06">
              Actions
            </H2>
            <P>
              Actions let the agent call your HTTP API during a conversation, for example to check an order, find a free
              booking slot or look someone up in your CRM. We don&apos;t have ready-made CRM or database connectors yet;
              actions and webhooks are how you connect your systems today.
            </P>
            <H3 id="actions-define">Define an action</H3>
            <P>Open your agent and go to Actions. Each action has:</P>
            <DataTable
              head={["Field", "Rules"]}
              rows={[
                [<C key="n">name</C>, <>The tool name the model sees. Lowercase letters, numbers and <C>_</C>, starting with a letter, up to 40 characters, unique per agent.</>],
                ["Description", "When to use it, in plain words. The model reads this to decide, so be specific."],
                ["Method and URL", <>GET or POST to an <C>https://</C> URL on the public internet.</>],
                ["Headers", <>For example <C>Authorization: Bearer ...</C>. Stored encrypted and shown masked after saving. Never sent to the browser or the voice agent.</>],
                ["Parameters", "What the agent must collect first: a name, a type (string, number, integer or boolean), a description and whether it is required."],
                ["Timeout", "1 to 15 seconds. Default 8."],
              ]}
            />
            <H3 id="actions-request">The request we send</H3>
            <List>
              <li>
                <b className="font-semibold text-slate-900">GET</b>: arguments go in the query string.{" "}
                <b className="font-semibold text-slate-900">POST</b>: arguments are a JSON body.
              </li>
              <li>
                Your headers, plus <C>X-Halochime-Conversation</C> (the conversation id) and, when the visitor is signed in
                with an identity token, <C>X-Halochime-Visitor</C> (your user id from <C>sub</C>).
              </li>
              <li>Redirects are not followed for POST. Private, loopback and link-local addresses are refused.</li>
            </List>
            <Code
              samples={[
                {
                  label: "POST https://api.example.com/halochime/order-status",
                  code: `Content-Type: application/json
Authorization: Bearer <your token>
X-Halochime-Conversation: c0a8f2d4-6b1e-4f7a-9c3d-2e5b8a1f4d70
X-Halochime-Visitor: user_1042

{"order_number":"4471"}`,
                },
              ]}
            />
            <Callout>
              Use <C>X-Halochime-Visitor</C> to only return the signed-in user&apos;s own data. Without it, treat the caller as
              anonymous.
            </Callout>
            <H3 id="actions-response">Your response</H3>
            <P>
              Answer with a 2xx status and a short JSON or text body. The agent reads the first 4,000 characters and puts the
              answer in its own words. Any other status, or no answer within the timeout, is reported to the agent as a
              failure, so it tells the visitor it couldn&apos;t check. Every call is saved in the conversation&apos;s transcript.
            </P>
            <Code samples={[{ label: "200 OK", code: `{"order_number":"4471","status":"shipped","eta":"2026-10-28"}` }]} />
          </Section>

          {/* 7 ------------------------------------------------------------ */}
          <Section>
            <H2 id="webhooks" eyebrow="07">
              Webhooks
            </H2>
            <P>
              We POST a signed JSON event to your URL when something happens, so your server, Zapier or n8n can update your
              CRM, alert your team or start a workflow. Add endpoints in Settings &rsaquo; Webhooks.
            </P>
            <Callout>
              Slack&apos;s incoming webhooks expect their own message format. To post to Slack, send events to Zapier, n8n or
              a small server of your own, and forward from there.
            </Callout>

            <H3 id="webhooks-events">Events</H3>
            <DataTable
              head={["Event", "Sent when"]}
              rows={[
                [<C key="1">conversation.ended</C>, "A call or chat finished. Includes the summary and the collected information (when they could be made) and the transcript."],
                [<C key="2">handoff.created</C>, "A visitor left a message for your team."],
                [<C key="3">handoff.updated</C>, "The visitor changed or added details to their open message in the same conversation."],
              ]}
            />
            <P>An endpoint can get every event, including ones we add later, or only the ones you pick.</P>

            <H3 id="webhooks-request">The request</H3>
            <DataTable
              head={["Header", "Value"]}
              rows={[
                [<C key="1">Content-Type</C>, <C key="1v">application/json</C>],
                [<C key="2">User-Agent</C>, <C key="2v">Halochime-Webhooks/1</C>],
                [<C key="3">Halochime-Signature</C>, <C key="3v">{"t=<unix seconds>,v1=<hex HMAC-SHA256>"}</C>],
                [<C key="4">Halochime-Event</C>, "The event type, also in the body."],
                [<C key="5">Halochime-Event-Id</C>, "The event id, also in the body. The same on every retry."],
              ]}
            />
            <P>Every body has the same envelope. <C>created</C> is in unix seconds; times inside <C>data</C> are ISO 8601 in UTC.</P>
            <Code
              samples={[
                {
                  label: "Envelope",
                  code: `{
  "id": "evt_...",
  "type": "conversation.ended",
  "created": 1793001600,
  "workspace_id": "Wk3n9QpX2rT7vB1mY8sL4dF6hJ0cA5eG",
  "data": { }
}`,
                },
              ]}
            />

            <H3 id="webhooks-payloads">Payloads</H3>
            <P>
              The transcript holds the visitor&apos;s and the agent&apos;s messages only (up to the last 500).{" "}
              <C>visitor.verified</C> is true when an identity token signed them in, and <C>attributes</C> are the facts from
              that token. <C>summary</C> can be null.
            </P>
            <P>
              <C>collected</C> is what was gathered from the conversation: name, email, phone, <C>topic</C>, <C>outcome</C> (
              <C>answered</C>, <C>message_taken</C>, <C>not_answered</C> or <C>other</C>), <C>follow_up_needed</C> and{" "}
              <C>sentiment</C> (<C>positive</C>, <C>neutral</C> or <C>negative</C>), plus your own fields under <C>custom</C>,
              keyed by the field key you set on the agent. A value is null when it wasn&apos;t mentioned, and{" "}
              <C>collected</C> itself is null when nothing could be collected. Dates are <C>YYYY-MM-DD</C> when a full date was
              given, otherwise the visitor&apos;s own words.
            </P>
            <Code
              samples={[
                { label: "conversation.ended", code: ex.ended },
                { label: "handoff.created", code: ex.handoff },
              ]}
            />
            <P>
              Test events sent from Settings use the same shape with invented data and <C>&quot;test&quot;: true</C> inside{" "}
              <C>data</C>.
            </P>

            <H3 id="webhooks-verify">Verify the signature</H3>
            <P>
              Each endpoint has its own signing secret (<C>whsec_...</C>). Reveal it in Settings &rsaquo; Webhooks. To check a
              request:
            </P>
            <List ordered>
              <li>
                Read <C>t</C> and <C>v1</C> from the <C>Halochime-Signature</C> header.
              </li>
              <li>
                Compute HMAC-SHA256 of <C>{"<t>.<raw body>"}</C> with your secret, as hex.
              </li>
              <li>
                Compare it with <C>v1</C> in constant time.
              </li>
              <li>
                Reject the request if <C>t</C> is more than 5 minutes old, which stops replays.
              </li>
            </List>
            <Code
              caption="Language"
              samples={[
                { label: "Node (Express)", code: NODE_VERIFY },
                { label: "Python (Flask)", code: PY_VERIFY },
              ]}
            />
            <Callout tone="warn">
              Use the raw request body exactly as received. Parsing the JSON and turning it back into text changes spacing and
              breaks the signature.
            </Callout>

            <H3 id="webhooks-delivery">Retries and delivery log</H3>
            <List>
              <li>Answer with any 2xx status within 10 seconds. Do slow work after you answer.</li>
              <li>
                If you don&apos;t, we try again after 2 seconds and then after 10 more: 3 attempts in all, with the same event
                id. Use the id to skip duplicates.
              </li>
              <li>We don&apos;t follow redirects. Use your endpoint&apos;s final URL.</li>
              <li>
                URLs must be <C>https://</C> on the public internet. Private, loopback and link-local addresses are refused.
              </li>
              <li>
                Every attempt is listed under its endpoint in Settings with the status code, time and payload, for 30 days.
                Pause an endpoint with its switch; roll its secret if it leaks.
              </li>
            </List>
          </Section>

          {/* 8 ------------------------------------------------------------ */}
          <Section>
            <H2 id="security" eyebrow="08">
              Security and CSP
            </H2>
            <List>
              <li>
                <b className="font-semibold text-slate-900">Public key.</b> Safe in your page source. It only starts the agent
                on its allowed domains, and drafts only load inside your dashboard.
              </li>
              <li>
                <b className="font-semibold text-slate-900">Secrets.</b> Identity secrets and webhook signing secrets belong
                on your server. Action headers are stored encrypted and never leave our server.
              </li>
              <li>
                <b className="font-semibold text-slate-900">Outgoing requests.</b> Actions, webhooks and page imports only
                reach the public internet: private, loopback and link-local addresses are refused after DNS lookup.
              </li>
              <li>
                <b className="font-semibold text-slate-900">Abuse.</b> Each visitor IP can start up to 10 sessions per 10
                minutes.
              </li>
            </List>
            <H3>Content Security Policy</H3>
            <P>If your site sends a Content-Security-Policy header, add these sources to the directives you already have:</P>
            <Code
              samples={[
                {
                  label: "Content-Security-Policy",
                  code: `script-src ${csp.scriptSrc};
connect-src ${csp.connectSrc};
style-src 'unsafe-inline';`,
                },
              ]}
            />
            <List>
              <li>
                <C>connect-src</C> covers our API and the real-time voice and chat connection.
              </li>
              <li>
                <C>style-src &apos;unsafe-inline&apos;</C> is needed because the widget&apos;s styles sit in a{" "}
                <C>&lt;style&gt;</C> tag inside its Shadow DOM.
              </li>
              <li>
                Voice needs the microphone. If you send a Permissions-Policy header, allow it: <C>microphone=(self)</C>.
                Visitors are always asked before the microphone turns on.
              </li>
            </List>
          </Section>

          {/* 9 ------------------------------------------------------------ */}
          <Section>
            <H2 id="limits" eyebrow="09">
              Limits
            </H2>
            <P>What Halochime does today, so you can plan around it.</P>
            <DataTable
              head={["Area", "Limit"]}
              rows={[
                ["Languages", "Voice and text in 12 languages, or matching the visitor's language. Classic voices reply in English only."],
                ["Knowledge files", "PDF up to 4 MB, plus .txt and .md files."],
                ["Website import", "Up to 25 pages per run. Run it again for more."],
                ["Call length", "Set per agent (15 minutes by default)."],
                ["Actions", "Up to 20 per agent, 20 parameters each, 1 to 15 second timeout, first 4,000 characters of the answer."],
                ["Webhooks", "Up to 10 endpoints per workspace. 3 attempts per event, 10 second timeout. Delivery log kept 30 days."],
                ["Identity tokens", "HS256 only. Valid for at most 24 hours. Up to 30 attributes."],
                ["Sessions", "Up to 10 new sessions per visitor IP per 10 minutes."],
                ["Connectors", "No built-in CRM or database connectors yet. Use actions and webhooks."],
                ["Phone", "No phone numbers yet. Halochime runs on your website."],
              ]}
            />
            <div className="mt-12 flex flex-col items-start gap-4 rounded-2xl bg-ink p-6 text-white sm:flex-row sm:items-center sm:justify-between sm:p-7">
              <div>
                <p className="text-lg font-semibold tracking-tight">Ready to try it on your site?</p>
                <p className="mt-1 text-sm text-white/65">Start free. No card needed.</p>
              </div>
              <Link
                href="/sign-up"
                className={cx(
                  "inline-flex h-11 shrink-0 items-center gap-2 rounded-full bg-white px-5 text-[15px] font-medium text-[#0b0b14] transition-colors hover:bg-[#eceaff]",
                  lpFocus,
                )}
              >
                Start free
                <ArrowUpRight className="size-4" aria-hidden />
              </Link>
            </div>
          </Section>
        </main>
      </div>

      <footer className="border-t border-slate-200/80">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 px-4 py-8 text-sm text-slate-500 sm:flex-row sm:px-6">
          <Logo />
          <nav aria-label="Footer" className="flex flex-wrap justify-center gap-x-5 gap-y-2">
            <Link href="/" className={cx("rounded hover:text-slate-900", lpFocusLight)}>
              Home
            </Link>
            <Link href="/sign-in" className={cx("rounded hover:text-slate-900", lpFocusLight)}>
              Sign in
            </Link>
            <Link href="/sign-up" className={cx("rounded hover:text-slate-900", lpFocusLight)}>
              Start free
            </Link>
            {LEGAL_LINKS.map((l) => (
              <Link key={l.href} href={l.href} className={cx("rounded hover:text-slate-900", lpFocusLight)}>
                {l.label}
              </Link>
            ))}
          </nav>
          <p>© {year} Halochime</p>
        </div>
      </footer>
    </div>
  );
}
