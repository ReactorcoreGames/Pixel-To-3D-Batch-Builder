/* The 2D exports made from a Phase 2 model (DESIGN.md §11): the six side pictures, the sprite stack strip and the
   model's colour palette. */

import { luminance } from './palette';
import type { SheetRead } from './reader';
import { panelPixel, VIEW } from './sheet';
import { SIDE_CODES, type RGBAImage, type SideCode } from './types';
import type { ColouredModel, VoxelModel } from './voxel';

/** The panels in file-name order, with the name each side picture gets (`rifle_front.png`). */
export const SIDE_FILE_NAMES: Record<SideCode, string> = { F: 'front', Bk: 'back', L: 'left', R: 'right', T: 'top', Bt: 'bottom' };

/** The model's box as seen on one panel: [x0, y0, x1, y1] in panel pixels, inclusive. */
export function panelBox(m: VoxelModel, p: SideCode): [number, number, number, number] {
  const a = VIEW[p].px[0], b = VIEW[p].py[0], c = [0, 0, 0];
  const xs: number[] = [], ys: number[] = [];
  for (const u of [m.lo[a], m.hi[a]]) for (const v of [m.lo[b], m.hi[b]]) {
    c[a] = u; c[b] = v;
    const [px, py] = panelPixel(p, c, m.n);
    xs.push(px); ys.push(py);
  }
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/** The six sides as painted on the sheet, each cropped to the model's box, so Front and Back (and so on) come out the
    same size and line up with the model. Paint outside the model's box is left out. Empty when the model is empty. */
export function sidePictures(read: SheetRead, m: VoxelModel): Partial<Record<SideCode, RGBAImage>> {
  const out: Partial<Record<SideCode, RGBAImage>> = {};
  if (!m.count) return out;
  const n = read.n!;
  for (const p of SIDE_CODES) {
    const [x0, y0, x1, y1] = panelBox(m, p), w = x1 - x0 + 1, h = y1 - y0 + 1, src = read.panels![p];
    const data = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) data.set(src.subarray(((y0 + y) * n + x0) * 4, ((y0 + y) * n + x1 + 1) * 4), y * w * 4);
    out[p] = { width: w, height: h, data };
  }
  return out;
}

export type StackAxis = 'y' | 'z' | 'x';

/**
 * The sprite stack strip: the model cut into one-voxel layers along an axis, side by side in one picture, first
 * layer on the left. Each layer is seen from the way the stack grows: height layers from above (front edge at the
 * bottom, like the Top panel), depth layers from the front, width layers from the right. Bottom first means the
 * low end first (bottom, back, left). Inside voxels show the colour of the nearest surface, so a layer's cut face
 * continues the outside wherever it shows.
 */
export function stackStrip(m: VoxelModel, c: ColouredModel, axis: StackAxis, order: 'bottom' | 'top'): { image: RGBAImage; layers: number; w: number; h: number } {
  const { n, lo, hi } = m, size = [0, 1, 2].map(k => Math.max(0, hi[k] - lo[k] + 1));
  const k = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
  const layers = size[k];
  // picture x and y of a voxel within its layer
  const [w, h] = k === 1 ? [size[0], size[2]] : k === 2 ? [size[0], size[1]] : [size[2], size[1]];
  const pos = (x: number, y: number, z: number): [number, number] =>
    k === 1 ? [x - lo[0], z - lo[2]] : k === 2 ? [x - lo[0], hi[1] - y] : [hi[2] - z, hi[1] - y];
  const image: RGBAImage = { width: w * layers, height: h, data: new Uint8Array(w * layers * h * 4) };
  for (let z = lo[2]; z <= hi[2]; z++) for (let y = lo[1]; y <= hi[1]; y++) for (let x = lo[0]; x <= hi[0]; x++) {
    const i = (z * n + y) * n + x;
    if (!m.solid[i]) continue;
    const layer = [x, y, z][k] - lo[k], slot = order === 'bottom' ? layer : layers - 1 - layer;
    const [px, py] = pos(x, y, z), o = (py * image.width + slot * w + px) * 4, col = c.colour[i];
    image.data[o] = col >> 16; image.data[o + 1] = (col >> 8) & 255; image.data[o + 2] = col & 255; image.data[o + 3] = 255;
  }
  return { image, layers, w, h };
}

/** The model's own colours: every colour on its surface, dark to light. */
export function modelPalette(m: VoxelModel, c: ColouredModel): number[] {
  const set = new Set<number>();
  const { n, lo, hi } = m;
  for (let z = lo[2]; z <= hi[2]; z++) for (let y = lo[1]; y <= hi[1]; y++) for (let x = lo[0]; x <= hi[0]; x++) {
    const i = (z * n + y) * n + x;
    if (m.solid[i] && c.dist[i] === 1) set.add(c.colour[i]);
  }
  return [...set].sort((a, b) => luminance(a) - luminance(b) || a - b);
}
