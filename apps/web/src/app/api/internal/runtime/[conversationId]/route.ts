import { and, asc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import type { ActionParameter, RuntimeConfig } from "@talkfront/shared";
import { db } from "@/db";
import { agentActions } from "@/db/schema";
import { parametersToJsonSchema, RESERVED_ACTION_NAMES } from "@/lib/actions/schema";
import { llmProvider, REALTIME_MODEL, realtimeVoiceName, voiceEngine } from "@/lib/agent-defaults";
import { readCollectFields } from "@/lib/collect";
import { getConversationWithAgent } from "@/lib/conversations";
import { apiError } from "@/lib/http";
import { checkInternalAuth } from "@/lib/internal-auth";
import { sttLanguage } from "@/lib/languages";
import { buildSystemPrompt } from "@/lib/prompt";

export async function GET(req: Request, ctx: { params: Promise<{ conversationId: string }> }) {
  const denied = checkInternalAuth(req);
  if (denied) return denied;
  const { conversationId } = await ctx.params;

  const row = await getConversationWithAgent(conversationId);
  if (!row) return apiError(404, "not_found", "Conversation not found.");
  const { conversation: c, agent: a, businessName } = row;

  // Only what the model needs: never the URL or headers (the web app makes the call).
  const actionRows = await db
    .select({ id: agentActions.id, name: agentActions.name, description: agentActions.description, parameters: agentActions.parameters })
    .from(agentActions)
    .where(and(eq(agentActions.agentId, a.id), eq(agentActions.organizationId, c.organizationId), eq(agentActions.enabled, true)))
    .orderBy(asc(agentActions.createdAt));
  const reserved: readonly string[] = RESERVED_ACTION_NAMES;
  const actions = actionRows
    .filter((r) => !reserved.includes(r.name))
    .map((r) => ({ id: r.id, name: r.name, description: r.description, parameters: parametersToJsonSchema(r.parameters as ActionParameter[]) }));
  const verified = c.visitorVerified;

  const body: RuntimeConfig = {
    conversationId: c.id,
    mode: c.mode,
    agent: {
      id: a.id,
      name: a.name,
      greeting: a.greeting,
      systemPrompt: buildSystemPrompt({
        businessName,
        agentName: a.name,
        persona: a.persona,
        instructions: a.instructions,
        language: a.language,
        mode: c.mode,
        voiceEngine: voiceEngine(a.ttsVoice),
        handoffEnabled: a.handoffEnabled,
        visitor: {
          name: c.visitorName,
          email: c.visitorEmail,
          verified,
          attributes: verified ? (c.visitorAttributes ?? {}) : {},
        },
        page: { url: c.pageUrl, title: c.pageTitle },
        actions: actions.map((x) => ({ name: x.name, description: x.description })),
        ask: readCollectFields(a.collectFields)
          .filter((f) => f.ask)
          .map((f) => ({ label: f.label, description: f.description, options: f.options })),
      }),
      stt: { provider: "deepgram", model: a.sttModel, language: sttLanguage(a.language) },
      llm: { provider: llmProvider(a.llmModel), model: a.llmModel, temperature: a.temperature },
      tts: { provider: "deepgram", voice: voiceEngine(a.ttsVoice) === "classic" ? a.ttsVoice : "aura-2-thalia-en" },
      voice: {
        engine: voiceEngine(a.ttsVoice),
        realtimeModel: REALTIME_MODEL,
        realtimeVoice: voiceEngine(a.ttsVoice) === "realtime" ? realtimeVoiceName(a.ttsVoice) : "marin",
        vocabulary: [...new Set([businessName, a.name].map((w) => w.trim().slice(0, 60)).filter(Boolean))],
      },
      maxDurationSec: a.maxDurationSec,
      handoffEnabled: a.handoffEnabled,
    },
    visitor: {
      id: c.visitorId,
      name: c.visitorName,
      email: c.visitorEmail,
      verified,
      attributes: verified ? (c.visitorAttributes ?? {}) : {},
    },
    actions,
  };
  return NextResponse.json(body);
}
