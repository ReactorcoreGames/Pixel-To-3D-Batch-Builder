/* Phase 2, step 3: the low-poly mesh (DESIGN.md §6) and its texture (§7).

   1. Silhouettes. Along each world axis the model follows its panels' outlines layer by layer (voxel.ts,
      `axisOutlines`: the near panel before the split, the far one after it, in-between outlines in a blend zone).
      Each run of layers with the same outline is traced into polygons, its pixel staircases straightened into clean
      diagonals, and extruded through the run. The three axes' solids are intersected with manifold (WASM).
   2. Cross-section shapes: slice prisms. Along each of the shape's cut axes, the carved model (before the shape) is
      walked slice by slice; every connected piece in a slice gets the shape's low-poly cross-section fitted to its
      bounding box (an N-gon for round shapes, a diamond, or a bevelled box for the soft box). A piece's
      cross-sections are straightened along the axis like an outline and lofted into each other, so tapers and
      balls come out smooth; where pieces split or join (or with "Straighten slopes" at 0) they step instead. The
      prisms are intersected with the silhouettes, so the outline seen from the side still comes from them.
      A Tube's or Diamond's shaped ends are cut into the model the prisms are fitted to, so each piece's rings shrink
      towards its ends and the loft rounds them off like any taper. The all-round shapes, which cut two axes, are
      lofted along one (↕): the carved model already has the other axis's rounding, and two lofts crossing each other
      left shards at the corners.
      Egg, Gem and a ⊙ tube's shaped ends follow the distance from the outline. Where a slice's depth dips and rises
      again (a ring's rows beside its hole), one ring per slice can't follow it, so those shapes get the traced surface
      of their rule instead (`loftFits`, `inflatedSolid`), intersected with the silhouettes like the prisms.
   3. Texture: box projection of the voxel model's surface colours. Each flat face takes the panel it faces most (the
      sprite's own side wins a tie; on a traced surface, the panel the surface itself faces most there); each panel used is cropped to the model's bounds and painted with the colours of
      the voxels it sees (the surface colour rule, so neighbouring faces on different panels agree), and the crops
      are packed into one atlas with 1px padding.

   Everything is in cube coordinates: x right, y up, z towards the front, one voxel = 1. */

import Module from 'manifold-3d';
import type { CrossSection, Manifold, ManifoldToplevel, Mat4 } from 'manifold-3d/manifold';
import { surfaceColourRule, type VoxelModel } from './voxel';
import { outlineOf, ringArea, rowsOutline, type Ring } from './outline';
import { applyEnds, cutsSpritePlane, endCuts, shapeCuts, type CutKind } from './shape';
import { spriteAxes, spriteFlips, VIEW } from './sheet';
import type { SheetRead } from './reader';
import { SIDE_CODES, type FallbackCode, type RGBAImage, type SideCode } from './types';
import { atan2, cos, sin } from './fmath';

/** On faces that take another panel, the input side's paint only shows where the surface faces the input side at
    least this much (a cosine, 60°). */
const MESH_FACING = .5;

let wasm: ManifoldToplevel | null = null;

/** Loads manifold's WASM once. Call (and await) before `buildMesh`. `wasmBinary` hands it the WASM file's bytes
    instead of fetching the file (the command-line tool carries them inside its one file). */
export async function initMesh(wasmBinary?: Uint8Array): Promise<void> {
  if (wasm) return;
  const w = await (Module as (config?: { wasmBinary: Uint8Array }) => Promise<ManifoldToplevel>)(wasmBinary && { wasmBinary });
  w.setup();
  wasm = w;
}
export const meshReady = () => wasm !== null;

export interface MeshOptions {
  /** Ramp straightening tolerance in px (the "Straighten slopes" column); 0 keeps every pixel step. */
  slope: number;
  /** Sides of the N-gon for round shapes (the "Round sides" column). */
  sides: number;
  /** Join pixels that touch only at a corner (default on; off only for tests that compare with the voxels). */
  bridges?: boolean;
}

export interface MeshData {
  /** Flat-shaded triangles: vertices are shared only within one flat face. Cube coordinates. */
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  /** The panel each vertex takes its texture from (index into SIDE_CODES). */
  panel: Uint8Array;
  triangles: number;
  /** Separate solid parts (parts that only touch at an edge or a corner count as separate). */
  parts: number;
  /** Bounding box, cube coordinates (lo > hi when the mesh is empty). */
  lo: [number, number, number];
  hi: [number, number, number];
}

/** Plane axes for extruding along world axis k: X = axis k + 1, Y = axis k + 2 (a rotation, never a mirror). */
const across = (k: number): [number, number] => [(k + 1) % 3, (k + 2) % 3];

/** Column-major matrix taking an extrusion's (X, Y, Z) to the world, with Z along axis k. */
function toWorld(k: number): Mat4 {
  const m = new Array(16).fill(0) as Mat4, [a, b] = across(k);
  m[0 * 4 + a] = 1; m[1 * 4 + b] = 1; m[2 * 4 + k] = 1; m[15] = 1;
  return m;
}

/** Collects WASM objects so they can all be freed at the end. */
class Bin {
  private items: { delete(): void }[] = [];
  keep<T extends { delete(): void }>(o: T): T { this.items.push(o); return o; }
  free() { for (const o of this.items) o.delete(); this.items = []; }
}

const toPolys = (rings: Ring[]) => rings.filter(r => r.length >= 3).map(r => r.map(([x, y]) => [x, y] as [number, number]));

/** Pixel artists draw rings, chains and thin diagonal lines with pixels that touch only at a corner, and the eye reads
    them as connected. Every such corner (two pixels on one diagonal of a 2 × 2 block, the other two empty) gets a
    small diamond around the shared corner point, a neck as wide as a straightened 1px diagonal line (0.7px), so
    the model holds together instead of falling apart into parts that touch only along an edge. */
function cornerBridges(mask: ArrayLike<number>, n: number): [number, number][][] {
  const out: [number, number][][] = [], on = (x: number, y: number) => mask[y * n + x] !== 0;
  for (let y = 0; y < n - 1; y++) for (let x = 0; x < n - 1; x++) {
    const a = on(x, y), b = on(x + 1, y), c = on(x, y + 1), d = on(x + 1, y + 1);
    if ((a && d && !b && !c) || (b && c && !a && !d)) {
      const px = x + 1, py = y + 1;
      out.push([[px + .5, py], [px, py + .5], [px - .5, py], [px, py - .5]]);
    }
  }
  return out;
}

/** The model the slice prisms are fitted to: the carved model, plus the two empty cells of every 2 × 2 block where
    two voxels touch only along an edge, so a bridged corner (above) isn't cut away again by the rounding. */
function fittingGrid(m: VoxelModel): Uint8Array {
  const n = m.n, g = m.hull.slice(), stride = [1, n, n * n];
  for (let k = 0; k < 3; k++) {
    const [ax, ay] = across(k);
    for (let s = 0; s < n; s++) for (let y = 0; y < n - 1; y++) for (let x = 0; x < n - 1; x++) {
      const i = s * stride[k] + x * stride[ax] + y * stride[ay], dx = stride[ax], dy = stride[ay];
      const a = m.hull[i], b = m.hull[i + dx], c = m.hull[i + dy], d = m.hull[i + dx + dy];
      if (a && d && !b && !c) { g[i + dx] = 1; g[i + dy] = 1; }
      if (b && c && !a && !d) { g[i] = 1; g[i + dx + dy] = 1; }
    }
  }
  return g;
}

/** The solid one axis allows: every run of layers with the same outline, extruded through the run. */
function axisSolid(m: VoxelModel, k: 0 | 1 | 2, tol: number, bridges: boolean, bin: Bin): Manifold | null {
  const { CrossSection: CS, Manifold: M } = wasm!;
  const n = m.n, o = m.outlines[k], [pa] = [0, 1, 2].filter(a => a !== k);
  // plane masks are indexed cb · n + ca with (a, b) the other two axes ascending; the extrusion's X is axis k + 1
  const transpose = across(k)[0] !== pa;
  const sections = new Map<number, CrossSection | null>();
  const sectionOf = (idx: number) => {
    if (sections.has(idx)) return sections.get(idx)!;
    let mask = o.masks[idx];
    if (transpose) { const t = new Uint8Array(n * n); for (let b = 0; b < n; b++) for (let a = 0; a < n; a++) t[a * n + b] = mask[b * n + a]; mask = t; }
    const polys = toPolys(outlineOf(mask, n, n, tol));
    if (bridges) polys.push(...cornerBridges(mask, n));
    const cs = polys.length ? bin.keep(new CS(polys, 'Positive')) : null;
    sections.set(idx, cs && !cs.isEmpty() ? cs : null);
    return sections.get(idx)!;
  };
  // Only the painted bounds along the axis: no voxel lies outside them, and a run there would only leave a face
  // exactly where the model ends (a split at 0 or 1 does that), which the intersection can keep as a paper-thin skin
  // across a hole.
  const bounds = m.painted[k];
  if (!bounds) return null;
  const parts: Manifold[] = [];
  for (let c0 = bounds[0]; c0 <= bounds[1];) {
    let c1 = c0 + 1;
    while (c1 <= bounds[1] && o.layer[c1] === o.layer[c0]) c1++;
    const cs = sectionOf(o.layer[c0]);
    if (cs) parts.push(bin.keep(bin.keep(bin.keep(cs.extrude(c1 - c0)).translate([0, 0, c0])).transform(toWorld(k))));
    c0 = c1;
  }
  if (!parts.length) return null;
  return parts.length === 1 ? parts[0] : bin.keep(M.union(parts));
}

/** The low-poly cross-section of one piece, fitted to its box [x0, x1] × [y0, y1] (continuous coordinates).
    The rounding reaches in from each side by at most half the box's short side: a square box gets the full
    octagon, diamond or bevelled box, but a long one keeps its full thickness in the middle and only its ends are
    rounded (a stadium) or pointed (a hexagon). Fitting one diamond or ellipse to the whole length made a gun's
    receiver thin wherever its grip hung below it, as if bitten. */
function crossSection(kind: CutKind, x0: number, y0: number, x1: number, y1: number, sides: number): [number, number][] {
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, hx = (x1 - x0) / 2, hy = (y1 - y0) / 2, r = Math.min(hx, hy);
  // how far the straight middle runs on from the centre along each axis
  const ex = hx - r, ey = hy - r;
  const pts: [number, number][] = [];
  const add = (u: number, v: number) => { const p: [number, number] = [cx + u, cy + v]; const q = pts[pts.length - 1]; if (!q || Math.hypot(q[0] - p[0], q[1] - p[1]) > 1e-9) pts.push(p); };
  if (kind === 'diamond') {
    // box ∩ a 45° diamond through the ends: a hexagon, or the plain diamond for a square box
    add(hx, -ey); add(hx, ey); add(ex, hy); add(-ex, hy); add(-hx, ey); add(-hx, -ey); add(-ex, -hy); add(ex, -hy);
  } else if (kind === 'round') {
    // an N-gon whose sides touch the circle of the short side, starting with a side facing +X, pulled apart along the
    // long axis into a stadium: at 8 sides on a square box, flats on all four sides and 45° bevels, the classic PS1
    // octagon. Its flats keep the silhouette's full size.
    const nS = Math.max(3, Math.round(sides)), rr = r / cos(Math.PI / nS);
    for (let i = 0; i < nS; i++) {
      const t = (i + .5) * 2 * Math.PI / nS;
      let u = rr * cos(t), v = rr * sin(t);
      if (Math.abs(u) < 1e-9) u = 0;
      if (Math.abs(v) < 1e-9) v = 0;
      // a vertex on a centre line becomes two, one at each end of the straight middle, in counter-clockwise order
      if (!u) { add(v > 0 ? ex : -ex, v + Math.sign(v) * ey); add(v > 0 ? -ex : ex, v + Math.sign(v) * ey); }
      else if (!v) { add(u + Math.sign(u) * ex, u > 0 ? -ey : ey); add(u + Math.sign(u) * ex, u > 0 ? ey : -ey); }
      else add(u + Math.sign(u) * ex, v + Math.sign(v) * ey);
    }
  } else {
    // soft box: the box with its corners bevelled, the low-poly squircle u⁴ + v⁴ ≤ 1. The bevel passes through the
    // squircle's 45° point (2^-¼ ≈ 0.841) of the short side, so a square box's flat sides keep 68% of their length
    const b = (2 - 2 * 0.8408964152537145) * r; // 2^-¼, written out: Math.pow isn't the same bits in every engine
    add(hx, -(hy - b)); add(hx, hy - b); add(hx - b, hy); add(-(hx - b), hy); add(-hx, hy - b); add(-hx, -(hy - b)); add(-(hx - b), -hy); add(hx - b, -hy);
  }
  const f = pts[0], l = pts[pts.length - 1];
  if (pts.length > 3 && Math.hypot(f[0] - l[0], f[1] - l[1]) < 1e-9) pts.pop();
  return pts;
}

/** One slice's pieces along a cut axis: boxes [x0, y0, x1, y1] in the extrusion's (X, Y) and a label per cell. */
interface Slice { boxes: number[][]; label: Int32Array }

/** The connected pieces (8-connected) of the carved model in every slice across world axis k. */
function slicePieces(m: VoxelModel, grid: Uint8Array, k: 0 | 1 | 2): Slice[] {
  const n = m.n, [ax, ay] = across(k), stride = [1, n, n * n], stack = new Int32Array(n * n);
  const out: Slice[] = [];
  for (let s = 0; s < n; s++) {
    const at = (x: number, y: number) => grid[s * stride[k] + x * stride[ax] + y * stride[ay]];
    const label = new Int32Array(n * n), boxes: number[][] = [];
    for (let y0 = 0; y0 < n; y0++) for (let x0 = 0; x0 < n; x0++) {
      if (label[y0 * n + x0] || !at(x0, y0)) continue;
      const id = boxes.length + 1;
      let top = 0, xmin = x0, xmax = x0, ymin = y0, ymax = y0;
      stack[top++] = y0 * n + x0; label[y0 * n + x0] = id;
      while (top) {
        const q = stack[--top], x = q % n, y = (q - x) / n;
        if (x < xmin) xmin = x; if (x > xmax) xmax = x; if (y < ymin) ymin = y; if (y > ymax) ymax = y;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= n || yy >= n || label[yy * n + xx] || !at(xx, yy)) continue;
          label[yy * n + xx] = id; stack[top++] = yy * n + xx;
        }
      }
      boxes.push([xmin, ymin, xmax + 1, ymax + 1]);
    }
    out.push({ boxes, label });
  }
  return out;
}

/** A piece's profile along the cut axis, seen across one of the slice's two directions: its box's extent in that
    direction, slice by slice (row j covers [j, j + 1] along the track), straightened like an outline. So the loft
    follows the same clean diagonals and chamfered corners as the silhouettes: a ball's profile is the circle the
    drawing shows, not the stairs of its voxel rows. */
const profileOf = (boxes: number[][], c: 0 | 1, tol: number): Ring => rowsOutline(boxes.map(b => b[c]), boxes.map(b => b[c + 2]), tol);

/** Rounds a profile's outward corners the way the rings are rounded: each corner turns by at most one N-gon step
    (360° / sides) per segment, so at 8 sides a 45° corner stays and at 16 it is cut in two. The cut is a curve
    (a quadratic Bézier) between points up to half an edge away from the corner, so it stays inside the profile and
    neighbouring corners never overlap. A corner with an edge shorter than 1.2px is left alone: rounding it wouldn't
    show, and a boulder's many small corners doubled its triangles. For Egg: a ball's straightened profile is an
    octagon, which lofted round made a spinning top. */
function roundProfile(r: Ring, sides: number): Ring {
  const step = 2 * Math.PI / Math.max(3, Math.round(sides)), turn = Math.sign(ringArea(r)), out: Ring = [];
  for (let i = 0; i < r.length; i++) {
    const p = r[(i + r.length - 1) % r.length], v = r[i], q = r[(i + 1) % r.length];
    const ux = v[0] - p[0], uy = v[1] - p[1], wx = q[0] - v[0], wy = q[1] - v[1], lu = Math.hypot(ux, uy), lw = Math.hypot(wx, wy);
    const angle = atan2(ux * wy - uy * wx, ux * wx + uy * wy) * turn, k = Math.ceil(angle / step - 1e-6);
    if (k < 2 || Math.min(lu, lw) < 1.2) { out.push(v); continue; }
    const t = Math.min(lu, lw) / 2, a = [v[0] - ux / lu * t, v[1] - uy / lu * t], b = [v[0] + wx / lw * t, v[1] + wy / lw * t];
    for (let j = 0; j <= k; j++) {
      const u = j / k, c0 = (1 - u) * (1 - u), c1 = 2 * u * (1 - u), c2 = u * u;
      out.push([c0 * a[0] + c1 * v[0] + c2 * b[0], c0 * a[1] + c1 * v[1] + c2 * b[1]]);
    }
  }
  return out;
}

/** Where a profile's solid lies at the two ends of [h0, h1], a stretch with no corner inside it: [lo, hi] at h0 and
    at h1. Every edge that isn't flat spans the whole stretch or none of it, so both ends are exact. */
function spanOver(r: Ring, h0: number, h1: number): [[number, number], [number, number]] {
  const at0 = [Infinity, -Infinity], at1 = [Infinity, -Infinity];
  for (let i = 0; i < r.length; i++) {
    const a = r[i], b = r[(i + 1) % r.length];
    if (Math.min(a[1], b[1]) > h0 || Math.max(a[1], b[1]) < h1 || a[1] === b[1]) continue;
    const x = (h: number) => a[0] + (b[0] - a[0]) * (h - a[1]) / (b[1] - a[1]);
    const x0 = x(h0), x1 = x(h1);
    at0[0] = Math.min(at0[0], x0); at0[1] = Math.max(at0[1], x0); at1[0] = Math.min(at1[0], x1); at1[1] = Math.max(at1[1], x1);
  }
  return [[at0[0], at0[1]], [at1[0], at1[1]]];
}

/** The slice prisms of one cut along world axis k, fitted to the pieces of the carved model (DESIGN.md §6).
    With a slope tolerance, each piece is followed from slice to slice while it stays one piece; its two profiles
    along the axis are traced and straightened like an outline (with `round`, for Egg, their corners also rounded
    like the rings), and the loft between every two corner heights is the convex hull of the rings there. So a ball
    or a taper comes out smooth and light, and its profile matches the drawing's outline. Where pieces split or join,
    and with tolerance 0, the shape steps: slices with the same pieces make one prism. */
function cutSolid(m: VoxelModel, grid: Uint8Array, k: 0 | 1 | 2, kind: CutKind, o: MeshOptions, bin: Bin, round = false): Manifold | null {
  const { CrossSection: CS, Manifold: M } = wasm!;
  const n = m.n, slices = slicePieces(m, grid, k), parts: Manifold[] = [];
  const ring = (b: number[]) => crossSection(kind, b[0], b[1], b[2], b[3], o.sides);
  if (o.slope <= 0) {
    const keys = slices.map(sl => sl.boxes.map(b => b.join(',')).sort().join(';'));
    for (let s0 = 0; s0 < n;) {
      let s1 = s0 + 1;
      while (s1 < n && keys[s1] === keys[s0]) s1++;
      if (slices[s0].boxes.length) {
        const cs = bin.keep(new CS(slices[s0].boxes.map(ring), 'Positive'));
        parts.push(bin.keep(bin.keep(bin.keep(cs.extrude(s1 - s0)).translate([0, 0, s0])).transform(toWorld(k))));
      }
      s0 = s1;
    }
  } else {
    // follow each piece: it continues into the next slice when the two overlap and neither overlaps anything else
    const tracks: { s0: number; boxes: number[][] }[] = [];
    let prevTrack: number[] = [];
    for (let s = 0; s < n; s++) {
      const cur = slices[s], track = new Array<number>(cur.boxes.length).fill(-1);
      if (s > 0) {
        const prev = slices[s - 1], fwd = prev.boxes.map(() => new Set<number>()), back = cur.boxes.map(() => new Set<number>());
        for (let c = 0; c < n * n; c++) {
          const a = prev.label[c], b = cur.label[c];
          if (a && b) { fwd[a - 1].add(b - 1); back[b - 1].add(a - 1); }
        }
        back.forEach((set, b) => {
          if (set.size !== 1) return;
          const a = [...set][0];
          if (fwd[a].size === 1) { track[b] = prevTrack[a]; tracks[track[b]].boxes.push(cur.boxes[b]); }
        });
      }
      cur.boxes.forEach((b, i) => { if (track[i] < 0) { track[i] = tracks.length; tracks.push({ s0: s, boxes: [b] }); } });
      prevTrack = track;
    }
    // each track: its two profiles (across X and across Y), and a loft between every two heights where either has a
    // corner, with the ring there fitted to both profiles' spans
    const world = (pts: [number, number][], z: number) => pts.map(([x, y]) => { const v = [0, 0, 0]; v[k] = z; v[(k + 1) % 3] = x; v[(k + 2) % 3] = y; return v as [number, number, number]; });
    for (const t of tracks) {
      let px = profileOf(t.boxes, 0, o.slope), py = profileOf(t.boxes, 1, o.slope);
      if (round) { px = roundProfile(px, o.sides); py = roundProfile(py, o.sides); }
      const hs = [...new Set([...px, ...py].map(p => p[1]))].sort((a, b) => a - b);
      for (let i = 1; i < hs.length; i++) {
        const [xa, xb] = spanOver(px, hs[i - 1], hs[i]), [ya, yb] = spanOver(py, hs[i - 1], hs[i]);
        const ra = crossSection(kind, xa[0], ya[0], xa[1], ya[1], o.sides), rb = crossSection(kind, xb[0], yb[0], xb[1], yb[1], o.sides);
        parts.push(bin.keep(M.hull([...world(ra, t.s0 + hs[i - 1]), ...world(rb, t.s0 + hs[i])])));
      }
    }
  }
  if (!parts.length) return null;
  return parts.length === 1 ? parts[0] : bin.keep(M.union(parts));
}

/** The shapes whose depth follows the distance from the outline (`inflate` in shape.ts): Egg, Gem, and a ⊙ Tube or
    Diamond with shaped ends. */
const inflated = (m: VoxelModel) => m.shape === 'ell' || m.shape === 'dpy' || (cutsSpritePlane(m.shape) && endCuts(m.shape, m.ends).length > 0);

/** Whether the slice prisms can follow an inflated shape (DESIGN.md §6). They fit one ring to each piece of a slice
    and loft the rings into each other, which only follows a slice whose depth rises and falls once along it: a
    donut's rows just above and below the hole are deep at both ends and shallow in the middle, and their rings filled
    them in (four "petals"). So along every row of the drawing (the slices of the ↕ loft), and for a ⊙ tube's ends
    every column too, the model's depth may not dip and rise again by more than a fifth of how much it varies (at
    least 2 voxels). Balls, boulders and most outlines pass and keep the loft; a ring doesn't. */
function loftFits(m: VoxelModel): boolean {
  const n = m.n, sa = spriteAxes(m.side), t = sa.T, stride = [1, n, n * n];
  const depth = (w: number, h: number) => {
    let c = 0;
    for (let s = 0, i = w * stride[sa.W] + h * stride[sa.H]; s < n; s++, i += stride[t]) c += m.solid[i];
    return c;
  };
  const dips = (line: number[]) => {
    // a dip: a point lower by more than tol than the highest points on both sides of it, within one run
    const before = new Array<number>(line.length), after = new Array<number>(line.length);
    for (let i = 0, top = 0; i < line.length; i++) { top = line[i] ? Math.max(top, line[i]) : 0; before[i] = top; }
    for (let i = line.length - 1, top = 0; i >= 0; i--) { top = line[i] ? Math.max(top, line[i]) : 0; after[i] = top; }
    return line.some((d, i) => d > 0 && Math.min(before[i], after[i]) - d > tol);
  };
  const rows = Array.from({ length: n }, (_, h) => Array.from({ length: n }, (_, w) => depth(w, h)));
  const all = rows.flat().filter(d => d > 0), tol = Math.max(2, (Math.max(...all) - Math.min(...all)) / 5);
  if (rows.some(dips)) return false;
  return !cutsSpritePlane(m.shape) || !Array.from({ length: n }, (_, w) => rows.map(r => r[w])).some(dips);
}

/** Triangle lengths per N-gon side across the traced surface's curve (2 gave twice the triangles of the loft for
    no visible gain). */
const PER_SIDE = 1;

/** The traced surface of an inflated shape whose depth the slice prisms can't follow (`loftFits`), DESIGN.md §6.
    It is the rule `inflate` rounds to whole voxels, before the rounding, traced with `Manifold.levelSet`:
    - The outline is the model seen along its thickness, straightened like the panels' outlines, and every point's
      signed distance to it (on a half-pixel grid) gives its place on the profile: straight for Gem, and for Egg and
      a Tube's ends the N-gon of the Round sides (circumscribed, flats facing out and up, as the tubes' cross-sections
      draw it: at 8 sides a flat band round the rim, a 45° bevel and a flat top). So the surface comes in bands that
      follow the outline. (Measured to the pixels' centres instead, every step of the outline rippled through it.)
    - Past the outline the profile closes within half a pixel, and the panels' outlines (the axis solids the surface
      is intersected with) decide where the model stops. A flat end runs one voxel past the model for the same reason.
    - The thickness is stretched to the drawing's inscribed diameter while tracing, so the triangles are about
      (π × that diameter ÷ Round sides ÷ PER_SIDE) long both ways, then merged where they lie within the sag of one
      N-gon side of each other. The grid runs through the deepest point, so the peak isn't shaved off (a Gem's point
      fell between grid lines and lost two voxels).
    - What the rule never cuts (the middle voxel or two of an Egg or Gem, a ⊙ tube's flat middle) is added as a slab,
      so parts too thin for the trace are still as thick as the voxel model has them.
    Also returns the surface's own direction near a point on it, for picking faces' panels: the facets' own normals
    scattered the pictures' borders into a zigzag. */
function inflatedSolid(m: VoxelModel, o: MeshOptions, bin: Bin): { solid: Manifold; facing: (c: number[]) => number[] | null } | null {
  const { Manifold: M } = wasm!;
  const n = m.n, t = spriteAxes(m.side).T, [pa, pb] = t === 0 ? [1, 2] : t === 1 ? [0, 2] : [0, 1];
  const stride = [1, n, n * n], mask = new Uint8Array(n * n);
  for (let b = 0; b < n; b++) for (let a = 0; a < n; a++) {
    const base = a * stride[pa] + b * stride[pb];
    for (let s = 0; s < n; s++) if (m.solid[base + s * stride[t]]) { mask[b * n + a] = 1; break; }
  }
  const lo0 = m.lo[t], hi0 = m.hi[t] + 1, full = hi0 - lo0;
  const segs: number[][] = [];
  for (const r of outlineOf(mask, n, n, o.slope)) for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length]; segs.push([p[0], p[1], q[0], q[1]]); }
  if (!segs.length) return null;
  const H = .5, x0 = m.lo[pa] - 3, y0 = m.lo[pb] - 3, nx = Math.ceil((m.hi[pa] + 4 - x0) / H) + 1, ny = Math.ceil((m.hi[pb] + 4 - y0) / H) + 1;
  const g = new Float64Array(nx * ny);
  let most = 0, peak = 0;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const x = x0 + i * H, y = y0 + j * H;
    let d2 = Infinity, inside = false;
    for (const [ax, ay, bx, by] of segs) {
      const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy, u = l2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0;
      const ex = ax + u * dx - x, ey = ay + u * dy - y;
      d2 = Math.min(d2, ex * ex + ey * ey);
      if ((ay > y) !== (by > y) && x < ax + (y - ay) * dx / dy) inside = !inside;
    }
    const k = j * nx + i;
    g[k] = inside ? Math.sqrt(d2) : -Math.sqrt(d2);
    if (g[k] > most) { most = g[k]; peak = k; }
  }
  if (most <= 0) return null;
  // how far each end's cap reaches in (see `inflate`, whose radius is `most` here); a flat end is 0
  const kind: CutKind = m.shape === 'dpy' || m.shape === 'diT' ? 'diamond' : 'round';
  let capLo = full / 2, capHi = full / 2;
  if (cutsSpritePlane(m.shape)) {
    const [c] = endCuts(m.shape, m.ends), rev = spriteFlips(m.side).T, cap = Math.min(most, c.first && c.last ? full / 2 : full);
    capLo = (rev ? c.last : c.first) ? cap : 0; capHi = (rev ? c.first : c.last) ? cap : 0;
  }
  const N = Math.max(3, Math.round(o.sides)), flats: [number, number][] = [];
  for (let i = 0; i < N; i++) { const a = i * 2 * Math.PI / N; if (sin(a) > 1e-9) flats.push([cos(a), sin(a)]); }
  const ngon = (s: number) => { let y = Infinity; for (const [c, sn] of flats) y = Math.min(y, (1 - (1 - s) * c) / sn); return y; };
  const rim = kind === 'diamond' ? 0 : ngon(0);
  const profile = (s: number) => (s < 0 ? rim + 2 * most * s : kind === 'diamond' ? s : ngon(s));
  const across = 2 * most, k = across / full;
  const at = (i: number, j: number) => g[Math.max(0, Math.min(ny - 1, j)) * nx + Math.max(0, Math.min(nx - 1, i))];
  // how far inside the span of its line through the thickness a point is (negative outside it)
  const field = (p: ArrayLike<number>) => {
    const u = (p[pa] - x0) / H, v = (p[pb] - y0) / H, i = Math.floor(u), j = Math.floor(v), fu = u - i, fv = v - j;
    const f = profile(((at(i, j) * (1 - fu) + at(i + 1, j) * fu) * (1 - fv) + (at(i, j + 1) * (1 - fu) + at(i + 1, j + 1) * fu) * fv) / most);
    const front = capLo ? lo0 + capLo * (1 - f) : lo0 - 1, back = capHi ? hi0 - capHi * (1 - f) : hi0 + 1;
    return Math.min(p[t] - front, back - p[t]);
  };
  const edge = Math.max(.5, Math.PI * across / N / PER_SIDE), sag = most * (1 - cos(Math.PI / N)) * k;
  // manifold spaces the grid as evenly as the box allows, so the box is a whole number of steps, a hair over
  const min = [0, 0, 0] as [number, number, number], max = [0, 0, 0] as [number, number, number];
  for (const [ax, c] of [[pa, x0 + (peak % nx) * H], [pb, y0 + Math.floor(peak / nx) * H]]) {
    const below = Math.ceil((c - m.lo[ax] + 2) / edge), above = Math.ceil((m.hi[ax] + 3 - c) / edge);
    min[ax] = c - below * edge; max[ax] = c + above * edge * (1 + 1e-9);
  }
  min[t] = (lo0 - 2) * k; max[t] = (hi0 + 2) * k;
  const traced = bin.keep(M.levelSet(p => { const q = [p[0], p[1], p[2]]; q[t] /= k; return field(q) * k; }, { min, max }, edge, 0));
  const unstretch: [number, number, number] = [1, 1, 1];
  unstretch[t] = 1 / k;
  let solid = bin.keep(bin.keep(traced.simplify(sag)).scale(unstretch));
  const shortest = full % 2 ? 1 : 2;
  let s0 = lo0 + capLo, s1 = hi0 - capHi;
  if (s1 - s0 < shortest) { s0 = lo0 + (full - shortest) / 2; s1 = s0 + shortest; }
  const size: [number, number, number] = [n + 2, n + 2, n + 2], at0: [number, number, number] = [-1, -1, -1];
  size[t] = s1 - s0; at0[t] = s0;
  solid = bin.keep(solid.add(bin.keep(bin.keep(M.cube(size)).translate(at0))));
  const facing = (c: number[]) => {
    if (Math.abs(field(c)) > .75) return null;
    const d = [0, 1, 2].map(ax => { const a = c.slice(), b = c.slice(); a[ax] += .25; b[ax] -= .25; return field(b) - field(a); });
    return Math.hypot(d[0], d[1], d[2]) > 1e-9 ? d : null;
  };
  return solid.isEmpty() ? null : { solid, facing };
}

/** Builds the low-poly mesh of a voxel model. `initMesh()` must have finished. */
export function buildMesh(m: VoxelModel, o: MeshOptions): MeshData {
  if (!wasm) throw new Error('initMesh() has not finished');
  const bin = new Bin();
  try {
    let solid: Manifold | null = null, facing: ((c: number[]) => number[] | null) | undefined;
    if (m.count) {
      const bridges = o.bridges !== false, axes = ([0, 1, 2] as const).map(k => axisSolid(m, k, o.slope, bridges, bin));
      if (axes.every(Boolean)) solid = bin.keep(wasm.Manifold.intersection(axes as Manifold[]));
      const sa = spriteAxes(m.side), all = shapeCuts(m.shape);
      if (solid && inflated(m) && !loftFits(m)) {
        // a shape the slice prisms can't follow (a ring as Egg, Gem or a capped ⊙ tube): the traced surface of its
        // rule, inside the outlines the panels carve. (A ⊙ tube's N-gon prisms on top of that only grazed the traced
        // surface: 300 slivers on a capped donut.)
        const shell = solid && inflatedSolid(m, o, bin);
        solid = shell ? bin.keep(solid!.intersect(shell.solid)) : null;
        facing = shell ? shell.facing : undefined;
      } else {
        // The all-round shapes (Soft box, Egg, Gem) cut ↔ and ↕, but their mesh is lofted along ↕ only: the carved
        // model already carries the ↔ rounding, so the rings shrink towards every edge by themselves. A second loft
        // crossing the first met it at a slant at every corner and left shards there (a 5px baseball: 240 triangles,
        // 86 of them slivers; lofted once, 92 and none).
        const cuts = (all.length > 1 ? all.filter(c => c.axis === 'H') : all).map(c => ({ kind: c.kind, axis: sa[c.axis] }));
        let grid = cuts.length ? (bridges ? fittingGrid(m) : m.hull) : m.hull;
        // Shaped ends: the voxel model's end cut, made on the model the slice prisms are fitted to, so the rings of a
        // piece shrink towards its ends and are lofted into a dome or a point, while the rest of the length stays a
        // plain tube. The sheet's panels usually carry the ends already (Phase 1 drew them); this also covers ends
        // chosen in ② for a sheet made without them. (Separate prisms for the ends, fitted to the voxel rows, also
        // cut into the tube's N-gon all along its length: many more triangles, and no longer a plain tube in the
        // middle.)
        if (endCuts(m.shape, m.ends).length) grid = applyEnds({ nx: m.n, ny: m.n, nz: m.n, data: grid }, m.shape, m.ends, sa, spriteFlips(m.side)).data;
        for (const c of cuts) {
          if (!solid || solid.isEmpty()) break;
          const prisms = cutSolid(m, grid, c.axis, c.kind, o, bin, m.shape === 'ell');
          solid = prisms ? bin.keep(solid.intersect(prisms)) : null;
        }
      }
    }
    const parts = solid && !solid.isEmpty() ? solid.decompose() : [];
    parts.forEach(p => bin.keep(p));
    return { ...flatMesh(solid, m.side, facing), parts: parts.length };
  } finally {
    bin.free();
  }
}

/** Splits a manifold into flat-shaded triangles with a face normal and a texture panel per vertex. */
function flatMesh(solid: Manifold | null, side: SideCode, facing?: (c: number[]) => number[] | null): Omit<MeshData, 'parts'> {
  const lo: [number, number, number] = [Infinity, Infinity, Infinity], hi: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  if (!solid || solid.isEmpty()) return { positions: new Float32Array(), normals: new Float32Array(), indices: new Uint32Array(), panel: new Uint8Array(), triangles: 0, lo, hi };
  const mesh = solid.getMesh(), vp = mesh.vertProperties, np = mesh.numProp, tv = mesh.triVerts, nt = tv.length / 3;
  const at = (v: number) => [vp[v * np], vp[v * np + 1], vp[v * np + 2]];
  // each triangle's normal and the flat face (plane) it lies in, with the face's area-weighted normal
  const tn = new Float64Array(nt * 3), faceOf = new Int32Array(nt), faces = new Map<string, number>(), faceN: number[][] = [], faceC: number[][] = [];
  for (let t = 0; t < nt; t++) {
    const [a, b, c] = [at(tv[t * 3]), at(tv[t * 3 + 1]), at(tv[t * 3 + 2])];
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    // a sliver with no area (three points in a line) is kept, so its neighbours' edges still meet without a crack
    if (len < 1e-9) { nx = 0; ny = 1; nz = 0; } else { nx /= len; ny /= len; nz /= len; }
    tn.set([nx, ny, nz], t * 3);
    const key = len < 1e-9 ? `sliver ${t}` : [nx, ny, nz].map(v => Math.round(v * 1e4)).join() + ',' + Math.round((nx * a[0] + ny * a[1] + nz * a[2]) * 1e3);
    let f = faces.get(key);
    if (f === undefined) { f = faceN.length; faces.set(key, f); faceN.push([0, 0, 0]); faceC.push([0, 0, 0, 0]); }
    faceOf[t] = f;
    faceN[f][0] += nx * (len || 1e-9); faceN[f][1] += ny * (len || 1e-9); faceN[f][2] += nz * (len || 1e-9);
    for (let k = 0; k < 3; k++) faceC[f][k] += (a[k] + b[k] + c[k]) / 3 * len;
    faceC[f][3] += len;
  }
  // box projection: each flat face takes the panel it looks at most; components within 1e-4 are a tie, which the
  // sprite's own side wins. Decided per face, not per triangle, and with a margin: at a 45° tie, rounding let the two
  // triangles of one face pick different panels, a small wedge of another picture in the face.
  const sideBit = SIDE_CODES.indexOf(side);
  const panel = faceN.map((fn, f) => {
    const n = (facing && faceC[f][3] > 0 && facing(faceC[f].slice(0, 3).map(v => v / faceC[f][3]))) || fn;
    let best = -1, bestScore = -Infinity;
    const len = Math.hypot(n[0], n[1], n[2]) || 1;
    for (let k = 0; k < 3; k++) {
      const bit = SIDE_CODES.indexOf(FACING_PANEL[k][n[k] >= 0 ? 0 : 1]), score = Math.abs(n[k]) / len;
      if (score > bestScore + 1e-4 || (score > bestScore - 1e-4 && bit === sideBit)) { bestScore = Math.max(score, bestScore); best = bit; }
    }
    return best;
  });
  const pos: number[] = [], nor: number[] = [], pan: number[] = [], idx: number[] = [];
  // vertices are shared by triangles of the same flat face only
  const shared = new Map<string, number>();
  for (let t = 0; t < nt; t++) for (let c = 0; c < 3; c++) {
    const key = tv[t * 3 + c] + '|' + faceOf[t];
    let i = shared.get(key);
    if (i === undefined) {
      const p = at(tv[t * 3 + c]);
      i = pos.length / 3;
      shared.set(key, i);
      pos.push(p[0], p[1], p[2]); nor.push(tn[t * 3], tn[t * 3 + 1], tn[t * 3 + 2]); pan.push(panel[faceOf[t]]);
      for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p[k]); hi[k] = Math.max(hi[k], p[k]); }
    }
    idx.push(i);
  }
  return { positions: new Float32Array(pos), normals: new Float32Array(nor), indices: new Uint32Array(idx), panel: new Uint8Array(pan), triangles: idx.length / 3, lo, hi };
}

/** The panel a face pointing along +axis / −axis looks at. */
const FACING_PANEL: SideCode[][] = [['R', 'L'], ['T', 'Bt'], ['F', 'Bk']];

// ------------------------------------------------------------------ texture atlas (DESIGN.md §7)

export interface TexturedMesh extends MeshData {
  /** Texture coordinates per vertex, origin at the atlas's top left (glTF convention). */
  uvs: Float32Array;
  atlas: RGBAImage;
  /** Where each crop went in the atlas: [x, y, w, h] without padding, and the crop's panel pixel origin. Keyed by
      panel; a panel's second crop, for faces that stand in front of others on the same lines, by the panel and `+`. */
  rects: Record<string, { x: number; y: number; w: number; h: number; px: number; py: number }>;
}

/** A panel painted from the voxels, with, per pixel, whether its line meets the model and how far from the viewer
    the voxel it took is (the voxel spans [at, at + 1] along the line of sight). */
interface Painted { colours: Uint32Array; hit: Uint8Array; at: Float32Array }

/** What a panel sees of the voxel model, coloured by `colourOf` (a surface colour rule, voxel.ts): every pixel the
    colour of the first voxel on its line through the cube; pixels whose line misses the model take the nearest pixel
    that hits it. Only the pixels in `crop` ([x0, y0, x1, y1), default the whole panel) are filled in. With `depth`
    (per pixel, how far from the viewer the mesh's surface is, `faceDepth`), voxels lying wholly more than `BEHIND` in
    front of the surface are passed over: the mesh has rounded them away, and the face behind them would show their
    colour. 0xRRGGBB. */
export function voxelPanel(m: VoxelModel, p: SideCode, colourOf: (x: number, y: number, z: number) => number, crop: [number, number, number, number] = [0, 0, m.n, m.n], depth?: Float32Array): Uint32Array {
  return paintPanel(m, p, colourOf, crop, depth).colours;
}

/** `voxelPanel`, with what it found. With `nearer`, `depth` is a layer of faces standing in front of others on the
    same lines: a pixel whose voxel lies well behind them (more than `SLIVER`) takes the nearest pixel whose voxel is
    at their depth instead. */
function paintPanel(m: VoxelModel, p: SideCode, colourOf: (x: number, y: number, z: number) => number, crop: [number, number, number, number], depth?: Float32Array, nearer = false): Painted {
  const n = m.n, nn = n * n, colours = new Uint32Array(nn), hit = new Uint8Array(nn), at = new Float32Array(nn), stride = [1, n, nn];
  const [k, fromHigh] = VIEW[p].look, [a, b] = k === 0 ? [1, 2] : k === 1 ? [0, 2] : [0, 1], c = [0, 0, 0];
  const open = (i: number) => {
    const x = i % n, y = ((i - x) / n) % n, z = Math.floor(i / nn), q = [x, y, z];
    for (let e = 0; e < 3; e++) for (const d of [-1, 1]) { const w = q[e] + d; if (w < 0 || w >= n || !m.solid[i + d * stride[e]]) return true; }
    return false;
  };
  for (let cb = 0; cb < n; cb++) for (let ca = 0; ca < n; ca++) {
    const px = m.pix[p][cb * n + ca], py = (px / n) | 0;
    if (px % n < crop[0] || px % n >= crop[2] || py < crop[1] || py >= crop[3]) continue;
    c[a] = ca; c[b] = cb;
    // the first voxel on the line that reaches to within BEHIND of the surface, else the first on the line
    const from = depth ? depth[px] - BEHIND : -Infinity;
    let first = -1, pick = -1;
    for (let s = 0; s < n && pick < 0; s++) {
      const i = ca * stride[a] + cb * stride[b] + (fromHigh ? n - 1 - s : s) * stride[k];
      if (!m.solid[i]) continue;
      if (first < 0) first = s;
      // only a voxel on the surface (one with an open side) has a surface colour
      if (s + 1 > from && (s === first || open(i))) pick = s;
    }
    if (first < 0) continue;
    if (pick < 0) pick = first;
    c[k] = fromHigh ? n - 1 - pick : pick;
    colours[px] = colourOf(c[0], c[1], c[2]); hit[px] = 1; at[px] = pick;
  }
  const own = colours.slice();
  for (let y = crop[1]; y < crop[3]; y++) for (let x = crop[0]; x < crop[2]; x++) {
    const i = y * n + x;
    if (nearer && depth && hit[i] && at[i] > depth[i] + SLIVER) {
      const j = nearestHit(hit, n, x, y, j => Math.abs(at[j] - depth[i]) <= 1);
      if (j >= 0) colours[i] = own[j];
      continue;
    }
    if (hit[i]) continue;
    const j = nearestHit(hit, n, x, y);
    colours[i] = j >= 0 ? own[j] : 0x808080;
  }
  return { colours, hit, at };
}

/** How far behind something a surface must lie to count as hidden from a panel (voxels): a voxel wholly in front of
    the mesh's surface by more is passed over, and a face behind another face of its panel by more moves panel. The
    mesh's straightened edges and chamfers cut at most about a voxel into the model, so they never reach it. */
const BEHIND = 1.5;

/** How far a face must stand in front of the face of its panel beside it, where their outlines meet, to get a crop of
    its own (voxels); neighbouring faces of one surface meet at the same depth. Also how far behind such a face a
    pixel's voxel must start for its own crop to paint that pixel from a voxel at its depth. */
const SLIVER = .75;

/** A triangle on panel `p` as panel pixel coordinates and distance from the viewer along the line of sight. */
function onPanel(mesh: MeshData, t: number, p: SideCode, n: number): number[][] {
  const [k, fromHigh] = VIEW[p].look, P = mesh.positions, I = mesh.indices;
  return [0, 1, 2].map(c => {
    const i = I[t + c], [u, v] = panelXY(p, P[i * 3], P[i * 3 + 1], P[i * 3 + 2], n);
    return [u, v, fromHigh ? n - P[i * 3 + k] : P[i * 3 + k]];
  });
}

/** Calls `visit` for every panel pixel a triangle (from `onPanel`) touches: with its distance at the pixel's middle
    when it covers the middle, otherwise at its point nearest the middle. Edge-on triangles touch nothing. */
function eachPixel(q: number[][], n: number, visit: (i: number, d: number, middle: boolean, u: number, v: number) => void) {
  const area = (q[1][0] - q[0][0]) * (q[2][1] - q[0][1]) - (q[2][0] - q[0][0]) * (q[1][1] - q[0][1]);
  if (Math.abs(area) < 1e-9) return;
  const x0 = Math.max(0, Math.floor(Math.min(q[0][0], q[1][0], q[2][0]) - .5)), x1 = Math.min(n - 1, Math.floor(Math.max(q[0][0], q[1][0], q[2][0]) + .5));
  const y0 = Math.max(0, Math.floor(Math.min(q[0][1], q[1][1], q[2][1]) - .5)), y1 = Math.min(n - 1, Math.floor(Math.max(q[0][1], q[1][1], q[2][1]) + .5));
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const cx = x + .5, cy = y + .5, i = y * n + x;
    const w1 = ((cx - q[0][0]) * (q[2][1] - q[0][1]) - (cy - q[0][1]) * (q[2][0] - q[0][0])) / area;
    const w2 = ((q[1][0] - q[0][0]) * (cy - q[0][1]) - (q[1][1] - q[0][1]) * (cx - q[0][0])) / area, w0 = 1 - w1 - w2;
    if (w0 >= 0 && w1 >= 0 && w2 >= 0) { visit(i, w0 * q[0][2] + w1 * q[1][2] + w2 * q[2][2], true, cx, cy); continue; }
    // the nearest point on the triangle's edges; it touches the pixel if it lies inside the pixel
    let best = Infinity, d = 0, pu = 0, pv = 0;
    for (let e = 0; e < 3; e++) {
      const A = q[e], B = q[(e + 1) % 3], ex = B[0] - A[0], ey = B[1] - A[1];
      const s = Math.max(0, Math.min(1, ((cx - A[0]) * ex + (cy - A[1]) * ey) / (ex * ex + ey * ey || 1)));
      const dist = Math.max(Math.abs(A[0] + ex * s - cx), Math.abs(A[1] + ey * s - cy));
      if (dist < best) { best = dist; d = A[2] + (B[2] - A[2]) * s; pu = A[0] + ex * s; pv = A[1] + ey * s; }
    }
    if (best < .5) visit(i, d, false, pu, pv);
  }
}

/** Per pixel of panel `p`, how far from the viewer (along the panel's line of sight, in voxels) the nearest of the
    triangles `on` it is: at the pixel's middle, or where none covers the middle, at the nearest one touching the pixel
    (only with `partly`); −Infinity where none touches it. And per pixel, the nearest of them touching it at all. */
function faceDepth(mesh: MeshData, p: SideCode, n: number, on: (t: number) => boolean, partly = true): [Float32Array, Float32Array, Int32Array] {
  const middle = new Float32Array(n * n).fill(Infinity), touch = new Float32Array(n * n).fill(Infinity), which = new Int32Array(n * n).fill(-1);
  for (let t = 0; t < mesh.indices.length; t += 3) {
    if (!on(t)) continue;
    eachPixel(onPanel(mesh, t, p, n), n, (i, d, mid) => {
      if (mid && d < middle[i]) { middle[i] = d; which[i] = t; }
      if (mid || partly) touch[i] = Math.min(touch[i], d);
    });
  }
  const depth = middle.map((d, i) => d < Infinity ? d : touch[i] < Infinity ? touch[i] : -Infinity);
  return [depth, touch, which];
}

/** The distance from the viewer of the plane of a triangle (from `onPanel`) at panel point (u, v), inside or not. */
function planeAt(q: number[][], u: number, v: number): number {
  const area = (q[1][0] - q[0][0]) * (q[2][1] - q[0][1]) - (q[2][0] - q[0][0]) * (q[1][1] - q[0][1]);
  const w1 = ((u - q[0][0]) * (q[2][1] - q[0][1]) - (v - q[0][1]) * (q[2][0] - q[0][0])) / area;
  const w2 = ((q[1][0] - q[0][0]) * (v - q[0][1]) - (q[1][1] - q[0][1]) * (u - q[0][0])) / area;
  return (1 - w1 - w2) * q[0][2] + w1 * q[1][2] + w2 * q[2][2];
}

/** The nearest pixel with `hit` set (and passing `ok`) to (x, y) by straight-line distance, or −1 if there is none.
    Not `nearestSolid`'s 8-connected steps: they count a diagonal neighbour as near as the one beside it, so a pixel
    beside a bottle's neck and diagonally below its 1px cap took the cap's red (user report after session 6). */
function nearestHit(hit: Uint8Array, n: number, x: number, y: number, ok?: (j: number) => boolean): number {
  let best = Infinity, at = -1;
  // square rings of growing size: a hit on ring r is at least r away, so stop once r² reaches the best found
  for (let r = 1; r < n && r * r < best; r++) for (let dy = -r; dy <= r; dy++) {
    const step = Math.abs(dy) === r ? 1 : 2 * r;
    for (let dx = -r; dx <= r; dx += step) {
      const xx = x + dx, yy = y + dy, d = dx * dx + dy * dy;
      if (xx < 0 || yy < 0 || xx >= n || yy >= n || d >= best || !hit[yy * n + xx] || (ok && !ok(yy * n + xx))) continue;
      best = d; at = yy * n + xx;
    }
  }
  return at;
}

/** Continuous panel pixel coordinates of a cube point (the inverse of how a voxel lands on a panel). */
function panelXY(p: SideCode, x: number, y: number, z: number, n: number): [number, number] {
  const v = VIEW[p], c = [x, y, z];
  return [v.px[1] ? n - c[v.px[0]] : c[v.px[0]], v.py[1] ? n - c[v.py[0]] : c[v.py[0]]];
}

/** The flat faces: the triangle starts of each, found through shared vertices (vertices are shared within one flat
    face only). */
function flatFaces(mesh: MeshData): number[][] {
  const I = mesh.indices, root = Int32Array.from({ length: mesh.positions.length / 3 }, (_, i) => i);
  const find = (i: number): number => { while (root[i] !== i) i = root[i] = root[root[i]]; return i; };
  for (let t = 0; t < I.length; t += 3) { root[find(I[t + 1])] = find(I[t]); root[find(I[t + 2])] = find(I[t]); }
  const faces = new Map<number, number[]>();
  for (let t = 0; t < I.length; t += 3) { const r = find(I[t]); if (!faces.has(r)) faces.set(r, []); faces.get(r)!.push(t); }
  return [...faces.values()];
}

/** Adds box-projected texture coordinates and the packed atlas, painted from the voxel model's surface colours
    (DESIGN.md §7). */
export function textureMesh(mesh: MeshData, m: VoxelModel, read: SheetRead, fallback: FallbackCode): TexturedMesh {
  const rule = surfaceColourRule(m, read, m.side, fallback), I = mesh.indices;
  const n = m.n, faces = flatFaces(mesh), panel = mesh.panel, used = new Set<number>(panel);
  // 1 for the vertices of faces that get their panel's second crop
  const front = new Uint8Array(panel.length);
  // the input side's faces show exactly the colours the voxels have (the drawing, where it sees them); the other faces
  // show the input side's paint only where the surface faces it at least MESH_FACING
  const colourOf = (p: SideCode) => { const minFacing = p === m.side ? -Infinity : MESH_FACING; return (x: number, y: number, z: number) => rule.colourOf(x, y, z, minFacing); };
  const box = (p: SideCode, lo: ArrayLike<number>, hi: ArrayLike<number>): [number, number, number, number] => {
    const a = panelXY(p, lo[0], lo[1], lo[2], n), b = panelXY(p, hi[0], hi[1], hi[2], n);
    const px = Math.max(0, Math.floor(Math.min(a[0], b[0]) + 1e-6)), py = Math.max(0, Math.floor(Math.min(a[1], b[1]) + 1e-6));
    const qx = Math.min(n, Math.ceil(Math.max(a[0], b[0]) - 1e-6)), qy = Math.min(n, Math.ceil(Math.max(a[1], b[1]) - 1e-6));
    return [px, py, Math.max(px + 1, qx), Math.max(py + 1, qy)];
  };
  const crops: { key: string; px: number; py: number; w: number; h: number; x: number; y: number; colours: Uint32Array }[] = [];
  for (const bit of [...used].sort()) {
    const p = SIDE_CODES[bit], on = (t: number) => panel[I[t]] === bit, crop = box(p, mesh.lo, mesh.hi);
    // A face standing in front of another face of the panel on the same lines gets a crop of its own, painted for
    // its depth: they share those pixels, and the pixels are painted for the face covering their middles. A
    // spotlight's lens, rounded at 45° across the corner pixel of the green ring one voxel behind it, showed that
    // pixel's green as small triangles on the lens (user report after session 6). A face stands in front where it
    // only partly covers a pixel whose middle is covered by another face lying, at the point where this face's outline
    // crosses the pixel, well behind it: the two meet across a step, not along an edge they share.
    const [depth, , which] = faceDepth(mesh, p, n, on);
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const tris of faces) {
      if (!on(tris[0])) continue;
      let stands = false;
      for (const t of tris) eachPixel(onPanel(mesh, t, p, n), n, (i, d, mid, u, v) => {
        if (!mid && which[i] >= 0 && !tris.includes(which[i]) && planeAt(onPanel(mesh, which[i], p, n), u, v) > d + SLIVER) stands = true;
      });
      if (!stands) continue;
      for (const t of tris) for (let c = 0; c < 3; c++) {
        const v = I[t + c]; front[v] = 1;
        for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], mesh.positions[v * 3 + k]); hi[k] = Math.max(hi[k], mesh.positions[v * 3 + k]); }
      }
    }
    const behind = (t: number) => on(t) && !front[I[t]], inFront = (t: number) => on(t) && front[I[t]] === 1;
    const rest = paintPanel(m, p, colourOf(p), crop, lo[0] < Infinity ? faceDepth(mesh, p, n, behind)[0] : depth);
    crops.push({ key: p, px: crop[0], py: crop[1], w: crop[2] - crop[0], h: crop[3] - crop[1], x: 0, y: 0, colours: rest.colours });
    if (lo[0] < Infinity) {
      const c2 = box(p, lo, hi);
      crops.push({ key: p + '+', px: c2[0], py: c2[1], w: c2[2] - c2[0], h: c2[3] - c2[1], x: 0, y: 0, colours: paintPanel(m, p, colourOf(p), c2, faceDepth(mesh, p, n, inFront)[1], true).colours });
    }
  }
  const [W, H] = pack(crops);
  const data = new Uint8Array(W * H * 4);
  const rects: TexturedMesh['rects'] = {};
  for (const c of crops) {
    // the crop plus a 1px border repeating its edge pixels, so a seam never samples a neighbour
    for (let y = -1; y <= c.h; y++) for (let x = -1; x <= c.w; x++) {
      const sx = Math.min(n - 1, Math.max(0, c.px + Math.min(c.w - 1, Math.max(0, x)))), sy = Math.min(n - 1, Math.max(0, c.py + Math.min(c.h - 1, Math.max(0, y))));
      const col = c.colours[sy * n + sx], o = ((c.y + y) * W + c.x + x) * 4;
      data[o] = col >> 16; data[o + 1] = (col >> 8) & 255; data[o + 2] = col & 255; data[o + 3] = 255;
    }
    rects[c.key] = { x: c.x, y: c.y, w: c.w, h: c.h, px: c.px, py: c.py };
  }
  const uvs = new Float32Array(mesh.positions.length / 3 * 2);
  for (let i = 0; i < uvs.length / 2; i++) {
    const p = SIDE_CODES[panel[i]], r = rects[front[i] ? p + '+' : p];
    const [u, v] = panelXY(p, mesh.positions[i * 3], mesh.positions[i * 3 + 1], mesh.positions[i * 3 + 2], n);
    uvs[i * 2] = (r.x + u - r.px) / W;
    uvs[i * 2 + 1] = (r.y + v - r.py) / H;
  }
  return { ...mesh, panel, uvs, atlas: { width: W, height: H, data }, rects };
}

/** Shelf-packs the crops (with 1px padding all round) into the smallest power-of-two texture, setting x and y. */
function pack(crops: { w: number; h: number; x: number; y: number }[]): [number, number] {
  const order = [...crops].sort((a, b) => b.h - a.h || b.w - a.w);
  let best: [number, number, number[][]] | null = null;
  for (let W = 4; W <= 2048; W *= 2) {
    if (order.some(c => c.w + 2 > W)) continue;
    let x = 0, y = 0, rowH = 0;
    const at: number[][] = [];
    for (const c of order) {
      if (x + c.w + 2 > W) { x = 0; y += rowH; rowH = 0; }
      at.push([x + 1, y + 1]);
      x += c.w + 2; rowH = Math.max(rowH, c.h + 2);
    }
    let H = 4;
    while (H < y + rowH) H *= 2;
    // smallest area, then the squarer one
    if (!best || W * H < best[0] * best[1] || (W * H === best[0] * best[1] && Math.abs(W - H) < Math.abs(best[0] - best[1]))) best = [W, H, at];
  }
  const [W, H, at] = best!;
  order.forEach((c, i) => { c.x = at[i][0]; c.y = at[i][1]; });
  return [W, H];
}
