import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  BUMP_STYLES, MATERIAL_PBR, SHAPE_CODES, SIDE_CODES, VIEW, buildMesh, buildVoxelModel, colourModel, decodePng, initMesh, makeSheet, normalMapOf, normalScale, occlusionMapOf, occlusionOf, outlineOf,
  readGlb, readSheet, ringArea, rowsOutline, sheetFileName, spriteAxes, straighten, textureMesh, traceMask, shadedAtlas, trimMapOf, writeGlb,
  hasEnds, type EndsCode, type MeshData, type RGBAImage, type ShapeCode, type SideCode, type TexturedMesh, type VoxelModel,
} from '../src/core';
import { fishSheet, mugSheet } from './painted';

const FRAME = { edge: '#1f5a44', core: '#a63ec5' };
const MID = { x: .5, y: .5, z: .5 };
const SOFT = { style: 'soft', bump: 6, grit: 0 } as const;
/** A bright 8 × 8 patch in the middle of a dark 16 × 16 picture. */
function patch(): RGBAImage {
  const W = 16, data = new Uint8Array(W * W * 4);
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) data.set(x >= 4 && x < 12 && y >= 4 && y < 12 ? [220, 200, 160, 255] : [40, 30, 30, 255], (y * W + x) * 4);
  return { width: W, height: W, data };
}
const px = (m: RGBAImage, x: number, y: number, W = m.width) => Array.from(m.data.subarray((y * W + x) * 4, (y * W + x) * 4 + 3));

/** The user's session from session 2: every PSRC sprite with the side, thickness and shape they chose. */
const session = JSON.parse(readFileSync('test sprites/untitled.p3d.json', 'utf8'));
const psrc = (session.sprites.rows as { path: string; image: string; side: SideCode; depth: number; shape: ShapeCode; outline: boolean }[])
  .map(r => ({ ...r, img: decodePng(Buffer.from(session.images[r.image].png.split(',')[1], 'base64')) }));

/** An unedited Phase 1 sheet read back and carved. */
function modelOf(r: (typeof psrc)[number], shape: ShapeCode = r.shape, ends: EndsCode = 'flat') {
  const sh = makeSheet(r.img, { side: r.side, depth: r.depth, shape, ends, outlined: r.outline, frame: FRAME })!;
  const read = readSheet(sh.image, sheetFileName('x', sh.n, r.side, shape, ends));
  return { sheet: sh, read, model: buildVoxelModel(read, r.side, shape, MID, undefined, ends) };
}

function volume(m: MeshData) {
  const p = m.positions, idx = m.indices;
  let v = 0;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    v += p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) - p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c]);
  }
  return v / 6;
}

/** Closed and consistently wound: with vertices merged by position, every edge is used as often in one direction as
    in the other (once each, or twice each where two parts of the model touch along an edge). */
function watertight(m: MeshData): boolean {
  const id = new Map<string, number>(), vid: number[] = [];
  for (let i = 0; i < m.positions.length / 3; i++) {
    const k = `${m.positions[i * 3]},${m.positions[i * 3 + 1]},${m.positions[i * 3 + 2]}`;
    if (!id.has(k)) id.set(k, id.size);
    vid.push(id.get(k)!);
  }
  const edges = new Map<string, number>();
  for (let t = 0; t < m.indices.length; t += 3) for (let c = 0; c < 3; c++) {
    const a = vid[m.indices[t + c]], b = vid[m.indices[t + (c + 1) % 3]];
    edges.set(`${a},${b}`, (edges.get(`${a},${b}`) ?? 0) + 1);
  }
  for (const [k, count] of edges) { const [a, b] = k.split(','); if (edges.get(`${b},${a}`) !== count) return false; }
  return edges.size > 0;
}

/** Holes through a closed one-piece mesh, from its Euler characteristic V − E + F = 2 − 2g, with vertices merged by
    position and every triangle side counted as half an edge. */
function genus(m: MeshData): number {
  const v = new Set<string>();
  for (let i = 0; i < m.positions.length / 3; i++) v.add(`${m.positions[i * 3]},${m.positions[i * 3 + 1]},${m.positions[i * 3 + 2]}`);
  const f = m.indices.length / 3;
  return (2 - (v.size - f * 3 / 2 + f)) / 2;
}

/** How far the mesh reaches along world axis k on the line through (a, b) in the other two axes (ascending). */
function lineSpan(m: MeshData, k: number, a: number, b: number): number {
  const [p, q] = [0, 1, 2].filter(x => x !== k), P = m.positions, I = m.indices;
  let lo = Infinity, hi = -Infinity;
  for (let t = 0; t < I.length; t += 3) {
    const v = [0, 1, 2].map(c => [P[I[t + c] * 3 + p], P[I[t + c] * 3 + q], P[I[t + c] * 3 + k]]);
    const d = (v[1][0] - v[0][0]) * (v[2][1] - v[0][1]) - (v[2][0] - v[0][0]) * (v[1][1] - v[0][1]);
    if (Math.abs(d) < 1e-12) continue;
    const w1 = ((v[1][0] - a) * (v[2][1] - b) - (v[2][0] - a) * (v[1][1] - b)) / d, w2 = ((v[2][0] - a) * (v[0][1] - b) - (v[0][0] - a) * (v[2][1] - b)) / d, w0 = 1 - w1 - w2;
    if (w0 < 0 || w1 < 0 || w2 < 0) continue;
    const at = w0 * v[0][2] + w1 * v[1][2] + w2 * v[2][2];
    lo = Math.min(lo, at); hi = Math.max(hi, at);
  }
  return hi - lo;
}

/** The sprite's own pixels the mesh covers: every triangle projected along the sprite's thickness, pixel centres tested. */
function coveredOnSpriteSide(mesh: MeshData, m: VoxelModel): Set<number> {
  const n = m.n, k = VIEW[m.side].look[0], [a, b] = [0, 1, 2].filter(x => x !== k), out = new Set<number>();
  const P = mesh.positions, I = mesh.indices;
  for (let t = 0; t < I.length; t += 3) {
    const pts = [0, 1, 2].map(c => [P[I[t + c] * 3 + a], P[I[t + c] * 3 + b]]);
    const [[x0, y0], [x1, y1], [x2, y2]] = pts, d = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
    if (Math.abs(d) < 1e-12) continue;
    for (let j = Math.floor(Math.min(y0, y1, y2)); j <= Math.ceil(Math.max(y0, y1, y2)); j++) for (let i = Math.floor(Math.min(x0, x1, x2)); i <= Math.ceil(Math.max(x0, x1, x2)); i++) {
      const px = i + .5, py = j + .5;
      const w1 = ((x1 - px) * (y2 - py) - (x2 - px) * (y1 - py)) / d, w2 = ((x2 - px) * (y0 - py) - (x0 - px) * (y2 - py)) / d, w3 = 1 - w1 - w2;
      if (w1 >= -1e-9 && w2 >= -1e-9 && w3 >= -1e-9) out.add(j * n + i);
    }
  }
  return out;
}

beforeAll(async () => { await initMesh(); });

describe('outlines', () => {
  const mask = (rows: string[]) => ({ w: rows[0].length, h: rows.length, m: rows.flatMap(r => [...r].map(c => (c === '#' ? 1 : 0))) });

  it('traces a square as one counter-clockwise ring of 4 corners', () => {
    const { w, h, m } = mask(['###', '###']);
    const rings = traceMask(m, w, h);
    expect(rings).toHaveLength(1);
    expect(rings[0]).toHaveLength(4);
    expect(ringArea(rings[0])).toBe(6);
  });

  it('traces a hole as a clockwise ring, and keeps diagonal neighbours apart', () => {
    const { w, h, m } = mask(['###', '#.#', '###']);
    const areas = traceMask(m, w, h).map(ringArea).sort((x, y) => x - y);
    expect(areas).toEqual([-1, 9]);
    const d = mask(['#.', '.#']);
    expect(traceMask(d.m, d.w, d.h).map(ringArea)).toEqual([1, 1]);
  });

  it('straightens 1:1 and 2:1 pixel slopes, but keeps 1px bumps and every step at tolerance 0', () => {
    // a right triangle drawn as a 1:1 staircase
    const tri = mask(['#.....', '##....', '###...', '####..', '#####.', '######']);
    const [ring] = traceMask(tri.m, tri.w, tri.h);
    expect(ring.length).toBeGreaterThan(8);
    expect(straighten(ring, .9)).toHaveLength(3);
    expect(straighten(ring, 0)).toEqual(ring);
    // a 2:1 slope straightens too; a 3:1 one keeps its steps at 0.9
    const two = mask(['##......', '####....', '######..', '########']);
    expect(outlineOf(two.m, two.w, two.h, .9)[0]).toHaveLength(3);
    const three = mask(['###......', '######...', '#########']);
    expect(outlineOf(three.m, three.w, three.h, .9)[0].length).toBeGreaterThan(3);
    // a 1px bump on a straight edge survives
    const bump = mask(['...#...', '#######', '#######', '#######']);
    expect(outlineOf(bump.m, bump.w, bump.h, .9)[0]).toHaveLength(8);
  });

  it('chamfers the 1px steps of rounded corners, but not teeth or notches, and not below 0.71px', () => {
    // a bottle's cross-section seen from above: a square with its corner pixels left out becomes an octagon
    const round = mask(['.####.', '######', '######', '######', '######', '.####.']);
    expect(outlineOf(round.m, round.w, round.h, .9)[0]).toHaveLength(8);
    expect(outlineOf(round.m, round.w, round.h, .5)[0]).toHaveLength(12);
    // a 1px tooth and a 1px notch on a straight edge keep their square corners
    const tooth = mask(['..#...', '######', '######']);
    expect(outlineOf(tooth.m, tooth.w, tooth.h, .9)[0]).toHaveLength(8);
    const notch = mask(['##.###', '######', '######']);
    expect(outlineOf(notch.m, notch.w, notch.h, .9)[0]).toHaveLength(8);
  });

  it('a mirrored shape straightens into a mirrored outline: a bottle’s double-stepped shoulder is cut the same on both sides', () => {
    // the glass bottle's profile from the user report: body 5–11, one row 6–10, neck 7–9
    const lo = [...Array(9).fill(5), 6, 7, 7, 7], hi = lo.map(x => 16 - x);
    const key = (r: [number, number][]) => r.map(p => p.join()).sort().join(' ');
    const mirror = (r: [number, number][]) => r.map(([x, y]) => [16 - x, y] as [number, number]);
    for (const tol of [.9, 1, 2]) {
      const ring = rowsOutline(lo, hi, tol);
      expect(key(mirror(ring)), `profile, tolerance ${tol}`).toBe(key(ring));
      // the same bottle as a mask, traced like a silhouette
      const w = 16, h = lo.length, mask = new Uint8Array(w * h);
      lo.forEach((x, j) => mask.fill(1, j * w + x, j * w + hi[j]));
      const [outline] = outlineOf(mask, w, h, tol);
      expect(key(mirror(outline)), `outline, tolerance ${tol}`).toBe(key(outline));
    }
  });

  it('a mirrored silhouette straightens into a mirrored outline: the lamp shade’s lower shoulders are both slants', () => {
    // the lamp from the user report (19 - lamp (2), seen from the front): a stem under a round shade; at 0.8 one lower
    // shoulder became a slant and the other kept its steps
    const lo = [27, 27, ...Array(21).fill(31), 30, 30, 28, 27, 27, 26, 26, 26, 26, 27, 27, 28, 30], hi = lo.map(x => 64 - x);
    const w = 64, h = lo.length, m = new Uint8Array(w * h);
    lo.forEach((x, j) => m.fill(1, j * w + x, j * w + hi[j]));
    const key = (r: [number, number][]) => r.map(p => p.join()).sort().join(' ');
    for (const tol of [.7, .8, .9, 1.5]) {
      const [outline] = outlineOf(m, w, h, tol);
      expect(key(outline.map(([x, y]) => [64 - x, y] as [number, number])), `tolerance ${tol}`).toBe(key(outline));
    }
  });
});

describe('the low-poly mesh', () => {
  it('an unedited Box sheet at slope 0, without corner bridges, gives exactly the voxel model: same volume, closed (every PSRC sprite)', () => {
    for (const r of psrc) {
      const { model } = modelOf(r, 'box');
      const mesh = buildMesh(model, { slope: 0, sides: 8, bridges: false });
      expect(watertight(mesh), r.path).toBe(true);
      expect(volume(mesh), r.path).toBeCloseTo(model.count, 3);
    }
  });

  it('every shape gives a closed mesh the size of the voxel model (every PSRC sprite with its own shape, the first ten with every shape)', () => {
    psrc.forEach((r, i) => {
      for (const shape of i < 10 ? SHAPE_CODES : [r.shape]) for (const slope of [0, .9]) {
        const { model } = modelOf(r, shape);
        const mesh = buildMesh(model, { slope, sides: 8 });
        const what = `${r.path} ${shape} slope ${slope}`;
        expect(watertight(mesh), what).toBe(true);
        expect(volume(mesh), what).toBeGreaterThan(0);
        // a triangle takes its whole texture from one panel
        for (let t = 0; t < mesh.indices.length; t += 3) {
          const p = mesh.panel[mesh.indices[t]];
          if (mesh.panel[mesh.indices[t + 1]] !== p || mesh.panel[mesh.indices[t + 2]] !== p) expect.fail(`${what}: a triangle mixes panels`);
        }
        // straightening may shave a corner off, but never by a whole pixel
        for (let k = 0; k < 3; k++) {
          expect(mesh.lo[k], what).toBeGreaterThan(model.lo[k] - 1e-4);
          expect(mesh.lo[k], what).toBeLessThan(model.lo[k] + 1);
          expect(mesh.hi[k], what).toBeLessThan(model.hi[k] + 1 + 1e-4);
          expect(mesh.hi[k], what).toBeGreaterThan(model.hi[k]);
        }
      }
    });
  }, 120000);

  it('keeps every pixel of the sprite on its own side at slope 0, whatever the shape (except the ⊙ ones, which cut it)', () => {
    psrc.forEach((r, i) => {
      for (const shape of (i < 10 ? SHAPE_CODES : [r.shape]).filter(s => !s.endsWith('T'))) {
        const { model, read } = modelOf(r, shape);
        const covered = coveredOnSpriteSide(buildMesh(model, { slope: 0, sides: 8 }), model);
        const n = model.n, k = VIEW[r.side].look[0], [a, b] = [0, 1, 2].filter(x => x !== k);
        let missing = 0;
        for (let py = 0; py < n; py++) for (let px = 0; px < n; px++) {
          if (!model.mask[r.side][py * n + px]) continue;
          // the panel pixel's position in the plane across the sprite's view
          const v = VIEW[r.side], c = [0, 0, 0];
          c[v.px[0]] = v.px[1] ? n - 1 - px : px; c[v.py[0]] = v.py[1] ? n - 1 - py : py;
          if (!covered.has(c[b] * n + c[a])) missing++;
        }
        expect(missing, `${r.path} ${shape}`).toBe(0);
        void read;
      }
    });
  }, 120000);

  it('round shapes follow the Sides setting; straightened tapers and balls are lighter than stepped ones', () => {
    const boulder = psrc.find(r => r.path.includes('large boulder'))!, { model } = modelOf(boulder, 'ell');
    const stepped = buildMesh(model, { slope: 0, sides: 8 }), lofted = buildMesh(model, { slope: .9, sides: 8 });
    expect(lofted.triangles).toBeLessThan(stepped.triangles * .7);
    const log = psrc.find(r => r.path.includes('wooden log side'))!, logModel = modelOf(log).model;
    const t6 = buildMesh(logModel, { slope: .9, sides: 6 }).triangles, t12 = buildMesh(logModel, { slope: .9, sides: 12 }).triangles;
    expect(t12).toBeGreaterThan(t6);
    expect(buildMesh(logModel, { slope: .9, sides: 8 }).triangles).toBeLessThan(40); // a straight log is one octagonal prism
  });

  it('balls and the other all-round shapes come out clean and round: no shards at their corners, and a profile that follows the outline', () => {
    // flat faces (triangles grouped by plane) smaller than 0.05 px²: the shards two crossing lofts left at a ball's corners
    const shards = (m: MeshData) => {
      const area = new Map<string, number>(), p = m.positions, idx = m.indices, nm = m.normals;
      for (let t = 0; t < idx.length; t += 3) {
        const [a, b, c] = [0, 1, 2].map(i => idx[t + i] * 3), u = [0, 1, 2].map(k => p[b + k] - p[a + k]), v = [0, 1, 2].map(k => p[c + k] - p[a + k]);
        const key = [0, 1, 2].map(k => nm[a + k].toFixed(3)).join() + '|' + (nm[a] * p[a] + nm[a + 1] * p[a + 1] + nm[a + 2] * p[a + 2]).toFixed(2);
        area.set(key, (area.get(key) ?? 0) + Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]) / 2);
      }
      return [...area.values()].filter(x => x < .05).length;
    };
    // every PSRC ball with its own shape (Egg), and two boxy sprites as Soft box and Gem
    const cases: [(typeof psrc)[number], ShapeCode][] = [
      ...psrc.filter(r => r.shape === 'ell' && /ball|basebal/.test(r.path)).map(r => [r, r.shape] as [(typeof psrc)[number], ShapeCode]),
      ...['wooden crate', 'chest'].flatMap(name => (['rbox', 'dpy'] as const).map(s => [psrc.find(r => r.path.includes(name))!, s] as [(typeof psrc)[number], ShapeCode])),
    ];
    expect(cases.length).toBe(10);
    for (const [r, shape] of cases) for (const sides of [8, 16]) {
      // a stray one where a panel's straightened outline clips a ring right at its corner is harmless (since session
      // 7c's Egg, the basketball at 8 sides has one of 0.004 px²); crossing lofts left dozens
      expect(shards(buildMesh(modelOf(r, shape).model, { slope: .9, sides })), `${r.path} ${shape} ${sides} sides`).toBeLessThanOrEqual(1);
    }
    // the 5px baseball from the user report: 240 triangles of shards before
    const baseball = psrc.find(r => r.path.includes('basebal.'))!;
    expect(buildMesh(modelOf(baseball).model, { slope: .9, sides: 8 }).triangles).toBeLessThan(100);
    // the 16px volleyball: its profile is the outline's octagon with the corners rounded at 16 sides, so seen from the
    // side it is as round as it is from above (a spinning top or a capsule before); here, at least 12 heights have rings
    const volley = modelOf(psrc.find(r => r.path.includes('volleyball'))!).model;
    const m16 = buildMesh(volley, { slope: .9, sides: 16 }), heights = new Set<string>();
    for (let i = 0; i < m16.positions.length; i += 3) heights.add(m16.positions[i + 1].toFixed(3));
    expect(heights.size).toBeGreaterThanOrEqual(12);
    expect(m16.triangles).toBeGreaterThan(buildMesh(volley, { slope: .9, sides: 8 }).triangles);
  });

  it('a ring as Egg, Gem or a capped ⊙ tube follows the voxel model: one hole, and no "petals" filling the rows beside it', () => {
    // a ring 32 across with a hole 12 across: its rows just above and below the hole are deep at both ends and shallow
    // in the middle, which a ring fitted to each row filled in; such shapes get the traced surface of their rule
    const W = 32, img = { width: W, height: W, data: new Uint8Array(W * W * 4) };
    for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) { const r = Math.hypot(x - 15.5, y - 15.5); if (r >= 6 && r <= 15.5) img.data.set([150, 120, 90, 255], (y * W + x) * 4); }
    const ring = { path: 'ring', image: '', side: 'F' as SideCode, depth: 24, shape: 'ell' as ShapeCode, outline: false, img };
    for (const [shape, ends] of [['ell', 'flat'], ['dpy', 'flat'], ['cyT', 'cB']] as [ShapeCode, EndsCode][]) {
      const { model } = modelOf(ring, shape, ends), what = `${shape} ${ends}`, n = model.n;
      const m8 = buildMesh(model, { slope: .9, sides: 8 }), m16 = buildMesh(model, { slope: .9, sides: 16 });
      for (const mesh of [m8, m16]) {
        expect(watertight(mesh), what).toBe(true);
        expect(mesh.parts, what).toBe(1);
        expect(genus(mesh), what).toBe(1);
        for (let k = 0; k < 3; k++) {
          expect(mesh.lo[k], what).toBeGreaterThan(model.lo[k] - 1e-4);
          expect(mesh.hi[k], what).toBeLessThan(model.hi[k] + 1 + 1e-4);
        }
      }
      // down the middle column, through the band above the hole, the hole and the band below: never more than 3
      // deeper than the voxel model (the petals filled the rows beside the hole to the full thickness), and most of
      // the thickness where the band is thickest (a Gem's sharp ridge is traced a little blunt)
      const x = Math.floor((model.lo[0] + model.hi[0] + 1) / 2), full = model.hi[2] - model.lo[2] + 1;
      let deepest = 0;
      for (let y = model.lo[1]; y <= model.hi[1]; y++) {
        let depth = 0;
        for (let z = 0; z < n; z++) depth += model.solid[(z * n + y) * n + x];
        const span = lineSpan(m16, 2, x + .31, y + .37);
        if (depth) expect(span, `${what} row ${y}`).toBeLessThan(depth + 3);
        deepest = Math.max(deepest, span);
      }
      expect(deepest, what).toBeGreaterThan(full * .75);
      expect(m16.triangles, what).toBeGreaterThan(m8.triangles);
    }
  });

  it('through-holes come for free, and a split never leaves a skin across a hole: the mesh has the same holes as the voxel model', async () => {
    // the reference: manifold's own union of the voxel cubes
    const { default: Module } = await import('manifold-3d');
    const w = await Module(); w.setup();
    const voxelGenus = (m: VoxelModel) => {
      const cubes = [];
      for (let z = 0; z < m.n; z++) for (let y = 0; y < m.n; y++) for (let x = 0; x < m.n; x++) if (m.solid[(z * m.n + y) * m.n + x]) cubes.push(w.Manifold.cube([1, 1, 1]).translate([x, y, z]));
      return w.Manifold.union(cubes).genus();
    };
    const mug = readSheet(mugSheet(), 'mug__16_F_box.png'), fish = readSheet(fishSheet(), 'fish__32_F_box.png');
    const cases: [typeof mug, { x: number; y: number; z: number }, number][] = [
      // the mug: the handle is one hole; the top hole becomes a second one when it goes all the way down
      ...[0, .25, .5, .75].map(y => [mug, { ...MID, y }, 1] as [typeof mug, typeof MID, number]),
      [mug, { ...MID, y: 1 }, 2], [mug, { x: 0, y: 1, z: 1 }, 2], [mug, { x: 1, y: 0, z: 0 }, 1],
      ...[0, .3, .5, .7, 1].map(x => [fish, { ...MID, x }, -1] as [typeof mug, typeof MID, number]),
    ];
    for (const [read, splits, expected] of cases) {
      const m = buildVoxelModel(read, 'F', 'box', splits), want = voxelGenus(m);
      if (expected >= 0) expect(want).toBe(expected);
      for (const slope of [0, .9]) {
        const mesh = buildMesh(m, { slope, sides: 8 });
        expect(watertight(mesh)).toBe(true);
        expect(genus(mesh), `${read.file} ${JSON.stringify(splits)} slope ${slope}`).toBe(want);
      }
    }
  }, 30000);

  it('pixels that touch only at a corner are bridged, so the lock’s shackle and the key’s bow hold together', () => {
    for (const name of ['29 - lock', '30 - key']) {
      const r = psrc.find(x => x.path.includes(name))!, { model } = modelOf(r);
      for (const slope of [0, .9]) {
        const bridged = buildMesh(model, { slope, sides: 8 }), loose = buildMesh(model, { slope, sides: 8, bridges: false });
        expect(watertight(bridged), name).toBe(true);
        expect(bridged.parts, `${name} slope ${slope}`).toBe(1);
        expect(loose.parts, `${name} slope ${slope}`).toBeGreaterThan(1);
      }
    }
  });

  it('a long piece keeps its full thickness in the middle: a gun’s receiver isn’t bitten where the grip hangs below it', () => {
    // a side view: a receiver 24 long and 4 tall, with a grip 3 wide and 8 tall below its middle; 4 thick, Diamond and Tube along the length
    const W = 24, H = 12, img = { width: W, height: H, data: new Uint8Array(W * H * 4) };
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (y < 4 || (x >= 10 && x <= 12)) img.data.set([120, 120, 130, 255], (y * W + x) * 4);
    for (const shape of ['diW', 'cyW'] as const) {
      const sh = makeSheet(img, { side: 'R', depth: 4, shape, outlined: false, frame: FRAME })!;
      const read = readSheet(sh.image, sheetFileName('gun', sh.n, 'R', shape)), model = buildVoxelModel(read, 'R', shape, MID);
      const mesh = buildMesh(model, { slope: .9, sides: 8 });
      // through a slice with the grip, the receiver's lower rows (2.5 below its top) fill the carved model's whole
      // thickness there; fitted to the whole 12-tall column, the rounding cut into them
      const y = model.hi[1] + 1 - 2.5, zGrip = model.hi[2] + 1 - 11.5, n = model.n;
      let depth = 0;
      for (let x = 0; x < n; x++) depth += model.hull[(Math.floor(zGrip) * n + Math.floor(y)) * n + x];
      expect(depth, shape).toBeGreaterThan(0);
      expect(lineSpan(mesh, 0, y + .01, zGrip + .01), shape).toBeCloseTo(depth, 5);
    }
  });

  it('shaped ends give a closed mesh the size of the voxel model (the first six PSRC sprites × Tube / Diamond × every ends setting)', () => {
    for (const r of psrc.slice(0, 6)) for (const shape of SHAPE_CODES.filter(hasEnds)) for (const ends of ['cF', 'cL', 'cB'] as const) for (const slope of [0, .9]) {
      const { model } = modelOf(r, shape, ends), mesh = buildMesh(model, { slope, sides: 8 }), what = `${r.path} ${shape} ${ends} slope ${slope}`;
      expect(watertight(mesh), what).toBe(true);
      for (let k = 0; k < 3; k++) {
        expect(mesh.lo[k], what).toBeGreaterThan(model.lo[k] - 1e-4);
        expect(mesh.hi[k], what).toBeLessThan(model.hi[k] + 1 + 1e-4);
      }
    }
  }, 120000);

  it('a bullet drawn end-on gets a dome in the mesh too, as long as the flat one and in one piece', () => {
    const W = 10, img = { width: W, height: W, data: new Uint8Array(W * W * 4) };
    for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) if ((x - 4.5) ** 2 + (y - 4.5) ** 2 <= 25) img.data.set([200, 150, 60, 255], (y * W + x) * 4);
    const bullet = { path: 'bullet', image: '', side: 'F' as SideCode, depth: 12, shape: 'cyT' as ShapeCode, outline: false, img };
    const flatModel = modelOf(bullet).model, flat = buildMesh(flatModel, { slope: .9, sides: 8 });
    for (const ends of ['cF', 'cB'] as const) {
      const { model } = modelOf(bullet, 'cyT', ends), mesh = buildMesh(model, { slope: .9, sides: 8 });
      expect(watertight(mesh), ends).toBe(true);
      expect(mesh.parts, ends).toBe(1);
      expect([mesh.lo[2], mesh.hi[2]], ends).toEqual([flat.lo[2], flat.hi[2]]);
      // the dome takes off at least half of what it takes off the voxel model (a hemisphere as wide as the bullet)
      expect(volume(mesh), ends).toBeLessThan(volume(flat) - (flatModel.count - model.count) / 2);
      // at the shaped front, only the middle reaches the tip (the rim's voxels lose 3 of 12; the loft rounds that off)
      const c = (model.lo[0] + model.hi[0] + 1) / 2;
      expect(lineSpan(mesh, 2, c + .01, c + .01)).toBeCloseTo(12, 3);
      expect(lineSpan(mesh, 2, c + 4.51, c + .01)).toBeLessThan(11);
    }
    // ends chosen in ② for a sheet made without them: the voxel model reports the cut-off paint, and the mesh still
    // gets the dome (its rings shrink towards the end) while staying a plain tube behind it
    const { read } = modelOf(bullet), later = buildVoxelModel(read, 'F', 'cyT', MID, undefined, 'cF');
    expect(later.trimmed.length).toBeGreaterThan(0);
    const mesh = buildMesh(later, { slope: .9, sides: 8 }), c = (later.lo[0] + later.hi[0] + 1) / 2;
    expect(watertight(mesh)).toBe(true);
    expect(volume(mesh)).toBeLessThan(volume(flat) - (flatModel.count - later.count) / 2);
    expect(lineSpan(mesh, 2, c + 4.51, c + .01)).toBeLessThan(11);
    expect(lineSpan(mesh, 2, c + .01, c + 4.51)).toBeLessThan(11);
  });

  it('an empty model gives an empty mesh', () => {
    const { model } = modelOf(psrc[0], 'box');
    const empty = { ...model, count: 0 };
    expect(buildMesh(empty, { slope: .9, sides: 8 }).triangles).toBe(0);
  });
});

describe('texture', () => {
  it('on an unedited Box sheet each face shows its panel: the atlas pixel under a face is the sheet pixel it was projected from (slope 0)', () => {
    for (const r of psrc.slice(0, 20)) {
      const { model, read } = modelOf(r, 'box');
      const t = textureMesh(buildMesh(model, { slope: 0, sides: 8, bridges: false }), model, read, 'opp');
      const { width: W, height: H, data } = t.atlas, n = model.n;
      for (let f = 0; f < t.indices.length; f += 3) {
        const [i0, i1, i2] = [t.indices[f], t.indices[f + 1], t.indices[f + 2]];
        const e1 = [0, 1, 2].map(k => t.positions[i1 * 3 + k] - t.positions[i0 * 3 + k]), e2 = [0, 1, 2].map(k => t.positions[i2 * 3 + k] - t.positions[i0 * 3 + k]);
        if (Math.hypot(e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]) < 1e-9) continue; // a sliver with no area shows nothing
        const u = (t.uvs[i0 * 2] + t.uvs[i1 * 2] + t.uvs[i2 * 2]) / 3, v = (t.uvs[i0 * 2 + 1] + t.uvs[i1 * 2 + 1] + t.uvs[i2 * 2 + 1]) / 3;
        expect(u).toBeGreaterThan(0); expect(u).toBeLessThan(1); expect(v).toBeGreaterThan(0); expect(v).toBeLessThan(1);
        const tx = Math.floor(u * W), ty = Math.floor(v * H), atlas = [...data.subarray((ty * W + tx) * 4, (ty * W + tx) * 4 + 3)];
        // the same point on the panel
        const p = SIDE_CODES[t.panel[i0]], c = [0, 1, 2].map(k => (t.positions[i0 * 3 + k] + t.positions[i1 * 3 + k] + t.positions[i2 * 3 + k]) / 3);
        const vw = VIEW[p], px = Math.floor(vw.px[1] ? n - c[vw.px[0]] : c[vw.px[0]]), py = Math.floor(vw.py[1] ? n - c[vw.py[0]] : c[vw.py[0]]);
        // an outside face of a box model always has paint on the panel it faces
        expect(model.mask[p][py * n + px], `${r.path} ${p}`).toBe(1);
        expect(atlas, `${r.path} ${p}`).toEqual([...read.panels![p].subarray((py * n + px) * 4, (py * n + px) * 4 + 3)]);
      }
    }
  });

  it('the atlas is a power of two and holds every panel the faces use, opaque with its 1px padding', () => {
    const { model, read } = modelOf(psrc.find(r => r.path.includes('wooden barrel'))!);
    const t = textureMesh(buildMesh(model, { slope: .9, sides: 8 }), model, read, 'near');
    const { width: W, height: H, data } = t.atlas;
    for (const s of [W, H]) expect(Math.log2(s) % 1).toBe(0);
    // a panel's second crop, for faces standing in front of others on the same lines, is keyed by the panel and '+'
    expect(new Set(Object.keys(t.rects).map(k => k.replace('+', '')))).toEqual(new Set([...new Set(t.panel)].map(i => SIDE_CODES[i])));
    for (const r of Object.values(t.rects)) {
      expect(r.x).toBeGreaterThanOrEqual(1); expect(r.y).toBeGreaterThanOrEqual(1);
      expect(r.x + r.w).toBeLessThanOrEqual(W - 1); expect(r.y + r.h).toBeLessThanOrEqual(H - 1);
      for (let y = r.y - 1; y <= r.y + r.h; y++) for (let x = r.x - 1; x <= r.x + r.w; x++) expect(data[(y * W + x) * 4 + 3]).toBe(255);
    }
  });

  /** A Phase 2 row of the user's session as it is: its own sheet (some are hand-painted on every side) and settings. */
  function sessionRow(name: string, slope?: number, sides?: number) {
    const r = (session.sheets.rows as { path: string; image: string; side: SideCode; shape: ShapeCode; ends: EndsCode; sx: number; sy: number; sz: number; bstyle: 'hard'; bw: number; fb: 'opp' | 'near'; slope: number; sides: number }[])
      .find(r => r.path.includes(name))!;
    const read = readSheet(decodePng(Buffer.from(session.images[r.image].png.split(',')[1], 'base64')), r.path);
    const model = buildVoxelModel(read, r.side, r.shape, { x: r.sx, y: r.sy, z: r.sz }, { style: r.bstyle, width: r.bw }, r.ends);
    return { r, read, model, t: textureMesh(buildMesh(model, { slope: slope ?? r.slope, sides: sides ?? r.sides }), model, read, r.fb) };
  }
  /** The atlas colour at a point of triangle f (the point in its plane), 0xRRGGBB. */
  const colourAt = (t: TexturedMesh, f: number, p: number[]) => {
    const [a, b, c] = [t.indices[f], t.indices[f + 1], t.indices[f + 2]], P = (i: number) => [0, 1, 2].map(k => t.positions[i * 3 + k]);
    const A = P(a), e1 = P(b).map((x, k) => x - A[k]), e2 = P(c).map((x, k) => x - A[k]), q = p.map((x, k) => x - A[k]);
    const dot = (u: number[], v: number[]) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
    const d11 = dot(e1, e1), d12 = dot(e1, e2), d22 = dot(e2, e2), den = d11 * d22 - d12 * d12;
    const u = (d22 * dot(q, e1) - d12 * dot(q, e2)) / den, v = (d11 * dot(q, e2) - d12 * dot(q, e1)) / den, w = 1 - u - v;
    const tu = w * t.uvs[a * 2] + u * t.uvs[b * 2] + v * t.uvs[c * 2], tv = w * t.uvs[a * 2 + 1] + u * t.uvs[b * 2 + 1] + v * t.uvs[c * 2 + 1];
    const { width: W, height: H, data } = t.atlas, x = Math.min(W - 1, Math.floor(tu * W)), y = Math.min(H - 1, Math.floor(tv * H)), o = (y * W + x) * 4;
    return (data[o] << 16) | (data[o + 1] << 8) | data[o + 2];
  };

  it('neighbouring faces on different panels agree where they meet, even on sheets painted differently on every side (the football and volleyball)', () => {
    // along every edge between faces on two panels: how much of it shows a different colour just inside each face
    // (box-projecting each panel's own paint: 94% and 96%)
    for (const name of ['football', 'volleyball']) {
      const { t } = sessionRow(name), P = t.positions, I = t.indices;
      const key = (i: number) => [0, 1, 2].map(k => P[i * 3 + k].toFixed(4)).join();
      const edges = new Map<string, [number, number, number][]>();
      for (let f = 0; f < I.length; f += 3) for (let c = 0; c < 3; c++) {
        const a = I[f + c], b = I[f + (c + 1) % 3], k = [key(a), key(b)].sort().join('|');
        edges.set(k, [...(edges.get(k) ?? []), [f, a, b]]);
      }
      let total = 0, differ = 0;
      for (const list of edges.values()) {
        if (list.length !== 2 || t.panel[I[list[0][0]]] === t.panel[I[list[1][0]]]) continue;
        const [[f, a, b], [g]] = list, pa = [0, 1, 2].map(k => P[a * 3 + k]), pb = [0, 1, 2].map(k => P[b * 3 + k]);
        const mid = (h: number) => [0, 1, 2].map(k => (P[I[h] * 3 + k] + P[I[h + 1] * 3 + k] + P[I[h + 2] * 3 + k]) / 3);
        const len = Math.hypot(pa[0] - pb[0], pa[1] - pb[1], pa[2] - pb[2]), S = Math.ceil(len * 4);
        for (let s = 0; s < S; s++) {
          const e = pa.map((x, k) => x + (pb[k] - x) * (s + .5) / S);
          // 0.2px into each face, towards its middle
          const into = (m: number[]) => { const d = m.map((x, k) => x - e[k]), l = Math.hypot(d[0], d[1], d[2]); return e.map((x, k) => x + d[k] / l * .2); };
          total += len / S;
          if (colourAt(t, f, into(mid(f))) !== colourAt(t, g, into(mid(g)))) differ += len / S;
        }
      }
      expect(differ / total, name).toBeLessThan(.7);
    }
  });

  it('keeps the input side’s paint off faces that turn away from it: the dark spot on the football’s left side is the Left picture’s colour on the mesh', () => {
    // voxel (1, 11, 9): the Front panel sees it first, so in the voxel model it takes the Front drawing's dark rim
    // pixel, but its surface faces left (user report after session 6)
    const { model, read, t } = sessionRow('football'), n = model.n, i = (9 * n + 11) * n + 1;
    expect(model.solid[i]).toBe(1);
    expect(model.solid[i - 1]).toBe(0); // first on the Left panel's line
    const voxel = colourModel(model, read, 'F', 'opp').colour[i], rgb = (d: ArrayLike<number>, j: number) => (d[j * 4] << 16) | (d[j * 4 + 1] << 8) | d[j * 4 + 2];
    const front = model.pix.F[11 * n + 1], left = model.pix.L[9 * n + 11];
    expect(voxel).toBe(rgb(read.panels!.F, front));
    const r = t.rects.L!, x = r.x + left % n - r.px, y = r.y + Math.floor(left / n) - r.py, W = t.atlas.width;
    expect(model.mask.L[left]).toBe(1);
    expect(rgb(t.atlas.data, y * W + x)).toBe(rgb(read.panels!.L, left));
    expect(rgb(read.panels!.L, left)).not.toBe(voxel);
  });

  it('a texel beside the model takes the nearest colour by distance: the antifreeze bottle’s 1px red cap stays in its own row', () => {
    // 8-connected steps counted the cap pixel diagonally above as near as the neck pixel beside it (user report)
    // pinned to the settings the bug was reported with (the user's session has since moved to 0.8 and 7 sides)
    const { model, read, t } = sessionRow('antifreeze bottle', 1, 6), n = model.n, col = colourModel(model, read, model.side, 'opp');
    // the cap's colours, and the neck's in the three rows under it (the label further down is red too)
    const top = model.hi[1], cap = new Set<number>(), below = new Set<number>();
    for (let i = 0; i < n * n * n; i++) {
      const y = Math.floor(i / n) % n;
      if (model.solid[i] && col.dist[i] === 1 && y >= top - 3) (y === top ? cap : below).add(col.colour[i]);
    }
    const capOnly = [...cap].filter(c => !below.has(c));
    expect(capOnly.length).toBeGreaterThan(0);
    for (let f = 0; f < t.indices.length; f += 3) {
      const v = [0, 1, 2].map(c => [0, 1, 2].map(k => t.positions[t.indices[f + c] * 3 + k]));
      for (const [a, b] of [[1 / 3, 1 / 3], [.7, .15], [.15, .7], [.15, .15]]) {
        const p = [0, 1, 2].map(k => v[0][k] * (1 - a - b) + v[1][k] * a + v[2][k] * b);
        if (p[1] < top - .05 && p[1] > top - 3) expect(capOnly, `a face at height ${p[1].toFixed(2)}`).not.toContain(colourAt(t, f, p));
      }
    }
  });

  it('a face standing in front of another on the same lines gets its own crop: the spotlight\u2019s lens shows no green of the ring behind it', () => {
    // at Straighten slopes 0.4 the lens is a stepped dome one voxel in front of the green ring; its flat back faces are
    // rounded at 45° across corner pixels whose line meets the ring, and showed that green as small triangles (user
    // report after session 6)
    const { model, read, t } = sessionRow('clip mounted', .4), n = model.n, col = colourModel(model, read, model.side, 'opp');
    const lens = new Set<number>(), ring = new Set<number>();
    for (let i = 0; i < n * n * n; i++) {
      const z = Math.floor(i / (n * n));
      if (model.solid[i] && col.dist[i] === 1 && z <= 3) (z <= 2 ? lens : ring).add(col.colour[i]);
    }
    const ringOnly = [...ring].filter(c => !lens.has(c));
    expect(ringOnly.length).toBeGreaterThan(0);
    let checked = 0;
    for (let f = 0; f < t.indices.length; f += 3) {
      const v = [0, 1, 2].map(c => [0, 1, 2].map(k => t.positions[t.indices[f + c] * 3 + k]));
      if (SIDE_CODES[t.panel[t.indices[f]]] !== 'Bk' || v.some(p => p[2] > 2.01)) continue;
      for (const [a, b] of [[1 / 3, 1 / 3], [.8, .1], [.1, .8], [.1, .1]]) {
        const p = [0, 1, 2].map(k => v[0][k] * (1 - a - b) + v[1][k] * a + v[2][k] * b);
        checked++;
        expect(ringOnly, `a lens face at ${p.map(x => x.toFixed(2)).join(', ')}`).not.toContain(colourAt(t, f, p));
      }
    }
    expect(checked).toBeGreaterThan(0);
    expect(Object.keys(t.rects)).toContain('Bk+');
  });

  it('a flat face takes one panel, even at a 45° tie (the triangles of one face used to pick different ones)', () => {
    for (const r of psrc.slice(0, 12)) {
      const { model } = modelOf(r), m = buildMesh(model, { slope: .9, sides: 8 }), byPlane = new Map<string, number>();
      for (let f = 0; f < m.indices.length; f += 3) {
        const a = m.indices[f], nrm = [0, 1, 2].map(k => m.normals[a * 3 + k]);
        const key = nrm.map(v => v.toFixed(3)).join() + '|' + (nrm[0] * m.positions[a * 3] + nrm[1] * m.positions[a * 3 + 1] + nrm[2] * m.positions[a * 3 + 2]).toFixed(2);
        if (!byPlane.has(key)) byPlane.set(key, m.panel[a]);
        expect(m.panel[a], `${r.path}: a face ${key}`).toBe(byPlane.get(key));
      }
    }
  });
});

describe('GLB', () => {
  const barrel = () => {
    const { model, read } = modelOf(psrc.find(r => r.path.includes('wooden barrel'))!);
    return textureMesh(buildMesh(model, { slope: .9, sides: 8 }), model, read, 'opp');
  };

  it('writes a valid binary glTF with nearest filtering, scale and pivot', () => {
    const t = barrel();
    const { json, bin } = readGlb(writeGlb(t, { name: 'barrel', scale: 32, pivot: 'bottom', material: 'plastic' })!);
    expect(json.asset.version).toBe('2.0');
    expect(json.samplers[0]).toMatchObject({ magFilter: 9728, minFilter: 9728 });
    expect(json.materials[0].pbrMetallicRoughness).toMatchObject({ metallicFactor: MATERIAL_PBR.plastic[0], roughnessFactor: MATERIAL_PBR.plastic[1] });
    expect(json.materials[0].extensions).toBeUndefined();
    const pos = json.accessors[json.meshes[0].primitives[0].attributes.POSITION];
    expect(pos.count).toBe(t.positions.length / 3);
    // bottom-centre pivot: the base sits at y = 0 and the model is centred on x and z; 32 px = 1 m
    expect(pos.min[1]).toBeCloseTo(0, 6);
    expect(pos.max[1]).toBeCloseTo((t.hi[1] - t.lo[1]) / 32, 5);
    expect(pos.min[0]).toBeCloseTo(-pos.max[0], 5);
    expect(json.accessors[json.meshes[0].primitives[0].indices].count).toBe(t.triangles * 3);
    // the texture is the atlas as a PNG
    const view = json.bufferViews[json.images[0].bufferView];
    const png = decodePng(bin.subarray(view.byteOffset, view.byteOffset + view.byteLength));
    expect([png.width, png.height]).toEqual([t.atlas.width, t.atlas.height]);
    expect(json.buffers[0].byteLength).toBe(bin.length);
  });

  it('centre pivot, raw material values, unlit and the normal map', () => {
    const t = barrel();
    const centred = readGlb(writeGlb(t, { name: 'b', scale: 16, pivot: 'centre', material: 'dull', metallic: .3, roughness: .6, normalMap: normalMapOf(t.atlas, SOFT) })!).json;
    const pos = centred.accessors[0];
    for (let k = 0; k < 3; k++) expect(pos.min[k]).toBeCloseTo(-pos.max[k], 5);
    expect(pos.max[1] - pos.min[1]).toBeCloseTo((t.hi[1] - t.lo[1]) / 16, 5);
    expect(centred.materials[0].pbrMetallicRoughness).toMatchObject({ metallicFactor: .3, roughnessFactor: .6 });
    expect(centred.materials[0].normalTexture).toEqual({ index: 1 });
    expect(centred.images).toHaveLength(2);
    const unlit = readGlb(writeGlb(t, { name: 'b', scale: 32, pivot: 'bottom', material: 'unlit', normalMap: normalMapOf(t.atlas, SOFT), occlusionMap: occlusionMapOf(t.atlas, 'soft', 5), trimMap: trimMapOf(t.atlas, 'glossy', 0, 1) })!).json;
    expect(unlit.extensionsUsed).toEqual(['KHR_materials_unlit']);
    expect(unlit.materials[0].extensions).toEqual({ KHR_materials_unlit: {} });
    expect(unlit.images).toHaveLength(1); // unlit ignores light, so no normal map, shadow or trim texture
    expect(unlit.materials[0].occlusionTexture).toBeUndefined();
  });

  it('crevice shadows and shiny trims as glTF textures; the trim texture holds the row values, so the factors are 1', () => {
    const t = barrel();
    const { json } = readGlb(writeGlb(t, { name: 'b', scale: 32, pivot: 'bottom', material: 'plastic', normalMap: normalMapOf(t.atlas, SOFT), occlusionMap: occlusionMapOf(t.atlas, 'soft', 5), trimMap: trimMapOf(t.atlas, 'glossy', 0, .4) })!);
    const mat = json.materials[0];
    expect(json.images).toHaveLength(4);
    expect(mat.normalTexture).toEqual({ index: 1 });
    expect(mat.occlusionTexture).toEqual({ index: 2 });
    expect(mat.pbrMetallicRoughness).toMatchObject({ metallicFactor: 1, roughnessFactor: 1, metallicRoughnessTexture: { index: 3 } });
    // only crevice shadows: the next free texture, and the row's factors stay
    const ao = readGlb(writeGlb(t, { name: 'b', scale: 32, pivot: 'bottom', material: 'plastic', occlusionMap: occlusionMapOf(t.atlas, 'soft', 5) })!).json.materials[0];
    expect(ao.occlusionTexture).toEqual({ index: 1 });
    expect(ao.pbrMetallicRoughness).toMatchObject({ metallicFactor: 0, roughnessFactor: .4 });
  });

  it('Soft raises each colour patch with bevelled edges, flat where nothing changes, steeper when stronger', () => {
    const img = patch(), nm = normalMapOf(img, SOFT);
    // the patch's middle and the far background are flat
    expect(px(nm, 8, 8)).toEqual([128, 128, 255]);
    expect(px(nm, 0, 8)).toEqual([128, 128, 255]);
    // on the patch's left bevel the height rises to the right, so the surface faces left (red below the middle)
    expect(px(nm, 5, 8)[0]).toBeLessThan(100);
    // on its top bevel (picture rows run down) the height rises downwards, so the surface faces up (green above)
    expect(px(nm, 8, 5)[1]).toBeGreaterThan(156);
    // a stronger setting tilts further
    expect(px(normalMapOf(img, { ...SOFT, bump: 10 }), 5, 8)[0]).toBeLessThan(px(nm, 5, 8)[0]);
  });

  it('every style is flat on a uniform picture, and its map is the atlas size times its scale', () => {
    const flat = { width: 4, height: 4, data: new Uint8Array(64).fill(200) };
    for (const style of BUMP_STYLES) {
      const nm = normalMapOf(flat, { style, bump: 6, grit: 0 }), sc = normalScale(style);
      expect([nm.width, nm.height]).toEqual([4 * sc, 4 * sc]);
      if (style === 'stud') continue; // every pixel is a tile of its own
      for (let i = 0; i < nm.width * nm.height; i++) expect([...nm.data.subarray(i * 4, i * 4 + 3)]).toEqual([128, 128, 255]);
    }
  });

  it('Chiselled: a sharp 1px chamfer of one fixed tilt round every patch, flat inside', () => {
    const nm = normalMapOf(patch(), { style: 'chisel', bump: 6, grit: 0 });
    expect(px(nm, 5, 8)).toEqual([128, 128, 255]); // one pixel in: flat already
    const left = px(nm, 4, 8), right = px(nm, 11, 8), top = px(nm, 8, 4), outside = px(nm, 3, 8);
    expect(left[0]).toBeLessThan(100); // the left edge pixel faces left, into the groove
    expect(right[0]).toBe(255 - left[0]); // the same fixed tilt everywhere
    expect(top[1]).toBe(255 - left[0]);
    expect(outside[0]).toBe(255 - left[0]); // the dark side faces the patch: the two meet in a V
  });

  it('Terraced: brighter patches are plateaus with a lip on their upper edge; the lower side stays flat', () => {
    const nm = normalMapOf(patch(), { style: 'terrace', bump: 6, grit: 0 });
    expect(px(nm, 4, 8)[0]).toBeLessThan(100);
    expect(px(nm, 8, 11)[1]).toBeLessThan(100); // the bottom lip faces down
    expect(px(nm, 3, 8)).toEqual([128, 128, 255]);
    expect(px(nm, 5, 8)).toEqual([128, 128, 255]);
  });

  it('Engraved: a dark line is a V-groove inside its own pixel; everything else stays flat', () => {
    // a dark vertical line at x = 4 in a bright 9 × 9 picture; the map is 2× the picture
    const W = 9, data = new Uint8Array(W * W * 4);
    for (let i = 0; i < W * W; i++) data.set(i % W === 4 ? [30, 25, 20, 255] : [200, 180, 150, 255], i * 4);
    const nm = normalMapOf({ width: W, height: W, data }, { style: 'engrave', bump: 6, grit: 0 });
    const at = (x: number, y: number) => Array.from(nm.data.subarray((y * nm.width + x) * 4, (y * nm.width + x) * 4 + 3));
    expect(at(8, 8)[0]).toBeGreaterThan(156); // the line's left half is a wall facing right
    expect(at(9, 8)[0]).toBeLessThan(100); // its right half faces left
    expect(at(8, 8)[1]).toBe(128);
    expect(at(6, 8)).toEqual([128, 128, 255]);
    expect(at(11, 8)).toEqual([128, 128, 255]);
  });

  it('Studded: every pixel a 4 × 4 tile with a bevelled ring and a flat middle', () => {
    const nm = normalMapOf(patch(), { style: 'stud', bump: 6, grit: 0 }), W = nm.width;
    const at = (x: number, y: number) => Array.from(nm.data.subarray((y * W + x) * 4, (y * W + x) * 4 + 3));
    for (const [x0, y0] of [[0, 0], [20, 32], [36, 36]]) {
      expect(at(x0 + 1, y0 + 1)).toEqual([128, 128, 255]);
      expect(at(x0, y0 + 1)[0]).toBeLessThan(100);
      expect(at(x0 + 3, y0 + 1)[0]).toBeGreaterThan(156);
      expect(at(x0 + 1, y0)[1]).toBeGreaterThan(156);
      expect(at(x0 + 1, y0 + 3)[1]).toBeLessThan(100);
    }
  });

  it('Drawn light: a pixel lighter than its surroundings faces the upper-left light, a darker one faces away', () => {
    const W = 7, data = new Uint8Array(W * W * 4).fill(255);
    for (let i = 0; i < W * W; i++) data.set([120, 120, 120], i * 4);
    data.set([200, 200, 200], (3 * W + 2) * 4);
    data.set([40, 40, 40], (3 * W + 4) * 4);
    const nm = normalMapOf({ width: W, height: W, data }, { style: 'lit', bump: 6, grit: 0 });
    const at = (x: number, y: number) => Array.from(nm.data.subarray((y * W + x) * 4, (y * W + x) * 4 + 3));
    expect(at(2, 3)[0]).toBeLessThan(100); expect(at(2, 3)[1]).toBeGreaterThan(156);
    expect(at(4, 3)[0]).toBeGreaterThan(156); expect(at(4, 3)[1]).toBeLessThan(100);
  });

  it('Grit tilts every pixel a little, the same way every time, more where colours are busy', () => {
    const flat = { width: 8, height: 8, data: new Uint8Array(256).fill(200) };
    const a = normalMapOf(flat, { style: 'soft', bump: 6, grit: 5 }), b = normalMapOf(flat, { style: 'soft', bump: 6, grit: 5 });
    expect(a.data).toEqual(b.data);
    let tilted = 0;
    for (let i = 0; i < 64; i++) if (a.data[i * 4] !== 128 || a.data[i * 4 + 1] !== 128) tilted++;
    expect(tilted).toBeGreaterThan(48);
    const tilt = (m: RGBAImage) => { let t = 0; for (let i = 0; i < m.width * m.height; i++) t += Math.abs(m.data[i * 4] - 128) + Math.abs(m.data[i * 4 + 1] - 128); return t; };
    const noisy = { width: 8, height: 8, data: new Uint8Array(256) };
    for (let i = 0; i < 64; i++) noisy.data.set((i * 7) % 3 ? [200, 200, 200, 255] : [170, 170, 170, 255], i * 4);
    expect(tilt(normalMapOf(noisy, { style: 'soft', bump: 6, grit: 5 }))).toBeGreaterThan(tilt(a));
  });

  it('a panel never picks up detail from its neighbour in the atlas, and its border copies its edge', () => {
    // two 4 × 6 crops side by side, their 1px borders touching: a plain grey panel and a panel with a dark edge line
    const W = 12, H = 8, data = new Uint8Array(W * H * 4);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) data.set(x >= 6 && x <= 7 ? [20, 20, 20, 255] : [180, 180, 180, 255], (y * W + x) * 4);
    const img = { width: W, height: H, data }, rects = [{ x: 1, y: 1, w: 4, h: 6 }, { x: 7, y: 1, w: 4, h: 6 }];
    for (const style of BUMP_STYLES) {
      if (style === 'stud') continue;
      const nm = normalMapOf(img, { style, bump: 6, grit: 0 }, rects), sc = normalScale(style);
      for (let y = 0; y < H * sc; y++) for (let x = 0; x < 6 * sc; x++) expect([style, ...nm.data.subarray((y * W * sc + x) * 4, (y * W * sc + x) * 4 + 3)]).toEqual([style, 128, 128, 255]);
    }
    const ao = occlusionOf(img, 'soft', 10, rects);
    for (let y = 0; y < H; y++) for (let x = 0; x < 6; x++) expect(ao[y * W + x]).toBe(1);
    // the second panel's left border (x = 6) takes the values of its edge pixel (x = 7)
    const nm = normalMapOf(img, { style: 'chisel', bump: 6, grit: 0 }, rects);
    expect(px(nm, 6, 4)).toEqual(px(nm, 7, 4));
  });

  it('crevice shadows darken grooves and dark lines, deeper with a higher setting; painted into the colours on request', () => {
    const img = patch();
    for (const style of BUMP_STYLES) {
      const ao = occlusionOf(img, style, 6);
      expect(ao[8 * 16 + 8]).toBe(1); // the middle of the raised patch
      expect(Math.min(...ao)).toBeLessThan(.9);
    }
    const mild = occlusionOf(img, 'soft', 2), deep = occlusionOf(img, 'soft', 10);
    expect(deep[8 * 16 + 3]).toBeLessThan(mild[8 * 16 + 3]);
    const flat = occlusionOf({ width: 4, height: 4, data: new Uint8Array(64).fill(200) }, 'soft', 10);
    expect([...flat]).toEqual(new Array(16).fill(1));
    const shaded = shadedAtlas(img, 'soft', 10), map = occlusionMapOf(img, 'soft', 10);
    expect(shaded.data[(8 * 16 + 3) * 4]).toBe(Math.round(img.data[(8 * 16 + 3) * 4] * deep[8 * 16 + 3]));
    expect(map.data[(8 * 16 + 3) * 4]).toBe(Math.round(deep[8 * 16 + 3] * 255));
  });

  it('shiny trims: light trim pixels get glossy (or metallic), the body keeps the row values', () => {
    // a dark body with a light 1px stripe
    const W = 9, data = new Uint8Array(W * W * 4);
    for (let i = 0; i < W * W; i++) data.set(((i / W) | 0) === 4 ? [230, 210, 120, 255] : [70, 60, 50, 255], i * 4);
    const img = { width: W, height: W, data };
    const at = (m: RGBAImage, x: number, y: number) => [m.data[(y * W + x) * 4 + 1] / 255, m.data[(y * W + x) * 4 + 2] / 255];
    const glossy = trimMapOf(img, 'glossy', .2, .8);
    expect(at(glossy, 4, 0)[0]).toBeCloseTo(.8, 2); expect(at(glossy, 4, 0)[1]).toBeCloseTo(.2, 2);
    expect(at(glossy, 4, 4)[0]).toBeCloseTo(.25, 2); expect(at(glossy, 4, 4)[1]).toBeCloseTo(.2, 2);
    const metal = trimMapOf(img, 'metal', .2, .8);
    expect(at(metal, 4, 4)[1]).toBe(1);
    expect(at(metal, 4, 0)[1]).toBeCloseTo(.2, 2);
  });
});

describe('stepped blending (DESIGN.md §5)', () => {
  it('the fish morphs from its wide head to its thin tail over the blend width, in voxels and in the mesh', () => {
    const fish = readSheet(fishSheet(), 'fish__32_F_box.png');
    const hard = buildVoxelModel(fish, 'F', 'box', MID), steps = buildVoxelModel(fish, 'F', 'box', MID, { style: 'stepped', width: 6 });
    const n = 32, ox = steps.outlines[0];
    // the x axis: Left (head) outline below the split, Right (tail) outline from it on, six in-between layers
    expect(ox.masks.length).toBe(8);
    const widthZ = (mask: Uint8Array) => { let lo = n, hi = -1; for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) if (mask[z * n + y]) { lo = Math.min(lo, z); hi = Math.max(hi, z); } return hi - lo + 1; };
    const widths = [...ox.layer].map(i => widthZ(ox.masks[i]));
    const zone = widths.slice(steps.split[0] - 3, steps.split[0] + 3);
    expect(zone[0]).toBeLessThanOrEqual(8); expect(zone[5]).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < zone.length; i++) expect(zone[i]).toBeLessThanOrEqual(zone[i - 1]);
    expect(zone[0]).toBeGreaterThan(zone[5]);
    expect(steps.count).not.toBe(hard.count);
    // Smooth isn't built yet and carves like Steps
    expect(buildVoxelModel(fish, 'F', 'box', MID, { style: 'smooth', width: 6 }).count).toBe(steps.count);
    // the mesh follows the voxels exactly at slope 0
    const mesh = buildMesh(steps, { slope: 0, sides: 8, bridges: false });
    expect(watertight(mesh)).toBe(true);
    expect(volume(mesh)).toBeCloseTo(steps.count, 3);
  });

  it('an unedited sheet ignores the blend, like the split', () => {
    const r = psrc[5], { read, model } = modelOf(r);
    expect(buildVoxelModel(read, r.side, r.shape, MID, { style: 'stepped', width: 8 }).count).toBe(model.count);
    void spriteAxes;
  });
});
