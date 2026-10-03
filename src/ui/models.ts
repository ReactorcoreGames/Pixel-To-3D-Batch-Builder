/* Phase 2 for the UI: each ② row's sheet read back (core/reader.ts), its voxel model (core/voxel.ts) and everything
   made from it (core/exports.ts), cached. Reads are cached per picture. Models are cached per picture and shape
   settings; only the last few full models are kept (a box-128 model is a few MB), but every row's cut-off paint count
   stays known for the table. The previews and the Run button share these caches through `partsOf`. */

import {
  cellOrigin, meshReady, readSheet, rowColoured, rowFill, rowInside, rowMesh, rowModel, rowRenderOptions, rowTurntable, surfaceMaps,
  modelPalette, sidePictures, stackStrip, writeVox, type StackAxis, type ColouredModel, type ExportSettings, type InsideShader, type ModelParts, type RGBAImage, type SheetRead, type SurfaceMaps,
  type TexturedMesh, type VoxelFill, type VoxelModel, type VoxFile, parseHexPalette, renderSetFrames, type Palettes, type RenderOptions,
  type RenderSource, type SetFrame, type SpriteSetSettings, voxelSource, type DrawFromCode,
} from '../core';
import doomHex from '../../presets/palettes/doom.hex?raw';
import { INSIDE_PAL } from './presets';
import { images, S, type SheetRow } from './state';

const reads = new Map<string, SheetRead>();

/** The row's sheet, read back from its picture. */
export function readOf(r: SheetRow): SheetRead {
  const hit = reads.get(r.image!);
  if (hit) return hit;
  const im = images.get(r.image!)!;
  const read = readSheet(im.img, im.path);
  reads.set(r.image!, read);
  return read;
}

/** A small cache that forgets the least recently used entry. */
class Lru<V> {
  private map = new Map<string, V>();
  constructor(private size: number) {}
  get(k: string, make: () => V): V {
    let v = this.map.get(k);
    if (v !== undefined) this.map.delete(k);
    else v = make();
    this.map.set(k, v);
    if (this.map.size > this.size) this.map.delete(this.map.keys().next().value!);
    return v;
  }
  clear() { this.map.clear(); }
}

/** Everything the voxel model depends on. */
export const modelKeyOf = (r: SheetRow) => [r.image, r.side, r.shape, r.ends, r.sx, r.sy, r.sz, r.bstyle, r.bw].join('|');
const models = new Lru<VoxelModel>(6);
const coloured = new Lru<ColouredModel>(4);
/** Cut-off paint per model key, kept for every row so the table never has to rebuild a model to draw a status. */
const trimCounts = new Map<string, number>();

/** The row's voxel model, or null when its sheet can't be read. */
export function modelOf(r: SheetRow): VoxelModel | null {
  const read = readOf(r);
  if (read.problem) return null;
  const key = modelKeyOf(r);
  return models.get(key, () => {
    const m = rowModel(read, r);
    trimCounts.set(key, m.trimmed.length);
    return m;
  });
}

/** How many painted pixels didn't make it onto the model (0 when the sheet can't be read). */
export function trimCountOf(r: SheetRow): number {
  const key = modelKeyOf(r), known = trimCounts.get(key);
  if (known !== undefined) return known;
  return modelOf(r)?.trimmed.length ?? 0;
}

/** Surface colours, distance to the surface and local thickness of the row's model. */
export function colouredOf(r: SheetRow): ColouredModel | null {
  const m = modelOf(r);
  if (!m) return null;
  return coloured.get(modelKeyOf(r) + '|' + r.fb, () => rowColoured(m, readOf(r), r));
}

/** The row's inside style as a colour formula (the row's Inside colours, Noise and Pattern). */
export const insideOf = (r: SheetRow): InsideShader => rowInside(r, INSIDE_PAL);

/** Everything that decides the voxels inside the model: the inside style, its settings and the hollow core. */
export const insideKeyOf = (r: SheetRow) => [r.inside, r.icol, r.inoise, r.iscale, r.hcore].join();

/** What fills the row's model, for the voxel file and the Voxels view. */
export const fillOf = (r: SheetRow): VoxelFill => rowFill(r, INSIDE_PAL);

const voxFiles = new Lru<VoxFile>(4);
/** The row's .vox file (voxels, palette and the file itself), or null when the sheet can't be read. */
export function voxFileOf(r: SheetRow, tooMany: 'merge' | 'skip'): VoxFile | null {
  const m = modelOf(r), c = colouredOf(r);
  if (!m || !c) return null;
  return voxFiles.get([modelKeyOf(r), r.fb, insideKeyOf(r), tooMany].join('|'), () => writeVox(m, c, fillOf(r), tooMany));
}

/** The six side pictures, the stack strip and the palette (DESIGN.md §11), the same as the export writes. */
export function sidesOf(r: SheetRow) {
  const m = modelOf(r);
  return m ? sidePictures(readOf(r), m) : {};
}
export function stackOf(r: SheetRow, axis: StackAxis, order: 'bottom' | 'top') {
  const m = modelOf(r), c = colouredOf(r);
  return m && c ? stackStrip(m, c, axis, order) : null;
}
export function paletteOf(r: SheetRow) {
  const m = modelOf(r), c = colouredOf(r);
  return m && c ? modelPalette(m, c) : null;
}

/** Painted pixels that didn't make it onto the model, in sheet picture coordinates. */
export function trimmedOnSheet(r: SheetRow): [number, number][] {
  const m = modelOf(r);
  if (!m) return [];
  return m.trimmed.map(t => { const [cx, cy] = cellOrigin(t.panel, m.n); return [cx + t.x, cy + t.y]; });
}

/** Everything the low-poly mesh and its texture depend on. */
export const meshKeyOf = (r: SheetRow) => [modelKeyOf(r), r.slope, r.sides, r.fb].join('|');
const meshes = new Lru<TexturedMesh>(6);

/** The row's textured low-poly mesh, or null when the sheet can't be read or the mesh library is still loading. */
export function meshOf(r: SheetRow): TexturedMesh | null {
  const m = modelOf(r);
  if (!m || !meshReady()) return null;
  return meshes.get(meshKeyOf(r), () => rowMesh(m, readOf(r), r));
}

const surfaceCache = new WeakMap<RGBAImage, Map<string, RGBAImage>>();
/** A picture made from a mesh's atlas, cached per atlas and settings key. */
function fromAtlas(t: TexturedMesh, key: string, make: () => RGBAImage): RGBAImage {
  let byKey = surfaceCache.get(t.atlas);
  if (!byKey) surfaceCache.set(t.atlas, byKey = new Map());
  let img = byKey.get(key);
  if (!img) byKey.set(key, img = make());
  return img;
}

/** The row's surface textures under the 3D model export settings. Unlit rows only ever get painted-in shadows. */
export const surfaceOf = (t: TexturedMesh, r: SheetRow, g: ExportSettings['glb']): SurfaceMaps => surfaceMaps(t, r, g, (k, make) => fromAtlas(t, k, make));

/** Forgets every read and model (after pictures were replaced). */
export function clearModels() {
  reads.clear(); models.clear(); coloured.clear(); trimCounts.clear(); meshes.clear(); voxFiles.clear(); setFrames.clear(); turns.clear(); voxSources.clear();
}

// ------------------------------------------------------------------ rendered sprites and the turntable (DESIGN.md §11)

export const PALETTES: Palettes = { doom: parseHexPalette(doomHex) };

/** How the row's model is drawn for a sprite set (or the turntable, `st` null): the look, unlit rows unshaded, and
    the colours to snap to. */
export function renderOptionsOf(r: SheetRow, st: SpriteSetSettings | null): RenderOptions {
  return rowRenderOptions(r, st, S.exp.look, paletteOf(r) ?? [], PALETTES);
}

const voxSources = new Lru<RenderSource>(4);
/** What the renderer draws: the row's mesh with the 3D model card's colour texture (painted-in crevice shadows show),
    or its voxel model with the voxel file's colours. Null when the sheet can't be read or the mesh isn't loaded yet. */
export function renderSourceOf(r: SheetRow, from: DrawFromCode = 'mesh'): RenderSource | null {
  if (from === 'voxels') {
    const m = modelOf(r), c = colouredOf(r);
    return m && c && voxSources.get(modelKeyOf(r) + '|' + r.fb, () => voxelSource(m, c));
  }
  const t = meshOf(r);
  return t && { ...t, atlas: surfaceOf(t, r, S.exp.glb).atlas };
}
/** Whether a source can be drawn yet (the mesh library loads in the background; voxels need nothing). */
export const sourceReady = (from: DrawFromCode) => from === 'voxels' || meshReady();

const renderKey = (r: SheetRow) => [meshKeyOf(r), r.mat, S.exp.glb.ao, S.exp.glb.style, S.exp.glb.aoDepth, JSON.stringify(S.exp.look)].join('|');
const setFrames = new Lru<SetFrame[]>(8);
/** A sprite set's drawn pictures of the row's model at `size` (the preview draws them smaller than the export). */
export function setFramesOf(r: SheetRow, st: SpriteSetSettings, size: number, angles?: number[]): SetFrame[] | null {
  const src = renderSourceOf(r, st.from);
  if (!src) return null;
  return setFrames.get([renderKey(r), JSON.stringify(st), size, angles].join('|'), () => renderSetFrames(src, st, r.side, renderOptionsOf(r, st), size, angles));
}

const turns = new Lru<RGBAImage[]>(2);
/** The turntable's frames for the row at `size`. */
export function turntableOf(r: SheetRow, size: number): RGBAImage[] | null {
  const t = S.exp.turntable, src = renderSourceOf(r, t.from);
  if (!src) return null;
  return turns.get([renderKey(r), t.elev, t.frames, t.from, size].join('|'), () => rowTurntable(src, t, size, renderOptionsOf(r, null)));
}

/** The row's parts for the shared export (core/exports.ts), backed by the caches above. */
export function partsOf(r: SheetRow): ModelParts {
  return {
    read: readOf(r), model: () => modelOf(r), coloured: () => colouredOf(r), mesh: () => meshOf(r),
    surface: t => surfaceOf(t, r, S.exp.glb), voxFile: tooMany => voxFileOf(r, tooMany), sides: () => sidesOf(r),
    stack: (axis, order) => stackOf(r, axis, order), palette: () => paletteOf(r), renderSource: from => renderSourceOf(r, from),
    renderOptions: st => renderOptionsOf(r, st), turntable: size => turntableOf(r, size),
  };
}
