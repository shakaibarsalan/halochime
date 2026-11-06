import "server-only";
import { EMBEDDING_DIMENSIONS } from "@talkfront/shared";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { agentActions, agents, agentTestCases, agentTestResults, agentTestRuns, organization } from "@/db/schema";
import { RESERVED_ACTION_NAMES } from "@/lib/actions/schema";
import { voiceEngine } from "@/lib/agent-defaults";
import { readCollectFields } from "@/lib/collect";
import { searchKnowledge } from "@/lib/knowledge/search";
import { buildSystemPrompt } from "@/lib/prompt";
import { applySnapshot, type AgentSnapshot } from "@/lib/versions/snapshot";
import { JUDGE_SYSTEM, judgeUserMessage, parseJudgeReply } from "./judge";
import { answerWithAgentModel, judgeReply } from "./models";
import { AUTO_SEARCH_MIN_CHARS, cleanAnswer, knowledgeNote, SEARCH_LIMIT, turnMessages } from "./pipeline";

type Agent = typeof agents.$inferSelect;

/** Questions answered at the same time. Low, so a run never eats a Groq key's per-minute budget. */
const CONCURRENCY = 3;

/**
 * Optional: the web app can reach the embedder (EMBEDDER_URL, as the voice worker) for semantic
 * search; without it the test searches by words only, like the live agent when the embedder is down.
 */
async function embedQuery(query: string): Promise<number[] | undefined> {
  const base = process.env.EMBEDDER_URL?.replace(/\/+$/, "");
  if (!base) return undefined;
  try {
    const token = process.env.EMBEDDER_TOKEN?.trim();
    const res = await fetch(`${base}/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ texts: [query], kind: "query" }),
      signal: AbortSignal.timeout(2_000),
    });
    if (!res.ok) return undefined;
    const data = (await res.json()) as { vectors?: unknown };
    const v = Array.isArray(data.vectors) ? data.vectors[0] : null;
    return Array.isArray(v) && v.length === EMBEDDING_DIMENSIONS && v.every((x) => typeof x === "number") ? (v as number[]) : undefined;
  } catch {
    return undefined;
  }
}

/** The system prompt the live text agent gets (as the runtime config route builds it), for an anonymous visitor. */
async function systemPromptFor(agent: Agent, businessName: string): Promise<string> {
  const reserved: readonly string[] = RESERVED_ACTION_NAMES;
  const actionRows = await db
    .select({ name: agentActions.name, description: agentActions.description })
    .from(agentActions)
    .where(and(eq(agentActions.agentId, agent.id), eq(agentActions.organizationId, agent.organizationId), eq(agentActions.enabled, true)))
    .orderBy(asc(agentActions.createdAt));
  return buildSystemPrompt({
    businessName,
    agentName: agent.name,
    persona: agent.persona,
    instructions: agent.instructions,
    language: agent.language,
    mode: "text",
    voiceEngine: voiceEngine(agent.ttsVoice),
    handoffEnabled: agent.handoffEnabled,
    visitor: { name: null, email: null, verified: false, attributes: {} },
    page: { url: null, title: null },
    actions: actionRows.filter((r) => !reserved.includes(r.name)),
    ask: readCollectFields(agent.collectFields)
      .filter((f) => f.ask)
      .map((f) => ({ label: f.label, description: f.description, options: f.options })),
  });
}

type CaseRow = typeof agentTestCases.$inferSelect;
type CaseResult = { answer: string; pass: boolean; reason: string; error: string | null; model: string | null };

async function runCase(agent: Agent, systemPrompt: string, c: CaseRow): Promise<CaseResult> {
  let answer: string;
  let model: string;
  try {
    const question = c.question.trim();
    const hits =
      question.length >= AUTO_SEARCH_MIN_CHARS
        ? await searchKnowledge({ organizationId: agent.organizationId, agentId: agent.id }, question, SEARCH_LIMIT, await embedQuery(question)).catch(
            (e: unknown) => {
              console.warn("agent test: knowledge search failed", e instanceof Error ? e.message : e);
              return [];
            },
          )
        : [];
    const reply = await answerWithAgentModel(agent.llmModel, agent.temperature, turnMessages(systemPrompt, knowledgeNote(hits), question));
    answer = cleanAnswer(reply.text);
    model = reply.model;
  } catch (e) {
    return { answer: "", pass: false, reason: "The agent could not answer.", error: errorText(e), model: null };
  }
  try {
    const verdict = parseJudgeReply(await judgeReply(JUDGE_SYSTEM, judgeUserMessage({ question: c.question, mustSay: c.mustSay, mustNotSay: c.mustNotSay, answer })));
    if (!verdict) return { answer, pass: false, reason: "The judge's reply could not be read.", error: "unreadable judge reply", model };
    return { answer, pass: verdict.pass, reason: verdict.reason, error: null, model };
  } catch (e) {
    return { answer, pass: false, reason: "The judge could not be reached.", error: errorText(e), model };
  }
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);

/** Runs `items` through `fn`, at most `limit` at a time, keeping the order of the results. */
async function mapLimited<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/**
 * Runs every test question of the agent (or of one saved version of it) through the real text
 * pipeline, has the judge mark each answer, and stores the results on the run. The run row must
 * exist (status running). Never throws: a broken run is marked failed.
 */
export async function executeRun(runId: string, agent: Agent, version: AgentSnapshot | null): Promise<void> {
  try {
    const subject = version ? applySnapshot(agent, version) : agent;
    const [[org], cases] = await Promise.all([
      db.select({ name: organization.name }).from(organization).where(eq(organization.id, agent.organizationId)).limit(1),
      db
        .select()
        .from(agentTestCases)
        .where(and(eq(agentTestCases.agentId, agent.id), eq(agentTestCases.organizationId, agent.organizationId)))
        .orderBy(asc(agentTestCases.createdAt)),
    ]);
    const systemPrompt = await systemPromptFor(subject, org?.name ?? "the business");
    const results = await mapLimited(cases, CONCURRENCY, (c) => runCase(subject, systemPrompt, c));

    if (results.length > 0) {
      await db.insert(agentTestResults).values(
        results.map((r, i) => ({
          runId,
          caseId: cases[i]!.id,
          question: cases[i]!.question,
          mustSay: cases[i]!.mustSay,
          mustNotSay: cases[i]!.mustNotSay,
          answer: r.answer,
          pass: r.pass,
          reason: r.reason,
          error: r.error,
          position: i,
        })),
      );
    }
    const models = [...new Set(results.map((r) => r.model).filter((m): m is string => Boolean(m)))];
    const allBroken = results.length > 0 && results.every((r) => r.error && !r.answer);
    await db
      .update(agentTestRuns)
      .set({
        status: allBroken ? "failed" : "done",
        total: results.length,
        passed: results.filter((r) => r.pass).length,
        model: models.join(", ").slice(0, 200) || null,
        error: allBroken ? "The agent's model could not be reached." : null,
        finishedAt: new Date(),
      })
      .where(eq(agentTestRuns.id, runId));
  } catch (e) {
    console.error("agent test run failed", e instanceof Error ? e.message : e);
    await db
      .update(agentTestRuns)
      .set({ status: "failed", error: "The run stopped because of an error. Try again.", finishedAt: new Date() })
      .where(eq(agentTestRuns.id, runId))
      .catch(() => undefined);
  }
}
