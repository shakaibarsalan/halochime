import { NextResponse } from "next/server";
import type { ZodType } from "zod";

/** Every API error is `{ error: { code, message } }` (docs/contracts.md). */
export function apiError(status: number, code: string, message: string, headers?: HeadersInit) {
  return NextResponse.json({ error: { code, message } }, { status, headers });
}

/** Parses a JSON body against a zod schema. Returns the data or a ready 400 response. */
export async function parseJson<T>(
  req: Request,
  schema: ZodType<T>,
  headers?: HeadersInit,
): Promise<{ data: T } | { response: NextResponse }> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return { response: apiError(400, "invalid_request", "Body must be JSON.", headers) };
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.length ? `${issue.path.join(".")}: ` : "";
    return { response: apiError(400, "invalid_request", `${where}${issue?.message ?? "Invalid body."}`, headers) };
  }
  return { data: parsed.data };
}

export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}
