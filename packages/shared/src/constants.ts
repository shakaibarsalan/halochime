// Plain constants with no zod import, so the widget bundle stays small.

/** Name the voice worker registers with LiveKit. Rooms dispatch this agent explicitly. */
export const AGENT_NAME = "talkfront-agent";

/** LiveKit text-stream topics used between the widget and the voice agent. */
export const TOPIC_CHAT = "lk.chat";
export const TOPIC_TRANSCRIPTION = "lk.transcription";
/**
 * Realtime voice calls: the visitor's words while they speak (JSON {text, final, turn}), for display only.
 * `turn` n holds the words of the model's n-th message (counted from 0), whose transcript replaces them.
 */
export const TOPIC_LIVE_CAPTION = "tf.live_caption";
/** Voice calls: an agent reply the visitor talked over, stopped part way (JSON {text, played_s}), for display only. */
export const TOPIC_REPLY_CUT = "tf.reply_cut";

/** error.code values returned by the public widget API. */
export const WIDGET_ERROR_CODES = [
  "invalid_request",
  "out_of_credit",
  "origin_not_allowed",
  "not_found",
  "rate_limited",
  "not_configured",
] as const;
export type WidgetErrorCode = (typeof WIDGET_ERROR_CODES)[number];

/** Size of knowledge embeddings (a 384-dimension multilingual model run by the embedder on the server). */
export const EMBEDDING_DIMENSIONS = 384;

/** Events the business can receive on its webhook endpoints (docs/integrations.md). */
export const WEBHOOK_EVENTS = ["conversation.ended", "handoff.created", "handoff.updated"] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

/**
 * Icons a business can pick for the chat button and header: the inside of a 24x24 stroke SVG.
 * "wave" and "chat" are Halochime's own; the rest come from Lucide (ISC licence, see THIRD_PARTY_NOTICES.md).
 */
export const WIDGET_ICON_SHAPES = {
  wave: '<path d="M4 10v4"/><path d="M8 7v10"/><path d="M12 4v16"/><path d="M16 7v10"/><path d="M20 10v4"/>',
  chat: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.4A8 8 0 1 1 21 12z"/>',
  headset:
    '<path d="M3 11h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-5Zm0 0a9 9 0 1 1 18 0m0 0v5a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3Z"/><path d="M21 16v2a4 4 0 0 1-4 4h-5"/>',
  sparkle:
    '<path d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z"/><path d="M20 2v4"/><path d="M22 4h-4"/><circle cx="4" cy="20" r="2"/>',
  help: '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
  phone:
    '<path d="M13.832 16.568a1 1 0 0 0 1.213-.303l.355-.465A2 2 0 0 1 17 15h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2A18 18 0 0 1 2 4a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-.8 1.6l-.468.351a1 1 0 0 0-.292 1.233 14 14 0 0 0 6.392 6.384"/>',
} as const;
export type WidgetIconShape = keyof typeof WIDGET_ICON_SHAPES;

/** "auto" = wave for voice agents, chat bubble for text-only ones; "image" = the business's own picture. */
export const WIDGET_ICONS = ["auto", "wave", "chat", "headset", "sparkle", "help", "phone", "image"] as const;
export type WidgetIcon = (typeof WIDGET_ICONS)[number];

/** Light, dark, or follow the visitor's device setting. */
export const WIDGET_APPEARANCES = ["light", "dark", "auto"] as const;
export type WidgetAppearance = (typeof WIDGET_APPEARANCES)[number];

/** Largest picture a business can upload for the icon. */
export const WIDGET_IMAGE_MAX_BYTES = 300 * 1024;
