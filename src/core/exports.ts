/* The export path of both modes (DESIGN.md §11, §12): what one sprite row's sheet and one sheet row's model turn
   into, file by file. The GUI's Run button and the command-line tool both go through here, so they make the same
   files. Each step is a plain function of the row; `ModelParts` bundles them for one row, built on first use. The GUI
   passes its own parts, backed by the caches its previews share. */

import { MATERIAL_PBR, writeGlb } from './glb';
import { buildMesh, meshReady, textureMesh, type TexturedMesh } from './mesh';
import { normalMapOf, occlusionMapOf, shadedAtlas, trimMapOf } from './normalmap';
import { writeGpl, writeHex } from './palette';
import { modelPalette, sidePictures, SIDE_FILE_NAMES, stackStrip } from './pictures';
import { encodePng } from './png';
import type { InsideColours, SpritePreset, SpriteSet, SpriteSetSettings } from './presets';
import type { SheetRead } from './reader';
import { voxelSource, type LookSpec, type RenderSource } from './render';
import type { ExportSettings, FrameColours, SheetRowData, SpriteRowData } from './session';
import { effectiveEnds, parseSheetName, sheetFileName, type SheetOptions } from './sheet';
import { baseName } from './sprite';
import { renderSpriteSet, snapPalette, turntableFrames, writeTurntable, type DrawFromCode, type Palettes, type RenderOptions } from './sprites';
import type { RGBAImage, SideCode } from './types';
import { buildVoxelModel, colourModel, insideShader, type ColouredModel, type InsideShader, type VoxelModel } from './voxel';
import { writeVox, type VoxelFill, type VoxFile } from './vox';

// ------------------------------------------------------------------ ① sprites → sheets

/** The sheet writer's settings for a ① row. */
export const sheetOptionsOf = (r: SpriteRowData, frame: FrameColours): SheetOptions =>
  ({ side: r.side, depth: r.depth, shape: r.shape, ends: r.ends, outlined: r.outline !== false, copySides: !!r.copySides, frame });

/** The file name a ① row's sheet gets, before never-overwrite numbering (`rifle_R.png` → `rifle__32_R_cyW.png`). */
export const sheetNameOf = (r: SpriteRowData, file: string, n: number) => sheetFileName(baseName(file), n, r.side, r.shape, r.ends);

/** The ends a finished sheet's ② row gets ("Also add finished sheets to ②"): flat unless the shape uses them. */
export const handOffEnds = (r: SpriteRowData) => effectiveEnds(r.shape, r.ends);

/** What a ① row's sheet is made from, as one string: the sprite's pixels (`spriteHash`, see `pixelHash`) and every
    ① setting that changes the sheet. A ② row made from it keeps this, so ② can tell when ① changed since. The frame
    colours are left out: they don't change the model. */
export const sheetRecipe = (r: SpriteRowData, spriteHash: string) =>
  [spriteHash, r.side, r.depth, r.shape, handOffEnds(r), r.outline !== false ? 1 : 0, r.copySides ? 1 : 0].join('|');

// ------------------------------------------------------------------ ② one row's model, step by step

/** Everything the voxel model depends on. */
export const rowModel = (read: SheetRead, r: SheetRowData): VoxelModel =>
  buildVoxelModel(read, r.side, r.shape, { x: r.sx, y: r.sy, z: r.sz }, { style: r.bstyle, width: r.bw }, r.ends);

export const rowColoured = (m: VoxelModel, read: SheetRead, r: SheetRowData): ColouredModel => colourModel(m, read, r.side, r.fb);

const hexInt = (h: string) => parseInt(h.slice(1), 16);

/** The row's inside style as a colour formula (its Inside colours, or the style's defaults, Noise and Pattern). */
export function rowInside(r: SheetRowData, defaults: InsideColours): InsideShader {
  const pal = (r.icol ?? defaults[r.inside]).map(hexInt) as [number, number, number];
  return insideShader({ inside: r.inside, colours: pal, noise: r.inoise, scale: r.iscale });
}

/** What fills the row's model, for the voxel file and the Voxels view. */
export const rowFill = (r: SheetRowData, defaults: InsideColours): VoxelFill => ({ inside: r.inside, shader: rowInside(r, defaults), hollowCore: r.hcore });

/** The row's textured low-poly mesh. The mesh library must be loaded (`initMesh`). */
export const rowMesh = (m: VoxelModel, read: SheetRead, r: SheetRowData): TexturedMesh =>
  textureMesh(buildMesh(m, { slope: r.slope, sides: r.sides }), m, read, r.fb);

/** The textures a GLB gets for its surface detail (DESIGN.md §10). */
export interface SurfaceMaps {
  /** The colour texture: the mesh's atlas, or a copy with the crevice shadows painted in. */
  atlas: RGBAImage;
  normalMap: RGBAImage | null;
  occlusionMap: RGBAImage | null;
  trimMap: RGBAImage | null;
}

/** Makes a picture from the atlas; the GUI caches it per atlas and `key`. */
export type AtlasCache = (key: string, make: () => RGBAImage) => RGBAImage;
const noCache: AtlasCache = (_k, make) => make();

/** The row's surface textures under the 3D model export settings. Unlit rows only ever get painted-in shadows. */
export function surfaceMaps(t: TexturedMesh, r: SheetRowData, g: ExportSettings['glb'], cache: AtlasCache = noCache): SurfaceMaps {
  const rects = Object.values(t.rects), unlit = r.mat === 'unlit';
  const [metal, rough] = r.mraw ?? MATERIAL_PBR[r.mat];
  return {
    atlas: g.ao === 'paint' ? cache(`paint|${g.style}|${g.aoDepth}`, () => shadedAtlas(t.atlas, g.style, g.aoDepth, rects)) : t.atlas,
    normalMap: g.normalMap && !unlit ? cache(`normal|${g.style}|${g.bump}|${g.grit}`, () => normalMapOf(t.atlas, g, rects)) : null,
    occlusionMap: g.ao === 'map' && !unlit ? cache(`ao|${g.style}|${g.aoDepth}`, () => occlusionMapOf(t.atlas, g.style, g.aoDepth, rects)) : null,
    trimMap: g.trims !== 'off' && !unlit ? cache(`trims|${g.trims}|${metal}|${rough}`, () => trimMapOf(t.atlas, g.trims as 'glossy' | 'metal', metal, rough, rects)) : null,
  };
}

const BANDS = { flat: 1, '2': 2, '3': 3, '4': 4 } as const;
/** The Pixel-perfect look card's settings as the renderer takes them. */
export const lookOf = (look: ExportSettings['look']): LookSpec => ({ outline: look.outline, bands: BANDS[look.light], fix: look.fix });

/** How a model is drawn for a sprite set (or the turntable, `st` null): the look, unlit rows unshaded, and the colours
    to snap to (`modelColours` is the model's palette). */
export function rowRenderOptions(r: SheetRowData, st: SpriteSetSettings | null, look: ExportSettings['look'], modelColours: number[], palettes: Palettes): RenderOptions {
  return { look: lookOf(look), shaded: r.mat !== 'unlit', snap: snapPalette(look.snap, st, modelColours, palettes), palettes };
}

/** The turntable's frames at `size` (at least 4 frames). */
export const rowTurntable = (src: RenderSource, t: ExportSettings['turntable'], size: number, o: RenderOptions): RGBAImage[] =>
  turntableFrames(src, { elev: t.elev, frames: Math.max(4, t.frames || 24), size }, o);

/** One ② row's model and what's made from it, each step built on first use. Null wherever the sheet can't be read,
    and for the mesh while the mesh library isn't loaded yet. */
export interface ModelParts {
  read: SheetRead;
  model(): VoxelModel | null;
  coloured(): ColouredModel | null;
  mesh(): TexturedMesh | null;
  surface(t: TexturedMesh): SurfaceMaps;
  voxFile(tooMany: 'merge' | 'skip'): VoxFile | null;
  sides(): Partial<Record<SideCode, RGBAImage>>;
  stack(axis: ExportSettings['stack']['axis'], order: ExportSettings['stack']['order']): ReturnType<typeof stackStrip> | null;
  palette(): number[] | null;
  /** What the renderer draws: the mesh with the export's colour texture (painted-in crevice shadows show), or the
      voxel model with the voxel file's colours. */
  renderSource(from: DrawFromCode): RenderSource | null;
  renderOptions(st: SpriteSetSettings | null): RenderOptions;
  turntable(size: number): RGBAImage[] | null;
}

/** What the export needs besides the row: the export settings, the inside styles' default colours and the fixed
    palettes (both from `presets/`). */
export interface ExportContext { exports: ExportSettings; insideColours: InsideColours; palettes: Palettes }

/** A row's parts without any cache beyond the row itself (the command-line tool). */
export function modelParts(read: SheetRead, r: SheetRowData, ctx: ExportContext): ModelParts {
  const once = <T>(make: () => T) => { let v: T | undefined, done = false; return () => (done ? v! : (done = true, v = make())); };
  const model = once(() => (read.problem ? null : rowModel(read, r)));
  const coloured = once(() => { const m = model(); return m && rowColoured(m, read, r); });
  const mesh = once(() => { const m = model(); return m && meshReady() ? rowMesh(m, read, r) : null; });
  const atlasPics = new Map<string, RGBAImage>();
  const cache: AtlasCache = (k, make) => { let v = atlasPics.get(k); if (!v) atlasPics.set(k, v = make()); return v; };
  const palette = once(() => { const m = model(), c = coloured(); return m && c ? modelPalette(m, c) : null; });
  const voxelSrc = once(() => { const m = model(), c = coloured(); return m && c ? voxelSource(m, c) : null; });
  const parts: ModelParts = {
    read, model, coloured, mesh,
    surface: t => surfaceMaps(t, r, ctx.exports.glb, cache),
    voxFile: tooMany => { const m = model(), c = coloured(); return m && c ? writeVox(m, c, rowFill(r, ctx.insideColours), tooMany) : null; },
    sides: () => { const m = model(); return m ? sidePictures(read, m) : {}; },
    stack: (axis, order) => { const m = model(), c = coloured(); return m && c ? stackStrip(m, c, axis, order) : null; },
    palette,
    renderSource: from => {
      if (from === 'voxels') return voxelSrc();
      const t = mesh();
      return t && { ...t, atlas: parts.surface(t).atlas };
    },
    renderOptions: st => rowRenderOptions(r, st, ctx.exports.look, palette() ?? [], ctx.palettes),
    turntable: size => { const src = parts.renderSource(ctx.exports.turntable.from); return src && rowTurntable(src, ctx.exports.turntable, size, parts.renderOptions(null)); },
  };
  return parts;
}

// ------------------------------------------------------------------ ② the files of one model

/** A ② row's model name: the sheet's name without its settings code (`rifle__32_R_cyW.png` → `rifle`). */
export const modelName = (file: string) => parseSheetName(file)?.base || baseName(file);

/** One name per model for a run; two sheets with the same model name get a number (`rifle`, `rifle_2`), ignoring
    case as Windows does. */
export function modelNames(files: string[]): string[] {
  const taken = new Set<string>();
  return files.map(f => {
    const base = modelName(f);
    let out = base;
    for (let k = 2; taken.has(out.toLowerCase()); k++) out = `${base}_${k}`;
    taken.add(out.toLowerCase());
    return out;
  });
}

/** The exports a run makes per model, in the order of the export cards. */
export function builtExports(e: ExportSettings): string[] {
  const pal = e.palette.on && (e.palette.gpl || e.palette.hex);
  return ([[e.glb.on, '3D model'], [e.vox.on, 'Voxel model'], [e.sides.on, '6 side pictures'], [e.sprites.on && e.sprites.sets.length > 0, 'Rendered sprites'],
    [e.stack.on, 'Sprite stack strip'], [e.turntable.on, 'Turntable GIF'], [pal, 'Colour palette']] as [boolean, string][])
    .filter(([on]) => on).map(([, name]) => name);
}

/** Whether a run needs the mesh library (`initMesh`) first. */
export const needsMesh = (e: ExportSettings) => e.glb.on || e.sprites.on || e.turntable.on;

/** Each sprite set's name part in the file names (the preset's, e.g. `isometric`); two sets with the same one get a
    number. Sets whose preset isn't known are `custom`. */
export function setFileParts(sets: SpriteSet[], presets: Pick<SpritePreset, 'id' | 'file'>[]): string[] {
  const seen = new Map<string, number>();
  return sets.map(st => {
    const f = presets.find(x => x.id === st.preset)?.file ?? 'custom', n = (seen.get(f) ?? 0) + 1;
    seen.set(f, n);
    return n === 1 ? f : `${f}${n}`;
  });
}

export interface ExportFile {
  /** Where it goes in the output folder (`rifle/rifle.glb` with one folder per model). */
  path: string;
  bytes: Uint8Array;
  /** What it is, for the run's summary: `.glb`, `side picture`… */
  kind: string;
}

export interface ModelExport {
  /** Nothing left to build: no files, a red ✖. */
  failed: boolean;
  files: ExportFile[];
  /** What went wrong or needs a look, in plain words (a ⚠ when the model was built). */
  why: string[];
  /** Painted pixels that didn't make it onto the model. */
  trimmed: number;
  /** The .vox file was skipped (too many colours with "Warn me and skip the file"). */
  voxSkipped: boolean;
}

/** Every ticked export of one model, as files. `name` is the model's name in the run (`modelNames`), `setParts` the
    sets' name parts (`setFileParts`). */
export function exportModel(p: ModelParts, r: SheetRowData, e: ExportSettings, name: string, setParts: string[], folderPerModel: boolean): ModelExport {
  const out: ModelExport = { failed: false, files: [], why: [], trimmed: 0, voxSkipped: false };
  const put = (file: string, bytes: Uint8Array, kind: string) => out.files.push({ path: folderPerModel ? `${name}/${file}` : file, bytes, kind });
  const model = p.model();
  if (!model?.count) { out.failed = true; out.why.push('nothing left to build'); return out; }
  if (e.glb.on) {
    const mesh = p.mesh();
    const [metal, rough] = r.mraw ?? MATERIAL_PBR[r.mat];
    const surface = mesh && p.surface(mesh);
    const bytes = mesh && surface && writeGlb({ ...mesh, atlas: surface.atlas }, {
      name, scale: e.glb.scale, pivot: e.glb.pivot, material: r.mat, metallic: metal, roughness: rough,
      normalMap: surface.normalMap, occlusionMap: surface.occlusionMap, trimMap: surface.trimMap,
    });
    if (bytes) put(`${name}.glb`, bytes, '.glb'); else out.why.push('no 3D model');
  }
  if (e.vox.on) {
    const vf = p.voxFile(e.vox.tooMany)!;
    if (vf.bytes) put(`${name}.vox`, vf.bytes, '.vox');
    else { out.voxSkipped = true; out.why.push(`.vox skipped: ${vf.palette.surfaceColours} colours`); }
  }
  if (e.sides.on) for (const [k, pic] of Object.entries(p.sides()) as [SideCode, RGBAImage][]) put(`${name}_${SIDE_FILE_NAMES[k]}.png`, encodePng(pic), 'side picture');
  if (e.sprites.on || e.turntable.on) {
    let missing = false;
    if (e.sprites.on) e.sprites.sets.forEach((st, j) => {
      const src = p.renderSource(st.from);
      if (!src) { missing = true; return; }
      for (const f of renderSpriteSet(src, st, r.side, name, setParts[j], p.renderOptions(st))) put(f.name, encodePng(f.image, f.grab), 'sprite picture');
    });
    const turn = e.turntable.on && p.turntable(e.turntable.size);
    if (turn) put(`${name}_turntable.gif`, writeTurntable(turn), '.gif'); else if (e.turntable.on) missing = true;
    if (missing) out.why.push('no rendered pictures');
  }
  if (e.stack.on) { const st = p.stack(e.stack.axis, e.stack.order); if (st?.layers) put(`${name}_stack.png`, encodePng(st.image), 'stack strip'); }
  if (e.palette.on) {
    const cols = p.palette() ?? [], text = new TextEncoder();
    if (e.palette.gpl) put(`${name}.gpl`, text.encode(writeGpl(name, cols)), '.gpl');
    if (e.palette.hex) put(`${name}.hex`, text.encode(writeHex(cols)), '.hex');
  }
  out.trimmed = model.trimmed.length;
  if (out.trimmed) out.why.push(`${out.trimmed} painted pixel${out.trimmed === 1 ? '' : 's'} cut off`);
  return out;
}
