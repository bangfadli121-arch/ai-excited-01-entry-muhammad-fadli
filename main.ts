import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname: string = path.dirname(fileURLToPath(import.meta.url));

const MAX_BYTES = 1048576;

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_MARKER = Buffer.from([0xff, 0xd8, 0xff]);

function sha256(filePath: string): string {
  const data: Buffer = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(data).digest("hex");
}

function getImageDimensions(
  data: Buffer,
  isPng: boolean,
  isJpeg: boolean,
): { width: number; height: number } | null {
  if (isPng) {
    if (data.length < 24) return null;
    return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
  }
  if (isJpeg) {
    let offset = 2; // skip SOI marker
    while (offset + 9 < data.length) {
      if (data[offset] !== 0xff) return null;
      const marker: number = data[offset + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
        offset += 2;
        continue;
      }
      if (marker === 0xda) return null; // SOS reached before any SOF marker
      const length: number = data.readUInt16BE(offset + 2);
      if (length < 2) return null;
      if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
        return {
          height: data.readUInt16BE(offset + 5),
          width: data.readUInt16BE(offset + 7),
        };
      }
      offset += 2 + length;
    }
    return null;
  }
  return null;
}

function main(): void {
  const sourcePath: string = path.join(__dirname, "entry.png");
  const outputDir: string = process.env.MAKEFUN_OUTPUT_DIR ?? "/output";
  const destPath: string = path.join(outputDir, "entry.png");

  if (!fs.existsSync(sourcePath)) {
    console.error(`Error: source image not found: ${sourcePath}`);
    process.exit(1);
  }

  const sourceStat: fs.Stats = fs.statSync(sourcePath);
  if (sourceStat.size > MAX_BYTES) {
    console.error(
      `Error: source image is ${sourceStat.size} bytes, exceeding the 1048576 byte limit`,
    );
    process.exit(1);
  }

  fs.mkdirSync(outputDir, { recursive: true });

  try {
    fs.copyFileSync(sourcePath, destPath);
  } catch (err) {
    console.error(`Error: failed to copy ${sourcePath} to ${destPath}: ${err}`);
    process.exit(1);
  }

  const destStat: fs.Stats = fs.statSync(destPath);
  if (destStat.size !== sourceStat.size) {
    console.error(
      `Error: size mismatch after copy: source ${sourceStat.size} bytes, destination ${destStat.size} bytes`,
    );
    process.exit(1);
  }

  const sourceHash: string = sha256(sourcePath);
  const destHash: string = sha256(destPath);
  if (destHash !== sourceHash) {
    console.error(
      `Error: sha256 mismatch after copy: source ${sourceHash}, destination ${destHash}`,
    );
    process.exit(1);
  }

  const head: Buffer = fs.readFileSync(destPath).subarray(0, 8);
  const isPng: boolean = head.subarray(0, 8).equals(PNG_SIGNATURE);
  const isJpeg: boolean = head.subarray(0, 3).equals(JPEG_MARKER);
  if (!isPng && !isJpeg) {
    console.error(
      "Error: destination is neither a PNG (89 50 4E 47 0D 0A 1A 0A) nor a JPEG (FF D8 FF) image",
    );
    process.exit(1);
  }

  const dims = getImageDimensions(fs.readFileSync(destPath), isPng, isJpeg);
  if (dims === null) {
    console.error("Error: could not parse image dimensions");
    process.exit(1);
  }
  if (dims.width > 1024 || dims.height > 1024) {
    console.error(
      `Error: image dimensions ${dims.width}x${dims.height} exceed the 1024x1024 limit`,
    );
    process.exit(1);
  }

  console.log(`Wrote ${destPath} (${destStat.size} bytes, sha256 ${destHash})`);
}

main();
