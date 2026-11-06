import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { organization, user } from "./auth";

/**
 * A workspace's cloned brand voice: an ElevenLabs instant voice clone made from the owner's own sample
 * with their consent. Agents use it as tts_voice "clone:<id>". Deleting the row also deletes the voice at
 * ElevenLabs (done by the app before the row goes). Limited to a few per workspace (MAX_VOICE_CLONES).
 */
export const voiceClones = pgTable(
  "voice_clones",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** "elevenlabs" for now. */
    provider: text("provider").notNull().default("elevenlabs"),
    /** The voice id at the provider. Not a secret, but never needed by the browser. */
    providerVoiceId: text("provider_voice_id").notNull(),
    /** Who confirmed they own the voice or have the speaker's permission, and when. */
    consentBy: text("consent_by").references(() => user.id, { onDelete: "set null" }),
    consentAt: timestamp("consent_at", { withTimezone: true }).notNull(),
    /** The consent sentence they agreed to, as shown. */
    consentText: text("consent_text").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("voice_clones_org_idx").on(t.organizationId)],
);
