import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const MAX_BYTES = 1048576;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_START = Buffer.from([0xff, 0xd8, 0xff]);

function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

function parseDimensions(buffer: Buffer, isPng: boolean): [number, number] | null {
  if (isPng) {
    // PNG: width at bytes 16-19, height at bytes 20-23 (big-endian uint32, IHDR).
    if (buffer.length < 24) return null;
    return [buffer.readUInt32BE(16), buffer.readUInt32BE(20)];
  }
  // JPEG: walk segments until a Start Of Frame marker (0xC0-0xCF except
  // 0xC4, 0xC8, 0xCC); its payload holds height then width (big-endian uint16).
  const sofMarkers = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  let offset = 2; // skip SOI (FF D8)
  while (offset + 3 < buffer.length) {
    if (buffer[offset] !== 0xff) return null;
    const marker = buffer[offset + 1];
    if (marker === 0xff) {
      offset += 1; // padding byte, keep scanning
      continue;
    }
    if (marker === 0xd9) return null; // EOI before any SOF
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      offset += 2; // standalone marker, no length field
      continue;
    }
    const length = buffer.readUInt16BE(offset + 2);
    if (length < 2 || offset + 2 + length > buffer.length) return null;
    if (sofMarkers.has(marker)) {
      if (length < 7) return null;
      const height = buffer.readUInt16BE(offset + 5);
      const width = buffer.readUInt16BE(offset + 7);
      return [width, height];
    }
    offset += 2 + length;
  }
  return null;
}

function fail(message: string): never {
  console.error(`error: ${message}`);
  process.exit(1);
}

function main(): void {
  const dir = dirname(fileURLToPath(import.meta.url));
  const sourcePath = join(dir, "entry.png");
  const outputDir = process.env.MAKEFUN_OUTPUT_DIR ?? "/output";
  const destPath = join(outputDir, "entry.png");

  if (!existsSync(sourcePath)) {
    fail(`source image not found: ${sourcePath}`);
  }

  const sourceStat = statSync(sourcePath);
  if (sourceStat.size > MAX_BYTES) {
    fail(`source image too large: ${sourceStat.size} bytes exceeds ${MAX_BYTES} bytes`);
  }

  const sourceBytes = readFileSync(sourcePath);
  if (sourceBytes.length !== sourceStat.size) {
    fail(`could not read full source image: ${sourcePath}`);
  }

  mkdirSync(outputDir, { recursive: true });

  try {
    copyFileSync(sourcePath, destPath);
  } catch (err) {
    fail(`failed to copy ${sourcePath} to ${destPath}: ${(err as Error).message}`);
  }

  const destBytes = readFileSync(destPath);
  if (destBytes.length !== sourceBytes.length) {
    fail(`size mismatch after copy: source ${sourceBytes.length} bytes, destination ${destBytes.length} bytes`);
  }
  const sourceHash = sha256(sourceBytes);
  const destHash = sha256(destBytes);
  if (destHash !== sourceHash) {
    fail(`sha256 mismatch after copy: source ${sourceHash}, destination ${destHash}`);
  }

  const isPng = destBytes.length >= PNG_SIGNATURE.length && destBytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE);
  const isJpeg = destBytes.length >= JPEG_START.length && destBytes.subarray(0, JPEG_START.length).equals(JPEG_START);
  if (!isPng && !isJpeg) {
    fail(`destination is neither PNG nor JPEG (bad magic bytes): ${destPath}`);
  }

  const dimensions = parseDimensions(destBytes, isPng);
  if (dimensions === null) {
    fail(`could not parse image dimensions: ${destPath}`);
  }
  const [width, height] = dimensions;
  if (width > 1024 || height > 1024) {
    fail(`image dimensions too large: ${width}x${height} exceeds 1024x1024`);
  }

  console.log(`wrote ${destPath} (${destBytes.length} bytes, sha256 ${destHash})`);
}

main();
