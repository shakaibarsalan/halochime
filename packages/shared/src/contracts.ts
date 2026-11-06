import { z } from "zod";
import { EMBEDDING_DIMENSIONS, WIDGET_APPEARANCES, WIDGET_ICONS } from "./constants";
import { HelpOffer, WidgetProactiveHelp } from "./page-help";

/**
 * Contracts between the three moving parts:
 *   widget  -> web   (public widget API, CORS, checked against the agent's allowed domains)
 *   agent   -> web   (internal API, Bearer INTERNAL_API_SECRET)
 *   widget <-> agent (a LiveKit room; see docs/contracts.md for topics)
 *
 * The Python voice agent mirrors the internal shapes by hand in apps/agent/src/talkfront_agent/api.py.
 * Change both sides together.
 */

export const ConversationMode = z.enum(["voice", "text"]);
export type ConversationMode = z.infer<typeof ConversationMode>;

export const ApiError = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
});
export type ApiError = z.infer<typeof ApiError>;

// ---------------------------------------------------------------------------
// Public widget API
// ---------------------------------------------------------------------------

export const WidgetTheme = z.object({
  color: z.string(),
  position: z.enum(["bottom-right", "bottom-left"]),
  label: z.string(),
  /** Icon on the chat button and header. Missing = "auto". */
  icon: z.enum(WIDGET_ICONS).optional(),
  /** Missing = "light". */
  appearance: z.enum(WIDGET_APPEARANCES).optional(),
  /** Changes whenever a new picture is uploaded, so the picture's URL (and caches) change too. */
  imageVersion: z.string().optional(),
});
export type WidgetTheme = z.infer<typeof WidgetTheme>;

/** GET /api/widget/config?key=pk_... */
export const WidgetConfigResponse = z.object({
  agentId: z.string(),
  name: z.string(),
  greeting: z.string(),
  modes: z.array(ConversationMode).min(1),
  theme: WidgetTheme,
  /** The voice server, so the widget can warm up its connection before the visitor starts a call. */
  livekitUrl: z.string().optional(),
  /** The business's own picture for the icon (theme.icon "image"). Absent = use a drawn icon. */
  iconUrl: z.string().optional(),
  /** Small "by Halochime" line under the chat. Absent = no line. */
  poweredBy: z.object({ label: z.string(), url: z.string() }).optional(),
  /**
   * The greeting as audio (realtime voices only). The widget preloads it and plays it the moment the
   * visitor taps Talk, while the call connects (2 to 5 s), then says greetingPlayed in the session request.
   */
  greetingAudioUrl: z.string().optional(),
  /** Proactive help bubble rules (page-help.ts). Absent = off. */
  proactiveHelp: WidgetProactiveHelp.optional(),
  /** Page guide: tell the agent about the page's buttons and links, and highlight what it points to. Absent = off. */
  pageGuide: z.boolean().optional(),
});
export type WidgetConfigResponse = z.infer<typeof WidgetConfigResponse>;

/** POST /api/widget/session */
export const WidgetSessionRequest = z.object({
  key: z.string().min(8).max(100),
  mode: ConversationMode,
  visitorId: z.string().max(100).optional(),
  /** HS256 token signed by the business's server so we know the logged-in user (IdentityTokenClaims). */
  identityToken: z.string().max(4096).optional(),
  /** Voice: the widget already played the greeting from greetingAudioUrl, so the agent must not say it again. */
  greetingPlayed: z.boolean().optional(),
  page: z
    .object({
      url: z.string().max(2048),
      title: z.string().max(300).optional(),
    })
    .optional(),
  /** The visitor opened the chat from the proactive help bubble. Ignored unless proactive help is on. */
  helpOffer: HelpOffer.optional(),
});
export type WidgetSessionRequest = z.infer<typeof WidgetSessionRequest>;

export const WidgetSessionResponse = z.object({
  conversationId: z.string(),
  livekitUrl: z.string(),
  token: z.string(),
  roomName: z.string(),
});
export type WidgetSessionResponse = z.infer<typeof WidgetSessionResponse>;

/** Extra facts about a signed-in visitor, from the identity token. Flat and small on purpose. */
export const VisitorAttributes = z.record(
  z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,39}$/),
  z.union([z.string().max(500), z.number(), z.boolean()]),
);
export type VisitorAttributes = z.infer<typeof VisitorAttributes>;

/**
 * Claims of the identity token (JWT, HS256, signed with the agent's identity secret).
 * `exp` is required and at most 24 hours after `iat`.
 */
export const IdentityTokenClaims = z.object({
  sub: z.string().min(1).max(200),
  name: z.string().max(200).optional(),
  email: z.string().max(320).optional(),
  attributes: VisitorAttributes.optional(),
  iat: z.number().int(),
  exp: z.number().int(),
});
export type IdentityTokenClaims = z.infer<typeof IdentityTokenClaims>;

/** JSON put in the LiveKit agent dispatch metadata when the session token is minted. */
export const DispatchMetadata = z.object({
  conversationId: z.string(),
  agentId: z.string(),
  organizationId: z.string(),
  mode: ConversationMode,
  /** The widget played the greeting itself (WidgetSessionRequest.greetingPlayed). */
  greetingPlayed: z.boolean().optional(),
});
export type DispatchMetadata = z.infer<typeof DispatchMetadata>;

// ---------------------------------------------------------------------------
// Internal API (voice agent -> web)
// ---------------------------------------------------------------------------

/** GET /api/internal/runtime/:conversationId */
export const RuntimeConfig = z.object({
  conversationId: z.string(),
  mode: ConversationMode,
  agent: z.object({
    id: z.string(),
    name: z.string(),
    greeting: z.string(),
    /** Fully built system prompt: persona + business rules + voice style + tool rules. */
    systemPrompt: z.string(),
    stt: z.object({
      provider: z.literal("deepgram"),
      model: z.string(),
      language: z.string(),
    }),
    llm: z.object({
      provider: z.enum(["anthropic", "groq", "openai"]),
      model: z.string(),
      /** Only sent to models that accept it; Claude Haiku 5.5 and newer reject a custom temperature. */
      temperature: z.number().min(0).max(1),
    }),
    tts: z.object({
      provider: z.literal("deepgram"),
      voice: z.string(),
    }),
    /**
     * Voice calls: "realtime" = one OpenAI speech-to-speech model (stt/llm/tts above unused for voice);
     * "classic" = Deepgram speech to text -> llm -> Deepgram voice (or providerVoice below).
     */
    voice: z.object({
      engine: z.enum(["realtime", "classic"]),
      realtimeModel: z.string(),
      realtimeVoice: z.string(),
      /** Names speech recognition should expect (business and agent name). */
      vocabulary: z.array(z.string().max(60)).max(10),
      /**
       * An ElevenLabs, Cartesia or cloned (ElevenLabs) voice. The agent speaks with it through the classic
       * pipeline when it has the provider's key; otherwise engine/realtimeVoice above are the default voice.
       * language null: the provider follows the text's language.
       */
      providerVoice: z
        .object({
          provider: z.enum(["elevenlabs", "cartesia"]),
          voiceId: z.string(),
          model: z.string(),
          language: z.string().nullable(),
        })
        .optional(),
    }),
    maxDurationSec: z.number().int().positive(),
    handoffEnabled: z.boolean(),
  }),
  visitor: z.object({
    id: z.string().nullable(),
    name: z.string().nullable(),
    email: z.string().nullable(),
    /** true when the fields above came from a valid identity token. */
    verified: z.boolean(),
    attributes: VisitorAttributes,
  }),
  /** The business's HTTP actions this agent may call (no URLs or secrets: the web app makes the call). */
  actions: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      description: z.string(),
      /** JSON Schema (type "object") for the arguments. */
      parameters: z.record(z.string(), z.unknown()),
    }),
  ),
  /** Page guide is on: the agent reads tf.page and gets the point_to tool. Absent = off. */
  pageGuide: z.boolean().optional(),
  /**
   * The visitor opened this conversation from a help offer. `opener`: voice calls start with a reply
   * made from these instructions instead of the plain greeting. Absent = a normal start.
   */
  helpOffer: z.object({ reason: z.string().nullable(), message: z.string(), opener: z.string() }).optional(),
});
export type RuntimeConfig = z.infer<typeof RuntimeConfig>;

/** One input of an action, as the business defines it in the dashboard. */
export const ActionParameter = z.object({
  name: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
  type: z.enum(["string", "number", "integer", "boolean"]),
  description: z.string().max(300),
  required: z.boolean(),
  /** Allowed values (strings only). */
  enum: z.array(z.string().max(100)).max(20).optional(),
});
export type ActionParameter = z.infer<typeof ActionParameter>;

/** POST /api/internal/conversations/:id/actions/:actionId */
export const RunActionRequest = z.object({
  arguments: z.record(z.string(), z.unknown()),
});
export type RunActionRequest = z.infer<typeof RunActionRequest>;

export const RunActionResponse = z.object({
  /** false when the call failed (network, timeout, non-2xx); `result` then explains. */
  ok: z.boolean(),
  status: z.number().int().nullable(),
  /** Response body as text, cut to a size the model can read. */
  result: z.string(),
});
export type RunActionResponse = z.infer<typeof RunActionResponse>;

/** POST /api/internal/knowledge/search */
export const KnowledgeSearchRequest = z.object({
  conversationId: z.string(),
  query: z.string().min(1).max(500),
  limit: z.number().int().min(1).max(8).default(5),
  /** Query embedding from the embedder (same model as the chunks); turns on semantic search. */
  embedding: z.array(z.number()).length(EMBEDDING_DIMENSIONS).optional(),
});
export type KnowledgeSearchRequest = z.infer<typeof KnowledgeSearchRequest>;

export const KnowledgeSearchResponse = z.object({
  results: z.array(
    z.object({
      chunkId: z.string(),
      sourceId: z.string(),
      title: z.string(),
      url: z.string().nullable(),
      content: z.string(),
      score: z.number(),
    }),
  ),
});
export type KnowledgeSearchResponse = z.infer<typeof KnowledgeSearchResponse>;

/** "staff": a person from the business who took the conversation over in the live inbox. */
export const MessageRole = z.enum(["user", "assistant", "tool", "system", "staff"]);
export type MessageRole = z.infer<typeof MessageRole>;

/** POST /api/internal/conversations/:id/messages -> 204 */
export const AppendMessagesRequest = z.object({
  messages: z
    .array(
      z.object({
        role: MessageRole,
        content: z.string().max(20_000),
        createdAt: z.string().datetime(),
      }),
    )
    .min(1)
    .max(100),
});
export type AppendMessagesRequest = z.infer<typeof AppendMessagesRequest>;

/**
 * POST /api/internal/conversations/:id/takeover -> 204
 * The agent handed a taken over conversation back to the AI by itself (no word from the team member for a while).
 */
export const TakeoverRequest = z.object({ state: z.literal("released") });
export type TakeoverRequest = z.infer<typeof TakeoverRequest>;

/** POST /api/internal/conversations/:id/handoff -> { ok: true } */
export const HandoffRequest = z.object({
  name: z.string().max(200).optional(),
  email: z.string().max(320).optional(),
  phone: z.string().max(50).optional(),
  message: z.string().min(1).max(4000),
});
export type HandoffRequest = z.infer<typeof HandoffRequest>;

export const EndedReason = z.enum([
  "visitor_left",
  "agent_ended",
  "max_duration",
  "out_of_credit",
  "error",
]);
export type EndedReason = z.infer<typeof EndedReason>;

/** POST /api/internal/conversations/:id/end -> { ok: true } */
export const EndConversationRequest = z.object({
  endedReason: EndedReason,
  durationSec: z.number().int().min(0),
});
export type EndConversationRequest = z.infer<typeof EndConversationRequest>;

// ---------------------------------------------------------------------------
// Information collected from each conversation (docs/integrations.md, section 5)
// ---------------------------------------------------------------------------

/** Always extracted after a conversation, for every agent. Custom fields can't use these keys. */
export const BUILT_IN_COLLECT_KEYS = [
  "visitor_name",
  "email",
  "phone",
  "topic",
  "outcome",
  "follow_up_needed",
  "sentiment",
] as const;
export type BuiltInCollectKey = (typeof BUILT_IN_COLLECT_KEYS)[number];

export const CONVERSATION_OUTCOMES = ["answered", "message_taken", "not_answered", "other"] as const;
export type ConversationOutcome = (typeof CONVERSATION_OUTCOMES)[number];

export const SENTIMENTS = ["positive", "neutral", "negative"] as const;
export type Sentiment = (typeof SENTIMENTS)[number];

export const COLLECT_FIELD_TYPES = ["text", "number", "yes_no", "date", "email", "phone", "choice"] as const;
export type CollectFieldType = (typeof COLLECT_FIELD_TYPES)[number];

export const MAX_COLLECT_FIELDS = 15;
export const COLLECT_KEY_RE = /^[a-z][a-z0-9_]{0,39}$/;

const builtInKeys: readonly string[] = BUILT_IN_COLLECT_KEYS;

/** One thing the business wants noted from every conversation, defined per agent in the dashboard. */
export const CollectField = z
  .object({
    key: z
      .string()
      .regex(COLLECT_KEY_RE, "Key: start with a lowercase letter, then lowercase letters, numbers or _ (at most 40).")
      .refine((k) => !builtInKeys.includes(k), "That key is always collected already. Pick another one."),
    label: z.string().trim().min(1, "Give the field a label.").max(60, "Label: at most 60 characters."),
    /** Tells the extractor (and the agent, when it asks) what to look for. */
    description: z.string().trim().max(300, "Description: at most 300 characters."),
    type: z.enum(COLLECT_FIELD_TYPES),
    /** Only for `choice`: 2 to 10 allowed values. */
    options: z.array(z.string().trim().min(1, "Options can't be empty.").max(60, "Options: at most 60 characters each.")).optional(),
    /** The agent tries to find this out during the conversation. */
    ask: z.boolean(),
  })
  .superRefine((f, ctx) => {
    if (f.type === "choice") {
      const n = new Set((f.options ?? []).map((o) => o.toLowerCase())).size;
      if (n !== (f.options ?? []).length) ctx.addIssue({ code: "custom", path: ["options"], message: "Options must be different from each other." });
      else if (n < 2 || n > 10) ctx.addIssue({ code: "custom", path: ["options"], message: "A choice needs 2 to 10 options." });
    } else if (f.options !== undefined) {
      ctx.addIssue({ code: "custom", path: ["options"], message: "Only a choice field has options." });
    }
  });
export type CollectField = z.infer<typeof CollectField>;

export const CollectFields = z
  .array(CollectField)
  .max(MAX_COLLECT_FIELDS, `At most ${MAX_COLLECT_FIELDS} fields.`)
  .superRefine((list, ctx) => {
    const seen = new Set<string>();
    for (const [i, f] of list.entries()) {
      if (seen.has(f.key)) ctx.addIssue({ code: "custom", path: [i, "key"], message: `Two fields use the key ${f.key}.` });
      seen.add(f.key);
    }
  });

export type CollectedValue = string | number | boolean | null;

/**
 * What was gathered in one conversation, stored in conversations.collected_data and sent in the
 * conversation.ended webhook as `collected`. null values = not mentioned. Custom values keep the label
 * and type they had when collected, so they still read correctly after the field changes.
 */
export type CollectedData = {
  visitor_name: string | null;
  email: string | null;
  phone: string | null;
  topic: string | null;
  outcome: ConversationOutcome | null;
  follow_up_needed: boolean | null;
  sentiment: Sentiment | null;
  custom: Record<string, { label: string; type: CollectFieldType; value: CollectedValue }>;
};
