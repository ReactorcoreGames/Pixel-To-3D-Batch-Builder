/* Phase 2, step 1: reading a painted sheet back (DESIGN.md §4, "Carrying the info" and "Re-import validation").
   The cube size N comes from the picture size alone (width = 3·3 + 2·N); the file name is only a cross-check and the
   source of the side, shape and ends. A renamed sheet still loads, with side and shape guessed as Front / Box.
   The frame and the legend are never read, so paint on them is harmless. */

import { cellOrigin, parseSheetName, sheetSize } from './sheet';
import { fileOf } from './sprite';
import { CUBE_SIZES, SIDE_CODES, SOLID_ALPHA, type EndsCode, type RGBAImage, type ShapeCode, type SideCode } from './types';

export interface SheetRead {
  file: string;
  /** What the file name says, or null when it lost its settings code (e.g. `rifle (copy).png`). */
  named: { base: string; n: number; side: SideCode; shape: ShapeCode; ends: EndsCode } | null;
  /** Cube size from the picture size; null when the picture isn't the size of any sheet. */
  n: number | null;
  /** Side, shape and ends from the file name, or the guesses Front / Box / flat when it lost them. */
  side: SideCode;
  shape: ShapeCode;
  ends: EndsCode;
  /** Side and shape are guesses (the file name lost its settings code). */
  guessed: boolean;
  /** The file name gives a different cube size than the picture. The picture wins. */
  nameMismatch: boolean;
  /** Why the sheet can't be read, in plain words; null when it's fine. */
  problem: string | null;
  actual: { width: number; height: number };
  /** The size the picture should have, when we can tell. */
  expected: { width: number; height: number } | null;
  /** Each panel's N × N cell as RGBA, straight from the sheet. Null when the sheet can't be read. */
  panels: Record<SideCode, Uint8Array> | null;
}

/** The cube size a picture of this size belongs to, or null when no sheet is this size. */
export function sheetN(width: number, height: number): number | null {
  return CUBE_SIZES.find(n => { const s = sheetSize(n); return s.width === width && s.height === height; }) ?? null;
}

/** A plain-words guess at what happened to a picture that isn't a sheet size. */
function likelyCause(w: number, h: number, exp: { width: number; height: number }): string {
  for (const k of [2, 3, 4, 5, 6, 8]) {
    if (w === exp.width * k && h === exp.height * k) return `It looks like it was scaled up ${k}× in your art app. Scale it back to ${exp.width} × ${exp.height} (100%) without smoothing.`;
  }
  if (w === exp.width && h < exp.height) return `It's shorter than it should be, so it was probably cropped (maybe the legend strip at the bottom was cut off).`;
  if (w === exp.width && h > exp.height) return `It's taller than it should be, so the canvas was probably resized in your art app.`;
  if (w < exp.width || h < exp.height) return 'It was probably cropped or trimmed in your art app.';
  return 'It was probably resized, or the canvas was enlarged, in your art app.';
}

/** Reads a sheet picture. Never throws: a broken sheet comes back with `problem` set, so the batch goes on. */
export function readSheet(img: RGBAImage, path: string): SheetRead {
  const file = fileOf(path);
  const named = parseSheetName(file);
  const { width, height } = img;
  const n = sheetN(width, height);
  const base = {
    file, named, n, side: named?.side ?? 'F', shape: named?.shape ?? 'box', ends: named?.ends ?? 'flat', guessed: !named,
    nameMismatch: !!named && n !== null && named.n !== n, actual: { width, height },
  } satisfies Partial<SheetRead>;
  if (!n) {
    // the size we expected: from the file name if it has one, else the sheet size nearest in width
    const guessN = named && (CUBE_SIZES as readonly number[]).includes(named.n) ? named.n
      : CUBE_SIZES.reduce((a, b) => (Math.abs(sheetSize(b).width - width) < Math.abs(sheetSize(a).width - width) ? b : a));
    const expected = sheetSize(guessN);
    const problem = `Wrong picture size: this sheet is ${width} × ${height} px, but a box-${guessN} sheet must be ${expected.width} × ${expected.height} px. ${likelyCause(width, height, expected)}`;
    return { ...base, problem, expected, panels: null };
  }
  const panels = {} as Record<SideCode, Uint8Array>;
  for (const p of SIDE_CODES) {
    const [cx, cy] = cellOrigin(p, n), out = new Uint8Array(n * n * 4);
    for (let y = 0; y < n; y++) out.set(img.data.subarray(((cy + y) * width + cx) * 4, ((cy + y) * width + cx + n) * 4), y * n * 4);
    panels[p] = out;
  }
  const empty = SIDE_CODES.every(p => { const d = panels[p]; for (let i = 3; i < d.length; i += 4) if (d[i] >= SOLID_ALPHA) return false; return true; });
  const problem = empty ? 'Nothing to build: every box on this sheet is see-through (or less than half visible).' : null;
  return { ...base, problem, expected: sheetSize(n), panels };
}
