import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { apiError } from "./http";

const digest = (s: string) => createHash("sha256").update(s).digest();

/** Returns an error response unless the request carries `Bearer $INTERNAL_API_SECRET`. */
export function checkInternalAuth(req: Request) {
  const secret = process.env.INTERNAL_API_SECRET;
  if (!secret) return apiError(503, "not_configured", "INTERNAL_API_SECRET is not set on the web app.");
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  // Hash both sides so the comparison is constant time regardless of length.
  if (!token || !timingSafeEqual(digest(token), digest(secret))) {
    return apiError(401, "unauthorized", "Missing or invalid internal API token.");
  }
  return null;
}
