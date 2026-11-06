/** Dark look: same layout, darker surfaces. Used for "dark", and for "auto" on a dark device. */
const DARK_TOKENS = `
  --tf-bg: #15171d;
  --tf-surface: #1e2129;
  --tf-surface-2: #272b35;
  --tf-fg: #eef0f4;
  --tf-muted: #a3aab8;
  --tf-line: #2b2f3a;
  --tf-border: #3a3f4c;
  --tf-danger-bg: #3b1916;
  --tf-danger-fg: #ffb4a9;
  --tf-danger-border: #6e2c24;
  --tf-danger-hover: #9a3c31;
  --tf-shadow:
    0 1px 2px rgba(0, 0, 0, 0.4),
    0 10px 28px -8px rgba(0, 0, 0, 0.55),
    0 32px 64px -16px rgba(0, 0, 0, 0.6);
  --tf-shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.4), 0 6px 16px -6px rgba(0, 0, 0, 0.5);
  --tf-shadow-hover:
    0 1px 2px rgba(0, 0, 0, 0.45),
    0 14px 32px -8px rgba(0, 0, 0, 0.6),
    0 36px 72px -18px rgba(0, 0, 0, 0.65);
  --tf-accent-soft: color-mix(in srgb, var(--tf-accent) 16%, #15171d);
  --tf-ring: color-mix(in srgb, var(--tf-accent) 55%, #ffffff);
  --tf-edge: rgba(255, 255, 255, 0.09);
  --tf-hover: rgba(255, 255, 255, 0.07);
  --tf-press: rgba(255, 255, 255, 0.12);
  --tf-faint: #6b7280;
  --tf-placeholder: #7d8494;
  --tf-scroll: #3a3f4c;
  --tf-idle-dot: #6b7280;
  --tf-warm-tint: rgba(246, 165, 124, 0.06);
  --tf-raised: 0 1px 2px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.06);
  --tf-muted-orb-fg: #d4d8e0;
  --tf-muted-orb: radial-gradient(circle at 30% 24%, rgba(255, 255, 255, 0.28), rgba(255, 255, 255, 0) 40%), linear-gradient(160deg, #3a3f4c, #262a33);
  color-scheme: dark;
`;
const DARK_RULES = `
:host([data-appearance="dark"]) {${DARK_TOKENS}}
@media (prefers-color-scheme: dark) {
  :host([data-appearance="auto"]) {${DARK_TOKENS}}
}
`;

/** All widget CSS. Lives inside the shadow root: nothing leaks in or out. */
export const STYLES = /* css */ `
:host {
  all: initial;
  --tf-accent: #2563eb;
  --tf-on-accent: #ffffff;
  --tf-bg: #ffffff;
  --tf-surface: #f6f7f9;
  --tf-surface-2: #eceef2;
  --tf-fg: #0f172a;
  --tf-muted: #5b6474;
  --tf-line: #e6e8ee;
  --tf-border: #d5d9e1;
  --tf-danger-bg: #fef2f2;
  --tf-danger-fg: #b42318;
  --tf-danger-border: #fbd0cb;
  --tf-radius: 20px;
  --tf-gap: 20px;
  --tf-ease: cubic-bezier(0.16, 1, 0.3, 1);
  --tf-shadow:
    0 1px 2px rgba(15, 23, 42, 0.06),
    0 10px 28px -8px rgba(15, 23, 42, 0.16),
    0 32px 64px -16px rgba(15, 23, 42, 0.24);
  --tf-shadow-sm: 0 1px 2px rgba(15, 23, 42, 0.06), 0 6px 16px -6px rgba(15, 23, 42, 0.16);
  /* Accent-derived tones. The orb follows the business colour, warmed by the Halochime peach. */
  --tf-warm: color-mix(in srgb, var(--tf-accent) 55%, #f6a57c);
  --tf-violet: color-mix(in srgb, var(--tf-accent) 60%, #d8b4fe);
  --tf-accent-soft: color-mix(in srgb, var(--tf-accent) 9%, #ffffff);
  --tf-glow: color-mix(in srgb, var(--tf-accent) 42%, transparent);
  /* Focus rings: darkened accent so light theme colours (e.g. yellow) still show on white. */
  --tf-ring: color-mix(in srgb, var(--tf-accent) 60%, #0b1020);
  --tf-edge: rgba(15, 23, 42, 0.08);
  --tf-hover: rgba(15, 23, 42, 0.06);
  --tf-press: rgba(15, 23, 42, 0.1);
  --tf-faint: #9aa2b1;
  --tf-placeholder: #8a92a1;
  --tf-scroll: #d5d9e1;
  --tf-idle-dot: #a3aab6;
  --tf-danger-hover: #f5a8a0;
  --tf-warm-tint: rgba(246, 165, 124, 0.1);
  --tf-shadow-hover:
    0 1px 2px rgba(15, 23, 42, 0.06),
    0 14px 32px -8px rgba(15, 23, 42, 0.2),
    0 36px 72px -18px rgba(15, 23, 42, 0.28);
  --tf-raised: 0 1px 2px rgba(15, 23, 42, 0.1), 0 0 0 1px rgba(15, 23, 42, 0.05);
  --tf-muted-orb-fg: #374151;
  --tf-muted-orb: radial-gradient(circle at 30% 24%, #ffffff, rgba(255, 255, 255, 0) 40%), linear-gradient(160deg, #eef0f3, #cfd4dc);
}
${DARK_RULES}
@supports not (color: color-mix(in srgb, red 50%, blue)) {
  :host {
    --tf-warm: var(--tf-accent);
    --tf-violet: var(--tf-accent);
    --tf-accent-soft: #f4f5fb;
    --tf-glow: rgba(109, 94, 252, 0.3);
    --tf-ring: var(--tf-accent);
  }
}
*, *::before, *::after { box-sizing: border-box; }
[hidden] { display: none !important; }

.root {
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  font-size: 14px;
  line-height: 1.45;
  color: var(--tf-fg);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  -webkit-text-size-adjust: 100%;
  -webkit-tap-highlight-color: transparent;
}
button, input { font: inherit; color: inherit; margin: 0; }
button { cursor: pointer; border: 0; background: none; padding: 0; }
button:disabled { cursor: default; }
:focus { outline: none; }
:focus-visible { outline: 2px solid var(--tf-ring); outline-offset: 2px; }
.icon { display: inline-flex; width: 20px; height: 20px; flex: none; }
.icon svg { width: 100%; height: 100%; }
.sr-only {
  position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
  overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0;
}

/* Mini orb (launcher + header avatar) ---------------------------------------- */
.orb-mini {
  position: relative; flex: none;
  display: inline-flex; align-items: center; justify-content: center;
  width: 38px; height: 38px; border-radius: 50%;
  color: var(--tf-on-accent);
  background:
    radial-gradient(circle at 30% 24%, rgba(255, 255, 255, 0.5), rgba(255, 255, 255, 0) 38%),
    radial-gradient(circle at 78% 82%, var(--tf-warm), transparent 62%),
    radial-gradient(circle at 18% 86%, var(--tf-violet), transparent 58%),
    var(--tf-accent);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.28), 0 4px 12px -4px var(--tf-glow);
}
.orb-mini .icon { width: 18px; height: 18px; }
.orb-mini.has-image { background: var(--tf-bg); box-shadow: inset 0 0 0 1px var(--tf-line), 0 4px 12px -6px var(--tf-glow); }
.orb-mini img { display: block; width: 100%; height: 100%; border-radius: 50%; object-fit: cover; }

/* Launcher ---------------------------------------------------------------- */
.launcher {
  position: fixed;
  bottom: calc(var(--tf-gap) + env(safe-area-inset-bottom, 0px));
  right: var(--tf-gap);
  z-index: 2147483000;
  display: inline-flex; align-items: center; gap: 10px;
  max-width: min(280px, calc(100vw - 2 * var(--tf-gap)));
  min-height: 52px;
  padding: 6px 20px 6px 7px;
  border-radius: 999px;
  border: 1px solid var(--tf-edge);
  background: var(--tf-bg);
  color: var(--tf-fg);
  font-weight: 600; font-size: 15px; letter-spacing: -0.005em;
  box-shadow: var(--tf-shadow);
  transition: transform 0.2s var(--tf-ease), box-shadow 0.2s var(--tf-ease);
  animation: tf-launcher-in 0.32s var(--tf-ease) 0.12s backwards;
}
.launcher:hover {
  transform: translateY(-2px);
  box-shadow: var(--tf-shadow-hover);
}
.launcher:active { transform: translateY(0) scale(0.97); transition-duration: 0.08s; }
.launcher:focus-visible { outline: 3px solid var(--tf-ring); outline-offset: 3px; }
.launcher .orb-mini { transition: box-shadow 0.2s ease; }
.launcher:hover .orb-mini { box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.28), 0 6px 18px -4px var(--tf-glow); }
.launcher-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.left .launcher { right: auto; left: var(--tf-gap); }
@keyframes tf-launcher-in { from { opacity: 0; transform: translateY(8px) scale(0.94); } }

/* Proactive help bubble (above the launcher) ------------------------------- */
.help {
  position: fixed;
  bottom: calc(var(--tf-gap) + 64px + env(safe-area-inset-bottom, 0px));
  right: var(--tf-gap);
  z-index: 2147483000;
  display: flex; align-items: flex-start; gap: 2px;
  width: max-content;
  max-width: min(300px, calc(100vw - 2 * var(--tf-gap)));
  padding: 4px;
  border-radius: 16px;
  border: 1px solid var(--tf-edge);
  background: var(--tf-bg);
  color: var(--tf-fg);
  box-shadow: var(--tf-shadow);
  transform-origin: bottom right;
  animation: tf-help-in 0.32s var(--tf-ease);
}
.left .help { right: auto; left: var(--tf-gap); transform-origin: bottom left; }
.help::after {
  content: ""; position: absolute; bottom: -6px; right: 26px;
  width: 11px; height: 11px; transform: rotate(45deg);
  background: var(--tf-bg);
  border-right: 1px solid var(--tf-edge); border-bottom: 1px solid var(--tf-edge);
}
.left .help::after { right: auto; left: 26px; }
.help-open {
  flex: 1 1 auto; min-width: 0;
  padding: 9px 6px 9px 12px;
  border-radius: 12px;
  text-align: left;
  font-size: 14px; font-weight: 500; line-height: 1.4;
  overflow-wrap: anywhere;
  transition: background-color 0.15s ease;
}
.help-open:hover { background: var(--tf-hover); }
.help-open:active { background: var(--tf-press); }
.help-close {
  flex: none;
  display: inline-flex; align-items: center; justify-content: center;
  width: 36px; height: 36px; border-radius: 12px;
  color: var(--tf-muted);
  transition: background-color 0.15s ease, color 0.15s ease;
}
.help-close:hover { background: var(--tf-hover); color: var(--tf-fg); }
.help-close:active { background: var(--tf-press); }
.help-close .icon { width: 16px; height: 16px; }
@keyframes tf-help-in { from { opacity: 0; transform: translateY(8px) scale(0.96); } }

/* Panel ------------------------------------------------------------------- */
.panel {
  position: fixed;
  bottom: calc(var(--tf-gap) + env(safe-area-inset-bottom, 0px));
  right: var(--tf-gap);
  z-index: 2147483001;
  width: 380px;
  max-width: calc(100vw - 2 * var(--tf-gap));
  height: min(640px, calc(100vh - 2 * var(--tf-gap)));
  display: flex; flex-direction: column;
  background: var(--tf-bg);
  border: 1px solid var(--tf-edge);
  border-radius: var(--tf-radius);
  box-shadow: var(--tf-shadow);
  overflow: hidden;
  transform-origin: bottom right;
  animation: tf-panel-in 0.28s var(--tf-ease);
}
.left .panel { right: auto; left: var(--tf-gap); transform-origin: bottom left; }
.panel.closing { animation: tf-panel-out 0.18s cubic-bezier(0.4, 0, 1, 1) forwards; pointer-events: none; }
@keyframes tf-panel-in { from { opacity: 0; transform: translateY(14px) scale(0.95); } to { opacity: 1; transform: none; } }
@keyframes tf-panel-out { from { opacity: 1; transform: none; } to { opacity: 0; transform: translateY(10px) scale(0.96); } }

@media (max-width: 480px) {
  .panel, .left .panel {
    inset: 0; width: 100%; max-width: none; height: 100%; height: 100dvh;
    border: 0; border-radius: 0;
    padding-bottom: env(safe-area-inset-bottom, 0px);
    transform-origin: bottom center;
  }
  .header { padding-top: max(14px, env(safe-area-inset-top, 0px)); }
  /* Page guide: the full-screen panel slides down to its header while a highlight shows on the page. */
  .panel { transition: transform 0.3s var(--tf-ease); }
  .panel.peek { transform: translateY(calc(100% - 72px)); box-shadow: var(--tf-shadow); cursor: pointer; }
}

/* Header ------------------------------------------------------------------ */
.header {
  position: relative;
  display: flex; align-items: center; gap: 12px;
  padding: 14px 10px 14px 16px;
  background:
    radial-gradient(120% 160% at 0% 0%, var(--tf-accent-soft) 0%, rgba(255, 255, 255, 0) 62%),
    radial-gradient(70% 140% at 100% 0%, var(--tf-warm-tint) 0%, rgba(246, 165, 124, 0) 60%),
    var(--tf-bg);
  border-bottom: 1px solid var(--tf-line);
  flex: none;
}
.avatar { width: 36px; height: 36px; }
.header-text { flex: 1; min-width: 0; }
.title {
  margin: 0; font-size: 15px; font-weight: 650; line-height: 1.3; letter-spacing: -0.01em;
  color: var(--tf-fg);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.status {
  /* The small padding gives the status dot's halo room inside the clipped line. */
  margin: 1px 0 0 -4px; padding-left: 4px;
  font-size: 12.5px; color: var(--tf-muted);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.status::before {
  content: ""; display: inline-block; vertical-align: 1px;
  width: 7px; height: 7px; margin-right: 7px; border-radius: 50%;
  background: var(--tf-idle-dot); box-shadow: 0 0 0 3px rgba(163, 170, 182, 0.18);
}
.status:empty::before { display: none; }
.status[data-live="live"]::before { background: #16a34a; box-shadow: 0 0 0 3px rgba(22, 163, 74, 0.16); }
.status[data-live="connecting"]::before {
  background: #f59e0b; box-shadow: 0 0 0 3px rgba(245, 158, 11, 0.2);
  animation: tf-dot-pulse 1.1s ease-in-out infinite;
}
@keyframes tf-dot-pulse { 50% { opacity: 0.35; } }
.icon-btn {
  display: inline-flex; align-items: center; justify-content: center;
  width: 38px; height: 38px; border-radius: 12px; flex: none;
  color: var(--tf-muted);
  transition: background-color 0.15s ease, color 0.15s ease;
}
.icon-btn .icon { width: 18px; height: 18px; }
.icon-btn:hover { background: var(--tf-hover); color: var(--tf-fg); }
.icon-btn:active { background: var(--tf-press); }

/* Notices ----------------------------------------------------------------- */
.notice {
  display: flex; align-items: center; gap: 10px;
  margin: 12px 14px 0; padding: 10px 10px 10px 14px;
  border-radius: 14px; border: 1px solid var(--tf-danger-border);
  background: var(--tf-danger-bg); color: var(--tf-danger-fg);
  font-size: 13px; line-height: 1.4; flex: none;
}
.notice.info { border-color: var(--tf-line); background: var(--tf-surface); color: var(--tf-fg); }
.notice-text { flex: 1; min-width: 0; }
.notice-btn {
  flex: none; min-height: 30px; padding: 0 12px; border-radius: 999px;
  font-weight: 600; font-size: 12.5px; white-space: nowrap;
  background: var(--tf-bg); border: 1px solid currentColor;
  transition: transform 0.12s ease;
}
.notice-btn:active { transform: scale(0.97); }

/* Transcript -------------------------------------------------------------- */
.log {
  flex: 1; min-height: 0;
  margin: 0; padding: 18px 14px 14px;
  list-style: none;
  overflow-y: auto; overflow-x: hidden;
  overscroll-behavior: contain;
  display: flex; flex-direction: column; gap: 8px;
  scrollbar-width: thin; scrollbar-color: var(--tf-scroll) transparent;
}
.empty { margin: auto 12px; text-align: center; color: var(--tf-muted); }
.empty-greeting {
  color: var(--tf-fg); font-size: 16px; font-weight: 600; line-height: 1.4; letter-spacing: -0.01em;
  margin: 0 0 6px;
}
.empty-hint { margin: 0; font-size: 13px; }
.empty-note {
  max-width: 280px; margin: 14px auto 0;
  font-size: 12px; line-height: 1.5; color: var(--tf-muted);
  text-wrap: pretty;
}
.msg {
  max-width: 84%;
  padding: 9px 13px;
  border-radius: 18px;
  font-size: 14px; line-height: 1.45;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  animation: tf-msg-in 0.22s var(--tf-ease);
}
@keyframes tf-msg-in { from { opacity: 0; transform: translateY(4px); } }
.msg.agent {
  align-self: flex-start;
  background: var(--tf-surface); color: var(--tf-fg);
  border: 1px solid var(--tf-line);
  border-bottom-left-radius: 6px;
}
.msg.visitor {
  align-self: flex-end;
  background: var(--tf-accent); color: var(--tf-on-accent);
  border: 1px solid transparent;
  border-bottom-right-radius: 6px;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.08), 0 6px 14px -8px var(--tf-glow);
}
.msg strong { font-weight: 650; }
.msg code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 0.9em;
  padding: 1px 5px; border-radius: 6px; background: var(--tf-line);
}
.msg a { color: inherit; text-decoration: underline; text-underline-offset: 2px; }
.msg a:focus-visible { outline: 2px solid var(--tf-accent); outline-offset: 2px; border-radius: 3px; }
/* Live captions (and messages that did not send). */
.msg.interim { opacity: 0.72; }
.msg.agent.interim { border-style: dashed; border-color: var(--tf-border); color: var(--tf-muted); }
.msg.visitor.interim { box-shadow: none; }
/* A reply the visitor talked over, stopped part way: still readable, a little quieter (theme tokens, so light and dark). */
.msg.agent.cut { color: var(--tf-muted); }
.msg.typing { display: inline-flex; align-items: center; gap: 5px; padding: 13px 15px; }
.msg.typing span {
  width: 7px; height: 7px; border-radius: 50%; background: var(--tf-faint);
  animation: tf-dot 1.2s infinite ease-in-out;
}
.msg.typing span:nth-child(2) { animation-delay: 0.15s; }
.msg.typing span:nth-child(3) { animation-delay: 0.3s; }
@keyframes tf-dot { 0%, 80%, 100% { opacity: 0.35; transform: none; } 40% { opacity: 1; transform: translateY(-3px); } }
.divider {
  align-self: center; margin: 6px 0;
  font-size: 11.5px; font-weight: 500; color: var(--tf-muted); letter-spacing: 0.01em;
  padding: 3px 12px; border-radius: 999px;
  background: var(--tf-bg); border: 1px solid var(--tf-line);
}
/* Live inbox: a person from the team joined or left; their text replies carry their name. */
.divider.system { max-width: 88%; text-align: center; line-height: 1.4; overflow-wrap: anywhere; }
.msg.staff .who {
  display: block; margin-bottom: 2px;
  font-size: 11.5px; font-weight: 600; color: var(--tf-faint);
}

/* Footer ------------------------------------------------------------------ */
.footer {
  flex: none;
  border-top: 1px solid var(--tf-line);
  padding: 12px 14px 14px;
  display: flex; flex-direction: column; gap: 12px;
  background: var(--tf-bg);
}
.panel[data-mode="voice"] .footer {
  background: linear-gradient(180deg, var(--tf-bg) 0%, var(--tf-accent-soft) 100%);
}
.footer-row {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  /* Room for focus rings inside the clipped, sideways-scrolling row. */
  margin: -4px; padding: 4px;
  overflow-x: auto; overflow-y: hidden;
  scrollbar-width: none; -ms-overflow-style: none;
}
.footer-row::-webkit-scrollbar { display: none; }
.modes {
  display: inline-flex; flex: none; padding: 3px; gap: 2px;
  border-radius: 12px; background: var(--tf-surface-2);
  border: 1px solid var(--tf-line);
}
.mode-btn {
  min-width: 68px; min-height: 30px; padding: 0 14px; border-radius: 9px;
  font-weight: 600; font-size: 13px; color: var(--tf-muted);
  transition: background-color 0.15s ease, color 0.15s ease, box-shadow 0.15s ease;
}
.mode-btn:hover { color: var(--tf-fg); }
.mode-btn[aria-pressed="true"] {
  background: var(--tf-bg); color: var(--tf-fg);
  box-shadow: var(--tf-raised);
}
.mode-btn:focus-visible { outline-offset: 1px; }
/* The host page's own option (Halochime.setSwitch): same shape, never "pressed", trimmed if long. */
.switch-btn { max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
@media (max-width: 380px) {
  .mode-btn { min-width: 0; padding: 0 11px; }
}
.end-btn {
  flex: none; min-height: 32px; padding: 0 14px; border-radius: 999px;
  display: inline-flex; align-items: center; gap: 7px;
  font-weight: 600; font-size: 13px;
  color: var(--tf-danger-fg); border: 1px solid var(--tf-danger-border); background: var(--tf-bg);
  transition: background-color 0.15s ease, border-color 0.15s ease;
}
.end-btn::before { content: ""; width: 7px; height: 7px; border-radius: 2px; background: currentColor; }
.end-btn:hover { background: var(--tf-danger-bg); border-color: var(--tf-danger-hover); }
.end-btn:focus-visible { outline-color: var(--tf-danger-fg); }

/* Voice orb --------------------------------------------------------------- */
.voice {
  --tf-orb: 88px;
  position: relative; z-index: 0;
  display: flex; flex-direction: column; align-items: center; gap: 12px;
  padding: 26px 0 4px;
}
/* Halo glow behind the orb, and a second ripple ring (listening). */
.voice::before, .voice::after {
  content: ""; position: absolute; z-index: -1; pointer-events: none;
  left: 50%; top: calc(26px + var(--tf-orb) / 2);
  border-radius: 50%;
}
.voice::before {
  width: calc(var(--tf-orb) * 1.7); height: calc(var(--tf-orb) * 1.7);
  margin: calc(var(--tf-orb) * -0.85) 0 0 calc(var(--tf-orb) * -0.85);
  background: radial-gradient(circle, var(--tf-glow) 0%, rgba(255, 255, 255, 0) 68%);
  opacity: 0.7;
  animation: tf-breathe 4s ease-in-out infinite;
}
.voice::after {
  width: var(--tf-orb); height: var(--tf-orb);
  margin: calc(var(--tf-orb) / -2) 0 0 calc(var(--tf-orb) / -2);
  border: 2px solid var(--tf-accent);
  opacity: 0;
}
.mic {
  position: relative; isolation: isolate;
  width: var(--tf-orb); height: var(--tf-orb); border-radius: 50%;
  display: inline-flex; align-items: center; justify-content: center;
  color: var(--tf-on-accent);
  background:
    radial-gradient(circle at 30% 24%, rgba(255, 255, 255, 0.42), rgba(255, 255, 255, 0) 34%),
    radial-gradient(circle at 78% 84%, var(--tf-warm), transparent 62%),
    radial-gradient(circle at 16% 82%, var(--tf-violet), transparent 58%),
    var(--tf-accent);
  box-shadow:
    inset 0 0 0 1px rgba(255, 255, 255, 0.3),
    inset 0 -8px 18px rgba(15, 23, 42, 0.12),
    0 12px 28px -10px var(--tf-glow),
    0 2px 6px rgba(15, 23, 42, 0.12);
  transition: transform 0.2s var(--tf-ease), filter 0.2s ease;
}
.mic .icon {
  position: relative; z-index: 2;
  width: 32px; height: 32px;
  filter: drop-shadow(0 1px 1.5px rgba(15, 23, 42, 0.22));
}
.mic:hover:not(:disabled) { transform: scale(1.04); }
.mic:active:not(:disabled) { transform: scale(0.97); transition-duration: 0.08s; }
.mic:focus-visible { outline: 3px solid var(--tf-ring); outline-offset: 5px; }
/* Orb surface: swirl (thinking) or shimmer (connecting). */
.mic::before {
  content: ""; position: absolute; inset: 0; z-index: 1; border-radius: 50%;
  pointer-events: none; opacity: 0;
  background: conic-gradient(from 0deg, var(--tf-accent), var(--tf-violet), var(--tf-warm), var(--tf-accent));
  transition: opacity 0.3s ease;
}
/* Ring around the orb: spinner arc (connecting) or ripple (listening). */
.mic::after {
  content: ""; position: absolute; inset: 0; z-index: 0; border-radius: 50%;
  pointer-events: none; opacity: 0;
  border: 2px solid var(--tf-accent);
}

.mic[data-state="connecting"]::before {
  opacity: 1;
  background: conic-gradient(from 0deg, rgba(255, 255, 255, 0) 0 62%, rgba(255, 255, 255, 0.5) 84%, rgba(255, 255, 255, 0) 100%);
  animation: tf-spin 1.2s linear infinite;
}
.mic[data-state="connecting"]::after {
  inset: -7px; opacity: 1;
  border-color: var(--tf-ring) transparent transparent transparent;
  animation: tf-spin 0.9s linear infinite;
}
.voice[data-state="connecting"]::before { opacity: 0.45; animation: none; }

.mic[data-state="listening"]::after { animation: tf-ripple 1.8s ease-out infinite; }
.voice[data-state="listening"]::after { animation: tf-ripple 1.8s ease-out 0.9s infinite; }
.voice[data-state="listening"]::before { opacity: 0.85; animation: none; }

.mic[data-state="thinking"]::before { opacity: 0.85; animation: tf-spin 3.6s linear infinite; }
.voice[data-state="thinking"]::before { opacity: 0.6; animation: tf-breathe 2.4s ease-in-out infinite; }

.mic[data-state="speaking"] { animation: tf-talk 0.7s ease-in-out infinite alternate; }
.mic[data-state="speaking"]::before { opacity: 0.5; animation: tf-spin 2.2s linear infinite; }
.voice[data-state="speaking"]::before { animation: tf-glow-talk 0.7s ease-in-out infinite alternate; }

.mic[data-state="muted"] {
  color: var(--tf-muted-orb-fg);
  background: var(--tf-muted-orb);
  box-shadow: inset 0 0 0 1px rgba(15, 23, 42, 0.08), inset 0 -8px 18px rgba(15, 23, 42, 0.06), 0 6px 16px -10px rgba(15, 23, 42, 0.4);
}
.mic[data-state="muted"] .icon { filter: none; }
.voice[data-state="muted"]::before { opacity: 0.25; filter: grayscale(1); animation: none; }

@keyframes tf-spin { to { transform: rotate(360deg); } }
@keyframes tf-ripple { 0% { opacity: 0.55; transform: scale(1); } 100% { opacity: 0; transform: scale(1.48); } }
@keyframes tf-breathe { 0%, 100% { transform: scale(0.9); opacity: 0.5; } 50% { transform: scale(1.04); opacity: 0.85; } }
@keyframes tf-talk { from { scale: 1; } to { scale: 1.06; } }
@keyframes tf-glow-talk { from { transform: scale(0.95); opacity: 0.7; } to { transform: scale(1.16); opacity: 1; } }
.mic-label { font-size: 13px; font-weight: 500; color: var(--tf-muted); min-height: 19px; }

/* by Halochime ------------------------------------------------------------ */
.brand {
  align-self: center; margin: -4px 0;
  font-size: 11.5px; font-weight: 500; line-height: 16px; color: var(--tf-muted); letter-spacing: 0.01em;
}
.brand a {
  padding: 2px 3px; border-radius: 4px;
  font-weight: 700; color: var(--tf-fg); opacity: 0.8; text-decoration: none;
  transition: opacity 0.15s ease;
}
.brand a:hover { opacity: 1; text-decoration: underline; text-underline-offset: 2px; }
.brand a:focus-visible { outline: 2px solid var(--tf-ring); outline-offset: 1px; }

/* Text composer ----------------------------------------------------------- */
.text {
  display: flex; gap: 6px; align-items: center; margin: 0;
  padding: 4px 4px 4px 0;
  border-radius: 14px; border: 1px solid var(--tf-border); background: var(--tf-bg);
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
.text:focus-within {
  border-color: var(--tf-ring);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--tf-accent) 20%, transparent);
}
.input {
  flex: 1; min-width: 0; height: 40px; padding: 0 6px 0 14px;
  font-size: 16px; /* 16px stops iOS zooming the page on focus */
  border: 0; background: transparent;
}
.input::placeholder { color: var(--tf-placeholder); opacity: 1; }
.input:focus-visible { outline: none; }
.send {
  width: 40px; height: 40px; border-radius: 11px; flex: none;
  display: inline-flex; align-items: center; justify-content: center;
  background: var(--tf-accent); color: var(--tf-on-accent);
  box-shadow: 0 4px 10px -6px var(--tf-glow);
  transition: transform 0.12s ease, background-color 0.15s ease, color 0.15s ease, opacity 0.15s ease;
}
.send .icon { width: 18px; height: 18px; }
.send:hover:not(:disabled) { transform: translateX(1px); }
.send:active:not(:disabled) { transform: scale(0.94); }
.send:disabled { background: var(--tf-surface-2); color: var(--tf-faint); box-shadow: none; }

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.001ms !important;
    animation-iteration-count: 1 !important;
    transition: none !important;
  }
  .mic, .mic::before, .mic::after, .voice::before, .voice::after { animation: none !important; }
  /* No motion, but every state still looks different. */
  .mic[data-state="connecting"]::after { border: 2px dashed var(--tf-ring); }
  .mic[data-state="listening"]::after { opacity: 0.6; transform: scale(1.14); }
  .voice[data-state="listening"]::after { opacity: 0.3; transform: scale(1.32); }
  .mic[data-state="thinking"]::after { opacity: 0.5; transform: scale(1.14); border-style: dotted; }
  .mic[data-state="speaking"] { scale: 1.05; }
  .voice[data-state="speaking"]::before { opacity: 1; transform: scale(1.12); }
}
`;
