import { createHmac, randomBytes } from "node:crypto";

// Webhook signing (docs/integrations.md, "Webhooks"). Stripe-style so receivers can reuse what they know:
//   Halochime-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>

export const SIGNATURE_HEADER = "Halochime-Signature";

/** `whsec_` + 32 random bytes in base64url (43 characters). */
export const newWebhookSecret = () => `whsec_${randomBytes(32).toString("base64url")}`;

export function signatureHeader(secret: string, rawBody: string, unixSeconds: number): string {
  const v1 = createHmac("sha256", secret).update(`${unixSeconds}.${rawBody}`).digest("hex");
  return `t=${unixSeconds},v1=${v1}`;
}

/** Shown in lists instead of the secret: the prefix and the last 4 characters. */
export const maskSecret = (secret: string) => `whsec_${"•".repeat(8)}${secret.slice(-4)}`;
