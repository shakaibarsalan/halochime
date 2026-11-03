import "server-only";
import { appOrigin, isProduction } from "./env";

/** Normalizes what owners type into allowed domains: "https://Shop.com/" -> "shop.com", "*.shop.com" stays. */
export function normalizeDomain(input: string): string | null {
  let d = input.trim().toLowerCase();
  if (!d) return null;
  d = d.replace(/^[a-z]+:\/\//, "").replace(/[/?#].*$/, "").replace(/:\d+$/, "");
  const wildcard = d.startsWith("*.");
  const host = wildcard ? d.slice(2) : d;
  const label = "[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?";
  if (!new RegExp(`^${label}(?:\.${label})*$`).test(host)) return null;
  if (wildcard && !host.includes(".")) return null;
  return wildcard ? `*.${host}` : host;
}

export function hostMatches(hostname: string, allowed: string): boolean {
  const host = hostname.toLowerCase();
  if (allowed.startsWith("*.")) return host.endsWith(allowed.slice(1)); // subdomains only, not the apex
  return host === allowed;
}

/**
 * The origin a widget request comes from. Browsers send Origin on cross-origin requests;
 * same-origin GETs (the dashboard's "Try it" panel) may omit it, so fall back to Referer.
 */
export function requestOrigin(req: Request): string | null {
  const origin = req.headers.get("origin");
  if (origin && origin !== "null") return origin;
  const referer = req.headers.get("referer");
  if (!referer) return null;
  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
}

export type OriginCheck = { allowed: boolean; isAppOrigin: boolean };

export function checkOrigin(origin: string | null, allowedDomains: string[]): OriginCheck {
  if (!origin) return { allowed: false, isAppOrigin: false };
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return { allowed: false, isAppOrigin: false };
  }
  if (url.origin === appOrigin()) return { allowed: true, isAppOrigin: true };
  if (!isProduction() && (url.hostname === "localhost" || url.hostname === "127.0.0.1")) {
    return { allowed: true, isAppOrigin: false };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return { allowed: false, isAppOrigin: false };
  return { allowed: allowedDomains.some((d) => hostMatches(url.hostname, d)), isAppOrigin: false };
}

/** CORS headers: echo the Origin only when it is allowed. */
export function corsHeaders(origin: string | null, allowed: boolean): Headers {
  const h = new Headers({ Vary: "Origin" });
  if (allowed && origin) {
    h.set("Access-Control-Allow-Origin", origin);
    h.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    h.set("Access-Control-Allow-Headers", "Content-Type");
    h.set("Access-Control-Max-Age", "600");
  }
  return h;
}
