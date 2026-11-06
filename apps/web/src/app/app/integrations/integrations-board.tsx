"use client";

import { CalendarClock, Contact, Database, FlaskConical, Link2, Pencil, Plug, Unplug, type LucideIcon } from "lucide-react";
import { useActionState, useEffect, useId, useState, type ReactNode } from "react";
import { ActionMessage } from "@/components/form-bits";
import { Badge, Button, Card, CardHeader, cx, Field, Input, Notice, Select } from "@/components/ui";
import { bookingLinkTool, calcomTools, crmTools } from "@/lib/integrations/tools";
import { isCrmKind, KIND_LABELS, SECRET_FIELDS, ZOHO_DATA_CENTRES, type DbQueryParameter, type IntegrationKind } from "@/lib/integrations/types";
import { disconnectIntegration, saveIntegration, testIntegration } from "./actions";
import { chip, SmallFormButton, subtle, Switch, useSubmitAction } from "./bits";
import { QueriesPanel } from "./queries-panel";

export type IntegrationView = {
  kind: IntegrationKind;
  config: Record<string, unknown>;
  /** "ends in 4f2a" or a database host. Never the credential itself. */
  secretHint: string | null;
  secretsUnreadable: boolean;
  agentIds: string[];
  logConversations: boolean;
  lastTest: { ok: boolean; message: string; at: string } | null;
};

export type QueryView = { id: string; name: string; description: string; sql: string; parameters: DbQueryParameter[]; enabled: boolean };
type AgentOption = { id: string; name: string };

const META: Record<IntegrationKind, { icon: LucideIcon; blurb: string }> = {
  hubspot: { icon: Contact, blurb: "Find contacts, save leads and add notes in HubSpot." },
  gohighlevel: { icon: Contact, blurb: "Find contacts, save leads and add notes in a GoHighLevel sub-account." },
  zoho: { icon: Contact, blurb: "Search contacts and leads, create leads and add notes in Zoho CRM." },
  calcom: { icon: CalendarClock, blurb: "Check open times and book meetings on one Cal.com event type." },
  booking_link: { icon: Link2, blurb: "Any booking page (Calendly or your own). The agent shares the link." },
  database: { icon: Database, blurb: "Your own Postgres or MySQL database, through read-only queries you write." },
};

/** What the owner needs at hand before connecting. */
const NEEDS: Record<IntegrationKind, string> = {
  hubspot: "You need a private app access token.",
  gohighlevel: "You need a private integration token and the location id.",
  zoho: "You need a Self Client's client id, client secret and refresh token.",
  calcom: "You need an API key and the event type id.",
  booking_link: "You need the link to your booking page.",
  database: "You need a connection string for a user that can only read.",
};

const GROUPS: { title: string; description: string; kinds: IntegrationKind[] }[] = [
  { title: "CRM", description: "Your agent can check whether a visitor is a contact, save them as a lead and add notes.", kinds: ["hubspot", "gohighlevel", "zoho"] },
  { title: "Calendar", description: "Let visitors book a meeting during the conversation.", kinds: ["calcom", "booking_link"] },
  { title: "Database", description: "Answer from your own records, for example a signed-in visitor's orders.", kinds: ["database"] },
];

const DATA_CENTRES: Record<(typeof ZOHO_DATA_CENTRES)[number], string> = {
  com: "zoho.com (United States)",
  eu: "zoho.eu (Europe)",
  in: "zoho.in (India)",
  "com.au": "zoho.com.au (Australia)",
  jp: "zoho.jp (Japan)",
  ca: "zoho.ca (Canada)",
  "com.cn": "zoho.com.cn (China)",
  sa: "zoho.sa (Saudi Arabia)",
  uk: "zoho.uk (United Kingdom)",
};

function toolNames(kind: IntegrationKind, config: Record<string, unknown>, queries: QueryView[]): string[] {
  if (isCrmKind(kind)) return crmTools(kind).map((t) => t.name);
  if (kind === "calcom") return calcomTools().map((t) => t.name);
  if (kind === "booking_link") return [bookingLinkTool(String(config.label ?? "")).name];
  return queries.filter((q) => q.enabled).map((q) => q.name);
}

const str = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");

function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function timeZoneList(): string[] {
  try {
    return (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone") ?? [];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------- connect / edit form

type Draft = { config: Record<string, string | boolean>; secrets: Record<string, string>; agentIds: string[]; logConversations: boolean };

function initialDraft(kind: IntegrationKind, view: IntegrationView | null, agents: AgentOption[]): Draft {
  const c = view?.config ?? {};
  const config: Draft["config"] =
    kind === "gohighlevel"
      ? { locationId: str(c.locationId) }
      : kind === "zoho"
        ? { dataCentre: str(c.dataCentre) || "com" }
        : kind === "calcom"
          ? { eventTypeId: str(c.eventTypeId), timeZone: str(c.timeZone) || browserTimeZone() }
          : kind === "booking_link"
            ? { url: str(c.url), label: str(c.label) }
            : kind === "database"
              ? { dialect: str(c.dialect) || "postgres", ssl: c.ssl === undefined ? true : c.ssl === true }
              : {};
  return {
    config,
    secrets: Object.fromEntries(SECRET_FIELDS[kind].map((f) => [f.key, ""])),
    // A new connection starts with every agent ticked; the owner can untick before saving.
    agentIds: view ? view.agentIds : agents.map((a) => a.id),
    logConversations: view?.logConversations ?? false,
  };
}

function toPayload(kind: IntegrationKind, d: Draft) {
  const config: Record<string, unknown> = { ...d.config };
  if (kind === "calcom") config.eventTypeId = Number(String(d.config.eventTypeId ?? "").trim()) || 0;
  return JSON.stringify({ kind, config, secrets: d.secrets, agentIds: d.agentIds, logConversations: d.logConversations });
}

function ConnectForm({
  kind,
  view,
  agents,
  onDone,
  onCancel,
}: {
  kind: IntegrationKind;
  view: IntegrationView | null;
  agents: AgentOption[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const [state, onSubmit, pending] = useSubmitAction(saveIntegration, null);
  const [d, setD] = useState<Draft>(() => initialDraft(kind, view, agents));
  const [zones] = useState(timeZoneList);
  const id = useId();
  const setConfig = (k: string, v: string | boolean) => setD((x) => ({ ...x, config: { ...x.config, [k]: v } }));

  useEffect(() => {
    if (state?.ok) onDone();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const secretPlaceholder = view && !view.secretsUnreadable ? `Saved${view.secretHint && kind !== "database" ? ` (${view.secretHint})` : ""}. Leave blank to keep it.` : "";

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <input type="hidden" name="payload" value={toPayload(kind, d)} />
      {view?.secretsUnreadable ? <Notice tone="error">The saved credentials could not be read. Enter them again.</Notice> : null}

      <div className="grid gap-4 sm:grid-cols-2">
        {kind === "gohighlevel" ? (
          <Field label="Location id" htmlFor={`${id}-loc`} hint="Settings, Business profile: the sub-account's location id.">
            <Input id={`${id}-loc`} value={str(d.config.locationId)} onChange={(e) => setConfig("locationId", e.target.value)} maxLength={100} spellCheck={false} autoComplete="off" className="font-mono text-xs" required />
          </Field>
        ) : null}
        {kind === "zoho" ? (
          <Field label="Data centre" htmlFor={`${id}-dc`} hint="The domain you sign in to Zoho with.">
            <Select id={`${id}-dc`} value={str(d.config.dataCentre)} onChange={(e) => setConfig("dataCentre", e.target.value)}>
              {ZOHO_DATA_CENTRES.map((dc) => (
                <option key={dc} value={dc}>
                  {DATA_CENTRES[dc]}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        {kind === "calcom" ? (
          <>
            <Field label="Event type id" htmlFor={`${id}-evt`} hint="Open the event type in Cal.com: the number in its address.">
              <Input id={`${id}-evt`} inputMode="numeric" value={str(d.config.eventTypeId)} onChange={(e) => setConfig("eventTypeId", e.target.value.replace(/\D/g, ""))} maxLength={12} placeholder="123456" className="font-mono text-xs" required />
            </Field>
            <Field label="Business time zone" htmlFor={`${id}-tz`} hint="Used when the visitor doesn't say theirs.">
              <Input id={`${id}-tz`} list={`${id}-tzs`} value={str(d.config.timeZone)} onChange={(e) => setConfig("timeZone", e.target.value)} maxLength={64} spellCheck={false} autoComplete="off" placeholder="Europe/London" required />
              <datalist id={`${id}-tzs`}>
                {zones.map((z) => (
                  <option key={z} value={z} />
                ))}
              </datalist>
            </Field>
          </>
        ) : null}
        {kind === "booking_link" ? (
          <>
            <Field label="Booking link" htmlFor={`${id}-url`} hint="Must start with https://.">
              <Input id={`${id}-url`} type="url" value={str(d.config.url)} onChange={(e) => setConfig("url", e.target.value)} maxLength={2048} placeholder="https://calendly.com/your-team/demo" spellCheck={false} className="font-mono text-xs" required />
            </Field>
            <Field label="What it books (optional)" htmlFor={`${id}-label`} hint="e.g. a free 30 minute demo. The agent reads this.">
              <Input id={`${id}-label`} value={str(d.config.label)} onChange={(e) => setConfig("label", e.target.value)} maxLength={80} placeholder="Free 30 minute demo" />
            </Field>
          </>
        ) : null}
        {kind === "database" ? (
          <Field label="Database" htmlFor={`${id}-dialect`}>
            <Select id={`${id}-dialect`} value={str(d.config.dialect)} onChange={(e) => setConfig("dialect", e.target.value)}>
              <option value="postgres">Postgres</option>
              <option value="mysql">MySQL</option>
            </Select>
          </Field>
        ) : null}

        {SECRET_FIELDS[kind].map((f) => (
          <div key={f.key} className={cx(kind === "database" && "sm:col-span-2")}>
            <Field label={f.label} htmlFor={`${id}-${f.key}`} hint={f.hint}>
              <Input
                id={`${id}-${f.key}`}
                type="password"
                value={d.secrets[f.key] ?? ""}
                onChange={(e) => setD((x) => ({ ...x, secrets: { ...x.secrets, [f.key]: e.target.value } }))}
                placeholder={secretPlaceholder}
                maxLength={2000}
                spellCheck={false}
                autoComplete="new-password"
                className="font-mono text-xs"
                required={!view || view.secretsUnreadable}
              />
            </Field>
          </div>
        ))}
      </div>

      {kind === "database" ? (
        <Switch
          checked={d.config.ssl === true}
          onChange={(v) => setConfig("ssl", v)}
          label="Use SSL"
          hint="Encrypts the connection (the certificate is not checked). Most hosted databases need this on."
        />
      ) : null}

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-slate-800">Agents that may use it</legend>
        {agents.length ? (
          <div className="flex flex-wrap gap-2">
            {agents.map((a) => (
              <label key={a.id} className={cx(chip, "max-w-full")}>
                <input
                  type="checkbox"
                  checked={d.agentIds.includes(a.id)}
                  onChange={(e) => setD((x) => ({ ...x, agentIds: e.target.checked ? [...x.agentIds, a.id] : x.agentIds.filter((y) => y !== a.id) }))}
                  className="size-3.5 shrink-0 accent-brand-600 focus:outline-none"
                />
                <span className="min-w-0 truncate" title={a.name}>
                  {a.name}
                </span>
              </label>
            ))}
          </div>
        ) : (
          <p className="text-xs text-slate-500">You have no agents yet. Create one, then come back to tick it here.</p>
        )}
        <p className="text-xs leading-5 text-slate-500">Only ticked agents get these tools. With none ticked, the connection is saved but not used.</p>
      </fieldset>

      {isCrmKind(kind) ? (
        <Switch
          checked={d.logConversations}
          onChange={(v) => setD((x) => ({ ...x, logConversations: v }))}
          label="Log conversations"
          hint="When a conversation of a ticked agent ends and an email or phone is known, find or create the contact and add the summary as a note."
        />
      ) : null}

      {state?.error ? <Notice tone="error">{state.error}</Notice> : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={pending} aria-busy={pending}>
          {pending ? (kind === "booking_link" ? "Saving..." : "Saving and testing...") : view ? "Save" : "Connect"}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          {state?.tested ? "Close" : "Cancel"}
        </Button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------- one card

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-0.5 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-3">
      <dt className="text-xs font-medium text-slate-500">{label}</dt>
      <dd className="min-w-0 text-sm text-slate-800">{children}</dd>
    </div>
  );
}

function settingsLine(kind: IntegrationKind, c: Record<string, unknown>): string | null {
  if (kind === "gohighlevel") return `Location ${str(c.locationId)}`;
  if (kind === "zoho") return DATA_CENTRES[str(c.dataCentre) as keyof typeof DATA_CENTRES] ?? null;
  if (kind === "calcom") return `Event type ${str(c.eventTypeId)}, ${str(c.timeZone)}`;
  if (kind === "booking_link") return str(c.url);
  if (kind === "database") return `${c.dialect === "mysql" ? "MySQL" : "Postgres"}, SSL ${c.ssl === true ? "on" : "off"}`;
  return null;
}

function statusBadge(view: IntegrationView | null) {
  if (!view) return <Badge tone="gray">Not connected</Badge>;
  if (view.secretsUnreadable || (view.lastTest && !view.lastTest.ok)) return <Badge tone="red" dot>Needs attention</Badge>;
  if (!view.agentIds.length) return <Badge tone="amber" dot>No agents</Badge>;
  return <Badge tone="green" dot>Connected</Badge>;
}

function IntegrationCard({
  kind,
  view,
  agents,
  queries,
  canManage,
}: {
  kind: IntegrationKind;
  view: IntegrationView | null;
  agents: AgentOption[];
  queries: QueryView[];
  canManage: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [testState, test] = useActionState(testIntegration, null);
  const [discState, disconnect] = useActionState(disconnectIntegration, null);
  const meta = META[kind];
  const label = KIND_LABELS[kind];
  const agentNames = view ? agents.filter((a) => view.agentIds.includes(a.id)).map((a) => a.name) : [];
  const tools = view ? toolNames(kind, view.config, queries) : [];
  const settings = view ? settingsLine(kind, view.config) : null;

  return (
    <Card id={kind}>
      <CardHeader title={label} icon={meta.icon} description={meta.blurb} action={statusBadge(view)} />
      <div className="space-y-4 p-5">
        {editing && canManage ? (
          <ConnectForm kind={kind} view={view} agents={agents} onDone={() => setEditing(false)} onCancel={() => setEditing(false)} />
        ) : view ? (
          <>
            <dl className="space-y-2.5">
              {settings ? (
                <Detail label={kind === "booking_link" ? "Link" : "Settings"}>
                  <span className="block truncate" title={settings}>
                    {settings}
                  </span>
                </Detail>
              ) : null}
              {SECRET_FIELDS[kind].length ? (
                <Detail label={kind === "database" ? "Connection" : "Credentials"}>
                  {view.secretsUnreadable ? (
                    <span className="text-red-700">Could not be read. Enter them again.</span>
                  ) : (
                    <span className="block truncate font-mono text-xs" title={view.secretHint ?? "saved"}>
                      {view.secretHint ?? "saved"}
                    </span>
                  )}
                </Detail>
              ) : null}
              <Detail label="Agents">
                {agentNames.length ? (
                  <span className="block truncate" title={agentNames.join(", ")}>
                    {agentNames.join(", ")}
                  </span>
                ) : (
                  <span className="text-amber-800">None yet, so no agent uses it.</span>
                )}
              </Detail>
              {isCrmKind(kind) ? <Detail label="Log conversations">{view.logConversations ? "On" : "Off"}</Detail> : null}
              {tools.length ? (
                <Detail label="Tools the agent gets">
                  <span className="block truncate font-mono text-xs" title={tools.join(", ")}>
                    {tools.join(", ")}
                  </span>
                </Detail>
              ) : null}
              {view.lastTest ? (
                <Detail label="Last test">
                  <span className="flex min-w-0 flex-wrap items-center gap-2">
                    <Badge tone={view.lastTest.ok ? "green" : "red"} dot>
                      {view.lastTest.ok ? "Worked" : "Failed"}
                    </Badge>
                    <span className="text-xs text-slate-500">{view.lastTest.at}</span>
                  </span>
                  {view.lastTest.message ? <span className="mt-1 block text-xs leading-5 text-slate-600 [overflow-wrap:anywhere]">{view.lastTest.message}</span> : null}
                </Detail>
              ) : null}
            </dl>

            {canManage ? (
              <div className="-ml-2 flex flex-wrap items-center gap-1">
                <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(true)} className={subtle}>
                  <Pencil aria-hidden />
                  Edit
                </Button>
                {kind !== "booking_link" ? (
                  <form action={test}>
                    <input type="hidden" name="kind" value={kind} />
                    <SmallFormButton label={`Test the ${label} connection`} className={subtle}>
                      <FlaskConical aria-hidden />
                      Test connection
                    </SmallFormButton>
                  </form>
                ) : null}
                <form action={disconnect}>
                  <input type="hidden" name="kind" value={kind} />
                  <SmallFormButton
                    label={`Disconnect ${label}`}
                    confirmText={`Disconnect ${label}? Agents stop using it right away and the saved credentials${kind === "database" ? " and queries" : ""} are deleted.`}
                    className="text-slate-500 hover:bg-red-50 hover:text-red-700"
                  >
                    <Unplug aria-hidden />
                    Disconnect
                  </SmallFormButton>
                </form>
              </div>
            ) : null}
            <ActionMessage state={testState} />
          </>
        ) : canManage ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-slate-500">{NEEDS[kind]}</p>
            <Button type="button" variant="secondary" size="sm" onClick={() => setEditing(true)}>
              <Plug aria-hidden />
              Connect {label}
            </Button>
          </div>
        ) : (
          <p className="text-sm text-slate-500">Not connected.</p>
        )}
        <ActionMessage state={discState} />
      </div>
      {kind === "database" && view && !editing ? (
        <QueriesPanel queries={queries} canManage={canManage} dialect={view.config.dialect === "mysql" ? "mysql" : "postgres"} />
      ) : null}
    </Card>
  );
}

export function IntegrationsBoard({
  kinds,
  views,
  queries,
  agents,
  canManage,
}: {
  kinds: IntegrationKind[];
  views: Partial<Record<IntegrationKind, IntegrationView>>;
  queries: QueryView[];
  agents: AgentOption[];
  canManage: boolean;
}) {
  return (
    <div className="space-y-10">
      {GROUPS.map((g) => (
        <section key={g.title} aria-labelledby={`group-${g.title}`} className="space-y-4">
          <div>
            <h2 id={`group-${g.title}`} className="text-base font-semibold text-slate-900">
              {g.title}
            </h2>
            <p className="mt-0.5 text-sm text-slate-500">{g.description}</p>
          </div>
          <div className="space-y-4">
            {g.kinds
              .filter((k) => kinds.includes(k))
              .map((k) => (
                <IntegrationCard key={k} kind={k} view={views[k] ?? null} agents={agents} queries={k === "database" ? queries : []} canManage={canManage} />
              ))}
          </div>
        </section>
      ))}
      <p className="text-xs leading-5 text-slate-500">
        Credentials are stored encrypted and never shown again. Each business uses its own accounts: Halochime has no shared CRM, calendar or
        database access.
      </p>
    </div>
  );
}
