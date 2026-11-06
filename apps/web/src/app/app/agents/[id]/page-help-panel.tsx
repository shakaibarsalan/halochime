"use client";

import {
  DEFAULT_HELP_MESSAGE,
  MAX_PROACTIVE_RULES,
  PROACTIVE_DELAY_MAX_SEC,
  PROACTIVE_MESSAGE_MAX,
  PROACTIVE_PATH_MAX,
  type ProactiveHelpSettings,
  type ProactiveMatch,
  type ProactiveRule,
} from "@talkfront/shared";
import { LifeBuoy, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { type FormEvent, type ReactNode, startTransition, useActionState, useId, useState } from "react";
import { ActionMessage } from "@/components/form-bits";
import { Button, Card, CardHeader, Field, Input, Select } from "@/components/ui";
import { savePageHelp } from "./page-help-actions";

const MATCH_LABELS: Record<ProactiveMatch, string> = {
  contains: "Address contains",
  starts_with: "Address starts with",
  exact: "Address is exactly",
  any: "Any page",
};

const newId = () => Math.random().toString(36).slice(2, 10) || "r1";

/** Rules as typed: the delay stays text so the field can be cleared while typing. */
type DraftRule = Omit<ProactiveRule, "delaySec"> & { delay: string };

const toDraft = (r: ProactiveRule): DraftRule => ({ id: r.id, match: r.match, path: r.path, message: r.message, delay: String(r.delaySec) });
const fromDraft = (r: DraftRule): ProactiveRule => ({
  id: r.id,
  match: r.match,
  path: r.match === "any" ? "" : r.path.trim(),
  message: r.message.trim(),
  delaySec: Number.parseInt(r.delay, 10) || 0,
});

function Switch({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint: ReactNode; disabled?: boolean }) {
  return (
    <label
      className={`flex items-start justify-between gap-4 rounded-xl border border-slate-200 bg-white px-4 py-3 transition-colors has-[:checked]:border-brand-200 has-[:checked]:bg-brand-50/40 ${
        disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:border-slate-300"
      }`}
    >
      <span className="min-w-0">
        <span className="block text-sm font-medium text-slate-900">{label}</span>
        <span className="mt-0.5 block text-xs leading-5 text-slate-500">{hint}</span>
      </span>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="peer sr-only" />
      <span
        aria-hidden
        className="relative mt-0.5 h-5 w-9 shrink-0 rounded-full bg-slate-200 transition-colors peer-checked:bg-brand-600 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand-600 after:absolute after:left-0.5 after:top-0.5 after:size-4 after:rounded-full after:bg-white after:shadow-sm after:transition-transform peer-checked:after:translate-x-4"
      />
    </label>
  );
}

function RuleRow({
  rule,
  index,
  disabled,
  onChange,
  onRemove,
}: {
  rule: DraftRule;
  index: number;
  disabled: boolean;
  onChange: (r: DraftRule) => void;
  onRemove: () => void;
}) {
  const id = useId();
  const set = <K extends keyof DraftRule>(k: K, v: DraftRule[K]) => onChange({ ...rule, [k]: v });
  return (
    <li className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h4 className="text-sm font-medium text-slate-800">Rule {index + 1}</h4>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onRemove}
          disabled={disabled}
          aria-label={`Delete rule ${index + 1}`}
          title={`Delete rule ${index + 1}`}
          className="size-8 px-0 text-slate-500 hover:bg-red-50 hover:text-red-700"
        >
          <Trash2 aria-hidden />
        </Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,11rem)_minmax(0,1fr)_minmax(0,7rem)]">
        <Field label="When" htmlFor={`${id}-match`}>
          <Select id={`${id}-match`} value={rule.match} disabled={disabled} onChange={(e) => set("match", e.target.value as ProactiveMatch)}>
            {(Object.keys(MATCH_LABELS) as ProactiveMatch[]).map((m) => (
              <option key={m} value={m}>
                {MATCH_LABELS[m]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Page" htmlFor={`${id}-path`}>
          <Input
            id={`${id}-path`}
            value={rule.match === "any" ? "" : rule.path}
            onChange={(e) => set("path", e.target.value)}
            placeholder={rule.match === "any" ? "Every page" : "/pricing"}
            disabled={disabled || rule.match === "any"}
            maxLength={PROACTIVE_PATH_MAX}
            autoComplete="off"
            className="font-mono"
          />
        </Field>
        <Field label="After (seconds)" htmlFor={`${id}-delay`}>
          <Input
            id={`${id}-delay`}
            type="number"
            inputMode="numeric"
            min={0}
            max={PROACTIVE_DELAY_MAX_SEC}
            value={rule.delay}
            onChange={(e) => set("delay", e.target.value)}
            disabled={disabled}
          />
        </Field>
      </div>
      <div className="mt-3">
        <Field label="Bubble message" htmlFor={`${id}-message`} hint={`${rule.message.length} of ${PROACTIVE_MESSAGE_MAX} characters.`}>
          <Input
            id={`${id}-message`}
            value={rule.message}
            onChange={(e) => set("message", e.target.value)}
            placeholder="Questions about our plans? Tap to ask us."
            maxLength={PROACTIVE_MESSAGE_MAX}
            disabled={disabled}
            autoComplete="off"
          />
        </Field>
      </div>
    </li>
  );
}

export function PageHelpPanel({
  agentId,
  proactive,
  pageGuide,
  canManage,
}: {
  agentId: string;
  proactive: ProactiveHelpSettings;
  pageGuide: boolean;
  canManage: boolean;
}) {
  const [state, dispatch, pending] = useActionState(savePageHelp, null);
  const [enabled, setEnabled] = useState(proactive.enabled);
  const [rules, setRules] = useState<DraftRule[]>(proactive.rules.map(toDraft));
  const [defaultMessage, setDefaultMessage] = useState(proactive.defaultMessage || DEFAULT_HELP_MESSAGE);
  const [guide, setGuide] = useState(pageGuide);
  const id = useId();
  const locked = !canManage || pending;

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData();
    fd.set(
      "payload",
      JSON.stringify({ agentId, pageGuide: guide, proactive: { enabled, rules: rules.map(fromDraft), defaultMessage: defaultMessage.trim() } }),
    );
    startTransition(() => dispatch(fd));
  };

  const addRule = () =>
    setRules((list) => [
      ...list,
      { id: newId(), match: "contains", path: list.length ? "" : "/pricing", delay: "20", message: list.length ? "" : "Questions about our plans? Tap to ask us." },
    ]);

  return (
    <Card id="page-help">
      <CardHeader
        title="Page help"
        icon={LifeBuoy}
        description="Offer help on the right pages, and let the agent show visitors where things are. Both are off until you turn them on."
      />
      <form onSubmit={submit} className="space-y-5 p-5">
        <section className="space-y-4" aria-labelledby={`${id}-proactive`}>
          <h3 id={`${id}-proactive`} className="sr-only">
            Offer help on its own
          </h3>
          <Switch
            checked={enabled}
            onChange={setEnabled}
            disabled={locked}
            label="Offer help on its own"
            hint="A small bubble next to the chat button offers help on the pages you pick, after a few seconds there. Each visitor sees it at most once per page per visit, and it never shows while they are chatting."
          />
          {enabled ? (
            <div className="space-y-4">
              {rules.length ? (
                <ol className="space-y-3" aria-label="Rules">
                  {rules.map((r, i) => (
                    <RuleRow
                      key={r.id}
                      rule={r}
                      index={i}
                      disabled={locked}
                      onChange={(next) => setRules((list) => list.map((x) => (x.id === r.id ? next : x)))}
                      onRemove={() => setRules((list) => list.filter((x) => x.id !== r.id))}
                    />
                  ))}
                </ol>
              ) : (
                <p className="rounded-xl border border-dashed border-slate-300 bg-slate-50/60 px-4 py-3 text-sm text-slate-600">
                  No page rules yet. Add one, or only offer help from your own code with <code className="rounded bg-slate-100 px-1 font-mono text-[0.86em]">Halochime.offerHelp()</code>.
                </p>
              )}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Button type="button" variant="secondary" size="sm" onClick={addRule} disabled={locked || rules.length >= MAX_PROACTIVE_RULES}>
                  <Plus aria-hidden />
                  Add a rule
                </Button>
                <span className="text-xs tabular-nums text-slate-500">
                  {rules.length} of {MAX_PROACTIVE_RULES}. The first rule that fits a page is used.
                </span>
              </div>
              <Field
                label="Message for offerHelp()"
                htmlFor={`${id}-default`}
                hint={
                  <>
                    Shown when your site calls <code className="rounded bg-slate-100 px-1 font-mono text-[0.86em]">Halochime.offerHelp()</code> without a message, for example after a failed payment.{" "}
                    <Link href="/docs#javascript-api" className="font-medium text-brand-700 underline underline-offset-2 hover:text-brand-800">
                      How to call it
                    </Link>
                  </>
                }
              >
                <Input
                  id={`${id}-default`}
                  value={defaultMessage}
                  onChange={(e) => setDefaultMessage(e.target.value)}
                  maxLength={PROACTIVE_MESSAGE_MAX}
                  disabled={locked}
                  required
                  autoComplete="off"
                />
              </Field>
            </div>
          ) : null}
        </section>

        <section className="space-y-2 border-t border-slate-100 pt-5" aria-labelledby={`${id}-guide`}>
          <h3 id={`${id}-guide`} className="sr-only">
            Show visitors where things are
          </h3>
          <Switch
            checked={guide}
            onChange={setGuide}
            disabled={locked}
            label="Show visitors where things are"
            hint="During a conversation the agent sees the names of the buttons, links and fields on the visitor's page, and can scroll to one and highlight it when they ask where something is. It never sees what visitors type, and password and card fields are left out."
          />
        </section>

        {!canManage ? <p className="text-xs text-slate-500">Only owners and admins can change page help.</p> : null}
        <ActionMessage state={state} />
        {canManage ? (
          <div className="flex justify-end">
            <Button type="submit" disabled={pending} aria-busy={pending}>
              {pending ? "Saving..." : "Save page help"}
            </Button>
          </div>
        ) : null}
      </form>
    </Card>
  );
}
