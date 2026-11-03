"use server";

import { and, count, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { WEBHOOK_EVENTS } from "@talkfront/shared";
import type { ActionState } from "@/components/form-bits";
import { db } from "@/db";
import { webhookDeliveries, webhookEndpoints } from "@/db/schema";
import { checkUrl, FetchError } from "@/lib/knowledge/safe-fetch";
import { requireWorkspace } from "@/lib/session";
import { deliverOnce } from "@/lib/webhooks/dispatch";
import { sampleConversationEndedEvent } from "@/lib/webhooks/payloads";
import { openWebhookSecret, sealWebhookSecret } from "@/lib/webhooks/secret";
import { newWebhookSecret } from "@/lib/webhooks/sign";

// Settings -> Webhooks. Owners and admins manage endpoints; every member can read them and their deliveries.
// Every action re-checks the caller's role and that the endpoint belongs to the active workspace.

const MAX_ENDPOINTS = 10;
const MANAGER_ROLES = new Set(["owner", "admin"]);

async function requireManager() {
  const ws = await requireWorkspace();
  return MANAGER_ROLES.has(ws.role) ? ws : null;
}

const IdInput = z.string().trim().min(1).max(128);

const EndpointInput = z.object({
  url: z
    .string()
    .trim()
    .min(1, "Enter the URL that should receive events.")
    .max(2000, "That URL is too long.")
    .superRefine((raw, ctx) => {
      let url: URL;
      try {
        url = checkUrl(raw);
      } catch (err) {
        ctx.addIssue({ code: "custom", message: err instanceof FetchError ? err.message : "That is not a valid URL." });
        return;
      }
      if (url.protocol !== "https:") ctx.addIssue({ code: "custom", message: "Use an https:// URL. Events carry visitor details, so plain http is not allowed." });
    }),
  description: z.string().trim().max(200, "Keep the description under 200 characters."),
  scope: z.enum(["all", "some"]),
  events: z.array(z.enum(WEBHOOK_EVENTS)),
});

export type EndpointFormState = (ActionState & { values?: { url: string; description: string } }) | null;

function parseEndpoint(formData: FormData) {
  const values = {
    url: String(formData.get("url") ?? "").slice(0, 2000),
    description: String(formData.get("description") ?? "").slice(0, 200),
  };
  const parsed = EndpointInput.safeParse({
    url: values.url,
    description: values.description,
    scope: formData.get("scope") === "some" ? "some" : "all",
    events: formData.getAll("events").map(String),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form.", values } as const;
  const { url, description, scope, events } = parsed.data;
  if (scope === "some" && events.length === 0) return { error: "Pick at least one event, or choose All events.", values } as const;
  // Every event ticked is stored as a list too: "All events" is the only way to also get future events.
  return { data: { url, description, events: scope === "all" ? [] : [...new Set(events)] }, values } as const;
}

export async function createWebhookEndpoint(_prev: EndpointFormState, formData: FormData): Promise<EndpointFormState> {
  const ws = await requireManager();
  if (!ws) return { error: "Only owners and admins can add webhooks." };
  const parsed = parseEndpoint(formData);
  if ("error" in parsed) return { error: parsed.error, values: parsed.values };

  const [existing] = await db
    .select({ n: count() })
    .from(webhookEndpoints)
    .where(eq(webhookEndpoints.organizationId, ws.organizationId));
  if ((existing?.n ?? 0) >= MAX_ENDPOINTS) {
    return { error: `A workspace can have up to ${MAX_ENDPOINTS} endpoints. Delete one first.`, values: parsed.values };
  }

  const id = crypto.randomUUID();
  await db
    .insert(webhookEndpoints)
    .values({ id, organizationId: ws.organizationId, secret: sealWebhookSecret(newWebhookSecret(), id), ...parsed.data });
  revalidatePath("/app/settings");
  return { ok: true, message: "Endpoint added. Use Send test event to check it." };
}

export async function updateWebhookEndpoint(_prev: EndpointFormState, formData: FormData): Promise<EndpointFormState> {
  const ws = await requireManager();
  if (!ws) return { error: "Only owners and admins can change webhooks." };
  const id = IdInput.safeParse(formData.get("id"));
  if (!id.success) return { error: "Endpoint not found." };
  const parsed = parseEndpoint(formData);
  if ("error" in parsed) return { error: parsed.error, values: parsed.values };

  const [row] = await db
    .update(webhookEndpoints)
    .set(parsed.data)
    .where(and(eq(webhookEndpoints.id, id.data), eq(webhookEndpoints.organizationId, ws.organizationId)))
    .returning({ id: webhookEndpoints.id });
  if (!row) return { error: "Endpoint not found." };
  revalidatePath("/app/settings");
  return { ok: true, message: "Saved." };
}

export async function setWebhookEnabled(id: string, enabled: boolean): Promise<ActionState> {
  const ws = await requireManager();
  if (!ws) return { error: "Only owners and admins can change webhooks." };
  const parsed = IdInput.safeParse(id);
  if (!parsed.success) return { error: "Endpoint not found." };
  const [row] = await db
    .update(webhookEndpoints)
    .set({ enabled: enabled === true })
    .where(and(eq(webhookEndpoints.id, parsed.data), eq(webhookEndpoints.organizationId, ws.organizationId)))
    .returning({ id: webhookEndpoints.id });
  if (!row) return { error: "Endpoint not found." };
  revalidatePath("/app/settings");
  return { ok: true, message: enabled ? "Endpoint turned on." : "Endpoint paused." };
}

export async function deleteWebhookEndpoint(id: string): Promise<ActionState> {
  const ws = await requireManager();
  if (!ws) return { error: "Only owners and admins can delete webhooks." };
  const parsed = IdInput.safeParse(id);
  if (!parsed.success) return { error: "Endpoint not found." };
  // Deliveries go with it (FK cascade).
  const [row] = await db
    .delete(webhookEndpoints)
    .where(and(eq(webhookEndpoints.id, parsed.data), eq(webhookEndpoints.organizationId, ws.organizationId)))
    .returning({ id: webhookEndpoints.id });
  if (!row) return { error: "Endpoint not found." };
  revalidatePath("/app/settings");
  return { ok: true, message: "Endpoint deleted." };
}

export type SecretState = { ok?: boolean; error?: string; secret?: string };

export async function revealWebhookSecret(id: string): Promise<SecretState> {
  const ws = await requireManager();
  if (!ws) return { error: "Only owners and admins can see signing secrets." };
  const parsed = IdInput.safeParse(id);
  if (!parsed.success) return { error: "Endpoint not found." };
  const [row] = await db
    .select({ id: webhookEndpoints.id, secret: webhookEndpoints.secret })
    .from(webhookEndpoints)
    .where(and(eq(webhookEndpoints.id, parsed.data), eq(webhookEndpoints.organizationId, ws.organizationId)))
    .limit(1);
  return row ? { ok: true, secret: openWebhookSecret(row.secret, row.id) } : { error: "Endpoint not found." };
}

export async function rollWebhookSecret(id: string): Promise<SecretState> {
  const ws = await requireManager();
  if (!ws) return { error: "Only owners and admins can roll signing secrets." };
  const parsed = IdInput.safeParse(id);
  if (!parsed.success) return { error: "Endpoint not found." };
  const secret = newWebhookSecret();
  const [row] = await db
    .update(webhookEndpoints)
    .set({ secret: sealWebhookSecret(secret, parsed.data) })
    .where(and(eq(webhookEndpoints.id, parsed.data), eq(webhookEndpoints.organizationId, ws.organizationId)))
    .returning({ id: webhookEndpoints.id });
  return row ? { ok: true, secret } : { error: "Endpoint not found." };
}

export async function sendWebhookTest(id: string): Promise<ActionState> {
  const ws = await requireManager();
  if (!ws) return { error: "Only owners and admins can send test events." };
  const parsed = IdInput.safeParse(id);
  if (!parsed.success) return { error: "Endpoint not found." };
  const [endpoint] = await db
    .select({
      id: webhookEndpoints.id,
      organizationId: webhookEndpoints.organizationId,
      url: webhookEndpoints.url,
      secret: webhookEndpoints.secret,
    })
    .from(webhookEndpoints)
    .where(and(eq(webhookEndpoints.id, parsed.data), eq(webhookEndpoints.organizationId, ws.organizationId)))
    .limit(1);
  if (!endpoint) return { error: "Endpoint not found." };

  // Sent even when the endpoint is paused or doesn't subscribe to conversation.ended: it is a manual test.
  const result = await deliverOnce(endpoint, await sampleConversationEndedEvent(ws.organizationId));
  revalidatePath("/app/settings");
  return result.ok
    ? { ok: true, message: `Delivered: HTTP ${result.statusCode} in ${result.durationMs} ms.` }
    : { error: `Not delivered. ${result.error ?? ""}`.trim() };
}

export type DeliveryDetail = { payload?: string; error?: string };

/** Full payload of one delivery, loaded when a row is opened (payloads can be large). */
export async function getWebhookDelivery(id: string): Promise<DeliveryDetail> {
  const ws = await requireWorkspace();
  const parsed = IdInput.safeParse(id);
  if (!parsed.success) return { error: "Delivery not found." };
  const [row] = await db
    .select({ payload: webhookDeliveries.payload })
    .from(webhookDeliveries)
    .where(and(eq(webhookDeliveries.id, parsed.data), eq(webhookDeliveries.organizationId, ws.organizationId)))
    .limit(1);
  return row ? { payload: JSON.stringify(row.payload, null, 2) } : { error: "This delivery is no longer stored." };
}
