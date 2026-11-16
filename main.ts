// ai-excited-01 entry — Node 22, standard library only.
//
// "A phoenix of aurora light shattering a frozen lake": this program
// writes the entry image to /output/entry.png. The image ships beside
// this file as entry.png (JPEG bytes under a .png name; the gate tells
// the format apart from the first bytes, not the extension). Before
// copying it, the program proves the file is a whole JPEG inside the
// gate limits (at most 1 MiB, at most 1024x1024 pixels), so a corrupt,
// truncated or oversized file fails loudly here instead of silently
// reaching the judge.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for
// /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const MAX_BYTES = 1_048_576;
const MAX_SIDE = 1024;

const source = new URL('./entry.png', import.meta.url);
const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
const target = join(outDir, 'entry.png');

const bytes = readFileSync(source);

// A JPEG opens with FF D8 FF and closes with FF D9. Anything else is
// not the image this entry ships.
if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) {
  throw new Error('entry.png is not a JPEG (bad magic bytes)');
}
if (bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) {
  throw new Error('entry.png is not a whole JPEG (missing end marker)');
}
if (bytes.length > MAX_BYTES) {
  throw new Error(`entry.png is ${bytes.length} bytes, over the 1 MiB limit`);
}

function u16be(buf, at) {
  return (buf[at] << 8) | buf[at + 1];
}

// Markers that carry no length field: SOI, TEM and the restart markers.
// The walker steps past them instead of reading a segment length.
function hasNoSegment(marker) {
  return marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7);
}

// Walk the marker stream to the frame header (SOF0 or SOF2) and read
// the pixel dimensions from it. Fill runs of 0xFF and stuffed 0xFF 0x00
// pairs are skipped the way a JPEG reader skips them, so a stray 0xFF
// before the frame header is never mistaken for a marker, and a
// truncated segment throws instead of reporting no header.
function frameSize(buf) {
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) {
      i += 1;
      continue;
    }
    while (i + 1 < buf.length && buf[i + 1] === 0xff) {
      i += 1;
    }
    const marker = buf[i + 1];
    if (marker === 0x00) {
      i += 2;
      continue;
    }
    if (marker === 0xc0 || marker === 0xc2) {
      return { height: u16be(buf, i + 5), width: u16be(buf, i + 7) };
    }
    if (hasNoSegment(marker)) {
      i += 2;
      continue;
    }
    const segLen = u16be(buf, i + 2);
    if (segLen < 2 || i + 2 + segLen > buf.length) {
      throw new Error('entry.png has a truncated JPEG segment');
    }
    i += 2 + segLen;
  }
  throw new Error('entry.png has no JPEG frame header');
}

const { width, height } = frameSize(bytes);
if (width === 0 || height === 0) {
  throw new Error('entry.png has a zero pixel dimension');
}
if (width > MAX_SIDE || height > MAX_SIDE) {
  throw new Error(`entry.png is ${width}x${height}, over the 1024x1024 limit`);
}

mkdirSync(outDir, { recursive: true });
copyFileSync(source, target);

// A size match alone could hide a corrupt copy, so the output is
// proven byte-identical to the validated source by hash as well.
const written = statSync(target).size;
if (written !== bytes.length) {
  throw new Error(`copied ${written} bytes, expected ${bytes.length}`);
}
const digest = createHash('sha256').update(readFileSync(target)).digest('hex');
const expected = createHash('sha256').update(bytes).digest('hex');
if (digest !== expected) {
  throw new Error(`copied file hash ${digest} does not match source ${expected}`);
}
console.log(`wrote ${target} (${width}x${height}, ${written} bytes, sha256 ${digest})`);
