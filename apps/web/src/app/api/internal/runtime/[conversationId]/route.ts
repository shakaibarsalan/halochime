import { and, asc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import type { ActionParameter, RuntimeConfig } from "@talkfront/shared";
import { db } from "@/db";
import { agentActions, conversationHelpOffers, voiceClones } from "@/db/schema";
import { parametersToJsonSchema, RESERVED_ACTION_NAMES } from "@/lib/actions/schema";
import { llmProvider, REALTIME_MODEL } from "@/lib/agent-defaults";
import { loadIntegrationTools } from "@/lib/integrations/store";
import { readCollectFields } from "@/lib/collect";
import { getConversationWithAgent } from "@/lib/conversations";
import { apiError } from "@/lib/http";
import { checkInternalAuth } from "@/lib/internal-auth";
import { sttLanguage } from "@/lib/languages";
import { buildSystemPrompt, helpOpener } from "@/lib/prompt";
import { cloneIdOf, runtimeVoice, speaksManyLanguages } from "@/lib/voices";
import { conversationSnapshot } from "@/lib/versions/server";
import { applySnapshot } from "@/lib/versions/snapshot";
import { loadPageHelp } from "@/lib/widget/page-help";

export async function GET(req: Request, ctx: { params: Promise<{ conversationId: string }> }) {
  const denied = checkInternalAuth(req);
  if (denied) return denied;
  const { conversationId } = await ctx.params;

  const row = await getConversationWithAgent(conversationId);
  if (!row) return apiError(404, "not_found", "Conversation not found.");
  const { conversation: c, businessName } = row;
  // A conversation picked for an A/B test runs with that version's greeting, persona, rules,
  // language, voice and models; everything else (actions, limits, handoff) is the agent's own.
  const snapshot = await conversationSnapshot(c.agentVersionId, row.agent);
  const a = snapshot ? applySnapshot(row.agent, snapshot) : row.agent;

  // Only what the model needs: never the URL or headers (the web app makes the call).
  const actionRows = await db
    .select({ id: agentActions.id, name: agentActions.name, description: agentActions.description, parameters: agentActions.parameters })
    .from(agentActions)
    .where(and(eq(agentActions.agentId, a.id), eq(agentActions.organizationId, c.organizationId), eq(agentActions.enabled, true)))
    .orderBy(asc(agentActions.createdAt));
  const reserved: readonly string[] = RESERVED_ACTION_NAMES;
  const businessActions = actionRows
    .filter((r) => !reserved.includes(r.name))
    .map((r) => ({ id: r.id, name: r.name, description: r.description, parameters: parametersToJsonSchema(r.parameters as ActionParameter[]) }));
  // Connected integrations (CRM, calendar, database) as extra tools with "int:" ids. The business's own
  // actions keep their names; an integration tool with a clashing name is left out. Never throws.
  const integrationTools = await loadIntegrationTools(c.organizationId, a.id, businessActions.map((x) => x.name));
  const actions = [...businessActions, ...integrationTools];
  const verified = c.visitorVerified;
  const [pageHelp, [offer]] = await Promise.all([
    loadPageHelp(a.id),
    db
      .select({ reason: conversationHelpOffers.reason, message: conversationHelpOffers.message })
      .from(conversationHelpOffers)
      .where(and(eq(conversationHelpOffers.conversationId, c.id), eq(conversationHelpOffers.organizationId, c.organizationId)))
      .limit(1),
  ]);
  const helpOffer = offer ? { reason: offer.reason, message: offer.message } : null;

  // A cloned brand voice is looked up in the agent's own workspace; a deleted one means the default voice.
  const cloneId = cloneIdOf(a.ttsVoice);
  const [clone] = cloneId
    ? await db
        .select({ providerVoiceId: voiceClones.providerVoiceId })
        .from(voiceClones)
        .where(and(eq(voiceClones.id, cloneId), eq(voiceClones.organizationId, c.organizationId)))
        .limit(1)
    : [];
  const voice = runtimeVoice(a.ttsVoice, a.language, clone ?? null);

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
        // ElevenLabs, Cartesia and cloned voices speak many languages, like the realtime ones.
        voiceEngine: speaksManyLanguages(a.ttsVoice) ? "realtime" : "classic",
        handoffEnabled: a.handoffEnabled,
        // Phone calls (LiveKit SIP) get the phone prompt; widget conversations get exactly the old one.
        ...(c.channel === "phone" ? { channel: "phone" as const } : {}),
        visitor: {
          ...(c.channel === "phone" ? { phone: c.visitorId } : {}),
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
        pageGuide: pageHelp.pageGuide,
        helpOffer,
      }),
      stt: { provider: "deepgram", model: a.sttModel, language: sttLanguage(a.language) },
      llm: { provider: llmProvider(a.llmModel), model: a.llmModel, temperature: a.temperature },
      tts: { provider: "deepgram", voice: voice.deepgramVoice },
      voice: {
        engine: voice.engine,
        realtimeModel: REALTIME_MODEL,
        realtimeVoice: voice.realtimeVoice,
        ...(voice.providerVoice ? { providerVoice: voice.providerVoice } : {}),
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
    ...(pageHelp.pageGuide ? { pageGuide: true } : {}),
    ...(helpOffer ? { helpOffer: { ...helpOffer, opener: helpOpener(a.name, helpOffer) } } : {}),
  };
  return NextResponse.json(body);
}
