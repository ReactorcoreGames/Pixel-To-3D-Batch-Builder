import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CUBE_SIZES, SHAPE_CODES, SIDE_CODES, VIEW, buildVoxelModel, colourModel, decodePng, encodePng, insideShader, makeSheet,
  panelMasks, readSheet, sheetFileName, sheetN, sheetSize, type RGBAImage, type ShapeCode, type SideCode, type VoxelModel,
} from '../src/core';
import { FISH, MUG, fishSheet, mugSheet, type RGB } from './painted';

const FRAME = { edge: '#1f5a44', core: '#a63ec5' };
const MID = { x: .5, y: .5, z: .5 };
const at = (m: VoxelModel, x: number, y: number, z: number) => m.solid[(z * m.n + y) * m.n + x] === 1;
const rgbOf = (c: number): RGB => [c >> 16, (c >> 8) & 255, c & 255];

/** A test sprite: a filled rectangle with a different colour on each edge row / column. */
function sprite(w: number, h: number): RGBAImage {
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set([x * 20 + 10, y * 20 + 10, 128, 255], (y * w + x) * 4);
  return { width: w, height: h, data };
}

/** The user's session from session 2: every PSRC sprite with the side, thickness and shape they chose. */
const session = JSON.parse(readFileSync('test sprites/untitled.p3d.json', 'utf8'));
const psrc = (session.sprites.rows as { path: string; image: string; side: SideCode; depth: number; shape: ShapeCode; outline: boolean }[])
  .map(r => ({ ...r, img: decodePng(Buffer.from(session.images[r.image].png.split(',')[1], 'base64')) }));

describe('sheet reader', () => {
  it('finds the cube size from the picture size alone', () => {
    for (const n of CUBE_SIZES) { const s = sheetSize(n); expect(sheetN(s.width, s.height)).toBe(n); }
    expect(sheetN(41, 60)).toBeNull();
  });

  it('reads side and shape from the file name and the panels from the layout', () => {
    const sh = makeSheet(sprite(6, 4), { side: 'R', depth: 3, shape: 'cyW', outlined: false, frame: FRAME })!;
    const read = readSheet(sh.image, `sheets/rifle${sheetFileName('', sh.n, 'R', 'cyW')}`);
    expect(read).toMatchObject({ n: 8, side: 'R', shape: 'cyW', guessed: false, nameMismatch: false, problem: null });
    // the sprite's own panel (Right) holds the sprite
    const p = read.panels!.R, r = sh.rects.R, n = 8, px = r.x - r.cx, py = r.y - r.cy;
    expect([...p.subarray((py * n + px) * 4, (py * n + px) * 4 + 4)]).toEqual([...sh.image.data.subarray((r.y * sh.image.width + r.x) * 4, (r.y * sh.image.width + r.x) * 4 + 4)]);
  });

  it('guesses Front / Box when the file name lost its settings code', () => {
    const sh = makeSheet(sprite(6, 4), { side: 'T', depth: 3, shape: 'ell', outlined: false, frame: FRAME })!;
    expect(readSheet(sh.image, 'rifle (copy).png')).toMatchObject({ n: 8, named: null, side: 'F', shape: 'box', guessed: true, problem: null });
  });

  it('trusts the picture size over the file name', () => {
    const sh = makeSheet(sprite(6, 4), { side: 'F', depth: 3, shape: 'box', outlined: false, frame: FRAME })!;
    expect(readSheet(sh.image, 'rifle__32_F_box.png')).toMatchObject({ n: 8, nameMismatch: true, problem: null });
  });

  it('explains a wrong picture size with the expected size and a likely cause', () => {
    const sh = makeSheet(sprite(20, 10), { side: 'F', depth: 4, shape: 'box', outlined: false, frame: FRAME })!; // N = 32
    const { width: w, height: h } = sh.image;
    const cropped = readSheet({ width: w, height: h - 7, data: sh.image.data.slice(0, w * (h - 7) * 4) }, 'rifle__32_F_box.png');
    expect(cropped.panels).toBeNull();
    expect(cropped.expected).toEqual({ width: w, height: h });
    expect(cropped.problem).toContain(`${w} × ${h - 7}`);
    expect(cropped.problem).toContain(`${w} × ${h} px`);
    expect(cropped.problem).toContain('cropped');
    const big = { width: w * 2, height: h * 2, data: new Uint8Array(w * h * 16) };
    expect(readSheet(big, 'rifle__32_F_box.png').problem).toContain('scaled up 2×');
    // with no code in the name, the expected size is the sheet nearest in width
    expect(readSheet({ width: w, height: h - 1, data: new Uint8Array(w * (h - 1) * 4) }, 'rifle.png').expected).toEqual({ width: w, height: h });
  });

  it('refuses a sheet with nothing painted on it', () => {
    const { width, height } = sheetSize(8);
    expect(readSheet({ width, height, data: new Uint8Array(width * height * 4) }, 'x__8_F_box.png').problem).toContain('Nothing to build');
  });

  it('counts pixels as solid from alpha 50%', () => {
    const sh = makeSheet(sprite(2, 2), { side: 'F', depth: 2, shape: 'box', outlined: false, frame: FRAME })!;
    const img = { ...sh.image, data: sh.image.data.slice() };
    // make the whole Front panel faint: the model loses nothing (Back still has it), but Front no longer counts
    const r = sh.rects.F;
    for (let y = r.cy; y < r.cy + sh.n; y++) for (let x = r.cx; x < r.cx + sh.n; x++) if (img.data[(y * img.width + x) * 4 + 3]) img.data[(y * img.width + x) * 4 + 3] = 127;
    const masks = panelMasks(readSheet(img, 'x__8_F_box.png'));
    expect(masks.F.some(Boolean)).toBe(false);
    expect(masks.Bk.some(Boolean)).toBe(true);
  });
});

describe('round trip: Phase 1 sheets come back unchanged (DESIGN.md §5, "strict superset")', () => {
  /** The plain visual hull: every voxel that all six panels allow. */
  function plainHull(masks: Record<SideCode, Uint8Array>, n: number) {
    const out = new Uint8Array(n * n * n).fill(1), c = [0, 0, 0];
    for (const p of SIDE_CODES) {
      const v = VIEW[p], m = masks[p];
      for (let z = 0, i = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++, i++) {
        if (!out[i]) continue;
        c[0] = x; c[1] = y; c[2] = z;
        const px = v.px[1] ? n - 1 - c[v.px[0]] : c[v.px[0]], py = v.py[1] ? n - 1 - c[v.py[0]] : c[v.py[0]];
        if (!m[py * n + px]) out[i] = 0;
      }
    }
    return out;
  }
  const differences = (a: Uint8Array, b: Uint8Array) => { let d = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++; return d; };

  it('an unedited Box sheet gives exactly the plain visual hull, at any split (every PSRC sprite)', () => {
    for (const r of psrc) {
      const sh = makeSheet(r.img, { side: r.side, depth: r.depth, shape: 'box', outlined: r.outline, frame: FRAME })!;
      const read = readSheet(decodePng(encodePng(sh.image)), sheetFileName('x', sh.n, r.side, 'box'));
      const hull = plainHull(panelMasks(read), sh.n);
      for (const s of [MID, { x: 0, y: 1, z: .3 }]) {
        const m = buildVoxelModel(read, r.side, 'box', s);
        expect(differences(m.solid, hull), r.path).toBe(0);
        expect(m.trimmed).toHaveLength(0);
      }
    }
  }, 60_000);

  it('no paint is cut off on any unedited sheet, whatever its shape (every PSRC sprite × every shape)', () => {
    const bad: string[] = [];
    for (const r of psrc) for (const shape of SHAPE_CODES) {
      const sh = makeSheet(r.img, { side: r.side, depth: r.depth, shape, outlined: r.outline, frame: FRAME });
      if (!sh) continue;
      const m = buildVoxelModel(readSheet(sh.image, sheetFileName('x', sh.n, r.side, shape)), r.side, shape, MID);
      if (m.trimmed.length) bad.push(`${r.path} ${shape}: ${m.trimmed.length}`);
    }
    expect(bad).toEqual([]);
  }, 120_000);

  it('keeps the measured size of the Phase 1 model', () => {
    for (const r of psrc.slice(0, 20)) {
      const sh = makeSheet(r.img, { side: r.side, depth: r.depth, shape: r.shape, outlined: r.outline, frame: FRAME })!;
      const m = buildVoxelModel(readSheet(sh.image, sheetFileName('x', sh.n, r.side, r.shape)), r.side, r.shape, MID);
      expect([0, 1, 2].map(k => m.hi[k] - m.lo[k] + 1)).toEqual(sh.size);
    }
  });
});

describe('split planes (hand-painted test sheets)', () => {
  const mug = readSheet(mugSheet(), 'mug__16_F_box.png');

  it('a hole painted on Top goes as deep as the ↕ split says', () => {
    // the mug is 12 tall (y 2–13); Top's share is measured from the top
    const shallow = buildVoxelModel(mug, 'F', 'box', { ...MID, y: .25 });
    expect(shallow.trimmed).toHaveLength(0);
    expect([13, 12, 11, 10, 2].map(y => at(shallow, 7, y, 7))).toEqual([false, false, false, true, true]); // 3 deep
    const half = buildVoxelModel(mug, 'F', 'box', MID);
    expect([8, 7].map(y => at(half, 7, y, 7))).toEqual([false, true]); // 6 deep
    const through = buildVoxelModel(mug, 'F', 'box', { ...MID, y: 1 });
    expect(at(through, 7, 2, 7)).toBe(false); // all the way: a through-hole, as with the plain hull
    const none = buildVoxelModel(mug, 'F', 'box', { ...MID, y: 0 });
    expect(at(none, 7, 13, 7)).toBe(true); // Bottom decides everything: no hole
    // the walls stay
    expect(at(shallow, 3, 13, 7) && at(shallow, 12, 13, 7) && at(shallow, 7, 13, 3) && at(shallow, 7, 13, 12)).toBe(true);
  });

  it('the handle keeps its through-hole', () => {
    const m = buildVoxelModel(mug, 'F', 'box', MID);
    expect(at(m, 13, 7, 7)).toBe(false);
    expect(at(m, 14, 7, 7) && at(m, 13, 5, 7) && at(m, 13, 10, 8)).toBe(true);
    expect(at(m, 14, 7, 6)).toBe(false); // the handle is 2 deep
  });

  it('the fish gets a wide, short head and a tall, thin tail', () => {
    const fish = readSheet(fishSheet(), 'fish__32_F_box.png');
    const m = buildVoxelModel(fish, 'F', 'box', MID);
    expect(m.trimmed).toHaveLength(0);
    const extent = (x: number, axis: 1 | 2) => { const s = new Set<number>(); for (let z = 0; z < 32; z++) for (let y = 0; y < 32; y++) if (at(m, x, y, z)) s.add(axis === 1 ? y : z); return s.size; };
    expect([extent(10, 2), extent(10, 1)]).toEqual([8, 10]); // head: 8 wide, 10 tall
    expect([extent(26, 2), extent(26, 1)]).toEqual([2, 14]); // tail: 2 wide, 14 tall
    // the plain visual hull (both ends ruled by both outlines) can't do this: its head is only 2 wide
    const hullHead = buildVoxelModel(fish, 'F', 'box', { ...MID, x: 0 }); // Right rules the whole length
    const s = new Set<number>(); for (let z = 0; z < 32; z++) for (let y = 0; y < 32; y++) if (at(hullHead, 10, y, z)) s.add(z);
    expect(s.size).toBe(2);
  });

  it('paint that the other sides don\'t allow is counted, marked and placed on the viewer\'s side', () => {
    const m = buildVoxelModel(readSheet(mugSheet(true), 'mug__16_F_box.png'), 'F', 'box', MID);
    expect(m.trimmed).toHaveLength(4);
    expect(new Set(m.trimmed.map(t => t.panel))).toEqual(new Set(['T']));
    for (const t of m.trimmed) expect(t.at[1]).toBe(m.hi[1]); // on the top of the model's box
  });
});

describe('colours', () => {
  it('the input side wins where several panels see a voxel', () => {
    const img = sprite(4, 3), sh = makeSheet(img, { side: 'F', depth: 2, shape: 'box', outlined: false, frame: FRAME })!;
    const read = readSheet(sh.image, sheetFileName('x', sh.n, 'F', 'box'));
    const m = buildVoxelModel(read, 'F', 'box', MID), c = colourModel(m, read, 'F', 'opp');
    // the top-left front corner voxel is seen by Front, Left and Top: it shows the sprite's top-left pixel
    const i = (m.hi[2] * m.n + m.hi[1]) * m.n + m.lo[0];
    expect(rgbOf(c.colour[i])).toEqual([10, 10, 128]);
    expect(c.gaps).toBe(0);
  });

  it('gap colour: the floor of a blind hole takes the opposite panel, or the nearest painted pixel', () => {
    const mug = readSheet(mugSheet(), 'mug__16_F_box.png');
    const m = buildVoxelModel(mug, 'F', 'box', { ...MID, y: .25 }), floor = (10 * 16 + 10) * 16 + 7; // (7, 10, 10): hole floor
    expect(at(m, 7, 10, 10)).toBe(true);
    const opp = colourModel(m, mug, 'F', 'opp'), near = colourModel(m, mug, 'F', 'near');
    expect(rgbOf(opp.colour[floor])).toEqual(MUG.base);
    expect(rgbOf(near.colour[floor])).toEqual(MUG.rim);
    expect(opp.gaps).toBe(36); // the 6 × 6 floor
  });

  it('the fish keeps its painted colours', () => {
    const fish = readSheet(fishSheet(), 'fish__32_F_box.png');
    const m = buildVoxelModel(fish, 'F', 'box', MID), c = colourModel(m, fish, 'F', 'opp');
    const seen = new Set<string>();
    for (let i = 0; i < m.solid.length; i++) if (c.dist[i] === 1) seen.add(rgbOf(c.colour[i]).join());
    expect(seen).toEqual(new Set([FISH.body, FISH.belly, FISH.fin].map(x => x.join())));
  });
});

describe('distance to the surface and inside styles', () => {
  const cube = (() => {
    const sh = makeSheet(sprite(5, 5), { side: 'F', depth: 5, shape: 'box', outlined: false, frame: FRAME })!;
    const read = readSheet(sh.image, sheetFileName('x', sh.n, 'F', 'box'));
    const m = buildVoxelModel(read, 'F', 'box', MID);
    return { m, c: colourModel(m, read, 'F', 'opp') };
  })();

  it('counts steps in from the surface, and carries the surface colour inwards', () => {
    const { m, c } = cube, [x0, y0, z0] = m.lo, id = (x: number, y: number, z: number) => ((z0 + z) * m.n + y0 + y) * m.n + x0 + x;
    expect([c.dist[id(0, 0, 0)], c.dist[id(1, 1, 1)], c.dist[id(2, 2, 2)], c.dist[id(2, 2, 0)]]).toEqual([1, 2, 3, 1]);
    expect(c.maxDist).toBe(3);
    expect(c.deep[id(2, 2, 2)]).toBe(3);
    expect(c.colour[id(2, 2, 2)]).toBeGreaterThan(0);
  });

  it('every inside style gives the same colours every time, and Hollow gives none', () => {
    const cols: [number, number, number] = [0x6b4a2f, 0xa8784a, 0xe8d2a6];
    for (const inside of ['solid', 'noise', 'onion', 'rings', 'strata', 'crystal', 'fractal', 'flesh', 'machine'] as const) {
      const a = insideShader({ inside, colours: cols, noise: 30, scale: 4 }), b = insideShader({ inside, colours: cols, noise: 30, scale: 4 });
      for (const [x, y, z, d] of [[3, 4, 5, 2], [10, 1, 7, 4], [0, 0, 0, 3]]) {
        const v = a(x, y, z, d, 6, 0x123456);
        expect(v).toBe(b(x, y, z, d, 6, 0x123456));
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(0xffffff);
      }
    }
    expect(insideShader({ inside: 'hollow', colours: cols, noise: 0, scale: 4 })(1, 1, 1, 2, 3, 0)).toBe(-1);
    expect(insideShader({ inside: 'nearest', colours: cols, noise: 0, scale: 4 })(1, 1, 1, 2, 3, 0x123456)).toBe(0x123456);
    expect(insideShader({ inside: 'solid', colours: cols, noise: 0, scale: 4 })(1, 1, 1, 2, 3, 0)).toBe(cols[0]);
  });

  it('Flesh & bone puts the bone down the thickest middle only', () => {
    const f = insideShader({ inside: 'flesh', colours: [1, 2, 3], noise: 0, scale: 4 });
    expect(f(0, 0, 0, 6, 6, 0)).toBe(3); // the middle of a thick part
    expect(f(0, 0, 0, 2, 6, 0)).toBe(1); // just under the skin
    expect(f(0, 0, 0, 2, 2, 0)).toBe(2); // a thin part: no bone
  });
});

// Writes the hand-painted test sheets as PNGs for trying them in the app.
it.runIf(process.env.WRITE_TEST_SHEETS)('writes the test sheets', () => {
  const dir = 'tests/fixtures/phase2 test sheets';
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/mug__16_F_box.png`, encodePng(mugSheet()));
  writeFileSync(`${dir}/mug stray paint__16_F_box.png`, encodePng(mugSheet(true)));
  writeFileSync(`${dir}/fish__32_F_box.png`, encodePng(fishSheet()));
});
