import { PAGE_GUIDE_LABEL_MAX, PAGE_GUIDE_MAX_ELEMENTS, type PageElement } from "@talkfront/shared";

/**
 * Page guide: which buttons, links and fields of the host page the agent hears about (topic tf.page).
 *
 * Only what a visitor can see: visible text, aria-label, the field's <label>, placeholder or title.
 * Never a field's value, and password, card and similar fields are skipped altogether. Elements inside
 * the widget (its shadow root) are never reached by document.querySelectorAll, and our own highlight
 * overlay is skipped by its attribute.
 *
 * The rules work on a small element interface so they can be checked without a browser
 * (pageguide.check.ts); collectFromDocument() is the browser side.
 */

export interface ElementLike {
  readonly tagName: string;
  getAttribute(name: string): string | null;
}

export interface CollectEnv<E extends ElementLike> {
  /** On screen when scrolled to: not display:none, visibility:hidden, zero size or inside aria-hidden/inert. */
  visible(el: E): boolean;
  /** What the visitor reads on it (innerText, or an image's alt text). Not used for form fields. */
  text(el: E): string;
  /** Text of the field's <label> elements or aria-labelledby targets. */
  labelText(el: E): string;
}

/** Elements the visitor can act on. */
export const CANDIDATE_SELECTOR = [
  "a[href]",
  "button",
  "input",
  "select",
  "textarea",
  "summary",
  '[role="button"]',
  '[role="link"]',
  '[role="tab"]',
  '[role="menuitem"]',
  '[role="checkbox"]',
  '[role="switch"]',
  '[role="combobox"]',
].join(",");

/** Our own highlight overlay (highlight.ts) carries this attribute. */
export const OVERLAY_ATTR = "data-halochime-overlay";

const SKIPPED_INPUT_TYPES = new Set(["hidden", "password"]);
const BUTTON_INPUT_TYPES = new Set(["button", "submit", "reset", "image"]);
/** Card numbers, security codes, passwords, PINs, bank and ID numbers: never described at all. */
const SENSITIVE =
  /pass(word|code)|\bpin\b|\botp\b|one.?time|card.?(num|no\b|number|holder)|credit|debit|\bcc.?(num|number|exp|csc|cvc|cvv)|\bcvv|\bcvc|\bcsc\b|security.?code|expir|\biban\b|routing|account.?(num|no\b|number)|\bssn\b|social.?security|tax.?id|national.?id|passport/i;
const SENSITIVE_AUTOCOMPLETE = /^(cc-|current-password|new-password|one-time-code)/i;
const MAX_SAME = 2;

const oneLine = (v: string | null | undefined, max = PAGE_GUIDE_LABEL_MAX) => (v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

const tag = (el: ElementLike) => el.tagName.toLowerCase();

function isField(el: ElementLike): boolean {
  const t = tag(el);
  if (t === "select" || t === "textarea") return true;
  if (t !== "input") return false;
  return !BUTTON_INPUT_TYPES.has((el.getAttribute("type") ?? "text").toLowerCase());
}

/** A field whose contents are private (password, card, PIN...). Judged by its attributes, never its value. */
export function isSensitive(el: ElementLike, labelText = ""): boolean {
  const auto = (el.getAttribute("autocomplete") ?? "").trim();
  if (auto.split(/\s+/).some((a) => SENSITIVE_AUTOCOMPLETE.test(a))) return true;
  if ((el.getAttribute("type") ?? "").toLowerCase() === "password") return true;
  const hints = ["name", "id", "aria-label", "placeholder", "title", "data-testid"].map((a) => el.getAttribute(a) ?? "");
  return SENSITIVE.test([...hints, labelText].join(" "));
}

/** What kind of thing it is, in plain words for the agent. */
export function roleOf(el: ElementLike): string {
  const role = (el.getAttribute("role") ?? "").toLowerCase();
  if (role === "menuitem") return "menu item";
  if (["button", "link", "tab", "checkbox", "switch"].includes(role)) return role;
  if (role === "combobox") return "dropdown";
  const t = tag(el);
  if (t === "a") return "link";
  if (t === "button" || t === "summary") return "button";
  if (t === "select") return "dropdown";
  if (t === "textarea") return "text box";
  if (t === "input") {
    const type = (el.getAttribute("type") ?? "text").toLowerCase();
    if (BUTTON_INPUT_TYPES.has(type)) return "button";
    if (type === "checkbox" || type === "radio") return type === "radio" ? "option" : "checkbox";
    if (type === "file") return "file upload";
    if (type === "search") return "search box";
    return "field";
  }
  return role || "element";
}

/** The element's name as the visitor sees it, or "" (then it is left out). Never a typed value. */
export function labelOf<E extends ElementLike>(el: E, env: CollectEnv<E>): string {
  const aria = oneLine(el.getAttribute("aria-label"));
  if (aria) return aria;
  if (isField(el)) {
    return oneLine(env.labelText(el)) || oneLine(el.getAttribute("placeholder")) || oneLine(el.getAttribute("title"));
  }
  if (tag(el) === "input") {
    // A button input: its value attribute is the text printed on the button, written by the site.
    return oneLine(el.getAttribute("value")) || oneLine(el.getAttribute("alt")) || oneLine(el.getAttribute("title"));
  }
  return oneLine(env.text(el)) || oneLine(env.labelText(el)) || oneLine(el.getAttribute("title"));
}

/** One element as the agent sees it, or null when it is hidden, private or has no name. */
export function describe<E extends ElementLike>(el: E, env: CollectEnv<E>): Omit<PageElement, "id"> | null {
  if (el.getAttribute(OVERLAY_ATTR) !== null) return null;
  const t = tag(el);
  if (t === "input" && SKIPPED_INPUT_TYPES.has((el.getAttribute("type") ?? "").toLowerCase())) return null;
  if (el.getAttribute("hidden") !== null || el.getAttribute("aria-hidden") === "true") return null;
  if (isField(el) && isSensitive(el, env.labelText(el))) return null;
  if (!env.visible(el)) return null;
  const label = labelOf(el, env);
  if (!label) return null;
  return { role: roleOf(el), label };
}

/**
 * The page's elements for the agent, in page order: at most `cap`, each role + label at most twice
 * (a shop's twenty "Add to cart" buttons are no help). `idFor` gives an element the same id every
 * time, so the agent can point at it after the list is sent again.
 */
export function collectElements<E extends ElementLike>(
  candidates: Iterable<E>,
  env: CollectEnv<E>,
  idFor: (el: E) => string,
  cap = PAGE_GUIDE_MAX_ELEMENTS,
): { elements: PageElement[]; byId: Map<string, E> } {
  const elements: PageElement[] = [];
  const byId = new Map<string, E>();
  const same = new Map<string, number>();
  for (const el of candidates) {
    if (elements.length >= cap) break;
    const d = describe(el, env);
    if (!d) continue;
    const key = `${d.role}|${d.label.toLowerCase()}`;
    const n = same.get(key) ?? 0;
    if (n >= MAX_SAME) continue;
    same.set(key, n + 1);
    const id = idFor(el);
    if (byId.has(id)) continue;
    byId.set(id, el);
    elements.push({ id, ...d });
  }
  return { elements, byId };
}

/** Stable short ids ("e1", "e2", ...) per element for the life of the page. */
export function idMaker<E extends object>(): (el: E) => string {
  const ids = new WeakMap<E, string>();
  let next = 1;
  return (el) => {
    let id = ids.get(el);
    if (!id) {
      id = `e${next++}`;
      ids.set(el, id);
    }
    return id;
  };
}

/** A short fingerprint of a list, to skip sending the same page twice. */
export function signature(path: string, elements: readonly PageElement[]): string {
  return `${path}\n${elements.map((e) => `${e.id}:${e.role}:${e.label}`).join("\n")}`;
}

/**
 * Milliseconds to wait before sending again: changes are batched for `debounceMs`, and sends are at
 * least `minGapMs` apart (a busy page must not flood the agent).
 */
export function sendDelay(now: number, lastSentAt: number | null, debounceMs: number, minGapMs: number): number {
  const gap = lastSentAt === null ? 0 : lastSentAt + minGapMs - now;
  return Math.max(debounceMs, gap, 0);
}

// --------------------------------------------------------------------------- browser side

function visibleInBrowser(el: Element): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.closest('[aria-hidden="true"], [inert], [hidden]')) return false;
  const check = (el as HTMLElement & { checkVisibility?: (o?: object) => boolean }).checkVisibility;
  if (typeof check === "function") {
    if (!check.call(el, { checkOpacity: true, checkVisibilityCSS: true })) return false;
  } else {
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
  }
  const rect = el.getBoundingClientRect();
  return rect.width >= 2 && rect.height >= 2;
}

function labelTextInBrowser(el: Element): string {
  const parts: string[] = [];
  const doc = el.ownerDocument;
  for (const ref of (el.getAttribute("aria-labelledby") ?? "").split(/\s+/).filter(Boolean)) {
    const target = doc.getElementById(ref);
    if (target) parts.push(target.textContent ?? "");
  }
  const labels = (el as HTMLInputElement).labels;
  if (labels) {
    for (const label of Array.from(labels)) {
      // A label wrapping its field: only the label's own words, never the field inside it.
      const copy = label.cloneNode(true) as HTMLElement;
      for (const inner of Array.from(copy.querySelectorAll("input, select, textarea"))) inner.remove();
      parts.push(copy.textContent ?? "");
    }
  }
  return parts.join(" ");
}

function textInBrowser(el: Element): string {
  const text = el instanceof HTMLElement ? el.innerText : (el.textContent ?? "");
  if (text.trim()) return text;
  const img = el.querySelector("img[alt], svg[aria-label]");
  return img?.getAttribute("alt") ?? img?.getAttribute("aria-label") ?? "";
}

const browserEnv: CollectEnv<Element> = { visible: visibleInBrowser, text: textInBrowser, labelText: labelTextInBrowser };

/** The visitor's page right now. */
export function collectFromDocument(doc: Document, idFor: (el: Element) => string) {
  return collectElements(doc.querySelectorAll(CANDIDATE_SELECTOR), browserEnv, idFor);
}
