import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { CollectedData, CollectField } from "@talkfront/shared";
import { db } from "@/db";
import { agents, conversations, handoffRequests, messages, organization } from "@/db/schema";
import { coerceCollected, COLLECT_TYPE_LABELS, readCollectFields } from "./collect";

const ANTHROPIC_SUMMARY_MODEL = "claude-haiku-5-5";
// Not the gpt-oss-20b live calls use first: each Groq model has its own rate limit, so summaries
// don't eat into the budget of conversations that are still going.
const GROQ_SUMMARY_MODEL = "openai/gpt-oss-120b";
/** Used once when the main model is rate limited (or returns broken JSON). */
const GROQ_FALLBACK_MODEL = "qwen/qwen3.8-27b";

// Free Groq keys allow 8,000 tokens a minute per model, so the Groq transcript stays near 5,000 tokens.
// Long chats keep their start (names, the request) and their end (the outcome).
// Groq free tier allows 8k tokens a minute per model, so its transcripts are cut shorter.
const MAX_TRANSCRIPT_CHARS = { anthropic: 60_000, openai: 60_000, groq: 20_000 };
const OPENAI_SUMMARY_MODEL = "gpt-4.1-mini";

/** One line, no control characters: business-written text must not change the prompt's layout. */
const oneLine = (v: string, max: number) => v.replace(/[\u0000-\u001f\u007f\s]+/g, " ").trim().slice(0, max);

const BUILT_IN_LINES = [
  `- visitor_name (text): the visitor's name, as they gave it.`,
  `- email (email): the visitor's email address.`,
  `- phone (phone): the visitor's phone number, with the country code if they gave one.`,
  `- topic (text): what the visitor wanted, in a few words, e.g. "table booking" or "refund for an order".`,
  `- outcome: "answered" (the agent answered what they asked), "message_taken" (a message was left for the team), "not_answered" (the agent couldn't help and no message was left) or "other".`,
  `- follow_up_needed (yes or no): true if the team needs to do something for the visitor, false if not.`,
  `- sentiment: "positive", "neutral" or "negative": how the visitor seemed by the end.`,
];

function fieldLine(f: CollectField): string {
  const type = f.type === "choice" ? `choice: ${(f.options ?? []).map((o) => JSON.stringify(oneLine(o, 60))).join(", ")}` : COLLECT_TYPE_LABELS[f.type].toLowerCase();
  const about = oneLine(f.description, 300) || oneLine(f.label, 60);
  return `- ${f.key} (${type}): ${about}`;
}

function systemPrompt(businessName: string, fields: CollectField[], day: string): string {
  return [
    `You read a support conversation between a visitor and the virtual agent on ${oneLine(businessName, 200)}'s website, and write down what happened for the team.`,
    `Reply with one JSON object and nothing else, in this shape: {"summary": "...", "data": {...}}`,
    `summary: two to four plain sentences: what the visitor wanted, what they were told, and any follow-up the team should do. No markdown.`,
    `data: exactly these keys:\n${[...BUILT_IN_LINES, ...fields.map(fieldLine)].join("\n")}`,
    [
      "Rules:",
      "- Use only what was actually said in this conversation. If something was not said, use null. Never guess, and never copy the examples above.",
      "- Write in English, translating if needed. Keep names, emails, phone numbers and other details exactly as given; if the visitor corrected one, use the corrected version.",
      `- text: short plain text. number: a JSON number. yes or no: true or false. date: YYYY-MM-DD when a full date was given or can be worked out exactly (the conversation was on ${day}); otherwise the visitor's own words. choice: exactly one of the listed values, or null.`,
    ].join("\n"),
  ].join("\n\n");
}

/** First and last parts of a long transcript, with a marker where the middle was left out. */
function clip(transcript: string, max: number): string {
  if (transcript.length <= max) return transcript;
  const head = Math.floor(max * 0.3);
  return `${transcript.slice(0, head)}\n[... middle of the conversation left out ...]\n${transcript.slice(-(max - head))}`;
}

/**
 * After a conversation ends: writes the summary and the collected information (built-in fields plus
 * the agent's own) in one model call. Uses Anthropic when ANTHROPIC_API_KEY is set, otherwise Groq
 * when GROQ_API_KEY is set; no-op without either key or without messages. Never throws.
 */
export async function summarizeConversation(conversationId: string): Promise<void> {
  // OpenAI first when set: no tight rate limit, so summaries never compete with live calls on Groq.
  const provider = process.env.ANTHROPIC_API_KEY
    ? "anthropic"
    : process.env.OPENAI_API_KEY
      ? "openai"
      : process.env.GROQ_API_KEY
        ? "groq"
        : null;
  if (!provider) return;
  try {
    const [row] = await db
      .select({
        startedAt: conversations.startedAt,
        visitorName: conversations.visitorName,
        visitorEmail: conversations.visitorEmail,
        visitorVerified: conversations.visitorVerified,
        handoffRequested: conversations.handoffRequested,
        collectFields: agents.collectFields,
        businessName: organization.name,
      })
      .from(conversations)
      .innerJoin(agents, eq(agents.id, conversations.agentId))
      .innerJoin(organization, eq(organization.id, conversations.organizationId))
      .where(eq(conversations.id, conversationId))
      .limit(1);
    if (!row) return;

    const rows = await db
      .select({ role: messages.role, content: messages.content })
      .from(messages)
      .where(and(eq(messages.conversationId, conversationId), inArray(messages.role, ["user", "assistant"])))
      .orderBy(asc(messages.createdAt));
    if (rows.length === 0) return;

    const [handoff] = await db
      .select({ name: handoffRequests.name, email: handoffRequests.email, phone: handoffRequests.phone, message: handoffRequests.message })
      .from(handoffRequests)
      .where(eq(handoffRequests.conversationId, conversationId))
      .orderBy(desc(handoffRequests.createdAt))
      .limit(1);

    const fields = readCollectFields(row.collectFields);
    const day = row.startedAt.toISOString().slice(0, 10);
    const transcript = clip(
      rows.map((m) => `${m.role === "user" ? "Visitor" : "Agent"}: ${m.content}`).join("\n"),
      MAX_TRANSCRIPT_CHARS[provider],
    );
    let user = `<transcript>\n${transcript}\n</transcript>`;
    if (handoff) {
      // The details the visitor confirmed for the team: spelled and read back, so the most reliable.
      const parts = [
        handoff.name && `name: ${oneLine(handoff.name, 200)}`,
        handoff.email && `email: ${oneLine(handoff.email, 320)}`,
        handoff.phone && `phone: ${oneLine(handoff.phone, 50)}`,
        `message: ${oneLine(handoff.message, 1000)}`,
      ].filter(Boolean);
      user += `\n<message_left_for_team>\n${parts.join("\n")}\n</message_left_for_team>`;
    } else {
      user += "\nNo message was left for the team in this conversation.";
    }

    const system = systemPrompt(row.businessName, fields, day);
    const raw =
      provider === "anthropic"
        ? await viaAnthropic(system, user)
        : provider === "openai"
          ? await viaOpenAI(system, user).catch((err: unknown) => {
              // Groq as the backup when OpenAI is down or out of credit.
              if (!process.env.GROQ_API_KEY) throw err;
              console.warn("summary: OpenAI failed, trying Groq", err instanceof Error ? err.message : err);
              return viaGroq(system, clip(user, MAX_TRANSCRIPT_CHARS.groq));
            })
          : await viaGroq(system, user);
    const parsed = parseJsonObject(raw);
    if (!parsed) {
      console.error("summary failed: the model did not return JSON");
      return;
    }

    const summary = typeof parsed.summary === "string" ? parsed.summary.replace(/\s+/g, " ").trim().slice(0, 2000) : "";
    const collected: CollectedData = coerceCollected(parsed.data, fields);
    // Fill empty visitor details from what they said. They stay unverified; a verified visitor's
    // details come from the identity token only.
    const fill = !row.visitorVerified;
    await db
      .update(conversations)
      .set({
        ...(summary ? { summary } : {}),
        collectedData: collected,
        ...(fill && !row.visitorName && collected.visitor_name ? { visitorName: collected.visitor_name } : {}),
        ...(fill && !row.visitorEmail && collected.email ? { visitorEmail: collected.email } : {}),
      })
      .where(eq(conversations.id, conversationId));
  } catch (err) {
    if (err instanceof Anthropic.APIError) console.error("summary failed", err.status, err.message);
    else console.error("summary failed", err instanceof Error ? err.message : err);
  }
}

/** The JSON object in a model reply (tolerates code fences or a stray sentence around it). */
function parseJsonObject(text: string): Record<string, unknown> | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const v: unknown = JSON.parse(text.slice(start, end + 1));
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

async function viaAnthropic(system: string, user: string): Promise<string> {
  const response = await new Anthropic().messages.create({
    model: ANTHROPIC_SUMMARY_MODEL,
    max_tokens: 2048,
    output_config: { effort: "low" },
    system,
    messages: [{ role: "user", content: user }],
  });
  return response.content
    .flatMap((b) => (b.type === "text" ? [b.text] : []))
    .join("")
    .trim();
}

class GroqError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
  ) {
    super(`Groq summary request failed with status ${status}${code ? ` (${code})` : ""}`);
  }
}

async function groqJson(model: string, reasoningEffort: string, system: string, user: string): Promise<string> {
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      reasoning_effort: reasoningEffort,
      response_format: { type: "json_object" },
      max_completion_tokens: 2048,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { code?: unknown } } | null;
    const code = typeof body?.error?.code === "string" ? body.error.code : null;
    throw new GroqError(res.status, code);
  }
  const data = (await res.json()) as { choices?: { message?: { content?: string | null } }[] };
  return data.choices?.[0]?.message?.content?.trim() ?? "";
}

async function viaOpenAI(system: string, user: string): Promise<string> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: OPENAI_SUMMARY_MODEL,
      response_format: { type: "json_object" },
      max_completion_tokens: 2048,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { code?: unknown } } | null;
    throw new Error(`OpenAI summary request failed with status ${res.status} (${String(body?.error?.code ?? "")})`);
  }
  const data = (await res.json()) as { choices?: { message?: { content?: string | null } }[] };
  return data.choices?.[0]?.message?.content?.trim() ?? "";
}

async function viaGroq(system: string, user: string): Promise<string> {
  try {
    return await groqJson(GROQ_SUMMARY_MODEL, "low", system, user);
  } catch (err) {
    const retry = err instanceof GroqError && (err.status === 429 || err.code === "json_validate_failed");
    if (!retry) throw err;
    console.warn(`summary: ${err.message}, trying ${GROQ_FALLBACK_MODEL}`);
    // Qwen on Groq takes "none" to skip its thinking, which would otherwise spend the token budget.
    return groqJson(GROQ_FALLBACK_MODEL, "none", system, user);
  }
}
