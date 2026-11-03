import { asc, desc, eq } from "drizzle-orm";
import { Webhook } from "lucide-react";
import Link from "next/link";
import { WEBHOOK_EVENTS } from "@talkfront/shared";
import { Card, CardHeader, EmptyState } from "@/components/ui";
import { db } from "@/db";
import { webhookDeliveries, webhookEndpoints } from "@/db/schema";
import { formatDateTime } from "@/lib/format";
import { maskSecret } from "@/lib/webhooks/sign";
import { AddEndpoint, EndpointItem, type DeliveryRow, type EndpointView } from "./webhooks";

const RECENT_DELIVERIES = 20;

// Seconds matter here: retries are 2 and 10 seconds apart.
const shortTime = new Intl.DateTimeFormat("en", {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
  timeZone: "UTC",
});

/** Settings -> Webhooks: endpoints that receive our events, with their recent deliveries. */
export async function WebhooksSection({ organizationId, canManage }: { organizationId: string; canManage: boolean }) {
  const endpoints = await db
    .select()
    .from(webhookEndpoints)
    .where(eq(webhookEndpoints.organizationId, organizationId))
    .orderBy(asc(webhookEndpoints.createdAt));

  const deliveries = await Promise.all(
    endpoints.map((e) =>
      db
        .select({
          id: webhookDeliveries.id,
          event: webhookDeliveries.event,
          eventId: webhookDeliveries.eventId,
          attempt: webhookDeliveries.attempt,
          ok: webhookDeliveries.ok,
          statusCode: webhookDeliveries.statusCode,
          error: webhookDeliveries.error,
          durationMs: webhookDeliveries.durationMs,
          createdAt: webhookDeliveries.createdAt,
        })
        .from(webhookDeliveries)
        .where(eq(webhookDeliveries.endpointId, e.id))
        .orderBy(desc(webhookDeliveries.createdAt))
        .limit(RECENT_DELIVERIES),
    ),
  );

  const views: EndpointView[] = endpoints.map((e, i) => ({
    id: e.id,
    url: e.url,
    description: e.description,
    events: e.events.filter((x): x is (typeof WEBHOOK_EVENTS)[number] => (WEBHOOK_EVENTS as readonly string[]).includes(x)),
    enabled: e.enabled,
    // Only owners/admins see even the masked tail; the real secret is fetched on demand.
    secretHint: canManage ? maskSecret(e.secret) : null,
    createdAt: formatDateTime(e.createdAt),
    deliveries: deliveries[i]!.map(
      (d): DeliveryRow => ({
        id: d.id,
        event: d.event,
        eventId: d.eventId,
        attempt: d.attempt,
        ok: d.ok,
        statusCode: d.statusCode,
        error: d.error,
        durationMs: d.durationMs,
        at: formatDateTime(d.createdAt),
        short: shortTime.format(d.createdAt),
        atIso: d.createdAt.toISOString(),
      }),
    ),
  }));

  return (
    <Card id="webhooks">
      <CardHeader
        title="Webhooks"
        icon={Webhook}
        description={
          canManage ? (
            <>
              Send events to your own server, Zapier or n8n.{" "}
              <Link href="/docs#webhooks" className="font-medium text-brand-700 underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-brand-600">
                How to verify them
              </Link>
            </>
          ) : (
            "Where this workspace sends its events. Only owners and admins can change them."
          )
        }
      />
      {canManage ? <AddEndpoint empty={views.length === 0} /> : null}
      {views.length === 0 ? (
        canManage ? null : (
          <EmptyState title="No endpoints yet" icon={Webhook}>
            When an owner or admin adds one, it shows here.
          </EmptyState>
        )
      ) : (
        <ul className="divide-y divide-slate-100">
          {views.map((v) => (
            <li key={v.id}>
              <EndpointItem endpoint={v} canManage={canManage} />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
