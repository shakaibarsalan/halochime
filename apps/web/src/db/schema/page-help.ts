import { boolean, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { DEFAULT_PROACTIVE_HELP, type ProactiveHelpSettings } from "@talkfront/shared";
import { agents, conversations } from "./app";
import { organization } from "./auth";

/**
 * Page help settings per agent (packages/shared/src/page-help.ts). No row = both features off, so
 * existing agents behave exactly as before.
 */
export const agentPageHelp = pgTable("agent_page_help", {
  agentId: text("agent_id")
    .primaryKey()
    .references(() => agents.id, { onDelete: "cascade" }),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" }),
  /** The help bubble: on/off, page rules and the default offerHelp() message. */
  proactive: jsonb("proactive").$type<ProactiveHelpSettings>().notNull().default(DEFAULT_PROACTIVE_HELP),
  /** Page guide: the agent sees the page's buttons and links and can point at them. */
  pageGuide: boolean("page_guide").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

/** A conversation the visitor opened from the help bubble: what the bubble said and why it showed. */
export const conversationHelpOffers = pgTable("conversation_help_offers", {
  conversationId: text("conversation_id")
    .primaryKey()
    .references(() => conversations.id, { onDelete: "cascade" }),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" }),
  /** "rule" or "api" (Halochime.offerHelp). */
  source: text("source").notNull(),
  reason: text("reason"),
  message: text("message").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
