"use client";

import { ListPlus, Play, Trash2 } from "lucide-react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { ActionMessage, SubmitButton } from "@/components/form-bits";
import { Button, Field, Input, Select, Textarea } from "@/components/ui";
import { addTestCase, deleteTestCase, runTests } from "./actions";

export function AddCaseForm({ agentId, full }: { agentId: string; full: boolean }) {
  const [state, action] = useActionState(addTestCase, null);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="agentId" value={agentId} />
      <Field label="Visitor's question" htmlFor="tc-question" hint="Write it the way a visitor would type it.">
        <Input id="tc-question" name="question" required minLength={3} maxLength={1000} autoComplete="off" disabled={full} placeholder="Do you deliver on Sundays?" />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="A good answer must say" htmlFor="tc-must" hint="The facts or the point, in your own words.">
          <Textarea id="tc-must" name="mustSay" rows={2} maxLength={1000} disabled={full} placeholder="No Sunday delivery; Saturday until 2 pm" className="min-h-16" />
        </Field>
        <Field label="It must not say (optional)" htmlFor="tc-mustnot" hint="Things that would be wrong or off limits.">
          <Textarea id="tc-mustnot" name="mustNotSay" rows={2} maxLength={1000} disabled={full} placeholder="Promise a delivery time" className="min-h-16" />
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton variant="secondary" disabled={full} pendingLabel="Adding...">
          <ListPlus aria-hidden />
          Add test question
        </SubmitButton>
        <div className="min-w-0">
          <ActionMessage state={state} />
        </div>
      </div>
    </form>
  );
}

function DeleteSubmit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="ghost" size="sm" disabled={pending} aria-busy={pending} aria-label={label} title={label}>
      <Trash2 aria-hidden />
    </Button>
  );
}

export function DeleteCaseButton({ agentId, caseId }: { agentId: string; caseId: string }) {
  const [state, action] = useActionState(deleteTestCase, null);
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!window.confirm("Remove this test question? Past results keep their copy.")) e.preventDefault();
      }}
      className="flex flex-col items-end"
    >
      <input type="hidden" name="agentId" value={agentId} />
      <input type="hidden" name="caseId" value={caseId} />
      <DeleteSubmit label="Remove test question" />
      {state?.error ? (
        <p role="alert" className="text-xs font-medium text-red-600">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}

export function RunTestsForm({
  agentId,
  versions,
  left,
  cap,
  disabledReason,
}: {
  agentId: string;
  versions: { id: string; name: string }[];
  left: number;
  cap: number;
  disabledReason: string | null;
}) {
  const [state, action] = useActionState(runTests, null);
  const disabled = Boolean(disabledReason) || left <= 0;
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="agentId" value={agentId} />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1">
          <Field label="Test" htmlFor="run-version" hint="Run against the agent as it is now, or against a saved version.">
            <Select id="run-version" name="versionId" defaultValue="" disabled={disabled}>
              <option value="">Current settings</option>
              {versions.map((v) => (
                <option key={v.id} value={v.id}>
                  Version: {v.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="sm:pb-6">
          <SubmitButton disabled={disabled} pendingLabel="Running tests...">
            <Play aria-hidden />
            Run tests
          </SubmitButton>
        </div>
      </div>
      <p className="text-xs leading-5 text-slate-500">
        {disabledReason ??
          (left > 0
            ? `${left} of ${cap} runs left today for this workspace. A run takes up to a minute.`
            : `No runs left today (${cap} a day per workspace). You can run more tomorrow.`)}
      </p>
      <ActionMessage state={state} />
    </form>
  );
}
