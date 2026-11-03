import "server-only";
import { and, eq, lt, sql } from "drizzle-orm";
import type { WebhookEvent } from "@talkfront/shared";
import { db } from "@/db";
import { webhookDeliveries, webhookEndpoints } from "@/db/schema";
import { FetchError, safeRequest } from "@/lib/knowledge/safe-fetch";
import { conversationEndedEvent, handoffEvent, type WebhookEnvelope } from "./payloads";
import { SIGNATURE_HEADER, signatureHeader } from "./sign";

// Sends events to the business's webhook endpoints (docs/integrations.md, "Webhooks").
// Runs inside after() in the internal routes, so nothing here ever slows the voice agent down.

const TIMEOUT_MS = 10_000;
/** Wait before each attempt: immediately, then +2 s, then +10 s. Same event id on every attempt. */
const ATTEMPT_DELAYS_MS = [0, 2_000, 10_000];
const KEEP_DAYS = 30;
const PRUNE_EVERY_MS = 60 * 60 * 1000;
/** Echo services answer with our whole body, so allow a large reply; we never store it. */
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

type Endpoint = { id: string; organizationId: string; url: string; secret: string };

export type AttemptResult = {
  ok: boolean;
  statusCode: number | null;
  error: string | null;
  durationMs: number;
  attempt: number;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** One POST, recorded as one webhook_deliveries row. Never throws. */
async function attemptOnce(endpoint: Endpoint, event: WebhookEnvelope, rawBody: string, attempt: number): Promise<AttemptResult> {
  const started = Date.now();
  let statusCode: number | null = null;
  let error: string | null = null;
  try {
    const t = Math.floor(Date.now() / 1000);
    const res = await safeRequest(endpoint.url, {
      method: "POST",
      timeoutMs: TIMEOUT_MS,
      maxBytes: MAX_RESPONSE_BYTES,
      headers: {
        "content-type": "application/json",
        "user-agent": "Halochime-Webhooks/1",
        [SIGNATURE_HEADER]: signatureHeader(endpoint.secret, rawBody, t),
        "Halochime-Event": event.type,
        "Halochime-Event-Id": event.id,
      },
      body: rawBody,
    });
    statusCode = res.status;
    if (res.status < 200 || res.status >= 300) {
      const snippet = res.body.replace(/\s+/g, " ").trim().slice(0, 300);
      error = res.status >= 300 && res.status < 400
        ? `Answered with a redirect (HTTP ${res.status}). Webhooks don't follow redirects: use the final URL.`
        : `Answered with HTTP ${res.status}${snippet ? `: ${snippet}` : "."}`;
    }
  } catch (err) {
    error = err instanceof FetchError ? err.message : "Could not reach the URL.";
    if (!(err instanceof FetchError)) console.error("webhook delivery failed", err);
  }
  const result: AttemptResult = { ok: error === null, statusCode, error, durationMs: Date.now() - started, attempt };
  try {
    await db.insert(webhookDeliveries).values({
      organizationId: endpoint.organizationId,
      endpointId: endpoint.id,
      event: event.type,
      eventId: event.id,
      payload: event,
      attempt,
      ok: result.ok,
      statusCode,
      error,
      durationMs: result.durationMs,
    });
  } catch (err) {
    // The endpoint may have been deleted mid-delivery (FK cascade); the attempt itself still happened.
    console.error("webhook delivery log failed", err);
  }
  return result;
}

/** Up to 3 attempts until one answers 2xx. Returns the last attempt. */
async function deliver(endpoint: Endpoint, event: WebhookEnvelope): Promise<AttemptResult> {
  const rawBody = JSON.stringify(event);
  let last: AttemptResult | null = null;
  for (let i = 0; i < ATTEMPT_DELAYS_MS.length; i++) {
    if (ATTEMPT_DELAYS_MS[i]) await sleep(ATTEMPT_DELAYS_MS[i]!);
    last = await attemptOnce(endpoint, event, rawBody, i + 1);
    if (last.ok) break;
  }
  return last!;
}

/** Sends one attempt only, for "Send test event", so the dashboard gets an answer right away. */
export function deliverOnce(endpoint: Endpoint, event: WebhookEnvelope): Promise<AttemptResult> {
  return attemptOnce(endpoint, event, JSON.stringify(event), 1);
}

/** Enabled endpoints of the workspace that want this event (an empty list means every event). */
async function endpointsFor(workspaceId: string, event: WebhookEvent): Promise<Endpoint[]> {
  return db
    .select({
      id: webhookEndpoints.id,
      organizationId: webhookEndpoints.organizationId,
      url: webhookEndpoints.url,
      secret: webhookEndpoints.secret,
    })
    .from(webhookEndpoints)
    .where(
      and(
        eq(webhookEndpoints.organizationId, workspaceId),
        eq(webhookEndpoints.enabled, true),
        sql`(cardinality(${webhookEndpoints.events}) = 0 or ${event} = any(${webhookEndpoints.events}))`,
      ),
    );
}

let lastPrune = 0;

/** Deletes delivery rows older than 30 days, at most once an hour per server instance. */
async function pruneOldDeliveries(): Promise<void> {
  if (Date.now() - lastPrune < PRUNE_EVERY_MS) return;
  lastPrune = Date.now();
  try {
    await db.delete(webhookDeliveries).where(lt(webhookDeliveries.createdAt, sql`now() - make_interval(days => ${KEEP_DAYS})`));
  } catch (err) {
    console.error("webhook delivery prune failed", err);
  }
}

async function fanOut(event: WebhookEnvelope | null): Promise<void> {
  if (!event) return;
  await pruneOldDeliveries();
  const targets = await endpointsFor(event.workspace_id, event.type);
  // Endpoints are independent: a slow or failing one never delays the others.
  await Promise.allSettled(targets.map((e) => deliver(e, event)));
}

export async function webhooksOnHandoff(handoffId: string, created: boolean): Promise<void> {
  await fanOut(await handoffEvent(handoffId, created));
}

export async function webhooksOnConversationEnded(conversationId: string): Promise<void> {
  await fanOut(await conversationEndedEvent(conversationId));
}
