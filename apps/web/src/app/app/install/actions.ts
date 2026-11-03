"use server";

import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { agents } from "@/db/schema";
import { appOrigin } from "@/lib/env";
import { FetchError, safeFetch } from "@/lib/knowledge/safe-fetch";
import { rateLimit } from "@/lib/rate-limit";
import { requireWorkspace } from "@/lib/session";
import { hostMatches } from "@/lib/widget-origin";

// "Check my site": fetch a public page once (SSRF-safe) and look for this agent's snippet.

export type CheckTone = "ok" | "warn" | "bad";
export type CheckItem = { tone: CheckTone; title: string; body?: string };
export type SiteCheckState = {
  error?: string;
  url?: string;
  hostname?: string;
  items?: CheckItem[];
  /** The hostname to add to allowed domains, when it is missing. */
  addDomain?: string;
  input?: string;
} | null;

const Input = z.object({
  agentId: z.string().trim().min(1).max(128),
  url: z.string().trim().min(1, "Enter your website's address.").max(2000, "That address is too long."),
});

const KEY_RE = /pk_[A-Za-z0-9_-]{24}(?![A-Za-z0-9_-])/g;
const attr = (tag: string, name: string) =>
  tag.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, "i"))?.slice(1).find((v) => v !== undefined);

/** Script tags that load widget.js, with their src and data-key. */
function widgetTags(html: string, pageUrl: string) {
  const out: { src: string; key: string | null }[] = [];
  for (const m of html.matchAll(/<script\b[^>]*>/gi)) {
    const src = attr(m[0], "src");
    if (!src || !/widget\.js(?:[?#]|$)/i.test(src)) continue;
    let resolved = src;
    try {
      resolved = new URL(src, pageUrl).toString();
    } catch {
      // keep as written
    }
    out.push({ src: resolved, key: attr(m[0], "data-key") ?? null });
  }
  return out;
}

const host = (u: string) => {
  try {
    return new URL(u).host;
  } catch {
    return u;
  }
};

export async function checkSite(_prev: SiteCheckState, formData: FormData): Promise<SiteCheckState> {
  const ws = await requireWorkspace();
  const typed = String(formData.get("url") ?? "").slice(0, 2000);
  const parsed = Input.safeParse({ agentId: formData.get("agentId"), url: typed });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the address.", input: typed };

  const limit = rateLimit(`check-site:${ws.user.id}`, 20, 10 * 60 * 1000);
  if (!limit.ok) return { error: `Too many checks. Try again in ${Math.ceil(limit.retryAfterSec / 60)} min.`, input: typed };

  const [agent] = await db
    .select({ id: agents.id, publicKey: agents.publicKey, allowedDomains: agents.allowedDomains, status: agents.status })
    .from(agents)
    .where(and(eq(agents.id, parsed.data.agentId), eq(agents.organizationId, ws.organizationId)))
    .limit(1);
  if (!agent) return { error: "Agent not found.", input: typed };

  let raw = parsed.data.url;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) raw = `https://${raw}`;
  try {
    const u = new URL(raw);
    if (!u.hostname.includes(".")) throw new Error();
  } catch {
    return { error: "That doesn't look like a web address. Try something like example.com.", input: typed };
  }

  let page;
  try {
    page = await safeFetch(raw);
  } catch (err) {
    const msg = err instanceof FetchError ? err.message : "Could not load the page.";
    return { error: `We couldn't load ${host(raw)}. ${msg}`, input: typed };
  }

  const finalUrl = new URL(page.url);
  const items: CheckItem[] = [];

  if (!/html/i.test(page.contentType) && !/<html|<body|<script/i.test(page.body.slice(0, 5000))) {
    items.push({ tone: "warn", title: "That address isn't a web page", body: "Enter the address of a page on your site, like your home page." });
  }

  // 1. Is the snippet there, with this agent's key?
  const tags = widgetTags(page.body, page.url);
  const keys = new Set<string>([...tags.map((t) => t.key).filter((k): k is string => !!k), ...(page.body.match(KEY_RE) ?? [])]);
  const ours = tags.find((t) => t.key === agent.publicKey);
  if (keys.has(agent.publicKey)) {
    items.push({
      tone: "ok",
      title: "Found this agent's snippet",
      body: ours ? undefined : "It is added by a script on the page (for example next/script), which works too.",
    });
    if (ours && new URL(ours.src).origin !== appOrigin()) {
      items.push({
        tone: "warn",
        title: `widget.js loads from ${host(ours.src)}`,
        body: `Copy the snippet again so it loads from ${host(appOrigin())}. Other copies don't get updates.`,
      });
    }
  } else if (keys.size > 0) {
    const others = [...keys];
    const named = await db
      .select({ name: agents.name, key: agents.publicKey })
      .from(agents)
      .where(and(eq(agents.organizationId, ws.organizationId), inArray(agents.publicKey, others)));
    items.push({
      tone: "bad",
      title: "Found a Halochime widget, but not this agent's key",
      body: named.length
        ? `This page uses your agent "${named[0]!.name}". Pick that agent above, or replace the snippet with this one.`
        : `This page uses ${others[0]}${others.length > 1 ? ` and ${others.length - 1} more` : ""}. Replace it with the snippet above.`,
    });
  } else if (tags.length > 0) {
    items.push({ tone: "bad", title: "Found widget.js, but no data-key", body: "Copy the whole snippet above: the data-key attribute tells it which agent to start." });
  } else {
    items.push({
      tone: "bad",
      title: "No Halochime snippet on this page",
      body: "Paste the snippet before </body> and publish your site. Added it with Google Tag Manager? Then we can't see it from here: open the page and look for the chat button.",
    });
  }

  // 2. Will the widget start on this hostname?
  const hostname = finalUrl.hostname.toLowerCase();
  const allowed = agent.allowedDomains.some((d) => hostMatches(hostname, d));
  if (allowed) items.push({ tone: "ok", title: `${hostname} is an allowed domain` });
  else
    items.push({
      tone: "bad",
      title: `${hostname} isn't in this agent's allowed domains`,
      body:
        agent.allowedDomains.length === 0
          ? "This agent has no allowed domains yet, so it won't start on any website. Add this one."
          : "The widget won't start here until you add it.",
    });

  // 3. Is the agent live?
  if (agent.status !== "published") {
    items.push({ tone: "warn", title: "This agent is a draft", body: "Drafts only load inside your dashboard. Publish it to go live." });
  }

  return {
    url: page.url,
    hostname,
    items,
    addDomain: allowed ? undefined : hostname,
    input: typed,
  };
}
