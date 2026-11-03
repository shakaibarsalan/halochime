"use client";

import { useRouter } from "next/navigation";
import { useActionState, useState } from "react";
import { SubmitButton } from "@/components/form-bits";
import { Button, Notice } from "@/components/ui";
import { authClient } from "@/lib/auth-client";
import { acceptInvite, declineInvite } from "./actions";

export function AcceptDecline({ invitationId }: { invitationId: string }) {
  const [acceptState, accept] = useActionState(acceptInvite, null);
  const [declineState, decline] = useActionState(declineInvite, null);
  const error = acceptState?.error ?? declineState?.error;
  return (
    <div className="space-y-3">
      <form action={accept}>
        <input type="hidden" name="invitationId" value={invitationId} />
        <SubmitButton size="lg" className="w-full" pendingLabel="Joining...">
          Accept and join
        </SubmitButton>
      </form>
      <form
        action={decline}
        onSubmit={(e) => {
          if (!window.confirm("Decline this invite? The link will stop working.")) e.preventDefault();
        }}
      >
        <input type="hidden" name="invitationId" value={invitationId} />
        <SubmitButton variant="secondary" size="lg" className="w-full" pendingLabel="Declining...">
          Decline
        </SubmitButton>
      </form>
      {error ? <Notice tone="error">{error}</Notice> : null}
    </div>
  );
}

export function SignOutButton({ label = "Sign out" }: { label?: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  return (
    <Button
      type="button"
      size="lg"
      className="w-full"
      disabled={pending}
      aria-busy={pending}
      onClick={async () => {
        setPending(true);
        await authClient.signOut();
        router.refresh();
        setPending(false);
      }}
    >
      {pending ? "Signing out..." : label}
    </Button>
  );
}
