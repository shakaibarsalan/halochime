import { sql } from "drizzle-orm";
import { boolean, index, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { organization } from "./auth";
import { agents } from "./app";

// Channels: the same agent answering outside the website (phone calls, WhatsApp).
// One row per agent and kind, made the first time an owner or admin saves it. Off by default.

export const channelKind = pgEnum("channel_kind", ["phone", "whatsapp"]);

/** Phone (LiveKit SIP): what was created in LiveKit for this number. No secrets here. */
export type PhoneChannelConfig = {
  /** LiveKit inbound trunk id (ST_...), null until created. */
  trunkId: string | null;
  /** LiveKit dispatch rule id (SDR_...), null until created. */
  dispatchRuleId: string | null;
  /** Where the number lives, for the setup steps shown to the owner. */
  provider: "twilio" | "other";
  /** Username the provider must send when auth is on (the password is in secretsEncrypted). */
  authUsername: string | null;
  /** IP addresses or CIDR ranges allowed to send calls; empty = any. */
  allowedAddresses: string[];
};

/** WhatsApp Business Cloud API (Meta). Ids only; tokens are in secretsEncrypted. */
export type WhatsappChannelConfig = {
  /** Meta "Phone number ID" (digits). */
  phoneNumberId: string;
  /** Voice notes get a voice note back (on by default when the channel is set up). */
  replyWithVoice: boolean;
};

/** Last 4 characters of each stored secret, so the dashboard can say "saved (...abcd)". */
export type ChannelSecretHints = Record<string, string>;

export const agentChannels = pgTable(
  "agent_channels",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    agentId: text("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    kind: channelKind("kind").notNull(),
    enabled: boolean("enabled").notNull().default(false),
    /**
     * What identifies the channel outside: phone = the business number in E.164 (+15551234567),
     * whatsapp = Meta's phone number id. Unique per kind, so two agents can't claim one number.
     */
    externalId: text("external_id"),
    /** Non-secret settings: PhoneChannelConfig or WhatsappChannelConfig. */
    config: jsonb("config").$type<PhoneChannelConfig | WhatsappChannelConfig>().notNull(),
    /**
     * Encrypted JSON (lib/actions/crypto.ts, CHANNEL_INFO, bound to this row id):
     * phone {authPassword?}, whatsapp {accessToken, appSecret, verifyToken}. Never sent to the browser.
     */
    secretsEncrypted: text("secrets_encrypted"),
    secretHints: jsonb("secret_hints").$type<ChannelSecretHints>().notNull().default({}),
    /** Last message or call seen on this channel, and the last problem, for the dashboard. */
    lastEventAt: timestamp("last_event_at", { withTimezone: true }),
    lastError: text("last_error"),
    lastErrorAt: timestamp("last_error_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index("agent_channels_org_idx").on(t.organizationId),
    uniqueIndex("agent_channels_agent_kind_uq").on(t.agentId, t.kind),
    uniqueIndex("agent_channels_kind_external_uq").on(t.kind, t.externalId).where(sql`${t.externalId} is not null`),
  ],
);

/**
 * Inbound messages already handled, so a webhook Meta sends again (it retries until it gets a 200,
 * and sometimes sends twice anyway) is answered once. Rows older than a few days can be deleted.
 */
export const channelInbound = pgTable(
  "channel_inbound",
  {
    channelId: text("channel_id")
      .notNull()
      .references(() => agentChannels.id, { onDelete: "cascade" }),
    /** The provider's message id (WhatsApp wamid...). */
    externalMessageId: text("external_message_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("channel_inbound_uq").on(t.channelId, t.externalMessageId),
    index("channel_inbound_created_idx").on(t.createdAt),
  ],
);
