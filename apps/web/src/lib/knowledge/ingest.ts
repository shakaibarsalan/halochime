import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { knowledgeChunks, knowledgeSources } from "@/db/schema";
import { chunkText, normalizeText } from "./chunk";
import { extractReadable } from "./extract";
import { checkUrl, FetchError, safeFetch } from "./safe-fetch";

export const MAX_SOURCE_CHARS = 500_000;

type NewSource = {
  organizationId: string;
  agentId: string | null;
  type: "text" | "url" | "file";
  title: string;
  url?: string | null;
};

/**
 * Stores chunks for a source and marks it ready.
 * Embeddings seam: when pgvector lands, embed `chunks` here and write them alongside the rows.
 */
async function storeChunks(sourceId: string, organizationId: string, text: string) {
  const chunks = chunkText(text);
  if (chunks.length === 0) throw new FetchError("No readable text found.");
  await db.transaction(async (tx) => {
    await tx.delete(knowledgeChunks).where(eq(knowledgeChunks.sourceId, sourceId));
    for (let i = 0; i < chunks.length; i += 500) {
      await tx.insert(knowledgeChunks).values(
        chunks.slice(i, i + 500).map((content, j) => ({ sourceId, organizationId, position: i + j, content })),
      );
    }
    await tx
      .update(knowledgeSources)
      .set({ status: "ready", error: null, charCount: text.length, chunkCount: chunks.length })
      .where(eq(knowledgeSources.id, sourceId));
  });
}

async function withSource(source: NewSource, getText: () => Promise<{ text: string; title?: string; url?: string }>) {
  const [row] = await db
    .insert(knowledgeSources)
    .values({ ...source, status: "processing" })
    .returning({ id: knowledgeSources.id });
  const id = row!.id;
  try {
    const { text, title, url } = await getText();
    const clean = normalizeText(text);
    if (clean.length > MAX_SOURCE_CHARS) throw new FetchError("This source is too long (over 500,000 characters).");
    if (title || url) {
      await db
        .update(knowledgeSources)
        .set({ ...(title ? { title } : {}), ...(url ? { url } : {}) })
        .where(eq(knowledgeSources.id, id));
    }
    await storeChunks(id, source.organizationId, clean);
    return { id, ok: true as const };
  } catch (err) {
    const message = err instanceof FetchError ? err.message : "Import failed. Please try again.";
    if (!(err instanceof FetchError)) console.error("knowledge ingest failed", err);
    await db.update(knowledgeSources).set({ status: "failed", error: message }).where(eq(knowledgeSources.id, id));
    return { id, ok: false as const, error: message };
  }
}

export function ingestText(source: Omit<NewSource, "type">, text: string, type: "text" | "file" = "text") {
  return withSource({ ...source, type }, async () => ({ text }));
}

/** Stores a page that was already fetched and extracted (site import). */
export function ingestPage(
  source: Omit<NewSource, "type" | "title" | "url">,
  page: { title: string; url: string; text: string },
) {
  return withSource({ ...source, type: "url", title: page.title, url: page.url }, async () => ({ text: page.text }));
}

export async function ingestUrl(source: Omit<NewSource, "type" | "title" | "url">, rawUrl: string) {
  // Refuse obviously bad URLs before creating a source row; DNS answers are checked again at connect time.
  try {
    checkUrl(rawUrl);
  } catch (err) {
    return { id: null, ok: false as const, error: (err as Error).message };
  }
  return withSource({ ...source, type: "url", title: rawUrl, url: rawUrl }, async () => {
    const page = await safeFetch(rawUrl);
    const type = page.contentType.split(";")[0]!.trim().toLowerCase();
    if (type === "text/plain" || type === "text/markdown") return { text: page.body, url: page.url };
    if (type && type !== "text/html" && type !== "application/xhtml+xml") {
      throw new FetchError(`Unsupported content type: ${type}. Use an HTML or plain text page.`);
    }
    const { title, text } = extractReadable(page.body, rawUrl);
    return { text, title, url: page.url };
  });
}
