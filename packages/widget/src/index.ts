import { TAG, TalkfrontWidget } from "./widget";

/**
 * Loader for:
 *   <script src="https://APP_URL/widget.js" data-key="pk_..." [data-api="https://APP_URL"]
 *           [data-identity-token="eyJ..."] async></script>
 * Mounts one <talkfront-widget> on document.body and exposes window.Halochime (docs/integrations.md §2).
 * window.Talkfront, the product's earlier name, is the same object, so pages written for it keep working.
 *
 * Calls made before the script loads can be queued:
 *   window.Halochime = window.Halochime || { q: [] };
 *   window.Halochime.q.push(["identify", { token }]);
 * The loader replays them in order once the widget is mounted.
 */

type QueuedCall = [method: string, ...args: unknown[]];

interface TalkfrontApi {
  open(): void;
  close(): void;
  /** Signs in the visitor for the next conversation. `token` is an identity token from your server. */
  identify(options: { token: string }): void;
  /** Forgets the signed-in visitor (call on sign-out). Applies to the next conversation. */
  logout(): void;
  /** Calls pushed here after load run at once, so stub-style snippets keep working. */
  q: { push(...calls: QueuedCall[]): number };
}

declare global {
  interface Window {
    Halochime?: TalkfrontApi | { q?: unknown };
    Talkfront?: TalkfrontApi | { q?: unknown };
    __talkfrontLoaded?: boolean;
  }
}

const MAX_TOKEN_LENGTH = 4096;
const JWT_SHAPE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

/** A plausible identity token, or null (with a console hint for the developer). */
function cleanToken(raw: unknown): string | null {
  const token = typeof raw === "string" ? raw.trim() : "";
  if (token && token.length <= MAX_TOKEN_LENGTH && JWT_SHAPE.test(token)) return token;
  console.warn("[Halochime] Ignored an identity token that is not a JWT. Pass the token your server signed: Halochime.identify({ token }).");
  return null;
}

function findScript(): HTMLScriptElement | null {
  const current = document.currentScript;
  if (current instanceof HTMLScriptElement && current.hasAttribute("data-key")) return current;
  // currentScript is null for module scripts and some tag managers: fall back to the tag itself.
  return document.querySelector<HTMLScriptElement>('script[data-key][src*="widget.js"]');
}

function resolveApi(script: HTMLScriptElement | null): string {
  const explicit = script?.getAttribute("data-api")?.trim();
  try {
    if (explicit) return new URL(explicit, location.href).href.replace(/\/+$/, "");
    if (script?.src) return new URL(script.src, location.href).origin;
  } catch {
    // fall through
  }
  return location.origin;
}

function boot(): void {
  if (window.__talkfrontLoaded) return; // script included twice
  const script = findScript();
  const key = script?.getAttribute("data-key")?.trim();
  if (!key) {
    console.error('[Halochime] Missing data-key on the widget script tag, e.g. <script src=".../widget.js" data-key="pk_..."></script>');
    return;
  }
  window.__talkfrontLoaded = true;

  if (!customElements.get(TAG)) customElements.define(TAG, TalkfrontWidget);

  const existing = document.querySelector(TAG);
  const el = existing instanceof TalkfrontWidget ? existing : (document.createElement(TAG) as TalkfrontWidget);
  if (!existing) el.setup(key, resolveApi(script));

  const tagToken = script?.getAttribute("data-identity-token")?.trim();
  if (tagToken) {
    const token = cleanToken(tagToken);
    if (token) el.setIdentity(token);
  }

  // Calls queued under either name, in the order each page queued them.
  const queuedUnder = (stub: Window["Halochime"]) => (stub && "q" in stub && Array.isArray(stub.q) ? stub.q : []);
  const queued = [...queuedUnder(window.Halochime), ...queuedUnder(window.Talkfront)];

  const api: TalkfrontApi = {
    open: () => void el.open(),
    close: () => el.close(),
    identify: (options) => {
      const raw = typeof options === "string" ? options : (options as { token?: unknown } | null | undefined)?.token;
      const token = cleanToken(raw);
      if (token) el.setIdentity(token);
    },
    logout: () => el.setIdentity(null),
    q: {
      push: (...calls) => {
        for (const call of calls) run(call);
        return 0;
      },
    },
  };
  const run = (call: unknown) => {
    if (!Array.isArray(call) || typeof call[0] !== "string") return;
    const [method, ...args] = call as QueuedCall;
    const fn = method === "open" || method === "close" || method === "identify" || method === "logout" ? api[method] : null;
    if (!fn) {
      console.warn(`[Halochime] Unknown method "${method}" in Halochime.q.`);
      return;
    }
    try {
      (fn as (...a: unknown[]) => void)(...args);
    } catch (err) {
      console.error(`[Halochime] ${method}() failed`, err);
    }
  };
  window.Halochime = api;
  window.Talkfront = api;

  const mount = () => {
    if (!el.isConnected) document.body.appendChild(el);
    // Replay calls queued before the script loaded, in order, now that the widget is mounted.
    for (const call of queued.splice(0)) run(call);
  };
  if (document.body) mount();
  else document.addEventListener("DOMContentLoaded", mount, { once: true });
}

boot();
