import { sql } from "drizzle-orm";
import { boolean, index, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import type { DbQueryParameter, IntegrationConfig } from "../../lib/integrations/types";
import { organization } from "./auth";

// Workspace integrations: CRMs, calendars and a database the agent can use as tools.
// Spec: docs/integrations.md section 6. Each business brings its own credentials.

export const integrationKind = pgEnum("integration_kind", ["hubspot", "gohighlevel", "zoho", "calcom", "booking_link", "database"]);

/** One connected service per kind per workspace. */
export const integrations = pgTable(
  "integrations",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    kind: integrationKind("kind").notNull(),
    /** Settings that are not secret (location id, data centre, event type, booking URL, SQL dialect...). */
    config: jsonb("config").$type<IntegrationConfig>().notNull().default({}),
    /** Credentials as encrypted JSON (lib/actions/crypto.ts, info "talkfront-integration-secrets", row id as AAD). */
    secretsEncrypted: text("secrets_encrypted"),
    /** What the dashboard may show about the credentials, e.g. "ends in 4f2a" or a database host. */
    secretHint: text("secret_hint"),
    /** Agents that may use it. Empty = none. */
    agentIds: text("agent_ids").array().notNull().default(sql`'{}'::text[]`),
    /** CRMs only: add each finished conversation's summary as a note on the contact. */
    logConversations: boolean("log_conversations").notNull().default(false),
    lastTestedAt: timestamp("last_tested_at", { withTimezone: true }),
    lastTestOk: boolean("last_test_ok"),
    lastTestMessage: text("last_test_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex("integrations_org_kind_uq").on(t.organizationId, t.kind)],
);

/** Owner-defined read-only queries of a database integration. Each one is a tool. */
export const integrationQueries = pgTable(
  "integration_queries",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    integrationId: text("integration_id")
      .notNull()
      .references(() => integrations.id, { onDelete: "cascade" }),
    /** Tool name the model sees (same rules as action names). */
    name: text("name").notNull(),
    /** When to use it, for the AI. */
    description: text("description").notNull(),
    /** One SELECT or WITH statement with :name placeholders. */
    sql: text("sql").notNull(),
    parameters: jsonb("parameters").$type<DbQueryParameter[]>().notNull().default([]),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index("integration_queries_org_idx").on(t.organizationId),
    uniqueIndex("integration_queries_integration_name_uq").on(t.integrationId, t.name),
  ],
);
