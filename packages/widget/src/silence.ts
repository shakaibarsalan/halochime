import type { AgentActivity } from "./session";

/**
 * "We can't hear you": decides from microphone level samples whether the hint should show. Pure, so
 * it can be checked without a microphone; `miclevel.ts` feeds it real samples during a voice call.
 *
 * Levels are the RMS of the mic signal after the browser's own processing (echo cancellation, noise
 * suppression, auto gain), from 0 (digital silence) to 1 (full scale).
 */

/** Silence right after the call connects is normal: the visitor waits for the greeting. */
export const SILENCE_GRACE_MS = 2_000;
/** Silence counted while the agent waits for the visitor, before the hint shows. */
export const SILENCE_SHOW_MS = 8_000;
/**
 * Below this the mic is essentially silent (about -48 dBFS). A muted, wrong or never-started mic
 * reads 0 or close to it; a working mic in a quiet room sits around here after noise suppression.
 */
export const QUIET_RMS = 0.004;
/** At or above this is real sound (about -36 dBFS). Speech after auto gain is -30 to -15 dBFS. */
export const SOUND_RMS = 0.015;
/** Samples of real sound (any, not in a row) after which the visitor counts as having spoken. */
export const SPOKEN_SAMPLES = 3;
/** Longest gap between two samples that counts as silence (timers slow down in background tabs). */
export const MAX_STEP_MS = 500;

export interface SilenceSample {
  /** Milliseconds since the call connected. */
  t: number;
  /** Mic level (RMS, 0 to 1), or null when it can't be measured right now. */
  rms: number | null;
  /** The visitor muted their own microphone. */
  muted: boolean;
  /** What the agent is doing. Silence only counts while it is listening (waiting for the visitor). */
  agent: AgentActivity;
}

export interface SilenceState {
  /** Silence counted so far, in ms. */
  quietMs: number;
  /** Time of the previous sample after the grace period. */
  lastT: number | null;
  /** Samples of real sound so far. */
  soundSamples: number;
  /** The visitor has spoken: the hint never shows again in this call. */
  spoken: boolean;
  /** The hint should be showing. */
  show: boolean;
}

export const INITIAL_SILENCE: SilenceState = Object.freeze({
  quietMs: 0,
  lastT: null,
  soundSamples: 0,
  spoken: false,
  show: false,
});

/** The next state after one level sample. Never changes `state`. */
export function stepSilence(state: SilenceState, s: SilenceSample): SilenceState {
  if (state.spoken || s.t < SILENCE_GRACE_MS) return state;
  const dt = state.lastT === null ? 0 : Math.min(Math.max(s.t - state.lastT, 0), MAX_STEP_MS);
  const next: SilenceState = { ...state, lastT: s.t };

  // Muting is on purpose: no hint, and the count starts over after unmuting.
  if (s.muted) return { ...next, quietMs: 0, show: false };
  // No reading, or the agent is talking (its voice can leak into the mic): this sample says nothing.
  if (s.rms === null || s.agent === "speaking") return next;

  if (s.rms >= SOUND_RMS) {
    const soundSamples = state.soundSamples + 1;
    return { ...next, quietMs: 0, soundSamples, spoken: soundSamples >= SPOKEN_SAMPLES, show: false };
  }
  // Faint sound, or silence while it is not the visitor's turn: neither adds to the count.
  if (s.rms >= QUIET_RMS || s.agent !== "listening") return next;

  const quietMs = state.quietMs + dt;
  return { ...next, quietMs, show: state.show || quietMs >= SILENCE_SHOW_MS };
}

/** The server heard the visitor (their words came back as a transcript): no hint for the rest of the call. */
export function markSpoken(state: SilenceState): SilenceState {
  return state.spoken && !state.show ? state : { ...state, spoken: true, show: false };
}
