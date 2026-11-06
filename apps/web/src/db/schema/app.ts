import { sql, type SQL } from "drizzle-orm";
import {
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  vector,
} from "drizzle-orm/pg-core";
import {
  EMBEDDING_DIMENSIONS,
  type ActionParameter,
  type CollectedData,
  type CollectField,
  type VisitorAttributes,
  type WidgetTheme,
} from "@talkfront/shared";
import { organization, user } from "./auth";
import { agentAbTests, agentVersions } from "./platform";

// Product tables. Better Auth owns ./auth.ts (user, session, organization, member, ...).
// A "workspace" in the UI is a Better Auth organization: one per business.

const id = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

const orgId = () =>
  text("organization_id")
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" });

const tsvector = customType<{ data: string }>({
  dataType() {
    return "tsvector";
  },
});

export const agentStatus = pgEnum("agent_status", ["draft", "published"]);
export const conversationMode = pgEnum("conversation_mode", ["voice", "text"]);
export const conversationStatus = pgEnum("conversation_status", ["active", "ended"]);
// "staff": a person from the business who took the conversation over (live inbox).
export const messageRole = pgEnum("message_role", ["user", "assistant", "tool", "system", "staff"]);
export const sourceType = pgEnum("knowledge_source_type", ["text", "url", "file"]);
export const sourceStatus = pgEnum("knowledge_source_status", [
  "pending",
  "processing",
  "ready",
  "failed",
]);
export const handoffStatus = pgEnum("handoff_status", ["open", "closed"]);
export const actionMethod = pgEnum("action_method", ["GET", "POST"]);
export const usageKind = pgEnum("usage_kind", ["trial", "topup", "voice_seconds", "text_session"]);
export const minuteRequestStatus = pgEnum("minute_request_status", ["open", "done", "replaced"]);

export const agents = pgTable(
  "agents",
  {
    id: id(),
    organizationId: orgId(),
    name: text("name").notNull(),
    status: agentStatus("status").notNull().default("draft"),
    /** Public key used by the embed snippet. Safe to show in page source. */
    publicKey: text("public_key").notNull().unique(),
    /** Hostnames allowed to start sessions, e.g. "example.com", "*.example.com". */
    allowedDomains: text("allowed_domains").array().notNull().default(sql`'{}'::text[]`),
    greeting: text("greeting").notNull(),
    persona: text("persona").notNull().default("a friendly, concise support agent"),
    /** Business rules and anything the owner wants the agent to always follow. */
    instructions: text("instructions").notNull().default(""),
    language: text("language").notNull().default("en"),
    modes: conversationMode("modes").array().notNull().default(sql`'{voice,text}'::conversation_mode[]`),
    sttModel: text("stt_model").notNull().default("nova-3"),
    llmModel: text("llm_model").notNull().default("openai/gpt-oss-20b"),
    temperature: real("temperature").notNull().default(0.4),
    ttsVoice: text("tts_voice").notNull().default("aura-2-thalia-en"),
    theme: jsonb("theme")
      .$type<WidgetTheme>()
      .notNull()
      .default({ color: "#4f46e5", position: "bottom-right", label: "Talk to us" }),
    handoffEnabled: boolean("handoff_enabled").notNull().default(true),
    handoffEmail: text("handoff_email"),
    maxDurationSec: integer("max_duration_sec").notNull().default(900),
    /**
     * Shared secret for identity tokens: the business's server signs the logged-in user with it
     * (HS256), so the agent knows who it is talking to. null = identity tokens not set up.
     */
    identitySecret: text("identity_secret"),
    /** Custom things to note from every conversation (the built-in ones are always collected). */
    collectFields: jsonb("collect_fields").$type<CollectField[]>().notNull().default([]),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("agents_org_idx").on(t.organizationId)],
);

/** The business's own picture for the widget icon (theme.icon "image"). One per agent. */
export const agentImages = pgTable("agent_images", {
  agentId: text("agent_id")
    .primaryKey()
    .references(() => agents.id, { onDelete: "cascade" }),
  /** image/png, image/jpeg or image/webp, checked from the file's own bytes on upload. */
  contentType: text("content_type").notNull(),
  /** The file, base64. Small (WIDGET_IMAGE_MAX_BYTES). */
  data: text("data").notNull(),
  updatedAt: updatedAt(),
});

export const knowledgeSources = pgTable(
  "knowledge_sources",
  {
    id: id(),
    organizationId: orgId(),
    /** null = shared by every agent in the workspace. */
    agentId: text("agent_id").references(() => agents.id, { onDelete: "cascade" }),
    type: sourceType("type").notNull(),
    title: text("title").notNull(),
    url: text("url"),
    status: sourceStatus("status").notNull().default("pending"),
    error: text("error"),
    charCount: integer("char_count").notNull().default(0),
    chunkCount: integer("chunk_count").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("knowledge_sources_org_idx").on(t.organizationId)],
);

export const knowledgeChunks = pgTable(
  "knowledge_chunks",
  {
    id: id(),
    sourceId: text("source_id")
      .notNull()
      .references(() => knowledgeSources.id, { onDelete: "cascade" }),
    organizationId: orgId(),
    position: integer("position").notNull(),
    content: text("content").notNull(),
    // 'simple' config: no English stemming, so Urdu/Arabic/Hindi text still matches word for word.
    tsv: tsvector("tsv").generatedAlwaysAs(
      (): SQL => sql`to_tsvector('simple', ${knowledgeChunks.content})`,
    ),
    /** Filled in the background by the embedder on the server; null until then (search falls back to text). */
    embedding: vector("embedding", { dimensions: EMBEDDING_DIMENSIONS }),
    /** Which model made `embedding`, so a model change can re-embed old chunks. */
    embeddingModel: text("embedding_model"),
    createdAt: createdAt(),
  },
  (t) => [
    index("knowledge_chunks_org_idx").on(t.organizationId),
    index("knowledge_chunks_source_idx").on(t.sourceId),
    index("knowledge_chunks_tsv_idx").using("gin", t.tsv),
    index("knowledge_chunks_embedding_idx").using("hnsw", t.embedding.op("vector_cosine_ops")),
  ],
);

export const conversations = pgTable(
  "conversations",
  {
    id: id(),
    organizationId: orgId(),
    agentId: text("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    mode: conversationMode("mode").notNull(),
    channel: text("channel").notNull().default("web"),
    status: conversationStatus("status").notNull().default("active"),
    visitorId: text("visitor_id"),
    visitorName: text("visitor_name"),
    visitorEmail: text("visitor_email"),
    /** true when name/email/attributes came from a valid identity token (the business vouches for them). */
    visitorVerified: boolean("visitor_verified").notNull().default(false),
    /** Extra facts from the identity token, e.g. { plan: "pro", orders: 3 }. */
    visitorAttributes: jsonb("visitor_attributes").$type<VisitorAttributes>(),
    pageUrl: text("page_url"),
    pageTitle: text("page_title"),
    roomName: text("room_name").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    durationSec: integer("duration_sec").notNull().default(0),
    endedReason: text("ended_reason"),
    summary: text("summary"),
    /** What was gathered, written with the summary when the conversation ends. null = not (yet) collected. */
    collectedData: jsonb("collected_data").$type<CollectedData>(),
    handoffRequested: boolean("handoff_requested").notNull().default(false),
    /**
     * Live inbox: the team member who has taken this conversation over from the AI (null = the AI has it).
     * Plain text, not a foreign key: the line stays readable if the member is removed later.
     */
    takenOverByUserId: text("taken_over_by_user_id"),
    takenOverByName: text("taken_over_by_name"),
    takenOverAt: timestamp("taken_over_at", { withTimezone: true }),
    /** The saved version this conversation ran with (A/B tests). null = the agent's own settings. */
    agentVersionId: text("agent_version_id").references(() => agentVersions.id, { onDelete: "set null" }),
    /** The A/B test that picked the version. */
    abTestId: text("ab_test_id").references(() => agentAbTests.id, { onDelete: "set null" }),
  },
  (t) => [
    index("conversations_org_started_idx").on(t.organizationId, t.startedAt.desc()),
    index("conversations_agent_idx").on(t.agentId),
    index("conversations_ab_test_idx").on(t.abTestId).where(sql`${t.abTestId} is not null`),
    // Open WhatsApp conversations per sender (lib/channels/whatsapp-inbound.ts) and their 24 h idle sweep.
    index("conversations_whatsapp_open_idx")
      .on(t.agentId, t.visitorId)
      .where(sql`${t.channel} = 'whatsapp' and ${t.status} = 'active'`),
  ],
);

export const messages = pgTable(
  "messages",
  {
    id: id(),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    role: messageRole("role").notNull(),
    content: text("content").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("messages_conversation_idx").on(t.conversationId, t.createdAt)],
);

export const handoffRequests = pgTable(
  "handoff_requests",
  {
    id: id(),
    organizationId: orgId(),
    conversationId: text("conversation_id").references(() => conversations.id, {
      onDelete: "set null",
    }),
    name: text("name"),
    email: text("email"),
    phone: text("phone"),
    message: text("message").notNull(),
    status: handoffStatus("status").notNull().default("open"),
    createdAt: createdAt(),
  },
  (t) => [
    index("handoff_requests_org_idx").on(t.organizationId, t.status),
    // Deleting a conversation unlinks (SET NULL) its rows; without this every delete scans the table.
    index("handoff_requests_conversation_idx").on(t.conversationId),
  ],
);

/** Prepaid voice time per workspace. New workspaces get a free trial balance. */
export const wallets = pgTable("wallets", {
  organizationId: text("organization_id")
    .primaryKey()
    .references(() => organization.id, { onDelete: "cascade" }),
  balanceSeconds: integer("balance_seconds").notNull().default(0),
  /** Last "minutes running low" email; cleared when the balance goes back up. */
  lowBalanceNotifiedAt: timestamp("low_balance_notified_at", { withTimezone: true }),
  updatedAt: updatedAt(),
});

/** Every change to a wallet. Negative seconds = usage, positive = trial or top-up. */
export const usageEvents = pgTable(
  "usage_events",
  {
    id: id(),
    organizationId: orgId(),
    conversationId: text("conversation_id").references(() => conversations.id, {
      onDelete: "set null",
    }),
    kind: usageKind("kind").notNull(),
    seconds: integer("seconds").notNull(),
    note: text("note"),
    createdAt: createdAt(),
  },
  (t) => [
    index("usage_events_org_idx").on(t.organizationId, t.createdAt),
    // Deleting a conversation unlinks (SET NULL) its usage rows; without this every delete scans the ledger.
    index("usage_events_conversation_idx").on(t.conversationId),
  ],
);

export const TRIAL_SECONDS = 30 * 60;

/**
 * Users who have had the free trial. Outlives the workspace that got it, so deleting a workspace and
 * making a new one doesn't give the trial again. Onboarding also checks for an owned workspace, which
 * covers trials given before this table existed.
 */
export const trialGrants = pgTable("trial_grants", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  /** The workspace that got the trial. Plain text, no FK: that workspace may have been deleted since. */
  organizationId: text("organization_id").notNull(),
  createdAt: createdAt(),
});

/**
 * A workspace asked for voice minutes (Billing page). There is no payment provider: the Halochime
 * owner gets an email, sends a payment link, and after payment credits the minutes with
 * scripts/credit-minutes.ts. That top up (creditWallet) marks the open request done.
 * At most one open request per workspace; a new request replaces the open one.
 */
export const minuteRequests = pgTable(
  "minute_requests",
  {
    id: id(),
    organizationId: orgId(),
    requestedBy: text("requested_by").references(() => user.id, { onDelete: "set null" }),
    /** Copied at request time, so the record still reads right if the user changes or leaves. */
    requesterName: text("requester_name").notNull(),
    requesterEmail: text("requester_email").notNull(),
    minutes: integer("minutes").notNull(),
    note: text("note"),
    status: minuteRequestStatus("status").notNull().default("open"),
    /** The top up that fulfilled it (status done). */
    usageEventId: text("usage_event_id").references(() => usageEvents.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
  },
  (t) => [
    index("minute_requests_org_idx").on(t.organizationId, t.createdAt.desc()),
    uniqueIndex("minute_requests_one_open_uq").on(t.organizationId).where(sql`${t.status} = 'open'`),
  ],
);

// ---------------------------------------------------------------------------
// Integrations (spec: docs/integrations.md)

/** An HTTP endpoint of the business that the agent may call during a conversation (an "action"). */
export const agentActions = pgTable(
  "agent_actions",
  {
    id: id(),
    organizationId: orgId(),
    agentId: text("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    /** Tool name the model sees: lowercase snake_case, unique per agent. */
    name: text("name").notNull(),
    /** When to use it, in plain words. The model reads this. */
    description: text("description").notNull(),
    method: actionMethod("method").notNull().default("POST"),
    url: text("url").notNull(),
    /** Request headers as encrypted JSON (they often hold API keys). Never sent to the voice agent. */
    headersEncrypted: text("headers_encrypted"),
    /** What the agent must fill in before calling. */
    parameters: jsonb("parameters").$type<ActionParameter[]>().notNull().default([]),
    enabled: boolean("enabled").notNull().default(true),
    timeoutMs: integer("timeout_ms").notNull().default(8000),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("agent_actions_org_idx").on(t.organizationId),
    uniqueIndex("agent_actions_agent_name_uq").on(t.agentId, t.name),
  ],
);

/** Where to POST events (conversation ended, handoff created, ...) for the business's own systems. */
export const webhookEndpoints = pgTable(
  "webhook_endpoints",
  {
    id: id(),
    organizationId: orgId(),
    url: text("url").notNull(),
    /** Signing secret (whsec_...). Shown to the owner so their server can verify signatures. */
    secret: text("secret").notNull(),
    /** WebhookEvent names; empty = every event. */
    events: text("events").array().notNull().default(sql`'{}'::text[]`),
    description: text("description").notNull().default(""),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("webhook_endpoints_org_idx").on(t.organizationId)],
);

/** One attempt to deliver one event to one endpoint. Shown in Settings so owners can debug. */
export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    id: id(),
    organizationId: orgId(),
    endpointId: text("endpoint_id")
      .notNull()
      .references(() => webhookEndpoints.id, { onDelete: "cascade" }),
    event: text("event").notNull(),
    /** Same for every attempt of one event, so receivers can ignore duplicates. */
    eventId: text("event_id").notNull(),
    payload: jsonb("payload").notNull(),
    attempt: integer("attempt").notNull().default(1),
    ok: boolean("ok").notNull().default(false),
    statusCode: integer("status_code"),
    error: text("error"),
    durationMs: integer("duration_ms"),
    createdAt: createdAt(),
  },
  (t) => [index("webhook_deliveries_endpoint_idx").on(t.endpointId, t.createdAt.desc())],
);
