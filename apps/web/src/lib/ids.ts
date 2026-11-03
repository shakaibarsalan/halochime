import { randomBytes } from "node:crypto";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** `length` random url-safe characters with no modulo bias (64-char alphabet). */
export function randomUrlSafe(length: number): string {
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) out += ALPHABET[bytes[i]! & 63];
  return out;
}

export const newPublicKey = () => `pk_${randomUrlSafe(24)}`;
