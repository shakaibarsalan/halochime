import { WIDGET_ICON_SHAPES, type WidgetIconShape } from "@talkfront/shared";

const svg = (body: string) =>
  `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" focusable="false">${body}</svg>`;

export const ICON_MIC = svg(
  '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0"/><path d="M12 17v4"/><path d="M8 21h8"/>',
);
export const ICON_MIC_OFF = svg(
  '<path d="M15 9.3V5a3 3 0 0 0-5.7-1.3"/><path d="M9 9v2a3 3 0 0 0 5.1 2.1"/><path d="M19 10a7 7 0 0 1-1.2 3.9"/><path d="M5 10a7 7 0 0 0 11.3 5.5"/><path d="M12 17v4"/><path d="M8 21h8"/><path d="M3 3l18 18"/>',
);
export const ICON_CLOSE = svg('<path d="M6 6l12 12"/><path d="M18 6L6 18"/>');
export const ICON_SEND = svg('<path d="M5 12h13"/><path d="M13 6l6 6-6 6"/>');
export const ICON_CHAT = svg(WIDGET_ICON_SHAPES.chat);
export const ICON_WAVE = svg(WIDGET_ICON_SHAPES.wave);

/** The icon a business picked for the chat button and header (drawn icons only). */
export function shapeIcon(shape: WidgetIconShape): string {
  return svg(WIDGET_ICON_SHAPES[shape]);
}
