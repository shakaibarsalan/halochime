import type { AgentActivity } from "./session";
import { INITIAL_SILENCE, markSpoken, stepSilence, type SilenceState } from "./silence";

/** How often the mic level is read during a voice call. */
export const SAMPLE_MS = 200;
/** Samples per reading: about 85 ms of audio at 48 kHz, so most of each interval is covered. */
const FFT_SIZE = 4096;

type AudioContextCtor = typeof AudioContext;

function audioContextCtor(): AudioContextCtor | null {
  const w = window as unknown as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

/**
 * Reads the level of the visitor's microphone with Web Audio: one AnalyserNode, read on demand (no
 * loop of its own). Nothing is played. Never throws; anything unsupported reads as "unknown" (null).
 */
export class MicLevelMeter {
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private track: MediaStreamTrack | null = null;
  private samples: Float32Array<ArrayBuffer> | null = null;
  private bytes: Uint8Array<ArrayBuffer> | null = null;
  /** Some browsers can't mix a mic at another sample rate: the second try matches the mic's rate. */
  private matchRate = false;
  private resuming = false;
  private broken = false;
  private closed = false;

  /** RMS level (0 to 1) of `track` now, or null when it can't be measured. */
  read(track: MediaStreamTrack | null | undefined): number | null {
    if (this.closed || this.broken || !track) return null;
    // A mic that stopped (unplugged, taken by another app) delivers nothing.
    if (track.readyState === "ended") return 0;
    try {
      const ctx = this.ctx ?? (this.ctx = this.open(track));
      if (!ctx) {
        this.broken = true;
        return null;
      }
      if (ctx.state !== "running") {
        this.resume(ctx);
        return null;
      }
      // The track changes when the visitor unmutes or switches devices. The first reading after
      // attaching would still hold the old audio.
      if (track !== this.track) {
        this.attach(ctx, track);
        return null;
      }
      return this.rms();
    } catch {
      if (this.matchRate) {
        this.broken = true;
        this.close();
      } else {
        this.matchRate = true;
        this.release();
      }
      return null;
    }
  }

  /** Releases the audio context. The meter reads null afterwards. */
  close(): void {
    this.closed = true;
    this.release();
  }

  private open(track: MediaStreamTrack): AudioContext | null {
    const Ctor = audioContextCtor();
    if (!Ctor) return null;
    const rate = this.matchRate ? track.getSettings().sampleRate : undefined;
    // "playback": the meter needs no low latency, and larger buffers cost less CPU.
    return new Ctor(rate ? { latencyHint: "playback", sampleRate: rate } : { latencyHint: "playback" });
  }

  private resume(ctx: AudioContext): void {
    if (this.resuming) return;
    this.resuming = true;
    ctx
      .resume()
      .catch(() => undefined)
      .finally(() => {
        this.resuming = false;
      });
  }

  private attach(ctx: AudioContext, track: MediaStreamTrack): void {
    this.source?.disconnect();
    this.source = null;
    let analyser = this.analyser;
    if (!analyser) {
      analyser = ctx.createAnalyser();
      analyser.fftSize = FFT_SIZE;
      this.analyser = analyser;
    }
    // The analyser is read directly; it is never connected to the speakers.
    const source = ctx.createMediaStreamSource(new MediaStream([track]));
    source.connect(analyser);
    this.source = source;
    this.track = track;
  }

  private rms(): number | null {
    const analyser = this.analyser;
    if (!analyser) return null;
    const n = analyser.fftSize;
    const samples = this.samples ?? (this.samples = new Float32Array(n));
    if (typeof analyser.getFloatTimeDomainData === "function") {
      analyser.getFloatTimeDomainData(samples);
    } else {
      const bytes = this.bytes ?? (this.bytes = new Uint8Array(n));
      analyser.getByteTimeDomainData(bytes);
      for (let i = 0; i < n; i++) samples[i] = (bytes[i]! - 128) / 128;
    }
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const v = samples[i]!;
      sum += v * v;
    }
    return Math.sqrt(sum / n);
  }

  private release(): void {
    try {
      this.source?.disconnect();
    } catch {
      // already disconnected
    }
    const ctx = this.ctx;
    this.ctx = null;
    this.source = null;
    this.analyser = null;
    this.track = null;
    this.samples = null;
    this.bytes = null;
    this.resuming = false;
    if (ctx && ctx.state !== "closed") void ctx.close().catch(() => undefined);
  }
}

export interface SilenceWatchOptions {
  /** The visitor's microphone now (it changes when they unmute or switch devices). */
  track(): MediaStreamTrack | null | undefined;
  /** The visitor muted themselves. */
  muted(): boolean;
  agent(): AgentActivity;
  /** The hint should show (true) or go (false). Called on changes only. */
  onChange(show: boolean): void;
}

/**
 * Watches the visitor's mic during one voice call and says when to show the "we can't hear you"
 * hint. Reads the level every SAMPLE_MS on a timer; stops measuring for good once the visitor has
 * spoken, since the hint never comes back in that call.
 */
export class MicSilenceWatch {
  private readonly opts: SilenceWatchOptions;
  private readonly meter = new MicLevelMeter();
  private state: SilenceState = INITIAL_SILENCE;
  private timer = 0;
  private startedAt = 0;

  constructor(opts: SilenceWatchOptions) {
    this.opts = opts;
  }

  /** Call when the mic is published: the grace period counts from here. */
  start(): void {
    if (this.timer || this.state.spoken) return;
    this.startedAt = performance.now();
    this.timer = window.setInterval(() => this.tick(), SAMPLE_MS);
  }

  /** The visitor's words reached the server. */
  heard(): void {
    this.apply(markSpoken(this.state));
  }

  /** Stops the timer and releases the audio context. Safe to call more than once. */
  stop(): void {
    window.clearInterval(this.timer);
    this.timer = 0;
    this.meter.close();
  }

  private tick(): void {
    const muted = this.opts.muted();
    // A hidden page can't show the hint; skip the reading (it also keeps background work at nothing).
    const hidden = document.visibilityState === "hidden";
    const rms = muted || hidden ? null : this.meter.read(this.opts.track());
    this.apply(stepSilence(this.state, { t: performance.now() - this.startedAt, rms, muted, agent: this.opts.agent() }));
  }

  private apply(next: SilenceState): void {
    const prev = this.state;
    this.state = next;
    if (next.spoken) this.stop();
    if (next.show !== prev.show) this.opts.onChange(next.show);
  }
}
