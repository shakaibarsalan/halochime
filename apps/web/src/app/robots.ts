import type { MetadataRoute } from "next";
import { appUrl } from "@/lib/env";

/** Public pages are open to crawlers; the dashboard, the API, onboarding and invites are not. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // "/app/" plus "/app$" rather than "/app": rules match by prefix, and "/app" would also block /apple-icon.png.
      disallow: ["/app$", "/app/", "/api/", "/onboarding", "/invite/"],
    },
    sitemap: `${appUrl()}/sitemap.xml`,
  };
}
