import { h } from "./dom";

/**
 * Light formatting for agent replies: models often answer in Markdown even when asked not to.
 * Builds DOM nodes (never innerHTML), so model or knowledge text can't inject markup.
 * Handles **bold**, `code`, [links](https://...), bare https links, "- " bullets and "# " headings.
 */
const INLINE =
  /\*\*([^*\n]+)\*\*|`([^`\n]+)`|\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<>()]*[^\s<>().,;:!?'"])/g;

function link(text: string, href: string): HTMLAnchorElement {
  return h("a", { href, target: "_blank", rel: "noopener noreferrer nofollow" }, text);
}

function appendInline(el: HTMLElement, line: string): void {
  let last = 0;
  for (const m of line.matchAll(INLINE)) {
    const at = m.index ?? 0;
    if (at > last) el.append(line.slice(last, at));
    if (m[1]) el.append(h("strong", {}, m[1]));
    else if (m[2]) el.append(h("code", {}, m[2]));
    else if (m[3] && m[4]) el.append(link(m[3], m[4]));
    else if (m[5]) el.append(link(m[5], m[5]));
    last = at + m[0].length;
  }
  if (last < line.length) el.append(line.slice(last));
}

export function renderRich(el: HTMLElement, text: string): void {
  el.replaceChildren();
  const lines = text.replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").split("\n");
  lines.forEach((raw, i) => {
    if (i > 0) el.append("\n");
    let line = raw.replace(/\s+$/, "");
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    if (heading) line = heading[1]!;
    line = line.replace(/^(\s*)[-*]\s+/, "$1• ");
    appendInline(heading ? el.appendChild(h("strong", {})) : el, line);
  });
}
