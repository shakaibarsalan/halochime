// The text agent's turn, rebuilt for test runs. Pure: mirrors apps/agent (agent.py llm_node and
// tools.py format_results) so a test sees the same knowledge note the live agent would.

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };
export type KnowledgeHit = { title: string; url: string | null; content: string };

/** Same values as the agent: tools.py SEARCH_LIMIT / RESULT_CONTENT_CHARS, agent.py AUTO_SEARCH_MIN_CHARS. */
export const SEARCH_LIMIT = 3;
export const RESULT_CONTENT_CHARS = 600;
export const AUTO_SEARCH_MIN_CHARS = 6;

export const AUTO_KNOWLEDGE_NOTE =
  "Knowledge base results for the visitor's next message. The search is already done: answer from " +
  "these. Call search_knowledge only if they clearly don't cover the question, and then with " +
  "different, more specific words. Never guess.\n\n";
export const ANSWER_LANGUAGE_NOTE = "(Answer in the language of the visitor's last message, translating this if needed.)";

/** Numbered results with title, optional URL and trimmed content (tools.py format_results). */
export function formatResults(results: KnowledgeHit[]): string {
  return results
    .map((r, i) => {
      const title = r.title.trim() || "Untitled";
      const header = `[${i + 1}] ${title}${r.url ? ` (${r.url})` : ""}`;
      let content = r.content.split(/\s+/).filter(Boolean).join(" ");
      if (content.length > RESULT_CONTENT_CHARS) content = `${content.slice(0, RESULT_CONTENT_CHARS - 1)}…`;
      return `${header}\n${content}`;
    })
    .join("\n\n");
}

/** The system note put before the visitor's message, or null when nothing was found. */
export function knowledgeNote(results: KnowledgeHit[]): string | null {
  if (results.length === 0) return null;
  return `${AUTO_KNOWLEDGE_NOTE}${formatResults(results)}\n\n${ANSWER_LANGUAGE_NOTE}`;
}

/** System prompt, then the knowledge note (if any), then the question: the order llm_node sends. */
export function turnMessages(systemPrompt: string, note: string | null, question: string): ChatMessage[] {
  return [
    { role: "system", content: systemPrompt },
    ...(note ? [{ role: "system" as const, content: note }] : []),
    { role: "user", content: question },
  ];
}

/** Model answers in tests are shown as written, but trimmed and capped. */
export function cleanAnswer(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/g, "")
    .trim()
    .slice(0, 4000);
}
