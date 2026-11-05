/**
 * The visitor's spoken words as bubbles, and agent replies the visitor cut off: the logic without the
 * DOM, so it can be checked on its own (speech.check.ts, run with tsx).
 *
 * Realtime voices show the visitor's words twice: live captions while they speak (quick, rough) and the
 * model's own transcript once it has the audio (accurate, any language, late: often after the agent
 * has started answering). The agent numbers captions by the model's messages, so caption
 * `visitor:live:<n>` and the model's transcript n are the same words. Each caption is one part of the
 * visitor's bubble and waits for its own transcript; everything the visitor says until the agent
 * answers stays one bubble.
 */

/** A part shown from live captions waits at most this long after its last change for its transcript. */
export const TRANSCRIPT_WAIT_MS = 30_000;
/** Share of shared words for a transcript to belong to a waiting part that is not the oldest. */
export const MATCH_MIN_OVERLAP = 0.4;

export function wordsOf(text: string): string[] {
  // Vowel signs (\p{M}) belong to the word: without them Hindi words fall apart into letters.
  return text.toLowerCase().match(/[\p{L}\p{M}\p{N}]+/gu) ?? [];
}

/** The script most of a text's letters are in: "latin", "other" (Urdu, Hindi...), or null when mixed or empty. */
export function mainScript(text: string): "latin" | "other" | null {
  const letters = text.match(/\p{L}/gu) ?? [];
  if (!letters.length) return null;
  const latin = letters.filter((c) => /\p{Script=Latin}/u.test(c)).length / letters.length;
  return latin >= 0.6 ? "latin" : latin <= 0.4 ? "other" : null;
}

/** Shared words between two texts, from 0 to 1 (of the longer one). */
export function wordOverlap(a: string, b: string): number {
  const wa = wordsOf(a);
  const wb = wordsOf(b);
  if (!wa.length || !wb.length) return 0;
  const set = new Set(wa);
  return wb.filter((w) => set.has(w)).length / Math.max(wa.length, wb.length);
}

/** One caption's words (or one transcript that came without live words) inside a visitor bubble. */
export interface SpeechPart<V> {
  /** The caption id (`visitor:live:<n>`), or the transcript's segment id when it had no live words. */
  readonly id: string;
  bubble: SpeechBubble<V>;
  text: string;
  /** The words may still change. */
  interim: boolean;
  /** Live words still waiting for the model's transcript. */
  awaiting: boolean;
  /** The transcript segment now shown instead of the live words. */
  transcriptId: string | null;
  /** Speech to text surely heard these live words as English. */
  english: boolean;
  /** Last change: the wait for a transcript counts from here. */
  updatedAt: number;
}

export interface SpeechBubble<V> {
  readonly view: V;
  /** In the order spoken. */
  readonly parts: SpeechPart<V>[];
}

/** What VisitorSpeech needs from the conversation on screen. */
export interface SpeechView<V> {
  /** Adds an empty visitor bubble at the end of the conversation. */
  add(): V;
  /** Shows a bubble's words; `interim` while some of them may still change. */
  show(view: V, text: string, interim: boolean): void;
  remove(view: V): void;
  /** The last item in the conversation, whatever it is: the visitor is still talking if it is their bubble. */
  last(): unknown;
}

export class VisitorSpeech<V> {
  private readonly view: SpeechView<V>;
  private readonly now: () => number;
  private readonly bubbles = new Map<V, SpeechBubble<V>>();
  /** Caption ids and transcript segment ids -> the part they show. */
  private readonly parts = new Map<string, SpeechPart<V>>();
  /** Parts shown from live captions, oldest first, still waiting for their transcript. */
  private awaiting: SpeechPart<V>[] = [];

  constructor(view: SpeechView<V>, now: () => number = Date.now) {
    this.view = view;
    this.now = now;
  }

  /** Live words of caption `id`: everything heard in that caption turn so far. */
  live(id: string, text: string, final: boolean, english = false): void {
    const known = this.parts.get(id);
    // Once the transcript is in, later live words of the same part are not needed.
    if (known?.transcriptId) return;
    const part = known ?? this.addPart(id, true);
    part.english = english;
    this.update(part, text, !final);
  }

  /** The model's transcript of segment `id` (interim, then final): it takes the place of the live words it belongs to. */
  transcript(id: string, text: string, final: boolean): void {
    let part = this.parts.get(id);
    if (!part) {
      this.expireAwaiting();
      // Live words are on screen for it: they stay until the transcript is final. Its first words
      // alone match no caption well, and the bubble would shrink to them and grow again.
      if (!final && this.awaiting.length) return;
      part = this.claimAwaiting(text) ?? this.addPart(id, false);
      part.transcriptId = id;
      this.parts.set(id, part);
    }
    // An accented English speaker's transcript can come out in Urdu script ("Okay, goodbye" as
    // "اوکے، گڈ بائے", 5 Nov): when the live words were surely English, they stay.
    if (part.english && mainScript(part.text) === "latin" && mainScript(text) === "other") {
      this.update(part, part.text, false);
      return;
    }
    this.update(part, text, !final);
  }

  /** A segment that ended up empty: its part goes, and its bubble when nothing is left. False if `id` is not the visitor's. */
  drop(id: string): boolean {
    const part = this.parts.get(id);
    if (!part) return false;
    for (const [key, p] of this.parts) if (p === part) this.parts.delete(key);
    this.awaiting = this.awaiting.filter((p) => p !== part);
    const { bubble } = part;
    bubble.parts.splice(bubble.parts.indexOf(part), 1);
    if (bubble.parts.length) {
      this.render(bubble);
    } else {
      this.bubbles.delete(bubble.view);
      this.view.remove(bubble.view);
    }
    return true;
  }

  /**
   * The agent reply between bubbles `earlier` and `later` was taken away: they were one stretch of
   * speech, so `later`'s parts move to the end of `earlier` (still waiting for their transcripts where
   * they were) and `later` goes. False, and nothing changes, unless both are the visitor's spoken bubbles.
   */
  merge(earlier: unknown, later: unknown): boolean {
    const into = this.bubbles.get(earlier as V);
    const from = this.bubbles.get(later as V);
    if (!into || !from || into === from) return false;
    for (const part of from.parts) part.bubble = into;
    into.parts.push(...from.parts);
    this.bubbles.delete(from.view);
    this.view.remove(from.view);
    this.render(into);
    return true;
  }

  /** The conversation is over: nothing more will arrive, and the words stay as they are. */
  reset(): void {
    for (const bubble of this.bubbles.values()) {
      for (const part of bubble.parts) {
        part.interim = false;
        part.awaiting = false;
      }
      this.render(bubble);
    }
    this.bubbles.clear();
    this.parts.clear();
    this.awaiting = [];
  }

  /** A new part at the end of the open bubble (the visitor is the last one talking), else of a new bubble. */
  private addPart(id: string, awaiting: boolean): SpeechPart<V> {
    let bubble = this.bubbles.get(this.view.last() as V);
    if (!bubble) {
      const view = this.view.add();
      bubble = { view, parts: [] };
      this.bubbles.set(view, bubble);
    }
    const part: SpeechPart<V> = {
      id,
      bubble,
      text: "",
      interim: false,
      awaiting,
      transcriptId: null,
      english: false,
      updatedAt: this.now(),
    };
    bubble.parts.push(part);
    this.parts.set(id, part);
    if (awaiting) this.awaiting.push(part);
    return part;
  }

  private update(part: SpeechPart<V>, text: string, interim: boolean): void {
    part.text = text;
    part.interim = interim;
    part.updatedAt = this.now();
    this.render(part.bubble);
  }

  /** Parts whose live words have not changed for a long while stop waiting: those words stay as they are. */
  private expireAwaiting(): void {
    const now = this.now();
    this.awaiting = this.awaiting.filter((part) => {
      if (now - part.updatedAt <= TRANSCRIPT_WAIT_MS) return true;
      part.awaiting = false;
      part.interim = false;
      this.render(part.bubble);
      return false;
    });
  }

  /**
   * The waiting part a new transcript belongs to: the one whose live words it clearly matches, else
   * the oldest (transcripts come in the order spoken, and captions in another script share no words
   * with them). The other waiting parts, later ones still being spoken among them, stay as they are.
   */
  private claimAwaiting(text: string): SpeechPart<V> | null {
    let best = 0;
    let bestScore = 0;
    this.awaiting.forEach((part, i) => {
      const score = wordOverlap(part.text, text);
      if (score > bestScore) [best, bestScore] = [i, score];
    });
    if (bestScore < MATCH_MIN_OVERLAP) best = 0;
    const part = this.awaiting.splice(best, 1)[0];
    if (!part) return null;
    part.awaiting = false;
    return part;
  }

  private render(bubble: SpeechBubble<V>): void {
    const text = bubble.parts.map((p) => p.text.trim()).filter(Boolean).join(" ");
    this.view.show(bubble.view, text, bubble.parts.some((p) => p.interim));
  }
}

/** A cut reply the visitor heard less of than this (seconds of its voice) is taken away... */
export const CUT_REPLY_MIN_PLAYED_S = 2;
/** ...and so is one of this many words or fewer. */
export const CUT_REPLY_MAX_WORDS = 6;

/**
 * Which of the latest agent replies (their words on screen, oldest first) is the cut reply `text`: the
 * newest whose words are where `text` starts (the screen can lag its last words). -1 when none is.
 */
export function cutReplyIndex(shown: string[], text: string): number {
  const said = wordsOf(text).join(" ");
  for (let i = shown.length - 1; i >= 0; i--) {
    const words = wordsOf(shown[i]!).join(" ");
    if (words && said.startsWith(words)) return i;
  }
  return -1;
}

/** True when the visitor heard so little of a cut reply that it is better gone than shown as cut. */
export function cutReplyGoes(text: string, playedS: number | null): boolean {
  return (playedS !== null && playedS < CUT_REPLY_MIN_PLAYED_S) || wordsOf(text).length <= CUT_REPLY_MAX_WORDS;
}
