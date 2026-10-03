/* A small animated GIF writer for the turntable export (DESIGN.md §11), written by hand like the PNG and GLB writers
   so the core runs without a browser. One shared colour table (up to 255 colours plus see-through), frames that are
   cleared before the next one, looping forever. */

import { nearestColour, quantize } from './palette';
import { colourCounts } from './render';
import type { RGBAImage } from './types';

/** Writes the frames (all the same size) as a looping GIF, `delay` hundredths of a second each. Pixels are either
    see-through (alpha below half) or solid; with more than 255 colours they are merged. */
export function writeGif(frames: RGBAImage[], delay: number): Uint8Array {
  const w = frames[0].width, h = frames[0].height;
  const counts = colourCounts(frames.map(f => ({ ...f, data: solidOnly(f.data) })));
  const palette = counts.size <= 255 ? [...counts.keys()] : quantize(counts, 255);
  const index = new Map<number, number>();
  palette.forEach((c, i) => index.set(c, i + 1));
  const out: number[] = [];
  const u16 = (v: number) => out.push(v & 255, (v >> 8) & 255);
  const text = (s: string) => { for (const ch of s) out.push(ch.charCodeAt(0)); };
  text('GIF89a'); u16(w); u16(h);
  out.push(0xf7, 0, 0); // global colour table of 256 entries, background 0, square pixels
  for (let i = 0; i < 256; i++) { const c = i === 0 ? 0 : palette[i - 1] ?? 0; out.push(c >> 16, (c >> 8) & 255, c & 255); }
  out.push(0x21, 0xff, 11); text('NETSCAPE2.0'); out.push(3, 1); u16(0); out.push(0); // loop forever
  for (const f of frames) {
    out.push(0x21, 0xf9, 4, 0x09); u16(delay); out.push(0, 0); // clear to background after, colour 0 is see-through
    out.push(0x2c); u16(0); u16(0); u16(w); u16(h); out.push(0);
    const px = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) {
      if (f.data[i * 4 + 3] < 128) continue;
      const c = (f.data[i * 4] << 16) | (f.data[i * 4 + 1] << 8) | f.data[i * 4 + 2];
      let j = index.get(c);
      if (j === undefined) index.set(c, j = nearestColour(c, palette) + 1);
      px[i] = j;
    }
    out.push(8);
    const data = lzw(px, 8);
    for (let o = 0; o < data.length; o += 255) { const n = Math.min(255, data.length - o); out.push(n); for (let i = 0; i < n; i++) out.push(data[o + i]); }
    out.push(0);
  }
  out.push(0x3b);
  return new Uint8Array(out);
}

/** A copy of the pixels where half-see-through ones are fully see-through, so they don't take palette slots. */
function solidOnly(d: ArrayLike<number>) {
  const o = Uint8Array.from(d);
  for (let i = 3; i < o.length; i += 4) o[i] = o[i] < 128 ? 0 : 255;
  return o;
}

/** GIF's variable-length LZW, codes packed least significant bit first. */
function lzw(px: Uint8Array, minSize: number): Uint8Array {
  const clear = 1 << minSize, eoi = clear + 1, out: number[] = [];
  let size = minSize + 1, next = eoi + 1, acc = 0, bits = 0;
  const table = new Map<number, number>();
  const emit = (code: number) => {
    acc |= code << bits; bits += size;
    while (bits >= 8) { out.push(acc & 255); acc >>>= 8; bits -= 8; }
  };
  emit(clear);
  let prefix = px[0];
  for (let i = 1; i < px.length; i++) {
    const k = px[i], key = prefix * 256 + k, hit = table.get(key);
    if (hit !== undefined) { prefix = hit; continue; }
    emit(prefix);
    if (next === 4096) { emit(clear); table.clear(); size = minSize + 1; next = eoi + 1; }
    else { if (next >= 1 << size) size++; table.set(key, next++); }
    prefix = k;
  }
  emit(prefix); emit(eoi);
  if (bits > 0) out.push(acc & 255);
  return new Uint8Array(out);
}
