/* Core types shared by the library, the UI and (later) the command-line tool.
   The core never touches the DOM: pictures come in as RGBA pixel buffers and go out as files. */

/** A decoded picture: 4 bytes per pixel (R, G, B, A), rows top to bottom. */
export interface RGBAImage {
  width: number;
  height: number;
  data: Uint8ClampedArray | Uint8Array;
}

/** Side codes (DESIGN.md §3): Back and Bottom both start with B, so they get two letters. */
export const SIDE_CODES = ['F', 'Bk', 'L', 'R', 'T', 'Bt'] as const;
export type SideCode = (typeof SIDE_CODES)[number];

/** Cross-section shapes (DESIGN.md §3). Axes are sprite-relative: W = width ↔, H = height ↕, T = thickness ⊙. */
export const SHAPE_CODES = ['box', 'rbox', 'cyW', 'cyH', 'cyT', 'diW', 'diH', 'diT', 'ell', 'dpy'] as const;
export type ShapeCode = (typeof SHAPE_CODES)[number];

/** Ends for Tube and Diamond (DESIGN.md §3): flat, or rounded / tapered at the first end (← left, top, front),
    the last end (→ right, bottom, back) or both. The codes are the file name codes; Flat has none in the name. */
export const ENDS_CODES = ['flat', 'cF', 'cL', 'cB'] as const;
export type EndsCode = (typeof ENDS_CODES)[number];

export const BLEND_CODES = ['hard', 'stepped', 'smooth'] as const;
export type BlendCode = (typeof BLEND_CODES)[number];

/** Colour fallback ("Gap colour" in the UI): opposite panel or nearest pixel (DESIGN.md §5). */
export const FALLBACK_CODES = ['opp', 'near'] as const;
export type FallbackCode = (typeof FALLBACK_CODES)[number];

export const MATERIAL_CODES = ['matte', 'plastic', 'dull', 'shiny', 'unlit'] as const;
export type MaterialCode = (typeof MATERIAL_CODES)[number];

/** Voxel interior presets ("Inside" in the UI, DESIGN.md §8). */
export const INSIDE_CODES = ['nearest', 'solid', 'hollow', 'noise', 'onion', 'rings', 'strata', 'crystal', 'fractal', 'flesh', 'machine'] as const;
export type InsideCode = (typeof INSIDE_CODES)[number];

/** Standard cube sizes for the contact sheet (DESIGN.md §4). */
export const CUBE_SIZES = [8, 16, 32, 64, 128] as const;
/** Largest sprite side and largest model dimension, in pixels. */
export const MAX_SIZE = 128;

/** Pixels count as solid at alpha ≥ 50% (DESIGN.md §4). */
export const SOLID_ALPHA = 128;

export const isOneOf = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === 'string' && (list as readonly string[]).includes(v);
