const TARGET = 800;
const OVERLAP = 120;

/** Collapses runs of spaces, keeps paragraph breaks (blank lines). */
export function normalizeText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t\f\v ]+/g, " ")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Splits text that is longer than `max` at sentence ends, then at spaces, then hard. */
function splitLong(text: string, max: number): string[] {
  if (text.length <= max) return [text];
  const sentences = text.match(/[^.!?。؟！？]+[.!?。؟！？]*s*/g) ?? [text];
  const out: string[] = [];
  let buf = "";
  const flush = () => {
    if (buf.trim()) out.push(buf.trim());
    buf = "";
  };
  for (let s of sentences) {
    if (buf.length + s.length > max) flush();
    while (s.length > max) {
      let cut = s.lastIndexOf(" ", max);
      if (cut < max / 2) cut = max;
      out.push(s.slice(0, cut).trim());
      s = s.slice(cut);
    }
    buf += s;
  }
  flush();
  return out;
}

/** Tail of the previous chunk, starting on a word boundary, carried into the next one. */
function overlapTail(chunk: string): string {
  if (chunk.length <= OVERLAP) return "";
  const tail = chunk.slice(-OVERLAP);
  const space = tail.indexOf(" ");
  return space >= 0 ? tail.slice(space + 1) : "";
}

/**
 * Paragraph-aware chunking: packs whole paragraphs into chunks of about 800 characters,
 * splits oversized paragraphs at sentence boundaries, and carries a small overlap forward.
 */
export function chunkText(input: string): string[] {
  const text = normalizeText(input);
  if (!text) return [];
  const paragraphs = text.split(/\n\n+/).flatMap((p) => splitLong(p, TARGET));
  const chunks: string[] = [];
  let current = "";
  for (const p of paragraphs) {
    if (current && current.length + p.length + 2 > TARGET) {
      chunks.push(current);
      const tail = overlapTail(current);
      current = tail ? `${tail}\n\n${p}` : p;
    } else {
      current = current ? `${current}\n\n${p}` : p;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}
