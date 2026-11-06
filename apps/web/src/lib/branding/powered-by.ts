// White label: what the widget shows under the chat. Pure, checked by powered-by.check.ts.

export type PoweredByMode = "halochime" | "hidden" | "custom";
export type PoweredBy = { label: string; url: string };
export type BrandingRow = { poweredBy: PoweredByMode; poweredByLabel: string | null; poweredByUrl: string | null };

/** An http(s) URL without credentials, or null. */
export function cleanBrandUrl(raw: string | null | undefined): string | null {
  const v = raw?.trim();
  if (!v || v.length > 500) return null;
  try {
    const u = new URL(v);
    if ((u.protocol !== "http:" && u.protocol !== "https:") || u.username || u.password) return null;
    return u.toString();
  } catch {
    return null;
  }
}

/**
 * The "by ..." line for a workspace: Halochime when nothing is set (as before), nothing when hidden,
 * the agency's own name and link when custom. A custom setting with a broken name or link falls back
 * to Halochime rather than showing something half filled.
 */
export function poweredByFor(row: BrandingRow | null | undefined, halochime: PoweredBy): PoweredBy | undefined {
  if (!row || row.poweredBy === "halochime") return halochime;
  if (row.poweredBy === "hidden") return undefined;
  const label = row.poweredByLabel?.replace(/\s+/g, " ").trim().slice(0, 40);
  const url = cleanBrandUrl(row.poweredByUrl);
  return label && url ? { label, url } : halochime;
}
