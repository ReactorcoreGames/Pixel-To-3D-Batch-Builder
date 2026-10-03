/* Presets are small data files (DESIGN.md §11): rendered sprite set presets and the inside-style colours.
   This module only knows their shape and checks them; loading the files is up to the caller
   (the browser UI bundles the `presets/` folder, the desktop app and CLI will read it from disk). */

import { DRAW_FROM_CODES, FIT_CODES, LAYOUT_CODES, type DrawFromCode, type FitCode, type LayoutCode } from './sprites';
import { INSIDE_CODES, isOneOf, type InsideCode } from './types';

export const DIRECTION_COUNTS = [1, 2, 4, 8, 16, 32] as const;
export const START_CODES = ['front', 'diag', 'side', 'custom'] as const;
export type StartCode = (typeof START_CODES)[number];
export const TURN_REFS = ['object', 'drawing'] as const;
export type TurnRef = (typeof TURN_REFS)[number];
export const CAMERAS = ['ortho', 'persp', 'oblique'] as const;
export type CameraCode = (typeof CAMERAS)[number];
/** Which way an oblique camera's depth recedes on screen: up and to the right, or up and to the left. */
export const OBLIQUE_SIDES = ['right', 'left'] as const;
export type ObliqueSide = (typeof OBLIQUE_SIDES)[number];
/** The angle of a 2:1 pixel step (atan ½), the oblique preset's depth angle: receding edges go 2 across, 1 up. */
export const TWO_TO_ONE = 26.57;
export const COLOUR_LIMITS = ['No limit', 'Doom palette (256)', '16 colours', '32 colours'] as const;

/** The camera settings a preset bundles (DESIGN.md §11, "Sprite set presets"). */
export interface SpriteSetSettings {
  dirs: number;
  start: StartCode;
  /** Custom first-view turn in degrees, used when `start` is `custom`. */
  yaw: number;
  ref: TurnRef;
  tilt: number;
  elev: number;
  cam: CameraCode;
  fov: number;
  /** Oblique camera only: the angle the depth recedes at, in degrees above the horizontal (0–90, may have decimals). */
  oangle: number;
  /** Oblique camera only: how long the depth is drawn, in percent of its true length (50 = cabinet, 100 = cavalier). */
  odepth: number;
  /** Oblique camera only: which way the depth recedes. */
  oside: ObliqueSide;
  cell: number;
  mirror: boolean;
  pal: string;
  /** How the pictures are laid out and named: rows of pictures, an RPG Maker character sheet, or Doom sprite files. */
  layout: LayoutCode;
  /** Model size in the picture: fitted to the picture, or the drawing's own pixel size (1 model pixel = 1 pixel). */
  fit: FitCode;
  /** Draw the low-poly model or the voxel model. */
  from: DrawFromCode;
}

/** One sprite set in the Rendered sprites export: a preset id (or `custom`) plus its current settings. */
export interface SpriteSet extends SpriteSetSettings {
  preset: string;
  /** Whether the set's settings are unfolded in the export panel. */
  open: boolean;
}

export interface SpritePreset {
  id: string;
  name: string;
  /** Used in the output filename, e.g. `rifle_isometric.png`. */
  file: string;
  /** Short description under the name on the preset button. */
  sub: string;
  tip: string;
  /** Sort position in the preset picker. */
  order: number;
  settings: SpriteSetSettings;
}

export type InsideColours = Record<InsideCode, [string, string, string]>;

const HEX = /^#[0-9a-f]{6}$/i;
export const isHexColour = (v: unknown): v is string => typeof v === 'string' && HEX.test(v);

class PresetError extends Error {}
function need<T>(ok: boolean, v: T, what: string, where: string): T {
  if (!ok) throw new PresetError(`${where}: "${what}" is missing or not valid`);
  return v;
}

/** Checks one sprite set preset file. Throws a readable error naming the file and field. */
export function parseSpritePreset(raw: unknown, where: string): SpritePreset {
  const o = (raw ?? {}) as Record<string, unknown>;
  const str = (k: string) => need(typeof o[k] === 'string' && o[k] !== '', o[k] as string, k, where);
  const num = (k: string, lo: number, hi: number, fallback?: number) => {
    if (o[k] === undefined && fallback !== undefined) return fallback;
    return need(typeof o[k] === 'number' && (o[k] as number) >= lo && (o[k] as number) <= hi, o[k] as number, k, where);
  };
  const dirs = num('dirs', 1, 32);
  need((DIRECTION_COUNTS as readonly number[]).includes(dirs), dirs, 'dirs', where);
  const start = need(isOneOf(START_CODES, o.start), o.start as StartCode, 'start', where);
  const ref = o.ref === undefined ? 'object' : need(isOneOf(TURN_REFS, o.ref), o.ref as TurnRef, 'ref', where);
  const cam = need(isOneOf(CAMERAS, o.cam), o.cam as CameraCode, 'cam', where);
  const mirror = need(typeof o.mirror === 'boolean', o.mirror as boolean, 'mirror', where);
  return {
    id: str('id'), name: str('name'), file: str('file'), sub: str('sub'), tip: str('tip'),
    order: num('order', -1e6, 1e6, 0),
    settings: {
      dirs, start, ref, cam, mirror,
      yaw: num('yaw', 0, 359, 30),
      tilt: num('tilt', -90, 90, 0),
      elev: num('elev', 0, 90),
      fov: num('fov', 10, 90, 40),
      oangle: num('oangle', 0, 90, TWO_TO_ONE),
      odepth: num('odepth', 10, 100, 50),
      oside: o.oside === undefined ? 'right' : need(isOneOf(OBLIQUE_SIDES, o.oside), o.oside as ObliqueSide, 'oside', where),
      cell: num('cell', 1, 1024),
      pal: typeof o.pal === 'string' ? o.pal : 'No limit',
      layout: o.layout === undefined ? 'grid' : need(isOneOf(LAYOUT_CODES, o.layout), o.layout as LayoutCode, 'layout', where),
      fit: o.fit === undefined ? 'fit' : need(isOneOf(FIT_CODES, o.fit), o.fit as FitCode, 'fit', where),
      from: o.from === undefined ? 'mesh' : need(isOneOf(DRAW_FROM_CODES, o.from), o.from as DrawFromCode, 'from', where),
    },
  };
}

/** A sprite set read back from a session file, with every value clamped to what the UI allows; null if it's unusable. */
export function sanitizeSpriteSet(raw: unknown): SpriteSet | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const n = (k: string, lo: number, hi: number, d: number) => (typeof o[k] === 'number' && Number.isFinite(o[k]) ? Math.max(lo, Math.min(hi, Math.round(o[k] as number))) : d);
  const dirs = (DIRECTION_COUNTS as readonly number[]).includes(o.dirs as number) ? (o.dirs as number) : 4;
  return {
    preset: typeof o.preset === 'string' ? o.preset : 'custom',
    dirs,
    start: isOneOf(START_CODES, o.start) ? o.start : 'front',
    yaw: n('yaw', 0, 359, 30),
    ref: isOneOf(TURN_REFS, o.ref) ? o.ref : 'object',
    tilt: n('tilt', -90, 90, 0),
    elev: n('elev', 0, 90, 30),
    cam: isOneOf(CAMERAS, o.cam) ? o.cam : 'ortho',
    fov: n('fov', 10, 90, 40),
    // the oblique angle keeps two decimals (26.57° is a 2:1 pixel step)
    oangle: typeof o.oangle === 'number' && Number.isFinite(o.oangle) ? Math.max(0, Math.min(90, Math.round(o.oangle * 100) / 100)) : TWO_TO_ONE,
    odepth: n('odepth', 10, 100, 50),
    oside: isOneOf(OBLIQUE_SIDES, o.oside) ? o.oside : 'right',
    cell: n('cell', 1, 1024, 64),
    mirror: typeof o.mirror === 'boolean' ? o.mirror : false,
    pal: typeof o.pal === 'string' ? o.pal : 'No limit',
    // sets saved before session 6 have no layout: the Doom and RPG Maker presets had theirs implied
    layout: isOneOf(LAYOUT_CODES, o.layout) ? o.layout : o.preset === 'doom' ? 'doom' : o.preset === 'rpgm' ? 'rpgmaker' : 'grid',
    fit: isOneOf(FIT_CODES, o.fit) ? o.fit : 'fit',
    from: isOneOf(DRAW_FROM_CODES, o.from) ? o.from : 'mesh',
    open: typeof o.open === 'boolean' ? o.open : false,
  };
}

/** A preset in its file format (what `parseSpritePreset` reads), e.g. for "Save as my preset". */
export function spritePresetFile(p: SpritePreset): Record<string, unknown> {
  return { order: p.order, id: p.id, name: p.name, file: p.file, sub: p.sub, ...p.settings, tip: p.tip };
}

/** A new sprite set with a preset's settings. */
export function setFromPreset(p: SpritePreset, open = false): SpriteSet {
  return { preset: p.id, ...p.settings, open };
}

/** Checks the inside-style colour file: three hex colours for every inside style. */
export function parseInsideColours(raw: unknown, where: string): InsideColours {
  const o = (raw ?? {}) as Record<string, unknown>;
  const out = {} as InsideColours;
  for (const k of INSIDE_CODES) {
    const v = o[k];
    need(Array.isArray(v) && v.length === 3 && v.every(isHexColour), v, k, where);
    out[k] = (v as string[]).map(c => c.toLowerCase()) as [string, string, string];
  }
  return out;
}
