"use client";

import {
  ChevronRight,
  Eye,
  EyeOff,
  KeyRound,
  Pencil,
  Plus,
  RefreshCw,
  RotateCw,
  Send,
  Trash2,
  Webhook,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useId, useRef, useState, useTransition } from "react";
import { WEBHOOK_EVENTS, type WebhookEvent } from "@talkfront/shared";
import { CopyButton, SubmitButton, type ActionState } from "@/components/form-bits";
import { Badge, Button, Field, Input, Notice, cx } from "@/components/ui";
import {
  createWebhookEndpoint,
  deleteWebhookEndpoint,
  getWebhookDelivery,
  revealWebhookSecret,
  rollWebhookSecret,
  sendWebhookTest,
  setWebhookEnabled,
  updateWebhookEndpoint,
  type EndpointFormState,
} from "./webhook-actions";

export type DeliveryRow = {
  id: string;
  event: string;
  eventId: string;
  attempt: number;
  ok: boolean;
  statusCode: number | null;
  error: string | null;
  durationMs: number | null;
  /** Full UTC date and time. */
  at: string;
  /** Compact UTC time for the list, e.g. "Oct 25, 15:08:42". */
  short: string;
  atIso: string;
};

export type EndpointView = {
  id: string;
  url: string;
  description: string;
  events: WebhookEvent[];
  enabled: boolean;
  secretHint: string | null;
  createdAt: string;
  deliveries: DeliveryRow[];
};

const EVENT_INFO: Record<WebhookEvent, string> = {
  "conversation.ended": "A call or chat finished. Includes the summary and transcript.",
  "handoff.created": "A visitor left a message for your team.",
  "handoff.updated": "A visitor changed or added details to an open message.",
};

const chip =
  "flex min-h-9 cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 shadow-xs transition-colors hover:border-slate-300 has-[:checked]:border-brand-300 has-[:checked]:bg-brand-50 has-[:checked]:text-brand-800 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand-600";

// ---------------------------------------------------------------------------
// Add / edit form

function EndpointForm({ endpoint, onSaved, onCancel }: { endpoint?: EndpointView; onSaved: () => void; onCancel: () => void }) {
  const editing = !!endpoint;
  const [state, action] = useActionState<EndpointFormState, FormData>(editing ? updateWebhookEndpoint : createWebhookEndpoint, null);
  const [scope, setScope] = useState<"all" | "some">(endpoint && endpoint.events.length > 0 ? "some" : "all");
  const uid = useId();
  const urlRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (state?.ok) onSaved();
  }, [state, onSaved]);

  const chosen = new Set(endpoint?.events.length ? endpoint.events : WEBHOOK_EVENTS);

  return (
    <form action={action} className="space-y-5" noValidate>
      {endpoint ? <input type="hidden" name="id" value={endpoint.id} /> : null}
      <div className="grid gap-4 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Field label="Endpoint URL" htmlFor={`${uid}-url`} hint="Must be https. We POST a signed JSON body to it.">
          <Input
            ref={urlRef}
            id={`${uid}-url`}
            name="url"
            type="url"
            inputMode="url"
            required
            maxLength={2000}
            autoComplete="off"
            spellCheck={false}
            placeholder="https://hooks.example.com/halochime"
            defaultValue={state?.values?.url ?? endpoint?.url ?? ""}
            aria-invalid={state?.error && /url|https|address/i.test(state.error) ? true : undefined}
            className="font-mono text-xs"
          />
        </Field>
        <Field label="Description" htmlFor={`${uid}-desc`} hint="Optional. Helps your team tell endpoints apart.">
          <Input
            id={`${uid}-desc`}
            name="description"
            maxLength={200}
            autoComplete="off"
            placeholder="CRM sync"
            defaultValue={state?.values?.description ?? endpoint?.description ?? ""}
          />
        </Field>
      </div>

      <fieldset className="space-y-3">
        <legend className="text-sm font-medium text-slate-800">Events to send</legend>
        <div className="flex flex-wrap gap-2" role="radiogroup">
          <label className={chip}>
            <input
              type="radio"
              name="scope"
              value="all"
              checked={scope === "all"}
              onChange={() => setScope("all")}
              className="size-3.5 accent-brand-600 focus:outline-none"
            />
            All events
          </label>
          <label className={chip}>
            <input
              type="radio"
              name="scope"
              value="some"
              checked={scope === "some"}
              onChange={() => setScope("some")}
              className="size-3.5 accent-brand-600 focus:outline-none"
            />
            Only some
          </label>
        </div>
        {scope === "all" ? (
          <p className="text-xs leading-5 text-slate-500">Every event, including ones we add later.</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-3">
            {WEBHOOK_EVENTS.map((ev) => (
              <label key={ev} className={cx(chip, "items-start py-2.5")}>
                <input
                  type="checkbox"
                  name="events"
                  value={ev}
                  defaultChecked={chosen.has(ev)}
                  className="mt-0.5 size-3.5 shrink-0 accent-brand-600 focus:outline-none"
                />
                <span className="min-w-0">
                  <span className="block font-mono text-xs font-semibold">{ev}</span>
                  <span className="mt-0.5 block text-xs font-normal leading-5 text-slate-500">{EVENT_INFO[ev]}</span>
                </span>
              </label>
            ))}
          </div>
        )}
      </fieldset>

      {state?.error ? <Notice tone="error">{state.error}</Notice> : null}

      <div className="flex flex-wrap items-center gap-2">
        <SubmitButton pendingLabel={editing ? "Saving..." : "Adding..."}>
          {editing ? "Save endpoint" : (
            <>
              <Plus aria-hidden />
              Add endpoint
            </>
          )}
        </SubmitButton>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** Top of the card for owners/admins: the add button (or the empty state) that opens the form in place. */
export function AddEndpoint({ empty }: { empty: boolean }) {
  const [open, setOpen] = useState(false);
  const [added, setAdded] = useState(false);
  const saved = useRef(() => {
    setOpen(false);
    setAdded(true);
  }).current;
  const cancel = useRef(() => setOpen(false)).current;

  useEffect(() => {
    if (!added) return;
    const t = setTimeout(() => setAdded(false), 6000);
    return () => clearTimeout(t);
  }, [added]);

  if (open) {
    return (
      <div className="border-b border-slate-100 bg-slate-50/50 p-5">
        <p className="mb-4 text-sm font-semibold text-slate-900">New endpoint</p>
        <EndpointForm onSaved={saved} onCancel={cancel} />
      </div>
    );
  }
  if (empty) {
    return (
      <div className="flex flex-col items-center px-5 py-14 text-center">
        <span className="mb-4 grid size-12 place-items-center rounded-2xl bg-gradient-to-br from-brand-50 to-orange-50 text-brand-600 ring-1 ring-brand-100" aria-hidden>
          <Webhook className="size-5" />
        </span>
        <p className="text-sm font-semibold text-slate-900">No endpoints yet</p>
        <p className="mt-1 max-w-sm text-sm text-slate-500">
          Add a URL and we will POST a signed JSON event to it when a conversation ends or a visitor leaves a message.
        </p>
        <Button type="button" className="mt-5" onClick={() => setOpen(true)}>
          <Plus aria-hidden />
          Add endpoint
        </Button>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-3">
      <div className="min-w-0">
        {added ? (
          <p role="status" className="text-sm text-emerald-700">
            Endpoint added. Send a test event to check it.
          </p>
        ) : (
          <p className="text-sm text-slate-500">Each endpoint gets its own signing secret.</p>
        )}
      </div>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={() => {
          setAdded(false);
          setOpen(true);
        }}
      >
        <Plus aria-hidden />
        Add endpoint
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// One endpoint

function Switch({
  checked,
  disabled,
  label,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        "relative h-5 w-9 shrink-0 rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:cursor-wait disabled:opacity-60",
        checked ? "bg-brand-600 hover:bg-brand-700" : "bg-slate-200 hover:bg-slate-300",
      )}
    >
      <span
        aria-hidden
        className={cx(
          "absolute left-0.5 top-0.5 size-4 rounded-full bg-white shadow-sm transition-transform",
          checked && "translate-x-4",
        )}
      />
    </button>
  );
}

function SecretPanel({ endpointId, hint }: { endpointId: string; hint: string }) {
  const [secret, setSecret] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [pending, start] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  const reveal = () =>
    start(async () => {
      setMsg(null);
      const r = await revealWebhookSecret(endpointId);
      if (r.secret) setSecret(r.secret);
      else setMsg({ tone: "error", text: r.error ?? "Could not load the secret." });
    });

  const roll = () => {
    if (!window.confirm("Roll the signing secret? The old one stops working right away, so update your server with the new one.")) return;
    start(async () => {
      setMsg(null);
      const r = await rollWebhookSecret(endpointId);
      if (r.secret) {
        setSecret(r.secret);
        setMsg({ tone: "success", text: "New secret created. Requests are signed with it from now on." });
      } else setMsg({ tone: "error", text: r.error ?? "Could not roll the secret." });
    });
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-xs font-medium text-slate-700">
          <KeyRound className="size-3.5 text-slate-400" aria-hidden />
          Signing secret
        </p>
        <Button type="button" variant="ghost" size="sm" onClick={roll} disabled={pending} title="Create a new secret">
          <RotateCw aria-hidden />
          Roll secret
        </Button>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <Input
          ref={inputRef}
          readOnly
          value={secret ?? hint}
          aria-label="Signing secret"
          title={secret ? undefined : "Hidden. Select Reveal to see it."}
          onFocus={() => secret && inputRef.current?.select()}
          className={cx("min-w-0 flex-1 bg-white font-mono text-xs", !secret && "text-slate-400")}
        />
        {secret ? (
          <>
            <CopyButton text={secret} label="Copy" />
            <Button type="button" variant="secondary" size="sm" onClick={() => setSecret(null)} aria-label="Hide secret" title="Hide secret">
              <EyeOff aria-hidden />
              <span className="max-sm:sr-only">Hide</span>
            </Button>
          </>
        ) : (
          <Button type="button" variant="secondary" size="sm" onClick={reveal} disabled={pending} aria-busy={pending}>
            <Eye aria-hidden />
            {pending ? "Loading..." : "Reveal"}
          </Button>
        )}
      </div>
      {msg ? (
        <p role={msg.tone === "error" ? "alert" : "status"} className={cx("mt-2 text-xs", msg.tone === "error" ? "font-medium text-red-600" : "text-emerald-700")}>
          {msg.text}
        </p>
      ) : (
        <p className="mt-2 text-xs leading-5 text-slate-500">
          Keep it on your server. Use it to check the Halochime-Signature header on every request.
        </p>
      )}
    </div>
  );
}

export function EndpointItem({ endpoint, canManage }: { endpoint: EndpointView; canManage: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [enabled, setEnabled] = useState(endpoint.enabled);
  const [result, setResult] = useState<ActionState>(null);
  const [testing, startTest] = useTransition();
  const [toggling, startToggle] = useTransition();
  const [deleting, startDelete] = useTransition();
  const stopEditing = useRef(() => setEditing(false)).current;

  useEffect(() => setEnabled(endpoint.enabled), [endpoint.enabled]);

  const toggle = (next: boolean) =>
    startToggle(async () => {
      setEnabled(next);
      const r = await setWebhookEnabled(endpoint.id, next);
      if (r?.error) {
        setEnabled(!next);
        setResult(r);
      }
    });

  const test = () =>
    startTest(async () => {
      setResult(null);
      setResult(await sendWebhookTest(endpoint.id));
    });

  const remove = () => {
    if (!window.confirm(`Delete this endpoint? It stops getting events right away and its delivery log is removed.\n\n${endpoint.url}`)) return;
    startDelete(async () => {
      const r = await deleteWebhookEndpoint(endpoint.id);
      if (r?.error) setResult(r);
    });
  };

  if (editing) {
    return (
      <div className="bg-slate-50/50 p-5">
        <p className="mb-4 text-sm font-semibold text-slate-900">Edit endpoint</p>
        <EndpointForm endpoint={endpoint} onSaved={stopEditing} onCancel={stopEditing} />
      </div>
    );
  }

  return (
    <div className={cx("space-y-4 p-5", deleting && "pointer-events-none opacity-50")}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-1.5">
          <div className="flex min-w-0 items-center gap-2">
            <Badge tone={enabled ? "green" : "gray"} dot>
              {enabled ? "Active" : "Paused"}
            </Badge>
            <p className="min-w-0 truncate font-mono text-[13px] font-medium text-slate-900" title={endpoint.url}>
              {endpoint.url}
            </p>
          </div>
          {endpoint.description ? (
            <p className="truncate text-sm text-slate-600" title={endpoint.description}>
              {endpoint.description}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
            {endpoint.events.length === 0 ? (
              <Badge tone="blue">All events</Badge>
            ) : (
              endpoint.events.map((ev) => (
                <span key={ev} className="rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-700" title={EVENT_INFO[ev]}>
                  {ev}
                </span>
              ))
            )}
            <span className="text-xs text-slate-400">· Added {endpoint.createdAt}</span>
          </div>
        </div>
        {canManage ? (
          <Switch
            checked={enabled}
            disabled={toggling}
            label={enabled ? "Pause this endpoint" : "Turn this endpoint on"}
            onChange={toggle}
          />
        ) : null}
      </div>

      {canManage ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={test} disabled={testing} aria-busy={testing}>
              <Send aria-hidden />
              {testing ? "Sending..." : "Send test event"}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(true)} title="Edit endpoint">
              <Pencil aria-hidden />
              <span className="max-sm:sr-only">Edit</span>
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={remove}
              disabled={deleting}
              title="Delete endpoint"
              className="text-slate-500 hover:text-red-700"
            >
              <Trash2 aria-hidden />
              <span className="max-sm:sr-only">Delete</span>
            </Button>
          </div>
          {result?.error ? <Notice tone="error">{result.error}</Notice> : null}
          {result?.ok && result.message ? <Notice tone="success">{result.message}</Notice> : null}
          {endpoint.secretHint ? <SecretPanel endpointId={endpoint.id} hint={endpoint.secretHint} /> : null}
        </>
      ) : null}

      <Deliveries rows={endpoint.deliveries} onRefresh={() => router.refresh()} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Delivery log

function StatusBadge({ row }: { row: DeliveryRow }) {
  if (row.ok) return <Badge tone="green" dot>{String(row.statusCode ?? "OK")}</Badge>;
  if (row.statusCode) return <Badge tone="red" dot>{String(row.statusCode)}</Badge>;
  return <Badge tone="red" dot>Failed</Badge>;
}

const ms = (n: number | null) => (n === null ? "-" : n >= 1000 ? `${(n / 1000).toFixed(1)} s` : `${n} ms`);

// Postgres jsonb stores object keys in its own order; show payloads in the order we send them.
const KEY_ORDER = [
  "id", "type", "created", "workspace_id", "data", "test", "handoff", "conversation", "agent", "visitor", "transcript",
  "mode", "channel", "status", "name", "email", "phone", "message", "verified", "attributes", "started_at", "ended_at",
  "duration_sec", "ended_reason", "summary", "handoff_requested", "page_url", "page_title", "role", "content",
  "created_at", "dashboard_url",
];
function ordered(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(ordered);
  if (!value || typeof value !== "object") return value;
  const rank = (k: string) => {
    const i = KEY_ORDER.indexOf(k);
    return i === -1 ? KEY_ORDER.length : i;
  };
  return Object.fromEntries(
    Object.keys(value)
      .sort((a, b) => rank(a) - rank(b))
      .map((k) => [k, ordered((value as Record<string, unknown>)[k])]),
  );
}

function DeliveryDetail({ row }: { row: DeliveryRow }) {
  const [payload, setPayload] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    getWebhookDelivery(row.id).then((r) => {
      if (!live) return;
      if (r.payload) setPayload(JSON.stringify(ordered(JSON.parse(r.payload)), null, 2));
      else setError(r.error ?? "Could not load the payload.");
    });
    return () => {
      live = false;
    };
  }, [row.id]);

  return (
    <div className="space-y-3 border-t border-slate-100 bg-slate-50/60 px-4 py-4">
      <dl className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-slate-500">
        <div className="flex min-w-0 gap-1.5">
          <dt className="shrink-0">Event id</dt>
          <dd className="min-w-0 truncate font-mono text-slate-700" title={row.eventId}>
            {row.eventId}
          </dd>
        </div>
        <div className="flex gap-1.5">
          <dt>Sent</dt>
          <dd className="text-slate-700">
            <time dateTime={row.atIso}>{row.at}</time>
          </dd>
        </div>
      </dl>
      {row.error ? (
        <p className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-xs leading-5 text-red-700 [overflow-wrap:anywhere]">{row.error}</p>
      ) : null}
      <div>
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <p className="text-xs font-medium text-slate-700">Payload</p>
          {payload ? <CopyButton text={payload} label="Copy JSON" /> : null}
        </div>
        {error ? (
          <p className="text-xs text-slate-500">{error}</p>
        ) : (
          <pre className="max-h-80 overflow-auto rounded-xl bg-ink p-3.5 font-mono text-[11.5px] leading-5 text-slate-200">
            <code>{payload ?? "Loading..."}</code>
          </pre>
        )}
      </div>
    </div>
  );
}

// A list instead of a table: in a narrow box each row folds into two lines rather than scrolling sideways.
const rowGrid = "@xl:grid @xl:grid-cols-[minmax(0,1fr)_4.25rem_8.5rem_4.5rem_4.5rem_1rem] @xl:items-center @xl:gap-3";

function Deliveries({ rows, onRefresh }: { rows: DeliveryRow[]; onRefresh: () => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const [refreshing, start] = useTransition();

  return (
    <div className="@container overflow-hidden rounded-xl border border-slate-200/80">
      <div className="flex items-center justify-between gap-3 border-b border-slate-200/80 bg-white px-4 py-2.5">
        <p className="text-xs font-semibold text-slate-700">Recent deliveries</p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => start(onRefresh)}
          disabled={refreshing}
          aria-busy={refreshing}
          className="-my-1 -mr-2"
        >
          <RefreshCw aria-hidden className={cx(refreshing && "motion-safe:animate-spin")} />
          Refresh
        </Button>
      </div>
      {rows.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-slate-500">Nothing sent yet. Deliveries show here for 30 days.</p>
      ) : (
        <>
          <div
            aria-hidden
            className={cx(
              "hidden border-b border-slate-200/80 bg-slate-50/70 px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500",
              rowGrid,
            )}
          >
            <span>Event</span>
            <span>Status</span>
            <span>Time (UTC)</span>
            <span className="text-right">Duration</span>
            <span className="text-right">Attempt</span>
            <span />
          </div>
          <ul className="divide-y divide-slate-100">
            {rows.map((r) => {
              const isOpen = open === r.id;
              return (
                <li key={r.id}>
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    onClick={() => setOpen(isOpen ? null : r.id)}
                    className={cx(
                      "flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-slate-50/80 focus-visible:bg-slate-50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-600",
                      isOpen && "bg-slate-50/80",
                      rowGrid,
                    )}
                  >
                    {/* Narrow layout: event and status on top, the numbers underneath. */}
                    <span className="min-w-0 flex-1 @xl:contents">
                      <span className="block truncate font-mono text-xs text-slate-800" title={r.event}>
                        {r.event}
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-slate-500 @xl:hidden">
                        {r.short} · {ms(r.durationMs)}
                        {r.attempt > 1 ? ` · retry ${r.attempt}` : ""}
                      </span>
                    </span>
                    <span className="shrink-0">
                      <StatusBadge row={r} />
                    </span>
                    <time dateTime={r.atIso} className="hidden whitespace-nowrap text-xs tabular-nums text-slate-600 @xl:block" title={r.at}>
                      {r.short}
                    </time>
                    <span className="hidden text-right text-xs tabular-nums text-slate-600 @xl:block">{ms(r.durationMs)}</span>
                    <span className="hidden text-right text-xs tabular-nums text-slate-600 @xl:block">
                      {r.attempt > 1 ? <span className="mr-1 text-slate-400">retry</span> : null}
                      {r.attempt}
                    </span>
                    <ChevronRight
                      className={cx("size-4 shrink-0 text-slate-400 transition-transform", isOpen && "rotate-90")}
                      aria-hidden
                    />
                    <span className="sr-only">{isOpen ? "Hide details" : "Show details"}</span>
                  </button>
                  {isOpen ? <DeliveryDetail row={r} /> : null}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
