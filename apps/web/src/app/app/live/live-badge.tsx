"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { usePoll } from "./use-poll";

/** The sidebar's count of conversations happening now, polled lightly. */
export function LiveCountBadge() {
  const [count, setCount] = useState(0);
  const pathname = usePathname();
  const refresh = usePoll<{ count?: number }>("/api/live?count=1", 15_000, (d) => setCount(Number(d.count ?? 0)));
  // At once on first show, and on each page change (cheap, and keeps the number fresh while moving around).
  useEffect(() => refresh(), [refresh, pathname]);
  if (count <= 0) return null;
  return (
    <span className="rounded-full bg-emerald-100 px-1.5 py-px text-[11px] font-semibold tabular-nums text-emerald-800">
      <span className="sr-only">, </span>
      {count}
      <span className="sr-only"> live now</span>
    </span>
  );
}
