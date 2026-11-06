// The agency logo for the dashboard sidebar. Pure.

export const LOGO_MAX_BYTES = 100 * 1024;

/** PNG, JPEG or WebP, judged by the file's first bytes (never by its name or the browser's claim). No SVG: it can carry script. */
export function logoImageType(b: Uint8Array): "image/png" | "image/jpeg" | "image/webp" | null {
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  const ascii = (from: number, to: number) => String.fromCharCode(...b.subarray(from, to));
  if (b.length > 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  return null;
}

/** Owner of the workspace? Better Auth roles can be comma lists ("owner,admin"). */
export const isOwnerRole = (role: string) => role.split(",").some((r) => r.trim() === "owner");
