import type { CrmClient, CrmContact, LeadFields } from "./crm";
import { obj, requestJson, s, VendorError, type FetchLike } from "./http";

// GoHighLevel (LeadConnector) API v2 with a private integration token and a location (sub-account) id.

const BASE = "https://services.leadconnectorhq.com";
const API_VERSION = "2021-07-28";

function toContact(raw: unknown): CrmContact | null {
  const c = obj(raw);
  const id = s(c.id);
  if (!id) return null;
  return {
    id,
    firstName: s(c.firstName),
    lastName: s(c.lastName),
    email: s(c.email),
    phone: s(c.phone),
    company: s(c.companyName),
    stage: s(c.type),
  };
}

function toBody(f: LeadFields): Record<string, string> {
  const out: Record<string, string> = {};
  if (f.email) out.email = f.email;
  if (f.phone) out.phone = f.phone;
  if (f.firstName) out.firstName = f.firstName;
  if (f.lastName) out.lastName = f.lastName;
  if (f.company) out.companyName = f.company;
  return out;
}

export function goHighLevelClient(token: string, locationId: string, fetchImpl: FetchLike = fetch): CrmClient {
  const headers = { authorization: `Bearer ${token}`, version: API_VERSION };
  const call = (path: string, init: { method?: string; body?: unknown } = {}) =>
    requestJson(fetchImpl, `${BASE}${path}`, { ...init, headers, vendor: "GoHighLevel" });

  return {
    label: "GoHighLevel",
    async findContact(q) {
      const params = new URLSearchParams({ locationId });
      if (q.email) params.set("email", q.email);
      else if (q.phone) params.set("number", q.phone);
      else return null;
      const res = await call(`/contacts/search/duplicate?${params}`);
      return toContact(obj(res.body).contact);
    },
    async createLead(fields) {
      const res = await call("/contacts/", {
        method: "POST",
        body: { locationId, ...toBody(fields), source: "Halochime", tags: ["halochime"] },
      });
      const c = toContact(obj(res.body).contact);
      if (!c) throw new VendorError("GoHighLevel did not return the new contact.");
      return c;
    },
    async updateContact(contact, fields) {
      const body = toBody(fields);
      if (!Object.keys(body).length) return;
      await call(`/contacts/${encodeURIComponent(contact.id)}`, { method: "PUT", body });
    },
    async addNote(contact, text) {
      await call(`/contacts/${encodeURIComponent(contact.id)}/notes`, { method: "POST", body: { body: text } });
    },
    async test() {
      // A read that needs the contacts scope and a valid location; finds nobody.
      await call(`/contacts/search/duplicate?${new URLSearchParams({ locationId, email: "connection-test@example.com" })}`);
    },
  };
}
