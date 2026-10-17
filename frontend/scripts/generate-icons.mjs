// Generates the PWA icons in public/icons from the FightScore mark (red/blue skewed halves).
// No dependencies: a tiny PNG encoder on top of node:zlib. Run: node scripts/generate-icons.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const BG = [7, 16, 31];
const RED = [229, 51, 63];
const BLUE = [47, 107, 255];
const SKEW = Math.tan((8 * Math.PI) / 180);

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
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function png(size, pixel) {
  const rows = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 4);
    for (let x = 0; x < size; x++) row.set(pixel(x, y), 1 + x * 4);
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.concat(rows), { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/**
 * Colour of a point in unit coordinates (0..1). `mark` is the side of the mark square relative to
 * the icon; `rounded` gives the plate rounded corners (transparent outside), maskable icons are full-bleed.
 */
function shade(u, v, { mark, rounded }) {
  if (rounded) {
    const r = 0.2;
    const dx = Math.max(r - u, 0, u - (1 - r));
    const dy = Math.max(r - v, 0, v - (1 - r));
    if (dx * dx + dy * dy > r * r) return null;
  }
  const half = mark / 2;
  const sv = (v - 0.5) / half; // -1..1 inside the mark
  const su = (u - 0.5 + (v - 0.5) * SKEW) / half;
  if (Math.abs(sv) <= 1 && Math.abs(su) <= 1) {
    if (Math.abs(su) < 0.06) return BG; // gap between the halves
    return su < 0 ? RED : BLUE;
  }
  return BG;
}

function render(size, opts) {
  const S = 4; // supersampling for smooth edges
  return png(size, (x, y) => {
    let r = 0, g = 0, b = 0, a = 0;
    for (let i = 0; i < S; i++)
      for (let j = 0; j < S; j++) {
        const c = shade((x + (i + 0.5) / S) / size, (y + (j + 0.5) / S) / size, opts);
        if (!c) continue;
        r += c[0];
        g += c[1];
        b += c[2];
        a += 1;
      }
    if (!a) return [0, 0, 0, 0];
    return [Math.round(r / a), Math.round(g / a), Math.round(b / a), Math.round((255 * a) / (S * S))];
  });
}

const out = new URL("../public/icons/", import.meta.url);
mkdirSync(out, { recursive: true });
const files = {
  "icon-192.png": [192, { mark: 0.56, rounded: true }],
  "icon-512.png": [512, { mark: 0.56, rounded: true }],
  // Maskable: full-bleed plate, mark inside the 80% safe zone.
  "maskable-512.png": [512, { mark: 0.44, rounded: false }],
  "apple-touch-icon.png": [180, { mark: 0.5, rounded: false }],
  "favicon-32.png": [32, { mark: 0.62, rounded: true }],
};
for (const [name, [size, opts]] of Object.entries(files)) {
  writeFileSync(new URL(name, out), render(size, opts));
  console.log("wrote public/icons/" + name);
}
