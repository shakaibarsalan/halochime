import type { RunActionResponse } from "@talkfront/shared";
import { VendorError } from "./http";

// What the three CRM tools do, on top of a small client per CRM (hubspot.ts, gohighlevel.ts, zoho.ts).
// Pure apart from the client's own fetch, so it is checked with mock fetches.

export type ContactQuery = { email?: string; phone?: string };

export type CrmContact = {
  id: string;
  /** Zoho only: which module the record is in. */
  module?: "Leads" | "Contacts";
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  company?: string;
  /** Lifecycle stage / lead status, as the CRM names it. */
  stage?: string;
};

export type LeadFields = { email?: string; phone?: string; firstName?: string; lastName?: string; company?: string };

export interface CrmClient {
  readonly label: string;
  findContact(q: ContactQuery): Promise<CrmContact | null>;
  createLead(fields: LeadFields): Promise<CrmContact>;
  /** Sets only the given fields. */
  updateContact(contact: CrmContact, fields: LeadFields): Promise<void>;
  addNote(contact: CrmContact, text: string): Promise<void>;
  /** Throws VendorError when the credentials or settings don't work. */
  test(): Promise<void>;
}

/** The visitor as the web app knows them. `email` and `name` count only when `verified`. */
export type VisitorContext = { verified: boolean; email: string | null; name: string | null };

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;
const MAX_FIELD = 200;
export const MAX_NOTE = 5000;

const clean = (v: unknown, max = MAX_FIELD): string | undefined => {
  if (typeof v !== "string" && typeof v !== "number") return undefined;
  const t = String(v).replace(/\s+/g, " ").trim();
  return t ? t.slice(0, max) : undefined;
};

export function normalizeEmail(v: unknown): string | undefined {
  const t = clean(v, 320)?.toLowerCase();
  return t && EMAIL_RE.test(t) ? t : undefined;
}

/** Keeps a leading + and the digits; at least 6 digits. */
export function normalizePhone(v: unknown): string | undefined {
  const t = clean(v, 50);
  if (!t) return undefined;
  const digits = t.replace(/\D/g, "");
  if (digits.length < 6 || digits.length > 15) return undefined;
  return `${t.startsWith("+") ? "+" : ""}${digits}`;
}

export type QueryCheck = { ok: true; query: ContactQuery } | { ok: false; reason: string };

/** Email / phone from the AI's arguments, falling back to the verified visitor's email. */
export function contactQueryFrom(args: Record<string, unknown>, visitor: VisitorContext): QueryCheck {
  const rawEmail = clean(args.email, 320);
  const rawPhone = clean(args.phone, 50);
  const email = normalizeEmail(rawEmail);
  const phone = normalizePhone(rawPhone);
  if (rawEmail && !email) return { ok: false, reason: "That email address doesn't look right. Ask the visitor to spell it again." };
  if (rawPhone && !phone) return { ok: false, reason: "That phone number doesn't look right. Ask the visitor for it again, with the country code." };
  if (email || phone) return { ok: true, query: { ...(email ? { email } : {}), ...(phone ? { phone } : {}) } };
  const own = visitor.verified ? normalizeEmail(visitor.email) : undefined;
  if (own) return { ok: true, query: { email: own } };
  return { ok: false, reason: "Ask the visitor for their email address or phone number first." };
}

/** Only fields that are empty in the CRM: an existing contact's details are never overwritten. */
export function missingFields(contact: CrmContact, wanted: LeadFields): LeadFields {
  const out: LeadFields = {};
  for (const key of ["email", "phone", "firstName", "lastName", "company"] as const) {
    if (wanted[key] && !contact[key]) out[key] = wanted[key];
  }
  return out;
}

const FIELD_WORDS: Record<keyof LeadFields, string> = {
  email: "email",
  phone: "phone",
  firstName: "first name",
  lastName: "last name",
  company: "company",
};

function splitName(name: string | null): { firstName?: string; lastName?: string } {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return {};
  return { firstName: parts[0]!.slice(0, MAX_FIELD), ...(parts.length > 1 ? { lastName: parts.slice(1).join(" ").slice(0, MAX_FIELD) } : {}) };
}

const ok = (result: string): RunActionResponse => ({ ok: true, status: 200, result });
const fail = (result: string, status: number | null = null): RunActionResponse => ({ ok: false, status, result });

function vendorFail(err: unknown, label: string): RunActionResponse {
  if (err instanceof VendorError) return fail(err.message, err.status);
  return fail(`${label} could not be reached because of an unexpected error.`);
}

async function findBy(client: CrmClient, q: ContactQuery): Promise<CrmContact | null> {
  if (q.email) {
    const byEmail = await client.findContact({ email: q.email });
    if (byEmail) return byEmail;
  }
  if (q.phone) return client.findContact({ phone: q.phone });
  return null;
}

/**
 * find_contact. Only the verified visitor's own record comes back in full; for any other email or
 * phone the AI only learns whether a contact exists, so a visitor can't read other people's details.
 */
export async function runFindContact(client: CrmClient, args: Record<string, unknown>, visitor: VisitorContext): Promise<RunActionResponse> {
  const q = contactQueryFrom(args, visitor);
  if (!q.ok) return fail(q.reason);
  try {
    const c = await findBy(client, q.query);
    if (!c) return ok(`No contact with that ${q.query.email ? "email" : "phone number"} in ${client.label} yet.`);
    const own = visitor.verified && !!q.query.email && normalizeEmail(visitor.email) === q.query.email;
    if (!own) return ok(`Yes, this person is already a contact in ${client.label} (id ${c.id}).`);
    const details = {
      id: c.id,
      name: [c.firstName, c.lastName].filter(Boolean).join(" ") || undefined,
      email: c.email,
      phone: c.phone,
      company: c.company,
      stage: c.stage,
    };
    return ok(JSON.stringify({ found: true, ...details }));
  } catch (err) {
    return vendorFail(err, client.label);
  }
}

/** save_lead: creates a lead, or fills in the empty fields of an existing contact. */
export async function runSaveLead(client: CrmClient, args: Record<string, unknown>, visitor: VisitorContext): Promise<RunActionResponse> {
  const q = contactQueryFrom(args, visitor);
  if (!q.ok) return fail(q.reason);
  const fromName = visitor.verified ? splitName(visitor.name) : {};
  const fields: LeadFields = {
    ...(q.query.email ? { email: q.query.email } : {}),
    ...(q.query.phone ? { phone: q.query.phone } : {}),
    firstName: clean(args.first_name) ?? fromName.firstName,
    lastName: clean(args.last_name) ?? (clean(args.first_name) ? undefined : fromName.lastName),
    company: clean(args.company),
  };
  for (const k of Object.keys(fields) as (keyof LeadFields)[]) if (!fields[k]) delete fields[k];
  try {
    const existing = await findBy(client, q.query);
    if (!existing) {
      const created = await client.createLead(fields);
      return ok(`Saved as a new lead in ${client.label} (id ${created.id}).`);
    }
    const add = missingFields(existing, fields);
    const names = (Object.keys(add) as (keyof LeadFields)[]).map((k) => FIELD_WORDS[k]);
    if (!names.length) return ok(`This person is already a contact in ${client.label} (id ${existing.id}). Nothing new to add.`);
    await client.updateContact(existing, add);
    return ok(`This person is already a contact in ${client.label} (id ${existing.id}). Added the missing ${names.join(", ")}.`);
  } catch (err) {
    return vendorFail(err, client.label);
  }
}

/** add_note: adds a note to an existing contact. */
export async function runAddNote(client: CrmClient, args: Record<string, unknown>, visitor: VisitorContext, mode: "voice" | "text"): Promise<RunActionResponse> {
  const note = typeof args.note === "string" ? args.note.trim().slice(0, MAX_NOTE) : "";
  if (!note) return fail("Write the note first, then try again.");
  const q = contactQueryFrom(args, visitor);
  if (!q.ok) return fail(q.reason);
  try {
    const c = await findBy(client, q.query);
    if (!c) return fail(`No contact with that ${q.query.email ? "email" : "phone number"} in ${client.label} yet. Save them as a lead first.`);
    await client.addNote(c, `Note from a Halochime ${mode === "voice" ? "call" : "chat"}:\n${note}`);
    return ok(`Note added to the contact in ${client.label}.`);
  } catch (err) {
    return vendorFail(err, client.label);
  }
}

/** After a conversation: find or create the contact, then add the summary as a note. Throws VendorError. */
export async function logSummary(
  client: CrmClient,
  details: { email?: string; phone?: string; name: string | null; summary: string; heading: string },
): Promise<"created" | "existing" | "skipped"> {
  const email = normalizeEmail(details.email);
  const phone = normalizePhone(details.phone);
  if (!email && !phone) return "skipped";
  let contact = await findBy(client, { email, phone });
  let outcome: "created" | "existing" = "existing";
  if (!contact) {
    contact = await client.createLead({ ...(email ? { email } : {}), ...(phone ? { phone } : {}), ...splitName(details.name) });
    outcome = "created";
  }
  await client.addNote(contact, `${details.heading}\n${details.summary}`.slice(0, MAX_NOTE));
  return outcome;
}
