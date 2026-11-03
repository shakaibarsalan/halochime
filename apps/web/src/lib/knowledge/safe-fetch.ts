import "server-only";
import { lookup } from "node:dns";
import http from "node:http";
import https from "node:https";
import { BlockList, isIP, type LookupFunction } from "node:net";
import zlib from "node:zlib";

const TIMEOUT_MS = 10_000;
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 3;

// Everything that is not the public internet: private, loopback, link-local (incl. cloud
// metadata 169.254.169.254 / fd00:ec2::254), CGNAT, multicast, documentation and reserved ranges.
const blocked = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16],
  ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) blocked.addSubnet(net, prefix, "ipv4");
// No ::ffff:0:0/96 rule: Node's BlockList already checks IPv4-mapped IPv6 addresses against the IPv4
// rules above, and a mapped-range rule would match every IPv4 address.
// ::/96 is the old IPv4-compatible range (e.g. ::7f00:1 = 127.0.0.1); it also covers :: and ::1.
// Unlike ::ffff:0:0/96 it does not match plain IPv4 addresses (checked against Node 24's BlockList).
for (const [net, prefix] of [
  ["::", 96], ["::", 128], ["::1", 128], ["64:ff9b::", 96], ["64:ff9b:1::", 48], ["100::", 64],
  ["2001::", 23], ["2001:db8::", 32], ["2002::", 16], ["fc00::", 7], ["fe80::", 10], ["fec0::", 10], ["ff00::", 8],
] as const) blocked.addSubnet(net, prefix, "ipv6");

export class FetchError extends Error {}

export function isBlockedAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return blocked.check(address, "ipv4");
  if (family === 6) return blocked.check(address, "ipv6");
  return true;
}

// Validates the address at connect time, so a DNS answer cannot change between check and connect.
const safeLookup: LookupFunction = (hostname, options, callback) => {
  lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, "", 0);
    const list = addresses as unknown as { address: string; family: number }[];
    const bad = list.find((a) => isBlockedAddress(a.address));
    if (bad || list.length === 0) {
      return callback(new FetchError("That address points to a private or reserved network."), "", 0);
    }
    if ((options as { all?: boolean }).all) return (callback as unknown as (e: null, a: typeof list) => void)(null, list);
    callback(null, list[0]!.address, list[0]!.family);
  });
};

export function checkUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new FetchError("That is not a valid URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new FetchError("Only http and https URLs are allowed.");
  if (url.username || url.password) throw new FetchError("URLs with credentials are not allowed.");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  // IP literals skip DNS lookup, so check them here.
  if (isIP(host) && isBlockedAddress(host)) throw new FetchError("That address points to a private or reserved network.");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal")) {
    throw new FetchError("That address points to a private or reserved network.");
  }
  return url;
}

export type FetchedPage = { url: string; contentType: string; body: string };

const PAGE_HEADERS = {
  "user-agent": "HalochimeBot/0.1 (+knowledge import)",
  accept: "text/html,application/xhtml+xml,text/plain,text/markdown;q=0.9,*/*;q=0.1",
  "accept-encoding": "gzip, deflate, br",
};

type RequestInit = { method: "GET" | "POST"; headers: Record<string, string>; body?: string; maxBytes: number };

function requestOnce(
  url: URL,
  signal: AbortSignal,
  init: RequestInit = { method: "GET", headers: PAGE_HEADERS, maxBytes: MAX_BYTES },
): Promise<{ status: number; location?: string; contentType: string; body: Buffer }> {
  const mod = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const req = mod.request(
      url,
      {
        method: init.method,
        lookup: safeLookup,
        signal,
        headers: init.body === undefined ? init.headers : { ...init.headers, "content-length": String(Buffer.byteLength(init.body)) },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          return resolve({ status, location: res.headers.location, contentType: "", body: Buffer.alloc(0) });
        }
        const encoding = String(res.headers["content-encoding"] ?? "").toLowerCase();
        const stream =
          encoding === "gzip" ? res.pipe(zlib.createGunzip())
          : encoding === "deflate" ? res.pipe(zlib.createInflate())
          : encoding === "br" ? res.pipe(zlib.createBrotliDecompress())
          : res;
        const parts: Buffer[] = [];
        let size = 0;
        stream.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > init.maxBytes) {
            req.destroy(new FetchError(`The response is larger than ${Math.round(init.maxBytes / 1024)} KB.`));
            return;
          }
          parts.push(chunk);
        });
        stream.on("end", () =>
          resolve({ status, contentType: String(res.headers["content-type"] ?? ""), body: Buffer.concat(parts) }),
        );
        stream.on("error", reject);
      },
    );
    req.on("error", reject);
    req.end(init.body);
  });
}

/**
 * GETs a public web page with SSRF protection, a 10 s timeout, a 2 MB cap and at most 3 checked redirects.
 * `signal` lets a caller with an overall time budget (e.g. a site import) stop it sooner; it never extends the 10 s.
 */
export async function safeFetch(raw: string, opts: { signal?: AbortSignal } = {}): Promise<FetchedPage> {
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  const signal = opts.signal ? AbortSignal.any([timeout, opts.signal]) : timeout;
  let url = checkUrl(raw);
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const res = await requestOnce(url, signal);
      if (res.location) {
        url = checkUrl(new URL(res.location, url).toString());
        continue;
      }
      if (res.status < 200 || res.status >= 300) throw new FetchError(`The page answered with HTTP ${res.status}.`);
      return { url: url.toString(), contentType: res.contentType, body: res.body.toString("utf8") };
    }
  } catch (err) {
    if (err instanceof FetchError) throw err;
    if (opts.signal?.aborted) throw new FetchError("Stopped: the import ran out of time.");
    if (signal.aborted) throw new FetchError("The page took longer than 10 seconds.");
    throw new FetchError(`Could not fetch the page: ${(err as Error).message}`);
  }
  throw new FetchError("Too many redirects.");
}

export type SafeResponse = { url: string; status: number; contentType: string; body: string };

/**
 * Calls a business's HTTP endpoint (actions, webhooks) with the same SSRF protection as safeFetch.
 * Returns any status instead of throwing on 4xx/5xx; throws FetchError for network errors and timeouts.
 * GET follows up to 3 checked redirects; POST never follows redirects (the body would be lost or replayed).
 */
export async function safeRequest(
  raw: string,
  opts: {
    method: "GET" | "POST";
    headers?: Record<string, string>;
    body?: string;
    timeoutMs?: number;
    maxBytes?: number;
    signal?: AbortSignal;
  },
): Promise<SafeResponse> {
  const timeoutMs = opts.timeoutMs ?? TIMEOUT_MS;
  const timeout = AbortSignal.timeout(timeoutMs);
  const signal = opts.signal ? AbortSignal.any([timeout, opts.signal]) : timeout;
  const init: RequestInit = {
    method: opts.method,
    headers: { "user-agent": "Halochime/1 (+https://halochime.vercel.app)", "accept-encoding": "gzip, deflate, br", ...opts.headers },
    body: opts.body,
    maxBytes: opts.maxBytes ?? 256 * 1024,
  };
  let url = checkUrl(raw);
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const res = await requestOnce(url, signal, init);
      if (res.location && opts.method === "GET") {
        url = checkUrl(new URL(res.location, url).toString());
        continue;
      }
      return { url: url.toString(), status: res.status, contentType: res.contentType, body: res.body.toString("utf8") };
    }
  } catch (err) {
    if (err instanceof FetchError) throw err;
    if (signal.aborted) throw new FetchError(`No answer within ${Math.round(timeoutMs / 1000)} seconds.`);
    throw new FetchError(`Could not reach the URL: ${(err as Error).message}`);
  }
  throw new FetchError("Too many redirects.");
}
