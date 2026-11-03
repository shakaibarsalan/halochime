import "server-only";
import { decryptSecret, encryptSecret, isSealed, WEBHOOK_INFO } from "@/lib/actions/crypto";

// Webhook signing secrets are stored encrypted, bound to their endpoint's id (lib/actions/crypto.ts).
// Endpoints made before 3 Nov 2026 may still hold the plain secret ("whsec_..."); it keeps working.

export const sealWebhookSecret = (plain: string, endpointId: string) => encryptSecret(plain, WEBHOOK_INFO, endpointId);

export const openWebhookSecret = (stored: string, endpointId: string) =>
  isSealed(stored) ? decryptSecret(stored, WEBHOOK_INFO, endpointId) : stored;
