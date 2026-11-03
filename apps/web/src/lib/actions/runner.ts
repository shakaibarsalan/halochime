import "server-only";
import type { ActionParameter, RunActionResponse } from "@talkfront/shared";
import type { agentActions } from "@/db/schema";
import { FetchError, safeRequest } from "@/lib/knowledge/safe-fetch";
import { decryptSecret, encryptSecret, HEADERS_INFO } from "./crypto";
import { DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS, MIN_TIMEOUT_MS, validateArguments } from "./schema";

type ActionRow = typeof agentActions.$inferSelect;

export const MAX_RESULT_CHARS = 4000;
const MAX_RESPONSE_BYTES = 512 * 1024;

export type ActionHeaders = Record<string, string>;

export function sealHeaders(headers: ActionHeaders, actionId: string): string | null {
  return Object.keys(headers).length ? encryptSecret(JSON.stringify(headers), HEADERS_INFO, actionId) : null;
}

/** Saved headers of an action. Throws when they cannot be decrypted (e.g. BETTER_AUTH_SECRET changed). */
export function openHeaders(action: Pick<ActionRow, "id" | "headersEncrypted">): ActionHeaders {
  if (!action.headersEncrypted) return {};
  const parsed: unknown = JSON.parse(decryptSecret(action.headersEncrypted, HEADERS_INFO, action.id));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const out: ActionHeaders = {};
  for (const [k, v] of Object.entries(parsed)) if (typeof v === "string") out[k] = v;
  return out;
}

export const clampTimeout = (ms: number | null | undefined) =>
  Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, Math.round(ms ?? DEFAULT_TIMEOUT_MS)));

function cut(text: string, max = MAX_RESULT_CHARS): string {
  return text.length <= max ? text : `${text.slice(0, max - 20)}... [cut, too long]`;
}

/** Compact JSON (fewer characters for the model) when the body is JSON; plain text otherwise. */
function readable(body: string, contentType: string): string {
  const trimmed = body.trim();
  if (/json/i.test(contentType) || /^[[{]/.test(trimmed)) {
    try {
      return JSON.stringify(JSON.parse(trimmed));
    } catch {
      // not JSON after all
    }
  }
  if (/html/i.test(contentType)) {
    return trimmed.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  }
  return trimmed;
}

export type ActionRunResult = RunActionResponse & {
  durationMs: number;
  /** What was called, for the dashboard test (never includes headers). */
  request: { method: "GET" | "POST"; url: string; body: string | null };
};

/**
 * Runs one action: validates the arguments, then calls the business's URL with `safeRequest`
 * (SSRF-safe). Never throws; every failure comes back as ok=false with a plain reason the model
 * can say out loud.
 */
export async function runAction(
  action: Pick<ActionRow, "id" | "name" | "method" | "url" | "headersEncrypted" | "parameters" | "timeoutMs">,
  rawArgs: Record<string, unknown>,
  context: { conversationId: string; verifiedVisitorId: string | null },
): Promise<ActionRunResult> {
  const started = Date.now();
  const method = action.method;
  const fail = (result: string, status: number | null = null, request: ActionRunResult["request"] = { method, url: action.url, body: null }): ActionRunResult => ({
    ok: false,
    status,
    result,
    durationMs: Date.now() - started,
    request,
  });

  const checked = validateArguments(action.parameters as ActionParameter[], rawArgs);
  if (!checked.ok) return fail(checked.reason);

  let saved: ActionHeaders;
  try {
    saved = openHeaders(action);
  } catch (err) {
    console.error(`action ${action.id}: saved headers could not be decrypted`, (err as Error).message);
    return fail("This action's saved settings could not be read, so it was not run. The business needs to re-save it.");
  }

  let url: URL;
  try {
    url = new URL(action.url);
  } catch {
    return fail("This action has an invalid URL, so it was not run.");
  }
  let body: string | null = null;
  if (method === "GET") {
    for (const [k, v] of Object.entries(checked.args)) url.searchParams.set(k, String(v));
  } else {
    body = JSON.stringify(checked.args);
  }
  const request = { method, url: url.toString(), body };

  const headers: Record<string, string> = {
    accept: "application/json, text/plain;q=0.9, */*;q=0.5",
    ...saved,
    "x-halochime-conversation": context.conversationId,
  };
  if (body !== null) headers["content-type"] = "application/json";
  if (context.verifiedVisitorId) headers["x-halochime-visitor"] = context.verifiedVisitorId;

  try {
    const res = await safeRequest(url.toString(), {
      method,
      headers,
      body: body ?? undefined,
      timeoutMs: clampTimeout(action.timeoutMs),
      maxBytes: MAX_RESPONSE_BYTES,
    });
    const text = readable(res.body, res.contentType);
    if (res.status >= 200 && res.status < 300) {
      return { ok: true, status: res.status, result: cut(text) || "Done. The service returned no data.", durationMs: Date.now() - started, request };
    }
    const details = text ? ` It said: ${cut(text, 600)}` : "";
    return fail(`The service answered with an error (HTTP ${res.status}).${details}`, res.status, request);
  } catch (err) {
    if (err instanceof FetchError) {
      const msg = err.message.replace("within 1 seconds", "within 1 second");
      // safeRequest's messages are already plain ("No answer within 8 seconds."); hide raw socket errors.
      return fail(msg.startsWith("Could not reach the URL") ? "Could not reach the service." : msg, null, request);
    }
    console.error(`action ${action.id} failed unexpectedly`, (err as Error).message);
    return fail("The action could not be run because of an unexpected error.", null, request);
  }
}
