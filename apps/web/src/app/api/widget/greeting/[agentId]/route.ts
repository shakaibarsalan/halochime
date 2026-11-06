import { eq } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { db } from "@/db";
import { agents } from "@/db/schema";
import { rateLimit } from "@/lib/rate-limit";
import { runningTestSnapshots } from "@/lib/versions/server";
import {
  GREETING_TTS_INSTRUCTIONS,
  GREETING_TTS_MODEL,
  greetingAudioVersion,
  realtimeVoiceName,
} from "@/lib/widget/greeting-audio";

// The agent's greeting as MP3 for the widget to preload. ?v= must match the current greeting and voice
// (so nobody can make us generate audio for anything else), and the reply is cached for a year: a new
// greeting or voice gives a new URL. Generated on the first request per version (about 1 to 2 s).
export async function GET(req: NextRequest, { params }: { params: Promise<{ agentId: string }> }) {
  const { agentId } = await params;
  const version = req.nextUrl.searchParams.get("v") ?? "";
  const notFound = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });

  const [agent] = await db.select().from(agents).where(eq(agents.id, agentId)).limit(1);
  if (!agent) return notFound();
  // The agent's own greeting, or (A/B test running) one of the two versions' greetings.
  const matches = (s: { ttsVoice: string; greeting: string }) => {
    const voice = realtimeVoiceName(s.ttsVoice);
    const greeting = s.greeting.trim();
    return voice && greeting && version === greetingAudioVersion(voice, greeting) ? { voice, greeting } : null;
  };
  let found = matches(agent);
  if (!found) {
    const tested = await runningTestSnapshots(agent).catch(() => []);
    for (const s of tested) found ??= matches(s);
  }
  if (!found) return notFound();
  const { voice, greeting } = found;

  const key = process.env.OPENAI_API_KEY;
  if (!key) return notFound();
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (!rateLimit(`greeting-audio:${ip}`, 30, 10 * 60 * 1000).ok) {
    return new Response("Too many requests", { status: 429, headers: { "Cache-Control": "no-store" } });
  }

  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: GREETING_TTS_MODEL,
      voice,
      input: greeting,
      instructions: GREETING_TTS_INSTRUCTIONS,
      response_format: "mp3",
    }),
  });
  if (!res.ok) {
    console.error("greeting audio failed", res.status);
    return new Response("Unavailable", { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  return new Response(await res.arrayBuffer(), {
    headers: {
      "Content-Type": "audio/mpeg",
      "Cache-Control": "public, max-age=31536000, s-maxage=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "Cross-Origin-Resource-Policy": "cross-origin",
    },
  });
}
