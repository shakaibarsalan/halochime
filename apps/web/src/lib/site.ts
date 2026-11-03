// Shared facts for the public pages: legal page dates, footer links and the social card.

/** When the privacy policy, terms and refund policy last changed. Update all three pages together. */
export const LEGAL_UPDATED = { label: "3 November 2026", iso: "2026-11-03" } as const;

/** Who runs the service, as the legal pages name it. */
export const OPERATOR = "Halochime, run by Shakaib Arsalan, Pakistan";

export const LEGAL_LINKS = [
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" },
  { href: "/refund-policy", label: "Refunds" },
  { href: "/contact", label: "Contact" },
] as const;

export const OG_ALT = "Halochime: voice and chat AI support for any website";

/**
 * The social card from app/opengraph-image.tsx. A page that sets its own `openGraph` replaces the
 * inherited one, image included, so those pages list it again.
 */
export const OG_IMAGE = { url: "/opengraph-image", width: 1200, height: 630, alt: OG_ALT } as const;
