import { z } from "zod";

/**
 * Page help: two widget features a business turns on per agent (both off by default).
 *
 *   Proactive help: a small bubble next to the launcher offers help on pages that match a rule, after
 *   some seconds there, or when the host page calls Halochime.offerHelp({ reason, message }).
 *   Page guide: the widget tells the agent which buttons, links and fields the visitor's page has
 *   (topic tf.page), and the agent can point at one (topic tf.point): the widget highlights it.
 *
 * Plain values and zod schemas only; the widget imports the constants and types, never zod.
 */

export const PROACTIVE_MATCHES = ["contains", "starts_with", "exact", "any"] as const;
export type ProactiveMatch = (typeof PROACTIVE_MATCHES)[number];

export const MAX_PROACTIVE_RULES = 10;
export const PROACTIVE_MESSAGE_MAX = 120;
export const PROACTIVE_PATH_MAX = 200;
export const PROACTIVE_DELAY_MAX_SEC = 600;
/** offerHelp({ reason }): at most this many characters are kept. */
export const HELP_REASON_MAX = 60;
export const DEFAULT_HELP_MESSAGE = "Need a hand? Tap here and ask us.";

/** One "offer help when" rule. The first rule that matches the page wins. */
export const ProactiveRule = z.object({
  id: z.string().regex(/^[a-z0-9]{1,12}$/),
  match: z.enum(PROACTIVE_MATCHES),
  /** Part of the page path, e.g. "/pricing". Ignored for "any". */
  path: z.string().trim().max(PROACTIVE_PATH_MAX, `Page: at most ${PROACTIVE_PATH_MAX} characters.`),
  /** Seconds on the page before the bubble shows (0 = at once). */
  delaySec: z.number().int().min(0).max(PROACTIVE_DELAY_MAX_SEC, `Wait at most ${PROACTIVE_DELAY_MAX_SEC} seconds.`),
  message: z
    .string()
    .trim()
    .min(1, "Write the message the bubble shows.")
    .max(PROACTIVE_MESSAGE_MAX, `Message: at most ${PROACTIVE_MESSAGE_MAX} characters.`),
});
export type ProactiveRule = z.infer<typeof ProactiveRule>;

/** Stored per agent (agent_page_help.proactive). */
export const ProactiveHelpSettings = z
  .object({
    enabled: z.boolean(),
    rules: z.array(ProactiveRule).max(MAX_PROACTIVE_RULES, `At most ${MAX_PROACTIVE_RULES} rules.`),
    /** Shown when the host page calls offerHelp() without a message. */
    defaultMessage: z
      .string()
      .trim()
      .min(1, "Write the default message.")
      .max(PROACTIVE_MESSAGE_MAX, `Default message: at most ${PROACTIVE_MESSAGE_MAX} characters.`),
  })
  .superRefine((s, ctx) => {
    for (const [i, r] of s.rules.entries()) {
      if (r.match !== "any" && !r.path) {
        ctx.addIssue({ code: "custom", path: ["rules", i, "path"], message: "Type part of the page address, like /pricing, or pick Any page." });
      }
    }
  });
export type ProactiveHelpSettings = z.infer<typeof ProactiveHelpSettings>;

export const DEFAULT_PROACTIVE_HELP: ProactiveHelpSettings = { enabled: false, rules: [], defaultMessage: DEFAULT_HELP_MESSAGE };

/** WidgetConfigResponse.proactiveHelp: only sent when the business turned it on. */
export const WidgetProactiveHelp = z.object({
  rules: z.array(ProactiveRule),
  defaultMessage: z.string(),
});
export type WidgetProactiveHelp = z.infer<typeof WidgetProactiveHelp>;

/** WidgetSessionRequest.helpOffer: the visitor opened the chat from the help bubble. */
export const HelpOffer = z.object({
  /** "rule" = a page rule in the dashboard; "api" = the host page called offerHelp(). */
  source: z.enum(["rule", "api"]),
  /** offerHelp({ reason }), e.g. "checkout_failed". */
  reason: z.string().max(HELP_REASON_MAX).optional(),
  /** The words the bubble showed. */
  message: z.string().max(PROACTIVE_MESSAGE_MAX * 2),
});
export type HelpOffer = z.infer<typeof HelpOffer>;

// --------------------------------------------------------------------------- page guide

/** Most elements the widget sends about one page. */
export const PAGE_GUIDE_MAX_ELEMENTS = 60;
export const PAGE_GUIDE_LABEL_MAX = 80;

/** One element of the visitor's page, as the agent sees it (tf.page). Never a field's value. */
export type PageElement = { id: string; role: string; label: string };

/** JSON on topic tf.page (widget -> agent). `path` is origin-less: path only. */
export type PageSnapshot = { path: string; title: string; elements: PageElement[] };

/** JSON on topic tf.point (agent -> widget). */
export type PointMessage = { id: string; label: string };
