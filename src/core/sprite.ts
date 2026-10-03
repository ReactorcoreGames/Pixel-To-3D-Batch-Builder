/* Phase 1 sprite rules: model size from (width, height, thickness, side), cube size, filename side suffix
   and the checks that turn a row into an error (DESIGN.md §3, §4). */

import { CUBE_SIZES, MAX_SIZE, SIDE_CODES, SOLID_ALPHA, type RGBAImage, type SideCode } from './types';

/** World X × Y × Z of the model: the sprite's own width/height land on the axes its side faces. */
export function modelSize(w: number, h: number, thickness: number, side: SideCode): [number, number, number] {
  if (side === 'L' || side === 'R') return [thickness, h, w];
  if (side === 'T' || side === 'Bt') return [w, thickness, h];
  return [w, h, thickness];
}

/** The largest dimension rounded up to 8, 16, 32, 64 or 128; null when it doesn't fit in 128. */
export function cubeSize(largest: number): number | null {
  return CUBE_SIZES.find(v => v >= largest) ?? null;
}

const SUFFIX = new RegExp(`_(${SIDE_CODES.join('|')})$`);
const stripPng = (file: string) => file.replace(/\.png$/i, '');

/** The side code at the end of a filename, e.g. `sword_R.png` → `R`. Codes are case-sensitive, as in DESIGN.md §3. */
export function sideFromFilename(file: string): SideCode | null {
  const m = stripPng(file).match(SUFFIX);
  return m ? (m[1] as SideCode) : null;
}

/** The filename without `.png` and without a side suffix: the base of the sheet name. */
export function baseName(file: string): string {
  return stripPng(file).replace(SUFFIX, '');
}

/** The last part of a path, whichever slash it uses. */
export function fileOf(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

/** True when the picture has at least one pixel at alpha ≥ 50%. */
export function hasSolidPixels(img: RGBAImage): boolean {
  const a = img.data;
  for (let i = 3; i < a.length; i += 4) if (a[i] >= SOLID_ALPHA) return true;
  return false;
}

/** A short fingerprint of a picture's pixels (FNV-1a, 32-bit, as 8 hex digits). Fully see-through pixels count as
    the same whatever their colour, since editors and canvases don't keep the colour of an invisible pixel. */
export function pixelHash(img: RGBAImage): string {
  let h = 0x811c9dc5;
  const mix = (b: number) => { h ^= b; h = Math.imul(h, 0x01000193); };
  for (const v of [img.width, img.height]) { mix(v & 255); mix(v >> 8); }
  const a = img.data;
  for (let i = 0; i < a.length; i += 4) {
    if (!a[i + 3]) { mix(0); mix(0); mix(0); mix(0); continue; }
    mix(a[i]); mix(a[i + 1]); mix(a[i + 2]); mix(a[i + 3]);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export type SpriteProblem = 'too-big' | 'too-thick' | 'empty';

export interface SpriteCheck {
  size: [number, number, number];
  /** Cube size N, or null when the model is over 128. */
  n: number | null;
  problem: SpriteProblem | null;
}

/** Everything the Phase 1 row needs to know about a sprite. A row with a problem is skipped by Run. */
export function checkSprite(w: number, h: number, thickness: number, side: SideCode, empty = false): SpriteCheck {
  const size = modelSize(w, h, thickness, side);
  const n = cubeSize(Math.max(...size));
  let problem: SpriteProblem | null = null;
  if (w > MAX_SIZE || h > MAX_SIZE) problem = 'too-big';
  else if (!n) problem = 'too-thick';
  else if (empty) problem = 'empty';
  return { size, n, problem };
}
