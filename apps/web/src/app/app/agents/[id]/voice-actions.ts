"use server";

import { and, count, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionState } from "@/components/form-bits";
import { db } from "@/db";
import { agents, voiceClones } from "@/db/schema";
import { DEFAULT_VOICE } from "@/lib/agent-defaults";
import { createInstantClone, deleteVoice } from "@/lib/elevenlabs";
import { rateLimit } from "@/lib/rate-limit";
import { requireWorkspace } from "@/lib/session";
import {
  AUDIO_EXTENSIONS,
  audioType,
  CLONE_CONSENT_TEXT,
  cloneValue,
  MAX_VOICE_CLONES,
  VOICE_SAMPLE_MAX_BYTES,
  VOICE_SAMPLE_MIN_BYTES,
} from "@/lib/voices";
import { elevenLabsKey } from "@/lib/voices-server";
import { isOwner } from "./roles";

const CloneForm = z.object({
  agentId: z.string().trim().min(1).max(128),
  name: z.string().trim().min(1, "Give the voice a name.").max(40, "Use a name of up to 40 characters."),
  consent: z.literal("on", { message: "Tick the box to confirm you may clone this voice." }),
  recorded: z.enum(["0", "1"]).default("0"),
});

/** Creates an ElevenLabs instant voice clone from the owner's sample and makes it this agent's voice. */
export async function createVoiceClone(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ws = await requireWorkspace();
  if (!isOwner(ws.role)) return { error: "Only workspace owners can create a brand voice." };
  const apiKey = elevenLabsKey();
  if (!apiKey) return { error: "Brand voices are not available right now." };

  const parsed = CloneForm.safeParse({
    agentId: formData.get("agentId"),
    name: formData.get("name"),
    consent: formData.get("consent") ?? undefined,
    recorded: formData.get("recorded") ?? undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Please check the form." };
  const f = parsed.data;

  const sample = formData.get("sample");
  if (!(sample instanceof File) || sample.size === 0) return { error: "Upload or record a voice sample first." };
  if (sample.size > VOICE_SAMPLE_MAX_BYTES) return { error: "The sample is too big. Use one under 4 MB (about 2 minutes of MP3 is plenty)." };
  if (sample.size < VOICE_SAMPLE_MIN_BYTES) return { error: "The sample is too short. Record at least 30 seconds of clear speech." };
  const bytes = new Uint8Array(await sample.arrayBuffer());
  const type = audioType(bytes);
  if (!type) return { error: "Use an MP3, WAV, M4A, WebM, Ogg or FLAC audio file." };

  // Cloning costs the platform: a few tries per workspace per hour is plenty.
  const limited = rateLimit(`voice-clone:${ws.organizationId}`, 5, 60 * 60 * 1000);
  if (!limited.ok) return { error: `Too many tries. Try again in ${Math.ceil(limited.retryAfterSec / 60)} minutes.` };

  const [agent] = await db
    .select({ id: agents.id })
    .from(agents)
    .where(and(eq(agents.id, f.agentId), eq(agents.organizationId, ws.organizationId)))
    .limit(1);
  if (!agent) return { error: "Agent not found." };
  const [{ n } = { n: 0 }] = await db
    .select({ n: count() })
    .from(voiceClones)
    .where(eq(voiceClones.organizationId, ws.organizationId));
  if (n >= MAX_VOICE_CLONES) return { error: `A workspace can have up to ${MAX_VOICE_CLONES} brand voices. Delete one first.` };

  const made = await createInstantClone(apiKey, {
    // The workspace id makes each voice traceable in the platform's ElevenLabs account.
    name: `Halochime ${ws.organizationId.slice(0, 12)} ${f.name}`.slice(0, 100),
    description: `Brand voice for workspace ${ws.organizationId}, created by user ${ws.user.id} with consent.`,
    sample: new Blob([bytes], { type }),
    fileName: `sample.${AUDIO_EXTENSIONS[type] ?? "audio"}`,
    removeNoise: f.recorded === "1",
  });
  if (!made.ok) return { error: made.error };

  let cloneId: string;
  try {
    const [row] = await db
      .insert(voiceClones)
      .values({
        organizationId: ws.organizationId,
        name: f.name,
        providerVoiceId: made.voiceId,
        consentBy: ws.user.id,
        consentAt: new Date(),
        consentText: CLONE_CONSENT_TEXT,
      })
      .returning({ id: voiceClones.id });
    cloneId = row!.id;
  } catch (e) {
    // Don't leave a voice at ElevenLabs that nothing points to.
    await deleteVoice(apiKey, made.voiceId);
    throw e;
  }
  await db
    .update(agents)
    .set({ ttsVoice: cloneValue(cloneId) })
    .where(and(eq(agents.id, agent.id), eq(agents.organizationId, ws.organizationId)));

  revalidatePath(`/app/agents/${agent.id}`);
  return {
    ok: true,
    message: made.needsVerification
      ? "Voice created. ElevenLabs asks to verify it before it can speak: until then the agent uses the default voice."
      : "Voice created. This agent now speaks with it. Start a test call to hear it.",
  };
}

const DeleteForm = z.object({ agentId: z.string().trim().min(1).max(128), cloneId: z.string().trim().min(1).max(128) });

/** Deletes the clone at ElevenLabs and here; agents that used it go back to the default voice. */
export async function deleteVoiceClone(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ws = await requireWorkspace();
  if (!isOwner(ws.role)) return { error: "Only workspace owners can delete a brand voice." };
  const parsed = DeleteForm.safeParse({ agentId: formData.get("agentId"), cloneId: formData.get("cloneId") });
  if (!parsed.success) return { error: "Voice not found." };

  const [clone] = await db
    .select({ id: voiceClones.id, providerVoiceId: voiceClones.providerVoiceId })
    .from(voiceClones)
    .where(and(eq(voiceClones.id, parsed.data.cloneId), eq(voiceClones.organizationId, ws.organizationId)))
    .limit(1);
  if (!clone) return { error: "Voice not found." };

  const apiKey = elevenLabsKey();
  if (!apiKey) return { error: "The voice can't be deleted at ElevenLabs right now (the platform key is not set). Try again later." };
  const removed = await deleteVoice(apiKey, clone.providerVoiceId);
  if (!removed.ok) return { error: removed.error };

  await db
    .update(agents)
    .set({ ttsVoice: DEFAULT_VOICE })
    .where(and(eq(agents.organizationId, ws.organizationId), eq(agents.ttsVoice, cloneValue(clone.id))));
  await db.delete(voiceClones).where(and(eq(voiceClones.id, clone.id), eq(voiceClones.organizationId, ws.organizationId)));

  revalidatePath("/app/agents", "layout");
  return { ok: true, message: "Voice deleted here and at ElevenLabs. Agents that used it now use the default voice." };
}
