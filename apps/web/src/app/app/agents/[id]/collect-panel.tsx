"use client";

import { COLLECT_FIELD_TYPES, MAX_COLLECT_FIELDS, type CollectField, type CollectFieldType } from "@talkfront/shared";
import { ArrowDown, ArrowUp, ClipboardList, Lock, MessageCircleQuestion, Pencil, Plus, Trash2 } from "lucide-react";
import { type FormEvent, type ReactNode, startTransition, useActionState, useEffect, useId, useOptimistic, useState } from "react";
import { ActionMessage } from "@/components/form-bits";
import { Badge, Button, Card, CardHeader, cx, Field, Input, Notice, Select, Textarea } from "@/components/ui";
import { BUILT_IN_FIELDS, COLLECT_TYPE_LABELS, isBuiltInKey, keyFromLabel } from "@/lib/collect";
import { saveCollectFields } from "./collect-actions";

type Draft = {
  label: string;
  key: string;
  /** Once the key is typed by hand (or the field exists), renaming the label no longer changes it. */
  keyTouched: boolean;
  description: string;
  type: CollectFieldType;
  optionsText: string;
  ask: boolean;
};

const BLANK = (): Draft => ({ label: "", key: "", keyTouched: false, description: "", type: "text", optionsText: "", ask: true });

const EXAMPLE = (): Draft => ({
  label: "Party size",
  key: "party_size",
  keyTouched: false,
  description: "How many people the booking is for, including children.",
  type: "number",
  optionsText: "",
  ask: true,
});

const fromField = (f: CollectField): Draft => ({
  label: f.label,
  key: f.key,
  keyTouched: true,
  description: f.description,
  type: f.type,
  optionsText: (f.options ?? []).join(", "),
  ask: f.ask,
});

const toField = (d: Draft): CollectField => ({
  key: d.key.trim(),
  label: d.label.trim(),
  description: d.description.trim(),
  type: d.type,
  ...(d.type === "choice"
    ? {
        options: d.optionsText
          .split(",")
          .map((o) => o.trim())
          .filter(Boolean),
      }
    : {}),
  ask: d.ask,
});

/** What each built-in field holds, shown on hover. */
const BUILT_IN_HINTS: Record<string, string> = {
  visitor_name: "The visitor's name, if they gave it",
  email: "Their email address, if they gave it",
  phone: "Their phone number, if they gave it",
  topic: "What they wanted, in a few words",
  outcome: "Answered, message taken, not answered or other",
  follow_up_needed: "Whether your team needs to do something",
  sentiment: "Positive, neutral or negative",
};

const subtle = "text-slate-500 hover:bg-slate-900/5 hover:text-slate-900";

// ---------------------------------------------------------------------------- form

function AskToggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="group flex cursor-pointer items-start justify-between gap-4 rounded-xl border border-slate-200 bg-white px-4 py-3 transition-colors hover:border-slate-300 has-[:checked]:border-brand-200 has-[:checked]:bg-brand-50/40">
      <span className="min-w-0">
        <span className="block text-sm font-medium text-slate-900">Agent asks for it</span>
        <span className="mt-0.5 block text-xs leading-5 text-slate-500">
          The agent tries to find this out when it fits the conversation. When off, it is only noted if the visitor mentions it.
        </span>
      </span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="peer sr-only" />
      <span
        aria-hidden
        className="relative mt-0.5 h-5 w-9 shrink-0 rounded-full bg-slate-200 transition-colors peer-checked:bg-brand-600 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand-600 after:absolute after:left-0.5 after:top-0.5 after:size-4 after:rounded-full after:bg-white after:shadow-sm after:transition-transform peer-checked:after:translate-x-4"
      />
    </label>
  );
}

function FieldForm({
  initial,
  isNew,
  pending,
  state,
  onSubmit,
  onCancel,
}: {
  initial: Draft;
  isNew: boolean;
  pending: boolean;
  state: Parameters<typeof ActionMessage>[0]["state"];
  onSubmit: (field: CollectField) => void;
  onCancel: () => void;
}) {
  const [d, setD] = useState<Draft>(initial);
  const id = useId();
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));
  const keyClash = d.key && isBuiltInKey(d.key.trim());

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    onSubmit(toField(d));
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Label" htmlFor={`${id}-label`} hint="What your team sees, e.g. on the conversation page.">
          <Input
            id={`${id}-label`}
            value={d.label}
            onChange={(e) => {
              const label = e.target.value;
              setD((x) => ({ ...x, label, key: x.keyTouched ? x.key : keyFromLabel(label) }));
            }}
            placeholder="Party size"
            maxLength={60}
            required
            autoComplete="off"
          />
        </Field>
        <Field
          label="Key"
          htmlFor={`${id}-key`}
          error={keyClash ? "This one is always collected already. Pick another key." : undefined}
          hint="The name in webhooks. Lowercase letters, numbers and _."
        >
          <Input
            id={`${id}-key`}
            value={d.key}
            onChange={(e) => setD((x) => ({ ...x, key: e.target.value, keyTouched: true }))}
            placeholder="party_size"
            maxLength={40}
            required
            spellCheck={false}
            autoComplete="off"
            aria-invalid={keyClash ? true : undefined}
            className="font-mono text-xs"
          />
        </Field>
      </div>

      <div className={cx("grid gap-4", d.type === "choice" && "sm:grid-cols-[12rem_minmax(0,1fr)]")}>
        <div className={cx(d.type !== "choice" && "sm:max-w-[12rem]")}>
          <Field label="Type" htmlFor={`${id}-type`}>
            <Select id={`${id}-type`} value={d.type} onChange={(e) => set("type", e.target.value as CollectFieldType)}>
              {COLLECT_FIELD_TYPES.map((t) => (
                <option key={t} value={t}>
                  {COLLECT_TYPE_LABELS[t]}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        {d.type === "choice" ? (
          <Field label="Options" htmlFor={`${id}-options`} hint="2 to 10, separated by commas.">
            <Input
              id={`${id}-options`}
              value={d.optionsText}
              onChange={(e) => set("optionsText", e.target.value)}
              placeholder="indoor, outdoor"
              maxLength={700}
              required
              autoComplete="off"
            />
          </Field>
        ) : null}
      </div>

      <Field label="What to look for" htmlFor={`${id}-desc`} hint="Plain words. Used to fill it in after the conversation, and by the agent when it asks.">
        <Textarea
          id={`${id}-desc`}
          value={d.description}
          onChange={(e) => set("description", e.target.value)}
          placeholder="e.g. How many people the booking is for, including children."
          maxLength={300}
          rows={2}
          className="min-h-16"
        />
      </Field>

      <AskToggle checked={d.ask} onChange={(v) => set("ask", v)} />

      <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 pt-4">
        <Button type="submit" disabled={pending} aria-busy={pending}>
          {pending ? "Saving..." : isNew ? "Add field" : "Save field"}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <div className="min-w-0 basis-full sm:basis-auto">
          <ActionMessage state={state} />
        </div>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------- list

function FieldSummary({ f }: { f: CollectField }) {
  return (
    <div className="min-w-0 flex-1">
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <span className="min-w-0 truncate text-sm font-medium text-slate-900" title={f.label}>
          {f.label}
        </span>
        <Badge tone="gray">{COLLECT_TYPE_LABELS[f.type]}</Badge>
        {f.ask ? (
          <Badge tone="blue" icon={MessageCircleQuestion}>
            Agent asks
          </Badge>
        ) : null}
      </div>
      <p className="mt-0.5 truncate font-mono text-[11px] text-slate-400" title={f.key}>
        {f.key}
      </p>
      {f.description ? (
        <p className="mt-1 line-clamp-2 text-sm text-slate-600" title={f.description}>
          {f.description}
        </p>
      ) : null}
      {f.type === "choice" && f.options?.length ? (
        <p className="mt-1 truncate text-xs text-slate-500" title={f.options.join(", ")}>
          Options: {f.options.join(", ")}
        </p>
      ) : null}
    </div>
  );
}

function IconButton({ label, onClick, disabled, danger, children }: { label: string; onClick: () => void; disabled?: boolean; danger?: boolean; children: ReactNode }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={cx("size-8 px-0", danger ? "text-slate-500 hover:bg-red-50 hover:text-red-700" : subtle)}
    >
      {children}
    </Button>
  );
}

function ExampleCard() {
  return (
    <div className="mx-auto w-full max-w-md rounded-xl border border-dashed border-slate-300 bg-slate-50/60 p-4 text-left">
      <p className="text-[11px] font-medium uppercase tracking-wider text-slate-400">Example</p>
      <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-slate-900">Party size</span>
        <Badge tone="gray">Number</Badge>
        <Badge tone="blue" icon={MessageCircleQuestion}>
          Agent asks
        </Badge>
      </div>
      <p className="mt-2 text-sm leading-6 text-slate-600">
        Visitor: &ldquo;A table for four on Friday, please.&rdquo; Afterwards, the conversation shows Party size: 4.
      </p>
    </div>
  );
}

export function CollectPanel({ agentId, fields, canManage }: { agentId: string; fields: CollectField[]; canManage: boolean }) {
  const [state, dispatch, pending] = useActionState(saveCollectFields, null);
  const [list, setOptimistic] = useOptimistic(fields);
  // index of the field being edited, "new" for a new one
  const [editing, setEditing] = useState<{ at: number | "new"; draft: Draft } | null>(null);
  const [justSaved, setJustSaved] = useState<string | null>(null);
  // Which kind of save the current `state` belongs to, so errors show next to what caused them.
  const [lastOp, setLastOp] = useState<{ kind: "form" | "list"; key?: string } | null>(null);

  useEffect(() => {
    if (!state?.ok || lastOp?.kind !== "form") return;
    setEditing(null);
    if (lastOp.key) setJustSaved(lastOp.key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  useEffect(() => {
    if (!justSaved) return;
    const t = setTimeout(() => setJustSaved(null), 4000);
    return () => clearTimeout(t);
  }, [justSaved]);

  const save = (next: CollectField[], message: string, op: { kind: "form" | "list"; key?: string }) => {
    setLastOp(op);
    const fd = new FormData();
    fd.set("payload", JSON.stringify({ agentId, base: fields, fields: next, message }));
    startTransition(() => {
      if (op.kind === "list") setOptimistic(next);
      dispatch(fd);
    });
  };

  const move = (i: number, by: -1 | 1) => {
    const next = [...list];
    const [f] = next.splice(i, 1);
    next.splice(i + by, 0, f!);
    save(next, "Order saved.", { kind: "list" });
  };

  const remove = (i: number) => {
    const f = list[i]!;
    if (!window.confirm(`Delete ${f.label}? Past conversations keep what was already collected.`)) return;
    save(
      list.filter((_, j) => j !== i),
      "Field deleted.",
      { kind: "list" },
    );
  };

  const submitForm = (field: CollectField) => {
    if (!editing) return;
    const next = editing.at === "new" ? [...list, field] : list.map((f, j) => (j === editing.at ? field : f));
    save(next, editing.at === "new" ? "Field added." : "Field saved.", { kind: "form", key: field.key });
  };

  const openEditor = (at: number | "new", draft: Draft) => {
    setLastOp(null);
    setEditing({ at, draft });
  };
  const startNew = (draft: Draft) => openEditor("new", draft);
  const full = list.length >= MAX_COLLECT_FIELDS;
  const listError = lastOp?.kind === "list" && state?.error ? state.error : null;
  const formState = lastOp?.kind === "form" && state?.error ? state : null;

  return (
    <Card id="collect">
      <CardHeader
        title="Information to collect"
        icon={ClipboardList}
        description="What gets noted from every conversation. It shows on the conversation page and goes out in webhooks."
        action={
          canManage && list.length > 0 && !editing ? (
            <Button type="button" variant="secondary" size="sm" onClick={() => startNew(BLANK())} disabled={full || pending} title={full ? `At most ${MAX_COLLECT_FIELDS} fields` : undefined}>
              <Plus aria-hidden />
              Add field
            </Button>
          ) : null
        }
      />

      <div className="border-b border-slate-100 px-5 py-4">
        <h3 className="text-sm font-medium text-slate-800">Always collected</h3>
        <p className="mt-0.5 text-xs leading-5 text-slate-500">Filled in after every conversation from what was said, for every agent.</p>
        <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Always collected">
          {BUILT_IN_FIELDS.map((f) => (
            <li
              key={f.key}
              title={BUILT_IN_HINTS[f.key]}
              className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700 ring-1 ring-inset ring-slate-500/10"
            >
              <Lock className="size-3 text-slate-400" aria-hidden />
              {f.label}
            </li>
          ))}
        </ul>
      </div>

      {editing?.at === "new" ? (
        <div className="border-b border-slate-100 p-5">
          <h3 className="mb-4 text-sm font-semibold text-slate-900">New field</h3>
          <FieldForm initial={editing.draft} isNew pending={pending} state={formState} onSubmit={submitForm} onCancel={() => setEditing(null)} />
        </div>
      ) : null}

      {list.length === 0 && !editing ? (
        <div className="flex flex-col items-center px-5 py-8 text-center">
          <p className="text-sm font-semibold text-slate-900">No fields of your own yet</p>
          <p className="mt-1 max-w-md text-sm text-slate-500">
            Add what your business needs from each conversation, like a booking date or an order number. Up to {MAX_COLLECT_FIELDS} fields.
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
            <p className="mt-5 text-xs text-slate-500">Only owners and admins can add fields.</p>
          )}
        </div>
      ) : null}

      {listError ? (
        <div className="px-5 pt-4">
          <Notice tone="error">{listError}</Notice>
        </div>
      ) : null}

      {list.length ? (
        <div className="flex items-baseline justify-between gap-3 px-5 pt-4">
          <h3 className="text-sm font-medium text-slate-800">Your fields</h3>
          <span className="text-xs tabular-nums text-slate-500">
            {list.length} of {MAX_COLLECT_FIELDS}
          </span>
        </div>
      ) : null}
      {list.length ? (
        <ul className="divide-y divide-slate-100" aria-label="Your fields">
          {list.map((f, i) => (
            <li key={f.key} className={cx("px-5 py-4 transition-colors", justSaved === f.key && "bg-emerald-50/50")}>
              {editing?.at === i ? (
                <>
                  <h3 className="mb-4 text-sm font-semibold text-slate-900">Edit {f.label}</h3>
                  <FieldForm initial={editing.draft} isNew={false} pending={pending} state={formState} onSubmit={submitForm} onCancel={() => setEditing(null)} />
                </>
              ) : (
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:gap-4">
                  <FieldSummary f={f} />
                  {canManage && !editing ? (
                    <div className="-ml-2 flex shrink-0 items-center gap-1 sm:ml-0">
                      <IconButton label={`Move ${f.label} up`} onClick={() => move(i, -1)} disabled={pending || i === 0}>
                        <ArrowUp aria-hidden />
                      </IconButton>
                      <IconButton label={`Move ${f.label} down`} onClick={() => move(i, 1)} disabled={pending || i === list.length - 1}>
                        <ArrowDown aria-hidden />
                      </IconButton>
                      <Button type="button" variant="ghost" size="sm" onClick={() => openEditor(i, fromField(f))} disabled={pending} className={subtle}>
                        <Pencil aria-hidden />
                        Edit
                      </Button>
                      <IconButton label={`Delete ${f.label}`} onClick={() => remove(i)} disabled={pending} danger>
                        <Trash2 aria-hidden />
                      </IconButton>
                    </div>
                  ) : null}
                </div>
              )}
            </li>
          ))}
        </ul>
      ) : null}

      {!canManage && list.length ? (
        <p className="border-t border-slate-100 px-5 py-3 text-xs text-slate-500">Only owners and admins can change these fields.</p>
      ) : null}
    </Card>
  );
}
