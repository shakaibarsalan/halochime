import { z } from "zod";

// Pure definitions for workspace integrations (no server imports): kinds, settings, credentials and
// the dashboard labels. Spec: docs/integrations.md section 6.

export const INTEGRATION_KINDS = ["hubspot", "gohighlevel", "zoho", "calcom", "booking_link", "database"] as const;
export type IntegrationKind = (typeof INTEGRATION_KINDS)[number];

export const CRM_KINDS = ["hubspot", "gohighlevel", "zoho"] as const;
export type CrmKind = (typeof CRM_KINDS)[number];
export const isCrmKind = (k: string): k is CrmKind => (CRM_KINDS as readonly string[]).includes(k);

export const KIND_LABELS: Record<IntegrationKind, string> = {
  hubspot: "HubSpot",
  gohighlevel: "GoHighLevel",
  zoho: "Zoho CRM",
  calcom: "Cal.com",
  booking_link: "Booking link",
  database: "Database",
};

/** Zoho data centres: accounts.zoho.<dc> and www.zohoapis.<dc>. */
export const ZOHO_DATA_CENTRES = ["com", "eu", "in", "com.au", "jp", "ca", "com.cn", "sa", "uk"] as const;
export type ZohoDataCentre = (typeof ZOHO_DATA_CENTRES)[number];

export const DB_DIALECTS = ["postgres", "mysql"] as const;
export type DbDialect = (typeof DB_DIALECTS)[number];

export const MAX_QUERIES = 20;
export const MAX_QUERY_SQL = 5000;

/** True when the IANA time zone name is known to this runtime, e.g. "Europe/London". */
export function isTimeZone(tz: string): boolean {
  if (!tz || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const trimmed = (max: number) => z.string().trim().max(max);

/** Non-secret settings per kind (stored as plain JSON in integrations.config). */
export const ConfigSchemas = {
  hubspot: z.object({}),
  gohighlevel: z.object({
    locationId: trimmed(100).regex(/^[A-Za-z0-9_-]{4,100}$/, "Location id: letters and numbers only, as shown in GoHighLevel."),
  }),
  zoho: z.object({ dataCentre: z.enum(ZOHO_DATA_CENTRES) }),
  calcom: z.object({
    eventTypeId: z.number().int().positive("Event type id: a whole number from the event type's URL."),
    timeZone: trimmed(64).refine(isTimeZone, "Time zone: use a name like Europe/London or America/New_York."),
  }),
  booking_link: z.object({
    url: trimmed(2048).url("Booking link: enter a full https:// address.").refine((u) => u.startsWith("https://"), "Booking link: it must start with https://."),
    label: trimmed(80).default(""),
  }),
  database: z.object({ dialect: z.enum(DB_DIALECTS), ssl: z.boolean() }),
} satisfies Record<IntegrationKind, z.ZodType>;

/** Credentials per kind (stored encrypted, never sent back to the browser). */
export const SecretSchemas = {
  hubspot: z.object({ accessToken: trimmed(500).min(10, "Paste the private app access token.") }),
  gohighlevel: z.object({ token: trimmed(500).min(10, "Paste the private integration token.") }),
  zoho: z.object({
    clientId: trimmed(200).min(5, "Paste the client id."),
    clientSecret: trimmed(200).min(5, "Paste the client secret."),
    refreshToken: trimmed(500).min(10, "Paste the refresh token."),
  }),
  calcom: z.object({ apiKey: trimmed(300).min(10, "Paste the Cal.com API key.") }),
  booking_link: z.object({}),
  database: z.object({ connectionString: trimmed(2000).min(10, "Paste the connection string.") }),
} satisfies Record<IntegrationKind, z.ZodType>;

export type ConfigFor<K extends IntegrationKind> = z.infer<(typeof ConfigSchemas)[K]>;
export type SecretsFor<K extends IntegrationKind> = z.infer<(typeof SecretSchemas)[K]>;
/** Stored shape of integrations.config (one of the kinds above). */
export type IntegrationConfig = Record<string, unknown>;

/** Names of the credential fields per kind, for the dashboard (labels and which ones are secret). */
export const SECRET_FIELDS: Record<IntegrationKind, { key: string; label: string; hint?: string }[]> = {
  hubspot: [{ key: "accessToken", label: "Private app access token", hint: "HubSpot: Settings, Integrations, Private apps. Scopes: crm.objects.contacts.read and .write." }],
  gohighlevel: [{ key: "token", label: "Private integration token", hint: "GoHighLevel: Settings, Private integrations. Scopes: contacts read and write." }],
  zoho: [
    { key: "clientId", label: "Client id" },
    { key: "clientSecret", label: "Client secret" },
    { key: "refreshToken", label: "Refresh token", hint: "From a Self Client in the Zoho API console, scope ZohoCRM.modules.ALL." },
  ],
  calcom: [{ key: "apiKey", label: "API key", hint: "Cal.com: Settings, Developer, API keys." }],
  booking_link: [],
  database: [
    {
      key: "connectionString",
      label: "Connection string",
      hint: "e.g. postgres://user:password@host:5432/dbname. Use a user that can only read.",
    },
  ],
};

/** One input of a database query. `verifiedUserId` inputs are filled from the signed-in visitor, never by the AI. */
export const DbQueryParameter = z.object({
  name: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
  type: z.enum(["string", "number", "integer", "boolean"]),
  description: z.string().max(300),
  required: z.boolean(),
  verifiedUserId: z.boolean().optional(),
});
export type DbQueryParameter = z.infer<typeof DbQueryParameter>;

/** "ends in 4f2a" for a token; never more than the last 4 characters. */
export function lastFour(value: string): string {
  const v = value.trim();
  return v.length >= 12 ? `ends in ${v.slice(-4)}` : "saved";
}
