import "server-only";
import { emailOnConversationEnded, emailOnHandoff } from "./email/notify";
import { webhooksOnConversationEnded, webhooksOnHandoff } from "./webhooks/dispatch";

// Things that happened in a conversation, fanned out to every side effect (emails, webhooks).
// Called from after() in the internal routes, so the voice agent never waits for them.
// Each side effect handles its own errors; one failing never stops the others.

async function fanOut(label: string, tasks: Promise<unknown>[]): Promise<void> {
  const results = await Promise.allSettled(tasks);
  for (const r of results) if (r.status === "rejected") console.error(`${label} side effect failed`, r.reason);
}

/** A visitor left a message for the team (`created`) or corrected/added details to an open one. */
export function handoffSaved(handoffId: string, created: boolean): Promise<void> {
  return fanOut("handoffSaved", [emailOnHandoff(handoffId, created), webhooksOnHandoff(handoffId, created)]);
}

/** A conversation ended and its summary step has run (the summary may still be null). */
export function conversationEnded(conversationId: string): Promise<void> {
  return fanOut("conversationEnded", [
    emailOnConversationEnded(conversationId),
    webhooksOnConversationEnded(conversationId),
  ]);
}
