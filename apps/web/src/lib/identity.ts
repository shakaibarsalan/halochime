import "server-only";
import { decodeJwt, decodeProtectedHeader, errors, jwtVerify } from "jose";
import { IdentityTokenClaims } from "@talkfront/shared";
import { decryptSecret, encryptSecret, IDENTITY_INFO, isSealed } from "./actions/crypto";
import { randomUrlSafe } from "./ids";

// Identity tokens: the business's server signs the logged-in user (HS256, the agent's identity secret),
// the widget passes the token on, and POST /api/widget/session checks it here. Spec: docs/integrations.md §3.

export const MAX_TOKEN_LIFETIME_SEC = 24 * 60 * 60;
export const CLOCK_SKEW_SEC = 60;
export const MAX_ATTRIBUTES = 30;
const ATTRIBUTE_KEY = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;

export const newIdentitySecret = () => `tfid_${randomUrlSafe(48)}`;

/** The secret is stored encrypted, bound to the agent id. */
export const sealIdentitySecret = (secret: string, agentId: string) => encryptSecret(secret, IDENTITY_INFO, agentId);

export function openIdentitySecret(stored: string, agentId: string): string {
  // Plain values (written before encryption existed, or by hand in a dev DB) still work.
  return isSealed(stored) ? decryptSecret(stored, IDENTITY_INFO, agentId) : stored;
}

export type IdentityCheck =
  | { ok: true; claims: IdentityTokenClaims }
  | {
      ok: false;
      /** Short code for server logs. */
      code: string;
      /** Exact, plain problem for the dashboard token checker. */
      reason: string;
      /** The token's claims, unverified, when they could be read (dashboard checker only). */
      decoded?: Record<string, unknown>;
    };

/** e.g. "2026-10-25 14:27:27 UTC" */
const when = (sec: number) => `${new Date(sec * 1000).toISOString().slice(0, 19).replace("T", " ")} UTC`;

function checkAttributes(value: unknown): string | null {
  if (value === undefined) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) return "attributes must be a flat object, e.g. { \"plan\": \"pro\" }.";
  const entries = Object.entries(value);
  if (entries.length > MAX_ATTRIBUTES) return `attributes has ${entries.length} keys; at most ${MAX_ATTRIBUTES} are allowed.`;
  for (const [k, v] of entries) {
    if (!ATTRIBUTE_KEY.test(k)) return `attributes key "${k.slice(0, 60)}" is not allowed: start with a letter, then letters, numbers or _ (at most 40).`;
    if (typeof v === "string") {
      if (v.length > 500) return `attributes.${k} is ${v.length} characters long; at most 500 are allowed.`;
    } else if (typeof v === "number") {
      if (!Number.isFinite(v)) return `attributes.${k} must be a finite number.`;
    } else if (typeof v !== "boolean") {
      return `attributes.${k} must be a string, number or boolean (no objects, lists or null).`;
    }
  }
  return null;
}

function safeDecode(token: string): Record<string, unknown> | undefined {
  try {
    return decodeJwt(token) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

/**
 * Verifies an identity token with the agent's (plain) secret: HS256 only, `exp` required and at most
 * 24 h after `iat`, 60 s clock skew, then the claims against IdentityTokenClaims.
 * Never throws. Never log the token itself, only `code`.
 */
export async function verifyIdentityToken(token: string, secret: string, now = Math.floor(Date.now() / 1000)): Promise<IdentityCheck> {
  const raw = token.trim();
  if (!raw) return { ok: false, code: "empty", reason: "The token is empty." };
  if (raw.split(".").length !== 3) {
    return { ok: false, code: "malformed", reason: "This is not a JWT. A token has three parts separated by dots: header.payload.signature." };
  }
  let alg: unknown;
  try {
    alg = decodeProtectedHeader(raw).alg;
  } catch {
    return { ok: false, code: "malformed", reason: "The token header could not be read. Make sure you pasted the whole token." };
  }
  const decoded = safeDecode(raw);
  if (alg !== "HS256") {
    return { ok: false, code: "bad_alg", reason: `The token is signed with ${typeof alg === "string" ? alg : "an unknown algorithm"}. Only HS256 is accepted.`, decoded };
  }

  let payload: Record<string, unknown>;
  try {
    const result = await jwtVerify(raw, new TextEncoder().encode(secret), {
      algorithms: ["HS256"],
      clockTolerance: CLOCK_SKEW_SEC,
      currentDate: new Date(now * 1000),
      requiredClaims: ["sub", "iat", "exp"],
    });
    payload = result.payload as Record<string, unknown>;
  } catch (err) {
    if (err instanceof errors.JWSSignatureVerificationFailed) {
      return { ok: false, code: "bad_signature", reason: "The signature does not match this agent's identity secret. Sign with the current secret (it changes when you regenerate it).", decoded };
    }
    if (err instanceof errors.JWTExpired) {
      const exp = typeof decoded?.exp === "number" ? decoded.exp : null;
      return { ok: false, code: "expired", reason: exp ? `The token expired at ${when(exp)}. Sign a fresh one for each page load.` : "The token has expired.", decoded };
    }
    if (err instanceof errors.JWTClaimValidationFailed) {
      if (err.reason === "missing") return { ok: false, code: "missing_claim", reason: `The "${err.claim}" claim is missing. sub, iat and exp are required.`, decoded };
      if (err.claim === "nbf") return { ok: false, code: "not_yet_valid", reason: "The token is not valid yet (nbf is in the future).", decoded };
      return { ok: false, code: "bad_claim", reason: `The "${err.claim}" claim is not valid: ${err.message}.`, decoded };
    }
    if (err instanceof errors.JWTInvalid || err instanceof errors.JWSInvalid) {
      return { ok: false, code: "malformed", reason: "The token could not be read. Make sure you pasted the whole token.", decoded };
    }
    return { ok: false, code: "invalid", reason: "The token could not be verified.", decoded };
  }

  const iat = payload.iat;
  const exp = payload.exp;
  if (typeof iat !== "number" || typeof exp !== "number") {
    return { ok: false, code: "bad_claim", reason: "iat and exp must be numbers (seconds since 1970).", decoded: payload };
  }
  if (iat > now + CLOCK_SKEW_SEC) {
    return { ok: false, code: "iat_future", reason: `The token was issued in the future (iat ${when(iat)}). Check your server's clock.`, decoded: payload };
  }
  if (exp - iat > MAX_TOKEN_LIFETIME_SEC) {
    const hours = Math.round(((exp - iat) / 3600) * 10) / 10;
    return { ok: false, code: "too_long", reason: `The token is valid for ${hours} hours; at most 24 hours are allowed. Use a shorter expiry, e.g. 1 hour.`, decoded: payload };
  }
  if (typeof payload.sub !== "string" || !payload.sub) {
    return { ok: false, code: "bad_claim", reason: "sub must be a non-empty string: your user id.", decoded: payload };
  }
  const attributeProblem = checkAttributes(payload.attributes);
  if (attributeProblem) return { ok: false, code: "bad_attributes", reason: attributeProblem, decoded: payload };

  const parsed = IdentityTokenClaims.safeParse(payload);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.length ? `${issue.path.join(".")}: ` : "";
    return { ok: false, code: "bad_claim", reason: `${where}${issue?.message ?? "Invalid claims."}`, decoded: payload };
  }
  // Store a normalised copy: empty strings count as "not given".
  const claims = parsed.data;
  return {
    ok: true,
    claims: {
      ...claims,
      name: claims.name?.trim() || undefined,
      email: claims.email?.trim() || undefined,
    },
  };
}
