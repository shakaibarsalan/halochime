"use client";

import { ChevronRight, Radio, UserRound } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Badge, Card, EmptyState, ModeBadge, Notice } from "@/components/ui";
import type { LiveRow } from "@/lib/live";
import { pageLabel, startedAgo, visitorLabel } from "@/lib/live-format";
import { usePoll } from "./use-poll";

const EVERY_MS = 3000;

/** The workspace's live conversations, newest first, refreshed every few seconds. */
export function LiveList({ initial }: { initial: LiveRow[] }) {
  const [rows, setRows] = useState(initial);
  const [failed, setFailed] = useState(false);
  // "4 min ago" moves on between polls too; set after mount so server and browser render the same.
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const t = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(t);
  }, []);

  usePoll<{ conversations?: LiveRow[] }>(
    "/api/live",
    EVERY_MS,
    (d) => {
      setFailed(false);
      setNow(new Date());
      if (Array.isArray(d.conversations)) setRows(d.conversations);
    },
    () => setFailed(true),
  );

  return (
    <div className="space-y-3">
      {failed ? <Notice tone="error">Could not refresh. Trying again...</Notice> : null}
      <Card>
        {rows.length === 0 ? (
          <EmptyState icon={Radio} title="No one is talking right now">
            Conversations show up here the moment a visitor starts one, and leave when it ends.
          </EmptyState>
        ) : (
          <ul className="divide-y divide-slate-100" aria-live="polite">
            {rows.map((c) => {
              const visitor = visitorLabel(c.visitorName, c.visitorEmail);
              const page = pageLabel(c.pageUrl, c.pageTitle);
              return (
                <li key={c.id}>
                  <Link
                    href={`/app/live/${c.id}`}
                    className="group flex items-center gap-3 px-4 py-3.5 transition-colors first:rounded-t-2xl last:rounded-b-2xl hover:bg-slate-50 focus-visible:bg-slate-50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-600 sm:px-5"
                  >
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="min-w-0 truncate text-sm font-semibold text-slate-900" title={c.agentName}>
                          {c.agentName}
                        </span>
                        <ModeBadge mode={c.mode} />
                        {c.takenOverByName ? (
                          <span className="hidden sm:inline-flex">
                            <Badge tone="amber" icon={UserRound}>
                              {c.takenOverByMe ? "You have it" : `${c.takenOverByName} has it`}
                            </Badge>
                          </span>
                        ) : null}
                        <span className="ml-auto shrink-0 text-xs tabular-nums text-slate-500" title={new Date(c.startedAt).toUTCString()}>
                          {now ? startedAgo(c.startedAt, now) : ""}
                        </span>
                      </div>
                      <p className="flex min-w-0 items-center gap-1.5 text-xs text-slate-500">
                        <span className="min-w-0 truncate" title={visitor ?? "Visitor"}>
                          {visitor ?? "Visitor"}
                        </span>
                        {page ? (
                          <>
                            <span aria-hidden>·</span>
                            <span className="min-w-0 truncate" title={c.pageUrl ?? page}>
                              {page}
                            </span>
                          </>
                        ) : null}
                      </p>
                      {c.lastVisitorLine ? (
                        <p className="truncate text-sm text-slate-700" title={c.lastVisitorLine}>
                          <span className="sr-only">Last visitor message: </span>
                          {c.lastVisitorLine}
                        </p>
                      ) : (
                        <p className="text-sm text-slate-400">No visitor message yet</p>
                      )}
                      {c.takenOverByName ? (
                        <p className="text-xs font-medium text-amber-800 sm:hidden">
                          {c.takenOverByMe ? "You have taken it over" : `${c.takenOverByName} has taken it over`}
                        </p>
                      ) : null}
                    </div>
                    <ChevronRight className="size-4 shrink-0 text-slate-300 group-hover:text-slate-500" aria-hidden />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
