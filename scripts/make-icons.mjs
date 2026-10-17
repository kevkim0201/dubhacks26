// Generates the extension's PNG icons with no dependencies (Node's zlib
// only) -- the Pocket mark: a white smile capsule on a leaf-green rounded
// square, matching the logo drawn inline in the popup/options headers.
// Run: node scripts/make-icons.mjs
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'icons');
const SIZES = [16, 32, 48, 128];
const BG = [47, 107, 79];   // #2f6b4f, the default leaf/accent color
const FG = [253, 250, 244]; // #fdfaf4, the cream background color

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

// Distance from point to a quadratic Bezier, approximated by sampling --
// plenty accurate at icon resolution and much simpler than solving the
// exact nearest-point equation.
function distToQuadBezier(px, py, p0, p1, p2, samples = 24) {
  let min = Infinity;
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const mt = 1 - t;
    const x = mt * mt * p0[0] + 2 * mt * t * p1[0] + t * t * p2[0];
    const y = mt * mt * p0[1] + 2 * mt * t * p1[1] + t * t * p2[1];
    min = Math.min(min, Math.hypot(px - x, py - y));
  }
  return min;
}

// Rounded-square badge with a smile glyph, antialiased by 3x3 supersampling.
function pixel(x, y, size) {
  const r = size * 0.22; // corner radius

  // Smile: a quadratic curve from the left corner of the mouth down and
  // back up to the right corner, drawn as a thick rounded stroke.
  const p0 = [size * 0.28, size * 0.44];
  const p1 = [size * 0.5, size * 0.68];
  const p2 = [size * 0.72, size * 0.44];
  const strokeR = size * 0.05;

  let bg = 0;
  let fg = 0;

  for (let sy = 0; sy < 3; sy++) {
    for (let sx = 0; sx < 3; sx++) {
      const px = x + (sx + 0.5) / 3;
      const py = y + (sy + 0.5) / 3;
      const cx = Math.min(Math.max(px, r), size - r);
      const cy = Math.min(Math.max(py, r), size - r);
      if (Math.hypot(px - cx, py - cy) > r) continue; // outside rounded corner
      bg++;

      if (distToQuadBezier(px, py, p0, p1, p2) <= strokeR) fg++;
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
    raw[o++] = 0; // filter type: none
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x, y, size);
      raw[o++] = r; raw[o++] = g; raw[o++] = b; raw[o++] = a;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA

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
