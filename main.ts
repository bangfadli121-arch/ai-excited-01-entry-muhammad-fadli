// main.ts — deterministic image entry for make.fun ai-excited-01.
//
// Copies the bundled entry image to the harness output directory, byte
// for byte, after checking it is a real PNG or JPEG inside the
// competition's size and dimension caps. Standard library only, no
// network, no randomness, no timestamps: two runs write identical bytes.

import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const LIMIT_BYTES = 1024 * 1024;
const LIMIT_PX = 1024;

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPG_MAGIC = [0xff, 0xd8, 0xff];

function die(msg: string): never {
  console.error(`main.ts: ${msg}`);
  process.exit(1);
}

function kindOf(buf: Buffer): "png" | "jpg" | null {
  if (PNG_MAGIC.every((b, i) => buf[i] === b)) return "png";
  if (JPG_MAGIC.every((b, i) => buf[i] === b)) return "jpg";
  return null;
}

function pngSize(buf: Buffer): [number, number] | null {
  // IHDR stores width then height as big-endian uint32 at bytes 16..23.
  if (buf.length < 24) return null;
  return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
}

function jpgSize(buf: Buffer): [number, number] | null {
  // Walk JPEG markers until the first Start-Of-Frame segment; it holds
  // height then width as big-endian uint16.
  const sof = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  let i = 2; // skip SOI (FF D8)
  while (i + 3 < buf.length) {
    if (buf[i] !== 0xff) return null;
    const marker = buf[i + 1];
    if (marker === 0xff) {
      i += 1; // padding byte
      continue;
    }
    if (marker === 0xd9) return null; // EOI before any SOF
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      i += 2; // standalone marker, no length field
      continue;
    }
    const len = buf.readUInt16BE(i + 2);
    if (len < 2 || i + 2 + len > buf.length) return null;
    if (sof.has(marker)) {
      if (len < 7) return null;
      return [buf.readUInt16BE(i + 7), buf.readUInt16BE(i + 5)];
    }
    i += 2 + len;
  }
  return null;
}

function main(): void {
  const here = dirname(fileURLToPath(import.meta.url));
  const src = join(here, "entry.png");
  const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? "/output";
  const dst = join(outDir, "entry.png");

  let bytes: Buffer;
  try {
    bytes = readFileSync(src);
  } catch {
    die(`cannot read ${src}`);
  }
  if (bytes.length > LIMIT_BYTES) {
    die(`entry image is ${bytes.length} bytes, over the ${LIMIT_BYTES} byte cap`);
  }

  const kind = kindOf(bytes);
  if (kind === null) die("entry image is neither PNG nor JPEG");
  const size = kind === "png" ? pngSize(bytes) : jpgSize(bytes);
  if (size === null) die("could not read image dimensions");
  const [w, h] = size;
  if (w > LIMIT_PX || h > LIMIT_PX) {
    die(`image is ${w}x${h}, over the ${LIMIT_PX}x${LIMIT_PX} cap`);
  }

  mkdirSync(outDir, { recursive: true });
  copyFileSync(src, dst);
  const written = readFileSync(dst);
  if (!written.equals(bytes)) die("output bytes differ from source bytes");
  const sum = createHash("sha256").update(written).digest("hex");
  console.log(`wrote ${dst} (${written.length} bytes, ${kind}, ${w}x${h}, sha256 ${sum})`);
}

main();
