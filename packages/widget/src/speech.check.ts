/**
 * Checks for speech.ts (the widget has no test runner). A plain list stands in for the conversation
 * on screen. Run from the repo root:
 *
 *   node_modules/.bin/tsx packages/widget/src/speech.check.ts
 *
 * Not part of the widget bundle (nothing imports it); it fails with an error when a check does.
 */
import { cutReplyGoes, cutReplyIndex, TRANSCRIPT_WAIT_MS, VisitorSpeech, type SpeechView } from "./speech";

interface Item {
  who: "visitor" | "agent";
  text: string;
  interim: boolean;
}

function conversation() {
  const log: Item[] = [];
  let clock = 0;
  const view: SpeechView<Item> = {
    add: () => {
      const item: Item = { who: "visitor", text: "", interim: false };
      log.push(item);
      return item;
    },
    show: (item, text, interim) => {
      item.text = text;
      item.interim = interim;
    },
    remove: (item) => void log.splice(log.indexOf(item), 1),
    last: () => log[log.length - 1],
  };
  const speech = new VisitorSpeech(view, () => clock);
  return {
    speech,
    reply(text: string): Item {
      const item: Item = { who: "agent", text, interim: false };
      log.push(item);
      return item;
    },
    /** What the widget does with a cut reply that goes: take it away, join the visitor's bubbles around it. */
    takeAway(item: Item): void {
      const i = log.indexOf(item);
      const [before, after] = [log[i - 1], log[i + 1]];
      log.splice(i, 1);
      speech.merge(before, after);
    },
    wait(ms: number): void {
      clock += ms;
    },
    shown: () => log.map((i) => `${i.who}: ${i.text}${i.interim ? " (interim)" : ""}`),
  };
}

let failed = 0;

function check(name: string, run: () => void): void {
  try {
    run();
    console.log(`ok    ${name}`);
  } catch (err) {
    failed++;
    console.log(`FAIL  ${name}\n      ${err instanceof Error ? err.message : String(err)}`);
  }
}

function same(actual: unknown, expected: unknown): void {
  const [a, e] = [JSON.stringify(actual), JSON.stringify(expected)];
  if (a !== e) throw new Error(`got ${a}\n      expected ${e}`);
}

check("three captions and three transcripts with no reply between: one bubble, parts replaced in order", () => {
  const c = conversation();
  c.speech.live("visitor:live:0", "so I wanted to ask", true);
  c.speech.live("visitor:live:1", "about your price", true);
  c.speech.live("visitor:live:2", "for the big plan", false);
  same(c.shown(), ["visitor: so I wanted to ask about your price for the big plan (interim)"]);
  c.speech.transcript("visitor:SG_a", "So I", false); // first words: the live words stay for now
  same(c.shown(), ["visitor: so I wanted to ask about your price for the big plan (interim)"]);
  c.speech.transcript("visitor:SG_a", "So I wanted to ask", true);
  same(c.shown(), ["visitor: So I wanted to ask about your price for the big plan (interim)"]);
  c.speech.live("visitor:live:2", "for the big plan", true);
  c.speech.transcript("visitor:SG_b", "about your prices", true);
  c.speech.transcript("visitor:SG_c", "for the big plan?", true);
  same(c.shown(), ["visitor: So I wanted to ask about your prices for the big plan?"]);
});

check("transcript 1 arriving while caption 2 is still live leaves caption 2", () => {
  const c = conversation();
  c.speech.live("visitor:live:0", "hello there", true);
  c.speech.live("visitor:live:1", "can you", false);
  c.speech.transcript("visitor:SG_a", "Hello there.", true);
  same(c.shown(), ["visitor: Hello there. can you (interim)"]);
  c.speech.live("visitor:live:1", "can you help me", true); // later live words still land
  same(c.shown(), ["visitor: Hello there. can you help me"]);
  c.speech.transcript("visitor:SG_b", "Can you help me?", true);
  same(c.shown(), ["visitor: Hello there. Can you help me?"]);
});

check("zero-overlap Urdu does not shift: each transcript takes the oldest waiting part", () => {
  const c = conversation();
  c.speech.live("visitor:live:0", "Mujhe price batao.", true);
  c.speech.live("visitor:live:1", "Aur delivery kitne din", false);
  c.speech.transcript("visitor:SG_a", "مجھے قیمت بتائیں۔", true);
  same(c.shown(), ["visitor: مجھے قیمت بتائیں۔ Aur delivery kitne din (interim)"]);
  c.speech.live("visitor:live:1", "Aur delivery kitne din mein hogi", true);
  c.speech.transcript("visitor:SG_b", "اور ڈیلیوری کتنے دن میں ہوگی؟", true);
  same(c.shown(), ["visitor: مجھے قیمت بتائیں۔ اور ڈیلیوری کتنے دن میں ہوگی؟"]);
});

check("English heard surely keeps its words when the transcript comes in Urdu script", () => {
  // 5 Nov: "Okay, goodbye" from an accented English speaker was transcribed "اوکے، گڈ بائے".
  const c = conversation();
  c.speech.live("visitor:live:0", "Okay, goodbye.", true, true);
  c.speech.transcript("visitor:SG_a", "اوکے، گڈ بائے۔", true);
  same(c.shown(), ["visitor: Okay, goodbye."]);
});

check("Roman Urdu captions not heard as English still take the Urdu transcript", () => {
  const c = conversation();
  c.speech.live("visitor:live:0", "Theek hai shukriya", true, false);
  c.speech.transcript("visitor:SG_a", "ٹھیک ہے، شکریہ۔", true);
  same(c.shown(), ["visitor: ٹھیک ہے، شکریہ۔"]);
});

check("a transcript that arrives after the agent started answering goes into its own bubble above", () => {
  const c = conversation();
  c.speech.live("visitor:live:0", "Mujhe price batao", true);
  c.reply("Ji, plans 10 dollar se shuru hote hain.");
  c.speech.live("visitor:live:1", "Aur delivery", true);
  c.speech.transcript("visitor:SG_a", "مجھے قیمت بتائیں", true);
  c.speech.transcript("visitor:SG_b", "اور ڈیلیوری", true);
  same(c.shown(), ["visitor: مجھے قیمت بتائیں", "agent: Ji, plans 10 dollar se shuru hote hain.", "visitor: اور ڈیلیوری"]);
});

check("a short cut reply between two visitor bubbles is taken away and they merge", () => {
  const c = conversation();
  c.speech.live("visitor:live:0", "what are your opening hours", true);
  const cut = c.reply("Sure, our");
  c.speech.live("visitor:live:1", "on sundays", false);
  same(c.shown(), ["visitor: what are your opening hours", "agent: Sure, our", "visitor: on sundays (interim)"]);
  same(cutReplyGoes("Sure, our", 0.8), true);
  c.takeAway(cut);
  same(c.shown(), ["visitor: what are your opening hours on sundays (interim)"]);
  c.speech.transcript("visitor:SG_a", "What are your opening hours", true);
  c.speech.live("visitor:live:1", "on sundays", true);
  c.speech.live("visitor:live:2", "and holidays", true); // still the visitor talking: same bubble
  c.speech.transcript("visitor:SG_b", "on Sundays?", true);
  c.speech.transcript("visitor:SG_c", "And holidays?", true);
  same(c.shown(), ["visitor: What are your opening hours on Sundays? And holidays?"]);
});

check("taking a cut reply away with nothing after it yet reopens the visitor's bubble", () => {
  const c = conversation();
  c.speech.live("visitor:live:0", "I need a refund", true);
  c.takeAway(c.reply("Of"));
  c.speech.live("visitor:live:1", "for my last order", true);
  same(c.shown(), ["visitor: I need a refund for my last order"]);
});

check("a cut reply is the newest of the latest replies whose words start it; long ones stay", () => {
  const shown = ["Hello! How can I help?", "Our plans start at 10 dollars a month and", "Sure"];
  same(cutReplyIndex(shown, "Our plans start at **10 dollars** a month and include"), 1);
  same(cutReplyIndex(shown, "Sure, I can check that"), 2);
  same(cutReplyIndex(shown, "Something else entirely"), -1);
  same(cutReplyGoes("Our plans start at 10 dollars a month and", 3.4), false);
  same(cutReplyGoes("Our plans start at 10 dollars a month and", 1.2), true); // barely heard
  same(cutReplyGoes("Sure, I can check that", null), true); // five words
});

check("a part gives up waiting 30 s after its last change, and keeps its live words", () => {
  const c = conversation();
  c.speech.live("visitor:live:0", "first thing", true);
  c.wait(TRANSCRIPT_WAIT_MS - 1_000);
  c.speech.live("visitor:live:1", "second thing", true);
  c.wait(2_000); // part 0 waited too long; part 1 changed 2 s ago
  c.speech.transcript("visitor:SG_b", "Second thing.", true);
  same(c.shown(), ["visitor: first thing Second thing."]);
});

check("without live captions (classic voice) transcripts show as they come, one bubble until a reply", () => {
  const c = conversation();
  c.speech.transcript("visitor:SG_a", "Hi", false);
  same(c.shown(), ["visitor: Hi (interim)"]);
  c.speech.transcript("visitor:SG_a", "Hi there.", true);
  c.speech.transcript("visitor:SG_b", "Are you open?", true);
  c.reply("Yes, we are.");
  c.speech.transcript("visitor:SG_c", "Great.", true);
  same(c.shown(), ["visitor: Hi there. Are you open?", "agent: Yes, we are.", "visitor: Great."]);
});

check("a transcript that ended up empty takes its part away, and its bubble when nothing is left", () => {
  const c = conversation();
  c.speech.transcript("visitor:SG_a", "Hmm", false);
  same(c.speech.drop("visitor:SG_a"), true);
  same(c.shown(), []);
  same(c.speech.drop("agent:SG_x"), false);
});

check("reset ends the stretch: words stay as they are and the next words open a new bubble", () => {
  const c = conversation();
  c.speech.live("visitor:live:0", "still talking", false);
  c.speech.reset();
  same(c.shown(), ["visitor: still talking"]);
  c.speech.live("visitor:live:0", "new call", true);
  same(c.shown(), ["visitor: still talking", "visitor: new call"]);
});

if (failed) throw new Error(`${failed} check(s) failed`);
console.log("all speech checks passed");
