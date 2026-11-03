import "server-only";
import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import { normalizeText } from "./chunk";

const BLOCKS = "h1,h2,h3,h4,h5,h6,p,li,pre,blockquote,td,th,dt,dd,figcaption";

/** Text of block elements joined by blank lines, so paragraphs survive for chunking. */
function blocksToText(doc: Document): string {
  const parts: string[] = [];
  doc.querySelectorAll(BLOCKS).forEach((el) => {
    // Skip blocks nested in another block (e.g. <p> inside <li>) to avoid duplicates.
    if (el.parentElement?.closest(BLOCKS)) return;
    const text = el.textContent?.replace(/\s+/g, " ").trim();
    if (text) parts.push(text);
  });
  return parts.join("\n\n");
}

/** Main readable text, title and `<link rel="canonical">` href (raw, unresolved) of an HTML page (Readability + linkedom). */
export function extractReadable(
  html: string,
  fallbackTitle: string,
): { title: string; text: string; canonical: string | null } {
  const { document } = parseHTML(html);
  const doc = document as unknown as Document;
  const pageTitle = doc.title?.trim();
  // Read before Readability, which rewrites the document.
  const canonical = doc.querySelector('link[rel~="canonical"]')?.getAttribute("href")?.trim() || null;
  const article = new Readability(doc, { charThreshold: 200 }).parse();

  let text = "";
  if (article?.content) {
    const { document: inner } = parseHTML(`<!doctype html><html><body>${article.content}</body></html>`);
    text = blocksToText(inner as unknown as Document) || article.textContent || "";
  }
  if (!text.trim()) text = blocksToText(doc) || doc.body?.textContent || "";

  return {
    title: (article?.title || pageTitle || fallbackTitle).trim().slice(0, 300),
    text: normalizeText(text),
    canonical,
  };
}
