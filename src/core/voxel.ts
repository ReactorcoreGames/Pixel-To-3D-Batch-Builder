/* Phase 2, step 2: a painted sheet becomes a voxel model (DESIGN.md §5 and §8).

   1. Carving (split planes). Each world axis has two panels looking along it: Left / Right on x, Bottom / Top on y,
      Back / Front on z. The axis is split at a position measured on the object's painted bounds; on each side of the
      split, the panel on that side decides the outline. With a blend, the layers in a zone around the split use
      in-between outlines instead (stepped blending: one terrace per layer, morphed through the two outlines' distance
      fields). A voxel is solid when all three axes allow it. When opposite panels are mirror images (every unedited
      sheet), neither the split nor the blend matters and this is exactly the plain visual hull.
   2. The cross-section shape is applied again (shape.ts), fitted to each connected piece of the carved model, then a
      Tube's or Diamond's shaped ends, with Phase 1's "the sprite's outline is kept" rule (for the ⊙ shapes, the
      outline their own cut left).
   3. Trimmed paint: painted pixels whose line through the cube has no voxel left. They are counted and marked.
   4. Colours: every surface voxel takes the colour of a panel that sees it (the sprite's own side first, then the
      side it faces most); where that panel is see-through, the row's gap colour rule fills in. Interior voxels get
      their distance to the surface and, for "Nearest surface", the colour of the nearest surface voxel. The other
      inside styles are formulas of position and distance (`insideShader`).

   Grids are n × n × n, index (z · n + y) · n + x, with world x to the right, y up and z towards the front. */

import { applyEnds, applyShape, cutsSpritePlane, shapeCuts } from './shape';
import { panelPixel, spriteAxes, spriteFlips, VIEW } from './sheet';
import type { SheetRead } from './reader';
import { SIDE_CODES, SOLID_ALPHA, type BlendCode, type EndsCode, type FallbackCode, type InsideCode, type ShapeCode, type SideCode } from './types';
import { sin } from './fmath';

/** Split positions, 0–1 (DESIGN.md §5). x is the Left panel's share, measured from the left; y is the Top panel's
    share, measured from the top (how deep holes painted on Top go); z is the Front panel's share, from the front. */
export interface Splits { x: number; y: number; z: number }

/** How the outline changes at a split (DESIGN.md §5). Width is in voxels; 0 or Hard = a sudden step. Smooth isn't
    built yet (a stretch goal) and is carved like Steps. */
export interface Blend { style: BlendCode; width: number }
export const HARD: Blend = { style: 'hard', width: 0 };

/** The panel looking along each world axis from its high end, and from its low end. */
const HIGH: SideCode[] = ['R', 'T', 'F'];
const LOW: SideCode[] = ['L', 'Bt', 'Bk'];
/** The panel a face pointing along +axis / −axis faces. */
const FACING: SideCode[][] = [['R', 'L'], ['T', 'Bt'], ['F', 'Bk']];
export const OPPOSITE: Record<SideCode, SideCode> = { F: 'Bk', Bk: 'F', L: 'R', R: 'L', T: 'Bt', Bt: 'T' };

/** The two other axes of a plane across axis k, in ascending order. */
const planeAxes = (k: number): [number, number] => (k === 0 ? [1, 2] : k === 1 ? [0, 2] : [0, 1]);
/** Index into an n × n plane across axis k for voxel (x, y, z). */
const planeIndex = (k: number, x: number, y: number, z: number, n: number) => (k === 0 ? z * n + y : k === 1 ? z * n + x : y * n + x);

export interface TrimmedPixel {
  panel: SideCode;
  /** Pixel inside the panel's N × N cell. */
  x: number; y: number;
  /** Where the paint would have been on the model: the voxel on the viewer's side of the model's box, on that line. */
  at: [number, number, number];
}

/** The outlines along one world axis: plane masks (index cb · n + ca over the two other axes in ascending order) and,
    per layer along the axis, which of them applies. masks[0] is the low panel's (Left, Bottom, Back), masks[1] the
    high panel's (Right, Top, Front), and any further ones are the blend's in-between outlines. */
export interface AxisOutlines { masks: Uint8Array[]; layer: Int32Array }

export interface VoxelModel {
  n: number;
  side: SideCode;
  shape: ShapeCode;
  /** Ends for Tube and Diamond (flat for the other shapes). */
  ends: EndsCode;
  /** 1 = solid. */
  solid: Uint8Array;
  /** The carved model before the shape was applied (the hull the mesh's slice prisms are fitted to). */
  hull: Uint8Array;
  /** The outline of each world axis, layer by layer (x, y, z). */
  outlines: [AxisOutlines, AxisOutlines, AxisOutlines];
  count: number;
  /** The painted bounds on each world axis [lo, hi], or null when nothing is painted along it. */
  painted: ([number, number] | null)[];
  /** Per axis, the first cube coordinate of the high part (Right, Top, Front). */
  split: [number, number, number];
  /** Bounding box of the finished model (lo > hi when it's empty). */
  lo: [number, number, number];
  hi: [number, number, number];
  trimmed: TrimmedPixel[];
  /** For each panel, plane index → pixel index inside the panel (see `planeIndex`). */
  pix: Record<SideCode, Int32Array>;
  /** For each panel, 1 where a pixel is solid (alpha ≥ 50%), by pixel index. */
  mask: Record<SideCode, Uint8Array>;
}

/** Split coordinate on one axis: the first cube coordinate governed by the high panel. */
export function splitCoordinate(axis: 0 | 1 | 2, bounds: [number, number] | null, share: number, n: number): number {
  if (!bounds) return Math.floor(n / 2);
  const [lo, hi] = bounds, len = hi - lo + 1, s = Math.max(0, Math.min(1, share));
  // x: the Left panel's share from the low end; y and z: the Top / Front panel's share from the high end
  return axis === 0 ? lo + Math.round(s * len) : hi + 1 - Math.round(s * len);
}

/** Each panel's solid pixels (alpha ≥ 50%), by pixel index. */
export function panelMasks(read: SheetRead): Record<SideCode, Uint8Array> {
  const n = read.n!, out = {} as Record<SideCode, Uint8Array>;
  for (const p of SIDE_CODES) {
    const d = read.panels![p], m = new Uint8Array(n * n);
    for (let i = 0; i < n * n; i++) m[i] = d[i * 4 + 3] >= SOLID_ALPHA ? 1 : 0;
    out[p] = m;
  }
  return out;
}

/** What each panel would show of a model: 1 where a panel pixel's line through the cube has a voxel. */
export function projectModel(solid: Uint8Array, n: number): Record<SideCode, Uint8Array> {
  const nn = n * n, cover = [new Uint8Array(nn), new Uint8Array(nn), new Uint8Array(nn)];
  for (let z = 0, i = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++, i++) {
    if (solid[i]) { cover[0][z * n + y] = 1; cover[1][z * n + x] = 1; cover[2][y * n + x] = 1; }
  }
  const out = {} as Record<SideCode, Uint8Array>;
  for (const p of SIDE_CODES) {
    const k = VIEW[p].look[0], [a, b] = planeAxes(k), m = new Uint8Array(nn), c = [0, 0, 0];
    for (let cb = 0; cb < n; cb++) for (let ca = 0; ca < n; ca++) {
      c[a] = ca; c[b] = cb;
      const [px, py] = panelPixel(p, c, n);
      m[py * n + px] = cover[k][cb * n + ca];
    }
    out[p] = m;
  }
  return out;
}

/** Carves the voxel model from a readable sheet. `side`, `shape` and `ends` are the row's (possibly overridden) settings. */
export function buildVoxelModel(read: SheetRead, side: SideCode, shape: ShapeCode, splits: Splits, blend: Blend = HARD, ends: EndsCode = 'flat'): VoxelModel {
  return carveModel(panelMasks(read), read.n!, side, shape, splits, blend, ends);
}

// ------------------------------------------------------------------ blending (distance-field morph)

/** Squared distance to the nearest feature along one line (Felzenszwalb & Huttenlocher). */
function edt1(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array) {
  let first = 0;
  while (first < n && f[first] === Infinity) first++;
  if (first === n) { d.fill(Infinity, 0, n); return; } // no feature on this line
  let k = 0;
  v[0] = first; z[0] = -Infinity; z[1] = Infinity;
  for (let q = first + 1; q < n; q++) {
    if (f[q] === Infinity) continue;
    let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
    k++; v[k] = q; z[k] = s; z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; d[q] = (q - v[k]) * (q - v[k]) + f[v[k]]; }
}

/** Distance from every pixel centre of an n × n grid to the nearest pixel where `feature` is true. */
function distanceTo(feature: (i: number) => boolean, n: number): Float64Array {
  const g = new Float64Array(n * n), f = new Float64Array(n), d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
  for (let i = 0; i < n * n; i++) g[i] = feature(i) ? 0 : Infinity;
  for (let x = 0; x < n; x++) { for (let y = 0; y < n; y++) f[y] = g[y * n + x]; edt1(f, n, d, v, z); for (let y = 0; y < n; y++) g[y * n + x] = d[y]; }
  for (let y = 0; y < n; y++) { for (let x = 0; x < n; x++) f[x] = g[y * n + x]; edt1(f, n, d, v, z); for (let x = 0; x < n; x++) g[y * n + x] = Math.sqrt(d[x]); }
  return g;
}

/** Signed distance to a mask's outline, in pixels: negative inside, positive outside, ±0.5 next to the edge. */
export function signedDistance(m: Uint8Array, n: number): Float64Array {
  const far = 4 * n, toSolid = distanceTo(i => m[i] === 1, n), toEmpty = distanceTo(i => m[i] !== 1, n), out = new Float64Array(n * n);
  for (let i = 0; i < n * n; i++) out[i] = m[i] ? -(Math.min(far, toEmpty[i]) - .5) : Math.min(far, toSolid[i]) - .5;
  return out;
}

/** The outlines along one axis: the low panel's below the split, the high panel's from it on, and with a blend,
    one in-between outline per layer in a zone `width` layers wide centred on the split. Each in-between outline is
    where the mix of the two signed distance fields is ≤ 0, weighted by how far through the zone the layer is.
    When the two panels agree (every unedited sheet), every layer uses the one outline. */
export function axisOutlines(low: Uint8Array, high: Uint8Array, split: number, blend: Blend, n: number): AxisOutlines {
  const layer = new Int32Array(n), masks = [low, high];
  let same = true;
  for (let i = 0; i < low.length && same; i++) same = low[i] === high[i];
  if (same) return { masks, layer };
  if (blend.style === 'hard' || blend.width <= 0) {
    for (let c = 0; c < n; c++) layer[c] = c >= split ? 1 : 0;
    return { masks, layer };
  }
  const w = blend.width, z0 = split - w / 2, sa = signedDistance(low, n), sb = signedDistance(high, n);
  for (let c = 0; c < n; c++) {
    const t = (c + .5 - z0) / w;
    if (t <= 0) { layer[c] = 0; continue; }
    if (t >= 1) { layer[c] = 1; continue; }
    const m = new Uint8Array(n * n);
    for (let i = 0; i < n * n; i++) m[i] = (1 - t) * sa[i] + t * sb[i] <= 0 ? 1 : 0;
    layer[c] = masks.length;
    masks.push(m);
  }
  return { masks, layer };
}

/** The carving itself, from the panels' solid pixels only (Phase 1 uses it to check its own sheets). */
export function carveModel(mask: Record<SideCode, Uint8Array>, n: number, side: SideCode, shape: ShapeCode, splits: Splits, blend: Blend = HARD, ends: EndsCode = 'flat'): VoxelModel {
  const nn = n * n;
  const pix = {} as Record<SideCode, Int32Array>;
  const plane = {} as Record<SideCode, Uint8Array>;
  const painted: ([number, number] | null)[] = [null, null, null];
  const grow = (k: number, c: number) => { const b = painted[k]; painted[k] = b ? [Math.min(b[0], c), Math.max(b[1], c)] : [c, c]; };
  for (const p of SIDE_CODES) {
    const k = VIEW[p].look[0], [a, b] = planeAxes(k);
    const m = mask[p], pi = new Int32Array(nn), pl = new Uint8Array(nn), c = [0, 0, 0];
    for (let cb = 0; cb < n; cb++) for (let ca = 0; ca < n; ca++) {
      c[a] = ca; c[b] = cb;
      const [px, py] = panelPixel(p, c, n), j = cb * n + ca;
      pi[j] = py * n + px; pl[j] = m[py * n + px];
      if (pl[j]) { grow(a, ca); grow(b, cb); }
    }
    pix[p] = pi; plane[p] = pl;
  }
  const split = [0, 1, 2].map(k => splitCoordinate(k as 0 | 1 | 2, painted[k], k === 0 ? splits.x : k === 1 ? splits.y : splits.z, n)) as [number, number, number];

  // 1. carve: every axis must allow the voxel, each layer through its own outline
  const outlines = [0, 1, 2].map(k => axisOutlines(plane[LOW[k]], plane[HIGH[k]], split[k], blend, n)) as VoxelModel['outlines'];
  const hull = new Uint8Array(nn * n);
  const [ox, oy, oz] = outlines;
  for (let z = 0; z < n; z++) {
    const pz = oz.masks[oz.layer[z]];
    for (let y = 0; y < n; y++) {
      const py = oy.masks[oy.layer[y]];
      for (let x = 0; x < n; x++) {
        if (ox.masks[ox.layer[x]][z * n + y] && py[z * n + x] && pz[y * n + x]) hull[(z * n + y) * n + x] = 1;
      }
    }
  }

  // 2. the cross-section shape, fitted to each piece of the carved model, then the shaped ends (after the shape, so
  // their radius is the shaped tube's, as in Phase 1)
  let solid: Uint8Array = hull;
  if (shapeCuts(shape).length) {
    const axes = spriteAxes(side);
    // a ⊙ shape is an extrusion of the outline its cut left, which the sprite's own panel already shows, so the
    // carved model is that shape already (and an outline repainted on the sheet is kept as painted)
    solid = cutsSpritePlane(shape) ? hull : applyShape({ nx: n, ny: n, nz: n, data: hull }, shape, axes).data;
    if (solid === hull) solid = hull.slice();
    const shaped = solid;
    solid = applyEnds({ nx: n, ny: n, nz: n, data: shaped }, shape, ends, axes, spriteFlips(side)).data;
    // the sprite's outline: the carved model's, or for a ⊙ shape the outline its own cut left
    if (!cutsSpritePlane(shape)) keepOutline(hull, solid, n, axes.T);
    else if (solid !== shaped) keepOutline(shaped, solid, n, axes.T);
  }

  // 3. ghosts: loose pieces that no side shows
  if (solid === hull) solid = hull.slice();
  dropGhosts(solid, n);

  // 4. bounds, and painted pixels whose line has no voxel left
  const lo: [number, number, number] = [n, n, n], hi: [number, number, number] = [-1, -1, -1];
  const cover = [new Uint8Array(nn), new Uint8Array(nn), new Uint8Array(nn)];
  let count = 0;
  for (let z = 0, i = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++, i++) {
    if (!solid[i]) continue;
    count++;
    if (x < lo[0]) lo[0] = x; if (x > hi[0]) hi[0] = x;
    if (y < lo[1]) lo[1] = y; if (y > hi[1]) hi[1] = y;
    if (z < lo[2]) lo[2] = z; if (z > hi[2]) hi[2] = z;
    cover[0][z * n + y] = 1; cover[1][z * n + x] = 1; cover[2][y * n + x] = 1;
  }
  const trimmed: TrimmedPixel[] = [];
  for (const p of SIDE_CODES) {
    const [k, fromHigh] = VIEW[p].look, [a, b] = planeAxes(k), pl = plane[p], cv = cover[k];
    for (let j = 0; j < nn; j++) {
      if (!pl[j] || cv[j]) continue;
      const at: [number, number, number] = [0, 0, 0];
      at[a] = j % n; at[b] = Math.floor(j / n);
      at[k] = count ? (fromHigh ? hi[k] : lo[k]) : Math.floor(n / 2);
      trimmed.push({ panel: p, x: pix[p][j] % n, y: Math.floor(pix[p][j] / n), at });
    }
  }
  return { n, side, shape, ends, solid, hull, outlines, count, painted, split, lo, hi, trimmed, pix, mask };
}

/** Labels the loose pieces of an n³ grid: voxels sharing a face, or with `corners` also an edge or a corner, like
    pixel-art diagonals. Returns each voxel's piece number (1, 2 …; 0 = empty) and each piece's voxels, piece 1 at
    index 0. */
export function labelPieces(solid: Uint8Array, n: number, corners = false): { label: Int32Array; pieces: number[][] } {
  const nn = n * n, label = new Int32Array(solid.length), stack = new Int32Array(solid.length);
  const pieces: number[][] = [];
  for (let i = 0; i < solid.length; i++) {
    if (!solid[i] || label[i]) continue;
    const cells: number[] = [], id = pieces.length + 1;
    let top = 0; stack[top++] = i; label[i] = id;
    while (top) {
      const k = stack[--top], x = k % n, y = ((k - x) / n) % n, z = (k - x - y * n) / nn;
      cells.push(k);
      if (!corners) {
        const near = [x > 0 ? k - 1 : -1, x < n - 1 ? k + 1 : -1, y > 0 ? k - n : -1, y < n - 1 ? k + n : -1, z > 0 ? k - nn : -1, z < n - 1 ? k + nn : -1];
        for (const kk of near) if (kk >= 0 && solid[kk] && !label[kk]) { label[kk] = id; stack[top++] = kk; }
        continue;
      }
      for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const X = x + dx, Y = y + dy, Z = z + dz;
        if (X < 0 || Y < 0 || Z < 0 || X >= n || Y >= n || Z >= n) continue;
        const kk = (Z * n + Y) * n + X;
        if (solid[kk] && !label[kk]) { label[kk] = id; stack[top++] = kk; }
      }
    }
    pieces.push(cells);
  }
  return { label, pieces };
}

/** Removes the visual hull's ghosts: loose pieces (6-connected) where every side's view agrees there could be
    something, but which no side actually shows, because the rest of the model already covers every line through
    them along all three axes. A donut drawn from the front as an Egg, 128 thick, grew little floating blobs in its
    corners this way (session 8 stress test). Removing such a piece changes no side's view, so no paint gets cut off;
    a separate part that some side does show stays. Pieces are checked smallest first, the largest never. */
function dropGhosts(solid: Uint8Array, n: number) {
  const nn = n * n, { pieces } = labelPieces(solid, n);
  if (pieces.length < 2) return;
  // how many voxels each line holds, along x (indexed z·n + y), y (z·n + x) and z (y·n + x)
  const lines = [new Int32Array(nn), new Int32Array(nn), new Int32Array(nn)];
  const lineOf = (k: number) => { const x = k % n, y = ((k - x) / n) % n, z = (k - x - y * n) / nn; return [z * n + y, z * n + x, y * n + x]; };
  for (let k = 0; k < solid.length; k++) if (solid[k]) { const l = lineOf(k); lines[0][l[0]]++; lines[1][l[1]]++; lines[2][l[2]]++; }
  const order = pieces.map((_, i) => i).sort((a, b) => pieces[a].length - pieces[b].length);
  order.pop(); // the largest piece is the model
  const own = [new Map<number, number>(), new Map<number, number>(), new Map<number, number>()];
  for (const p of order) {
    for (const m of own) m.clear();
    for (const k of pieces[p]) { const l = lineOf(k); for (let a = 0; a < 3; a++) own[a].set(l[a], (own[a].get(l[a]) ?? 0) + 1); }
    let shown = false;
    for (let a = 0; a < 3 && !shown; a++) for (const [l, c] of own[a]) if (lines[a][l] === c) { shown = true; break; }
    if (shown) continue;
    for (const k of pieces[p]) { solid[k] = 0; const l = lineOf(k); lines[0][l[0]]--; lines[1][l[1]]--; lines[2][l[2]]--; }
  }
}

/** Phase 1's outline rule, applied again: where the shape removed a whole line through the sprite's thickness that
    the carved model had, the line keeps its middle voxel (or middle two), so the sprite's own panel isn't cut. */
function keepOutline(hull: Uint8Array, solid: Uint8Array, n: number, t: number) {
  const stride = [1, n, n * n], [a, b] = planeAxes(t);
  for (let cb = 0; cb < n; cb++) for (let ca = 0; ca < n; ca++) {
    const base = ca * stride[a] + cb * stride[b], st = stride[t];
    let first = -1, last = -1, any = false;
    for (let s = 0; s < n; s++) {
      const i = base + s * st;
      if (solid[i]) { any = true; break; }
      if (hull[i]) { if (first < 0) first = s; last = s; }
    }
    if (any || first < 0) continue;
    const len = last - first + 1, mids = len % 2 ? [first + (len - 1) / 2] : [first + len / 2 - 1, first + len / 2];
    let kept = false;
    for (const s of mids) if (hull[base + s * st]) { solid[base + s * st] = 1; kept = true; }
    if (!kept) { // a gap in the middle of the line: keep the hull voxel nearest to it
      let best = first, bd = Infinity;
      for (let s = first; s <= last; s++) if (hull[base + s * st] && Math.abs(s - mids[0]) < bd) { bd = Math.abs(s - mids[0]); best = s; }
      solid[base + best * st] = 1;
    }
  }
}

/** Split coordinate on each axis as a 0–1 position in the cube, for drawing the split plane. */
export const splitPlaneAt = (m: VoxelModel, axis: 0 | 1 | 2) => m.split[axis] / m.n;

// ------------------------------------------------------------------ colours

export interface ColouredModel {
  /** 0xRRGGBB per voxel (only meaningful where solid). Interior voxels hold the nearest surface colour. */
  colour: Uint32Array;
  /** Distance to the surface in voxel steps: 1 = surface, 0 = empty. */
  dist: Uint16Array;
  /** Local thickness: the deepest distance reached in this part of the model (for Flesh & bone). */
  deep: Uint16Array;
  maxDist: number;
  /** Surface voxels whose colour came from the gap colour rule (no panel had paint for them). */
  gaps: number;
}

const rgbAt = (d: Uint8Array, i: number) => (d[i * 4] << 16) | (d[i * 4 + 1] << 8) | d[i * 4 + 2];

/** For each pixel of a panel, the nearest solid pixel (8-connected steps), or −1 when the panel is empty. */
export function nearestSolid(m: Uint8Array, n: number): Int32Array {
  const near = new Int32Array(n * n).fill(-1), queue = new Int32Array(n * n);
  let head = 0, tail = 0;
  for (let i = 0; i < n * n; i++) if (m[i]) { near[i] = i; queue[tail++] = i; }
  while (head < tail) {
    const i = queue[head++], x = i % n, y = (i - x) / n;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= n || yy >= n) continue;
      const j = yy * n + xx;
      if (near[j] < 0) { near[j] = near[i]; queue[tail++] = j; }
    }
  }
  return near;
}

/** The surface colour rule (DESIGN.md §8; §5 for the colour fallback) for single voxels: `colourOf(x, y, z)` gives a
    surface voxel's colour, and `gaps` counts the ones so far that took it from the gap colour rule. `side` is the
    input side, whose panel wins wherever it sees a voxel; given `minFacing` (a cosine), only where the surface there
    also faces it at least that much (the mesh texture uses 0.5, DESIGN.md §7). */
export function surfaceColourRule(m: VoxelModel, read: SheetRead, side: SideCode, fallback: FallbackCode) {
  const { n, solid } = m, panels = read.panels!, nn = n * n, stride = [1, n, nn];
  const isSolid = (x: number, y: number, z: number) => x >= 0 && y >= 0 && z >= 0 && x < n && y < n && z < n && solid[(z * n + y) * n + x] === 1;

  // which panels see each voxel first: walk every panel's lines from the viewer's side to the first solid voxel
  const seenBy = new Uint8Array(nn * n); // bit per SIDE_CODES index
  SIDE_CODES.forEach((p, bit) => {
    const [k, fromHigh] = VIEW[p].look, [a, b] = planeAxes(k);
    for (let cb = 0; cb < n; cb++) for (let ca = 0; ca < n; ca++) {
      const base = ca * stride[a] + cb * stride[b];
      for (let s = 0; s < n; s++) {
        const i = base + (fromHigh ? n - 1 - s : s) * stride[k];
        if (solid[i]) { seenBy[i] |= 1 << bit; break; }
      }
    }
  });
  const near = {} as Record<SideCode, Int32Array>;
  const nearOf = (p: SideCode) => (near[p] ??= nearestSolid(m.mask[p], n));
  const sideBit = SIDE_CODES.indexOf(side);
  const cand: SideCode[] = [], score: number[] = [];
  const rule = {
    gaps: 0,
    colourOf(x: number, y: number, z: number, minFacing = -Infinity): number {
      const i = (z * n + y) * n + x;
      // which way the surface faces here: the sum of the directions to empty neighbours
      let nx = 0, ny = 0, nz = 0;
      for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if ((dx || dy || dz) && !isSolid(x + dx, y + dy, z + dz)) { nx += dx; ny += dy; nz += dz; }
      }
      const normal = [nx, ny, nz];
      // for the facing test, a smoother direction from the empty cells up to two steps away: one step is too rough on
      // small round models, where it let the facing flip from voxel to voxel along a seam
      let fx = 0, fy = 0, fz = 0;
      if (minFacing > -Infinity) for (let dz = -2; dz <= 2; dz++) for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        if ((dx || dy || dz) && !isSolid(x + dx, y + dy, z + dz)) { fx += dx; fy += dy; fz += dz; }
      }
      const facing = [fx, fy, fz], flen = Math.hypot(fx, fy, fz);
      // candidates: the panels that see this voxel; for voxels no panel sees (inside a cavity), the faces that are open
      cand.length = 0; score.length = 0;
      SIDE_CODES.forEach((p, bit) => { if (seenBy[i] & (1 << bit)) cand.push(p); });
      if (!cand.length) {
        const open = [!isSolid(x + 1, y, z), !isSolid(x - 1, y, z), !isSolid(x, y + 1, z), !isSolid(x, y - 1, z), !isSolid(x, y, z + 1), !isSolid(x, y, z - 1)];
        for (let f = 0; f < 6; f++) if (open[f]) cand.push(FACING[f >> 1][f & 1]);
      }
      for (const p of cand) {
        const [k, fromHigh] = VIEW[p].look, f = normal[k] * (fromHigh ? 1 : -1), g = facing[k] * (fromHigh ? 1 : -1);
        score.push(p === side && (seenBy[i] & (1 << sideBit)) && (minFacing === -Infinity || g >= minFacing * flen) ? Infinity : f);
      }
      const order = cand.map((p, j) => [p, score[j]] as const).sort((u, v) => v[1] - u[1]);
      for (const [p] of order) {
        const px = m.pix[p][planeIndex(VIEW[p].look[0], x, y, z, n)];
        if (m.mask[p][px]) return rgbAt(panels[p], px);
      }
      rule.gaps++;
      const p0 = order[0][0], k = VIEW[p0].look[0], j = planeIndex(k, x, y, z, n);
      const opp = OPPOSITE[p0], oj = m.pix[opp][j];
      if (fallback === 'opp' && m.mask[opp][oj]) return rgbAt(panels[opp], oj);
      const nb = nearOf(p0)[m.pix[p0][j]];
      const no = nb < 0 ? nearOf(opp)[oj] : -1;
      return nb >= 0 ? rgbAt(panels[p0], nb) : no >= 0 ? rgbAt(panels[opp], no) : 0x808080;
    },
  };
  return rule;
}

/** Colours the model (DESIGN.md §8, surface colour rule; §5, colour fallback) and measures each voxel's distance to
    the surface. `side` is the input side, whose panel wins wherever it sees a voxel. */
export function colourModel(m: VoxelModel, read: SheetRead, side: SideCode, fallback: FallbackCode): ColouredModel {
  const { n, solid } = m, nn = n * n, total = nn * n;
  const colour = new Uint32Array(total), dist = new Uint16Array(total), deep = new Uint16Array(total);
  const isSolid = (x: number, y: number, z: number) => x >= 0 && y >= 0 && z >= 0 && x < n && y < n && z < n && solid[(z * n + y) * n + x] === 1;
  const rule = surfaceColourRule(m, read, side, fallback);

  // surface voxels
  const queue = new Int32Array(m.count);
  let tail = 0;
  for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const i = (z * n + y) * n + x;
    if (!solid[i]) continue;
    if (isSolid(x + 1, y, z) && isSolid(x - 1, y, z) && isSolid(x, y + 1, z) && isSolid(x, y - 1, z) && isSolid(x, y, z + 1) && isSolid(x, y, z - 1)) continue;
    dist[i] = 1; queue[tail++] = i;
    colour[i] = rule.colourOf(x, y, z);
  }
  const gaps = rule.gaps;

  // inwards from the surface: distance and the nearest surface colour
  let head = 0, maxDist = tail ? 1 : 0;
  while (head < tail) {
    const i = queue[head++], x = i % n, y = ((i - x) / n) % n, z = Math.floor(i / nn), d = dist[i] + 1;
    const visit = (j: number) => { if (solid[j] && !dist[j]) { dist[j] = d; colour[j] = colour[i]; queue[tail++] = j; if (d > maxDist) maxDist = d; } };
    if (x > 0) visit(i - 1); if (x < n - 1) visit(i + 1);
    if (y > 0) visit(i - n); if (y < n - 1) visit(i + n);
    if (z > 0) visit(i - nn); if (z < n - 1) visit(i + nn);
  }
  // local thickness: carry the deepest distance back out along the way it was reached
  for (let q = tail - 1; q >= 0; q--) {
    const i = queue[q], x = i % n, y = ((i - x) / n) % n, z = Math.floor(i / nn), d = dist[i];
    let best = d;
    const look = (j: number) => { if (dist[j] === d + 1 && deep[j] > best) best = deep[j]; };
    if (x > 0) look(i - 1); if (x < n - 1) look(i + 1);
    if (y > 0) look(i - n); if (y < n - 1) look(i + n);
    if (z > 0) look(i - nn); if (z < n - 1) look(i + nn);
    deep[i] = best;
  }
  return { colour, dist, deep, maxDist, gaps };
}

// ------------------------------------------------------------------ inside styles (DESIGN.md §8)

export interface InsideSettings {
  inside: InsideCode;
  /** Up to three colours, 0xRRGGBB. */
  colours: [number, number, number];
  /** Shade variation, 0–100. */
  noise: number;
  /** Pattern scale in voxels, 1–16. */
  scale: number;
}

/** A small integer hash of a voxel position, 0 ≤ h < 1. The same voxel always gets the same value. */
export function hash3(x: number, y: number, z: number, seed = 0): number {
  let h = Math.imul(x + 0x632be5ab, 0x27d4eb2d) ^ Math.imul(y + 0x85157af5, 0x165667b1) ^ Math.imul(z + seed * 0x3c6ef372 + 0x1b873593, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function shadeRgb(c: number, f: number): number {
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(v * f)));
  return (ch(c >> 16) << 16) | (ch((c >> 8) & 255) << 8) | ch(c & 255);
}

/** The colour of an interior voxel (distance ≥ 2) for an inside style, or −1 for no voxel (Hollow).
    `surface` is the nearest surface colour; `deep` the local thickness from `colourModel`. */
export type InsideShader = (x: number, y: number, z: number, dist: number, deep: number, surface: number) => number;

export function insideShader(s: InsideSettings): InsideShader {
  const [c0, c1, c2] = s.colours, pal = s.colours, noise = s.noise / 100, sc = Math.max(1, s.scale);
  const nz = (c: number, x: number, y: number, z: number) => (noise ? shadeRgb(c, 1 + (hash3(x, y, z, 1) - .5) * noise * .7) : c);
  const band = Math.max(1, Math.round(sc / 2));
  switch (s.inside) {
    case 'hollow': return () => -1;
    case 'solid': return (x, y, z) => nz(c0, x, y, z);
    // patches the size of the pattern scale, two colours mixed, plus shade variation
    case 'noise': return (x, y, z) => nz(hash3(Math.floor(x / sc), Math.floor(y / sc), Math.floor(z / sc), 2) < .5 ? c0 : c1, x, y, z);
    case 'onion': return (x, y, z, d) => nz(Math.floor((d - 2) / band) % 2 ? c1 : c0, x, y, z);
    case 'rings': return (x, y, z, d) => nz(Math.floor((d - 2) / Math.max(1, Math.round(sc / 4))) % 2 ? c1 : c0, x, y, z);
    case 'strata': return (x, y, z) => nz(pal[Math.floor(y / band) % 3], x, y, z);
    case 'crystal': return (x, y, z) => {
      // cellular: each voxel takes the colour of the nearest random point, one point per scale-sized cell
      let best = Infinity, id = 0;
      const cx = Math.floor(x / sc), cy = Math.floor(y / sc), cz = Math.floor(z / sc);
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) {
        const X = cx + a, Y = cy + b, Z = cz + c;
        const dx = (X + hash3(X, Y, Z, 3)) * sc - x, dy = (Y + hash3(X, Y, Z, 4)) * sc - y, dz = (Z + hash3(X, Y, Z, 5)) * sc - z;
        const dd = dx * dx + dy * dy + dz * dz;
        if (dd < best) { best = dd; id = hash3(X, Y, Z, 6); }
      }
      return shadeRgb(pal[Math.min(2, Math.floor(id * 3))], .8 + id * .35);
    };
    case 'fractal': return (x, y, z) => {
      const v = (sin((x + 2.2 * sin(y * .45 + z * .3)) * (1.6 / sc) + z * .35) + 1) / 2;
      return nz(pal[v < .4 ? 0 : v < .75 ? 1 : 2], x, y, z);
    };
    // onion layers scaled by the local thickness: skin, flesh, and a bone core down the thickest middle
    case 'flesh': return (x, y, z, d, deep) => {
      const t = (d - 1) / Math.max(1, deep - 1);
      return nz(t < .34 ? c0 : t < .8 || deep < 4 ? c1 : c2, x, y, z);
    };
    case 'machine': return (x, y, z) => {
      if (hash3(x, y, z, 7) > .985) return 0xb6ff5a;
      if (x % sc === 0 && y % sc === 0) return c1;
      if (y % sc === 0 && z % sc === 0) return c2;
      return nz(c0, x, y, z);
    };
    default: return (_x, _y, _z, _d, _deep, surface) => surface; // Nearest surface: the inside continues the outside
  }
}
