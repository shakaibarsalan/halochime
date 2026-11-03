import type { NextConfig } from "next";

/**
 * Hardening for the site's own pages: nobody may frame them (clickjacking), no full URLs leak to other
 * sites in Referer, and no MIME sniffing. Deliberately no script-src CSP here.
 */
const PAGE_SECURITY_HEADERS = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Content-Type-Options", value: "nosniff" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        // Everything except what other websites embed: the widget API (/api/widget/*, incl. the icon
        // image route, which sets its own headers) and the widget script (/widget.js and its .map).
        // The widget is a script on the host page, not an iframe, so frame-ancestors on pages is safe.
        source: "/:path((?!api/widget/|widget\\.js).*)",
        headers: PAGE_SECURITY_HEADERS,
      },
    ];
  },
  transpilePackages: ["@talkfront/shared"],
  // Dev only: lets the app also be opened at 127.0.0.1:3000 (a separate cookie jar from localhost).
  allowedDevOrigins: ["127.0.0.1"],
  // linkedom and readability are plain Node libraries; keep them out of the server bundle.
  serverExternalPackages: ["linkedom", "@mozilla/readability"],
  experimental: {
    // Knowledge uploads go through a server action; allow a 4 MB PDF plus multipart overhead.
    // Vercel functions refuse request bodies over ~4.5 MB, so the PDF limit stays at 4 MB.
    serverActions: { bodySizeLimit: "5mb" },
    // /app/* runs through proxy.ts; keep its body buffer above the action limit.
    proxyClientMaxBodySize: "5mb",
  },
};

export default nextConfig;
