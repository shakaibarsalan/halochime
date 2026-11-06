// Pure-function checks for the phone and WhatsApp channels. Run: npx tsx src/lib/channels/channels.check.ts
import assert from "node:assert/strict";
import { buildSystemPrompt, type PromptInput } from "../prompt";
import {
  isIpv4OrCidr,
  normalizePhoneNumber,
  originationUri,
  parseAllowedAddresses,
  PHONE_ROOM_PREFIX,
  phoneDispatchMetadata,
  sipHost,
} from "./phone";
import {
  isConversationFresh,
  isPhoneNumberId,
  parseWebhookMessages,
  signWebhookBody,
  toSpokenText,
  toWhatsappText,
  verifyChallenge,
  verifyWebhookSignature,
  WHATSAPP_IDLE_MS,
} from "./whatsapp";

let passed = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    passed++;
  } catch (e) {
    console.error(`FAIL ${name}`);
    throw e;
  }
}

// ------------------------------------------------------------------------------------------- signature

const SECRET = "0123456789abcdef0123456789abcdef";
const body = JSON.stringify({ object: "whatsapp_business_account", entry: [] });

check("valid signature passes", () => {
  assert.equal(verifyWebhookSignature(body, signWebhookBody(body, SECRET), SECRET), true);
  assert.equal(verifyWebhookSignature(new TextEncoder().encode(body), signWebhookBody(body, SECRET), SECRET), true);
});
check("uppercase hex is accepted", () => {
  const sig = signWebhookBody(body, SECRET).replace(/^sha256=/, "sha256=").toUpperCase().replace("SHA256=", "sha256=");
  assert.equal(verifyWebhookSignature(body, sig, SECRET), true);
});
check("wrong secret, changed body, bad headers fail", () => {
  const sig = signWebhookBody(body, SECRET);
  assert.equal(verifyWebhookSignature(body, sig, "another-secret"), false);
  assert.equal(verifyWebhookSignature(`${body} `, sig, SECRET), false);
  assert.equal(verifyWebhookSignature(body, null, SECRET), false);
  assert.equal(verifyWebhookSignature(body, "", SECRET), false);
  assert.equal(verifyWebhookSignature(body, sig.replace("sha256=", "sha1="), SECRET), false);
  assert.equal(verifyWebhookSignature(body, "sha256=abcd", SECRET), false);
  assert.equal(verifyWebhookSignature(body, sig, ""), false);
});
check("signature is over raw bytes (unicode)", () => {
  const raw = '{"text":"سلام café"}';
  const bytes = new TextEncoder().encode(raw);
  assert.equal(verifyWebhookSignature(bytes, signWebhookBody(bytes, SECRET), SECRET), true);
});

// ------------------------------------------------------------------------------------------- challenge

check("verify challenge", () => {
  const p = (q: string) => new URLSearchParams(q);
  assert.equal(verifyChallenge(p("hub.mode=subscribe&hub.verify_token=tok-12345&hub.challenge=1158201444"), "tok-12345"), "1158201444");
  assert.equal(verifyChallenge(p("hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=1"), "tok-12345"), null);
  assert.equal(verifyChallenge(p("hub.mode=unsubscribe&hub.verify_token=tok-12345&hub.challenge=1"), "tok-12345"), null);
  assert.equal(verifyChallenge(p("hub.mode=subscribe&hub.verify_token=tok-12345&hub.challenge=<script>"), "tok-12345"), null);
  assert.equal(verifyChallenge(p("hub.mode=subscribe&hub.verify_token=&hub.challenge=1"), ""), null);
});

// ------------------------------------------------------------------------------------------- parsing

const PNID = "106540352242922";
const payload = (messages: unknown[], phoneNumberId = PNID, extra: Record<string, unknown> = {}) => ({
  object: "whatsapp_business_account",
  entry: [
    {
      id: "WABA",
      changes: [
        {
          field: "messages",
          value: {
            messaging_product: "whatsapp",
            metadata: { display_phone_number: "15550001111", phone_number_id: phoneNumberId },
            contacts: [{ profile: { name: "Sam Example" }, wa_id: "923001234567" }],
            messages,
            ...extra,
          },
        },
      ],
    },
  ],
});

check("text message", () => {
  const out = parseWebhookMessages(
    payload([{ from: "923001234567", id: "wamid.A", timestamp: "1730000000", type: "text", text: { body: "  Hi, are you open today?  " } }]),
    PNID,
  );
  assert.equal(out.length, 1);
  const m = out[0]!;
  assert.equal(m.type, "text");
  assert.equal(m.id, "wamid.A");
  assert.equal(m.from, "923001234567");
  assert.equal(m.profileName, "Sam Example");
  assert.equal(m.timestamp, 1730000000);
  if (m.type === "text") assert.equal(m.text, "Hi, are you open today?");
});

check("voice note", () => {
  const out = parseWebhookMessages(
    payload([
      { from: "923001234567", id: "wamid.B", timestamp: "1730000001", type: "audio", audio: { mime_type: "audio/ogg; codecs=opus", sha256: "x", id: "MEDIA1", voice: true } },
    ]),
    PNID,
  );
  assert.equal(out.length, 1);
  const m = out[0]!;
  assert.equal(m.type, "audio");
  if (m.type === "audio") {
    assert.equal(m.mediaId, "MEDIA1");
    assert.equal(m.mimeType, "audio/ogg; codecs=opus");
    assert.equal(m.voice, true);
  }
});

check("buttons and list replies become text", () => {
  const out = parseWebhookMessages(
    payload([
      { from: "923001234567", id: "wamid.C", timestamp: "1", type: "button", button: { text: "Yes please", payload: "y" } },
      { from: "923001234567", id: "wamid.D", timestamp: "1", type: "interactive", interactive: { type: "list_reply", list_reply: { id: "1", title: "Opening hours" } } },
    ]),
    PNID,
  );
  assert.deepEqual(out.map((m) => (m.type === "text" ? m.text : m.type)), ["Yes please", "Opening hours"]);
});

check("images, stickers and the rest are unsupported", () => {
  const out = parseWebhookMessages(payload([{ from: "923001234567", id: "wamid.E", timestamp: "1", type: "image", image: { id: "M" } }]), PNID);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.type, "unsupported");
});

check("status updates, other numbers and junk are ignored", () => {
  assert.deepEqual(parseWebhookMessages(payload([], PNID, { statuses: [{ id: "wamid.A", status: "delivered" }] }), PNID), []);
  assert.deepEqual(
    parseWebhookMessages(payload([{ from: "923001234567", id: "wamid.F", type: "text", text: { body: "hi" } }], "999"), PNID),
    [],
  );
  assert.deepEqual(parseWebhookMessages(null, PNID), []);
  assert.deepEqual(parseWebhookMessages({ object: "page", entry: [] }, PNID), []);
  assert.deepEqual(parseWebhookMessages({ object: "whatsapp_business_account", entry: "x" }, PNID), []);
  // Bad sender, missing id, empty text.
  assert.deepEqual(
    parseWebhookMessages(
      payload([
        { from: "abc", id: "wamid.G", type: "text", text: { body: "hi" } },
        { from: "923001234567", type: "text", text: { body: "hi" } },
        { from: "923001234567", id: "wamid.H", type: "text", text: { body: "   " } },
        { from: "923001234567", id: "wamid.I", type: "audio", audio: {} },
      ]),
      PNID,
    ),
    [],
  );
});

check("long text is cut", () => {
  const out = parseWebhookMessages(payload([{ from: "923001234567", id: "wamid.J", type: "text", text: { body: "a".repeat(10_000) } }]), PNID);
  const m = out[0]!;
  assert.equal(m.type === "text" && m.text.length, 4000);
});

check("phone number id", () => {
  assert.equal(isPhoneNumberId(PNID), true);
  assert.equal(isPhoneNumberId("+15550001111"), false);
  assert.equal(isPhoneNumberId("12"), false);
});

check("reply formatting", () => {
  assert.equal(toWhatsappText("**Open** today\n\n\n\n## Hours\nSee [our page](https://example.com/hours)"), "*Open* today\n\nHours\nSee our page (https://example.com/hours)");
  assert.equal(toWhatsappText("x".repeat(5000)).length, 4000);
  assert.equal(toSpokenText("**Open** today. See https://example.com/hours or [the page](https://example.com/x)."), "Open today. See or the page.");
});

check("24 hour window", () => {
  const now = new Date("2026-11-06T12:00:00Z");
  assert.equal(isConversationFresh(new Date(now.getTime() - WHATSAPP_IDLE_MS + 1000), now), true);
  assert.equal(isConversationFresh(new Date(now.getTime() - WHATSAPP_IDLE_MS), now), false);
});

// ------------------------------------------------------------------------------------------- phone

check("phone numbers", () => {
  assert.equal(normalizePhoneNumber("+1 (415) 555-0100"), "+14155550100");
  assert.equal(normalizePhoneNumber("0092 300 1234567"), "+923001234567");
  assert.equal(normalizePhoneNumber("4155550100"), null);
  assert.equal(normalizePhoneNumber("+0123456789"), null);
  assert.equal(normalizePhoneNumber("+1234"), null);
  assert.equal(normalizePhoneNumber("+1415555010012345"), null);
});

check("SIP host", () => {
  assert.equal(sipHost("sip:vjnxecm0tjk.sip.livekit.cloud"), "vjnxecm0tjk.sip.livekit.cloud");
  assert.equal(sipHost("vjnxecm0tjk.sip.livekit.cloud"), "vjnxecm0tjk.sip.livekit.cloud");
  assert.equal(sipHost("sip:VJNX.sip.livekit.cloud;transport=tcp"), "vjnx.sip.livekit.cloud");
  assert.equal(sipHost(undefined), null);
  assert.equal(sipHost("not a host"), null);
  assert.equal(sipHost("sip:<script>"), null);
  assert.equal(originationUri("abc.sip.livekit.cloud"), "sip:abc.sip.livekit.cloud;transport=tcp");
});

check("allowed addresses", () => {
  assert.equal(isIpv4OrCidr("54.172.60.0/30"), true);
  assert.equal(isIpv4OrCidr("1.2.3.4"), true);
  assert.equal(isIpv4OrCidr("1.2.3.256"), false);
  assert.equal(isIpv4OrCidr("1.2.3.4/33"), false);
  assert.equal(isIpv4OrCidr("example.com"), false);
  assert.deepEqual(parseAllowedAddresses("54.172.60.0/30, 54.244.51.0/30\n\n1.2.3.4 1.2.3.4 bad"), {
    ok: ["54.172.60.0/30", "54.244.51.0/30", "1.2.3.4"],
    bad: ["bad"],
  });
});

check("dispatch metadata matches the agent's parser", () => {
  const meta = phoneDispatchMetadata({ agentId: "a", organizationId: "o", channelId: "c" });
  assert.deepEqual(JSON.parse(JSON.stringify(meta)), { channel: "phone", agentId: "a", organizationId: "o", channelId: "c" });
  assert.ok(PHONE_ROOM_PREFIX.startsWith("tf-"));
});

// ------------------------------------------------------------------------------------------- prompt

const base: PromptInput = {
  businessName: "Example Co",
  agentName: "Ava",
  persona: "",
  instructions: "",
  language: "auto",
  mode: "voice",
  voiceEngine: "realtime",
  handoffEnabled: true,
  visitor: { name: null, email: null },
  page: { url: null, title: null },
};

check("web prompt is the same with channel web or unset", () => {
  for (const mode of ["voice", "text"] as const) {
    assert.equal(buildSystemPrompt({ ...base, mode }), buildSystemPrompt({ ...base, mode, channel: "web" }));
  }
});

check("phone prompt", () => {
  const p = buildSystemPrompt({ ...base, channel: "phone", visitor: { name: null, email: null, phone: "+14155550100" } });
  assert.match(p, /You answer phone calls to Example Co's number/);
  assert.match(p, /\+14155550100/);
  assert.doesNotMatch(p, /chat box under the microphone/);
  assert.doesNotMatch(p, /website\./);
});

check("whatsapp prompt", () => {
  const p = buildSystemPrompt({ ...base, mode: "text", channel: "whatsapp", visitor: { name: null, email: null, phone: "+923001234567" } });
  assert.match(p, /on WhatsApp/);
  assert.match(p, /\+923001234567/);
  assert.doesNotMatch(p, /confirm_message/);
  assert.doesNotMatch(p, /end_call/);
  assert.doesNotMatch(p, /small widget/);
});

console.log(`channels checks: ${passed} passed`);
