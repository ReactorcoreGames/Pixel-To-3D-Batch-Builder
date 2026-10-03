/* The MagicaVoxel .vox export (DESIGN.md §8): the voxel model with its surface colours and the row's inside style,
   minus a hollow core, with a palette of at most 255 colours.

   The file is the classic minimal form every .vox reader understands: "VOX " version 150, a MAIN chunk holding SIZE
   (the model's box), XYZI (one x, y, z, colour index byte each) and RGBA (256 entries; entry k is colour index k + 1).
   MagicaVoxel is Z-up with the front facing −Y, so the model's (x, y, z) (y up, front towards +z) becomes
   (x, back-to-front reversed, y): a turn, not a mirror, so nothing comes out flipped. */

import { colourDistance, nearestColour, quantize } from './palette';
import type { InsideCode } from './types';
import type { ColouredModel, InsideShader, VoxelModel } from './voxel';

/** What fills the model: the row's inside style and its hollow core (0 = solid, N = walls N voxels thick). */
export interface VoxelFill { inside: InsideCode; shader: InsideShader | null; hollowCore: number }

/** Whether a voxel at this distance to the surface (1 = surface) is in the voxel file and the Voxels view: the surface
    always; inside voxels unless the style is Hollow or they are deeper than the hollow core. */
export const keepsVoxel = (dist: number, inside: InsideCode, hollowCore: number) =>
  dist === 1 || (dist > 1 && inside !== 'hollow' && (hollowCore <= 0 || dist <= hollowCore));

/** The voxels a file holds (cube indices) and their colours. */
export interface VoxelList { index: Int32Array; colour: Uint32Array; surface: Uint8Array; count: number }

export function voxelList(m: VoxelModel, c: ColouredModel, fill: VoxelFill): VoxelList {
  const { n, lo, hi } = m;
  const index = new Int32Array(m.count), colour = new Uint32Array(m.count), surface = new Uint8Array(m.count);
  let k = 0;
  for (let z = lo[2]; z <= hi[2]; z++) for (let y = lo[1]; y <= hi[1]; y++) for (let x = lo[0]; x <= hi[0]; x++) {
    const i = (z * n + y) * n + x, d = c.dist[i];
    if (!m.solid[i] || !keepsVoxel(d, fill.inside, fill.hollowCore)) continue;
    index[k] = i; surface[k] = d === 1 ? 1 : 0;
    colour[k] = d === 1 || !fill.shader ? c.colour[i] : fill.shader(x, y, z, d, c.deep[i], c.colour[i]) >>> 0;
    k++;
  }
  return { index: index.subarray(0, k), colour: colour.subarray(0, k), surface: surface.subarray(0, k), count: k };
}

/** Palette slots in a .vox file, and how many of them the inside may take when colours have to be merged. */
export const VOX_SLOTS = 255;
export const INSIDE_SLOTS = 32;

export interface VoxPalette {
  /** The palette (at most 255 colours); index i is file colour index i + 1. */
  colours: number[];
  /** Palette index per voxel of the list. */
  pick: Uint8Array;
  /** Different colours before merging (surface and inside). */
  distinct: number;
  /** Surface colours before merging: the colours painted on the sheet that made it onto the model. */
  surfaceColours: number;
  /** Colours had to be merged. */
  merged: boolean;
  /** The surface colours alone didn't fit (what "Warn me and skip the file" skips on). */
  surfaceMerged: boolean;
}

/**
 * The file's palette. When everything fits, every colour is kept exactly. Otherwise the inside keeps up to 32 slots
 * and is merged into them (its shades are made by the inside style, so merging them costs little), and the surface
 * keeps every colour if it fits into the rest, or is merged into it. Inside colours may also use surface slots.
 */
export function voxPalette(list: VoxelList): VoxPalette {
  const surf = new Map<number, number>(), ins = new Map<number, number>();
  for (let k = 0; k < list.count; k++) {
    const map = list.surface[k] ? surf : ins, col = list.colour[k];
    map.set(col, (map.get(col) ?? 0) + 1);
  }
  for (const col of surf.keys()) ins.delete(col); // inside voxels coloured like the surface need no slot of their own
  const distinct = surf.size + ins.size;
  let colours: number[];
  let surfaceMerged = false;
  if (distinct <= VOX_SLOTS) colours = [...surf.keys(), ...ins.keys()];
  else {
    const reserve = Math.min(ins.size, INSIDE_SLOTS);
    surfaceMerged = surf.size > VOX_SLOTS - reserve;
    const surfPal = quantize(surf, VOX_SLOTS - reserve);
    colours = [...surfPal, ...quantize(ins, VOX_SLOTS - surfPal.length)];
  }
  const lookup = new Map<number, number>();
  const exact = new Map(colours.map((col, i) => [col, i]));
  const pick = new Uint8Array(list.count);
  for (let k = 0; k < list.count; k++) {
    const col = list.colour[k];
    let p = exact.get(col) ?? lookup.get(col);
    if (p === undefined) lookup.set(col, p = nearestColour(col, colours));
    pick[k] = p;
  }
  return { colours, pick, distinct, surfaceColours: surf.size, merged: distinct > VOX_SLOTS, surfaceMerged };
}

export interface VoxFile {
  /** The file, or null when it was skipped or the model is empty. */
  bytes: Uint8Array | null;
  voxels: number;
  palette: VoxPalette;
  /** The model's box in MagicaVoxel's axes (x, y, z with z up). */
  size: [number, number, number];
  /** Why no file was made. */
  problem: string | null;
}

/** Writes the .vox file. With `tooMany` = 'skip', a model whose surface colours don't fit into the palette gets no file. */
export function writeVox(m: VoxelModel, c: ColouredModel, fill: VoxelFill, tooMany: 'merge' | 'skip' = 'merge'): VoxFile {
  const list = voxelList(m, c, fill), palette = voxPalette(list);
  const { n, lo, hi } = m;
  const size: [number, number, number] = [hi[0] - lo[0] + 1, hi[2] - lo[2] + 1, hi[1] - lo[1] + 1].map(v => Math.max(0, v)) as [number, number, number];
  const out = (problem: string | null, bytes: Uint8Array | null = null): VoxFile => ({ bytes, voxels: list.count, palette, size, problem });
  if (!list.count) return out('Nothing to build: no voxels are left.');
  if (tooMany === 'skip' && palette.surfaceMerged) return out(`The model uses ${palette.surfaceColours} colours and a .vox file holds ${VOX_SLOTS}, so it was skipped.`);

  const xyzi = 4 + 4 * list.count, children = (12 + 12) + (12 + xyzi) + (12 + 1024);
  const bytes = new Uint8Array(8 + 12 + children), dv = new DataView(bytes.buffer);
  let o = 0;
  const id = (s: string) => { for (let i = 0; i < 4; i++) bytes[o++] = s.charCodeAt(i); };
  const int = (v: number) => { dv.setInt32(o, v, true); o += 4; };
  const chunk = (name: string, content: number, kids = 0) => { id(name); int(content); int(kids); };
  id('VOX '); int(150);
  chunk('MAIN', 0, children);
  chunk('SIZE', 12); int(size[0]); int(size[1]); int(size[2]);
  chunk('XYZI', xyzi); int(list.count);
  for (let k = 0; k < list.count; k++) {
    const i = list.index[k], x = i % n, y = Math.floor(i / n) % n, z = Math.floor(i / (n * n));
    bytes[o++] = x - lo[0]; bytes[o++] = hi[2] - z; bytes[o++] = y - lo[1]; bytes[o++] = palette.pick[k] + 1;
  }
  chunk('RGBA', 1024);
  for (let k = 0; k < 256; k++) {
    const col = palette.colours[k] ?? 0;
    bytes[o++] = col >> 16; bytes[o++] = (col >> 8) & 255; bytes[o++] = col & 255; bytes[o++] = k < palette.colours.length ? 255 : 0;
  }
  return out(null, bytes);
}

/** Reads a .vox file's first model back (for tests and checks): its size, voxels and palette. */
export function readVox(bytes: Uint8Array): { version: number; size: [number, number, number]; voxels: [number, number, number, number][]; palette: number[] } {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const id = (o: number) => String.fromCharCode(...bytes.subarray(o, o + 4));
  if (id(0) !== 'VOX ') throw new Error('not a .vox file');
  const version = dv.getInt32(4, true);
  if (id(8) !== 'MAIN') throw new Error('no MAIN chunk');
  let o = 20;
  const end = 20 + dv.getInt32(16, true) + dv.getInt32(12, true);
  let size: [number, number, number] = [0, 0, 0];
  const voxels: [number, number, number, number][] = [];
  const palette: number[] = [];
  while (o < end) {
    const name = id(o), len = dv.getInt32(o + 4, true), kids = dv.getInt32(o + 8, true), c = o + 12;
    if (name === 'SIZE' && !voxels.length) size = [dv.getInt32(c, true), dv.getInt32(c + 4, true), dv.getInt32(c + 8, true)];
    if (name === 'XYZI' && !voxels.length) for (let k = 0, cnt = dv.getInt32(c, true); k < cnt; k++) voxels.push([bytes[c + 4 + k * 4], bytes[c + 5 + k * 4], bytes[c + 6 + k * 4], bytes[c + 7 + k * 4]]);
    if (name === 'RGBA') for (let k = 0; k < 256; k++) palette.push((bytes[c + k * 4] << 16) | (bytes[c + k * 4 + 1] << 8) | bytes[c + k * 4 + 2]);
    o = c + len + kids;
  }
  return { version, size, voxels, palette };
}

/** How far the file's colours are from the model's, at worst (0 = exact). */
export function worstColourError(list: VoxelList, palette: VoxPalette): number {
  let worst = 0;
  for (let k = 0; k < list.count; k++) worst = Math.max(worst, colourDistance(list.colour[k], palette.colours[palette.pick[k]]));
  return worst;
}
