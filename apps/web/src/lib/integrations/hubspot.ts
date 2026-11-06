import type { CrmClient, CrmContact, LeadFields } from "./crm";
import { obj, requestJson, s, VendorError, type FetchLike } from "./http";

// HubSpot CRM v3 with a private app access token (scopes crm.objects.contacts.read / .write).

const BASE = "https://api.hubapi.com";
const PROPS = ["firstname", "lastname", "email", "phone", "mobilephone", "company", "lifecyclestage"];
/** HubSpot-defined association type: note -> contact. */
const NOTE_TO_CONTACT = 202;

function toContact(raw: unknown): CrmContact | null {
  const r = obj(raw);
  const p = obj(r.properties);
  const id = s(r.id) ?? (typeof r.id === "number" ? String(r.id) : undefined);
  if (!id) return null;
  return {
    id,
    firstName: s(p.firstname),
    lastName: s(p.lastname),
    email: s(p.email),
    phone: s(p.phone) ?? s(p.mobilephone),
    company: s(p.company),
    stage: s(p.lifecyclestage),
  };
}

function toProps(f: LeadFields): Record<string, string> {
  const out: Record<string, string> = {};
  if (f.email) out.email = f.email;
  if (f.phone) out.phone = f.phone;
  if (f.firstName) out.firstname = f.firstName;
  if (f.lastName) out.lastname = f.lastName;
  if (f.company) out.company = f.company;
  return out;
}

export function hubspotClient(accessToken: string, fetchImpl: FetchLike = fetch): CrmClient {
  const headers = { authorization: `Bearer ${accessToken}` };
  const call = (path: string, init: { method?: string; body?: unknown; allow?: number[] } = {}) =>
    requestJson(fetchImpl, `${BASE}${path}`, { ...init, headers, vendor: "HubSpot" });

  const client: CrmClient = {
    label: "HubSpot",
    async findContact(q) {
      const filterGroups = q.email
        ? [{ filters: [{ propertyName: "email", operator: "EQ", value: q.email }] }]
        : q.phone
          ? [
              { filters: [{ propertyName: "phone", operator: "EQ", value: q.phone }] },
              { filters: [{ propertyName: "mobilephone", operator: "EQ", value: q.phone }] },
            ]
          : [];
      if (!filterGroups.length) return null;
      const res = await call("/crm/v3/objects/contacts/search", { method: "POST", body: { filterGroups, properties: PROPS, limit: 1 } });
      const results = obj(res.body).results;
      return Array.isArray(results) && results.length ? toContact(results[0]) : null;
    },
    async createLead(fields) {
      const res = await call("/crm/v3/objects/contacts", {
        method: "POST",
        body: { properties: { ...toProps(fields), lifecyclestage: "lead" } },
        allow: [409],
      });
      if (res.status === 409) {
        // Created in the meantime (same email): use that one.
        const again = fields.email ? await client.findContact({ email: fields.email }) : null;
        if (again) return again;
        throw new VendorError("HubSpot says this contact already exists.", 409);
      }
      const c = toContact(res.body);
      if (!c) throw new VendorError("HubSpot did not return the new contact.");
      return c;
    },
    async updateContact(contact, fields) {
      const properties = toProps(fields);
      if (!Object.keys(properties).length) return;
      await call(`/crm/v3/objects/contacts/${encodeURIComponent(contact.id)}`, { method: "PATCH", body: { properties } });
    },
    async addNote(contact, text) {
      await call("/crm/v3/objects/notes", {
        method: "POST",
        body: {
          properties: { hs_timestamp: new Date().toISOString(), hs_note_body: text },
          associations: [{ to: { id: contact.id }, types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: NOTE_TO_CONTACT }] }],
        },
      });
    },
    async test() {
      await call("/crm/v3/objects/contacts?limit=1&properties=email");
    },
  };
  return client;
}
