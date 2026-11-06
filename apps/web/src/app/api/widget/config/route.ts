import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import type { WidgetConfigResponse } from "@talkfront/shared";
import { poweredByFor } from "@/lib/branding/powered-by";
import { brandingRow } from "@/lib/branding/server";
import { appUrl, livekitEnv } from "@/lib/env";
import { pickVersion } from "@/lib/versions/server";
import { applySnapshot } from "@/lib/versions/snapshot";
import { preflight, resolveWidgetAgent } from "@/lib/widget/agent";
import { greetingAudioUrl } from "@/lib/widget/greeting-audio";
import { widgetPageHelp } from "@/lib/page-help";
import { loadPageHelp } from "@/lib/widget/page-help";

/** Same shape the widget stores (packages/widget/src/visitor.ts). */
const VISITOR_ID = /^[A-Za-z0-9_-]{8,100}$/;

export async function GET(req: NextRequest) {
  const resolved = await resolveWidgetAgent(req, req.nextUrl.searchParams.get("key"));
  if ("response" in resolved) return resolved.response;
  const { headers } = resolved;
  let { agent } = resolved;

  // A/B test: show this visitor the greeting of the version their conversations will use. Without a
  // visitor id (older widget) the agent's own greeting is shown, as before.
  const vid = req.nextUrl.searchParams.get("vid");
  const [version, branding] = await Promise.all([
    vid && VISITOR_ID.test(vid) ? pickVersion(agent, vid) : Promise.resolve(null),
    brandingRow(agent.organizationId),
  ]);
  if (version) agent = applySnapshot(agent, version.snapshot);

  const body: WidgetConfigResponse = {
    agentId: agent.id,
    name: agent.name,
    greeting: agent.greeting,
    modes: agent.modes,
    theme: agent.theme,
    ...(agent.modes.includes("voice") && livekitEnv() ? { livekitUrl: livekitEnv()!.url } : {}),
    ...(agent.theme.icon === "image" && agent.theme.imageVersion
      ? { iconUrl: `${appUrl()}/api/widget/image/${encodeURIComponent(agent.id)}?v=${agent.theme.imageVersion}` }
      : {}),
    // Proactive help and page guide: only present when the business turned them on.
    ...widgetPageHelp(await loadPageHelp(agent.id)),
  };
  // White label: Halochime unless the workspace owner hid the line or put their agency's name there.
  const poweredBy = poweredByFor(branding, { label: "Halochime", url: appUrl() });
  if (poweredBy) body.poweredBy = poweredBy;
  const greetingAudio = greetingAudioUrl(agent);
  if (greetingAudio) body.greetingAudioUrl = greetingAudio;
  headers.set("Cache-Control", "no-store");
  return NextResponse.json(body, { headers });
}

export const OPTIONS = preflight;
