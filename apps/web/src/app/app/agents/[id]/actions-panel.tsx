"use client";

import type { ActionParameter } from "@talkfront/shared";
import { CircleAlert, FlaskConical, Pencil, Play, Plus, Trash2, X, Zap } from "lucide-react";
import { type FormEvent, type ReactNode, startTransition, useActionState, useEffect, useId, useState } from "react";
import { useFormStatus } from "react-dom";
import { ActionMessage } from "@/components/form-bits";
import { Badge, Button, Card, CardHeader, cx, Field, Input, Notice, Select, Textarea } from "@/components/ui";
import { DEFAULT_TIMEOUT_MS, PARAMETER_TYPE_LABELS } from "@/lib/actions/schema";
import { deleteHttpAction, saveHttpAction, setHttpActionEnabled, testHttpAction } from "./http-actions";
import type { ActionView } from "./integrations-data";

type ParamDraft = { key: string; name: string; type: ActionParameter["type"]; description: string; required: boolean; enumText: string };
type HeaderDraft = { key: string; name: string; value: string; keep: string | null };
type Draft = {
  name: string;
  description: string;
  method: "GET" | "POST";
  url: string;
  timeoutSec: number;
  enabled: boolean;
  parameters: ParamDraft[];
  headers: HeaderDraft[];
};

let keySeq = 0;
const nextKey = () => `k${++keySeq}`;

const blankParam = (): ParamDraft => ({ key: nextKey(), name: "", type: "string", description: "", required: true, enumText: "" });
const blankHeader = (): HeaderDraft => ({ key: nextKey(), name: "", value: "", keep: null });

const BLANK: () => Draft = () => ({
  name: "",
  description: "",
  method: "GET",
  url: "",
  timeoutSec: DEFAULT_TIMEOUT_MS / 1000,
  enabled: true,
  parameters: [],
  headers: [],
});

const EXAMPLE: () => Draft = () => ({
  name: "check_order_status",
  description: "Look up the status of an order when the visitor gives their order number. Returns the status and the expected delivery date.",
  method: "GET",
  url: "https://api.example.com/orders/status",
  timeoutSec: 8,
  enabled: true,
  parameters: [{ key: nextKey(), name: "order_id", type: "string", description: "The order number, e.g. A-1001", required: true, enumText: "" }],
  headers: [{ key: nextKey(), name: "Authorization", value: "", keep: null }],
});

function fromView(a: ActionView): Draft {
  return {
    name: a.name,
    description: a.description,
    method: a.method,
    url: a.url,
    timeoutSec: Math.round(a.timeoutMs / 1000),
    enabled: a.enabled,
    parameters: a.parameters.map((p) => ({
      key: nextKey(),
      name: p.name,
      type: p.type,
      description: p.description,
      required: p.required,
      enumText: (p.enum ?? []).join(", "),
    })),
    headers: a.headersUnreadable ? [] : a.headerNames.map((n) => ({ key: nextKey(), name: n, value: "", keep: n })),
  };
}

function toPayload(agentId: string, actionId: string | null, d: Draft) {
  return JSON.stringify({
    agentId,
    actionId,
    name: d.name.trim(),
    description: d.description,
    method: d.method,
    url: d.url,
    timeoutSec: Number(d.timeoutSec),
    enabled: d.enabled,
    parameters: d.parameters.map((p) => ({
      name: p.name.trim(),
      type: p.type,
      description: p.description,
      required: p.required,
      ...(p.type === "string" && p.enumText.trim()
        ? { enum: p.enumText.split(",").map((v) => v.trim()).filter(Boolean) }
        : {}),
    })),
    headers: d.headers.map((h) => ({ name: h.name.trim(), value: h.value, keep: h.keep })),
  });
}

function hostOf(url: string) {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname === "/" ? "" : u.pathname}`;
  } catch {
    return url;
  }
}

function MethodBadge({ method }: { method: "GET" | "POST" }) {
  return (
    <span
      className={cx(
        "inline-flex h-5 shrink-0 items-center rounded-md px-1.5 font-mono text-[11px] font-semibold ring-1 ring-inset",
        method === "GET" ? "bg-sky-50 text-sky-700 ring-sky-600/20" : "bg-violet-50 text-violet-700 ring-violet-600/20",
      )}
    >
      {method}
    </span>
  );
}

const subtle = "text-slate-500 hover:bg-slate-900/5 hover:text-slate-900";

/**
 * useActionState driven from onSubmit instead of <form action>. A form action resets the form when it
 * finishes, which puts controlled selects out of sync with React state (the DOM shows the first option).
 */
function useSubmitAction<S>(fn: (prev: Awaited<S>, data: FormData) => S | Promise<S>, initial: Awaited<S>) {
  const [state, dispatch, pending] = useActionState<S, FormData>(fn, initial);
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    startTransition(() => dispatch(data));
  };
  return [state, onSubmit, pending] as const;
}

// ---------------------------------------------------------------------------- form

function SubHeading({ title, hint, action }: { title: string; hint?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-2">
      <div className="min-w-0">
        <h4 className="text-sm font-medium text-slate-800">{title}</h4>
        {hint ? <p className="mt-0.5 text-xs leading-5 text-slate-500">{hint}</p> : null}
      </div>
      {action}
    </div>
  );
}

function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button type="button" variant="ghost" size="sm" onClick={onClick} aria-label={label} title={label} className={cx("size-8 px-0", subtle)}>
      <X aria-hidden />
    </Button>
  );
}

function ParamEditor({ p, index, onChange, onRemove }: { p: ParamDraft; index: number; onChange: (p: ParamDraft) => void; onRemove: () => void }) {
  const id = useId();
  const n = index + 1;
  return (
    <li className="relative rounded-xl border border-slate-200 bg-slate-50/50 p-3.5">
      <div className="absolute right-2 top-2">
        <RemoveButton label={`Remove input ${n}`} onClick={onRemove} />
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-3 sm:grid-cols-[minmax(0,1fr)_10rem_auto]">
        <div className="col-span-2 sm:col-span-1">
          <Field label={`Input ${n} name`} htmlFor={`${id}-name`}>
            <Input
              id={`${id}-name`}
              value={p.name}
              onChange={(e) => onChange({ ...p, name: e.target.value })}
              placeholder="order_id"
              maxLength={40}
              spellCheck={false}
              autoComplete="off"
              className="bg-white font-mono text-xs"
              required
            />
          </Field>
        </div>
        <Field label="Type" htmlFor={`${id}-type`}>
          <Select id={`${id}-type`} value={p.type} onChange={(e) => onChange({ ...p, type: e.target.value as ParamDraft["type"] })} className="bg-white">
            {(Object.keys(PARAMETER_TYPE_LABELS) as ParamDraft["type"][]).map((t) => (
              <option key={t} value={t}>
                {PARAMETER_TYPE_LABELS[t]}
              </option>
            ))}
          </Select>
        </Field>
        <div className="flex items-center">
          <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg px-1 text-sm text-slate-700 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand-600">
            <input
              type="checkbox"
              checked={p.required}
              aria-label={`Input ${n} required`}
              onChange={(e) => onChange({ ...p, required: e.target.checked })}
              className="size-4 accent-brand-600 focus:outline-none"
            />
            Required
          </label>
        </div>
      </div>
      <div className={cx("mt-3 grid gap-3", p.type === "string" && "sm:grid-cols-2")}>
        <Field label="What it is" htmlFor={`${id}-desc`}>
          <Input
            id={`${id}-desc`}
            value={p.description}
            onChange={(e) => onChange({ ...p, description: e.target.value })}
            placeholder="What the agent should ask for"
            maxLength={300}
            className="bg-white"
          />
        </Field>
        {p.type === "string" ? (
          <Field label="Allowed values (optional)" htmlFor={`${id}-enum`}>
            <Input
              id={`${id}-enum`}
              value={p.enumText}
              onChange={(e) => onChange({ ...p, enumText: e.target.value })}
              placeholder="e.g. standard, express"
              maxLength={2000}
              className="bg-white"
            />
          </Field>
        ) : null}
      </div>
    </li>
  );
}

function HeaderEditor({ h, index, onChange, onRemove }: { h: HeaderDraft; index: number; onChange: (h: HeaderDraft) => void; onRemove: () => void }) {
  const id = useId();
  const n = index + 1;
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_auto]">
      <Input
        aria-label={`Header ${n} name`}
        id={`${id}-name`}
        value={h.name}
        onChange={(e) => onChange({ ...h, name: e.target.value })}
        placeholder="Authorization"
        maxLength={100}
        spellCheck={false}
        autoComplete="off"
        className="font-mono text-xs"
      />
      <div className="col-start-1 row-start-2 sm:col-start-auto sm:row-start-auto">
        <Input
          aria-label={`Header ${n} value`}
          value={h.value}
          onChange={(e) => onChange({ ...h, value: e.target.value })}
          placeholder={h.keep ? "Saved. Leave blank to keep it." : "Bearer your-api-key"}
          maxLength={4000}
          spellCheck={false}
          autoComplete="off"
          data-1p-ignore
          data-lpignore="true"
          className="font-mono text-xs"
        />
      </div>
      <div className="col-start-2 row-start-1 sm:col-start-auto sm:row-start-auto">
        <RemoveButton label={`Remove header ${n}`} onClick={onRemove} />
      </div>
    </li>
  );
}

function ActionForm({
  agentId,
  actionId,
  initial,
  unreadableHeaders,
  onDone,
}: {
  agentId: string;
  actionId: string | null;
  initial: Draft;
  unreadableHeaders?: boolean;
  onDone: (savedId: string | null) => void;
}) {
  const [state, onSubmit, pending] = useSubmitAction(saveHttpAction, null);
  const [d, setD] = useState<Draft>(initial);
  const id = useId();
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));

  useEffect(() => {
    if (state?.ok) onDone(state.savedId ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <input type="hidden" name="payload" value={toPayload(agentId, actionId, d)} />

      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_8rem]">
        <Field label="Name" htmlFor={`${id}-name`} hint="The agent sees this name. Lowercase letters, numbers and _.">
          <Input
            id={`${id}-name`}
            value={d.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder="check_order_status"
            maxLength={40}
            required
            spellCheck={false}
            autoComplete="off"
            className="font-mono text-xs"
          />
        </Field>
        <Field label="Method" htmlFor={`${id}-method`}>
          <Select id={`${id}-method`} value={d.method} onChange={(e) => set("method", e.target.value as Draft["method"])}>
            <option value="GET">GET</option>
            <option value="POST">POST</option>
          </Select>
        </Field>
      </div>

      <Field label="URL" htmlFor={`${id}-url`} hint="Your HTTPS endpoint. It must be reachable from the internet.">
        <Input
          id={`${id}-url`}
          type="url"
          value={d.url}
          onChange={(e) => set("url", e.target.value)}
          placeholder="https://api.example.com/orders/status"
          maxLength={2048}
          required
          spellCheck={false}
          className="font-mono text-xs"
        />
      </Field>

      <Field label="When to use it" htmlFor={`${id}-desc`} hint="Plain words for the agent: what it does and when to call it.">
        <Textarea
          id={`${id}-desc`}
          value={d.description}
          onChange={(e) => set("description", e.target.value)}
          placeholder="Look up the status of an order when the visitor gives their order number."
          maxLength={1000}
          rows={2}
          required
          className="min-h-16"
        />
      </Field>

      <div className="space-y-3 border-t border-slate-100 pt-5">
        <SubHeading
          title="Inputs"
          hint={
            d.method === "GET"
              ? "What the agent must find out first. Sent as query parameters, e.g. ?order_id=A-1001."
              : "What the agent must find out first. Sent as a JSON body, e.g. {\"order_id\": \"A-1001\"}."
          }
        />
        {d.parameters.length ? (
          <ul className="space-y-2.5">
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
          <p className="rounded-xl border border-dashed border-slate-200 px-4 py-3 text-xs text-slate-500">No inputs: the agent calls it as is.</p>
        )}
        <Button type="button" variant="secondary" size="sm" onClick={() => set("parameters", [...d.parameters, blankParam()])} disabled={d.parameters.length >= 20}>
          <Plus aria-hidden />
          Add input
        </Button>
      </div>

      <div className="space-y-3 border-t border-slate-100 pt-5">
        <SubHeading title="Headers" hint="Sent with every call, e.g. an API key. Values are stored encrypted and hidden after saving." />
        {unreadableHeaders ? (
          <Notice tone="error">The saved headers could not be read. Enter them again before saving.</Notice>
        ) : null}
        {d.headers.length ? (
          <ul className="space-y-2">
            {d.headers.map((h, i) => (
              <HeaderEditor
                key={h.key}
                h={h}
                index={i}
                onChange={(nh) => set("headers", d.headers.map((x) => (x.key === h.key ? nh : x)))}
                onRemove={() => set("headers", d.headers.filter((x) => x.key !== h.key))}
              />
            ))}
          </ul>
        ) : null}
        <Button type="button" variant="secondary" size="sm" onClick={() => set("headers", [...d.headers, blankHeader()])} disabled={d.headers.length >= 20}>
          <Plus aria-hidden />
          Add header
        </Button>
      </div>

      <div className="grid gap-4 border-t border-slate-100 pt-5 sm:grid-cols-[10rem_minmax(0,1fr)] sm:items-start">
        <Field label="Timeout (seconds)" htmlFor={`${id}-timeout`} hint="1 to 15.">
          <Input
            id={`${id}-timeout`}
            type="number"
            min={1}
            max={15}
            step={1}
            value={d.timeoutSec}
            onChange={(e) => set("timeoutSec", e.target.value === "" ? 0 : Number(e.target.value))}
            required
          />
        </Field>
        <EnabledToggle checked={d.enabled} onChange={(v) => set("enabled", v)} />
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 pt-5">
        <Button type="submit" disabled={pending} aria-busy={pending}>
          {pending ? "Saving..." : actionId ? "Save action" : "Add action"}
        </Button>
        <Button type="button" variant="ghost" onClick={() => onDone(null)}>
          Cancel
        </Button>
        <div className="min-w-0 basis-full sm:basis-auto">
          <ActionMessage state={state} />
        </div>
      </div>
    </form>
  );
}

/** Controlled twin of the shared Toggle (the form state lives in React here). */
function EnabledToggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="group flex cursor-pointer items-start justify-between gap-4 rounded-xl border border-slate-200 bg-white px-4 py-3 transition-colors hover:border-slate-300 has-[:checked]:border-brand-200 has-[:checked]:bg-brand-50/40 sm:mt-6">
      <span className="min-w-0">
        <span className="block text-sm font-medium text-slate-900">On</span>
        <span className="mt-0.5 block text-xs leading-5 text-slate-500">When off, the agent can't use it. You can still test it here.</span>
      </span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="peer sr-only" />
      <span
        aria-hidden
        className="relative mt-0.5 h-5 w-9 shrink-0 rounded-full bg-slate-200 transition-colors peer-checked:bg-brand-600 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand-600 after:absolute after:left-0.5 after:top-0.5 after:size-4 after:rounded-full after:bg-white after:shadow-sm after:transition-transform peer-checked:after:translate-x-4"
      />
    </label>
  );
}

// ---------------------------------------------------------------------------- test

function sampleFor(p: ActionParameter): string {
  if (p.enum?.length) return p.enum[0]!;
  if (p.type === "boolean") return "true";
  if (p.type === "number" || p.type === "integer") return "1";
  return "test";
}

function TestPanel({ agentId, action, onClose }: { agentId: string; action: ActionView; onClose: () => void }) {
  const [state, onSubmit, pending] = useSubmitAction(testHttpAction, null);
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(action.parameters.map((p) => [p.name, sampleFor(p)])),
  );
  const id = useId();
  const args = Object.fromEntries(Object.entries(values).filter(([, v]) => v !== ""));

  return (
    <div className="rounded-xl border border-brand-100 bg-brand-50/30 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-medium text-slate-900">
            <FlaskConical className="size-4 text-brand-600" aria-hidden />
            Test {action.name}
          </p>
          <p className="mt-0.5 text-xs leading-5 text-slate-500">
            Makes a real call with your saved headers. Test calls send a conversation id that starts with <code className="font-mono">test_</code>.
          </p>
        </div>
        <RemoveButton label="Close test" onClick={onClose} />
      </div>

      <form onSubmit={onSubmit} className="mt-3 space-y-3">
        <input type="hidden" name="agentId" value={agentId} />
        <input type="hidden" name="actionId" value={action.id} />
        <input type="hidden" name="args" value={JSON.stringify(args)} />
        {action.parameters.length ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {action.parameters.map((p) => (
              <Field key={p.name} label={`${p.name}${p.required ? "" : " (optional)"}`} htmlFor={`${id}-${p.name}`} hint={p.description || undefined}>
                {p.enum?.length || p.type === "boolean" ? (
                  <Select
                    id={`${id}-${p.name}`}
                    value={values[p.name] ?? ""}
                    onChange={(e) => setValues((v) => ({ ...v, [p.name]: e.target.value }))}
                    className="bg-white"
                  >
                    {!p.required ? <option value="">Leave out</option> : null}
                    {(p.type === "boolean" ? ["true", "false"] : p.enum!).map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
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
        ) : (
          <p className="text-xs text-slate-500">This action has no inputs.</p>
        )}
        <Button type="submit" size="sm" disabled={pending} aria-busy={pending}>
          <Play aria-hidden />
          {pending ? "Running..." : "Run test"}
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
              {state.status ? `HTTP ${state.status}` : "No response"}
            </Badge>
            <span className="text-slate-500 tabular-nums">{state.durationMs} ms</span>
          </div>
          <p className="truncate font-mono text-[11px] text-slate-500" title={`${state.request.method} ${state.request.url}`}>
            {state.request.method} {state.request.url}
          </p>
          {state.request.body ? (
            <p className="truncate font-mono text-[11px] text-slate-500" title={state.request.body}>
              Body: {state.request.body}
            </p>
          ) : null}
          {!state.ok ? (
            <p className="flex items-start gap-2 text-sm text-red-700">
              <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span className="min-w-0 [overflow-wrap:anywhere]">The agent would hear that the action did not work.</span>
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

// ---------------------------------------------------------------------------- list

function SmallFormButton({ children, label, className, confirmText }: { children: ReactNode; label: string; className?: string; confirmText?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      variant="ghost"
      size="sm"
      disabled={pending}
      aria-busy={pending}
      aria-label={label}
      title={label}
      className={className}
      onClick={(e) => {
        if (confirmText && !window.confirm(confirmText)) e.preventDefault();
      }}
    >
      {children}
    </Button>
  );
}

function ActionRow({
  agentId,
  action,
  canManage,
  onEdit,
  onTest,
  testing,
}: {
  agentId: string;
  action: ActionView;
  canManage: boolean;
  onEdit: () => void;
  onTest: () => void;
  testing: boolean;
}) {
  const [delState, del] = useActionState(deleteHttpAction, null);
  const [toggleState, toggle] = useActionState(setHttpActionEnabled, null);
  const meta = [
    `${action.parameters.length} input${action.parameters.length === 1 ? "" : "s"}`,
    action.headerNames.length ? `${action.headerNames.length} header${action.headerNames.length === 1 ? "" : "s"}` : null,
    `${Math.round(action.timeoutMs / 1000)} s timeout`,
  ].filter(Boolean);

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <MethodBadge method={action.method} />
          <span className="min-w-0 truncate font-mono text-sm font-medium text-slate-900" title={action.name}>
            {action.name}
          </span>
          {action.enabled ? null : <Badge tone="gray">off</Badge>}
          {action.headersUnreadable ? <Badge tone="red">headers need re-entering</Badge> : null}
        </div>
        <p className="mt-1 line-clamp-2 text-sm text-slate-600" title={action.description}>
          {action.description}
        </p>
        <p className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 text-xs text-slate-500">
          <span className="min-w-0 max-w-full truncate font-mono" title={action.url}>
            {hostOf(action.url)}
          </span>
          <span aria-hidden className="hidden sm:inline">·</span>
          <span>{meta.join(" · ")}</span>
        </p>
        {delState?.error || toggleState?.error ? (
          <p role="alert" className="mt-1 text-xs font-medium text-red-600">
            {delState?.error ?? toggleState?.error}
          </p>
        ) : null}
      </div>
      {canManage ? (
        <div className="-ml-2 flex shrink-0 flex-wrap items-center gap-1 sm:ml-0">
          <Button type="button" variant={testing ? "secondary" : "ghost"} size="sm" onClick={onTest} aria-pressed={testing} className={testing ? undefined : subtle}>
            <FlaskConical aria-hidden />
            Test
          </Button>
          <form action={toggle}>
            <input type="hidden" name="agentId" value={agentId} />
            <input type="hidden" name="actionId" value={action.id} />
            <input type="hidden" name="enabled" value={action.enabled ? "false" : "true"} />
            <SmallFormButton label={action.enabled ? `Turn off ${action.name}` : `Turn on ${action.name}`} className={subtle}>
              {action.enabled ? "Turn off" : "Turn on"}
            </SmallFormButton>
          </form>
          <Button type="button" variant="ghost" size="sm" onClick={onEdit} className={subtle}>
            <Pencil aria-hidden />
            Edit
          </Button>
          <form action={del}>
            <input type="hidden" name="agentId" value={agentId} />
            <input type="hidden" name="actionId" value={action.id} />
            <SmallFormButton
              label={`Delete ${action.name}`}
              confirmText={`Delete ${action.name}? The agent stops using it right away.`}
              className="text-slate-500 hover:bg-red-50 hover:text-red-700"
            >
              <Trash2 aria-hidden />
            </SmallFormButton>
          </form>
        </div>
      ) : null}
    </div>
  );
}

function ExampleCard() {
  const ex = EXAMPLE();
  return (
    <div className="mx-auto w-full max-w-md rounded-xl border border-dashed border-slate-300 bg-slate-50/60 p-4 text-left">
      <p className="text-[11px] font-medium uppercase tracking-wider text-slate-400">Example</p>
      <div className="mt-2 flex min-w-0 items-center gap-2">
        <MethodBadge method={ex.method} />
        <span className="truncate font-mono text-sm font-medium text-slate-900">{ex.name}</span>
      </div>
      <p className="mt-1 truncate font-mono text-xs text-slate-500" title={`${ex.url}?order_id=A-1001`}>
        {ex.url}?order_id=A-1001
      </p>
      <p className="mt-2 text-sm leading-6 text-slate-600">
        Visitor: &ldquo;Where is my order A-1001?&rdquo; The agent calls your API and answers from what it returns.
      </p>
    </div>
  );
}

export function ActionsPanel({ agentId, actions, canManage }: { agentId: string; actions: ActionView[]; canManage: boolean }) {
  const [editing, setEditing] = useState<{ id: string | null; draft: Draft } | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState<string | null>(null);

  useEffect(() => {
    if (!justSaved) return;
    const t = setTimeout(() => setJustSaved(null), 4000);
    return () => clearTimeout(t);
  }, [justSaved]);

  const startNew = (draft: Draft) => {
    setTesting(null);
    setEditing({ id: null, draft });
  };
  const done = (savedId: string | null) => {
    if (savedId) setJustSaved(savedId);
    setEditing(null);
  };

  return (
    <Card id="actions">
      <CardHeader
        title="Actions"
        icon={Zap}
        description="Let the agent call your own API during a conversation, e.g. to check an order or a booking."
        action={
          canManage && actions.length > 0 && !editing ? (
            <Button type="button" variant="secondary" size="sm" onClick={() => startNew(BLANK())}>
              <Plus aria-hidden />
              Add action
            </Button>
          ) : null
        }
      />

      {editing && editing.id === null ? (
        <div className="border-b border-slate-100 p-5">
          <h3 className="mb-4 text-sm font-semibold text-slate-900">New action</h3>
          <ActionForm agentId={agentId} actionId={null} initial={editing.draft} onDone={done} />
        </div>
      ) : null}

      {actions.length === 0 && !editing ? (
        <div className="flex flex-col items-center px-5 py-10 text-center">
          <span className="mb-4 grid size-12 place-items-center rounded-2xl bg-gradient-to-br from-brand-50 to-orange-50 text-brand-600 ring-1 ring-brand-100" aria-hidden>
            <Zap className="size-5" />
          </span>
          <p className="text-sm font-semibold text-slate-900">No actions yet</p>
          <p className="mt-1 max-w-md text-sm text-slate-500">
            An action is one request to your API. The agent fills in the inputs, Halochime makes the call from its servers, and the agent answers from
            the result.
          </p>
          <div className="mt-5 w-full">
            <ExampleCard />
          </div>
          {canManage ? (
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              <Button type="button" onClick={() => startNew(EXAMPLE())}>
                <Plus aria-hidden />
                Start from the example
              </Button>
              <Button type="button" variant="secondary" onClick={() => startNew(BLANK())}>
                Start blank
              </Button>
            </div>
          ) : (
            <p className="mt-5 text-xs text-slate-500">Only owners and admins can add actions.</p>
          )}
        </div>
      ) : null}

      {actions.length ? (
        <ul className="divide-y divide-slate-100">
          {actions.map((a) => (
            <li key={a.id} className={cx("px-5 py-4 transition-colors", justSaved === a.id && "bg-emerald-50/50")}>
              {editing?.id === a.id ? (
                <>
                  <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-slate-900">
                    Edit <span className="font-mono">{a.name}</span>
                  </h3>
                  <ActionForm agentId={agentId} actionId={a.id} initial={editing.draft} unreadableHeaders={a.headersUnreadable} onDone={done} />
                </>
              ) : (
                <div className="space-y-3">
                  <ActionRow
                    agentId={agentId}
                    action={a}
                    canManage={canManage && !editing}
                    testing={testing === a.id}
                    onEdit={() => {
                      setTesting(null);
                      setEditing({ id: a.id, draft: fromView(a) });
                    }}
                    onTest={() => setTesting((t) => (t === a.id ? null : a.id))}
                  />
                  {testing === a.id ? <TestPanel agentId={agentId} action={a} onClose={() => setTesting(null)} /> : null}
                </div>
              )}
            </li>
          ))}
        </ul>
      ) : null}

      {actions.length || editing ? (
        <p className="border-t border-slate-100 px-5 py-3 text-xs leading-5 text-slate-500">
          Each call sends your headers plus <code className="font-mono">X-Halochime-Conversation</code>, and{" "}
          <code className="font-mono">X-Halochime-Visitor</code> (your user id) when the visitor is signed in. Answers are cut to 4,000 characters.
        </p>
      ) : null}
      {!canManage && actions.length ? (
        <p className="border-t border-slate-100 px-5 py-3 text-xs text-slate-500">Only owners and admins can change or test actions.</p>
      ) : null}
    </Card>
  );
}
