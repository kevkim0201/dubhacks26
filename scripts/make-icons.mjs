// Generates the placeholder PNG icons with no dependencies (Node's zlib only).
// Run: node scripts/make-icons.mjs
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'icons');
const SIZES = [16, 32, 48, 128];
const BG = [99, 102, 241];   // indigo-500, matches the default accent
const FG = [255, 255, 255];

function crc32(buf) {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

// Rounded square with a white ring, antialiased by 3x3 supersampling.
function pixel(x, y, size) {
  const r = size * 0.22;        // corner radius
  const ringOuter = size * 0.32;
  const ringInner = size * 0.18;
  let bg = 0;
  let fg = 0;

  for (let sy = 0; sy < 3; sy++) {
    for (let sx = 0; sx < 3; sx++) {
      const px = x + (sx + 0.5) / 3;
      const py = y + (sy + 0.5) / 3;
      const cx = Math.min(Math.max(px, r), size - r);
      const cy = Math.min(Math.max(py, r), size - r);
      if (Math.hypot(px - cx, py - cy) > r) continue;  // outside rounded corner
      bg++;
      const d = Math.hypot(px - size / 2, py - size / 2);
      if (d <= ringOuter && d >= ringInner) fg++;
    }
  }

  const alpha = Math.round((bg / 9) * 255);
  const mix = bg ? fg / bg : 0;
  const rgb = BG.map((c, i) => Math.round(c + (FG[i] - c) * mix));
  return [...rgb, alpha];
}

function png(size) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  let o = 0;
  for (let y = 0; y < size; y++) {
    raw[o++] = 0;  // filter type: none
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x, y, size);
      raw[o++] = r; raw[o++] = g; raw[o++] = b; raw[o++] = a;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // color type: RGBA

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync(OUT_DIR, { recursive: true });
for (const size of SIZES) {
  const file = join(OUT_DIR, `icon${size}.png`);
  writeFileSync(file, png(size));
  console.log('wrote', file);
}
