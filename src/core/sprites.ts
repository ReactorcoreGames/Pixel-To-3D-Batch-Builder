/* Rendered sprite sets and the turntable (DESIGN.md §11): which views a set draws, how the pictures are laid out and
   named per preset, and the colour limits. The drawing itself is render.ts. */

import { writeGif } from './gif';
import { blit, colourCounts, contentBox, cropImage, fitScale, groundPoint, limitColours, renderFrame, snapImage, type CameraSpec, type LookSpec, type RenderSource } from './render';
import type { SpriteSetSettings, StartCode } from './presets';
import type { RGBAImage, SideCode } from './types';

/** The first view's turn for each "First picture looks at the…" choice (Custom uses the set's own turn). */
export const START_DEG: Record<Exclude<StartCode, 'custom'>, number> = { front: 0, diag: 45, side: 90 };
export const startDeg = (st: { start: StartCode; yaw?: number }) => (st.start === 'custom' ? st.yaw ?? 30 : START_DEG[st.start]);

/** "Your drawing" turns start from the side the sprite was drawn from (the camera turn that looks at that side);
    sprites drawn from the top or bottom count from the front. */
export const SIDE_YAW: Record<SideCode, number> = { F: 0, R: 90, Bk: 180, L: 270, T: 0, Bt: 0 };

export const LAYOUT_CODES = ['grid', 'rpgmaker', 'doom'] as const;
export type LayoutCode = (typeof LAYOUT_CODES)[number];
export const FIT_CODES = ['fit', 'drawing'] as const;
export type FitCode = (typeof FIT_CODES)[number];
/** What a set (or the turntable) draws: the low-poly model, as in the GLB, or the voxel model, as in the .vox. */
export const DRAW_FROM_CODES = ['mesh', 'voxels'] as const;
export type DrawFromCode = (typeof DRAW_FROM_CODES)[number];

/** The views of a set: every direction's turn (from the set's 0°, which is the object's front or the drawing) and
    the ones actually drawn. With "Skip mirrored directions", the ones past 180° are left to the game to flip. */
export function setAngles(st: Pick<SpriteSetSettings, 'dirs' | 'start' | 'yaw' | 'mirror'>) {
  const all = Array.from({ length: st.dirs }, (_, i) => ((startDeg(st) + i * 360 / st.dirs) % 360 + 360) % 360);
  const drawn = st.mirror && st.dirs > 1 ? all.filter(a => a <= 180 + 1e-6) : all;
  return { all, drawn };
}

/** The camera for a set's view at turn `angle`. */
export function setCamera(st: SpriteSetSettings, side: SideCode, angle: number): CameraSpec {
  const off = st.ref === 'drawing' ? SIDE_YAW[side] : 0;
  const oblique = st.cam === 'oblique' ? { angle: st.oside === 'left' ? 180 - st.oangle : st.oangle, depth: st.odepth / 100 } : undefined;
  return { yaw: angle + off, elev: st.elev, tilt: st.tilt, persp: st.cam === 'persp', fov: st.fov, ...(oblique && { oblique }) };
}

/** Which layout a set really gets: RPG Maker needs exactly 4 directions and Doom 1 or 8; otherwise pictures in rows. */
export function effectiveLayout(st: SpriteSetSettings): LayoutCode {
  if (st.layout === 'rpgmaker' && st.dirs === 4) return 'rpgmaker';
  if (st.layout === 'doom' && (st.dirs === 8 || st.dirs === 1)) return 'doom';
  return 'grid';
}

/** The fixed palettes a set's Colour limit can name. The Doom palette is loaded from `presets/palettes/doom.hex`. */
export interface Palettes { doom: number[] }

/** How a set's Colour limit applies: a fixed palette to snap to, or a number of colours for the whole sheet. */
export function colourLimit(pal: string, palettes: Palettes): { fixed: number[] | null; count: number } {
  if (/doom/i.test(pal)) return { fixed: palettes.doom, count: 0 };
  const m = /(\d+)\s*colou?rs/i.exec(pal);
  return { fixed: null, count: m ? +m[1] : 0 };
}

export interface RenderOptions {
  look: LookSpec;
  /** False draws the texture's own colours (unlit models). */
  shaded: boolean;
  /** Palette every pixel snaps to (the "Snap colours to" setting), or null. */
  snap: number[] | null;
  palettes: Palettes;
}

/** The snap palette for a set: the model's own colours, the set's fixed palette when it has one ("The preset's
    palette"; sets without one use the model's colours), or none. */
export function snapPalette(snap: 'model' | 'preset' | 'off', st: SpriteSetSettings | null, modelColours: number[], palettes: Palettes): number[] | null {
  if (snap === 'off') return null;
  if (snap === 'preset' && st) return colourLimit(st.pal, palettes).fixed ?? modelColours;
  return modelColours;
}

export interface SetFrame {
  /** The turn from the set's 0°, in degrees. */
  angle: number;
  image: RGBAImage;
}

export interface SetFile {
  /** File name after the model name's folder, e.g. `rifle_isometric.png`, `!$rifle.png` or `rifle_doom/RIFLA1.png`. */
  name: string;
  image: RGBAImage;
  /** Doom sprite offsets (the PNG's `grAb` chunk). */
  grab?: [number, number];
}

/** The scale a set draws a model at: fitted to the picture over all its views, or the drawing's own pixel size. */
export function setScale(src: RenderSource, st: SpriteSetSettings, side: SideCode, look: LookSpec, size = st.cell, angles = setAngles(st).drawn): number {
  if (st.fit === 'drawing') return size / st.cell;
  return fitScale(src, angles.map(a => setCamera(st, side, a)), size, look.outline ? 1 : 0);
}

/** Draws a set's views (the drawn ones, or the ones given) at `size`, with its colour rules applied to all of them together. */
export function renderSetFrames(src: RenderSource, st: SpriteSetSettings, side: SideCode, o: RenderOptions, size = st.cell, angles = setAngles(st).drawn): SetFrame[] {
  const scale = setScale(src, st, side, o.look, size, setAngles(st).drawn);
  const frames = angles.map(a => ({ angle: a, image: renderFrame(src, setCamera(st, side, a), size, scale, o.look, o.shaded).image }));
  applyColours(frames.map(f => f.image), st, o);
  return frames;
}

function applyColours(imgs: RGBAImage[], st: SpriteSetSettings, o: RenderOptions) {
  if (o.snap) for (const img of imgs) snapImage(img, o.snap);
  const { fixed, count } = colourLimit(st.pal, o.palettes);
  if (fixed) for (const img of imgs) snapImage(img, fixed);
  else if (count) limitColours(imgs, count);
}

/** A 4-letter Doom sprite name from the model's name: letters and digits, upper case, padded with X. Leading numbers
    are skipped when letters follow (`01 - large boulder` → `LARG`). */
export function doomPrefix(name: string): string {
  const up = name.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return ((/[A-Z]/.test(up) ? up.replace(/^[0-9]+/, '') : up) + 'XXXX').slice(0, 4);
}

/**
 * Renders one sprite set for one model into its files:
 * - rows of up to 8 pictures (`rifle_isometric.png`), the drawn directions in turn order;
 * - RPG Maker MV/MZ: one character sheet of 3 × 4 cells (rows facing down, left, right, up; the pose repeated in the
 *   three walking columns), named `!$rifle_rpgmaker.png` (`$` = one character per file, `!` = an object: no
 *   6px lift and no bush effect);
 * - Doom: one picture per rotation in `rifle_doom/`, cropped, named `RIFLA1.png`, `RIFLA2A8.png`… (the second
 *   rotation is the mirrored one), with offsets that stand the sprite on its base; 1 direction gives `RIFLA0.png`.
 */
export function renderSpriteSet(src: RenderSource, st: SpriteSetSettings, side: SideCode, name: string, file: string, o: RenderOptions): SetFile[] {
  const layout = effectiveLayout(st), { all, drawn } = setAngles(st), cell = st.cell;
  if (layout === 'rpgmaker') {
    // turn 0 faces the camera (down), 90 shows the object facing left, 270 facing right, 180 facing away (up)
    const frames = renderSetFrames(src, st, side, o, cell, [all[0], all[1], all[3], all[2]]);
    const sheet: RGBAImage = { width: cell * 3, height: cell * 4, data: new Uint8Array(cell * cell * 48) };
    frames.forEach((f, row) => { for (let c = 0; c < 3; c++) blit(sheet, f.image, c * cell, row * cell); });
    return [{ name: `!$${name}_${file}.png`, image: sheet }];
  }
  const frames = renderSetFrames(src, st, side, o, cell, drawn);
  if (layout === 'doom') {
    const pre = doomPrefix(name), scale = setScale(src, st, side, o.look);
    return frames.map(f => {
      const rot = st.dirs === 1 ? 0 : all.indexOf(f.angle) + 1;
      const mirrored = st.mirror && rot >= 2 && rot <= 4 ? `A${10 - rot}` : '';
      const [x, y, w, h] = contentBox(f.image);
      const [gx, gy] = groundPoint(src, setCamera(st, side, f.angle), cell, scale);
      const image = w ? cropImage(f.image, x, y, w, h) : f.image;
      return { name: `${name}_${file}/${pre}A${rot}${mirrored}.png`, image, grab: [Math.round(gx - x), Math.round(gy - y)] as [number, number] };
    });
  }
  const cols = Math.min(8, frames.length), rows = Math.ceil(frames.length / cols);
  const sheet: RGBAImage = { width: cols * cell, height: rows * cell, data: new Uint8Array(cols * rows * cell * cell * 4) };
  frames.forEach((f, i) => blit(sheet, f.image, (i % cols) * cell, Math.floor(i / cols) * cell));
  return [{ name: `${name}_${file}.png`, image: sheet }];
}

export interface TurntableSettings { elev: number; frames: number; size: number }

/** The turntable's frames: one full turn from the object's front at the chosen camera height, all at one scale. */
export function turntableFrames(src: RenderSource, t: TurntableSettings, o: RenderOptions): RGBAImage[] {
  const cams = Array.from({ length: t.frames }, (_, i): CameraSpec => ({ yaw: i * 360 / t.frames, elev: t.elev }));
  const scale = fitScale(src, cams, t.size, o.look.outline ? 1 : 0);
  const imgs = cams.map(c => renderFrame(src, c, t.size, scale, o.look, o.shaded).image);
  if (o.snap) for (const img of imgs) snapImage(img, o.snap);
  return imgs;
}

/** The turntable as a looping GIF; one spin takes about 2 seconds whatever the frame count (at least 2/100 s a frame). */
export function writeTurntable(frames: RGBAImage[]): Uint8Array {
  return writeGif(frames, Math.max(2, Math.round(200 / frames.length)));
}

/** How many colours some pictures use (for the preview's facts). */
export const colourCount = (imgs: RGBAImage[]) => colourCounts(imgs).size;
