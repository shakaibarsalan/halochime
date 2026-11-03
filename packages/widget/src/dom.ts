type Attrs = Record<string, string | number | boolean | undefined | null>;

/** Tiny element helper. Text children always go in as text nodes, never as HTML. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Array<Node | string | null | undefined>
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    el.setAttribute(name, value === true ? "" : String(value));
  }
  for (const child of children) {
    if (child === null || child === undefined) continue;
    el.append(child);
  }
  return el;
}

/** Element holding one of our own static SVG icons (never server data). */
export function icon(svg: string, className = "icon"): HTMLSpanElement {
  const span = document.createElement("span");
  span.className = className;
  span.setAttribute("aria-hidden", "true");
  span.innerHTML = svg;
  return span;
}

/** True on phones/tablets, where focusing a text field would pop the on-screen keyboard. */
export function isTouchDevice(): boolean {
  try {
    if (window.matchMedia("(pointer: coarse)").matches) return true;
    return window.matchMedia("(hover: none)").matches && navigator.maxTouchPoints > 0;
  } catch {
    return false;
  }
}
