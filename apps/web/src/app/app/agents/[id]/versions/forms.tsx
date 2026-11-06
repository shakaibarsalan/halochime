"use client";

import { FlaskConical, RotateCcw, Save, Square, Trash2, Trophy } from "lucide-react";
import { useActionState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { ActionMessage, SubmitButton } from "@/components/form-bits";
import { Button, Field, Input, Notice, Select } from "@/components/ui";
import { deleteVersion, endAbTest, restoreVersion, saveVersion, startAbTest } from "./actions";

export function SaveVersionForm({ agentId, disabled }: { agentId: string; disabled: boolean }) {
  const [state, action] = useActionState(saveVersion, null);
  return (
    <div className="space-y-3">
      <form
        action={action}
        className="flex flex-col gap-3 sm:flex-row sm:items-end"
      >
        <input type="hidden" name="agentId" value={agentId} />
        <div className="min-w-0 flex-1">
          <Field label="Version name" htmlFor="version-name" hint="e.g. Shorter greeting, or Friendlier persona.">
            <Input id="version-name" name="name" required maxLength={80} autoComplete="off" disabled={disabled} placeholder="Name this setup" />
          </Field>
        </div>
        <div className="sm:pb-6">
          <SubmitButton disabled={disabled} pendingLabel="Saving...">
            <Save aria-hidden />
            Save current setup
          </SubmitButton>
        </div>
      </form>
      <ActionMessage state={state} />
    </div>
  );
}

function SmallSubmit({ children, variant, label }: { children: ReactNode; variant: "secondary" | "danger"; label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" variant={variant} disabled={pending} aria-busy={pending} aria-label={label} title={label}>
      {children}
    </Button>
  );
}

export function VersionRowActions({ agentId, versionId, name }: { agentId: string; versionId: string; name: string }) {
  const [restoreState, restore] = useActionState(restoreVersion, null);
  const [deleteState, remove] = useActionState(deleteVersion, null);
  const state = restoreState?.error || restoreState?.message ? restoreState : deleteState;
  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex items-center justify-end gap-2">
        <form
          action={restore}
          onSubmit={(e) => {
            if (!window.confirm(`Put "${name}" back on the agent?\n\nThe current setup is saved as a version first, so nothing is lost.`)) e.preventDefault();
          }}
        >
          <input type="hidden" name="agentId" value={agentId} />
          <input type="hidden" name="versionId" value={versionId} />
          <SmallSubmit variant="secondary" label={`Restore ${name}`}>
            <RotateCcw aria-hidden />
            <span className="max-sm:sr-only">Restore</span>
          </SmallSubmit>
        </form>
        <form
          action={remove}
          onSubmit={(e) => {
            if (!window.confirm(`Delete the version "${name}"? This can't be undone.`)) e.preventDefault();
          }}
        >
          <input type="hidden" name="agentId" value={agentId} />
          <input type="hidden" name="versionId" value={versionId} />
          <SmallSubmit variant="danger" label={`Delete ${name}`}>
            <Trash2 aria-hidden />
          </SmallSubmit>
        </form>
      </div>
      {state?.error ? (
        <p role="alert" className="max-w-64 text-right text-xs font-medium text-red-600">
          {state.error}
        </p>
      ) : state?.message ? (
        <p role="status" className="max-w-64 text-right text-xs font-medium text-emerald-700">
          {state.message}
        </p>
      ) : null}
    </div>
  );
}

export function StartTestForm({ agentId, versions }: { agentId: string; versions: { id: string; name: string }[] }) {
  const [state, action] = useActionState(startAbTest, null);
  const enough = versions.length >= 2;
  return (
    <div className="space-y-4">
      <form
        action={action}
        onSubmit={(e) => {
          if (!window.confirm("Start the A/B test?\n\nFrom now on every new conversation with this agent gets version A or B.")) e.preventDefault();
        }}
        className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_9rem] sm:items-end"
      >
        <input type="hidden" name="agentId" value={agentId} />
        <Field label="Version A" htmlFor="ab-a">
          <Select id="ab-a" name="versionAId" defaultValue={versions[0]?.id ?? ""} disabled={!enough} required>
            {versions.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Version B" htmlFor="ab-b">
          <Select id="ab-b" name="versionBId" defaultValue={versions[1]?.id ?? ""} disabled={!enough} required>
            {versions.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Visitors on B (%)" htmlFor="ab-split">
          <Input id="ab-split" name="splitB" type="number" min={1} max={99} step={1} defaultValue={50} required disabled={!enough} />
        </Field>
        <div className="sm:col-span-3">
          <SubmitButton disabled={!enough} pendingLabel="Starting...">
            <FlaskConical aria-hidden />
            Start A/B test
          </SubmitButton>
        </div>
      </form>
      {!enough ? <Notice>Save at least two versions to compare them.</Notice> : null}
      <ActionMessage state={state} />
    </div>
  );
}

export function EndTestButtons({
  agentId,
  testId,
  a,
  b,
  suggested,
}: {
  agentId: string;
  testId: string;
  a: { id: string; name: string };
  b: { id: string; name: string };
  suggested: "a" | "b" | null;
}) {
  const [state, action] = useActionState(endAbTest, null);
  const confirmKeep = (name: string) =>
    `End the test and keep "${name}"?\n\nThe agent then uses it for everyone. Its current setup is saved as a version first.`;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {[
          { v: a, arm: "a" as const },
          { v: b, arm: "b" as const },
        ].map(({ v, arm }) => (
          <form
            key={v.id}
            action={action}
            onSubmit={(e) => {
              if (!window.confirm(confirmKeep(v.name))) e.preventDefault();
            }}
          >
            <input type="hidden" name="agentId" value={agentId} />
            <input type="hidden" name="testId" value={testId} />
            <input type="hidden" name="keep" value={v.id} />
            <KeepButton primary={suggested === arm} label={`Keep ${arm.toUpperCase()}`} title={`End the test and keep ${v.name}`} />
          </form>
        ))}
        <form
          action={action}
          onSubmit={(e) => {
            if (!window.confirm("Stop the test without changing the agent?")) e.preventDefault();
          }}
        >
          <input type="hidden" name="agentId" value={agentId} />
          <input type="hidden" name="testId" value={testId} />
          <input type="hidden" name="keep" value="none" />
          <StopButton />
        </form>
      </div>
      <ActionMessage state={state} />
    </div>
  );
}

function KeepButton({ primary, label, title }: { primary: boolean; label: string; title: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={primary ? "primary" : "secondary"} disabled={pending} aria-busy={pending} title={title}>
      <Trophy aria-hidden />
      {pending ? "Ending..." : label}
    </Button>
  );
}

function StopButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="ghost" disabled={pending} aria-busy={pending}>
      <Square aria-hidden />
      {pending ? "Stopping..." : "Stop without changes"}
    </Button>
  );
}
