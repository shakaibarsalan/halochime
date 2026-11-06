// Small JSON-over-HTTP helper for the CRM and calendar clients (pure: no server imports, so the
// clients can be checked with a mock fetch). Only fixed vendor hosts are called through it.

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export const VENDOR_TIMEOUT_MS = 8000;

/** A vendor call failed. `message` is plain and safe to show or log (never a token or the request). */
export class VendorError extends Error {
  constructor(
    message: string,
    readonly status: number | null = null,
    readonly code: string | null = null,
  ) {
    super(message);
  }
}

export type JsonResponse = { status: number; body: unknown };

/** The vendor's own short error text, if any (their "message" field), cut to a safe length. */
export function vendorMessage(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const pick = [b.message, b.error_description, b.error, (b.error as Record<string, unknown> | undefined)?.message, b.msg];
  const first = pick.find((x) => typeof x === "string" && x.trim());
  return typeof first === "string" ? first.replace(/\s+/g, " ").trim().slice(0, 200) : null;
}

/**
 * Calls the vendor and parses JSON. Non-2xx throws VendorError with the status and the vendor's
 * message; `allow` lists extra statuses to return instead (e.g. 404 = not found).
 */
export async function requestJson(
  fetchImpl: FetchLike,
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: unknown; form?: Record<string, string>; allow?: number[]; timeoutMs?: number; vendor: string },
): Promise<JsonResponse> {
  const headers: Record<string, string> = { accept: "application/json", ...init.headers };
  let body: string | undefined;
  if (init.form) {
    headers["content-type"] = "application/x-www-form-urlencoded";
    body = new URLSearchParams(init.form).toString();
  } else if (init.body !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(init.body);
  }
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: init.method ?? "GET",
      headers,
      body,
      redirect: "error",
      signal: AbortSignal.timeout(init.timeoutMs ?? VENDOR_TIMEOUT_MS),
    });
  } catch (err) {
    const name = (err as { name?: string })?.name;
    if (name === "TimeoutError" || name === "AbortError") throw new VendorError(`${init.vendor} did not answer in time.`);
    throw new VendorError(`Could not reach ${init.vendor}.`);
  }
  const text = await res.text().catch(() => "");
  let parsed: unknown = null;
  if (text.trim()) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
  }
  if ((res.status >= 200 && res.status < 300) || init.allow?.includes(res.status)) return { status: res.status, body: parsed };
  const said = vendorMessage(parsed);
  const why =
    res.status === 401
      ? "the saved credentials were refused"
      : res.status === 403
        ? "the credentials are missing a permission (scope)"
        : res.status === 429
          ? "too many requests right now"
          : `error ${res.status}`;
  throw new VendorError(`${init.vendor} answered: ${why}${said ? ` (${said})` : ""}.`, res.status);
}

export const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
export const s = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);
