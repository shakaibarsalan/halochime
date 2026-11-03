import type { MetadataRoute } from "next";
import { appUrl } from "@/lib/env";
import { LEGAL_UPDATED } from "@/lib/site";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = appUrl();
  const legal = new Date(`${LEGAL_UPDATED.iso}T00:00:00Z`);
  return [
    { url: `${base}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${base}/docs`, changeFrequency: "weekly", priority: 0.8 },
    { url: `${base}/sign-up`, changeFrequency: "monthly", priority: 0.6 },
    { url: `${base}/contact`, changeFrequency: "yearly", priority: 0.4 },
    { url: `${base}/privacy`, lastModified: legal, changeFrequency: "yearly", priority: 0.3 },
    { url: `${base}/terms`, lastModified: legal, changeFrequency: "yearly", priority: 0.3 },
    { url: `${base}/refund-policy`, lastModified: legal, changeFrequency: "yearly", priority: 0.3 },
  ];
}
