"use server";

import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionState } from "@/components/form-bits";
import { db } from "@/db";
import { workspaceBranding } from "@/db/schema";
import { isOwnerRole, LOGO_MAX_BYTES, logoImageType } from "@/lib/branding/logo";
import { cleanBrandUrl } from "@/lib/branding/powered-by";
import { requireWorkspace } from "@/lib/session";

const BrandingForm = z
  .object({
    poweredBy: z.enum(["halochime", "hidden", "custom"], { error: "Choose what the widget shows." }),
    poweredByLabel: z.string().trim().max(40, "Keep the name under 40 characters."),
    poweredByUrl: z.string().trim().max(500, "Keep the link under 500 characters."),
    brandName: z.string().trim().max(60, "Keep the brand name under 60 characters."),
    removeLogo: z.boolean(),
  })
  .superRefine((v, ctx) => {
    if (v.poweredBy !== "custom") return;
    if (!v.poweredByLabel) ctx.addIssue({ code: "custom", message: "Write the name to show under the chat." });
    else if (!cleanBrandUrl(v.poweredByUrl)) ctx.addIssue({ code: "custom", message: "The link must start with https:// (or http://)." });
  });

/** White label settings: the widget's "by ..." line and the dashboard brand. Owners only. */
export async function saveBranding(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ws = await requireWorkspace();
  if (!isOwnerRole(ws.role)) return { error: "Only owners can change the white label settings." };
  const parsed = BrandingForm.safeParse({
    poweredBy: formData.get("poweredBy"),
    poweredByLabel: formData.get("poweredByLabel") ?? "",
    poweredByUrl: formData.get("poweredByUrl") ?? "",
    brandName: formData.get("brandName") ?? "",
    removeLogo: formData.get("removeLogo") === "on",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form." };
  const f = parsed.data;

  let logo: { logoContentType: string | null; logoData: string | null; logoVersion: string | null } | null = null;
  const upload = formData.get("logo");
  if (upload instanceof File && upload.size > 0) {
    if (upload.size > LOGO_MAX_BYTES) return { error: "The logo is too big. Use one under 100 KB." };
    const bytes = new Uint8Array(await upload.arrayBuffer());
    const type = logoImageType(bytes);
    if (!type) return { error: "Use a PNG, JPG or WebP logo." };
    logo = {
      logoContentType: type,
      logoData: Buffer.from(bytes).toString("base64"),
      logoVersion: createHash("sha256").update(bytes).digest("hex").slice(0, 12),
    };
  } else if (f.removeLogo) {
    logo = { logoContentType: null, logoData: null, logoVersion: null };
  }

  const values = {
    poweredBy: f.poweredBy,
    poweredByLabel: f.poweredBy === "custom" ? f.poweredByLabel : null,
    poweredByUrl: f.poweredBy === "custom" ? cleanBrandUrl(f.poweredByUrl) : null,
    brandName: f.brandName || null,
    ...(logo ?? {}),
  };
  await db
    .insert(workspaceBranding)
    .values({ organizationId: ws.organizationId, ...values })
    .onConflictDoUpdate({ target: workspaceBranding.organizationId, set: { ...values, updatedAt: new Date() } });

  revalidatePath("/app", "layout");
  return { ok: true, message: "Saved. The widget shows the change on its next load." };
}

export async function resetBranding(_prev: ActionState): Promise<ActionState> {
  const ws = await requireWorkspace();
  if (!isOwnerRole(ws.role)) return { error: "Only owners can change the white label settings." };
  await db.delete(workspaceBranding).where(eq(workspaceBranding.organizationId, ws.organizationId));
  revalidatePath("/app", "layout");
  return { ok: true, message: "Back to Halochime." };
}
