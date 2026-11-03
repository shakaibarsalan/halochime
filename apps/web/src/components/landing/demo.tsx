"use client";

import { useEffect, type ReactNode } from "react";

const SCRIPT_ID = "talkfront-demo";

declare global {
  interface Window {
    Halochime?: { open(): void; close(): void };
    __talkfrontLoaded?: boolean;
    /** The demo widget, parked while the visitor is on another page of the app. */
    __talkfrontDemoEl?: Element;
  }
}

/** Loads the real /widget.js with the demo agent's key on the landing page. */
export function DemoWidget({ demoKey }: { demoKey: string }) {
  useEffect(() => {
    const parked = window.__talkfrontDemoEl;
    if (parked) {
      document.body.appendChild(parked);
      window.__talkfrontDemoEl = undefined;
    } else if (!window.__talkfrontLoaded && !document.getElementById(SCRIPT_ID)) {
      const s = document.createElement("script");
      s.id = SCRIPT_ID;
      s.src = "/widget.js";
      s.async = true;
      s.dataset.key = demoKey;
      document.body.appendChild(s);
    }
    // Leaving the landing page parks the widget so it doesn't follow visitors into the app.
    return () => {
      const el = document.querySelector("talkfront-widget");
      if (!el) return;
      window.Halochime?.close();
      el.remove();
      window.__talkfrontDemoEl = el;
    };
  }, [demoKey]);
  return null;
}

/**
 * "Talk to Tara": opens the live demo widget when a demo key is configured,
 * otherwise it is a plain link (by default to the live demo section).
 */
export function TalkToAgentButton({
  demoKey,
  className,
  children,
  fallbackHref = "#talk",
  onActivate,
}: {
  demoKey?: string;
  className?: string;
  children: ReactNode;
  fallbackHref?: string;
  /** Runs before the widget opens, e.g. to close a menu. */
  onActivate?: () => void;
}) {
  if (!demoKey) {
    return (
      <a href={fallbackHref} className={className} onClick={onActivate}>
        {children}
      </a>
    );
  }
  return (
    <button
      type="button"
      className={className}
      onClick={() => {
        onActivate?.();
        if (window.Halochime) {
          window.Halochime.open();
          return;
        }
        // Script still loading: open as soon as it is ready.
        document.getElementById(SCRIPT_ID)?.addEventListener("load", () => window.Halochime?.open(), { once: true });
      }}
    >
      {children}
    </button>
  );
}
