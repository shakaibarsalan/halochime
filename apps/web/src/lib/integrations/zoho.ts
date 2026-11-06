import { createHash } from "node:crypto";
import type { CrmClient, CrmContact, LeadFields } from "./crm";
import { obj, requestJson, s, VendorError, type FetchLike } from "./http";
import type { ZohoDataCentre } from "./types";

// Zoho CRM API v7. A Self Client's refresh token is exchanged for short-lived access tokens, which are
// cached in memory (per server instance) for at most 45 minutes. Zoho limits how many access tokens one
// refresh token may create in ten minutes, so the cache matters.

const VERSION = "v7";
const MAX_CACHE_MS = 45 * 60_000;
const tokenCache = new Map<string, { token: string; expiresAt: number }>();

export type ZohoCredentials = { clientId: string; clientSecret: string; refreshToken: string; dataCentre: ZohoDataCentre };

const FIELDS: Record<"Leads" | "Contacts", string> = {
  Leads: "First_Name,Last_Name,Email,Phone,Mobile,Company,Lead_Status",
  Contacts: "First_Name,Last_Name,Email,Phone,Mobile,Account_Name",
};

function cacheKey(c: ZohoCredentials): string {
  return createHash("sha256").update(`${c.dataCentre}\u0000${c.clientId}\u0000${c.refreshToken}`).digest("base64url");
}

/** For checks: forget every cached token. */
export function clearZohoTokenCache() {
  tokenCache.clear();
}

function toContact(raw: unknown, module: "Leads" | "Contacts"): CrmContact | null {
  const r = obj(raw);
  const id = s(r.id) ?? (typeof r.id === "number" ? String(r.id) : undefined);
  if (!id) return null;
  const account = obj(r.Account_Name);
  return {
    id,
    module,
    firstName: s(r.First_Name),
    lastName: s(r.Last_Name),
    email: s(r.Email),
    phone: s(r.Phone) ?? s(r.Mobile),
    company: s(r.Company) ?? s(account.name),
    stage: module === "Leads" ? (s(r.Lead_Status) ?? "Lead") : "Contact",
  };
}

function toRecord(f: LeadFields, module: "Leads" | "Contacts"): Record<string, string> {
  const out: Record<string, string> = {};
  if (f.email) out.Email = f.email;
  if (f.phone) out.Phone = f.phone;
  if (f.firstName) out.First_Name = f.firstName;
  if (f.lastName) out.Last_Name = f.lastName;
  // Contacts link to an Account record instead of a company name; leave it alone there.
  if (f.company && module === "Leads") out.Company = f.company;
  return out;
}

/** Zoho answers record writes with 200/201 and a per-record code; anything but SUCCESS is a failure. */
function recordResult(body: unknown): { id?: string } {
  const first = obj(Array.isArray(obj(body).data) ? (obj(body).data as unknown[])[0] : undefined);
  if (s(first.code) !== "SUCCESS") {
    const msg = s(first.message) ?? s(first.code) ?? "unknown error";
    throw new VendorError(`Zoho CRM refused the record (${msg.slice(0, 160)}).`);
  }
  const details = obj(first.details);
  return { id: s(details.id) ?? (typeof details.id === "number" ? String(details.id) : undefined) };
}

export function zohoClient(creds: ZohoCredentials, fetchImpl: FetchLike = fetch, now: () => number = Date.now): CrmClient {
  const key = cacheKey(creds);
  const api = `https://www.zohoapis.${creds.dataCentre}/crm/${VERSION}`;

  async function accessToken(fresh = false): Promise<string> {
    const cached = tokenCache.get(key);
    if (!fresh && cached && cached.expiresAt > now()) return cached.token;
    const res = await requestJson(fetchImpl, `https://accounts.zoho.${creds.dataCentre}/oauth/v2/token`, {
      method: "POST",
      form: {
        grant_type: "refresh_token",
        refresh_token: creds.refreshToken,
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
      },
      vendor: "Zoho",
    });
    const body = obj(res.body);
    const token = s(body.access_token);
    if (!token) {
      // Zoho reports a bad refresh token or client with HTTP 200 and an "error" field.
      const why = s(body.error) ?? "no access token";
      throw new VendorError(`Zoho refused the saved credentials (${why.slice(0, 80)}). Check the client id, secret, refresh token and data centre.`, 401);
    }
    const ttlSec = typeof body.expires_in === "number" ? body.expires_in : 3600;
    if (tokenCache.size > 500) tokenCache.clear();
    tokenCache.set(key, { token, expiresAt: now() + Math.min(MAX_CACHE_MS, Math.max(0, ttlSec - 300) * 1000) });
    return token;
  }

  async function call(path: string, init: { method?: string; body?: unknown; allow?: number[] } = {}) {
    const run = async (token: string) =>
      requestJson(fetchImpl, `${api}${path}`, { ...init, headers: { authorization: `Zoho-oauthtoken ${token}` }, vendor: "Zoho CRM" });
    try {
      return await run(await accessToken());
    } catch (err) {
      // A token revoked or expired early: get a new one once.
      if (err instanceof VendorError && err.status === 401) {
        tokenCache.delete(key);
        return run(await accessToken(true));
      }
      throw err;
    }
  }

  async function search(module: "Leads" | "Contacts", q: { email?: string; phone?: string }): Promise<CrmContact | null> {
    const params = new URLSearchParams({ fields: FIELDS[module], per_page: "1" });
    if (q.email) params.set("email", q.email);
    else if (q.phone) params.set("phone", q.phone);
    else return null;
    const res = await call(`/${module}/search?${params}`, { allow: [204] });
    if (res.status === 204) return null;
    const data = obj(res.body).data;
    return Array.isArray(data) && data.length ? toContact(data[0], module) : null;
  }

  return {
    label: "Zoho CRM",
    async findContact(q) {
      return (await search("Contacts", q)) ?? (await search("Leads", q));
    },
    async createLead(fields) {
      const record: Record<string, string> = { ...toRecord(fields, "Leads"), Lead_Source: "Chat" };
      // Last_Name and Company are required by Zoho's default Leads layout.
      if (!fields.lastName) {
        record.Last_Name = fields.firstName ?? "Unknown";
        delete record.First_Name;
      }
      record.Company ??= "Not given";
      const res = await call("/Leads", { method: "POST", body: { data: [record], trigger: ["workflow"] } });
      const { id } = recordResult(res.body);
      if (!id) throw new VendorError("Zoho CRM did not return the new lead.");
      return { id, module: "Leads", ...fields, stage: "Lead" };
    },
    async updateContact(contact, fields) {
      const module = contact.module ?? "Leads";
      const record = toRecord(fields, module);
      if (!Object.keys(record).length) return;
      const res = await call(`/${module}`, { method: "PUT", body: { data: [{ id: contact.id, ...record }] } });
      recordResult(res.body);
    },
    async addNote(contact, text) {
      const module = contact.module ?? "Leads";
      const res = await call(`/${module}/${encodeURIComponent(contact.id)}/Notes`, {
        method: "POST",
        body: { data: [{ Note_Title: "Halochime", Note_Content: text }] },
      });
      recordResult(res.body);
    },
    async test() {
      await search("Leads", { email: "connection-test@example.com" });
    },
  };
}
