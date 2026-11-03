import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
