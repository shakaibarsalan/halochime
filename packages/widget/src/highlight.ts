import { OVERLAY_ATTR } from "./pageguide";

/**
 * Highlights one element of the host page (page guide, topic tf.point): scrolls it into view and draws
 * a ring with a small label around it for a few seconds. The overlay is fixed-position and ignores the
 * mouse, so the page's layout never moves; it follows the element while the page scrolls or resizes,
 * then fades and is removed. It lives in the host page (outside the widget's shadow root) because it
 * has to sit over the page; every style is inline and !important so the site's CSS cannot reach it.
 */

export const HIGHLIGHT_MS = 5_000;
const FADE_MS = 300;
const PAD = 6;

let current: { stop: () => void } | null = null;

function set(el: HTMLElement, styles: Record<string, string>): void {
  for (const [k, v] of Object.entries(styles)) el.style.setProperty(k, v, "important");
}

function reducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/**
 * Shows the highlight. Returns false when the element is gone or has no size (nothing drawn).
 * `accent` is the widget's colour; `onDone` runs when the highlight goes.
 */
export function highlight(target: Element, label: string, accent: string, onText: string, onDone?: () => void): boolean {
  current?.stop();
  current = null;
  if (!target.isConnected || !(target instanceof HTMLElement || target instanceof SVGElement)) return false;
  const first = target.getBoundingClientRect();
  if (first.width < 1 && first.height < 1) return false;

  const smooth = !reducedMotion();
  try {
    target.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "center", inline: "nearest" });
  } catch {
    target.scrollIntoView();
  }

  const ring = document.createElement("div");
  ring.setAttribute(OVERLAY_ATTR, "");
  ring.setAttribute("aria-hidden", "true");
  set(ring, {
    all: "initial",
    position: "fixed",
    "z-index": "2147482999",
    "pointer-events": "none",
    "box-sizing": "border-box",
    "border-radius": "10px",
    border: `3px solid ${accent}`,
    "box-shadow": `0 0 0 4px color-mix(in srgb, ${accent} 25%, transparent), 0 8px 24px -6px rgba(15, 23, 42, 0.35)`,
    opacity: "0",
    transition: `opacity ${FADE_MS}ms ease`,
    margin: "0",
    padding: "0",
  });
  const tag = document.createElement("div");
  tag.setAttribute(OVERLAY_ATTR, "");
  tag.setAttribute("aria-hidden", "true");
  tag.textContent = label;
  set(tag, {
    all: "initial",
    position: "absolute",
    left: "-3px",
    bottom: "calc(100% + 6px)",
    "max-width": "min(260px, 80vw)",
    overflow: "hidden",
    "text-overflow": "ellipsis",
    "white-space": "nowrap",
    padding: "4px 10px",
    "border-radius": "999px",
    background: accent,
    color: onText,
    "font-family": 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif',
    "font-size": "13px",
    "font-weight": "600",
    "line-height": "1.3",
    "box-shadow": "0 4px 12px -4px rgba(15, 23, 42, 0.4)",
  });
  ring.append(tag);
  document.documentElement.append(ring);

  let frame = 0;
  let stopped = false;
  const move = () => {
    if (stopped) return;
    if (!target.isConnected) {
      stop();
      return;
    }
    const r = target.getBoundingClientRect();
    set(ring, {
      left: `${r.left - PAD}px`,
      top: `${r.top - PAD}px`,
      width: `${r.width + PAD * 2}px`,
      height: `${r.height + PAD * 2}px`,
    });
    // Near the top of the screen the label goes under the ring instead of off screen.
    if (r.top - PAD < 34) set(tag, { bottom: "auto", top: "calc(100% + 6px)" });
    else set(tag, { top: "auto", bottom: "calc(100% + 6px)" });
  };
  // Every frame (smooth scrolling, animations), and on scroll and resize too: frames pause in
  // background tabs, and scrolling inside a scrollable box only shows up as a scroll event (capture).
  const loop = () => {
    move();
    if (!stopped) frame = requestAnimationFrame(loop);
  };
  const onMove = () => move();
  window.addEventListener("scroll", onMove, { capture: true, passive: true });
  window.addEventListener("resize", onMove, { passive: true });
  loop();
  requestAnimationFrame(() => set(ring, { opacity: "1" }));
  window.setTimeout(() => set(ring, { opacity: "1" }), 50);

  const timer = window.setTimeout(() => stop(), HIGHLIGHT_MS);
  function stop(): void {
    if (stopped) return;
    stopped = true;
    clearTimeout(timer);
    cancelAnimationFrame(frame);
    window.removeEventListener("scroll", onMove, { capture: true });
    window.removeEventListener("resize", onMove);
    set(ring, { opacity: "0" });
    window.setTimeout(() => ring.remove(), FADE_MS);
    if (current?.stop === stop) current = null;
    onDone?.();
  }
  current = { stop };
  return true;
}

/** Removes a highlight on screen, if any (the conversation ended). */
export function clearHighlight(): void {
  current?.stop();
  current = null;
}
