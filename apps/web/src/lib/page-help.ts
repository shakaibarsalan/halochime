import {
  DEFAULT_PROACTIVE_HELP,
  ProactiveHelpSettings,
  type HelpOffer,
  type WidgetProactiveHelp,
} from "@talkfront/shared";

// Pure helpers for page help (proactive help bubble + page guide), shared by the dashboard panel, its
// server action and the widget/runtime routes. No server imports here. Spec: docs/integrations.md §2.

export type PageHelpSettings = { proactive: ProactiveHelpSettings; pageGuide: boolean };

export const DEFAULT_PAGE_HELP: PageHelpSettings = { proactive: DEFAULT_PROACTIVE_HELP, pageGuide: false };

/** The stored row's values, or the defaults (off) when there is no row or it no longer parses. */
export function readPageHelp(row: { proactive: unknown; pageGuide: boolean } | null | undefined): PageHelpSettings {
  if (!row) return DEFAULT_PAGE_HELP;
  const proactive = ProactiveHelpSettings.safeParse(row.proactive);
  return { proactive: proactive.success ? proactive.data : DEFAULT_PROACTIVE_HELP, pageGuide: row.pageGuide === true };
}

/** What the widget config carries: nothing at all for features that are off. */
export function widgetPageHelp(s: PageHelpSettings): { proactiveHelp?: WidgetProactiveHelp; pageGuide?: true } {
  return {
    ...(s.proactive.enabled ? { proactiveHelp: { rules: s.proactive.rules, defaultMessage: s.proactive.defaultMessage } } : {}),
    ...(s.pageGuide ? { pageGuide: true as const } : {}),
  };
}

/** One line, no control characters, so page or host text cannot change the prompt's layout. */
export const helpLine = (v: string, max: number) => v.replace(/[\u0000-\u001f\u007f\s]+/g, " ").trim().slice(0, max);

/**
 * The help offer to store with a new conversation, or null. Offers are only kept when the business
 * turned proactive help on; the text comes from the visitor's browser, so it is cut to one short line.
 */
export function acceptedHelpOffer(s: PageHelpSettings, offer: HelpOffer | undefined): HelpOffer | null {
  if (!s.proactive.enabled || !offer) return null;
  const message = helpLine(offer.message, 160);
  const reason = offer.reason ? helpLine(offer.reason, 60) : "";
  if (!message) return null;
  return { source: offer.source, message, ...(reason ? { reason } : {}) };
}
