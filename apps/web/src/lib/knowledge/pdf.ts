import "server-only";
import { getDocumentProxy } from "unpdf";
import { FetchError } from "./safe-fetch";

// Vercel functions refuse request bodies over ~4.5 MB.
export const MAX_PDF_BYTES = 4 * 1024 * 1024;
export const MAX_PDF_CHARS = 300_000;

type Item = { str: string; x: number; y: number; width: number; size: number; eol: boolean };
type Line = { text: string; y: number; size: number };

/** Joins the text items of one page into lines, adding a space where items sit apart. */
function toLines(items: Item[]): Line[] {
  const lines: Line[] = [];
  let cur: Line | null = null;
  let lastEnd = 0;
  const end = () => {
    if (cur && cur.text.trim()) lines.push({ ...cur, text: cur.text.replace(/\s+/g, " ").trim() });
    cur = null;
  };
  for (const it of items) {
    const line: Line | null = cur;
    // A new baseline without an end-of-line marker still starts a new line.
    if (line && it.str && Math.abs(it.y - line.y) > Math.max(line.size, it.size) * 0.5) end();
    if (it.str) {
      if (!cur) {
        cur = { text: it.str, y: it.y, size: it.size };
      } else {
        const c: Line = cur;
        const gap = it.x - lastEnd;
        const needsSpace = gap > it.size * 0.15 && !/\s$/.test(c.text) && !/^\s/.test(it.str);
        c.text += (needsSpace ? " " : "") + it.str;
        c.size = Math.max(c.size, it.size);
      }
      lastEnd = it.x + it.width;
    }
    if (it.eol) end();
  }
  end();
  return lines;
}

/** Groups lines into paragraphs: a bigger vertical gap, a font size change or a jump upwards starts a new one. */
function toParagraphs(lines: Line[]): string[] {
  const paragraphs: string[] = [];
  let buf = "";
  let prev: Line | null = null;
  for (const line of lines) {
    if (prev) {
      const gap = prev.y - line.y;
      const size = Math.max(prev.size, line.size);
      const breakHere = gap < 0 || gap > size * 1.6 || Math.abs(prev.size - line.size) > 1.5;
      if (breakHere) {
        paragraphs.push(buf);
        buf = line.text;
      } else if (/\p{L}-$/u.test(buf) && /^\p{Ll}/u.test(line.text)) {
        buf = buf.slice(0, -1) + line.text; // re-join a word hyphenated across lines
      } else {
        buf += " " + line.text;
      }
    } else {
      buf = line.text;
    }
    prev = line;
  }
  if (buf) paragraphs.push(buf);
  return paragraphs;
}

export type PdfText = { text: string; totalPages: number; pagesRead: number; truncated: boolean };

/**
 * Text of a PDF, page by page, with paragraph breaks kept (unpdf / PDF.js, pure JS).
 * Stops reading once MAX_PDF_CHARS is reached and says so, so huge files do not use the whole time budget.
 */
export async function extractPdfText(bytes: Uint8Array): Promise<PdfText> {
  if (new TextDecoder().decode(bytes.subarray(0, 1024)).indexOf("%PDF-") === -1) {
    throw new FetchError("That file is not a valid PDF.");
  }
  let pdf: Awaited<ReturnType<typeof getDocumentProxy>>;
  try {
    pdf = await getDocumentProxy(bytes);
  } catch (err) {
    const name = (err as Error)?.name;
    if (name === "PasswordException") {
      throw new FetchError("This PDF is password-protected. Remove the password and upload it again.");
    }
    if (name === "InvalidPDFException") throw new FetchError("That file is not a valid PDF, or it is damaged.");
    throw err;
  }
  try {
    const parts: string[] = [];
    let length = 0;
    let pagesRead = 0;
    let truncated = false;
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const content = await page.getTextContent();
      page.cleanup();
      const items: Item[] = [];
      for (const raw of content.items) {
        if (!("str" in raw)) continue;
        const t = raw.transform as number[];
        items.push({
          str: raw.str.replace(/\u0000/g, ""),
          x: t[4] ?? 0,
          y: t[5] ?? 0,
          width: raw.width,
          size: Math.hypot(t[2] ?? 0, t[3] ?? 0) || raw.height || 10,
          eol: raw.hasEOL,
        });
      }
      pagesRead = n;
      for (const p of toParagraphs(toLines(items))) {
        if (length + p.length + 2 > MAX_PDF_CHARS) {
          truncated = true;
          if (parts.length === 0) parts.push(p.slice(0, MAX_PDF_CHARS));
          break;
        }
        parts.push(p);
        length += p.length + 2;
      }
      if (truncated) break;
    }
    const text = parts.join("\n\n").trim();
    if (text.replace(/[\s\p{P}\p{N}]/gu, "").length < 20) {
      throw new FetchError(
        "This PDF has no selectable text. It is probably a scan or images only. Export it with text (or run OCR) and try again.",
      );
    }
    return { text, totalPages: pdf.numPages, pagesRead, truncated };
  } finally {
    await pdf.loadingTask.destroy();
  }
}
