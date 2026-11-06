import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { agentChannels, agents, conversations } from "@/db/schema";
import { PHONE_ROOM_PREFIX, normalizePhoneNumber } from "@/lib/channels/phone";
import { noteChannelEvent, phoneConfig } from "@/lib/channels/store";
import { apiError, parseJson } from "@/lib/http";
import { checkInternalAuth } from "@/lib/internal-auth";
import { startSessionWithinLimits } from "@/lib/widget/limits";

// The voice agent calls this when a phone call (LiveKit SIP) reaches it: a widget session has its
// conversation made before dispatch, a phone call doesn't. Same limits and minutes check as a widget
// voice call (startSessionWithinLimits). Idempotent per room, so the agent may retry.
// Refusals use the widget codes (402 out_of_credit, 429 rate_limited); the agent then tells the
// caller in one sentence and hangs up. 404 / 409: the channel is gone or turned off.

const OpenPhoneCall = z.object({
  agentId: z.string().min(1).max(200),
  organizationId: z.string().min(1).max(200),
  channelId: z.string().min(1).max(200),
  roomName: z.string().min(1).max(256),
  callerNumber: z.string().max(50).optional(),
  calledNumber: z.string().max(50).optional(),
  trunkId: z.string().max(200).optional(),
  callId: z.string().max(200).optional(),
});

export async function POST(req: Request) {
  const denied = checkInternalAuth(req);
  if (denied) return denied;
  const parsed = await parseJson(req, OpenPhoneCall);
  if ("response" in parsed) return parsed.response;
  const input = parsed.data;
  if (!input.roomName.startsWith(PHONE_ROOM_PREFIX)) {
    return apiError(400, "invalid_request", "roomName is not a phone call room.");
  }

  const [row] = await db
    .select({ channel: agentChannels, agentId: agents.id })
    .from(agentChannels)
    .innerJoin(agents, and(eq(agents.id, agentChannels.agentId), eq(agents.organizationId, agentChannels.organizationId)))
    .where(
      and(
        eq(agentChannels.id, input.channelId),
        eq(agentChannels.agentId, input.agentId),
        eq(agentChannels.organizationId, input.organizationId),
        eq(agentChannels.kind, "phone"),
      ),
    )
    .limit(1);
  if (!row) return apiError(404, "not_found", "No phone channel for this agent.");
  const channel = row.channel;
  if (!channel.enabled) return apiError(409, "channel_disabled", "Phone calls are turned off for this agent.");
  // The call must have come in on this channel's own trunk.
  const cfg = phoneConfig(channel);
  if (cfg.trunkId && input.trunkId && input.trunkId !== cfg.trunkId) {
    return apiError(403, "forbidden", "This call did not come in on the channel's number.");
  }

  // The agent retried after a network error: the conversation is already there.
  const [existing] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(and(eq(conversations.roomName, input.roomName), eq(conversations.organizationId, channel.organizationId)))
    .limit(1);
  if (existing) return NextResponse.json({ conversationId: existing.id });

  const caller = input.callerNumber ? (normalizePhoneNumber(input.callerNumber) ?? input.callerNumber.trim().slice(0, 50)) : null;
  const conversationId = crypto.randomUUID();
  const refusal = await startSessionWithinLimits(
    { organizationId: channel.organizationId, agentId: channel.agentId, mode: "voice" },
    async (tx) => {
      await tx.insert(conversations).values({
        id: conversationId,
        organizationId: channel.organizationId,
        agentId: channel.agentId,
        mode: "voice",
        channel: "phone",
        // The caller's number is who they are on this channel (not verified: caller ids can be faked).
        visitorId: caller,
        roomName: input.roomName,
      });
    },
  );
  await noteChannelEvent(channel.id);
  if (refusal) {
    console.info(`phone call refused for agent ${channel.agentId}: ${refusal.code}`);
    return apiError(refusal.status, refusal.code, refusal.message);
  }
  return NextResponse.json({ conversationId });
}
