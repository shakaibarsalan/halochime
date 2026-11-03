import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

// Addresses from before the rename to Halochime. Their pages move to the current address; the widget
// script and the API keep answering there, because websites already embed widget.js from them.
const OLD_HOSTS = new Set(["talkfront-ai.vercel.app"]);

const SIGNED_IN_ONLY = /^\/(app(\/|$)|onboarding$)/;

export function proxy(request: NextRequest) {
  const host = request.headers.get("host")?.toLowerCase() ?? "";
  const current = process.env.NEXT_PUBLIC_APP_URL;
  if (OLD_HOSTS.has(host) && current && (request.method === "GET" || request.method === "HEAD")) {
    const target = sameSiteTarget(current, request.nextUrl.pathname, request.nextUrl.search);
    if (target && target.host !== host) return NextResponse.redirect(target, 308);
  }

  // Cheap cookie check only. The dashboard layout validates the session and membership for real.
  if (SIGNED_IN_ONLY.test(request.nextUrl.pathname) && !getSessionCookie(request)) {
    const url = new URL("/sign-in", request.url);
    url.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

/**
 * The current app address with this request's path and query. The path is set on a fixed URL of the
 * app's origin (never parsed as a URL itself), so a path like "//evil.com" stays a path on our site.
 * null when NEXT_PUBLIC_APP_URL is not a valid URL.
 */
function sameSiteTarget(appUrl: string, pathname: string, search: string): URL | null {
  let target: URL;
  try {
    target = new URL(new URL(appUrl).origin);
  } catch {
    return null;
  }
  target.pathname = pathname;
  target.search = search;
  return target;
}

export const config = {
  // Pages only: not the API, the widget script, Next's own files or anything with a file extension.
  matcher: ["/((?!api/|_next/|widget\\.js|.*\\.[a-zA-Z0-9]+$).*)"],
};
