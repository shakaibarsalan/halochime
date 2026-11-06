"use client";

import { useCallback, useEffect, useRef } from "react";

/**
 * Fetches `url` as JSON every `everyMs` while the tab is visible (and right away when it becomes visible
 * again), and hands each result to `onData`. A request never overlaps the previous one; after errors it
 * waits longer (up to 30 s). Returns a function that polls now (after an action, say).
 */
export function usePoll<T>(
  url: string,
  everyMs: number,
  onData: (data: T) => void,
  onError?: (status: number | null) => void,
): () => void {
  const onDataRef = useRef(onData);
  const onErrorRef = useRef(onError);
  onDataRef.current = onData;
  onErrorRef.current = onError;
  const kick = useRef<() => void>(() => undefined);

  useEffect(() => {
    let stopped = false;
    let timer: number | undefined;
    let running = false;
    let again = false;
    let failures = 0;
    let controller: AbortController | null = null;

    const schedule = () => {
      window.clearTimeout(timer);
      if (stopped || document.visibilityState !== "visible") return;
      const wait = failures === 0 ? everyMs : Math.min(30_000, everyMs * 2 ** failures);
      timer = window.setTimeout(run, wait);
    };

    async function run() {
      if (stopped) return;
      if (running) {
        again = true;
        return;
      }
      running = true;
      controller = new AbortController();
      try {
        const res = await fetch(url, { cache: "no-store", signal: controller.signal, headers: { Accept: "application/json" } });
        if (!res.ok) {
          failures = Math.min(failures + 1, 4);
          onErrorRef.current?.(res.status);
        } else {
          failures = 0;
          onDataRef.current((await res.json()) as T);
        }
      } catch (err) {
        if (!(err instanceof DOMException && err.name === "AbortError")) {
          failures = Math.min(failures + 1, 4);
          onErrorRef.current?.(null);
        }
      } finally {
        running = false;
        controller = null;
      }
      if (again) {
        again = false;
        void run();
        return;
      }
      schedule();
    }

    const onVisible = () => {
      if (document.visibilityState === "visible") void run();
      else window.clearTimeout(timer);
    };

    kick.current = () => void run();
    schedule();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      controller?.abort();
      document.removeEventListener("visibilitychange", onVisible);
      kick.current = () => undefined;
    };
  }, [url, everyMs]);

  return useCallback(() => kick.current(), []);
}
