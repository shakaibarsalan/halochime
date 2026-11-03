"use client";

import { useActionState } from "react";
import { ActionMessage, SubmitButton } from "@/components/form-bits";
import { Field, Input } from "@/components/ui";
import { createWorkspace } from "./actions";

export function OnboardingForm() {
  const [state, action] = useActionState(createWorkspace, null);
  return (
    <form action={action} className="mt-8 space-y-5">
      <Field label="Business name" htmlFor="name" hint="Your agent introduces itself as the support agent for this name.">
        <Input id="name" name="name" required minLength={2} maxLength={80} placeholder="Acme Dental" autoComplete="organization" className="h-10" />
      </Field>
      <ActionMessage state={state} />
      <SubmitButton size="lg" className="w-full" pendingLabel="Creating...">
        Create workspace
      </SubmitButton>
    </form>
  );
}
