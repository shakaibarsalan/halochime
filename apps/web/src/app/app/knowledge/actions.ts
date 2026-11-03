"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionState } from "@/components/form-bits";
import { db } from "@/db";
import { agents, knowledgeSources } from "@/db/schema";
import { ingestText, ingestUrl, MAX_SOURCE_CHARS } from "@/lib/knowledge/ingest";
import { extractPdfText, MAX_PDF_BYTES, MAX_PDF_CHARS, type PdfText } from "@/lib/knowledge/pdf";
import { FetchError } from "@/lib/knowledge/safe-fetch";
import { importSite, MAX_CANDIDATES, MAX_SITE_PAGES } from "@/lib/knowledge/site";
import { requireWorkspace } from "@/lib/session";

const MAX_FILE_BYTES = 1024 * 1024;

/** Site import result for the form: the summary plus the pages that were skipped or failed. */
export type SiteImportState =
  | (NonNullable<ActionState> & { details?: { url: string; reason: string; failed: boolean }[] })
  | null;

const pages = (n: number) => `${n} page${n === 1 ? "" : "s"}`;

/** "" = shared by every agent; otherwise the agent must belong to this workspace. */
async function resolveAgentScope(organizationId: string, raw: FormDataEntryValue | null) {
  const agentId = typeof raw === "string" && raw ? raw : null;
  if (!agentId) return { agentId: null };
  const [agent] = await db
    .select({ id: agents.id })
    .from(agents)
    .where(and(eq(agents.id, agentId), eq(agents.organizationId, organizationId)))
    .limit(1);
  return agent ? { agentId: agent.id } : { error: "That agent does not exist." };
}

function done(result: { ok: boolean; error?: string }, success: string): ActionState {
  revalidatePath("/app/knowledge");
  return result.ok ? { ok: true, message: success } : { error: result.error ?? "Import failed." };
}

const TextInput = z.object({
  title: z.string().trim().min(1, "Give it a title.").max(200),
  content: z.string().trim().min(1, "Paste some text.").max(MAX_SOURCE_CHARS, "That text is too long."),
});

export async function addTextSource(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { organizationId } = await requireWorkspace();
  const parsed = TextInput.safeParse({ title: formData.get("title"), content: formData.get("content") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const scope = await resolveAgentScope(organizationId, formData.get("agentId"));
  if ("error" in scope) return { error: scope.error };
  const result = await ingestText({ organizationId, agentId: scope.agentId, title: parsed.data.title }, parsed.data.content);
  return done(result, "Added.");
}

const UrlInput = z.object({ url: z.url({ protocol: /^https?$/, error: "Enter a full http(s) URL." }).max(2048) });

export async function addUrlSource(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { organizationId } = await requireWorkspace();
  const parsed = UrlInput.safeParse({ url: String(formData.get("url") ?? "").trim() });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const scope = await resolveAgentScope(organizationId, formData.get("agentId"));
  if ("error" in scope) return { error: scope.error };
  const result = await ingestUrl({ organizationId, agentId: scope.agentId }, parsed.data.url);
  return done(result, "Page imported.");
}

export async function uploadFileSource(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { organizationId } = await requireWorkspace();
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a .pdf, .txt or .md file." };
  const isPdf = /\.pdf$/i.test(file.name);
  if (!isPdf && !/\.(txt|md|markdown)$/i.test(file.name)) return { error: "Only .pdf, .txt and .md files for now." };
  if (isPdf && file.size > MAX_PDF_BYTES) return { error: "PDFs can be up to 4 MB." };
  if (!isPdf && file.size > MAX_FILE_BYTES) return { error: "Text files can be up to 1 MB." };
  const scope = await resolveAgentScope(organizationId, formData.get("agentId"));
  if ("error" in scope) return { error: scope.error };
  const title = file.name.slice(0, 200);

  if (!isPdf) {
    const text = await file.text();
    if (text.includes("\u0000")) return { error: "That file does not look like plain text." };
    const result = await ingestText({ organizationId, agentId: scope.agentId, title }, text, "file");
    return done(result, "File added.");
  }

  let pdf: PdfText;
  try {
    pdf = await extractPdfText(new Uint8Array(await file.arrayBuffer()));
  } catch (err) {
    if (err instanceof FetchError) return { error: err.message };
    console.error("pdf extract failed", err);
    return { error: "We could not read that PDF. Try exporting it again." };
  }
  const result = await ingestText({ organizationId, agentId: scope.agentId, title }, pdf.text, "file");
  const cut = pdf.truncated
    ? ` It is long, so only the first ${MAX_PDF_CHARS.toLocaleString("en-US")} characters were kept (about ${pages(pdf.pagesRead)} of ${pdf.totalPages}).`
    : "";
  return done(result, `PDF added: ${pages(pdf.totalPages)}.${cut}`);
}

const SiteInput = z.object({ site: z.string().trim().min(3, "Enter a site address, e.g. example.com.").max(2048) });

export async function importSiteSource(_prev: SiteImportState, formData: FormData): Promise<SiteImportState> {
  const { organizationId } = await requireWorkspace();
  const parsed = SiteInput.safeParse({ site: formData.get("site") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const scope = await resolveAgentScope(organizationId, formData.get("agentId"));
  if ("error" in scope) return { error: scope.error };

  let r: Awaited<ReturnType<typeof importSite>>;
  try {
    r = await importSite({ organizationId, agentId: scope.agentId }, parsed.data.site);
  } catch (err) {
    console.error("site import failed", err);
    revalidatePath("/app/knowledge");
    return { error: "The import stopped because of an error. Pages added so far are in the list below." };
  }
  revalidatePath("/app/knowledge");
  const details = [
    ...r.failed.map((d) => ({ ...d, failed: true })),
    ...r.skipped.map((d) => ({ ...d, failed: false })),
  ];
  // Nothing was found, or nothing new: just the reason.
  if (r.found === 0 || r.found === r.known) return { error: r.error };
  const tried = r.added + r.skipped.length + r.failed.length;
  const foundText = r.found >= MAX_CANDIDATES ? `${MAX_CANDIDATES}+` : String(r.found);
  const known = r.known ? `, ${r.known} already in your knowledge` : "";
  const more = r.found - r.known > tried ? " Run it again to import the next pages." : "";
  const found = r.found > MAX_SITE_PAGES || r.known ? ` Found ${foundText} pages${known}.${more}` : "";
  const via = r.via === "home page" ? " No sitemap found, so we used the links on the home page." : "";
  const summary = `Added ${pages(r.added)}, skipped ${r.skipped.length}, failed ${r.failed.length}.${found}${via}`;
  if (!r.ok) return { error: `${r.error} ${summary}`, details };
  return { ok: true, message: `${r.host}: ${summary}`, details };
}

export async function deleteSource(formData: FormData) {
  const { organizationId } = await requireWorkspace();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  // Chunks go with it (ON DELETE CASCADE).
  await db.delete(knowledgeSources).where(and(eq(knowledgeSources.id, id), eq(knowledgeSources.organizationId, organizationId)));
  revalidatePath("/app/knowledge");
}
