import "server-only";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { ActionParameter } from "@talkfront/shared";
import { db } from "@/db";
import { agentActions, agents, conversations, messages } from "@/db/schema";
import { parametersToJsonSchema, RESERVED_ACTION_NAMES } from "@/lib/actions/schema";
import { runAction } from "@/lib/actions/runner";
import { llmProvider } from "@/lib/agent-defaults";
import { readCollectFields } from "@/lib/collect";
import { saveHandoff } from "@/lib/handoff";
import { searchKnowledge, type SearchResult } from "@/lib/knowledge/search";
import { buildSystemPrompt } from "@/lib/prompt";
import { rateLimit } from "@/lib/rate-limit";

// One agent turn run by the web app, for channels with no live worker (WhatsApp). The same agent as the
// widget: the same prompt builder, knowledge looked up for every message (as the voice agent does), the
// same take-a-message flow and the business's own actions as tools. One model call answers, plus a few
// more when the model uses a tool.

type AgentRow = typeof agents.$inferSelect;

export type TurnConversation = {
  id: string;
  organizationId: string;
  agentId: string;
  visitorName: string | null;
  visitorEmail: string | null;
};

export type TurnResult = {
  reply: string;
  /** Messages for the team saved in this turn; the caller fans out emails and webhooks. */
  handoffs: { handoffId: string; created: boolean }[];
};

const HISTORY_MESSAGES = 30;
const MAX_TOOL_ROUNDS = 4;
const SEARCH_LIMIT = 3;
const RESULT_CONTENT_CHARS = 600;
const LLM_TIMEOUT_MS = 25_000;
const ACTIONS_PER_MINUTE = 20;
const AUTO_KNOWLEDGE_NOTE =
  "Knowledge base results for the visitor's next message. The search is already done: answer from " +
  "these. Call search_knowledge only if they clearly don't cover the question, and then with " +
  "different, more specific words. Never guess.\n\n";
const ANSWER_LANGUAGE_NOTE = "(Answer in the language of the visitor's last message, translating this if needed.)";
const NOTHING_FOUND = "No matching information was found in the knowledge base for this question. Do not guess: tell the visitor you don't have that information";
export const FALLBACK_REPLY = "Sorry, I can't answer right now. Please try again in a few minutes.";

type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };
type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };
type ToolDef = { type: "function"; function: { name: string; description: string; parameters: Record<string, unknown> } };

export function formatResults(results: SearchResult[]): string {
  return results
    .map((r, i) => {
      const title = r.title.trim() || "Untitled";
      const header = `[${i + 1}] ${title}${r.url ? ` (${r.url})` : ""}`;
      let content = r.content.split(/\s+/).join(" ");
      if (content.length > RESULT_CONTENT_CHARS) content = `${content.slice(0, RESULT_CONTENT_CHARS - 1)}…`;
      return `${header}\n${content}`;
    })
    .join("\n\n");
}

async function knowledgeFor(scope: { organizationId: string; agentId: string }, query: string): Promise<string | null> {
  const results = await searchKnowledge(scope, query.slice(0, 500), SEARCH_LIMIT);
  return results.length ? `${formatResults(results)}\n\n${ANSWER_LANGUAGE_NOTE}` : null;
}

/** Same short line per tool call as the voice agent's transcript (transcript.py describe_tool_call). */
function describeToolCall(name: string, args: string, output: string, isError: boolean): string {
  const short = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
  return `${name} ${short(args || "{}", 200)} -> ${isError ? "error" : "ok"}: ${short(output.replace(/\s+/g, " "), 300)}`;
}

// ------------------------------------------------------------------------------------------- models

type Provider = { name: string; url: string; key: string; model: string; extra?: Record<string, unknown> };

/** The agent's own model when it runs on an OpenAI-compatible API, then the backups whose key is set. */
function providersFor(agent: AgentRow): Provider[] {
  const out: Provider[] = [];
  const groq = process.env.GROQ_API_KEY;
  const openai = process.env.OPENAI_API_KEY;
  const groqExtra = (model: string) =>
    model.startsWith("openai/gpt-oss") ? { reasoning_effort: "low" } : model.startsWith("qwen/") ? { reasoning_effort: "none" } : {};
  const provider = llmProvider(agent.llmModel);
  if (provider === "groq" && groq) {
    out.push({ name: "groq", url: "https://api.groq.com/openai/v1/chat/completions", key: groq, model: agent.llmModel, extra: groqExtra(agent.llmModel) });
  }
  if (provider === "openai" && openai) {
    out.push({ name: "openai", url: "https://api.openai.com/v1/chat/completions", key: openai, model: agent.llmModel });
  }
  // Claude models: the web app has no tool-calling client for them yet, so the backups answer.
  if (openai && !out.some((p) => p.model === "gpt-4o-mini")) {
    out.push({ name: "openai", url: "https://api.openai.com/v1/chat/completions", key: openai, model: "gpt-4o-mini" });
  }
  if (groq && !out.some((p) => p.model === "openai/gpt-oss-20b")) {
    out.push({ name: "groq", url: "https://api.groq.com/openai/v1/chat/completions", key: groq, model: "openai/gpt-oss-20b", extra: groqExtra("openai/gpt-oss-20b") });
  }
  return out;
}

async function complete(
  providers: Provider[],
  body: { messages: ChatMessage[]; tools: ToolDef[]; temperature: number },
): Promise<{ content: string | null; toolCalls: ToolCall[] }> {
  let lastError = "no model configured (set OPENAI_API_KEY or GROQ_API_KEY on the web app)";
  for (const p of providers) {
    try {
      const res = await fetch(p.url, {
        method: "POST",
        headers: { Authorization: `Bearer ${p.key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: p.model,
          messages: body.messages,
          ...(body.tools.length ? { tools: body.tools, tool_choice: "auto" } : {}),
          temperature: body.temperature,
          max_completion_tokens: 1024,
          ...p.extra,
        }),
        signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
      });
      if (!res.ok) {
        lastError = `${p.name} ${p.model} HTTP ${res.status}`;
        continue;
      }
      const data = (await res.json()) as { choices?: { message?: { content?: string | null; tool_calls?: ToolCall[] } }[] };
      const msg = data.choices?.[0]?.message;
      return { content: msg?.content?.trim() || null, toolCalls: Array.isArray(msg?.tool_calls) ? msg.tool_calls : [] };
    } catch (e) {
      lastError = `${p.name} ${p.model} ${e instanceof Error ? e.name : "error"}`;
    }
  }
  throw new Error(`no model answered: ${lastError}`);
}

// ------------------------------------------------------------------------------------------- the turn

/**
 * Answers the visitor's latest message (already saved in `messages`). Saves the tool rows and the reply.
 * `visitorPhone` is how the visitor reaches us (WhatsApp number). Throws when no model answers; the
 * caller sends FALLBACK_REPLY then.
 */
export async function runTextTurn(input: {
  conversation: TurnConversation;
  agent: AgentRow;
  businessName: string;
  channel: "whatsapp";
  visitorPhone: string;
  latestText: string;
}): Promise<TurnResult> {
  const { conversation: c, agent: a } = input;
  const scope = { organizationId: c.organizationId, agentId: a.id };

  const actionRows = await db
    .select()
    .from(agentActions)
    .where(and(eq(agentActions.agentId, a.id), eq(agentActions.organizationId, c.organizationId), eq(agentActions.enabled, true)))
    .orderBy(asc(agentActions.createdAt));
  const reserved: readonly string[] = RESERVED_ACTION_NAMES;
  const actions = actionRows.filter((r) => !reserved.includes(r.name));

  const system = buildSystemPrompt({
    businessName: input.businessName,
    agentName: a.name,
    persona: a.persona,
    instructions: a.instructions,
    language: a.language,
    mode: "text",
    channel: input.channel,
    handoffEnabled: a.handoffEnabled,
    visitor: { name: c.visitorName, email: c.visitorEmail, phone: input.visitorPhone, verified: false, attributes: {} },
    page: { url: null, title: null },
    actions: actions.map((x) => ({ name: x.name, description: x.description })),
    ask: readCollectFields(a.collectFields)
      .filter((f) => f.ask)
      .map((f) => ({ label: f.label, description: f.description, options: f.options })),
  });

  const history = (
    await db
      .select({ role: messages.role, content: messages.content })
      .from(messages)
      .where(and(eq(messages.conversationId, c.id), inArray(messages.role, ["user", "assistant"])))
      .orderBy(desc(messages.createdAt))
      .limit(HISTORY_MESSAGES)
  ).reverse();

  const tools: ToolDef[] = [
    {
      type: "function",
      function: {
        name: "search_knowledge",
        description:
          "Search this business's knowledge base (help articles, policies, product info). Results for each visitor message are attached automatically; call this when they are missing or don't cover the question, with a more specific query.",
        parameters: { type: "object", properties: { query: { type: "string", description: "A short search query in the visitor's language." } }, required: ["query"] },
      },
    },
  ];
  if (a.handoffEnabled) {
    tools.push({
      type: "function",
      function: {
        name: "request_human",
        description:
          "Send a message to the team. Only after the visitor confirmed the details you wrote back to them. If they correct something later, call it again with the corrected details.",
        parameters: {
          type: "object",
          properties: {
            message: { type: "string", description: "What the visitor needs, written for the teammate." },
            name: { type: "string", description: "The visitor's name, if known." },
            email: { type: "string", description: "The visitor's email address, if they gave one." },
            phone: { type: "string", description: "The best phone number to reach them on." },
          },
          required: ["message"],
        },
      },
    });
  }
  for (const x of actions) {
    tools.push({
      type: "function",
      function: { name: x.name, description: x.description, parameters: parametersToJsonSchema(x.parameters as ActionParameter[]) },
    });
  }

  const chat: ChatMessage[] = [{ role: "system", content: system }];
  history.forEach((m, i) => {
    // Knowledge for the latest message goes just before it, as the voice agent does.
    if (i === history.length - 1 && m.role === "user") {
      chat.push({ role: "system", content: "__KNOWLEDGE__" });
    }
    chat.push(m.role === "user" ? { role: "user", content: m.content } : { role: "assistant", content: m.content });
  });
  const noteAt = chat.findIndex((m) => m.role === "system" && m.content === "__KNOWLEDGE__");
  const found = await knowledgeFor(scope, input.latestText).catch((e) => {
    console.warn("whatsapp knowledge search failed", e instanceof Error ? e.message : e);
    return null;
  });
  if (noteAt >= 0) {
    if (found) chat[noteAt] = { role: "system", content: AUTO_KNOWLEDGE_NOTE + found };
    else chat.splice(noteAt, 1);
  }

  const providers = providersFor(a);
  const toolRows: { content: string; createdAt: Date }[] = [];
  const handoffs: TurnResult["handoffs"] = [];
  let reply: string | null = null;

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    const last = round === MAX_TOOL_ROUNDS;
    const out = await complete(providers, { messages: chat, tools: last ? [] : tools, temperature: a.temperature });
    if (!out.toolCalls.length || last) {
      reply = out.content;
      break;
    }
    chat.push({ role: "assistant", content: out.content, tool_calls: out.toolCalls });
    for (const call of out.toolCalls) {
      const { output, isError } = await runTool(call, { conversation: c, agent: a, actions, handoffs, scope });
      chat.push({ role: "tool", tool_call_id: call.id, content: output });
      toolRows.push({ content: describeToolCall(call.function.name, call.function.arguments, output, isError), createdAt: new Date() });
    }
  }

  const finalReply = reply?.trim() || FALLBACK_REPLY;
  await db.insert(messages).values([
    ...toolRows.map((t) => ({ conversationId: c.id, role: "tool" as const, content: t.content.slice(0, 20_000), createdAt: t.createdAt })),
    { conversationId: c.id, role: "assistant" as const, content: finalReply.slice(0, 20_000), createdAt: new Date() },
  ]);
  return { reply: finalReply, handoffs };
}

async function runTool(
  call: ToolCall,
  ctx: {
    conversation: TurnConversation;
    agent: AgentRow;
    actions: (typeof agentActions.$inferSelect)[];
    handoffs: TurnResult["handoffs"];
    scope: { organizationId: string; agentId: string };
  },
): Promise<{ output: string; isError: boolean }> {
  let args: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(call.function.arguments || "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) args = parsed as Record<string, unknown>;
  } catch {
    return { output: "The arguments were not valid JSON. Try again.", isError: true };
  }
  const name = call.function.name;
  const str = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined);

  if (name === "search_knowledge") {
    const query = str(args.query, 500);
    if (!query) return { output: "The search query was empty. Ask the visitor what they are looking for.", isError: true };
    const found = await knowledgeFor(ctx.scope, query).catch(() => null);
    return { output: found ?? NOTHING_FOUND, isError: false };
  }

  if (name === "request_human" && ctx.agent.handoffEnabled) {
    const message = str(args.message, 4000);
    if (!message) return { output: "Ask the visitor what they need help with, then call request_human again with that as the message.", isError: true };
    const saved = await saveHandoff(ctx.conversation.id, {
      message,
      name: str(args.name, 200),
      email: str(args.email, 320),
      phone: str(args.phone, 50),
    });
    if (!saved) return { output: "The message could not be sent right now. Apologise and ask the visitor to try again later.", isError: true };
    ctx.handoffs.push(saved);
    return {
      output: "Sent: the team has the message. Tell the visitor briefly that the team will get back to them. Don't promise when or how.",
      isError: false,
    };
  }

  const action = ctx.actions.find((x) => x.name === name);
  if (!action) return { output: `There is no tool called ${name}.`, isError: true };
  const limit = rateLimit(`action:${ctx.conversation.id}`, ACTIONS_PER_MINUTE, 60_000);
  if (!limit.ok) return { output: "Too many actions in a short time, so this one was not run.", isError: true };
  const [conv] = await db
    .select({ status: conversations.status })
    .from(conversations)
    .where(eq(conversations.id, ctx.conversation.id))
    .limit(1);
  if (conv?.status !== "active") return { output: "This conversation has ended.", isError: true };
  const run = await runAction(action, args, { conversationId: ctx.conversation.id, verifiedVisitorId: null });
  console.info(`action ${action.id} (${action.name}) -> ${run.ok ? "ok" : "failed"} ${run.status ?? "-"} in ${run.durationMs} ms`);
  return { output: run.result, isError: !run.ok };
}
