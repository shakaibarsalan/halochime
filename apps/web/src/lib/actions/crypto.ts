import "server-only";
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

// Secrets the web app must read back later (action headers, identity and webhook secrets), encrypted at rest.
// AES-256-GCM with a key derived from BETTER_AUTH_SECRET by HKDF-SHA256. Each use has its own HKDF
// `info`, so one key never opens another kind of secret. The row id is bound as additional data, so a
// ciphertext copied onto another row does not decrypt.
//
// Format (versioned so the scheme can change later): "v1.<iv>.<tag>.<ciphertext>", base64url parts.
// Rotating BETTER_AUTH_SECRET makes old values unreadable: owners then re-enter headers / regenerate.

export const HEADERS_INFO = "talkfront-action-headers";
export const IDENTITY_INFO = "talkfront-identity-secret";
export const WEBHOOK_INFO = "talkfront-webhook-secret";
export const CHANNEL_INFO = "talkfront-channel-secrets";
export const INTEGRATION_INFO = "talkfront-integration-secrets";

const VERSION = "v1";
const keys = new Map<string, Buffer>();

function keyFor(info: string): Buffer {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) throw new Error("BETTER_AUTH_SECRET is not set.");
  const cacheKey = `${info}\u0000${secret}`;
  let key = keys.get(cacheKey);
  if (!key) {
    key = Buffer.from(hkdfSync("sha256", secret, Buffer.alloc(0), info, 32));
    keys.set(cacheKey, key);
  }
  return key;
}

export function encryptSecret(plain: string, info: string, rowId: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFor(info), iv);
  cipher.setAAD(Buffer.from(rowId, "utf8"));
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64url"), tag.toString("base64url"), body.toString("base64url")].join(".");
}

/** Throws when the value is not ours, was tampered with, or was made with another BETTER_AUTH_SECRET. */
export function decryptSecret(sealed: string, info: string, rowId: string): string {
  const [version, iv, tag, body, ...rest] = sealed.split(".");
  if (version !== VERSION || !iv || !tag || body === undefined || rest.length) {
    throw new Error("Unknown secret format.");
  }
  const decipher = createDecipheriv("aes-256-gcm", keyFor(info), Buffer.from(iv, "base64url"));
  decipher.setAAD(Buffer.from(rowId, "utf8"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString("utf8");
}

export const isSealed = (value: string) => value.startsWith(`${VERSION}.`);
