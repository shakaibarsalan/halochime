// Run: npx tsx src/lib/branding/powered-by.check.ts (from apps/web)
import assert from "node:assert/strict";
import { isOwnerRole, logoImageType } from "./logo";
import { cleanBrandUrl, poweredByFor } from "./powered-by";

const halochime = { label: "Halochime", url: "https://halochime.vercel.app" };

// No settings: exactly as before.
assert.deepEqual(poweredByFor(null, halochime), halochime);
assert.deepEqual(poweredByFor({ poweredBy: "halochime", poweredByLabel: "X", poweredByUrl: "https://x.com" }, halochime), halochime);
// Hidden: no line.
assert.equal(poweredByFor({ poweredBy: "hidden", poweredByLabel: null, poweredByUrl: null }, halochime), undefined);
// Custom.
assert.deepEqual(poweredByFor({ poweredBy: "custom", poweredByLabel: "  Acme   Agency ", poweredByUrl: "https://acme.example" }, halochime), {
  label: "Acme Agency",
  url: "https://acme.example/",
});
// A broken custom setting falls back to Halochime.
assert.deepEqual(poweredByFor({ poweredBy: "custom", poweredByLabel: "", poweredByUrl: "https://acme.example" }, halochime), halochime);
assert.deepEqual(poweredByFor({ poweredBy: "custom", poweredByLabel: "Acme", poweredByUrl: "javascript:alert(1)" }, halochime), halochime);

assert.equal(cleanBrandUrl("ftp://x.com"), null);
assert.equal(cleanBrandUrl("https://user:pw@x.com"), null);
assert.equal(cleanBrandUrl("not a url"), null);
assert.equal(cleanBrandUrl(" https://x.com/a "), "https://x.com/a");

assert.equal(logoImageType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0])), "image/png");
assert.equal(logoImageType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), "image/jpeg");
assert.equal(logoImageType(new TextEncoder().encode("<svg onload=alert(1)>")), null);

assert.equal(isOwnerRole("owner"), true);
assert.equal(isOwnerRole("admin, owner"), true);
assert.equal(isOwnerRole("admin"), false);

console.log("powered-by.check: ok");
