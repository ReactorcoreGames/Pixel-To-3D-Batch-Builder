/* A small PNG encoder and decoder, so the core can turn RGBA buffers into files and back without a browser.
   Compression is fflate's zlib. The encoder always writes 8-bit RGBA; the decoder reads every non-interlaced
   PNG (grey, RGB, palette, grey + alpha, RGBA, 1 to 16 bits) plus Adam7-interlaced ones. */

import { unzlibSync, zlibSync } from 'fflate';
import type { RGBAImage } from './types';

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array, start: number, end: number) {
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = CRC_TABLE[(c ^ bytes[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ------------------------------------------------------------------ encoder

/** Encodes an RGBA picture as an 8-bit RGBA PNG. Each row uses the filter that compresses best by the usual heuristic.
    `grab` adds Doom's `grAb` chunk (the sprite's x / y offsets, read by SLADE, ZDoom and GZDoom). */
export function encodePng(img: RGBAImage, grab?: [number, number]): Uint8Array {
  const { width: w, height: h, data } = img, stride = w * 4;
  const raw = new Uint8Array((stride + 1) * h), cand = new Uint8Array(stride);
  for (let y = 0; y < h; y++) {
    const row = y * stride, prev = row - stride, out = y * (stride + 1);
    let best = 0, bestScore = Infinity;
    for (let f = 0; f < 5; f++) {
      let score = 0;
      for (let i = 0; i < stride; i++) {
        const x = data[row + i], a = i >= 4 ? data[row + i - 4] : 0, b = y ? data[prev + i] : 0, c = y && i >= 4 ? data[prev + i - 4] : 0;
        const v = (x - (f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : paeth(a, b, c))) & 255;
        cand[i] = v; score += v < 128 ? v : 256 - v;
      }
      if (score < bestScore) { bestScore = score; best = f; raw.set(cand, out + 1); }
    }
    raw[out] = best;
  }
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w); dv.setUint32(4, h);
  ihdr.set([8, 6, 0, 0, 0], 8); // 8 bits, RGBA, deflate, no filter method, not interlaced
  const extra: Uint8Array[] = [];
  if (grab) {
    const g = new Uint8Array(8), gv = new DataView(g.buffer);
    gv.setInt32(0, grab[0]); gv.setInt32(4, grab[1]);
    extra.push(chunk('grAb', g));
  }
  return concat([new Uint8Array(SIGNATURE), chunk('IHDR', ihdr), ...extra, chunk('IDAT', zlibSync(raw, { level: 9 })), chunk('IEND', new Uint8Array(0))]);
}

function paeth(a: number, b: number, c: number) {
  const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

function chunk(type: string, body: Uint8Array) {
  const out = new Uint8Array(body.length + 12), dv = new DataView(out.buffer);
  dv.setUint32(0, body.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(body, 8);
  dv.setUint32(8 + body.length, crc32(out, 4, 8 + body.length));
  return out;
}

function concat(parts: Uint8Array[]) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

// ------------------------------------------------------------------ decoder

/** Decodes a PNG file into 8-bit RGBA. Throws on anything that isn't a readable PNG. */
export function decodePng(file: Uint8Array): RGBAImage {
  for (let i = 0; i < 8; i++) if (file[i] !== SIGNATURE[i]) throw new Error('Not a PNG file');
  const dv = new DataView(file.buffer, file.byteOffset, file.byteLength);
  let w = 0, h = 0, depth = 0, type = 0, interlace = 0;
  let palette: Uint8Array | null = null, trns: Uint8Array | null = null;
  const idat: Uint8Array[] = [];
  for (let p = 8; p + 8 <= file.length;) {
    const len = dv.getUint32(p), kind = String.fromCharCode(...file.subarray(p + 4, p + 8)), body = file.subarray(p + 8, p + 8 + len);
    if (kind === 'IHDR') { w = dv.getUint32(p + 8); h = dv.getUint32(p + 12); depth = body[8]; type = body[9]; interlace = body[12]; }
    else if (kind === 'PLTE') palette = body;
    else if (kind === 'tRNS') trns = body;
    else if (kind === 'IDAT') idat.push(body);
    else if (kind === 'IEND') break;
    p += len + 12;
  }
  if (!w || !h) throw new Error('PNG has no image header');
  const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[type];
  if (!channels) throw new Error(`Unsupported PNG colour type ${type}`);
  if (type === 3 && !palette) throw new Error('Palette PNG without a palette');
  const bitsPerPixel = channels * depth, bpp = Math.max(1, bitsPerPixel >> 3);
  const raw = unzlibSync(concat(idat));
  const out = new Uint8Array(w * h * 4);

  const passes = interlace
    ? [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]]
    : [[0, 0, 1, 1]];
  let offset = 0;
  for (const [x0, y0, dx, dy] of passes) {
    const pw = Math.ceil((w - x0) / dx), ph = Math.ceil((h - y0) / dy);
    if (pw <= 0 || ph <= 0) continue;
    const stride = Math.ceil(pw * bitsPerPixel / 8);
    let prev = new Uint8Array(stride), cur = new Uint8Array(stride);
    for (let y = 0; y < ph; y++) {
      const f = raw[offset++];
      for (let i = 0; i < stride; i++) {
        const x = raw[offset + i], a = i >= bpp ? cur[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
        cur[i] = (x + (f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : paeth(a, b, c))) & 255;
      }
      offset += stride;
      for (let x = 0; x < pw; x++) writePixel(cur, x, out, ((y0 + y * dy) * w + x0 + x * dx) * 4);
      [prev, cur] = [cur, prev];
    }
  }
  return { width: w, height: h, data: out };

  function sample(row: Uint8Array, index: number): number {
    if (depth === 8) return row[index];
    if (depth === 16) return row[index * 2]; // the high byte is enough for 8-bit output
    const bit = index * depth, v = (row[bit >> 3] >> (8 - depth - (bit & 7))) & ((1 << depth) - 1);
    return v;
  }
  function writePixel(row: Uint8Array, x: number, o: Uint8Array, i: number) {
    const scale = depth < 8 ? 255 / ((1 << depth) - 1) : 1;
    if (type === 3) {
      const k = sample(row, x);
      o[i] = palette![k * 3]; o[i + 1] = palette![k * 3 + 1]; o[i + 2] = palette![k * 3 + 2];
      o[i + 3] = trns && k < trns.length ? trns[k] : 255;
    } else if (type === 0 || type === 4) {
      const g = sample(row, x * channels);
      o[i] = o[i + 1] = o[i + 2] = Math.round(g * scale);
      o[i + 3] = type === 4 ? sample(row, x * 2 + 1) : trns && trnsMatch(g) ? 0 : 255;
    } else {
      o[i] = sample(row, x * channels); o[i + 1] = sample(row, x * channels + 1); o[i + 2] = sample(row, x * channels + 2);
      o[i + 3] = type === 6 ? sample(row, x * 4 + 3) : trns && trnsMatch(o[i], o[i + 1], o[i + 2]) ? 0 : 255;
    }
  }
  // tRNS for grey/RGB names one transparent colour, stored as 16-bit values
  function trnsMatch(...c: number[]) {
    const t = new DataView(trns!.buffer, trns!.byteOffset, trns!.byteLength);
    return c.every((v, k) => (depth === 16 ? t.getUint16(k * 2) >> 8 : t.getUint16(k * 2)) === v);
  }
}
