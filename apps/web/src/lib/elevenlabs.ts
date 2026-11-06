import "server-only";

// ElevenLabs instant voice cloning with the platform key (ELEVENLABS_API_KEY). The key never reaches the
// browser, and ElevenLabs' raw responses are never shown: only a short, plain reason.

const API = "https://api.elevenlabs.io/v1";
const TIMEOUT_MS = 60_000;

export type CloneResult = { ok: true; voiceId: string; needsVerification: boolean } | { ok: false; error: string };

function reason(status: number, detail: string | null): string {
  if (status === 401 || status === 403) return "ElevenLabs refused the platform key, or the plan does not include voice cloning.";
  if (status === 429) return "ElevenLabs is busy or the plan's limit is reached. Try again later.";
  if (status === 400 || status === 422) {
    return detail ? `ElevenLabs could not use this sample: ${detail}` : "ElevenLabs could not use this sample. Try a longer, clearer recording.";
  }
  return "ElevenLabs could not make the voice right now. Try again in a minute.";
}

/** A short, safe message from an ElevenLabs error body, if it has one. */
function detailOf(body: unknown): string | null {
  const d = (body as { detail?: unknown } | null)?.detail;
  const msg =
    typeof d === "string"
      ? d
      : Array.isArray(d)
        ? (d[0] as { msg?: unknown } | undefined)?.msg
        : (d as { message?: unknown } | undefined)?.message;
  if (typeof msg !== "string" || !msg.trim()) return null;
  return msg.replace(/\s+/g, " ").trim().slice(0, 200);
}

export async function createInstantClone(
  apiKey: string,
  input: { name: string; description: string; sample: Blob; fileName: string; removeNoise: boolean },
): Promise<CloneResult> {
  const form = new FormData();
  form.set("name", input.name);
  form.set("description", input.description);
  form.set("remove_background_noise", input.removeNoise ? "true" : "false");
  form.append("files", input.sample, input.fileName);
  let res: Response;
  try {
    res = await fetch(`${API}/voices/add`, {
      method: "POST",
      headers: { "xi-api-key": apiKey },
      body: form,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    return { ok: false, error: "Could not reach ElevenLabs. Try again in a minute." };
  }
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) return { ok: false, error: reason(res.status, detailOf(body)) };
  const voiceId = (body as { voice_id?: unknown } | null)?.voice_id;
  if (typeof voiceId !== "string" || !/^[A-Za-z0-9]{8,64}$/.test(voiceId)) {
    return { ok: false, error: "ElevenLabs did not return a voice. Try again in a minute." };
  }
  return { ok: true, voiceId, needsVerification: (body as { requires_verification?: unknown }).requires_verification === true };
}

/** Deletes the voice at ElevenLabs. A voice that is already gone counts as deleted. */
export async function deleteVoice(apiKey: string, voiceId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!/^[A-Za-z0-9]{8,64}$/.test(voiceId)) return { ok: true }; // never ours: nothing to delete there
  try {
    const res = await fetch(`${API}/voices/${encodeURIComponent(voiceId)}`, {
      method: "DELETE",
      headers: { "xi-api-key": apiKey },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    if (res.ok || res.status === 404) return { ok: true };
    if (res.status === 400) {
      // ElevenLabs answers 400 for an id it does not know.
      const detail = detailOf(await res.json().catch(() => null));
      if (detail && /not found|does not exist/i.test(detail)) return { ok: true };
    }
    return { ok: false, error: reason(res.status, null).replace("make the voice", "delete the voice") };
  } catch {
    return { ok: false, error: "Could not reach ElevenLabs to delete the voice. Try again in a minute." };
  }
}
