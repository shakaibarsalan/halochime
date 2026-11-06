import "server-only";
import { AGENT_NAME } from "@talkfront/shared";
import { RoomAgentDispatch, RoomConfiguration, SipClient } from "livekit-server-sdk";
import { livekitEnv } from "@/lib/env";
import { PHONE_ROOM_PREFIX, phoneDispatchMetadata, sipHost } from "./phone";

// The LiveKit side of a phone channel: one inbound trunk for the business's number (only calls to that
// number, from the allowed addresses and with the password if set, are accepted) and one dispatch rule
// that puts each call in its own room and sends our agent worker in with the channel's metadata.

export type PhoneRoutingInput = {
  channelId: string;
  agentId: string;
  organizationId: string;
  /** E.164 business number. */
  number: string;
  allowedAddresses: string[];
  auth: { username: string; password: string } | null;
  /** Shown in the LiveKit dashboard, e.g. the workspace and agent name. */
  label: string;
};

export type PhoneRouting = { trunkId: string; dispatchRuleId: string };

export class PhoneSetupError extends Error {}

/** The project's SIP host (LIVEKIT_SIP_URI), or null when the platform has not set it up. */
export const phoneSipHost = () => sipHost(process.env.LIVEKIT_SIP_URI);

/** Phone calls need the LiveKit keys and the project's SIP URI. */
export const phoneChannelAvailable = () => Boolean(livekitEnv() && phoneSipHost());

function client(): SipClient {
  const env = livekitEnv();
  if (!env) throw new PhoneSetupError("LiveKit is not configured on this server.");
  return new SipClient(env.url.replace(/^ws/, "http"), env.apiKey, env.apiSecret);
}

/** LiveKit errors can be long; keep a short, safe line for the owner. */
function reason(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.replace(/\s+/g, " ").slice(0, 200);
}

export async function createPhoneRouting(input: PhoneRoutingInput): Promise<PhoneRouting> {
  const sip = client();
  const name = `halochime ${input.label}`.slice(0, 120);
  const meta = JSON.stringify({ channelId: input.channelId, organizationId: input.organizationId });
  let trunkId: string;
  try {
    const trunk = await sip.createSipInboundTrunk(name, [input.number], {
      metadata: meta,
      ...(input.allowedAddresses.length ? { allowedAddresses: input.allowedAddresses } : {}),
      ...(input.auth ? { authUsername: input.auth.username, authPassword: input.auth.password } : {}),
    });
    trunkId = trunk.sipTrunkId;
  } catch (e) {
    console.error("LiveKit inbound trunk create failed", reason(e));
    throw new PhoneSetupError(`LiveKit did not accept this number: ${reason(e)}`);
  }

  try {
    // Same agent name as widget calls (lib/livekit.ts): a dev worker uses its own name.
    const agentName = process.env.LIVEKIT_AGENT_NAME || AGENT_NAME;
    const rule = await sip.createSipDispatchRule(
      { type: "individual", roomPrefix: PHONE_ROOM_PREFIX },
      {
        name,
        metadata: meta,
        trunkIds: [trunkId],
        roomConfig: new RoomConfiguration({
          agents: [
            new RoomAgentDispatch({
              agentName,
              metadata: JSON.stringify(
                phoneDispatchMetadata({ agentId: input.agentId, organizationId: input.organizationId, channelId: input.channelId }),
              ),
            }),
          ],
        }),
      },
    );
    return { trunkId, dispatchRuleId: rule.sipDispatchRuleId };
  } catch (e) {
    console.error("LiveKit dispatch rule create failed", reason(e));
    await sip.deleteSipTrunk(trunkId).catch(() => undefined);
    throw new PhoneSetupError(`LiveKit did not accept the call routing: ${reason(e)}`);
  }
}

/** Removes what createPhoneRouting made. Already gone counts as done. */
export async function deletePhoneRouting(routing: { trunkId: string | null; dispatchRuleId: string | null }): Promise<void> {
  if (!routing.trunkId && !routing.dispatchRuleId) return;
  const sip = client();
  const gone = (e: unknown) => /not.?found|404/i.test(reason(e));
  if (routing.dispatchRuleId) {
    await sip.deleteSipDispatchRule(routing.dispatchRuleId).catch((e) => {
      if (!gone(e)) throw new PhoneSetupError(`Could not remove the call routing in LiveKit: ${reason(e)}`);
    });
  }
  if (routing.trunkId) {
    await sip.deleteSipTrunk(routing.trunkId).catch((e) => {
      if (!gone(e)) throw new PhoneSetupError(`Could not remove the number from LiveKit: ${reason(e)}`);
    });
  }
}
