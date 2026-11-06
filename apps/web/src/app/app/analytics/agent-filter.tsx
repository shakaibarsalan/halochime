"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Select } from "@/components/ui";
import { analyticsHref, type Period } from "./period";

/** Agent picker for the analytics page. Changing it reloads the page for that agent. */
export function AgentFilter({ agents, agentId, days }: { agents: { id: string; name: string }[]; agentId: string | null; days: Period }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const current = agents.find((a) => a.id === agentId)?.name ?? "All agents";
  return (
    <label className="flex min-w-0 items-center gap-2 text-sm font-medium text-slate-600">
      <span className="shrink-0">Agent</span>
      <Select
        // Remount when the page answers, so the shown choice always matches the data.
        key={agentId ?? ""}
        defaultValue={agentId ?? ""}
        title={current}
        aria-busy={pending}
        className="w-auto min-w-0 max-w-[16rem] truncate"
        onChange={(e) => {
          const next = e.target.value || null;
          startTransition(() => router.push(analyticsHref(days, next)));
        }}
      >
        <option value="">All agents</option>
        {agents.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </Select>
      {pending ? <span className="shrink-0 text-xs font-normal text-slate-500">Loading...</span> : null}
    </label>
  );
}
