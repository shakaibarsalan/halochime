"use client";

import { ArrowRightLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui";
import { authClient } from "@/lib/auth-client";

/** Makes this workspace the active one (Better Auth, as the sidebar switcher) and opens its overview. */
export function SwitchWorkspaceButton({ organizationId, name }: { organizationId: string; name: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function go() {
    setBusy(true);
    setError(null);
    const { error } = await authClient.organization.setActive({ organizationId });
    if (error) {
      setBusy(false);
      setError("Could not switch.");
      return;
    }
    router.push("/app");
    router.refresh();
  }

  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      <Button type="button" variant="secondary" size="sm" onClick={go} disabled={busy} aria-busy={busy} title={`Open ${name}`}>
        <ArrowRightLeft aria-hidden />
        {busy ? "Opening..." : "Open"}
      </Button>
      {error ? (
        <p role="alert" className="text-xs font-medium text-red-600">
          {error}
        </p>
      ) : null}
    </div>
  );
}
