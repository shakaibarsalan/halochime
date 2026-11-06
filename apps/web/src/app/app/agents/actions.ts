"use server";

import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { WIDGET_APPEARANCES, WIDGET_ICONS, WIDGET_IMAGE_MAX_BYTES } from "@talkfront/shared";
import { z } from "zod";
import type { ActionState } from "@/components/form-bits";
import { db } from "@/db";
import { agentImages, agents, voiceClones } from "@/db/schema";
import { LLM_MODELS, newAgentValues, STT_MODELS, TTS_VOICES } from "@/lib/agent-defaults";
import { LANGUAGES } from "@/lib/languages";
import { requireWorkspace } from "@/lib/session";
import { isSelectableVoice } from "@/lib/voices";
import { enabledVoiceProviders } from "@/lib/voices-server";
import { normalizeDomain } from "@/lib/widget-origin";
import { canManageIntegrations } from "./[id]/roles";

export async function createAgent() {
  const ws = await requireWorkspace();
  const [agent] = await db
    .insert(agents)
    .values(newAgentValues(ws.organizationId, ws.organizationName, "New agent"))
    .returning({ id: agents.id });
  revalidatePath("/app/agents");
  redirect(`/app/agents/${agent!.id}`);
}

const oneOf = (values: { value: string }[]) => z.enum(values.map((v) => v.value) as [string, ...string[]]);

const AgentForm = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1, "Name is required.").max(80),
  persona: z.string().trim().max(1000),
  instructions: z.string().trim().max(8000),
  greeting: z.string().trim().min(1, "Greeting is required.").max(500),
  language: z.enum(LANGUAGES.map((l) => l.code) as [string, ...string[]]),
  sttModel: oneOf(STT_MODELS),
  // Checked against the voices this workspace may pick once the agent is loaded (see isSelectableVoice).
  ttsVoice: z.string().trim().min(1).max(200),
  llmModel: oneOf(LLM_MODELS),
  maxDurationMin: z.coerce.number().int().min(1).max(60),
  handoffEnabled: z.boolean(),
  handoffEmail: z.union([z.literal(""), z.email("Handoff email is not a valid email.").max(320)]),
  themeColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Colour must look like #4f46e5."),
  themePosition: z.enum(["bottom-right", "bottom-left"]),
  themeLabel: z.string().trim().min(1, "Button label is required.").max(40),
  themeIcon: z.enum(WIDGET_ICONS),
  themeAppearance: z.enum(WIDGET_APPEARANCES),
  modes: z.array(z.enum(["voice", "text"])).min(1, "Turn on at least one mode (voice or text)."),
  allowedDomains: z.string().max(5000),
  published: z.boolean(),
});

export async function saveAgent(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { organizationId, role } = await requireWorkspace();
  // Where visitor details are emailed, where the agent loads and whether it is live are for owners and
  // admins (like webhooks): a plain member's save keeps the stored values for those three.
  const manager = canManageIntegrations(role);
  const parsed = AgentForm.safeParse({
    ...Object.fromEntries(formData),
    // Locked (so not sent) for plain members; their values are ignored below anyway.
    handoffEmail: formData.get("handoffEmail") ?? "",
    allowedDomains: formData.get("allowedDomains") ?? "",
    handoffEnabled: formData.get("handoffEnabled") === "on",
    published: formData.get("published") === "on",
    modes: formData.getAll("modes"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Please check the form." };
  const f = parsed.data;

  const domains: string[] = [];
  for (const raw of f.allowedDomains.split(/[\s,]+/).filter(Boolean)) {
    const d = normalizeDomain(raw);
    if (!d) return { error: `"${raw}" is not a valid domain. Use e.g. example.com or *.example.com.` };
    if (!domains.includes(d)) domains.push(d);
  }
  if (domains.length > 50) return { error: "Up to 50 allowed domains." };

  const [current] = await db
    .select({
      theme: agents.theme,
      handoffEmail: agents.handoffEmail,
      allowedDomains: agents.allowedDomains,
      status: agents.status,
      ttsVoice: agents.ttsVoice,
    })
    .from(agents)
    .where(and(eq(agents.id, f.id), eq(agents.organizationId, organizationId)))
    .limit(1);
  if (!current) return { error: "Agent not found." };

  if (f.ttsVoice !== current.ttsVoice) {
    const clones = await db
      .select({ id: voiceClones.id })
      .from(voiceClones)
      .where(eq(voiceClones.organizationId, organizationId));
    const allowed = isSelectableVoice(f.ttsVoice, {
      base: TTS_VOICES,
      enabled: enabledVoiceProviders(),
      cloneIds: clones.map((c) => c.id),
      current: current.ttsVoice,
    });
    if (!allowed) return { error: "Pick one of the voices in the list." };
  }

  let imageVersion = current.theme.imageVersion;
  const upload = formData.get("themeImage");
  if (upload instanceof File && upload.size > 0) {
    if (upload.size > WIDGET_IMAGE_MAX_BYTES) return { error: "The picture is too big. Use one under 300 KB." };
    const bytes = new Uint8Array(await upload.arrayBuffer());
    const contentType = imageType(bytes);
    if (!contentType) return { error: "Use a PNG, JPG or WebP picture." };
    const data = Buffer.from(bytes).toString("base64");
    await db
      .insert(agentImages)
      .values({ agentId: f.id, contentType, data })
      .onConflictDoUpdate({ target: agentImages.agentId, set: { contentType, data, updatedAt: new Date() } });
    imageVersion = createHash("sha256").update(bytes).digest("hex").slice(0, 12);
  }
  if (f.themeIcon === "image" && !imageVersion) {
    return { error: "Upload a picture for the icon, or pick one of the icons." };
  }

  const updated = await db
    .update(agents)
    .set({
      name: f.name,
      persona: f.persona,
      instructions: f.instructions,
      greeting: f.greeting,
      language: f.language,
      sttModel: f.sttModel,
      ttsVoice: f.ttsVoice,
      llmModel: f.llmModel,
      maxDurationSec: f.maxDurationMin * 60,
      handoffEnabled: f.handoffEnabled,
      handoffEmail: manager ? f.handoffEmail || null : current.handoffEmail,
      theme: {
        color: f.themeColor.toLowerCase(),
        position: f.themePosition,
        label: f.themeLabel,
        icon: f.themeIcon,
        appearance: f.themeAppearance,
        ...(imageVersion ? { imageVersion } : {}),
      },
      modes: f.modes,
      allowedDomains: manager ? domains : current.allowedDomains,
      status: manager ? (f.published ? "published" : "draft") : current.status,
    })
    .where(and(eq(agents.id, f.id), eq(agents.organizationId, organizationId)))
    .returning({ id: agents.id });
  if (updated.length === 0) return { error: "Agent not found." };

  revalidatePath("/app/agents");
  revalidatePath(`/app/agents/${f.id}`);
  return {
    ok: true,
    message: manager && f.published && domains.length === 0
      ? "Saved. It is published, but add your website's domain so it can load there."
      : "Saved.",
  };
}

/** PNG, JPEG or WebP, judged by the file's first bytes (never by its name or the browser's claim). */
function imageType(b: Uint8Array): string | null {
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  const ascii = (from: number, to: number) => String.fromCharCode(...b.subarray(from, to));
  if (b.length > 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  return null;
}
