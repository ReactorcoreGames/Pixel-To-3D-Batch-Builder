/* The session file (DESIGN.md §13): one JSON file for both modes. It holds both file lists, every row's settings,
   both output folders, the frame colours and all export settings including sprite sets.
   Paths are stored relative to the session file when its folder is known (desktop app); the browser build
   doesn't know real folders, so it stores the names it has and embeds each picture as a small PNG data URL. */

import { fileOf } from './sprite';
import {
  BLEND_CODES, ENDS_CODES, FALLBACK_CODES, INSIDE_CODES, MATERIAL_CODES, SHAPE_CODES, SIDE_CODES, isOneOf,
  type BlendCode, type EndsCode, type FallbackCode, type InsideCode, type MaterialCode, type ShapeCode, type SideCode,
} from './types';
import { isHexColour, sanitizeSpriteSet, type SpriteSet } from './presets';
import { BUMP_STYLES, type BumpStyle, type TrimMode } from './normalmap';
import { DRAW_FROM_CODES, type DrawFromCode } from './sprites';

export const SESSION_APP = 'pixel-to-3d-batch-builder';
export const SESSION_VERSION = 1;
export const SESSION_EXT = '.p3d.json';

// ------------------------------------------------------------------ data model

export const FRAME_PRESET_CODES = ['jv', 'single', 'classic', 'custom'] as const;
export type FramePreset = (typeof FRAME_PRESET_CODES)[number];
/** Sheet frame colours (DESIGN.md §4): edge lines touch the art, the core line says "not art". */
export interface FrameColours { preset: FramePreset; edge: string; core: string }
export const FRAME_PRESETS: Record<Exclude<FramePreset, 'custom'>, [string, string]> = {
  jv: ['#1f5a44', '#a63ec5'],
  classic: ['#2e2a36', '#f500e1'],
  single: ['#a63ec5', '#a63ec5'],
};

/** A Phase 1 row: one sprite and its settings. */
export interface SpriteRowData {
  path: string;
  /** Key into the session's `images`. */
  image: string;
  /** Thickness in px ("depth" in DESIGN.md). */
  depth: number;
  side: SideCode;
  /** The side was filled in from the filename suffix and not changed since. */
  sideAuto: boolean;
  shape: ShapeCode;
  /** Ends for Tube and Diamond; kept when the shape changes, but only used by those two. */
  ends: EndsCode;
  outline: boolean;
  /** "Copy sides": the sheet's inferred sides show the drawing turned to face them. Phase 1 only (no filename code). */
  copySides: boolean;
}

/** Where a ② sheet came from, for sheets ① made and put in ② (DESIGN.md §4, "Remaking a sheet"). */
export interface SheetLink {
  /** The path of the ① sprite that made it. */
  sprite: string;
  /** `pixelHash` of the sheet as ① wrote it: when the file still matches, nobody has painted on it. */
  made: string;
  /** `sheetRecipe` of the ① row when it was made. */
  with: string;
}

/** A Phase 2 row: one sheet and its settings (DESIGN.md §5 table, plus material, inside and fine-tuning). */
export interface SheetRowData {
  path: string;
  image?: string;
  /** Set when ① made this sheet; missing for sheets added by hand. */
  link?: SheetLink;
  side: SideCode;
  shape: ShapeCode;
  ends: EndsCode;
  /** What the filename says, or null when the name lost its settings code. */
  fileSide: SideCode | null;
  fileShape: ShapeCode | null;
  fileEnds: EndsCode | null;
  /** The filename lost its settings code, so side and shape are guesses. */
  renamed: boolean;
  sx: number; sy: number; sz: number;
  bstyle: BlendCode;
  bw: number;
  fb: FallbackCode;
  mat: MaterialCode;
  inside: InsideCode;
  /** Own inside colours, or null for the inside style's defaults. */
  icol: [string, string, string] | null;
  inoise: number;
  iscale: number;
  /** Hollow core (DESIGN.md §8): 0 = solid, N = inside voxels deeper than N are left out, so the walls are N thick. */
  hcore: number;
  /** Slope straightening tolerance in px (a ② column). */
  slope: number;
  /** Sides on round shapes (a ② column). */
  sides: number;
  /** Raw metallic and roughness (the Metal and Rough columns), or null for the material preset's own values. */
  mraw: [number, number] | null;
}

export interface ExportSettings {
  glb: {
    on: boolean; scale: number; pivot: 'centre' | 'bottom';
    /** Surface detail (DESIGN.md §10): the normal map switch, its style, strength and grit, crevice shadows and trims. */
    normalMap: boolean; style: BumpStyle; bump: number; grit: number;
    ao: 'off' | 'map' | 'paint'; aoDepth: number; trims: 'off' | TrimMode;
  };
  vox: { on: boolean; tooMany: 'merge' | 'skip' };
  sides: { on: boolean };
  sprites: { on: boolean; sets: SpriteSet[] };
  stack: { on: boolean; axis: 'y' | 'z' | 'x'; order: 'bottom' | 'top' };
  turntable: { on: boolean; elev: number; frames: number; size: number; from: DrawFromCode };
  palette: { on: boolean; gpl: boolean; hex: boolean };
  look: { outline: boolean; light: 'flat' | '2' | '3' | '4'; snap: 'model' | 'preset' | 'off'; fix: 'auto' | 'always' | 'never' };
}

export interface SessionImage {
  path: string;
  /** Browser build only: the picture itself, so a session reopens without the original files. */
  png?: string;
}

export interface Session {
  app: typeof SESSION_APP;
  version: number;
  name: string;
  savedAt: string;
  mode: 1 | 2;
  /** `download`: browser build only, whether a ① run also downloads the sheets as a zip (always when they don't go to ②). */
  sprites: { rows: SpriteRowData[]; output: string; addToSheets: boolean; neverOverwrite: boolean; download: boolean; frame: FrameColours };
  sheets: { rows: SheetRowData[]; output: string; folderPerModel: boolean };
  exports: ExportSettings;
  images: Record<string, SessionImage>;
}

// ------------------------------------------------------------------ defaults

export const DEFAULT_THICKNESS = 4;
/** The thickest walls a hollow core can have (a 128 model is at most 64 deep). */
export const HOLLOW_CORE_MAX = 32;

export function defaultSpriteRow(path: string, image: string, side: SideCode | null): SpriteRowData {
  return { path, image, depth: DEFAULT_THICKNESS, side: side ?? 'F', sideAuto: !!side, shape: 'box', ends: 'flat', outline: true, copySides: false };
}

export function defaultSheetRow(path: string, side: SideCode, shape: ShapeCode, ends: EndsCode = 'flat'): SheetRowData {
  return {
    path, side, shape, ends, fileSide: side, fileShape: shape, fileEnds: ends, renamed: false,
    sx: .5, sy: .5, sz: .5, bstyle: 'hard', bw: 0, fb: 'opp', mat: 'matte', inside: 'nearest',
    icol: null, inoise: 30, iscale: 4, hcore: 0, slope: .9, sides: 8, mraw: null,
  };
}

/** Export defaults, matching the mockup. The starting sprite sets come from the presets, so the caller passes them in. */
export function defaultExports(sets: SpriteSet[]): ExportSettings {
  return {
    glb: { on: true, scale: 32, pivot: 'bottom', normalMap: false, style: 'chisel', bump: 5, grit: 0, ao: 'off', aoDepth: 5, trims: 'off' },
    vox: { on: true, tooMany: 'merge' },
    sides: { on: false },
    sprites: { on: true, sets },
    stack: { on: false, axis: 'y', order: 'bottom' },
    turntable: { on: true, elev: 0, frames: 24, size: 128, from: 'mesh' },
    palette: { on: false, gpl: true, hex: false },
    look: { outline: true, light: '3', snap: 'model', fix: 'auto' },
  };
}

export function defaultSession(sets: SpriteSet[]): Session {
  return {
    app: SESSION_APP, version: SESSION_VERSION, name: 'untitled', savedAt: '', mode: 1,
    sprites: { rows: [], output: '', addToSheets: true, neverOverwrite: true, download: true, frame: { preset: 'jv', edge: FRAME_PRESETS.jv[0], core: FRAME_PRESETS.jv[1] } },
    sheets: { rows: [], output: '', folderPerModel: true },
    exports: defaultExports(sets),
    images: {},
  };
}

// ------------------------------------------------------------------ paths

const isAbs = (p: string) => /^([a-zA-Z]:)?[\\/]/.test(p) || /^[a-zA-Z]:$/.test(p);
const isWin = (p: string) => /^[a-zA-Z]:/.test(p) || p.startsWith('\\\\');
const parts = (p: string) => p.replace(/\\/g, '/').split('/').filter(s => s !== '' && s !== '.');

/** `to` written relative to the folder `fromDir`, with forward slashes. Different drives stay absolute. */
export function relativePath(fromDir: string, to: string): string {
  if (!isAbs(to) || !isAbs(fromDir)) return to.replace(/\\/g, '/');
  const win = isWin(fromDir) || isWin(to);
  const a = parts(fromDir), b = parts(to);
  const same = (x: string, y: string) => (win ? x.toLowerCase() === y.toLowerCase() : x === y);
  if (win && !same(a[0] ?? '', b[0] ?? '')) return to.replace(/\\/g, '/');
  let i = 0;
  while (i < a.length && i < b.length && same(a[i], b[i])) i++;
  return [...a.slice(i).map(() => '..'), ...b.slice(i)].join('/');
}

/** A path from the session file, resolved against the session's folder. Absolute paths are kept. */
export function resolvePath(fromDir: string, rel: string): string {
  if (isAbs(rel) || !fromDir) return rel;
  const lead = fromDir.replace(/\\/g, '/').startsWith('/') ? '/' : '';
  const out = parts(fromDir);
  for (const s of parts(rel)) s === '..' ? out.pop() : out.push(s);
  return lead + out.join('/');
}

function mapPaths(s: Session, f: (p: string) => string): Session {
  return {
    ...s,
    sprites: { ...s.sprites, rows: s.sprites.rows.map(r => ({ ...r, path: f(r.path) })), output: s.sprites.output && f(s.sprites.output) },
    sheets: { ...s.sheets, rows: s.sheets.rows.map(r => ({ ...r, path: f(r.path), ...(r.link && { link: { ...r.link, sprite: f(r.link.sprite) } }) })), output: s.sheets.output && f(s.sheets.output) },
    images: Object.fromEntries(Object.entries(s.images).map(([k, v]) => [k, { ...v, path: f(v.path) }])),
  };
}

// ------------------------------------------------------------------ save

/** The session as JSON text. With `sessionDir`, every path is written relative to it. */
export function serializeSession(s: Session, opts: { sessionDir?: string; savedAt?: Date } = {}): string {
  let out: Session = { ...s, app: SESSION_APP, version: SESSION_VERSION, savedAt: (opts.savedAt ?? new Date()).toISOString() };
  if (opts.sessionDir) out = mapPaths(out, p => relativePath(opts.sessionDir!, p));
  return JSON.stringify(out, null, 1);
}

// ------------------------------------------------------------------ load

export class SessionError extends Error {}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {});
const pick = <T extends string>(list: readonly T[], v: unknown, d: T): T => (isOneOf(list, v) ? v : d);
const num = (v: unknown, lo: number, hi: number, d: number, int = false) => {
  if (typeof v !== 'number' || !Number.isFinite(v)) return d;
  const c = Math.max(lo, Math.min(hi, v));
  return int ? Math.round(c) : c;
};
const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);
const str = (v: unknown, d: string) => (typeof v === 'string' ? v : d);
const hex = (v: unknown, d: string) => (isHexColour(v) ? v.toLowerCase() : d);

function spriteRow(v: unknown): SpriteRowData | null {
  const o = obj(v);
  if (typeof o.path !== 'string' || typeof o.image !== 'string') return null;
  const d = defaultSpriteRow(o.path, o.image, null);
  return {
    path: o.path, image: o.image,
    depth: num(o.depth, 1, 128, d.depth, true),
    side: pick(SIDE_CODES, o.side, d.side),
    sideAuto: bool(o.sideAuto, false),
    shape: pick(SHAPE_CODES, o.shape, d.shape),
    ends: pick(ENDS_CODES, o.ends, d.ends),
    outline: bool(o.outline, d.outline),
    copySides: bool(o.copySides, d.copySides),
  };
}

function sheetRow(v: unknown): SheetRowData | null {
  const o = obj(v);
  if (typeof o.path !== 'string') return null;
  const side = pick(SIDE_CODES, o.side, 'F'), shape = pick(SHAPE_CODES, o.shape, 'box'), ends = pick(ENDS_CODES, o.ends, 'flat');
  const d = defaultSheetRow(o.path, side, shape, ends);
  const icol = Array.isArray(o.icol) && o.icol.length === 3 && o.icol.every(isHexColour) ? (o.icol.map(c => c.toLowerCase()) as [string, string, string]) : null;
  const lk = obj(o.link);
  const link = typeof lk.sprite === 'string' && typeof lk.made === 'string' && typeof lk.with === 'string' ? { sprite: lk.sprite, made: lk.made, with: lk.with } : undefined;
  return {
    ...d,
    image: typeof o.image === 'string' ? o.image : undefined,
    ...(link && { link }),
    fileSide: isOneOf(SIDE_CODES, o.fileSide) ? o.fileSide : null,
    fileShape: isOneOf(SHAPE_CODES, o.fileShape) ? o.fileShape : null,
    // sessions from before ends existed: a named sheet then always had flat ends
    fileEnds: isOneOf(ENDS_CODES, o.fileEnds) ? o.fileEnds : isOneOf(SHAPE_CODES, o.fileShape) ? 'flat' : null,
    renamed: bool(o.renamed, false),
    sx: num(o.sx, 0, 1, d.sx), sy: num(o.sy, 0, 1, d.sy), sz: num(o.sz, 0, 1, d.sz),
    bstyle: pick(BLEND_CODES, o.bstyle, d.bstyle),
    bw: num(o.bw, 0, 16, d.bw, true),
    fb: pick(FALLBACK_CODES, o.fb, d.fb),
    mat: pick(MATERIAL_CODES, o.mat, d.mat),
    inside: pick(INSIDE_CODES, o.inside, d.inside),
    icol,
    inoise: num(o.inoise, 0, 100, d.inoise, true),
    iscale: num(o.iscale, 1, 16, d.iscale, true),
    hcore: num(o.hcore, 0, HOLLOW_CORE_MAX, d.hcore, true),
    slope: num(o.slope, 0, 3, d.slope),
    sides: num(o.sides, 3, 24, d.sides, true),
    mraw: Array.isArray(o.mraw) && o.mraw.length === 2 && o.mraw.every(v => typeof v === 'number' && Number.isFinite(v)) ? [num(o.mraw[0], 0, 1, 0), num(o.mraw[1], 0, 1, 1)] : null,
  };
}

function exportsFrom(v: unknown, sets: SpriteSet[]): ExportSettings {
  const d = defaultExports(sets), o = obj(v);
  const g = obj(o.glb), vx = obj(o.vox), sd = obj(o.sides), sp = obj(o.sprites), st = obj(o.stack), tt = obj(o.turntable), pl = obj(o.palette), lk = obj(o.look);
  const loadedSets = Array.isArray(sp.sets) ? sp.sets.map(sanitizeSpriteSet).filter((x): x is SpriteSet => !!x) : d.sprites.sets;
  return {
    glb: { on: bool(g.on, d.glb.on), scale: num(g.scale, 1, 100000, d.glb.scale), pivot: pick(['centre', 'bottom'] as const, g.pivot, d.glb.pivot), normalMap: bool(g.normalMap, d.glb.normalMap), style: pick(BUMP_STYLES, g.style, d.glb.style), bump: num(g.bump, 1, 10, d.glb.bump, true),
      grit: num(g.grit, 0, 10, d.glb.grit, true), ao: pick(['off', 'map', 'paint'] as const, g.ao, d.glb.ao), aoDepth: num(g.aoDepth, 1, 10, d.glb.aoDepth, true),
      trims: pick(['off', 'glossy', 'metal'] as const, g.trims, d.glb.trims),
    },
    vox: { on: bool(vx.on, d.vox.on), tooMany: pick(['merge', 'skip'] as const, vx.tooMany, d.vox.tooMany) },
    sides: { on: bool(sd.on, d.sides.on) },
    sprites: { on: bool(sp.on, d.sprites.on), sets: loadedSets },
    stack: { on: bool(st.on, d.stack.on), axis: pick(['y', 'z', 'x'] as const, st.axis, d.stack.axis), order: pick(['bottom', 'top'] as const, st.order, d.stack.order) },
    turntable: { on: bool(tt.on, d.turntable.on), elev: num(tt.elev, -30, 60, d.turntable.elev, true), frames: num(tt.frames, 4, 120, d.turntable.frames, true), size: num(tt.size, 8, 1024, d.turntable.size, true), from: pick(DRAW_FROM_CODES, tt.from, d.turntable.from) },
    palette: { on: bool(pl.on, d.palette.on), gpl: bool(pl.gpl, d.palette.gpl), hex: bool(pl.hex, d.palette.hex) },
    look: {
      outline: bool(lk.outline, d.look.outline),
      light: pick(['flat', '2', '3', '4'] as const, lk.light, d.look.light),
      snap: pick(['model', 'preset', 'off'] as const, lk.snap, d.look.snap),
      fix: pick(['auto', 'always', 'never'] as const, lk.fix, d.look.fix),
    },
  };
}

/**
 * Reads a session file. Unknown or broken values fall back to defaults, so older and hand-edited files still load;
 * only a file that isn't a session at all is refused. With `sessionDir`, relative paths are resolved against it.
 * `sets` are the default sprite sets, used when the file has none.
 */
export function parseSession(text: string, sets: SpriteSet[], opts: { sessionDir?: string } = {}): Session {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new SessionError('This file isn\'t a session file (it isn\'t valid JSON).'); }
  const o = obj(raw);
  if (o.app !== SESSION_APP) throw new SessionError('This file isn\'t a Pixel to 3D Batch Builder session.');
  if (typeof o.version !== 'number' || o.version > SESSION_VERSION) throw new SessionError('This session was saved by a newer version of the program. Please update to open it.');
  const d = defaultSession(sets), sp = obj(o.sprites), sh = obj(o.sheets), fr = obj(sp.frame);
  const images: Record<string, SessionImage> = {};
  for (const [k, v] of Object.entries(obj(o.images))) {
    const iv = obj(v);
    if (typeof iv.path === 'string') images[k] = { path: iv.path, png: typeof iv.png === 'string' ? iv.png : undefined };
  }
  const arr = (v: unknown) => (Array.isArray(v) ? v : []);
  let s: Session = {
    app: SESSION_APP, version: SESSION_VERSION,
    name: str(o.name, d.name), savedAt: str(o.savedAt, ''),
    mode: o.mode === 2 ? 2 : 1,
    sprites: {
      rows: arr(sp.rows).map(spriteRow).filter((r): r is SpriteRowData => !!r),
      output: str(sp.output, ''), addToSheets: bool(sp.addToSheets, true), neverOverwrite: bool(sp.neverOverwrite, true), download: bool(sp.download, true),
      frame: { preset: pick(FRAME_PRESET_CODES, fr.preset, 'jv'), edge: hex(fr.edge, d.sprites.frame.edge), core: hex(fr.core, d.sprites.frame.core) },
    },
    sheets: {
      rows: arr(sh.rows).map(sheetRow).filter((r): r is SheetRowData => !!r),
      output: str(sh.output, ''), folderPerModel: bool(sh.folderPerModel, true),
    },
    exports: exportsFrom(o.exports, sets),
    images,
  };
  if (opts.sessionDir) s = mapPaths(s, p => resolvePath(opts.sessionDir!, p));
  return s;
}

/** The display name for a row: the file part of its path. */
export const rowFile = (r: { path: string }) => fileOf(r.path);
