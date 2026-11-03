import "server-only";
import { and, asc, eq } from "drizzle-orm";
import type { ActionParameter } from "@talkfront/shared";
import { db } from "@/db";
import { agentActions } from "@/db/schema";
import { openHeaders } from "@/lib/actions/runner";

/** What the dashboard may show about an action: header names, never their values. */
export type ActionView = {
  id: string;
  name: string;
  description: string;
  method: "GET" | "POST";
  url: string;
  enabled: boolean;
  timeoutMs: number;
  parameters: ActionParameter[];
  headerNames: string[];
  /** The saved headers could not be decrypted (BETTER_AUTH_SECRET changed): they must be entered again. */
  headersUnreadable: boolean;
};

export async function loadActionViews(organizationId: string, agentId: string): Promise<ActionView[]> {
  const rows = await db
    .select()
    .from(agentActions)
    .where(and(eq(agentActions.agentId, agentId), eq(agentActions.organizationId, organizationId)))
    .orderBy(asc(agentActions.createdAt));
  return rows.map((r) => {
    let headerNames: string[] = [];
    let headersUnreadable = false;
    try {
      headerNames = Object.keys(openHeaders(r));
    } catch {
      headersUnreadable = true;
    }
    return {
      id: r.id,
      name: r.name,
      description: r.description,
      method: r.method,
      url: r.url,
      enabled: r.enabled,
      timeoutMs: r.timeoutMs,
      parameters: (r.parameters ?? []) as ActionParameter[],
      headerNames,
      headersUnreadable,
    };
  });
}
