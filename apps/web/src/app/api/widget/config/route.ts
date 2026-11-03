import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import type { WidgetConfigResponse } from "@talkfront/shared";
import { appUrl, livekitEnv } from "@/lib/env";
import { preflight, resolveWidgetAgent } from "@/lib/widget/agent";

export async function GET(req: NextRequest) {
  const resolved = await resolveWidgetAgent(req, req.nextUrl.searchParams.get("key"));
  if ("response" in resolved) return resolved.response;
  const { agent, headers } = resolved;
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
    poweredBy: { label: "Halochime", url: appUrl() },
  };
  headers.set("Cache-Control", "no-store");
  return NextResponse.json(body, { headers });
}

export const OPTIONS = preflight;
