"use client";

import { Trash2 } from "lucide-react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui";
import { deleteConversation } from "../actions";

function DeleteSubmit({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      variant="danger"
      size="sm"
      disabled={disabled || pending}
      aria-busy={pending}
      aria-label="Delete conversation"
      title={disabled ? undefined : "Delete conversation"}
    >
      <Trash2 aria-hidden />
      <span className="max-sm:sr-only">{pending ? "Deleting..." : "Delete conversation"}</span>
    </Button>
  );
}

/** Page header action on a conversation: confirm, then delete it for good. Live conversations wait until they end. */
export function DeleteConversationButton({ conversationId, live }: { conversationId: string; live: boolean }) {
  const [state, action] = useActionState(deleteConversation, null);
  return (
    <div className="relative">
      <form
        action={action}
        onSubmit={(e) => {
          const q =
            "Delete this conversation for good?\n\nIts transcript, summary, collected details and handoff requests are removed. This can't be undone.";
          if (!window.confirm(q)) e.preventDefault();
        }}
      >
        <input type="hidden" name="conversationId" value={conversationId} />
        {/* Disabled buttons don't show a tooltip, so the reason sits on the wrapper. */}
        <span className="inline-flex" title={live ? "You can delete it once it ends." : undefined}>
          <DeleteSubmit disabled={live} />
        </span>
      </form>
      {state?.error ? (
        <p
          role="alert"
          className="absolute right-0 top-full z-10 mt-2 w-64 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-xs font-medium text-red-700 shadow-soft"
        >
          {state.error}
        </p>
      ) : null}
    </div>
  );
}
