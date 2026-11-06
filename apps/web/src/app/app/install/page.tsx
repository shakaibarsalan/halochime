import { asc, eq } from "drizzle-orm";
import {
  ArrowUpRight,
  BookOpen,
  Bot,
  Code2,
  Download,
  Puzzle,
  Globe,
  Layers,
  LayoutGrid,
  Radar,
  ShieldCheck,
  TriangleAlert,
  Webhook,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { AgentStatusBadge, buttonClass, ButtonLink, Card, CardHeader, EmptyState, PageHeader } from "@/components/ui";
import { db } from "@/db";
import { agents } from "@/db/schema";
import { appUrl } from "@/lib/env";
import { requireWorkspace } from "@/lib/session";
import { cspSources, embedSnippet, platformGuides, WORDPRESS_ZIP } from "../../docs/_content/platforms";
import { AgentPicker, CheckSite, CodeBlock, CopyIconButton, PlatformTabs } from "./install-client";

export const metadata = { title: "Install" };

const link =
  "font-medium text-brand-700 underline-offset-2 hover:underline focus-visible:rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600";

function Point({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg bg-slate-50 text-slate-500 ring-1 ring-slate-200/80" aria-hidden>
        <Icon className="size-3.5" />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-slate-900">{title}</span>
        <span className="mt-0.5 block text-xs leading-5 text-slate-500">{children}</span>
      </span>
    </li>
  );
}

function NextLink({ href, icon: Icon, title, body }: { href: string; icon: LucideIcon; title: string; body: string }) {
  const external = href.startsWith("/docs");
  return (
    <Link
      href={href}
      target={external ? "_blank" : undefined}
      className="group flex items-start gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-brand-600"
    >
      <Icon className="mt-0.5 size-4 shrink-0 text-slate-400 group-hover:text-brand-600" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-slate-900">{title}</span>
        <span className="block text-xs leading-5 text-slate-500">{body}</span>
      </span>
      <ArrowUpRight className="mt-0.5 size-3.5 shrink-0 text-slate-300 transition-colors group-hover:text-slate-500" aria-hidden />
      {external ? <span className="sr-only">(opens in a new tab)</span> : null}
    </Link>
  );
}

export default async function InstallPage({ searchParams }: { searchParams: Promise<{ agent?: string }> }) {
  const { organizationId } = await requireWorkspace();
  const list = await db
    .select({
      id: agents.id,
      name: agents.name,
      status: agents.status,
      publicKey: agents.publicKey,
      allowedDomains: agents.allowedDomains,
    })
    .from(agents)
    .where(eq(agents.organizationId, organizationId))
    .orderBy(asc(agents.createdAt));

  if (list.length === 0) {
    return (
      <>
        <PageHeader title="Install" description="Put your agent on your website with one script tag." />
        <Card>
          <EmptyState
            title="Create an agent first"
            icon={Bot}
            action={
              <ButtonLink href="/app/agents">
                <Bot aria-hidden />
                Go to Agents
              </ButtonLink>
            }
          >
            The snippet belongs to an agent. Once you have one, its install steps show here.
          </EmptyState>
        </Card>
      </>
    );
  }

  const wanted = (await searchParams).agent;
  const agent = list.find((a) => a.id === wanted) ?? list.find((a) => a.status === "published") ?? list[0]!;
  const base = appUrl();
  const snippet = embedSnippet(base, agent.publicKey);
  const agentHref = `/app/agents/${agent.id}`;
  const csp = cspSources(base);
  const platforms = platformGuides(base, agent.publicKey).map((p) => ({
    id: p.id,
    label: p.label,
    summary: p.summary,
    steps: p.steps,
    code: p.code.map((c) => ({ label: c.label, code: c.code })),
    notes: p.notes,
  }));
  const firstDomain = agent.allowedDomains.find((d) => !d.startsWith("*.")) ?? "";
  const cspText = `script-src ${csp.scriptSrc};\nconnect-src ${csp.connectSrc};\nstyle-src 'unsafe-inline';`;

  return (
    <>
      <PageHeader title="Install" description="Put your agent on your website or user portal with one script tag." />

      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-6">
          <Card>
            <CardHeader title="Your snippet" icon={Code2} description="The same tag works on every platform below." />
            <div className="space-y-4 p-5">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="text-sm font-medium text-slate-800">Agent</span>
                  {list.length > 1 ? null : (
                    <span className="truncate text-sm text-slate-600" title={agent.name}>
                      {agent.name}
                    </span>
                  )}
                  <AgentStatusBadge status={agent.status} />
                </div>
                {list.length > 1 ? <AgentPicker agents={list} current={agent.id} /> : null}
              </div>

              <div className="overflow-hidden rounded-xl bg-ink">
                <div className="flex items-center justify-between gap-3 border-b border-white/[0.07] py-1.5 pl-3.5 pr-1.5">
                  <span className="truncate font-mono text-[11px] text-slate-400" title={agent.publicKey}>
                    {agent.publicKey}
                  </span>
                  <CopyIconButton text={snippet} label="snippet" />
                </div>
                <pre className="whitespace-pre-wrap p-3.5 font-mono text-xs leading-5 text-slate-200 [overflow-wrap:anywhere]">
                  <code>{snippet}</code>
                </pre>
              </div>

              {agent.status !== "published" ? (
                <p className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800 ring-1 ring-amber-200/70">
                  <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                  <span>
                    This agent is a draft, so it only loads inside your dashboard.{" "}
                    <Link href={`${agentHref}#allowedDomains`} className="font-medium underline underline-offset-2 hover:text-amber-950">
                      Publish it
                    </Link>{" "}
                    when you&apos;re ready to go live.
                  </span>
                </p>
              ) : null}
            </div>
          </Card>

          <Card>
            <CardHeader title="Add it to your site" icon={LayoutGrid} description="Pick your platform. Your snippet is already in every example." />
            <PlatformTabs platforms={platforms} />
          </Card>

          <Card>
            <CardHeader title="How it shows on your site" icon={Layers} />
            <ul className="grid gap-4 p-5 sm:grid-cols-2">
              <Point icon={Layers} title="Its own sealed box">
                The script adds one &lt;talkfront-widget&gt; element. Its look lives in a Shadow DOM, so your CSS can&apos;t
                break it and it can&apos;t change your page.
              </Point>
              <Point icon={Radar} title="Loads in the background">
                The tag is async, so your page never waits for it. It fetches its settings, then voice and chat connect
                only when a visitor opens it.
              </Point>
              <Point icon={Globe} title="Only on your domains">
                It starts only on the hostnames in this agent&apos;s allowed domains. Anywhere else it stays hidden.
              </Point>
              <Point icon={Code2} title="Control it from your code">
                Open or close it from your own buttons, and sign in your logged-in users.{" "}
                <Link href="/docs#javascript-api" target="_blank" className={link}>
                  JavaScript API
                </Link>
              </Point>
            </ul>
          </Card>
        </div>

        <div className="grid grid-cols-[minmax(0,1fr)] content-start gap-6 md:grid-cols-2 xl:sticky xl:top-10 xl:grid-cols-1 xl:self-start">
          <Card>
            <CardHeader title="Plugins" icon={Puzzle} description="No code: paste your public key into the plugin." />
            <div className="space-y-4 p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-900">WordPress</p>
                  <p className="text-xs leading-5 text-slate-500">Settings &rsaquo; Halochime after you upload and activate it.</p>
                </div>
                <a href={WORDPRESS_ZIP} download className={`${buttonClass("secondary", "sm")} shrink-0`}>
                  <Download aria-hidden />
                  Download
                </a>
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-900">Shopify</p>
                <p className="text-xs leading-5 text-slate-500">
                  With the Halochime app installed, turn on the Halochime widget under Customize &rsaquo; App embeds. Without it, use
                  the theme.liquid steps in the Shopify tab.
                </p>
              </div>
              <div className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2 ring-1 ring-slate-200/70">
                <span className="min-w-0 truncate font-mono text-xs text-slate-700" title={agent.publicKey}>
                  {agent.publicKey}
                </span>
                <CopyIconButton text={agent.publicKey} label="public key" tone="light" />
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader title="Check my site" icon={Radar} />
            <div className="p-5">
              <CheckSite agentId={agent.id} agentHref={agentHref} defaultUrl={firstDomain} />
            </div>
          </Card>

          <Card>
            <CardHeader title="Allowed domains" icon={Globe} />
            <div className="space-y-3 p-5">
              {agent.allowedDomains.length === 0 ? (
                <p className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800 ring-1 ring-amber-200/70">
                  <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                  None yet. The widget won&apos;t start on any website until you add your domain.
                </p>
              ) : (
                <ul className="flex flex-wrap gap-1.5">
                  {agent.allowedDomains.map((d) => (
                    <li key={d} className="max-w-full truncate rounded-md bg-slate-100 px-2 py-1 font-mono text-xs text-slate-700" title={d}>
                      {d}
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-xs leading-5 text-slate-500">
                example.com matches only that host. *.example.com matches its subdomains, so add both if you use both.
              </p>
              <Link href={`${agentHref}#allowedDomains`} className={cxLink()}>
                {agent.allowedDomains.length === 0 ? "Add a domain" : "Edit domains"}
              </Link>
            </div>
          </Card>

          <Card>
            <CardHeader title="Content Security Policy" icon={ShieldCheck} />
            <div className="space-y-3 p-5">
              <p className="text-xs leading-5 text-slate-500">
                Only needed if your site sends a CSP header. Add these sources to the directives you already have:
              </p>
              <CodeBlock label="CSP additions" code={cspText} />
              <p className="text-xs leading-5 text-slate-500">
                For voice, your site must also allow the microphone. If you send a Permissions-Policy header, include{" "}
                <code className="rounded bg-slate-100 px-1 font-mono text-[11px] text-slate-700">microphone=(self)</code>.
              </p>
            </div>
          </Card>

          <Card>
            <CardHeader title="Go further" icon={BookOpen} />
            <nav aria-label="Go further" className="p-2">
              <NextLink href={`${agentHref}#identity`} icon={Bot} title="Know who is talking" body="Sign in your logged-in users with an identity token." />
              <NextLink href={`${agentHref}#actions`} icon={Code2} title="Let it look things up" body="Actions call your API, like order status or bookings." />
              <NextLink href="/app/settings#webhooks" icon={Webhook} title="Send events to your tools" body="Webhooks to your server, Zapier or n8n." />
              <NextLink href="/docs" icon={BookOpen} title="Developer docs" body="Every option, with code examples." />
            </nav>
          </Card>
        </div>
      </div>
    </>
  );
}

function cxLink() {
  return `inline-flex text-sm ${link}`;
}
