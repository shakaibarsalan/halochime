import {
  DisconnectReason,
  MediaDeviceFailure,
  Room,
  RoomEvent,
  Track,
  createLocalAudioTrack,
  type LocalAudioTrack,
  type Participant,
  type RemoteParticipant,
  type RemoteTrack,
  type TextStreamReader,
} from "livekit-client";
import {
  TOPIC_CHAT,
  TOPIC_LIVE_CAPTION,
  TOPIC_REPLY_CUT,
  TOPIC_TRANSCRIPTION,
  type ConversationMode,
  type WidgetSessionResponse,
} from "@talkfront/shared";
import { WidgetError } from "./api";
import { MicSilenceWatch } from "./miclevel";

/** What the agent is doing, as far as the visitor needs to know. */
export type AgentActivity = "connecting" | "listening" | "thinking" | "speaking";

export type Speaker = "visitor" | "agent";

export interface Segment {
  /** Stable per caption: `<speaker>:<lk.segment_id or stream id>`. */
  id: string;
  speaker: Speaker;
  text: string;
  final: boolean;
}

export type EndReason = "local" | "remote" | "connection_lost";

/** An agent reply the visitor talked over, stopped part way. */
export interface ReplyCut {
  /** What of it was spoken (and shown). */
  text: string;
  /** Seconds of its voice the visitor heard, when the agent knows. */
  playedS: number | null;
}

export interface SessionEvents {
  activity(state: AgentActivity): void;
  segment(segment: Segment): void;
  /** Removes a caption that ended up empty. */
  dropSegment(id: string): void;
  /** Voice: an agent reply already on screen was cut off by the visitor. */
  replyCut(cut: ReplyCut): void;
  audioBlocked(blocked: boolean): void;
  /** Voice: the visitor's mic has stayed silent while the agent waits for them (true), or not any more. */
  micSilent(silent: boolean): void;
  ended(reason: EndReason): void;
}

// Attribute names from livekit-client's TranscriptionAttributes / AgentAttributes typings.
// Text stream attributes arrive as strings ("true"/"false").
const ATTR_SEGMENT_ID = "lk.segment_id";
/**
 * Segment ids of live (while speaking) visitor captions start with this, followed by the visitor
 * turn they belong to. A real transcript segment replaces them.
 */
export const LIVE_CAPTION_ID = "visitor:live";
const ATTR_TRANSCRIBED_TRACK = "lk.transcribed_track_id";
const ATTR_FINAL = "lk.transcription_final";
const ATTR_AGENT_STATE = "lk.agent.state";

const AGENT_JOIN_TIMEOUT_MS = 20_000;

/**
 * Warms up the connection to the voice server (DNS and TLS) before the visitor starts a call, so
 * joining the call is quicker. Best effort: failures are ignored.
 */
export function warmUpConnection(url: string): void {
  try {
    void new Room().prepareConnection(url).catch(() => undefined);
  } catch {
    // ignore
  }
}

/** Microphones whose opening moves the sound to a headset call (Bluetooth hands-free). */
const BLUETOOTH_MIC = /bluetooth|airpods|buds|hands-?free|\bbt\b/i;
/**
 * How long the sound takes to settle after the microphone opens. Phones switch to call audio, and
 * Bluetooth headsets from music to hands-free (a second or two of nothing): a greeting started before
 * that lost its first words (5 Nov, a phone). Desktops without Bluetooth don't switch.
 */
export async function audioSettleMs(mic: LocalAudioTrack): Promise<number> {
  let bluetooth = BLUETOOTH_MIC.test(mic.mediaStreamTrack.label);
  if (!bluetooth) {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      bluetooth = devices.some((d) => d.kind === "audioinput" && BLUETOOTH_MIC.test(d.label));
    } catch {
      // can't tell: decide by the kind of device
    }
  }
  if (bluetooth) return 1800;
  try {
    if (window.matchMedia("(pointer: coarse)").matches) return 700;
  } catch {
    // ignore
  }
  return 0;
}

/** Ask for the microphone up front, before a conversation (and credit) is created on the server. */
export async function openMicrophone(): Promise<LocalAudioTrack> {
  try {
    return await createLocalAudioTrack({
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    });
  } catch (err) {
    const failure = MediaDeviceFailure.getFailure(err);
    if (failure === MediaDeviceFailure.NotFound) throw new WidgetError("mic_missing");
    if (failure === MediaDeviceFailure.PermissionDenied) throw new WidgetError("mic_denied");
    if (failure === MediaDeviceFailure.DeviceInUse) {
      throw new WidgetError("mic_missing", "Microphone is in use by another app");
    }
    // Insecure context (http on a non-localhost page) has no mediaDevices at all.
    throw new WidgetError("mic_denied", err instanceof Error ? err.message : "getUserMedia failed");
  }
}

/** One LiveKit room connection for one conversation. Voice or text, never both. */
export class Session {
  readonly mode: ConversationMode;
  readonly room: Room;
  private readonly audioEl: HTMLAudioElement;
  private readonly on: SessionEvents;
  private micTrack: LocalAudioTrack | null;
  private agent: RemoteParticipant | null = null;
  private agentWaiters: Array<() => void> = [];
  private closed = false;
  private openSegments = new Map<string, Segment>();
  private agentActivity: AgentActivity = "connecting";
  /** Voice: notices a mic that hears nothing (muted in hardware, wrong device, never started). */
  private silenceWatch: MicSilenceWatch | null = null;

  constructor(
    mode: ConversationMode,
    audioEl: HTMLAudioElement,
    on: SessionEvents,
    micTrack: LocalAudioTrack | null,
  ) {
    this.mode = mode;
    this.audioEl = audioEl;
    this.on = on;
    this.micTrack = micTrack;
    this.room = new Room({
      adaptiveStream: false,
      dynacast: false,
      disconnectOnPageLeave: true,
      publishDefaults: { stopMicTrackOnMute: true },
    });
    this.wire();
  }

  get isClosed(): boolean {
    return this.closed;
  }

  get muted(): boolean {
    return this.mode === "voice" && !this.room.localParticipant.isMicrophoneEnabled;
  }

  async start(info: WidgetSessionResponse): Promise<void> {
    this.setActivity("connecting");
    await this.room.connect(info.livekitUrl, info.token, { autoSubscribe: true });
    if (this.closed) return;

    if (this.mode === "voice" && this.micTrack) {
      await this.room.localParticipant.publishTrack(this.micTrack, {
        source: Track.Source.Microphone,
        stopMicTrackOnMute: true,
      });
      if (this.closed) return;
      this.watchForSilence();
    }

    // The agent may already be in the room before our connect finished.
    for (const p of this.room.remoteParticipants.values()) this.considerAgent(p);
    if (!this.room.canPlaybackAudio) this.on.audioBlocked(true);
  }

  async setMuted(muted: boolean): Promise<void> {
    if (this.mode !== "voice" || this.closed) return;
    await this.room.localParticipant.setMicrophoneEnabled(!muted);
  }

  async sendText(text: string): Promise<void> {
    await this.waitForAgent();
    if (this.closed) throw new WidgetError("agent_unavailable", "Conversation ended");
    await this.room.localParticipant.sendText(text, { topic: TOPIC_CHAT });
  }

  async resumeAudio(): Promise<void> {
    await this.room.startAudio();
    this.on.audioBlocked(!this.room.canPlaybackAudio);
  }

  /** Disconnects and releases the microphone. Safe to call more than once and before `start` resolves. */
  async end(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.silenceWatch?.stop();
    this.silenceWatch = null;
    this.flushAgentWaiters();
    for (const topic of [TOPIC_TRANSCRIPTION, TOPIC_LIVE_CAPTION, TOPIC_REPLY_CUT]) {
      try {
        this.room.unregisterTextStreamHandler(topic);
      } catch {
        // not registered
      }
    }
    try {
      await this.room.disconnect(true);
    } catch {
      // already gone
    }
    // If we never got to publish it, the track is still ours to stop.
    try {
      this.micTrack?.stop();
      this.audioEl.pause();
      this.audioEl.srcObject = null;
    } catch {
      // end() runs in error paths and must never throw
    }
    this.micTrack = null;
  }

  // -------------------------------------------------------------------------

  private watchForSilence(): void {
    const watch = new MicSilenceWatch({
      track: () => this.micTrack?.mediaStreamTrack,
      muted: () => this.muted || this.micTrack?.isMuted === true,
      agent: () => this.agentActivity,
      onChange: (silent) => {
        if (!this.closed) this.on.micSilent(silent);
      },
    });
    this.silenceWatch = watch;
    watch.start();
  }

  /** The visitor's words came back from the server, so their mic works. */
  private visitorHeard(): void {
    this.silenceWatch?.heard();
  }

  private setActivity(state: AgentActivity): void {
    this.agentActivity = state;
    this.on.activity(state);
  }

  private wire(): void {
    const room = this.room;

    room.registerTextStreamHandler(TOPIC_TRANSCRIPTION, (reader, participant) => {
      void this.readTranscription(reader, participant.identity);
    });

    // Realtime voices: the visitor's words while they speak. The model's own transcript replaces them.
    room.registerTextStreamHandler(TOPIC_LIVE_CAPTION, (reader) => {
      void this.readLiveCaption(reader);
    });

    // Voice: a reply the visitor talked over stopped part way; the widget marks it (or takes it away).
    room.registerTextStreamHandler(TOPIC_REPLY_CUT, (reader) => {
      void this.readReplyCut(reader);
    });

    room.on(RoomEvent.ParticipantConnected, (p) => this.considerAgent(p));

    room.on(RoomEvent.ParticipantDisconnected, (p) => {
      if (p === this.agent || (this.agent && p.identity === this.agent.identity)) {
        // Either side leaving ends the session.
        void this.finish("remote");
      }
    });

    room.on(RoomEvent.ParticipantAttributesChanged, (_changed, p: Participant) => {
      if (this.agent && p.identity === this.agent.identity) this.emitAgentState();
      else if (!this.agent && p.isAgent) this.considerAgent(p as RemoteParticipant);
    });

    room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
      if (this.mode !== "voice" || track.kind !== Track.Kind.Audio) return;
      track.attach(this.audioEl);
      void this.audioEl.play().catch(() => this.on.audioBlocked(true));
    });

    room.on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
      if (track.kind === Track.Kind.Audio) track.detach(this.audioEl);
    });

    room.on(RoomEvent.AudioPlaybackStatusChanged, () => {
      this.on.audioBlocked(!room.canPlaybackAudio);
    });

    room.on(RoomEvent.Disconnected, (reason?: DisconnectReason) => {
      // The agent ending the call deletes the room; that is a normal end, not a lost connection.
      const endedByServer =
        reason === DisconnectReason.ROOM_DELETED ||
        reason === DisconnectReason.ROOM_CLOSED ||
        reason === DisconnectReason.PARTICIPANT_REMOVED ||
        reason === DisconnectReason.SERVER_SHUTDOWN ||
        reason === DisconnectReason.CLIENT_INITIATED;
      void this.finish(endedByServer ? "remote" : "connection_lost");
    });
  }

  private async finish(reason: EndReason): Promise<void> {
    if (this.closed) return;
    // Only report once; `end()` flips `closed`.
    await this.end();
    this.on.ended(reason);
  }

  private considerAgent(p: RemoteParticipant): void {
    if (this.agent) return;
    // Rooms are 1:1 (`tf-<conversationId>`): prefer the agent kind, but any remote is the agent.
    const agents = [...this.room.remoteParticipants.values()];
    const chosen = agents.find((x) => x.isAgent) ?? (p.isAgent || agents.length === 1 ? p : null);
    if (!chosen) return;
    this.agent = chosen;
    this.emitAgentState();
    this.flushAgentWaiters();
  }

  private emitAgentState(): void {
    if (!this.agent) {
      this.setActivity("connecting");
      return;
    }
    const state = this.agent.attributes[ATTR_AGENT_STATE];
    switch (state) {
      case "initializing":
        this.setActivity("connecting");
        break;
      case "thinking":
        this.setActivity("thinking");
        break;
      case "speaking":
        this.setActivity("speaking");
        break;
      default:
        // "listening", "idle", or no attribute (agent without state support).
        this.setActivity("listening");
    }
  }

  private waitForAgent(): Promise<void> {
    if (this.agent || this.closed) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.agentWaiters = this.agentWaiters.filter((w) => w !== done);
        reject(new WidgetError("agent_unavailable", "Agent did not join"));
      }, AGENT_JOIN_TIMEOUT_MS);
      const done = () => {
        window.clearTimeout(timer);
        resolve();
      };
      this.agentWaiters.push(done);
    });
  }

  private flushAgentWaiters(): void {
    const waiters = this.agentWaiters;
    this.agentWaiters = [];
    for (const w of waiters) w();
  }

  private isVisitorStream(identity: string, attrs: Record<string, string>): boolean {
    const local = this.room.localParticipant;
    if (identity === local.identity) return true;
    const trackId = attrs[ATTR_TRANSCRIBED_TRACK];
    if (!trackId) return false;
    for (const pub of local.trackPublications.values()) {
      if (pub.trackSid === trackId) return true;
    }
    return false;
  }

  /**
   * One text stream = one caption update. Chunks are deltas; a new stream with the same
   * `lk.segment_id` replaces that caption's text (interim -> later interim -> final).
   */
  private async readTranscription(reader: TextStreamReader, identity: string): Promise<void> {
    const startAttrs = reader.info.attributes ?? {};
    const speaker: Speaker = this.isVisitorStream(identity, startAttrs) ? "visitor" : "agent";

    if (speaker === "visitor" && this.mode === "text") {
      // Typed messages are already on screen; drain any echo the agent sends back.
      try {
        await reader.readAll();
      } catch {
        // ignore
      }
      return;
    }

    const id = `${speaker}:${startAttrs[ATTR_SEGMENT_ID] || reader.info.id}`;
    this.finalizeOthers(speaker, id);

    const segment: Segment = { id, speaker, text: "", final: false };
    this.openSegments.set(id, segment);

    let failed = false;
    try {
      for await (const chunk of reader) {
        if (this.closed) return;
        segment.text += chunk;
        if (!segment.text.trim()) continue;
        if (speaker === "visitor") this.visitorHeard();
        this.on.segment({ ...segment });
      }
    } catch {
      failed = true; // sender aborted the stream; keep what arrived
    }
    if (this.closed || this.openSegments.get(id) !== segment) return;

    // Trailer attributes are merged into reader.info.attributes once the stream closes.
    const finalAttr = (reader.info.attributes ?? {})[ATTR_FINAL];
    // Agent replies are one delta stream per segment, so a finished agent stream is final.
    // Visitor STT sends one stream per hypothesis; only the one flagged final is final.
    segment.final = speaker === "agent" || failed || finalAttr === "true";
    if (!segment.text.trim()) {
      this.openSegments.delete(id);
      this.on.dropSegment(id);
      return;
    }
    if (segment.final) this.openSegments.delete(id);
    this.on.segment({ ...segment });
  }

  private async readLiveCaption(reader: TextStreamReader): Promise<void> {
    let raw = "";
    try {
      raw = await reader.readAll();
    } catch {
      return;
    }
    if (this.closed || this.mode !== "voice") return;
    try {
      const msg = JSON.parse(raw) as { text?: unknown; final?: unknown; turn?: unknown };
      const text = typeof msg.text === "string" ? msg.text : "";
      const turn = typeof msg.turn === "number" ? msg.turn : 0;
      if (text.trim()) {
        this.visitorHeard();
        this.on.segment({ id: `${LIVE_CAPTION_ID}:${turn}`, speaker: "visitor", text, final: msg.final === true });
      }
    } catch {
      // not ours
    }
  }

  private async readReplyCut(reader: TextStreamReader): Promise<void> {
    let raw = "";
    try {
      raw = await reader.readAll();
    } catch {
      return;
    }
    if (this.closed) return;
    try {
      const msg = JSON.parse(raw) as { text?: unknown; played_s?: unknown };
      const text = typeof msg.text === "string" ? msg.text : "";
      const playedS = typeof msg.played_s === "number" && Number.isFinite(msg.played_s) ? msg.played_s : null;
      if (text.trim()) this.on.replyCut({ text, playedS });
    } catch {
      // not ours
    }
  }

  /** A new caption from the same speaker means any earlier interim one will not change again. */
  private finalizeOthers(speaker: Speaker, exceptId: string): void {
    for (const [id, seg] of this.openSegments) {
      if (id === exceptId || seg.speaker !== speaker) continue;
      this.openSegments.delete(id);
      if (seg.text.trim()) this.on.segment({ ...seg, final: true });
      else this.on.dropSegment(id);
    }
  }
}
