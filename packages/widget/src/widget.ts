import { TOPIC_PAGE, type ConversationMode, type HelpOffer, type PageSnapshot, type WidgetConfigResponse, type WidgetIconShape } from "@talkfront/shared";
import type { LocalAudioTrack } from "livekit-client";
import { createSession, fetchConfig, toWidgetError, WidgetError, type ErrorKind } from "./api";
import { h, icon, isTouchDevice } from "./dom";
import { clearHighlight, highlight } from "./highlight";
import { collectFromDocument, idMaker, sendDelay, signature } from "./pageguide";
import { cleanOffer, matchRule, OfferMemory, offerKey, sessionStore } from "./proactive";
import { renderRich } from "./rich";
import { ICON_CLOSE, ICON_MIC, ICON_MIC_OFF, ICON_SEND, ICON_WAVE, shapeIcon } from "./icons";
import {
  LIVE_CAPTION_ID,
  openMicrophone,
  Session,
  warmUpConnection,
  type AgentActivity,
  type Segment,
  type SessionEvents,
  audioSettleMs,
} from "./session";
import { cutReplyGoes, cutReplyIndex, VisitorSpeech } from "./speech";
import { staffLabel } from "./staff";
import { STYLES } from "./styles";
import { getVisitorId } from "./visitor";

export const TAG = "talkfront-widget";

/** A host page's own option shown next to Talk | Type (Halochime.setSwitch). */
export type SwitchOptions = { label: string; onSelect: () => void };

type MicState = "idle" | "connecting" | "listening" | "thinking" | "speaking" | "muted";

const MIC_LABEL: Record<MicState, string> = {
  idle: "Tap to talk",
  connecting: "Connecting…",
  listening: "Listening…",
  thinking: "Thinking…",
  speaking: "Speaking…",
  muted: "Muted",
};

const MIC_ARIA: Record<MicState, string> = {
  idle: "Start talking",
  connecting: "Connecting",
  listening: "Mute microphone",
  thinking: "Mute microphone",
  speaking: "Mute microphone",
  muted: "Unmute microphone",
};

const MAX_MESSAGE_CHARS = 4000;

/** Shown when the visitor's mic stays silent while the agent waits for them. */
const MIC_SILENT_TEXT = "We can't hear you. Check that your microphone is on and the right one is selected.";

interface StartAttempt {
  mode: ConversationMode;
  promise: Promise<Session | null>;
}

interface NoticeAction {
  label: string;
  run: () => void;
}

/** Visitor-friendly copy for each failure. */
function errorText(kind: ErrorKind): string {
  switch (kind) {
    case "mic_denied":
      return "Microphone access is blocked. Allow it in your browser settings and try again.";
    case "mic_missing":
      return "We couldn't find a microphone you can use.";
    case "out_of_credit":
      return "Voice chat isn't available right now.";
    case "not_configured":
      return "This assistant isn't set up yet. Please try again later.";
    case "origin_not_allowed":
      return "This assistant isn't enabled on this website.";
    case "not_found":
      return "This assistant isn't available right now.";
    case "rate_limited":
      return "Too many attempts. Please wait a few minutes and try again.";
    case "network":
      return "We can't connect right now. Check your internet connection and try again.";
    case "agent_unavailable":
      return "The assistant didn't answer. Please try again.";
    default:
      return "Something went wrong. Please try again.";
  }
}

/** Readable text colour for a theme colour (hex only; anything else keeps white). */
function onAccent(color: string): string {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return "#ffffff";
  let hex = m[1]!;
  if (hex.length === 3) hex = hex.replace(/./g, (c) => c + c);
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.45 ? "#111827" : "#ffffff";
}

function pageInfo(): { url: string; title?: string } {
  // Origin + path only: query strings and hashes can carry visitors' tokens.
  const url = `${location.origin}${location.pathname}`.slice(0, 2048);
  const title = document.title.trim().slice(0, 300);
  return title ? { url, title } : { url };
}

/** How often the page address is checked (single-page sites change it without a reload). */
const PATH_POLL_MS = 1_000;
/** Page guide: changes are batched this long, and the page is sent at most this often. */
const GUIDE_DEBOUNCE_MS = 800;
const GUIDE_MIN_GAP_MS = 4_000;
/** This many added/removed nodes count as a big change of the page. */
const GUIDE_BIG_CHANGE = 20;
/** Phones: the panel covers the page, so it steps aside while a highlight shows. */
const PEEK_MAX_WIDTH = 480;

/** A cut reply whose words are not on screen yet is looked for once more after this long. */
const CUT_RETRY_MS = 1_500;

function isLiveCaption(id: string): boolean {
  return id === LIVE_CAPTION_ID || id.startsWith(`${LIVE_CAPTION_ID}:`);
}

export class TalkfrontWidget extends HTMLElement {
  private key = "";
  private api = "";
  private built = false;

  private config: WidgetConfigResponse | null = null;
  private configError: WidgetError | null = null;
  private configLoad: Promise<void> | null = null;

  private isOpen = false;
  private mode: ConversationMode = "voice";
  private session: Session | null = null;
  private starting: StartAttempt | null = null;
  private activity: AgentActivity = "connecting";
  /**
   * The greeting, preloaded from the config, played the moment the visitor taps Talk: joining the call
   * takes 2 to 5 s, and silence after a tap feels broken. The agent is told not to say it again.
   */
  private greetingAudio: HTMLAudioElement | null = null;
  private greetingReady = false;
  private localGreetingPlaying = false;
  /** The visitor's mic stays silent while that greeting plays, so the agent never hears it as their words. */
  private greetingMic: LocalAudioTrack | null = null;
  private conversationHasContent = false;
  /** After a failed start, typing no longer auto-connects until the visitor presses Send or Retry. */
  private prewarmBlocked = false;

  /** Agent replies still being spoken, by segment id. */
  private bubbles = new Map<string, HTMLLIElement>();
  /**
   * The visitor's spoken words: one bubble per stretch of speech (until the agent answers), each live
   * caption a part of it that the model's own transcript replaces in place. That transcript often
   * arrives after the agent has started answering, so it must go into the part it belongs to, not into
   * a new bubble below the answer (which showed visitor messages twice).
   */
  private speech = new VisitorSpeech<HTMLLIElement>({
    add: () => this.addBubble("visitor", ""),
    show: (li, text, interim) => {
      li.lastChild!.textContent = text;
      li.classList.toggle("interim", interim);
      li.setAttribute("aria-busy", String(interim));
    },
    remove: (li) => li.remove(),
    last: () => this.lastItem(),
  });
  /** Agent bubble -> its segment id, so a cut reply taken away gets no more updates. */
  private replySegments = new WeakMap<HTMLLIElement, string>();
  /** Segments of agent replies taken away (cut off almost at once): later updates are ignored. */
  private removedReplies = new Set<string>();
  /** Cut replies whose words were not on screen yet, looked for again shortly. */
  private cutRetries = new Set<number>();
  private typingEl: HTMLLIElement | null = null;

  // DOM (created in build()).
  private rootEl!: HTMLDivElement;
  private launcher!: HTMLButtonElement;
  private launcherLabel!: HTMLSpanElement;
  private launcherOrb!: HTMLSpanElement;
  private avatarEl!: HTMLSpanElement;
  private panel!: HTMLElement;
  private closeTimer = 0;
  private titleEl!: HTMLHeadingElement;
  private statusEl!: HTMLDivElement;
  private noticeEl!: HTMLDivElement;
  private noticeText!: HTMLDivElement;
  private noticeBtn!: HTMLButtonElement;
  private noticeAction: NoticeAction | null = null;
  /** The notice on screen is the "we can't hear you" hint. */
  private micHintShown = false;
  /** That hint is due but another notice is up; it shows when that one goes. */
  private micHintPending = false;
  private log!: HTMLOListElement;
  private emptyEl!: HTMLLIElement;
  private emptyGreeting!: HTMLParagraphElement;
  private emptyHint!: HTMLParagraphElement;
  /** Tells the visitor it is an AI and that the chat is kept. */
  private emptyNote!: HTMLParagraphElement;
  private modesEl!: HTMLDivElement;
  /** Optional third button next to Talk | Type, set by the host page (Halochime.setSwitch). */
  private switchBtn!: HTMLButtonElement;
  private switchAction: SwitchOptions | null = null;
  /** Hidden by the host page (Halochime.hide), e.g. while its own chat is open. */
  private hiddenByHost = false;
  private modeBtns!: Record<ConversationMode, HTMLButtonElement>;
  private endBtn!: HTMLButtonElement;
  private voiceEl!: HTMLDivElement;
  private micBtn!: HTMLButtonElement;
  private micLabel!: HTMLDivElement;
  private textForm!: HTMLFormElement;
  private input!: HTMLInputElement;
  private sendBtn!: HTMLButtonElement;
  private brandEl!: HTMLDivElement;
  private brandLink!: HTMLAnchorElement;
  private audioEl!: HTMLAudioElement;

  /**
   * Identity token for the signed-in visitor (docs/integrations.md §2-3). Memory only: never stored.
   * Read when a conversation starts, so a change applies to the next conversation, not a live one.
   */
  private identityToken: string | null = null;

  // Proactive help (off unless config.proactiveHelp): the bubble next to the launcher.
  private helpEl!: HTMLDivElement;
  private helpOpenBtn!: HTMLButtonElement;
  /** The offer on screen. */
  private helpShown: HelpOffer | null = null;
  /** The visitor tapped the bubble: the next conversation carries it (WidgetSessionRequest.helpOffer). */
  private pendingOffer: HelpOffer | null = null;
  /** offerHelp() called before the config arrived. */
  private queuedOffer: { raw: unknown } | null = null;
  private offerMemory: OfferMemory | null = null;
  private helpTimer = 0;
  private pathTimer = 0;
  private lastPath = "";

  // Page guide (off unless config.pageGuide).
  private guideIds = idMaker<Element>();
  private guideMap = new Map<string, Element>();
  private guideSig = "";
  private guideSentAt: number | null = null;
  private guideTimer = 0;
  private guideObserver: MutationObserver | null = null;
  private guideChanges = 0;
  private guideSession: Session | null = null;

  /** Called by the loader before the element is attached. */
  setup(key: string, api: string): void {
    this.key = key;
    this.api = api;
  }

  /** Sets (token) or forgets (null) the signed-in visitor for the next conversation. */
  setIdentity(token: string | null): void {
    this.identityToken = token;
  }

  connectedCallback(): void {
    if (!this.built) this.build();
    if (!this.configLoad) this.configLoad = this.loadConfig();
  }

  disconnectedCallback(): void {
    void this.endSession(null);
    clearInterval(this.pathTimer);
    clearTimeout(this.helpTimer);
    this.pathTimer = 0;
  }

  // ---------------------------------------------------------------- public API

  async open(): Promise<void> {
    if (!this.built) this.build();
    if (this.isOpen || this.hiddenByHost) return;
    this.isOpen = true;
    this.hideHelp();
    this.settleClose();
    this.panel.hidden = false;
    this.launcher.hidden = true;
    this.launcher.setAttribute("aria-expanded", "true");
    this.render();
    this.focusIntoPanel();
    if (!this.config) {
      if (!this.configLoad) this.configLoad = this.loadConfig();
      await this.configLoad;
      if (this.isOpen) this.render();
    }
  }

  /**
   * A third button after Talk | Type that hands the visitor to something else on the page (the site's
   * own text assistant, say). Clicking it ends the conversation, closes the panel, then calls onSelect.
   * null removes it; calling again replaces it.
   */
  setSwitch(options: SwitchOptions | null): void {
    this.switchAction = options;
    if (!this.built) return;
    this.switchBtn.textContent = options?.label ?? "";
    this.render();
  }

  /** Hides the whole widget, launcher and panel (an open conversation ends). */
  hide(): void {
    this.hiddenByHost = true;
    if (!this.built) return;
    this.hideHelp();
    this.close();
    this.rootEl.hidden = true;
  }

  /** Shows the widget again, closed. */
  show(): void {
    this.hiddenByHost = false;
    if (this.built) this.rootEl.hidden = false;
  }

  close(): void {
    if (!this.isOpen) return;
    const hadFocus = this.shadowRoot?.activeElement != null;
    this.isOpen = false;
    this.pendingOffer = null;
    this.setPeek(false);
    // Play the exit animation, then hide. Inert at once, so nothing in it can be reached meanwhile.
    this.panel.inert = true;
    this.panel.classList.add("closing");
    clearTimeout(this.closeTimer);
    this.closeTimer = window.setTimeout(() => this.settleClose(), 200);
    this.launcher.hidden = !this.config;
    this.launcher.setAttribute("aria-expanded", "false");
    // Closing the panel ends the conversation and releases the microphone.
    void this.endSession("Conversation ended");
    if (hadFocus && !this.launcher.hidden) this.launcher.focus();
  }

  /**
   * Proactive help from the host page (Halochime.offerHelp), e.g. after a failed checkout: shows the
   * bubble once per page and reason in this visit. Does nothing while the chat is open or the business
   * has proactive help off.
   */
  offerHelp(raw: unknown): void {
    if (!this.config) {
      this.queuedOffer = { raw };
      return;
    }
    const help = this.config.proactiveHelp;
    if (!help) {
      console.info("[Halochime] offerHelp() ignored: proactive help is off for this agent (turn it on under Page help in the agent's settings).");
      return;
    }
    const { reason, message } = cleanOffer(raw, help.defaultMessage);
    this.showHelp({ source: "api", message, ...(reason ? { reason } : {}) }, offerKey(location.pathname, "api", reason));
  }

  /** Finishes (or cancels, when reopened) a pending close animation. */
  private settleClose(): void {
    clearTimeout(this.closeTimer);
    this.panel.classList.remove("closing");
    this.panel.inert = false;
    if (!this.isOpen) this.panel.hidden = true;
  }

  // ---------------------------------------------------------------- config

  private async loadConfig(): Promise<void> {
    this.configError = null;
    try {
      const config = await fetchConfig(this.api, this.key, getVisitorId());
      this.config = config;
      this.mode = config.modes.includes("voice") ? "voice" : config.modes[0]!;
      this.applyTheme(config);
      this.preloadGreeting(config);
      this.clearNotice();
      this.launcher.hidden = this.isOpen;
      if (config.livekitUrl) warmUpConnection(config.livekitUrl);
      this.startPageWatch(config);
    } catch (err) {
      this.configError = toWidgetError(err);
      this.launcher.hidden = true;
      console.warn(`[Halochime] Could not load widget config (${this.configError.kind}): ${this.configError.message}`);
    }
    this.render();
  }

  private applyTheme(config: WidgetConfigResponse): void {
    this.style.setProperty("--tf-accent", config.theme.color);
    this.style.setProperty("--tf-on-accent", onAccent(config.theme.color));
    this.rootEl.classList.toggle("left", config.theme.position === "bottom-left");
    this.launcherLabel.textContent = config.theme.label;
    this.launcher.title = config.theme.label;
    this.setAttribute("data-appearance", config.theme.appearance ?? "light");
    this.applyIcon(config);
    this.titleEl.textContent = config.name;
    this.titleEl.title = config.name;
    this.panel.setAttribute("aria-label", `${config.name} chat`);
    this.emptyGreeting.textContent = config.greeting;
    this.emptyGreeting.hidden = !config.greeting;
    this.applyPoweredBy(config.poweredBy);
  }

  /** The icon the business picked, or its own picture once that has loaded (the drawn icon stays if it fails). */
  private applyIcon(config: WidgetConfigResponse): void {
    const choice = config.theme.icon ?? "auto";
    const shape: WidgetIconShape =
      choice === "auto" || choice === "image" ? (config.modes.includes("voice") ? "wave" : "chat") : choice;
    for (const orb of [this.launcherOrb, this.avatarEl]) {
      orb.classList.remove("has-image");
      orb.replaceChildren(icon(shapeIcon(shape)));
      if (choice !== "image" || !config.iconUrl) continue;
      const img = h("img", { alt: "", decoding: "async", draggable: "false" });
      img.addEventListener("load", () => {
        orb.classList.add("has-image");
        orb.replaceChildren(img);
      }, { once: true });
      img.src = config.iconUrl;
    }
  }

  /** "by Halochime" under the chat (only the name is a link), tagged with the site it came from. Hidden on our own site. */
  private applyPoweredBy(poweredBy: WidgetConfigResponse["poweredBy"]): void {
    let href: URL | null = null;
    try {
      if (poweredBy) href = new URL(poweredBy.url);
    } catch {
      href = null;
    }
    if (!poweredBy || !href || href.origin === location.origin) {
      this.brandEl.hidden = true;
      return;
    }
    href.searchParams.set("utm_source", location.hostname || "widget");
    href.searchParams.set("utm_medium", "widget");
    href.searchParams.set("utm_campaign", "powered_by");
    this.brandLink.href = href.toString();
    this.brandLink.textContent = poweredBy.label;
    this.brandEl.hidden = false;
  }

  // ---------------------------------------------------------------- DOM

  private build(): void {
    this.built = true;
    const shadow = this.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = STYLES;

    this.launcherLabel = h("span", { class: "launcher-label" }, "Talk to us");
    this.launcherOrb = h("span", { class: "orb-mini", "aria-hidden": "true" }, icon(ICON_WAVE));
    this.launcher = h(
      "button",
      { type: "button", class: "launcher", "aria-expanded": "false", "aria-controls": "tf-panel", hidden: true },
      this.launcherOrb,
      this.launcherLabel,
    );
    this.launcher.addEventListener("click", () => void this.open());

    // Proactive help bubble (shown by showHelp)
    this.helpOpenBtn = h("button", { type: "button", class: "help-open" });
    this.helpOpenBtn.addEventListener("click", () => {
      const offer = this.helpShown;
      this.hideHelp();
      this.pendingOffer = offer;
      void this.open();
    });
    const helpClose = h("button", { type: "button", class: "help-close", "aria-label": "Dismiss" }, icon(ICON_CLOSE));
    helpClose.addEventListener("click", () => {
      this.hideHelp();
      if (!this.launcher.hidden) this.launcher.focus();
    });
    this.helpEl = h("div", { class: "help", role: "status", hidden: true }, this.helpOpenBtn, helpClose);

    // Header
    this.titleEl = h("h2", { class: "title", id: "tf-title" }, "Support");
    this.statusEl = h("div", { class: "status", "data-live": "idle" });
    this.avatarEl = h("span", { class: "orb-mini avatar", "aria-hidden": "true" }, icon(ICON_WAVE));
    const closeBtn = h("button", { type: "button", class: "icon-btn", "aria-label": "Close chat" }, icon(ICON_CLOSE));
    closeBtn.addEventListener("click", () => this.close());
    const header = h(
      "div",
      { class: "header" },
      this.avatarEl,
      h("div", { class: "header-text" }, this.titleEl, this.statusEl),
      closeBtn,
    );

    // Notice (errors and info)
    this.noticeText = h("div", { class: "notice-text" });
    this.noticeBtn = h("button", { type: "button", class: "notice-btn", hidden: true });
    this.noticeBtn.addEventListener("click", () => {
      const action = this.noticeAction;
      this.clearNotice();
      action?.run();
    });
    this.noticeEl = h("div", { class: "notice", role: "alert", hidden: true }, this.noticeText, this.noticeBtn);

    // Transcript
    this.emptyGreeting = h("p", { class: "empty-greeting" });
    this.emptyHint = h("p", { class: "empty-hint" });
    this.emptyNote = h(
      "p",
      { class: "empty-note", hidden: true },
      "You're chatting with an AI assistant. Conversations are saved so the team can follow up.",
    );
    this.emptyEl = h("li", { class: "empty" }, this.emptyGreeting, this.emptyHint, this.emptyNote);
    this.log = h("ol", { class: "log", role: "log", "aria-live": "polite", "aria-label": "Conversation" }, this.emptyEl);

    // Footer: mode switch + end
    this.modeBtns = {
      voice: h("button", { type: "button", class: "mode-btn", "aria-pressed": "false" }, "Talk"),
      text: h("button", { type: "button", class: "mode-btn", "aria-pressed": "false" }, "Type"),
    };
    this.modeBtns.voice.addEventListener("click", () => void this.switchMode("voice"));
    this.modeBtns.text.addEventListener("click", () => void this.switchMode("text"));
    this.switchBtn = h("button", { type: "button", class: "mode-btn switch-btn", hidden: true });
    this.switchBtn.addEventListener("click", () => {
      const action = this.switchAction;
      if (!action) return;
      this.close();
      try {
        action.onSelect();
      } catch (err) {
        console.error("[Halochime] setSwitch onSelect() failed", err);
      }
    });
    this.modesEl = h(
      "div",
      { class: "modes", role: "group", "aria-label": "How do you want to chat?" },
      this.modeBtns.voice,
      this.modeBtns.text,
      this.switchBtn,
    );
    this.endBtn = h("button", { type: "button", class: "end-btn", "aria-label": "End conversation", hidden: true }, "End");
    this.endBtn.addEventListener("click", () => void this.endSession("Conversation ended"));
    const topRow = h("div", { class: "footer-row" }, this.modesEl, this.endBtn);

    // Voice controls
    this.micBtn = h("button", { type: "button", class: "mic", "data-state": "idle", "aria-label": MIC_ARIA.idle });
    this.micBtn.addEventListener("click", () => void this.onMicClick());
    this.micLabel = h("div", { class: "mic-label", "aria-hidden": "true" }, MIC_LABEL.idle);
    this.voiceEl = h("div", { class: "voice" }, this.micBtn, this.micLabel);

    // Text controls
    this.input = h("input", {
      class: "input",
      type: "text",
      enterkeyhint: "send",
      autocomplete: "off",
      maxlength: MAX_MESSAGE_CHARS,
      placeholder: "Type your message…",
      "aria-label": "Message",
    });
    this.sendBtn = h("button", { type: "submit", class: "send", "aria-label": "Send message", disabled: true }, icon(ICON_SEND));
    this.textForm = h("form", { class: "text", hidden: true }, this.input, this.sendBtn);
    this.textForm.addEventListener("submit", (e) => {
      e.preventDefault();
      void this.sendMessage();
    });
    this.input.addEventListener("input", () => {
      this.sendBtn.disabled = !this.input.value.trim();
      // Start connecting as soon as the visitor starts typing, so the agent is in the room on send.
      // (Not during a voice call: typed text goes to that call.)
      if (this.input.value.trim() && this.mode === "text" && !this.prewarmBlocked && !this.activeOrStarting("text")) {
        void this.startSession("text");
      }
    });

    this.brandLink = h("a", { target: "_blank", rel: "noopener" });
    this.brandEl = h("div", { class: "brand", hidden: true }, "by ", this.brandLink);

    const footer = h(
      "div",
      { class: "footer" },
      topRow,
      this.voiceEl,
      this.textForm,
      this.brandEl,
    );

    this.panel = h(
      "section",
      { class: "panel", id: "tf-panel", role: "dialog", "aria-modal": "false", "aria-labelledby": "tf-title", tabindex: "-1", hidden: true },
      header,
      this.noticeEl,
      this.log,
      footer,
    );
    // Phones: a tap on the panel while it stepped aside for a highlight brings it back.
    this.panel.addEventListener("pointerdown", () => this.setPeek(false));
    this.panel.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        this.close();
      }
    });

    this.audioEl = h("audio", { autoplay: true, hidden: true });
    this.audioEl.setAttribute("playsinline", "");

    this.rootEl = h("div", { class: "root", hidden: this.hiddenByHost }, this.helpEl, this.launcher, this.panel, this.audioEl);
    this.switchBtn.textContent = this.switchAction?.label ?? "";
    shadow.append(style, this.rootEl);
  }

  private focusIntoPanel(): void {
    // Never focus the text input on touch devices: it pops the on-screen keyboard.
    if (!isTouchDevice() && this.config && this.mode === "text") this.input.focus();
    else if (this.config && this.mode === "voice" && !isTouchDevice()) this.micBtn.focus();
    else this.panel.focus();
  }

  /** Syncs the whole panel to the current state. Cheap; called after every change. */
  private render(): void {
    if (!this.built) return;
    const config = this.config;
    const ready = !!config;
    const modes = config?.modes ?? [];

    this.panel.dataset.mode = this.mode;

    // Modes: show only what the config allows; hide the switch when there is one choice.
    this.switchBtn.hidden = !this.switchAction;
    this.modesEl.hidden = modes.length + (this.switchAction ? 1 : 0) < 2;
    for (const m of ["voice", "text"] as const) {
      this.modeBtns[m].hidden = !modes.includes(m);
      this.modeBtns[m].setAttribute("aria-pressed", String(this.mode === m));
    }
    this.voiceEl.hidden = !ready || this.mode !== "voice";
    // During a voice call the visitor can also type (emails and order numbers are easier typed).
    const inVoiceCall = this.mode === "voice" && this.liveVoiceSession() !== null;
    this.textForm.hidden = !ready || (this.mode !== "text" && !inVoiceCall);
    this.input.placeholder = inVoiceCall ? "Or type here, e.g. your email…" : "Type your message…";
    this.endBtn.hidden = !this.session && !this.starting;

    // Empty state
    this.emptyEl.hidden = this.conversationHasContent;
    this.emptyHint.textContent = !ready
      ? this.configError
        ? ""
        : "Loading…"
      : this.mode === "voice"
        ? "Tap the microphone and start talking."
        : "Type a message to start.";
    this.emptyNote.hidden = !ready;

    // Header status + mic state
    const mic = this.micState();
    this.micBtn.dataset.state = mic;
    this.voiceEl.dataset.state = mic;
    this.micBtn.setAttribute("aria-label", MIC_ARIA[mic]);
    this.micBtn.disabled = mic === "connecting";
    this.micBtn.replaceChildren(icon(mic === "muted" ? ICON_MIC_OFF : ICON_MIC));
    this.micLabel.textContent = MIC_LABEL[mic];

    const live = this.session && !this.starting;
    const status = !ready
      ? "idle"
      : !this.localGreetingPlaying && (this.starting || (this.session && this.activity === "connecting"))
        ? "connecting"
        : live || this.localGreetingPlaying
          ? "live"
          : "idle";
    this.statusEl.dataset.live = status;
    this.statusEl.textContent = !ready
      ? ""
      : status === "connecting"
        ? "Connecting…"
        : status === "live"
          ? this.mode === "voice"
            ? MIC_LABEL[mic].replace("…", "")
            : this.activity === "thinking"
              ? "Typing…"
              : "Online"
          : "We usually reply instantly";

    this.setTyping(this.mode === "text" && !!live && this.activity === "thinking");

    if (!ready && this.configError && this.isOpen) {
      this.showError(this.configError, { label: "Try again", run: () => void this.retryConfig() });
    }
  }

  /** Fetches the greeting audio in the background so it can play the instant the visitor taps Talk. */
  private preloadGreeting(config: WidgetConfigResponse): void {
    if (!config.greetingAudioUrl || !config.modes.includes("voice") || this.greetingAudio) return;
    try {
      const audio = new Audio();
      audio.preload = "auto";
      audio.addEventListener("canplaythrough", () => (this.greetingReady = true), { once: true });
      audio.addEventListener("error", () => (this.greetingReady = false), { once: true });
      audio.src = config.greetingAudioUrl;
      audio.load();
      this.greetingAudio = audio;
    } catch {
      this.greetingAudio = null;
    }
  }

  /**
   * Starts the preloaded greeting. Resolves true once it is playing (then the agent must not repeat it),
   * false if the browser refused. null when there is nothing ready to play: the agent greets as before.
   */
  private playLocalGreeting(): Promise<boolean> | null {
    const audio = this.greetingAudio;
    const text = this.config?.greeting.trim();
    if (!audio || !this.greetingReady || !text) return null;
    this.stopLocalGreeting();
    const done = () => {
      if (!this.localGreetingPlaying) return;
      this.localGreetingPlaying = false;
      if (this.greetingMic) {
        this.greetingMic.mediaStreamTrack.enabled = true;
        this.greetingMic = null;
      }
      this.render();
    };
    audio.onended = done;
    audio.onerror = done;
    audio.muted = false;
    audio.currentTime = 0;
    this.localGreetingPlaying = true;
    this.render();
    return audio.play().then(
      () => {
        if (!this.localGreetingPlaying) return false;
        this.addBubble("agent", text);
        return true;
      },
      () => {
        done();
        return false;
      },
    );
  }

  /**
   * Lets the greeting play after the microphone prompt. Browsers allow sound only in a tap (Safari: per
   * audio element), so the element is started here, muted, and paused at once.
   */
  private unlockGreeting(): void {
    const audio = this.greetingAudio;
    if (!audio || !this.greetingReady || this.localGreetingPlaying) return;
    const settle = () => {
      if (!this.localGreetingPlaying) {
        audio.pause();
        audio.currentTime = 0;
      }
      audio.muted = false;
    };
    try {
      audio.muted = true;
      audio.play().then(settle, () => (audio.muted = false));
    } catch {
      audio.muted = false;
    }
  }

  private stopLocalGreeting(): void {
    const audio = this.greetingAudio;
    if (audio && this.localGreetingPlaying) {
      audio.pause();
      audio.onended?.(new Event("ended"));
    }
  }

  private micState(): MicState {
    if (this.localGreetingPlaying) return "speaking";
    if (this.starting?.mode === "voice") return "connecting";
    const s = this.session;
    if (!s || s.mode !== "voice") return "idle";
    if (this.activity === "connecting") return "connecting";
    if (s.muted) return "muted";
    return this.activity;
  }

  private async retryConfig(): Promise<void> {
    this.configLoad = this.loadConfig();
    await this.configLoad;
  }

  // ---------------------------------------------------------------- notices

  private showError(err: WidgetError, action?: NoticeAction | null): void {
    let fallback: NoticeAction | null = action ?? null;
    const canType = this.config?.modes.includes("text") && this.mode === "voice";
    if (!fallback && canType && ["mic_denied", "mic_missing", "out_of_credit"].includes(err.kind)) {
      fallback = { label: "Type instead", run: () => void this.switchMode("text") };
    }
    if (!fallback && ["network", "agent_unavailable", "unknown"].includes(err.kind) && this.config) {
      const mode = this.mode;
      fallback = { label: "Try again", run: () => void this.startSession(mode) };
    }
    this.showNotice(errorText(err.kind), fallback, false);
  }

  private showNotice(text: string, action: NoticeAction | null, info: boolean): void {
    // Another notice replaces the mic hint; the hint comes back when that one goes, if still true.
    this.micHintPending ||= this.micHintShown;
    this.micHintShown = false;
    this.noticeEl.classList.toggle("info", info);
    this.noticeEl.setAttribute("role", info ? "status" : "alert");
    this.noticeText.textContent = text;
    this.noticeAction = action;
    this.noticeBtn.hidden = !action;
    this.noticeBtn.textContent = action?.label ?? "";
    this.noticeEl.hidden = false;
  }

  private clearNotice(): void {
    this.noticeEl.hidden = true;
    this.noticeAction = null;
    this.micHintShown = false;
    if (this.micHintPending) this.setMicHint(true);
  }

  /** "We can't hear you": shows (silent) or removes the hint. Only ever during a live voice call. */
  private setMicHint(silent: boolean): void {
    this.micHintPending = false;
    if (!silent) {
      if (this.micHintShown) this.clearNotice();
      return;
    }
    if (this.micHintShown || this.mode !== "voice" || !this.liveVoiceSession()) return;
    if (!this.noticeEl.hidden) {
      // An error or the paused-sound notice comes first.
      this.micHintPending = true;
      return;
    }
    const canType = !!this.config?.modes.includes("text");
    this.showNotice(MIC_SILENT_TEXT, canType ? { label: "Type instead", run: () => void this.switchMode("text") } : null, true);
    this.micHintShown = true;
    this.micHintPending = false;
  }

  // ---------------------------------------------------------------- transcript

  private nearBottom(): boolean {
    const l = this.log;
    return l.scrollHeight - l.scrollTop - l.clientHeight < 80;
  }

  private scrollToEnd(force: boolean): void {
    if (force || this.nearBottom()) this.log.scrollTop = this.log.scrollHeight;
  }

  private addItem(li: HTMLLIElement, force = true): void {
    const stick = force || this.nearBottom();
    this.conversationHasContent = true;
    this.emptyEl.hidden = true;
    if (this.typingEl && this.typingEl.isConnected) this.log.insertBefore(li, this.typingEl);
    else this.log.append(li);
    if (stick) this.log.scrollTop = this.log.scrollHeight;
  }

  private addBubble(speaker: "visitor" | "agent", text: string): HTMLLIElement {
    const label = h("span", { class: "sr-only" }, speaker === "visitor" ? "You: " : `${this.config?.name ?? "Agent"}: `);
    // Agent replies get light formatting (bold, code, links, bullets); visitor text stays as typed.
    const body = speaker === "agent" ? h("span", { class: "body" }) : null;
    if (body) renderRich(body, text);
    const li = h("li", { class: `msg ${speaker}` }, label, body ?? text);
    this.addItem(li);
    return li;
  }

  /** Text chats: a reply from a person on the business's team, on the agent's side, with their name. */
  private addStaffBubble(name: string, text: string): HTMLLIElement {
    const body = h("span", { class: "body" });
    renderRich(body, text);
    const li = h("li", { class: "msg agent staff" }, h("span", { class: "who" }, staffLabel(name)), h("span", { class: "sr-only" }, ": "), body);
    this.addItem(li);
    return li;
  }

  /** A small centred line: a person from the team joined or left. */
  private addSystemLine(text: string): void {
    this.addItem(h("li", { class: "divider system", role: "status" }, text));
  }

  private addDivider(text: string): void {
    if (!this.conversationHasContent) return;
    const last = this.log.lastElementChild;
    if (last?.classList.contains("divider") && last.textContent === text) return;
    this.addItem(h("li", { class: "divider" }, text));
  }

  /**
   * Live captions and transcripts. The visitor's words go into one bubble per stretch of speech (see
   * VisitorSpeech). Agent replies keep one bubble per segment, updated in place until final.
   */
  private upsertSegment(seg: Segment): void {
    const wasNear = this.nearBottom();
    if (seg.speaker === "visitor") {
      if (isLiveCaption(seg.id)) this.speech.live(seg.id, seg.text, seg.final, seg.english === true);
      else this.speech.transcript(seg.id, seg.text, seg.final);
      this.scrollToEnd(wasNear);
      return;
    }
    if (this.removedReplies.has(seg.id)) return;
    let li = this.bubbles.get(seg.id);
    if (!li) {
      li = this.addBubble(seg.speaker, seg.text);
      this.bubbles.set(seg.id, li);
      this.replySegments.set(li, seg.id);
    } else {
      renderRich(li.querySelector<HTMLElement>(".body")!, seg.text);
    }
    li.classList.toggle("interim", !seg.final);
    li.setAttribute("aria-busy", String(!seg.final));
    if (seg.final) this.bubbles.delete(seg.id);
    this.scrollToEnd(wasNear);
  }

  /** The last item in the conversation. The typing dots always sit at the end, so the one before them. */
  private lastItem(): Element | null {
    return this.typingEl?.isConnected ? this.typingEl.previousElementSibling : this.log.lastElementChild;
  }

  private dropSegment(id: string): void {
    if (this.speech.drop(id)) return;
    this.bubbles.get(id)?.remove();
    this.bubbles.delete(id);
  }

  /**
   * The visitor talked over a reply and it stopped part way. Heard for under 2 s or only a few words:
   * it goes, and the visitor's bubbles on both sides of it become one again. Otherwise it stays, marked
   * as cut, so the next reply doesn't read as the agent changing its mind mid-sentence.
   */
  private markReplyCut(text: string, playedS: number | null, retried = false): void {
    // The latest replies on screen not marked yet (the typing dots are not one).
    const replies = [...this.log.querySelectorAll<HTMLLIElement>("li.msg.agent:not(.typing):not(.cut)")].slice(-3);
    const found = cutReplyIndex(replies.map((li) => li.querySelector(".body")?.textContent ?? ""), text);
    if (found < 0 && !retried) {
      // Its words may not be on screen yet: look once more in a moment.
      const timer = window.setTimeout(() => {
        this.cutRetries.delete(timer);
        this.markReplyCut(text, playedS, true);
      }, CUT_RETRY_MS);
      this.cutRetries.add(timer);
      return;
    }
    const li = found >= 0 ? replies[found] : replies[replies.length - 1];
    if (!li) return;
    if (cutReplyGoes(text, playedS)) {
      this.removeReply(li);
      return;
    }
    li.classList.add("cut");
    li.append(
      h("span", { class: "cut-mark" }, h("span", { "aria-hidden": "true" }, "…"), h("span", { class: "sr-only" }, " (interrupted)")),
    );
  }

  private removeReply(li: HTMLLIElement): void {
    const seg = this.replySegments.get(li);
    if (seg) {
      this.bubbles.delete(seg);
      this.removedReplies.add(seg);
    }
    const before = li.previousElementSibling;
    const after = li.nextElementSibling;
    li.remove();
    // The visitor's words on both sides of it were one stretch of speech. With nothing after it yet,
    // the bubble before it is the last item again, so their next words join it.
    this.speech.merge(before, after);
  }

  /** The conversation is over: nothing more will arrive for the visitor's bubbles or cut replies. */
  private resetSpeech(): void {
    this.speech.reset();
    for (const timer of this.cutRetries) clearTimeout(timer);
    this.cutRetries.clear();
    this.removedReplies.clear();
  }

  private setTyping(on: boolean): void {
    if (on && !this.typingEl) {
      this.typingEl = h("li", { class: "msg agent typing", "aria-label": "Agent is typing" }, h("span"), h("span"), h("span"));
      this.log.append(this.typingEl);
      this.scrollToEnd(false);
    } else if (!on && this.typingEl) {
      this.typingEl.remove();
      this.typingEl = null;
    }
  }

  // ---------------------------------------------------------------- sessions

  private liveVoiceSession(): Session | null {
    const s = this.session;
    return s && s.mode === "voice" && !s.isClosed && !this.starting ? s : null;
  }

  private activeOrStarting(mode: ConversationMode): boolean {
    return this.starting?.mode === mode || (!!this.session && this.session.mode === mode);
  }

  /** Starts (or joins an in-flight start of) a session in `mode`. Resolves null on failure/cancel. */
  private startSession(mode: ConversationMode): Promise<Session | null> {
    if (this.session && this.session.mode === mode && !this.session.isClosed && !this.starting) {
      return Promise.resolve(this.session);
    }
    if (this.starting?.mode === mode) return this.starting.promise;
    // Ending is synchronous up to its first await, so state is clean before the new attempt.
    if (this.session || this.starting) void this.endSession(null);
    const attempt: StartAttempt = { mode, promise: Promise.resolve(null) };
    this.starting = attempt;
    attempt.promise = this.doStart(attempt);
    this.render();
    return attempt.promise;
  }

  private async doStart(attempt: StartAttempt): Promise<Session | null> {
    const config = this.config;
    const { mode } = attempt;
    const isCurrent = () => this.starting === attempt;
    if (!config) return null;
    this.clearNotice();
    this.activity = "connecting";

    let session: Session | null = null;
    // Opened from the help bubble: the agent opens with help about it (so no ready-made greeting).
    const offer = this.pendingOffer;
    this.pendingOffer = null;
    try {
      // Voice: the greeting plays once the microphone is open and the sound has settled, never before:
      // not while the browser still asks for the microphone (5 Nov), and not into the switch to call
      // audio that opening it causes on phones and Bluetooth headsets (5 Nov: its first words were
      // lost). Browsers allow sound only in a tap, so the audio element is unlocked here.
      if (mode === "voice") this.unlockGreeting();
      // Voice: ask for the microphone before creating the conversation, so a "no" costs nothing.
      const mic = mode === "voice" ? await openMicrophone() : null;
      if (!isCurrent()) {
        mic?.stop();
        this.stopLocalGreeting();
        return null;
      }
      let greeting: Promise<boolean> | null = null;
      if (mic) {
        const settle = await audioSettleMs(mic);
        if (settle) await new Promise((resolve) => setTimeout(resolve, settle));
        if (!isCurrent()) {
          mic.stop();
          return null;
        }
        greeting = offer ? null : this.playLocalGreeting();
      }
      const greetingPlayed = greeting ? await greeting : false;
      if (mic && this.localGreetingPlaying) {
        mic.mediaStreamTrack.enabled = false;
        this.greetingMic = mic;
      }
      session = new Session(mode, this.audioEl, this.sessionEvents(() => session), mic);
      this.session = session;
      const info = await createSession(this.api, {
        key: this.key,
        mode,
        visitorId: getVisitorId(),
        ...(this.identityToken ? { identityToken: this.identityToken } : {}),
        ...(greetingPlayed ? { greetingPlayed: true } : {}),
        ...(offer ? { helpOffer: offer } : {}),
        page: pageInfo(),
      });
      if (!isCurrent()) {
        await session.end();
        return null;
      }
      await session.start(info);
      if (!isCurrent() || session.isClosed) {
        await session.end();
        return null;
      }
      this.starting = null;
      this.prewarmBlocked = false;
      this.render();
      this.startGuide(session);
      return session;
    } catch (err) {
      // No microphone or no call: stop the greeting too.
      this.stopLocalGreeting();
      if (session) await session.end();
      if (!isCurrent()) return null;
      if (this.session === session) this.session = null;
      this.starting = null;
      this.prewarmBlocked = true;
      const e = toWidgetError(err);
      // A failed room connect (bad URL, firewall) reads as a network problem to the visitor.
      this.showError(e.kind === "unknown" && session ? new WidgetError("network", e.message) : e);
      this.render();
      return null;
    }
  }

  /** Callbacks for one session; anything from a session that is no longer current is ignored. */
  private sessionEvents(getSession: () => Session | null): SessionEvents {
    const isMine = () => {
      const s = getSession();
      return s !== null && this.session === s;
    };
    return {
      activity: (state) => {
        if (!isMine()) return;
        this.activity = state;
        this.render();
      },
      segment: (seg) => {
        if (!isMine()) return;
        if (seg.speaker === "agent") this.setTyping(false);
        this.upsertSegment(seg);
      },
      dropSegment: (id) => {
        if (isMine()) this.dropSegment(id);
      },
      replyCut: ({ text, playedS }) => {
        if (isMine()) this.markReplyCut(text, playedS);
      },
      staffNotice: ({ text }) => {
        if (isMine()) this.addSystemLine(text);
      },
      staffReply: ({ name, text }) => {
        if (!isMine()) return;
        this.setTyping(false);
        this.addStaffBubble(name, text);
      },
      audioBlocked: (blocked) => {
        if (!isMine()) return;
        if (blocked) {
          this.showNotice(
            "Your browser paused the sound.",
            { label: "Turn on sound", run: () => void getSession()?.resumeAudio().catch(() => undefined) },
            true,
          );
        } else if (this.noticeAction?.label === "Turn on sound") {
          this.clearNotice();
        }
      },
      micSilent: (silent) => {
        if (isMine()) this.setMicHint(silent);
      },
      point: ({ id, label }) => {
        if (isMine()) this.pointAt(id, label);
      },
      ended: (reason) => {
        if (!isMine()) return;
        this.setMicHint(false);
        this.stopGuide();
        this.session = null;
        this.starting = null;
        this.setTyping(false);
        this.bubbles.clear();
        this.resetSpeech();
        this.addDivider("Conversation ended");
        if (reason === "connection_lost") this.showError(new WidgetError("network"));
        this.render();
      },
    };
  }

  /** Ends whatever is running. `divider` is shown in the transcript when something actually ended. */
  private async endSession(divider: string | null): Promise<void> {
    this.stopLocalGreeting();
    const session = this.session;
    const wasStarting = !!this.starting;
    this.setMicHint(false);
    this.stopGuide();
    this.session = null;
    this.starting = null;
    this.activity = "connecting";
    this.setTyping(false);
    for (const li of this.bubbles.values()) li.classList.remove("interim");
    this.bubbles.clear();
    this.resetSpeech();
    if ((session || wasStarting) && divider) this.addDivider(divider);
    this.render();
    if (session) await session.end();
  }

  private async switchMode(mode: ConversationMode): Promise<void> {
    if (!this.config?.modes.includes(mode)) return;
    if (mode === this.mode) return;
    const wasRunning = !!this.session || !!this.starting;
    this.mode = mode;
    this.clearNotice();
    if (wasRunning) {
      await this.endSession(mode === "voice" ? "Switched to talking" : "Switched to typing");
      void this.startSession(mode);
    } else {
      this.render();
    }
    if (mode === "text" && !isTouchDevice()) this.input.focus();
    else if (mode === "voice") this.micBtn.focus();
  }

  private async onMicClick(): Promise<void> {
    const s = this.session;
    if (this.starting) return;
    if (!s || s.mode !== "voice") {
      await this.startSession("voice");
      return;
    }
    try {
      await s.setMuted(!s.muted);
      // Muting is on purpose: no "we can't hear you".
      if (s.muted) this.setMicHint(false);
    } catch (err) {
      const e = toWidgetError(err);
      this.showError(e.kind === "unknown" ? new WidgetError("mic_denied", e.message) : e);
    }
    this.render();
  }

  // ---------------------------------------------------------------- proactive help

  /** Watches the page address (single-page sites change it without a reload) for both features. */
  private startPageWatch(config: WidgetConfigResponse): void {
    if (config.proactiveHelp && !this.offerMemory) this.offerMemory = new OfferMemory(config.agentId, sessionStore());
    const queued = this.queuedOffer;
    this.queuedOffer = null;
    if (!config.proactiveHelp && !config.pageGuide) {
      if (queued) this.offerHelp(queued.raw); // logs that it is off
      return;
    }
    this.lastPath = location.pathname;
    this.scheduleRuleOffer();
    if (!this.pathTimer) {
      this.pathTimer = window.setInterval(() => {
        if (location.pathname === this.lastPath) return;
        this.lastPath = location.pathname;
        this.hideHelp(); // that offer was about the page they left
        this.scheduleRuleOffer();
        this.scheduleGuide();
      }, PATH_POLL_MS);
    }
    if (queued) this.offerHelp(queued.raw);
  }

  /** The first page rule for this page starts its timer, unless its bubble was shown in this visit. */
  private scheduleRuleOffer(): void {
    clearTimeout(this.helpTimer);
    const help = this.config?.proactiveHelp;
    if (!help) return;
    const path = location.pathname;
    const rule = matchRule(help.rules, path);
    if (!rule) return;
    const key = offerKey(path, "rule");
    if (this.offerMemory?.shown(key)) return;
    this.helpTimer = window.setTimeout(() => {
      if (location.pathname === path) this.showHelp({ source: "rule", message: rule.message }, key);
    }, rule.delaySec * 1000);
  }

  /** Shows the bubble unless the chat is in use; each offer at most once per visit. */
  private showHelp(offer: HelpOffer, key: string): void {
    if (!this.built || !this.config?.proactiveHelp) return;
    if (this.isOpen || this.hiddenByHost || this.launcher.hidden || this.session || this.starting) return;
    const memory = (this.offerMemory ??= new OfferMemory(this.config.agentId, sessionStore()));
    if (memory.shown(key)) return;
    memory.remember(key);
    this.helpShown = offer;
    this.helpOpenBtn.textContent = offer.message;
    this.helpEl.hidden = false;
  }

  private hideHelp(): void {
    this.helpShown = null;
    if (this.built) this.helpEl.hidden = true;
  }

  // ---------------------------------------------------------------- page guide

  /** Tells the agent about the page now, and again after the page changes, for this session. */
  private startGuide(session: Session): void {
    if (!this.config?.pageGuide || session.isClosed) return;
    this.stopGuide();
    this.guideSession = session;
    try {
      this.guideObserver = new MutationObserver((records) => {
        for (const r of records) this.guideChanges += r.type === "childList" ? r.addedNodes.length + r.removedNodes.length : 1;
        if (this.guideChanges >= GUIDE_BIG_CHANGE) this.scheduleGuide();
      });
      this.guideObserver.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["hidden", "aria-hidden", "open", "aria-expanded"],
      });
    } catch {
      this.guideObserver = null;
    }
    this.scheduleGuide(0);
  }

  private scheduleGuide(debounceMs = GUIDE_DEBOUNCE_MS): void {
    if (!this.guideSession || this.guideTimer) return;
    const wait = sendDelay(Date.now(), this.guideSentAt, debounceMs, GUIDE_MIN_GAP_MS);
    this.guideTimer = window.setTimeout(() => {
      this.guideTimer = 0;
      this.guideChanges = 0;
      this.sendGuide();
    }, wait);
  }

  private sendGuide(): void {
    const session = this.guideSession;
    if (!session || session.isClosed || this.session !== session) return;
    let snapshot: PageSnapshot;
    try {
      const { elements, byId } = collectFromDocument(document, this.guideIds);
      this.guideMap = byId;
      snapshot = { path: location.pathname.slice(0, 300), title: document.title.trim().slice(0, 200), elements };
    } catch (err) {
      console.warn("[Halochime] Could not read the page for the page guide", err);
      return;
    }
    const sig = signature(`${snapshot.path} ${snapshot.title}`, snapshot.elements);
    if (sig === this.guideSig) return;
    this.guideSig = sig;
    this.guideSentAt = Date.now();
    void session.sendJson(TOPIC_PAGE, snapshot).catch(() => {
      // The agent never joined or the room closed: the next change tries again.
      if (this.guideSig === sig) this.guideSig = "";
    });
  }

  private stopGuide(): void {
    this.guideObserver?.disconnect();
    this.guideObserver = null;
    clearTimeout(this.guideTimer);
    this.guideTimer = 0;
    this.guideChanges = 0;
    this.guideSession = null;
    this.guideSig = "";
    this.guideSentAt = null;
    this.guideMap = new Map();
    clearHighlight();
    this.setPeek(false);
  }

  /** The agent pointed at an element: scroll to it and highlight it in the page for a few seconds. */
  private pointAt(id: string, label: string): void {
    const config = this.config;
    const target = this.guideMap.get(id);
    if (!config?.pageGuide || !target) return;
    // Phones: the open panel covers the whole page, so it steps aside until the highlight goes.
    const peek = this.isOpen && window.innerWidth <= PEEK_MAX_WIDTH;
    if (peek) this.setPeek(true);
    const shown = highlight(target, label.trim() || "Here", config.theme.color, onAccent(config.theme.color), () => this.setPeek(false));
    if (!shown) this.setPeek(false);
  }

  private setPeek(on: boolean): void {
    if (this.built) this.panel.classList.toggle("peek", on && this.isOpen);
  }

  private async sendMessage(): Promise<void> {
    const text = this.input.value.trim().slice(0, MAX_MESSAGE_CHARS);
    if (!text || !this.config) return;
    this.input.value = "";
    this.sendBtn.disabled = true;
    this.clearNotice();
    // A text chat starts with this message, so the agent doesn't say its greeting; show it here, above it.
    if (this.mode === "text" && !this.conversationHasContent && this.config.greeting) {
      this.addBubble("agent", this.config.greeting);
    }
    const bubble = this.addBubble("visitor", text);

    const session = this.mode === "voice" ? this.liveVoiceSession() : await this.startSession("text");
    if (!session) {
      bubble.classList.add("interim");
      return;
    }
    try {
      await session.sendText(text);
    } catch (err) {
      bubble.classList.add("interim");
      const e = toWidgetError(err);
      this.showError(e.kind === "unknown" ? new WidgetError("network", e.message) : e);
    }
  }
}
