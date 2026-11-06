"use client";

import { CircleAlert, Pencil, Play, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { useActionState, useEffect, useId, useState } from "react";
import { Badge, Button, cx, Field, Input, Notice, Select, Textarea } from "@/components/ui";
import { PARAMETER_TYPE_LABELS } from "@/lib/actions/schema";
import type { DbDialect, DbQueryParameter } from "@/lib/integrations/types";
import { MAX_QUERIES } from "@/lib/integrations/types";
import { deleteDbQuery, saveDbQuery, setDbQueryEnabled, tryDbQuery } from "./actions";
import { RemoveButton, SmallFormButton, subtle, Switch, useSubmitAction } from "./bits";
import type { QueryView } from "./integrations-board";

type ParamDraft = DbQueryParameter & { key: string };
type Draft = { name: string; description: string; sql: string; enabled: boolean; parameters: ParamDraft[] };

let keySeq = 0;
const nextKey = () => `q${++keySeq}`;

const blankParam = (): ParamDraft => ({ key: nextKey(), name: "", type: "string", description: "", required: true });

const EXAMPLE = (): Draft => ({
  name: "my_recent_orders",
  description: "Look up the signed-in visitor's five most recent orders with their status, when they ask about an order or a delivery.",
  sql: "select id, status, total, created_at\nfrom orders\nwhere customer_id = :user_id\norder by created_at desc\nlimit 5",
  enabled: true,
  parameters: [{ key: nextKey(), name: "user_id", type: "string", description: "", required: true, verifiedUserId: true }],
});

const BLANK = (): Draft => ({ name: "", description: "", sql: "", enabled: true, parameters: [] });

const fromView = (q: QueryView): Draft => ({
  name: q.name,
  description: q.description,
  sql: q.sql,
  enabled: q.enabled,
  parameters: q.parameters.map((p) => ({ ...p, key: nextKey() })),
});

const plainParams = (d: Draft): DbQueryParameter[] =>
  d.parameters.map((p) => ({
    name: p.name.trim(),
    type: p.type,
    description: p.description,
    required: p.verifiedUserId ? true : p.required,
    ...(p.verifiedUserId ? { verifiedUserId: true } : {}),
  }));

function ParamEditor({ p, index, onChange, onRemove }: { p: ParamDraft; index: number; onChange: (p: ParamDraft) => void; onRemove: () => void }) {
  const id = useId();
  const n = index + 1;
  return (
    <li className="relative rounded-xl border border-slate-200 bg-slate-50/60 p-3.5">
      <div className="absolute right-2 top-2">
        <RemoveButton label={`Remove input ${n}`} onClick={onRemove} />
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-3 pr-8 sm:grid-cols-[minmax(0,1fr)_10rem]">
        <div className="col-span-2 sm:col-span-1">
          <Field label={`Input ${n} name`} htmlFor={`${id}-name`} hint={p.name ? `Write :${p.name} in the SQL.` : undefined}>
            <Input
              id={`${id}-name`}
              value={p.name}
              onChange={(e) => onChange({ ...p, name: e.target.value })}
              placeholder="email"
              maxLength={40}
              spellCheck={false}
              autoComplete="off"
              className="bg-white font-mono text-xs"
              required
            />
          </Field>
        </div>
        <div className="col-span-2 sm:col-span-1">
          <Field label="Type" htmlFor={`${id}-type`}>
            <Select id={`${id}-type`} value={p.type} onChange={(e) => onChange({ ...p, type: e.target.value as ParamDraft["type"] })} className="bg-white">
              {(Object.keys(PARAMETER_TYPE_LABELS) as ParamDraft["type"][])
                .filter((t) => !p.verifiedUserId || t !== "boolean")
                .map((t) => (
                  <option key={t} value={t}>
                    {PARAMETER_TYPE_LABELS[t]}
                  </option>
                ))}
            </Select>
          </Field>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2">
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg px-1 text-sm text-slate-700 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand-600">
          <input
            type="checkbox"
            checked={!!p.verifiedUserId}
            onChange={(e) => onChange({ ...p, verifiedUserId: e.target.checked, required: e.target.checked ? true : p.required, type: e.target.checked && p.type === "boolean" ? "string" : p.type })}
            className="size-4 accent-brand-600 focus:outline-none"
          />
          Signed-in user id
        </label>
        {!p.verifiedUserId ? (
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg px-1 text-sm text-slate-700 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand-600">
            <input type="checkbox" checked={p.required} onChange={(e) => onChange({ ...p, required: e.target.checked })} className="size-4 accent-brand-600 focus:outline-none" />
            Required
          </label>
        ) : null}
      </div>
      {p.verifiedUserId ? (
        <p className="mt-2 text-xs leading-5 text-slate-600">
          Always the user id from the visitor&apos;s identity token. The AI never sees or fills it; without a signed-in visitor the query does not run.
        </p>
      ) : (
        <div className="mt-3">
          <Field label="What it is (the AI reads this)" htmlFor={`${id}-desc`}>
            <Input
              id={`${id}-desc`}
              value={p.description}
              onChange={(e) => onChange({ ...p, description: e.target.value })}
              placeholder="The order number, e.g. A-1001"
              maxLength={300}
              className="bg-white"
            />
          </Field>
        </div>
      )}
    </li>
  );
}

function TryPanel({ draft }: { draft: Draft }) {
  const [state, onSubmit, pending] = useSubmitAction(tryDbQuery, null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [userId, setUserId] = useState("");
  const id = useId();
  const params = plainParams(draft);
  const visible = params.filter((p) => !p.verifiedUserId && p.name);
  const needsUser = params.some((p) => p.verifiedUserId);
  const payload = JSON.stringify({
    sql: draft.sql,
    parameters: params,
    args: Object.fromEntries(visible.map((p) => [p.name, values[p.name] ?? ""])),
    userId,
  });

  return (
    <div className="rounded-xl border border-brand-100 bg-brand-50/30 p-4">
      <p className="text-sm font-medium text-slate-900">Try it</p>
      <p className="mt-0.5 text-xs leading-5 text-slate-500">Runs the query above (saved or not) once, read only, with these sample values.</p>
      <form onSubmit={onSubmit} className="mt-3 space-y-3">
        <input type="hidden" name="payload" value={payload} />
        {visible.length || needsUser ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {needsUser ? (
              <Field label="Sample signed-in user id" htmlFor={`${id}-uid`} hint="Stands in for the visitor's user id.">
                <Input id={`${id}-uid`} value={userId} onChange={(e) => setUserId(e.target.value)} maxLength={200} spellCheck={false} className="bg-white font-mono text-xs" />
              </Field>
            ) : null}
            {visible.map((p) => (
              <Field key={p.name} label={`${p.name}${p.required ? "" : " (optional)"}`} htmlFor={`${id}-${p.name}`}>
                {p.type === "boolean" ? (
                  <Select id={`${id}-${p.name}`} value={values[p.name] ?? ""} onChange={(e) => setValues((v) => ({ ...v, [p.name]: e.target.value }))} className="bg-white">
                    <option value="">Leave out</option>
                    <option value="true">true</option>
                    <option value="false">false</option>
                  </Select>
                ) : (
                  <Input
                    id={`${id}-${p.name}`}
                    type={p.type === "string" ? "text" : "number"}
                    step={p.type === "integer" ? 1 : "any"}
                    value={values[p.name] ?? ""}
                    onChange={(e) => setValues((v) => ({ ...v, [p.name]: e.target.value }))}
                    className="bg-white font-mono text-xs"
                    spellCheck={false}
                  />
                )}
              </Field>
            ))}
          </div>
        ) : null}
        <Button type="submit" size="sm" variant="secondary" disabled={pending || !draft.sql.trim()} aria-busy={pending}>
          <Play aria-hidden />
          {pending ? "Running..." : "Try"}
        </Button>
      </form>
      {state && "error" in state ? (
        <div className="mt-3">
          <Notice tone="error">{state.error}</Notice>
        </div>
      ) : null}
      {state && "ok" in state ? (
        <div className="mt-4 space-y-2" role="status">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Badge tone={state.ok ? "green" : "red"} dot>
              {state.ok ? "Worked" : "Failed"}
            </Badge>
            <span className="tabular-nums text-slate-500">{state.durationMs} ms</span>
          </div>
          {state.detail ? (
            <p className="flex items-start gap-2 text-sm text-red-700">
              <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span className="min-w-0 [overflow-wrap:anywhere]">{state.detail}</span>
            </p>
          ) : null}
          <div>
            <p className="mb-1 text-xs font-medium text-slate-600">What the agent reads</p>
            <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded-lg bg-white p-3 font-mono text-xs leading-5 text-slate-700 ring-1 ring-slate-200 [overflow-wrap:anywhere]">
              {state.result}
            </pre>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function QueryForm({ queryId, initial, dialect, onDone }: { queryId: string | null; initial: Draft; dialect: DbDialect; onDone: (savedId: string | null) => void }) {
  const [state, onSubmit, pending] = useSubmitAction(saveDbQuery, null);
  const [d, setD] = useState<Draft>(initial);
  const id = useId();
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));

  useEffect(() => {
    if (state?.ok) onDone(state.savedId ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const payload = JSON.stringify({ queryId, name: d.name.trim(), description: d.description, sql: d.sql, enabled: d.enabled, parameters: plainParams(d) });

  return (
    <div className="space-y-5">
      <form onSubmit={onSubmit} className="space-y-5">
        <input type="hidden" name="payload" value={payload} />
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <Field label="Name" htmlFor={`${id}-name`} hint="The agent sees this tool name. Lowercase letters, numbers and _.">
            <Input
              id={`${id}-name`}
              value={d.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="my_recent_orders"
              maxLength={40}
              required
              spellCheck={false}
              autoComplete="off"
              className="font-mono text-xs"
            />
          </Field>
          <Switch checked={d.enabled} onChange={(v) => set("enabled", v)} label="On" hint="When off, agents can't use it. You can still try it here." />
        </div>
        <Field label="When to use it (the AI reads this)" htmlFor={`${id}-desc`}>
          <Textarea
            id={`${id}-desc`}
            value={d.description}
            onChange={(e) => set("description", e.target.value)}
            maxLength={1000}
            rows={2}
            className="min-h-16"
            placeholder="Look up the signed-in visitor's recent orders when they ask about an order."
            required
          />
        </Field>
        <Field
          label="SQL"
          htmlFor={`${id}-sql`}
          hint={`One SELECT or WITH statement, no semicolon. Use :name for inputs${dialect === "postgres" ? " (casts like ::date are fine)" : ""}. At most 20 rows come back.`}
        >
          <Textarea
            id={`${id}-sql`}
            value={d.sql}
            onChange={(e) => set("sql", e.target.value)}
            maxLength={5000}
            rows={6}
            spellCheck={false}
            className="font-mono text-xs leading-5"
            placeholder="select id, status from orders where customer_id = :user_id order by created_at desc limit 5"
            required
          />
        </Field>

        <div className="space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div className="min-w-0">
              <h4 className="text-sm font-medium text-slate-800">Inputs</h4>
              <p className="mt-0.5 text-xs leading-5 text-slate-500">Values the AI fills in from the conversation, bound safely (never pasted into the SQL).</p>
            </div>
            <Button type="button" variant="secondary" size="sm" onClick={() => set("parameters", [...d.parameters, blankParam()])} disabled={d.parameters.length >= 20}>
              <Plus aria-hidden />
              Add input
            </Button>
          </div>
          {d.parameters.length ? (
            <ul className="space-y-3">
              {d.parameters.map((p, i) => (
                <ParamEditor
                  key={p.key}
                  p={p}
                  index={i}
                  onChange={(np) => set("parameters", d.parameters.map((x) => (x.key === p.key ? np : x)))}
                  onRemove={() => set("parameters", d.parameters.filter((x) => x.key !== p.key))}
                />
              ))}
            </ul>
          ) : (
            <p className="text-xs text-slate-500">No inputs: the query always runs the same way.</p>
          )}
        </div>

        {state?.error ? <Notice tone="error">{state.error}</Notice> : null}
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" disabled={pending} aria-busy={pending}>
            {pending ? "Saving..." : queryId ? "Save query" : "Add query"}
          </Button>
          <Button type="button" variant="ghost" onClick={() => onDone(null)}>
            Cancel
          </Button>
        </div>
      </form>
      <TryPanel draft={d} />
    </div>
  );
}

function QueryRow({ q, canManage, onEdit }: { q: QueryView; canManage: boolean; onEdit: () => void }) {
  const [delState, del] = useActionState(deleteDbQuery, null);
  const [toggleState, toggle] = useActionState(setDbQueryEnabled, null);
  const signedIn = q.parameters.some((p) => p.verifiedUserId);
  const inputs = q.parameters.filter((p) => !p.verifiedUserId).length;
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="min-w-0 truncate font-mono text-sm font-medium text-slate-900" title={q.name}>
            {q.name}
          </span>
          {q.enabled ? null : <Badge tone="gray">off</Badge>}
          {signedIn ? (
            <Badge tone="blue" icon={ShieldCheck}>
              signed-in visitors only
            </Badge>
          ) : null}
        </div>
        <p className="mt-1 line-clamp-2 text-sm text-slate-600" title={q.description}>
          {q.description}
        </p>
        <p className="mt-1 text-xs text-slate-500">{`${inputs} input${inputs === 1 ? "" : "s"} from the AI`}</p>
        {delState?.error || toggleState?.error ? (
          <p role="alert" className="mt-1 text-xs font-medium text-red-600">
            {delState?.error ?? toggleState?.error}
          </p>
        ) : null}
      </div>
      {canManage ? (
        <div className="-ml-2 flex shrink-0 flex-wrap items-center gap-1 sm:ml-0">
          <Button type="button" variant="ghost" size="sm" onClick={onEdit} className={subtle}>
            <Pencil aria-hidden />
            Edit and try
          </Button>
          <form action={toggle}>
            <input type="hidden" name="queryId" value={q.id} />
            <input type="hidden" name="enabled" value={q.enabled ? "false" : "true"} />
            <SmallFormButton label={q.enabled ? `Turn off ${q.name}` : `Turn on ${q.name}`} className={subtle}>
              {q.enabled ? "Turn off" : "Turn on"}
            </SmallFormButton>
          </form>
          <form action={del}>
            <input type="hidden" name="queryId" value={q.id} />
            <SmallFormButton label={`Delete ${q.name}`} confirmText={`Delete ${q.name}? Agents stop using it right away.`} className="text-slate-500 hover:bg-red-50 hover:text-red-700">
              <Trash2 aria-hidden />
            </SmallFormButton>
          </form>
        </div>
      ) : null}
    </div>
  );
}

export function QueriesPanel({ queries, canManage, dialect }: { queries: QueryView[]; canManage: boolean; dialect: DbDialect }) {
  const [editing, setEditing] = useState<{ id: string | null; draft: Draft } | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    if (!saved) return;
    const t = setTimeout(() => setSaved(null), 4000);
    return () => clearTimeout(t);
  }, [saved]);

  const done = (savedId: string | null) => {
    if (savedId) setSaved(savedId);
    setEditing(null);
  };

  return (
    <div className="border-t border-slate-100">
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-slate-900">Queries</h3>
          <p className="mt-0.5 text-xs leading-5 text-slate-500">
            Each query is one tool. It runs read only, stops after 3 seconds and returns at most 20 rows.
          </p>
        </div>
        {canManage && !editing && queries.length < MAX_QUERIES ? (
          <div className="flex flex-wrap gap-2">
            {queries.length === 0 ? (
              <Button type="button" variant="secondary" size="sm" onClick={() => setEditing({ id: null, draft: EXAMPLE() })}>
                Start from an example
              </Button>
            ) : null}
            <Button type="button" variant="secondary" size="sm" onClick={() => setEditing({ id: null, draft: BLANK() })}>
              <Plus aria-hidden />
              Add query
            </Button>
          </div>
        ) : null}
      </div>

      {editing && editing.id === null ? (
        <div className="border-t border-slate-100 p-5">
          <h4 className="mb-4 text-sm font-semibold text-slate-900">New query</h4>
          <QueryForm queryId={null} initial={editing.draft} dialect={dialect} onDone={done} />
        </div>
      ) : null}

      {queries.length ? (
        <ul className="divide-y divide-slate-100 border-t border-slate-100">
          {queries.map((q) => (
            <li key={q.id} className={cx("px-5 py-4 transition-colors", saved === q.id && "bg-emerald-50/50")}>
              {editing?.id === q.id ? (
                <>
                  <h4 className="mb-4 text-sm font-semibold text-slate-900">
                    Edit <span className="font-mono">{q.name}</span>
                  </h4>
                  <QueryForm queryId={q.id} initial={editing.draft} dialect={dialect} onDone={done} />
                </>
              ) : (
                <QueryRow q={q} canManage={canManage && !editing} onEdit={() => setEditing({ id: q.id, draft: fromView(q) })} />
              )}
            </li>
          ))}
        </ul>
      ) : !editing ? (
        <p className="border-t border-slate-100 px-5 py-4 text-sm text-slate-500">
          No queries yet.{canManage ? " Add one so your agent can look things up." : ""}
        </p>
      ) : null}
      {saved ? (
        <div className="px-5 pb-4">
          <Notice tone="success">Query saved.</Notice>
        </div>
      ) : null}
      <p className="border-t border-slate-100 px-5 py-3 text-xs leading-5 text-slate-500">
        Use a database user that can only read, and only the tables the agent needs. Every query is checked before it is saved: one statement that only reads.
      </p>
    </div>
  );
}
