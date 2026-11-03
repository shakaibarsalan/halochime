"use client";

import { useActionState } from "react";
import { ActionMessage, SubmitButton } from "@/components/form-bits";
import { Field, Input } from "@/components/ui";
import { renameWorkspace } from "./actions";

export function WorkspaceNameForm({ name, canEdit }: { name: string; canEdit: boolean }) {
  const [state, action] = useActionState(renameWorkspace, null);
  return (
    <form action={action} className="max-w-md space-y-4">
      <Field label="Workspace name" htmlFor="name" hint={canEdit ? undefined : "Only owners and admins can change this."}>
        <Input id="name" name="name" defaultValue={name} required minLength={2} maxLength={80} disabled={!canEdit} />
      </Field>
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton disabled={!canEdit}>Save</SubmitButton>
        <ActionMessage state={state} />
      </div>
    </form>
  );
}
