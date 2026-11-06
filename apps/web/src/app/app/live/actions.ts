"use server";

import { z } from "zod";
import { MAX_STAFF_MESSAGE, memberDisplayName, visitorFacingName } from "@/lib/live-format";
import { liveRoom, sendStaffCommand, setTakeover, type SendResult } from "@/lib/live";
import { rateLimit } from "@/lib/rate-limit";
import { requireWorkspace } from "@/lib/session";

// Any member of the workspace may take a live conversation over: everyone who can open the workspace's
// conversations can see them (app/app/conversations). Every action is scoped to the active workspace.

export type LiveActionResult = { ok: true } | { ok: false; error: string };

const IdInput = z.string().trim().min(1).max(128);
const TextInput = z.string().trim().min(1, "Write a message first.").max(MAX_STAFF_MESSAGE, `Keep it under ${MAX_STAFF_MESSAGE} characters.`);

const ENDED = "This conversation has ended.";

function sendError(result: Exclude<SendResult, "sent">): string {
  if (result === "not_configured") return "Live conversations are not set up on this server (LiveKit is missing).";
  if (result === "no_agent") return "The assistant has left this conversation, so it can't be reached.";
  return "Could not reach the conversation. Try again in a moment.";
}

/** A few commands a second is plenty for a person typing; more is a stuck script. */
function tooFast(userId: string): boolean {
  return !rateLimit(`live-staff:${userId}`, 30, 30_000).ok;
}

export async function takeOverConversation(conversationId: string): Promise<LiveActionResult> {
  const ws = await requireWorkspace();
  const id = IdInput.safeParse(conversationId);
  if (!id.success) return { ok: false, error: ENDED };
  if (tooFast(ws.user.id)) return { ok: false, error: "Slow down a little and try again." };
  const room = await liveRoom(ws.organizationId, id.data);
  if (!room) return { ok: false, error: ENDED };
  const sent = await sendStaffCommand(room.roomName, { type: "takeover", name: visitorFacingName(ws.user.name) });
  if (sent !== "sent") return { ok: false, error: sendError(sent) };
  await setTakeover(ws.organizationId, id.data, { userId: ws.user.id, name: memberDisplayName(ws.user.name, ws.user.email) });
  return { ok: true };
}

export async function sendStaffMessage(conversationId: string, text: string): Promise<LiveActionResult> {
  const ws = await requireWorkspace();
  const id = IdInput.safeParse(conversationId);
  if (!id.success) return { ok: false, error: ENDED };
  const body = TextInput.safeParse(text);
  if (!body.success) return { ok: false, error: body.error.issues[0]?.message ?? "Write a message first." };
  if (tooFast(ws.user.id)) return { ok: false, error: "Slow down a little and try again." };
  const room = await liveRoom(ws.organizationId, id.data);
  if (!room) return { ok: false, error: ENDED };
  if (room.takenOverByUserId !== ws.user.id) return { ok: false, error: "Take the conversation over first." };
  const sent = await sendStaffCommand(room.roomName, {
    type: "say",
    text: body.data,
    id: crypto.randomUUID(),
    name: visitorFacingName(ws.user.name),
  });
  if (sent !== "sent") return { ok: false, error: sendError(sent) };
  return { ok: true };
}

export async function handBackConversation(conversationId: string): Promise<LiveActionResult> {
  const ws = await requireWorkspace();
  const id = IdInput.safeParse(conversationId);
  if (!id.success) return { ok: false, error: ENDED };
  const room = await liveRoom(ws.organizationId, id.data);
  if (!room) {
    // Ended meanwhile: nothing to tell the agent; just clear what the dashboard shows.
    await setTakeover(ws.organizationId, id.data, null);
    return { ok: true };
  }
  const sent = await sendStaffCommand(room.roomName, { type: "release" });
  // No agent any more means nothing is taken over either: clear it all the same.
  if (sent !== "sent" && sent !== "no_agent") return { ok: false, error: sendError(sent) };
  await setTakeover(ws.organizationId, id.data, null);
  return { ok: true };
}
