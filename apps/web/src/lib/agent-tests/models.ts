import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { llmProvider } from "@/lib/agent-defaults";
import type { ChatMessage } from "./pipeline";

// Model calls for test runs. The answer uses the agent's own model first and then the same backups
// as the voice worker (apps/agent agent.py FALLBACK_MODELS) whose key is set. The judge uses the
// same provider order as conversation summaries (lib/summary.ts).

type Provider = "anthropic" | "groq" | "openai";

const KEYS: Record<Provider, string> = { anthropic: "ANTHROPIC_API_KEY", groq: "GROQ_API_KEY", openai: "OPENAI_API_KEY" };
const hasKey = (p: Provider) => Boolean(process.env[KEYS[p]]);

const FALLBACKS: [Provider, string][] = [
  ["groq", "openai/gpt-oss-20b"],
  ["groq", "qwen/qwen3.8-27b"],
  ["groq", "openai/gpt-oss-120b"],
  ["openai", "gpt-4o-mini"],
];

const TIMEOUT_MS = 25_000;

/** OpenAI-compatible chat completion (OpenAI and Groq). */
async function openAiCompatible(
  provider: "openai" | "groq",
  model: string,
  messages: ChatMessage[],
  opts: { temperature?: number; json?: boolean; maxTokens: number },
): Promise<string> {
  const url = provider === "groq" ? "https://api.groq.com/openai/v1/chat/completions" : "https://api.openai.com/v1/chat/completions";
  const body: Record<string, unknown> = { model, messages, max_completion_tokens: opts.maxTokens };
  if (provider === "groq") {
    // As the voice worker: gpt-oss reasons briefly, Qwen must not think out loud.
    if (model.startsWith("openai/gpt-oss")) body.reasoning_effort = "low";
    else if (model.startsWith("qwen/")) body.reasoning_effort = "none";
  }
  if (opts.temperature !== undefined) body.temperature = opts.temperature;
  if (opts.json) body.response_format = { type: "json_object" };
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env[KEYS[provider]]}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => null)) as { error?: { code?: unknown } } | null;
    throw new Error(`${provider} returned ${res.status}${typeof err?.error?.code === "string" ? ` (${err.error.code})` : ""}`);
  }
  const data = (await res.json()) as { choices?: { message?: { content?: string | null } }[] };
  return data.choices?.[0]?.message?.content?.trim() ?? "";
}

async function anthropic(model: string, messages: ChatMessage[], opts: { maxTokens: number; lowEffort?: boolean }): Promise<string> {
  // Anthropic takes one system prompt: the knowledge note is added to it, as the agent's plugin does.
  const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const turns = messages.filter((m) => m.role !== "system").map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
  const response = await new Anthropic().messages.create(
    {
      model,
      max_tokens: opts.maxTokens,
      ...(opts.lowEffort ? { output_config: { effort: "low" as const } } : {}),
      system,
      messages: turns,
    },
    { timeout: TIMEOUT_MS, maxRetries: 0 },
  );
  return response.content
    .flatMap((b) => (b.type === "text" ? [b.text] : []))
    .join("")
    .trim();
}

async function call(provider: Provider, model: string, messages: ChatMessage[], opts: { temperature?: number; json?: boolean; maxTokens: number }) {
  return provider === "anthropic"
    ? anthropic(model, messages, { maxTokens: opts.maxTokens, lowEffort: opts.json })
    : openAiCompatible(provider, model, messages, opts);
}

/** Whether any model for answers is available (else the test page says tests need a key). */
export const canAnswer = () => (["groq", "openai", "anthropic"] as Provider[]).some(hasKey);

/**
 * The agent's answer, from its own model, then the backups whose key is set (like the live worker).
 * Returns the model that answered. Throws when every model failed.
 */
export async function answerWithAgentModel(
  agentModel: string,
  temperature: number,
  messages: ChatMessage[],
): Promise<{ text: string; model: string }> {
  const own = llmProvider(agentModel) as Provider;
  const first: [Provider, string] = [own, agentModel];
  const chain = [first, ...FALLBACKS.filter(([, m]) => m !== agentModel)].filter(([p]) => hasKey(p));
  let last: unknown = new Error("No model key is set (GROQ_API_KEY, OPENAI_API_KEY or ANTHROPIC_API_KEY).");
  for (const [provider, model] of chain) {
    try {
      // Newer Claude models take no temperature (the worker drops it too).
      const text = await call(provider, model, messages, { temperature: provider === "anthropic" ? undefined : temperature, maxTokens: 1024 });
      if (text) return { text, model };
      last = new Error(`${model} gave an empty answer`);
    } catch (e) {
      last = e;
      console.warn(`agent test: ${model} failed`, e instanceof Error ? e.message : e);
    }
  }
  throw last instanceof Error ? last : new Error("Every model failed.");
}

const JUDGE_CHAIN: [Provider, string][] = [
  ["anthropic", "claude-haiku-5-5"],
  ["openai", "gpt-4.1-mini"],
  ["groq", "openai/gpt-oss-120b"],
  ["groq", "qwen/qwen3.8-27b"],
];

export const canJudge = () => JUDGE_CHAIN.some(([p]) => hasKey(p));

/** The judge's raw reply (JSON asked for). Throws when every judge model failed. */
export async function judgeReply(system: string, user: string): Promise<string> {
  let last: unknown = new Error("No judge model key is set.");
  for (const [provider, model] of JUDGE_CHAIN.filter(([p]) => hasKey(p))) {
    try {
      const text = await call(
        provider,
        model,
        [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        { json: true, maxTokens: 1024, ...(provider === "anthropic" ? {} : { temperature: 0 }) },
      );
      if (text) return text;
    } catch (e) {
      last = e;
      console.warn(`agent test judge: ${model} failed`, e instanceof Error ? e.message : e);
    }
  }
  throw last instanceof Error ? last : new Error("Every judge model failed.");
}
