"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { Mic, RotateCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button, Card, Notice } from "@/components/ui";

const SCRIPT_ID = "talkfront-try-it";

declare global {
  interface Window {
    __talkfrontLoaded?: boolean;
  }
}

/** Loads the real /widget.js with this agent's key on the dashboard page (drafts work here). */
export function TryIt({ publicKey }: { publicKey: string }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");

  const inject = useCallback(() => {
    if (document.getElementById(SCRIPT_ID)) return; // already injected (effects run twice in dev)
    setStatus("loading");
    const s = document.createElement("script");
    s.id = SCRIPT_ID;
    s.src = "/widget.js";
    s.async = true;
    s.dataset.key = publicKey;
    s.onload = () => setStatus("ready");
    s.onerror = () => setStatus("error");
    document.body.appendChild(s);
  }, [publicKey]);

  const load = useCallback(() => {
    // The widget boots once per page; a full reload is the clean way to load it again with new settings.
    if (window.__talkfrontLoaded || document.getElementById(SCRIPT_ID)) {
      window.location.assign(`${pathname}?try=1`);
      return;
    }
    inject();
  }, [pathname, inject]);

  useEffect(() => {
    // Only ever inject here: navigating from an effect loops, because dev mode runs effects twice.
    if (params.get("try") === "1") inject();
    // Leaving the page removes the test widget so it doesn't follow you around the dashboard.
    return () => {
      document.querySelectorAll("talkfront-widget").forEach((el) => el.remove());
    };
  }, []);

  return (
    <Card className="overflow-hidden">
      <div className="relative overflow-hidden border-b border-slate-100 bg-gradient-to-br from-brand-50/80 via-white to-orange-50/60 px-5 py-5">
        <div className="flex items-center gap-3">
          <span className="relative grid size-11 shrink-0 place-items-center">
            {status === "ready" ? <span className="absolute inset-0 rounded-full bg-brand-400/30 motion-safe:animate-ripple" aria-hidden /> : null}
            <span className="orb relative grid size-11 place-items-center text-white shadow-[0_6px_18px_-4px_rgb(109_94_252/0.55)]" aria-hidden>
              <Mic className="size-4" />
            </span>
          </span>
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold text-slate-900">Try it</h2>
            <p className="text-sm text-slate-500">Talk to this agent here, using its saved settings.</p>
          </div>
        </div>
      </div>
      <div className="space-y-3 p-5">
        <Button type="button" variant={status === "ready" ? "secondary" : "primary"} onClick={load} disabled={status === "loading"} className="w-full">
          {status === "ready" ? <RotateCw aria-hidden /> : <Mic aria-hidden />}
          {status === "ready" ? "Reload with latest settings" : status === "loading" ? "Loading..." : "Open test widget"}
        </Button>
        {status === "ready" ? <p className="text-xs text-slate-500">The widget button is in the corner of this page.</p> : null}
        {status === "error" ? (
          <Notice tone="error">
            Could not load /widget.js. Build it with <code>npm run build -w @talkfront/widget</code>.
          </Notice>
        ) : null}
        <p className="text-xs text-slate-500">Voice calls here use this workspace's voice minutes, like a real visitor.</p>
      </div>
    </Card>
  );
}
