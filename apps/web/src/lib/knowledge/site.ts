import "server-only";
import { createHash } from "node:crypto";
import { and, eq, isNotNull } from "drizzle-orm";
import { parseHTML } from "linkedom";
import { db } from "@/db";
import { knowledgeSources } from "@/db/schema";
import { extractReadable } from "./extract";
import { ingestPage } from "./ingest";
import { checkUrl, FetchError, safeFetch } from "./safe-fetch";

export const MAX_SITE_PAGES = 25;
const CONCURRENCY = 3;
const BUDGET_MS = 45_000;
const MIN_TEXT_CHARS = 200;
const MAX_CHILD_SITEMAPS = 4;
export const MAX_CANDIDATES = 500;

const ASSET_EXT =
  /\.(jpe?g|png|gif|webp|avif|svg|ico|bmp|tiff?|css|js|mjs|map|json|xml|rss|atom|txt|pdf|zip|gz|tgz|rar|7z|mp[34]|m4a|mov|avi|webm|wav|ogg|woff2?|ttf|otf|eot|docx?|xlsx?|pptx?|csv|exe|dmg|apk)$/i;
const FEED = /(^|\/)(feed|rss|atom)(\/|$)/i;
const TAXONOMY = /\/(tag|tags|category|categories|author|authors|archive|archives|label|labels)(\/|$)/i;
const PAGINATION = /\/page\/\d+\/?$/i;
const NOISE = /\/(wp-admin|wp-json|wp-content|wp-includes|wp-login\.php|cdn-cgi|search)(\/|$)/i;
const TRACKING = /^(utm_\w+|fbclid|gclid|mc_cid|mc_eid|ref)$/i;

const bareHost = (host: string) => host.toLowerCase().replace(/^www\./, "");

/** Dedupe key: scheme, www., hash, tracking params and trailing slash do not make a different page. */
function urlKey(u: URL): string {
  const params = [...u.searchParams].filter(([k]) => !TRACKING.test(k)).sort(([a], [b]) => a.localeCompare(b));
  const query = params.length ? `?${new URLSearchParams(params).toString()}` : "";
  const path = u.pathname.replace(/\/+$/, "") || "/";
  return `${bareHost(u.hostname)}${u.port ? `:${u.port}` : ""}${path}${query}`;
}

/** Same site (www. or not), http(s), and looks like a content page rather than a file, feed, tag list or page 2. */
function contentPage(raw: string, base: URL, siteHost: string): URL | null {
  let u: URL;
  try {
    u = new URL(raw.trim(), base);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  if (u.username || u.password) return null;
  if (bareHost(u.hostname) !== siteHost) return null;
  u.hash = "";
  const path = decodeURIComponent(u.pathname);
  if (ASSET_EXT.test(path) || FEED.test(path) || TAXONOMY.test(path) || PAGINATION.test(path) || NOISE.test(path)) {
    return null;
  }
  for (const k of ["page", "paged", "s", "feed", "replytocom", "share", "format"]) if (u.searchParams.has(k)) return null;
  return u;
}

function decodeXml(s: string): string {
  return s
    .replace(/^<!\[CDATA\[|\]\]>$/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .trim();
}

function parseSitemap(xml: string): { index: boolean; locs: string[] } {
  const index = /<sitemapindex[\s>]/i.test(xml);
  const locs = [...xml.matchAll(/<loc>\s*([\s\S]*?)\s*<\/loc>/gi)].map((m) => decodeXml(m[1]!)).filter(Boolean);
  return { index, locs };
}

/** Disallow/Allow rules for `*` (or our bot); longest matching rule wins, as most crawlers do. */
function parseRobots(txt: string) {
  const rules: { allow: boolean; re: RegExp; len: number }[] = [];
  const sitemaps: string[] = [];
  let applies = false;
  let lastWasAgent = false;
  for (const rawLine of txt.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*/, "").trim();
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) continue;
    const key = m[1]!.toLowerCase();
    const value = m[2]!.trim();
    if (key === "sitemap") {
      if (value) sitemaps.push(value);
      continue;
    }
    if (key === "user-agent") {
      const ua = value.toLowerCase();
      // HalochimeBot, or TalkfrontBot from before the product's rename.
      const match = ua === "*" || ua.includes("halochimebot") || ua.includes("talkfrontbot");
      applies = lastWasAgent ? applies || match : match;
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!applies || (key !== "disallow" && key !== "allow") || !value) continue;
    const pattern = value.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\\\$$/, "$");
    rules.push({ allow: key === "allow", re: new RegExp(`^${pattern}`), len: value.length });
  }
  const allowed = (u: URL) => {
    const path = u.pathname + u.search;
    let best: { allow: boolean; len: number } | null = null;
    for (const r of rules) if (r.re.test(path) && (!best || r.len > best.len)) best = r;
    return best ? best.allow : true;
  };
  return { allowed, sitemaps };
}

async function fetchText(url: string, signal: AbortSignal): Promise<{ url: string; body: string; type: string } | null> {
  try {
    const res = await safeFetch(url, { signal });
    return { url: res.url, body: res.body, type: res.contentType.split(";")[0]!.trim().toLowerCase() };
  } catch {
    return null;
  }
}

/** `pages`: every candidate (up to MAX_CANDIDATES), best first; the importer takes the first 25 it does not have yet. */
type Discovery = { via: "sitemap" | "home page"; pages: URL[]; siteHost: string };

/** Finds candidate page URLs: /sitemap.xml, then robots.txt Sitemap: lines (one index level), then home page links. */
export async function discoverSitePages(origin: URL, signal: AbortSignal): Promise<Discovery> {
  let siteHost = bareHost(origin.hostname);
  const [robotsRes, mainSitemap] = await Promise.all([
    fetchText(new URL("/robots.txt", origin).toString(), signal),
    fetchText(new URL("/sitemap.xml", origin).toString(), signal),
  ]);
  // An HTML answer (SPA catch-all) is not a robots.txt.
  const robots = parseRobots(robotsRes && (!robotsRes.type || robotsRes.type === "text/plain") ? robotsRes.body : "");

  const candidates = new Map<string, URL>();
  const take = (raw: string, base: URL) => {
    if (candidates.size >= MAX_CANDIDATES) return;
    const u = contentPage(raw, base, siteHost);
    if (u && robots.allowed(u)) candidates.set(urlKey(u), u);
  };

  const readSitemap = async (res: { url: string; body: string } | null, followIndex: boolean) => {
    if (!res || !/<(urlset|sitemapindex)[\s>]/i.test(res.body)) return;
    const base = new URL(res.url);
    const { index, locs } = parseSitemap(res.body);
    if (!index) {
      for (const loc of locs) take(loc, base);
      return;
    }
    if (!followIndex) return;
    // Page sitemaps first; tag/category/author sitemaps are lists, not content.
    const children = locs
      .filter((l) => !/(tag|categor|author|archive)/i.test(l) && !/\.gz$/i.test(l))
      .sort((a, b) => Number(/page/i.test(b)) - Number(/page/i.test(a)))
      .slice(0, MAX_CHILD_SITEMAPS);
    const fetched = await Promise.all(children.map((c) => fetchText(c, signal)));
    for (const child of fetched) await readSitemap(child, false);
  };

  // A redirect such as example.com -> www.example.com is still the same site.
  if (mainSitemap) siteHost = bareHost(new URL(mainSitemap.url).hostname);
  await readSitemap(mainSitemap, true);
  if (candidates.size === 0) {
    const tried = new Set([new URL("/sitemap.xml", origin).toString(), mainSitemap?.url]);
    const others = robots.sitemaps.filter((s) => !tried.has(s) && !/\.gz$/i.test(s)).slice(0, 3);
    for (const s of others) {
      await readSitemap(await fetchText(s, signal), true);
      if (candidates.size > 0) break;
    }
  }

  let via: Discovery["via"] = "sitemap";
  if (candidates.size === 0) {
    via = "home page";
    const home = await fetchText(origin.toString(), signal);
    if (home && (home.type === "text/html" || home.type === "application/xhtml+xml")) {
      const homeUrl = new URL(home.url);
      siteHost = bareHost(homeUrl.hostname);
      take(home.url, homeUrl);
      const { document } = parseHTML(home.body);
      document.querySelectorAll("a[href]").forEach((a: Element) => take(a.getAttribute("href") ?? "", homeUrl));
    }
  }

  // Shallow pages (pricing, FAQ, about) before deep ones (old blog posts); order within a depth is kept.
  const depth = (u: URL) => u.pathname.split("/").filter(Boolean).length;
  const all = [...candidates.values()].map((u, i) => ({ u, i })).sort((a, b) => depth(a.u) - depth(b.u) || a.i - b.i);
  return { via, pages: all.map((x) => x.u), siteHost };
}

export type SiteImportResult = {
  ok: boolean;
  error?: string;
  host: string;
  via?: Discovery["via"];
  /** Candidate pages found (stops counting at MAX_CANDIDATES). */
  found: number;
  /** Candidates this workspace already has; they are passed over, so a second run imports the next 25. */
  known: number;
  added: number;
  skipped: { url: string; reason: string }[];
  failed: { url: string; reason: string }[];
};

/** "example.com" or "https://example.com/anything" -> https://example.com/ */
export function siteOrigin(input: string): URL {
  const raw = input.trim();
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  const url = checkUrl(withScheme);
  if (!url.hostname.includes(".")) throw new FetchError("Enter a site address such as example.com.");
  return new URL(`${url.protocol}//${url.host}/`);
}

/**
 * Imports up to 25 pages of a public site as one knowledge source per page, within a ~45 s budget.
 * Every fetch goes through safeFetch (SSRF checks, 10 s timeout, 2 MB cap); 3 pages at a time.
 */
export async function importSite(
  scope: { organizationId: string; agentId: string | null },
  input: string,
): Promise<SiteImportResult> {
  let origin: URL;
  try {
    origin = siteOrigin(input);
  } catch (err) {
    return { ok: false, error: (err as Error).message, host: input, found: 0, known: 0, added: 0, skipped: [], failed: [] };
  }
  const host = origin.host;
  const signal = AbortSignal.timeout(BUDGET_MS);
  const result: SiteImportResult = { ok: false, host, found: 0, known: 0, added: 0, skipped: [], failed: [] };

  const found = await discoverSitePages(origin, signal);
  result.via = found.via;
  result.found = found.pages.length;
  if (found.pages.length === 0) {
    result.error = signal.aborted
      ? "The site took too long to answer. Try again later."
      : `We could not find any pages on ${host} that we may read (sitemap, robots.txt rules or home page links). Check the address, or add pages one by one under "Web page".`;
    return result;
  }

  // Pages this workspace already has are passed over, so running an import again adds the next pages, not duplicates.
  const existing = await db
    .select({ url: knowledgeSources.url })
    .from(knowledgeSources)
    .where(and(eq(knowledgeSources.organizationId, scope.organizationId), isNotNull(knowledgeSources.url)));
  const existingUrls = new Set<string>();
  for (const row of existing) {
    try {
      existingUrls.add(urlKey(new URL(row.url!)));
    } catch {
      // ignore malformed stored URLs
    }
  }
  const seenUrls = new Set<string>();
  const seenText = new Set<string>();

  const importOne = async (pageUrl: URL) => {
    const shown = pageUrl.toString();
    if (signal.aborted) return void result.skipped.push({ url: shown, reason: "Not reached within the time limit" });
    let page;
    try {
      page = await safeFetch(shown, { signal });
    } catch (err) {
      const reason = err instanceof FetchError ? err.message : "Could not fetch the page.";
      if (signal.aborted) return void result.skipped.push({ url: shown, reason: "Not reached within the time limit" });
      return void result.failed.push({ url: shown, reason });
    }
    const type = page.contentType.split(";")[0]!.trim().toLowerCase();
    if (type && type !== "text/html" && type !== "application/xhtml+xml") {
      return void result.skipped.push({ url: shown, reason: `Not a web page (${type})` });
    }
    const finalUrl = new URL(page.url);
    const { title, text, canonical } = extractReadable(page.body, finalUrl.pathname === "/" ? host : shown);

    // The canonical URL (when it stays on this site) is the page's real address.
    let url = finalUrl;
    if (canonical) {
      const c = contentPage(canonical, finalUrl, found.siteHost);
      if (c) {
        if (finalUrl.protocol === "https:") c.protocol = "https:"; // never store an http canonical for an https page
        url = c;
      }
    }
    const keys = [urlKey(pageUrl), urlKey(finalUrl), urlKey(url)];
    if (keys.slice(1).some((k) => existingUrls.has(k))) {
      return void result.skipped.push({ url: shown, reason: "Already in your knowledge" });
    }
    if (keys.some((k) => seenUrls.has(k))) {
      return void result.skipped.push({ url: shown, reason: "Duplicate of another page" });
    }
    keys.forEach((k) => seenUrls.add(k));

    if (text.length < MIN_TEXT_CHARS) return void result.skipped.push({ url: shown, reason: "Almost no text" });
    const hash = createHash("sha256").update(text).digest("hex");
    if (seenText.has(hash)) return void result.skipped.push({ url: shown, reason: "Same text as another page" });
    seenText.add(hash);

    const stored = await ingestPage(scope, { title: title || url.toString(), url: url.toString(), text });
    if (stored.ok) result.added++;
    else result.failed.push({ url: shown, reason: stored.error });
  };

  const fresh = found.pages.filter((u) => !existingUrls.has(urlKey(u)));
  result.known = found.pages.length - fresh.length;
  if (fresh.length === 0) {
    result.error = `Every page we found on ${host} is already in your knowledge.`;
    return result;
  }
  const queue = fresh.slice(0, MAX_SITE_PAGES);
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      for (let next = queue.shift(); next; next = queue.shift()) {
        try {
          await importOne(next);
        } catch (err) {
          console.error("site import page failed", err);
          result.failed.push({ url: next.toString(), reason: "Import failed." });
        }
      }
    }),
  );

  result.ok = result.added > 0;
  if (!result.ok) {
    result.error = `No pages were added from ${host}.`;
  }
  return result;
}
