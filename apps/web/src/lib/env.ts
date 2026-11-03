import "server-only";

// Read env lazily (inside functions) so `next build` works with nothing set.

export function appUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || process.env.BETTER_AUTH_URL || "http://localhost:3000").replace(
    /\/+$/,
    "",
  );
}

export function appOrigin(): string {
  return new URL(appUrl()).origin;
}

export const isProduction = () => process.env.NODE_ENV === "production";

export function livekitEnv(): { url: string; apiKey: string; apiSecret: string } | null {
  const url = process.env.LIVEKIT_URL;
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  if (!url || !apiKey || !apiSecret) return null;
  return { url, apiKey, apiSecret };
}
