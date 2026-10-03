import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ENDS_CODES, SHAPE_CODES, buildVoxelModel, decodePng, endCuts, hasEnds, makeSheet, parseSheetName, readSheet, sheetFileName,
  type EndsCode, type RGBAImage, type ShapeCode, type SideCode, type VoxelModel,
} from '../src/core';

const FRAME = { edge: '#1f5a44', core: '#a63ec5' };
const MID = { x: .5, y: .5, z: .5 };
const TUBES: ShapeCode[] = SHAPE_CODES.filter(hasEnds);
const SHAPED: EndsCode[] = ['cF', 'cL', 'cB'];

/** A picture from a function giving each pixel's colour (null = see-through). */
function img(w: number, h: number, colour: (x: number, y: number) => [number, number, number] | null): RGBAImage {
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const c = colour(x, y); if (c) data.set([...c, 255], (y * w + x) * 4); }
  return { width: w, height: h, data };
}
/** A bullet seen end-on: a filled circle 10 across. */
const circle = img(10, 10, (x, y) => ((x - 4.5) ** 2 + (y - 4.5) ** 2 <= 25 ? [200, 150, 60] : null));
/** A blunt rod drawn from the side, 20 × 8, with a differently coloured column every 2 px from the right end. */
const ROD = [[250, 0, 0], [0, 250, 0], [0, 0, 250], [250, 250, 0], [0, 250, 250]] as [number, number, number][];
const rod = img(20, 8, x => (x >= 10 ? ROD[Math.floor((19 - x) / 2)] : [90, 90, 90]));

function model(sprite: RGBAImage, side: SideCode, depth: number, shape: ShapeCode, ends: EndsCode) {
  const sheet = makeSheet(sprite, { side, depth, shape, ends, outlined: false, frame: FRAME })!;
  const read = readSheet(sheet.image, sheetFileName('x', sheet.n, side, shape, ends));
  return { sheet, read, m: buildVoxelModel(read, side, shape, MID, undefined, ends) };
}
/** How many voxels a layer across world axis k holds. */
function layer(m: VoxelModel, k: number, c: number) {
  let count = 0;
  for (let z = 0, i = 0; z < m.n; z++) for (let y = 0; y < m.n; y++) for (let x = 0; x < m.n; x++, i++) if (m.solid[i] && [x, y, z][k] === c) count++;
  return count;
}

describe('Ends for Tube and Diamond: file names', () => {
  it('the code goes after the shape code, only when the ends aren\'t flat', () => {
    expect(sheetFileName('bullet', 32, 'R', 'cyW', 'cF')).toBe('bullet__32_R_cyW_cF.png');
    expect(sheetFileName('stake', 16, 'F', 'diH', 'cL')).toBe('stake__16_F_diH_cL.png');
    expect(sheetFileName('pill', 16, 'T', 'cyT', 'cB')).toBe('pill__16_T_cyT_cB.png');
    expect(sheetFileName('log', 16, 'F', 'cyW', 'flat')).toBe('log__16_F_cyW.png');
    expect(sheetFileName('log', 16, 'F', 'cyW')).toBe('log__16_F_cyW.png');
    // other shapes have no ends, so nothing is added
    expect(sheetFileName('ball', 16, 'F', 'ell', 'cB')).toBe('ball__16_F_ell.png');
  });

  it('reads every setting back, and a missing code as Flat, so older sheets still load', () => {
    for (const shape of SHAPE_CODES) for (const ends of ENDS_CODES) {
      const name = sheetFileName('a_b', 64, 'Bk', shape, ends);
      expect(parseSheetName(name), name).toEqual({ base: 'a_b', n: 64, side: 'Bk', shape, ends: hasEnds(shape) ? ends : 'flat' });
    }
    expect(parseSheetName('rifle__32_R_cyW.png')?.ends).toBe('flat');
    expect(parseSheetName('rifle__32_R_cyW_cf.png')).toBeNull(); // codes are case-sensitive, like the others
    expect(parseSheetName('rifle__32_R_cyW_cX.png')).toBeNull();
  });

  it('the reader passes the ends on, and guesses Flat when the name lost its code', () => {
    const { sheet } = model(circle, 'F', 12, 'cyT', 'cF');
    expect(readSheet(sheet.image, 'bullet__16_F_cyT_cF.png')).toMatchObject({ shape: 'cyT', ends: 'cF', guessed: false, problem: null });
    expect(readSheet(sheet.image, 'bullet (copy).png')).toMatchObject({ shape: 'box', ends: 'flat', guessed: true });
  });
});

describe('Ends for Tube and Diamond: shape', () => {
  it('only Tube and Diamond have ends; ⊙ shapes get the Egg or Gem rule along ⊙, the others one cross cut', () => {
    expect(TUBES).toEqual(['cyW', 'cyH', 'cyT', 'diW', 'diH', 'diT']);
    expect(endCuts('ell', 'cB')).toEqual([]);
    expect(endCuts('cyW', 'flat')).toEqual([]);
    expect(endCuts('cyW', 'cL')).toEqual([{ kind: 'round', axis: 'H', along: 'W', first: false, last: true }]);
    expect(endCuts('diH', 'cF').map(c => [c.kind, c.axis, c.first, c.last])).toEqual([['diamond', 'W', true, false]]);
    expect(endCuts('cyT', 'cB')).toEqual([{ kind: 'round', axis: 'T', along: 'T', first: true, last: true }]);
  });

  it('a bullet drawn end-on gets a dome (Tube ⊙) or a point (Diamond ⊙) at the chosen end only', () => {
    // drawn from the Front, so the first end is the front (+z) and the last the back
    const flat = model(circle, 'F', 12, 'cyT', 'flat').m;
    const [front, back] = [flat.hi[2], flat.lo[2]];
    expect(layer(flat, 2, front)).toBe(80);
    const dome = model(circle, 'F', 12, 'cyT', 'cF').m, point = model(circle, 'F', 12, 'diT', 'cF').m;
    for (const [m, shape] of [[dome, 'cyT'], [point, 'diT']] as const) {
      expect(m.trimmed).toHaveLength(0);
      expect([m.lo[2], m.hi[2]]).toEqual([back, front]); // just as long
      // the back stays as it was (Diamond ⊙ cuts the drawn circle itself into a diamond)
      expect(layer(m, 2, back)).toBe(layer(model(circle, 'F', 12, shape, 'flat').m, 2, back));
    }
    expect(layer(dome, 2, front)).toBeLessThan(30);
    expect(layer(point, 2, front)).toBeLessThan(layer(dome, 2, front));
    // the dome's middle reaches the tip; five layers back it's the full circle again
    expect(layer(dome, 2, front - 5)).toBe(80);
    const capsule = model(circle, 'F', 12, 'cyT', 'cB').m;
    expect(layer(capsule, 2, back)).toBe(layer(dome, 2, front));
  });

  it('first and last are measured on the sprite as drawn, whatever side it was drawn from', () => {
    // the rod's first end is its left end. Drawn from the Front, the sprite's left is the world's left (low x);
    // drawn from the Back, it's the world's right
    for (const [side, roundAtLowX] of [['F', true], ['Bk', false]] as const) {
      const { m } = model(rod, side, 8, 'diW', 'cF');
      const loEnd = layer(m, 0, m.lo[0]), hiEnd = layer(m, 0, m.hi[0]);
      expect(loEnd < hiEnd, side).toBe(roundAtLowX);
    }
  });

  it('keeps the sprite\'s own panel and the model\'s size (a cut never empties a line)', () => {
    for (const shape of TUBES) for (const ends of SHAPED) {
      const flat = model(rod, 'R', 6, shape, 'flat').sheet, shaped = model(rod, 'R', 6, shape, ends).sheet;
      expect(shaped.size, `${shape} ${ends}`).toEqual(flat.size);
      if (shape.endsWith('T')) continue; // ⊙ shapes cut the sprite itself, but ends don't cut it any further
      const r = shaped.rects.R, W = shaped.image.width;
      for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) {
        expect(shaped.image.data[(y * W + x) * 4 + 3], `${shape} ${ends}`).toBe(flat.image.data[(y * W + x) * 4 + 3]);
      }
    }
  });

  it('a shaped end\'s panel folds the drawing round the end: the tip in the middle, one radius back at the rim', () => {
    // a Tube ↔ rod drawn from the Front, right end shaped: the Right panel looks at it. Its middle rows are 8 deep
    // (radius 4), so the middle shows the tip column (red) and the rim the colour 4 px back (blue)
    const { sheet } = model(rod, 'F', 8, 'cyW', 'cL');
    const r = sheet.rects.R, W = sheet.image.width, y = r.y + Math.floor(r.h / 2);
    const row = Array.from({ length: r.w }, (_, i) => Array.from(sheet.image.data.subarray((y * W + r.x + i) * 4, (y * W + r.x + i) * 4 + 3)));
    expect(row[Math.floor(r.w / 2)]).toEqual(ROD[0]);
    expect(row[Math.floor(r.w / 2) - 1]).toEqual(ROD[0]);
    expect(row[0]).toEqual(ROD[1]);
    expect(row[r.w - 1]).toEqual(ROD[1]);
    // the flat end (Left panel) keeps the plain edge scan: one colour per row
    const l = sheet.rects.L, ly = l.y + Math.floor(l.h / 2);
    for (let i = 0; i < l.w; i++) expect(Array.from(sheet.image.data.subarray((ly * W + l.x + i) * 4, (ly * W + l.x + i) * 4 + 3))).toEqual([90, 90, 90]);
  });
});

/** The user's session from session 2: every PSRC sprite with the side, thickness and shape they chose. */
const session = JSON.parse(readFileSync('test sprites/untitled.p3d.json', 'utf8'));
const psrc = (session.sprites.rows as { path: string; image: string; side: SideCode; depth: number; outline: boolean }[])
  .map(r => ({ ...r, img: decodePng(Buffer.from(session.images[r.image].png.split(',')[1], 'base64')) }));

describe('Ends for Tube and Diamond: round trip', () => {
  it('no paint is cut off on any unedited sheet (every PSRC sprite × Tube / Diamond × every ends setting)', () => {
    const bad: string[] = [];
    for (const r of psrc) for (const shape of TUBES) for (const ends of SHAPED) {
      const sh = makeSheet(r.img, { side: r.side, depth: r.depth, shape, ends, outlined: r.outline, frame: FRAME });
      if (!sh) continue;
      const read = readSheet(sh.image, sheetFileName('x', sh.n, r.side, shape, ends));
      expect(read.ends).toBe(ends);
      const m = buildVoxelModel(read, r.side, shape, MID, undefined, ends);
      if (m.trimmed.length) bad.push(`${r.path} ${shape} ${ends}: ${m.trimmed.length}`);
    }
    expect(bad).toEqual([]);
  }, 300_000);

  it('nor on any unedited Egg or Gem sheet (every PSRC sprite): Phase 2 finds the same depths from the panels', () => {
    const bad: string[] = [];
    for (const r of psrc) for (const shape of ['ell', 'dpy'] as ShapeCode[]) {
      const sh = makeSheet(r.img, { side: r.side, depth: r.depth, shape, outlined: r.outline, frame: FRAME });
      if (!sh) continue;
      const m = buildVoxelModel(readSheet(sh.image, sheetFileName('x', sh.n, r.side, shape)), r.side, shape, MID);
      if (m.trimmed.length) bad.push(`${r.path} ${shape}: ${m.trimmed.length}`);
    }
    expect(bad).toEqual([]);
  }, 300_000);
});
