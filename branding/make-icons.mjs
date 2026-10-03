// Builds every icon file from the 16×16 pixel cube in the app's top bar.
// Run: node branding/make-icons.mjs   (no dependencies; writes into branding/ and promo tools/)
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const promo = join(here, '..', 'promo tools');
mkdirSync(promo, { recursive: true });

// ---- the logo, traced from the SVG paths in the original mockup's index.html (pixel-grid polygons; the mockup is kept outside the repo)
const TOP = [[8, 1], [9, 1], [9, 2], [11, 2], [11, 3], [13, 3], [13, 4], [14, 4], [14, 5], [12, 5], [12, 6], [10, 6], [10, 7], [8, 7], [8, 8], [7, 8], [7, 7], [5, 7], [5, 6], [3, 6], [3, 5], [2, 5], [2, 4], [3, 4], [3, 3], [5, 3], [5, 2], [7, 2], [7, 1]];
const LEFT = [[2, 5], [3, 5], [3, 6], [5, 6], [5, 7], [7, 7], [7, 8], [8, 8], [8, 15], [7, 15], [7, 14], [5, 14], [5, 13], [3, 13], [3, 12], [2, 12]];
const RIGHT = [[14, 5], [14, 12], [13, 12], [13, 13], [11, 13], [11, 14], [9, 14], [9, 15], [8, 15], [8, 8], [9, 8], [9, 7], [11, 7], [11, 6], [13, 6], [13, 5]];
const COL = { top: [0xff, 0xd2, 0x3f], left: [0xff, 0x9a, 0x3c], right: [0x8f, 0xdc, 0x4a], shade: [0x71, 0xaa, 0x41], outline: [0x17, 0x13, 0x27] };

const inside = (poly, x, y) => { // even-odd test at the pixel centre
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
  }
  return c;
};

function grid(outline) {
  const g = Array.from({ length: 16 }, () => Array(16).fill(null));
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const px = x + .5, py = y + .5;
    if (inside(TOP, px, py)) g[y][x] = COL.top;
    else if (inside(LEFT, px, py)) g[y][x] = COL.left;
    else if (inside(RIGHT, px, py)) g[y][x] = x === 8 && y >= 8 ? COL.shade : COL.right;
  }
  // the app logo leaves 3 see-through "crease" pixels between the top and right faces; at larger sizes
  // they read as stray dots, so fill each with the face colour to its right
  for (let y = 0; y < 16; y++) for (let x = 1; x < 15; x++) if (!g[y][x] && g[y][x - 1] && g[y][x + 1]) g[y][x] = g[y][x + 1];
  if (outline) {
    // 1px ring (4-neighbour) in midnight grape
    const add = [];
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      if (g[y][x]) continue;
      if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => g[y + dy]?.[x + dx] && g[y + dy][x + dx] !== COL.outline)) add.push([x, y]);
    }
    for (const [x, y] of add) g[y][x] = COL.outline;
  }
  return g;
}

// ---- nearest-neighbour upscale to RGBA
function rgba(g, size) {
  const k = size / 16, out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const c = g[Math.floor(y / k)][Math.floor(x / k)], i = (y * size + x) * 4;
    if (c) { out[i] = c[0]; out[i + 1] = c[1]; out[i + 2] = c[2]; out[i + 3] = 255; }
  }
  return out;
}

// ---- tiny PNG encoder
const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc32 = b => { let c = -1; for (const x of b) c = CRC[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(px, w, h) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; px.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4); }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// ---- ICO: classic 32-bit BMP entries for the small sizes, PNG for 256 (what Windows itself does)
function bmpEntry(px, s) {
  const head = Buffer.alloc(40);
  head.writeUInt32LE(40, 0); head.writeInt32LE(s, 4); head.writeInt32LE(s * 2, 8);
  head.writeUInt16LE(1, 12); head.writeUInt16LE(32, 14);
  const maskRow = Math.ceil(s / 32) * 4;
  head.writeUInt32LE(s * s * 4 + maskRow * s, 20);
  const body = Buffer.alloc(s * s * 4);
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) { // bottom-up BGRA
    const si = (y * s + x) * 4, di = ((s - 1 - y) * s + x) * 4;
    body[di] = px[si + 2]; body[di + 1] = px[si + 1]; body[di + 2] = px[si]; body[di + 3] = px[si + 3];
  }
  return Buffer.concat([head, body, Buffer.alloc(maskRow * s)]);
}
function ico(g, sizes) {
  const imgs = sizes.map(s => (s >= 256 ? png(rgba(g, s), s, s) : bmpEntry(rgba(g, s), s)));
  const head = Buffer.alloc(6); head.writeUInt16LE(1, 2); head.writeUInt16LE(sizes.length, 4);
  let off = 6 + 16 * sizes.length;
  const dir = sizes.map((s, i) => {
    const e = Buffer.alloc(16);
    e[0] = s >= 256 ? 0 : s; e[1] = s >= 256 ? 0 : s; e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6);
    e.writeUInt32LE(imgs[i].length, 8); e.writeUInt32LE(off, 12); off += imgs[i].length;
    return e;
  });
  return Buffer.concat([head, ...dir, ...imgs]);
}

// ---- SVG (one <rect> per pixel run, crisp at any size)
function svg(g) {
  const hex = c => '#' + c.map(v => v.toString(16).padStart(2, '0')).join('');
  let rects = '';
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16;) {
    const c = g[y][x]; if (!c) { x++; continue; }
    let w = 1; while (x + w < 16 && g[y][x + w] === c) w++;
    rects += `<rect x="${x}" y="${y}" width="${w}" height="1" fill="${hex(c)}"/>`; x += w;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" shape-rendering="crispEdges">${rects}</svg>\n`;
}

const icon = grid(true), mark = grid(false);
writeFileSync(join(here, 'icon.ico'), ico(icon, [16, 32, 48, 64, 128, 256]));
writeFileSync(join(here, 'favicon.ico'), ico(icon, [16, 32, 48]));
for (const s of [16, 32, 48, 64, 128, 256, 512, 1024]) writeFileSync(join(here, `icon-${s}.png`), png(rgba(icon, s), s, s));
writeFileSync(join(here, 'icon.svg'), svg(icon));
writeFileSync(join(here, 'logo-mark.svg'), svg(mark)); // no outline: for dark backgrounds, as in the app's top bar
writeFileSync(join(promo, 'icon_og_placeholder.png'), png(rgba(icon, 1024), 1024, 1024));
console.log('icons written');
