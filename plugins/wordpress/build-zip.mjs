// Zips plugins/wordpress/halochime into apps/web/public/downloads/halochime-wordpress.zip (the dashboard's
// download). No dependencies; the zip is byte-for-byte the same for the same files, so it only shows up
// in a diff when the plugin changed.
//
//   node plugins/wordpress/build-zip.mjs           write the zip
//   node plugins/wordpress/build-zip.mjs --check   fail if the zip is missing or out of date

import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateRawSync } from "node:zlib";

const here = dirname(fileURLToPath(import.meta.url));
const pluginDir = join(here, "halochime");
const out = join(here, "..", "..", "apps", "web", "public", "downloads", "halochime-wordpress.zip");

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function files(dir) {
  return readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : e.name.startsWith(".") ? [] : [join(dir, e.name)]));
}

// A fixed date (1 Jan 2026, 00:00) so the zip doesn't change when nothing else did.
const DOS_TIME = 0;
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;

function buildZip() {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const file of files(pluginDir)) {
    // Text files are stored with LF line ends, whatever the checkout uses.
    const raw = readFileSync(file);
    const data = /\.(php|txt|md|css|js)$/.test(file) ? Buffer.from(raw.toString("utf8").replace(/\r\n/g, "\n"), "utf8") : raw;
    const name = Buffer.from(`halochime/${relative(pluginDir, file).split(sep).join("/")}`, "utf8");
    const packed = deflateRawSync(data, { level: 9 });
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, packed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x031e, 4); // made by: Unix, 3.0
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE((0o100644 << 16) >>> 0, 38); // -rw-r--r--
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += local.length + name.length + packed.length;
  }
  const centralDir = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(centrals.length / 2, 8);
  end.writeUInt16LE(centrals.length / 2, 10);
  end.writeUInt32LE(centralDir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralDir, end]);
}

const zip = buildZip();
if (process.argv.includes("--check")) {
  if (!existsSync(out) || !readFileSync(out).equals(zip)) {
    console.error("halochime-wordpress.zip is out of date: run node plugins/wordpress/build-zip.mjs");
    process.exit(1);
  }
  console.log("halochime-wordpress.zip is up to date");
} else {
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, zip);
  console.log(`wrote ${relative(process.cwd(), out)} (${zip.length} bytes)`);
}
