"use client";

import { Trash2 } from "lucide-react";
import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import { SubmitButton } from "@/components/form-bits";
import { Field, Input, Notice } from "@/components/ui";
import { deleteWorkspace, type DeleteWorkspaceState } from "./actions";

const linkClass = "font-medium text-brand-700 hover:underline";

/** Settings danger zone (owners only): type the workspace name, then delete it and everything in it. */
export function DeleteWorkspaceForm({ name, balance }: { name: string; balance: string | null }) {
  const [state, action] = useActionState<DeleteWorkspaceState, FormData>(deleteWorkspace, null);
  const [typed, setTyped] = useState("");
  const done = Boolean(state?.ok);
  const matches = typed.trim() === name.trim();

  useEffect(() => {
    // A full load, so the sidebar's workspace list and session are read fresh.
    if (state?.ok && state.redirectTo) window.location.assign(state.redirectTo);
  }, [state]);

  return (
    <div className="space-y-4">
      <div className="space-y-2 text-sm leading-6 text-slate-600">
        <p>
          This deletes the workspace for everyone in it, right away and for good. Its agents stop answering on your website,
          and its knowledge, conversations, transcripts, handoffs, webhooks, invites and voice minutes
          {balance ? <> ({balance} left)</> : null} are deleted. Members keep their own Halochime accounts.
        </p>
        <p>
          Bought minutes in the last 14 days?{" "}
          <Link href="/contact?topic=billing" className={linkClass}>
            Ask for your refund
          </Link>{" "}
          before you delete, because unused minutes are lost (see the{" "}
          <Link href="/refund-policy#closing" className={linkClass}>
            Refund Policy
          </Link>
          ). Deleted data leaves our encrypted backups within 30 days.
        </p>
      </div>
      <form action={action} className="max-w-md space-y-4">
        <Field
          label="Workspace name"
          htmlFor="confirm-name"
          hint={
            <>
              To confirm, type <span className="font-semibold text-slate-800 [overflow-wrap:anywhere]">{name}</span>
            </>
          }
        >
          <Input
            id="confirm-name"
            name="confirmName"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            maxLength={80}
            disabled={done}
          />
        </Field>
        <div className="flex flex-wrap items-center gap-3">
          <SubmitButton variant="danger" pendingLabel="Deleting..." disabled={!matches || done}>
            <Trash2 aria-hidden />
            {done ? "Deleted" : "Delete workspace"}
          </SubmitButton>
          {state?.error ? <Notice tone="error">{state.error}</Notice> : null}
          {done ? <Notice tone="success">Workspace deleted.</Notice> : null}
        </div>
      </form>
    </div>
  );
}
