// ai-excited-01 entry (Node 22, standard library only).
//
// The program writes the entry image — a phoenix of aurora light
// shattering a frozen lake at night, wings of teal and violet northern
// lights, body of white-gold flame — to /output/entry.png. The image
// lives beside this file as entry.png (JPEG bytes under that name; the
// gate tells the format apart by its first bytes). Before copying, the
// program checks the file is a whole JPEG inside the gate limits (at
// most 1 MiB, at most 1024x1024) so a bad file fails loudly here instead
// of silently reaching the judge.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for
// /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { copyFileSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const MAX_BYTES = 1_048_576;
const MAX_SIDE = 1024;

const source = new URL('./entry.png', import.meta.url);
const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
const target = join(outDir, 'entry.png');

const data = readFileSync(source);

// A JPEG starts with FF D8 FF and ends with FF D9; anything else is not
// the image this entry ships.
if (data.length < 4 || data[0] !== 0xff || data[1] !== 0xd8 || data[2] !== 0xff) {
  throw new Error('entry.png is not a JPEG (bad magic bytes)');
}
if (data[data.length - 2] !== 0xff || data[data.length - 1] !== 0xd9) {
  throw new Error('entry.png is not a whole JPEG (missing end marker)');
}
if (data.length > MAX_BYTES) {
  throw new Error(`entry.png is ${data.length} bytes, over the 1 MiB limit`);
}

// Scan the JPEG markers for the frame header (SOF0/SOF2) and read the
// pixel dimensions out of it. Throws on a truncated segment instead of
// silently reporting no header. Fill bytes (runs of 0xFF) and stuffed
// 0xFF 0x00 pairs are skipped the way a JPEG reader skips them, so a
// stray 0xFF before the frame header cannot be mistaken for a marker.
function jpegDimensions(bytes) {
  let i = 2;
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) {
      i += 1;
      continue;
    }
    while (i + 1 < bytes.length && bytes[i + 1] === 0xff) {
      i += 1;
    }
    const marker = bytes[i + 1];
    if (marker === 0x00) {
      i += 2;
      continue;
    }
    if (marker === 0xc0 || marker === 0xc2) {
      return {
        height: (bytes[i + 5] << 8) | bytes[i + 6],
        width: (bytes[i + 7] << 8) | bytes[i + 8],
      };
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    const segLen = (bytes[i + 2] << 8) | bytes[i + 3];
    if (segLen < 2 || i + 2 + segLen > bytes.length) {
      throw new Error('entry.png has a truncated JPEG segment');
    }
    i += 2 + segLen;
  }
  throw new Error('entry.png has no JPEG frame header');
}

const { width, height } = jpegDimensions(data);
if (width === 0 || height === 0) {
  throw new Error('entry.png has a zero pixel dimension');
}
if (width > MAX_SIDE || height > MAX_SIDE) {
  throw new Error(`entry.png is ${width}x${height}, over the 1024x1024 limit`);
}

mkdirSync(outDir, { recursive: true });
copyFileSync(source, target);

const written = statSync(target).size;
if (written !== data.length) {
  throw new Error(`copied ${written} bytes, expected ${data.length}`);
}
console.log(`wrote ${target} (${width}x${height}, ${written} bytes)`);
