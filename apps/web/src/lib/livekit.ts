import "server-only";
import { AGENT_NAME, type DispatchMetadata } from "@talkfront/shared";
import { AccessToken, AgentDispatchClient } from "livekit-server-sdk";
import { randomUrlSafe } from "./ids";

type LivekitEnv = { url: string; apiKey: string; apiSecret: string };

/** Visitor join token for room `tf-<conversationId>`. The agent is sent in by dispatchAgent. */
export async function mintVisitorToken(
  env: LivekitEnv,
  metadata: DispatchMetadata,
): Promise<{ token: string; roomName: string; identity: string }> {
  const roomName = roomNameFor(metadata.conversationId);
  const identity = `visitor-${randomUrlSafe(12)}`;
  const at = new AccessToken(env.apiKey, env.apiSecret, { identity, name: "Visitor", ttl: 15 * 60 });
  at.addGrant({ roomJoin: true, room: roomName, canPublish: true, canSubscribe: true, canPublishData: true });
  return { token: await at.toJwt(), roomName, identity };
}

/**
 * Sends our agent worker into the conversation's room. LiveKit takes 1.5 to 2.5 s to create the room
 * and hand out the job, so this runs after the session response (route `after`), while the visitor's
 * browser connects, instead of after they have joined (a token dispatch only starts on their join).
 * Works whether or not the visitor is in the room yet. One retry; the widget shows an error if the
 * agent never arrives.
 */
export async function dispatchAgent(env: LivekitEnv, metadata: DispatchMetadata): Promise<void> {
  // LIVEKIT_AGENT_NAME must match the worker's; dev uses its own name so it never reaches the production worker.
  const agentName = process.env.LIVEKIT_AGENT_NAME || AGENT_NAME;
  const client = new AgentDispatchClient(env.url.replace(/^ws/, "http"), env.apiKey, env.apiSecret);
  const room = roomNameFor(metadata.conversationId);
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await client.createDispatch(room, agentName, { metadata: JSON.stringify(metadata) });
      return;
    } catch (err) {
      console.error(`agent dispatch failed (attempt ${attempt})`, err);
    }
  }
}

export const roomNameFor = (conversationId: string) => `tf-${conversationId}`;
