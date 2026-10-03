/* Cross-section shapes on a voxel grid (DESIGN.md §3 and §6, "per-slice meaning").
   Along a shape's axis the grid is cut into slices. In each slice, every connected piece (8-connected, so pixel-art
   diagonals hold together) gets the shape's cross-section fitted to its own bounding box, and voxels outside it are
   removed. Nothing is ever added, so the result always stays inside what was there before.
   Phase 1 uses this to shape the inferred panels; Phase 2 (session 3) applies the same cuts to the visual hull.
   Tubes and diamonds can also have shaped ends (session 4b): the Egg or Gem cut, kept to one radius from an end.
   Egg and Gem, and a ⊙ tube's shaped ends, aren't cuts but follow each pixel's distance from the outline (`inflate`,
   session 7c). */

import type { EndsCode, ShapeCode } from './types';

/** A box of voxels, 1 byte each (0 = empty). Index = (z · ny + y) · nx + x. */
export interface Grid3 { nx: number; ny: number; nz: number; data: Uint8Array }

export const grid3 = (nx: number, ny: number, nz: number): Grid3 => ({ nx, ny, nz, data: new Uint8Array(nx * ny * nz) });

/** Shape axes are measured on the sprite as drawn: W = its width ↔, H = its height ↕, T = its thickness ⊙. */
export type SpriteAxis = 'W' | 'H' | 'T';
export type CutKind = 'round' | 'diamond' | 'soft';
export interface Cut { kind: CutKind; axis: SpriteAxis }

/** The cuts each shape makes. The all-round shapes (soft box, egg, gem) are the W cut and the H cut together:
    they round everything a flat sprite can't show, but never cut into the sprite's own outline. Only the ⊙ shapes
    cut in the picture plane itself, because that is where their cross-section lies. */
export function shapeCuts(shape: ShapeCode): Cut[] {
  switch (shape) {
    case 'cyW': return [{ kind: 'round', axis: 'W' }];
    case 'cyH': return [{ kind: 'round', axis: 'H' }];
    case 'cyT': return [{ kind: 'round', axis: 'T' }];
    case 'diW': return [{ kind: 'diamond', axis: 'W' }];
    case 'diH': return [{ kind: 'diamond', axis: 'H' }];
    case 'diT': return [{ kind: 'diamond', axis: 'T' }];
    case 'rbox': return [{ kind: 'soft', axis: 'W' }, { kind: 'soft', axis: 'H' }];
    case 'ell': return [{ kind: 'round', axis: 'W' }, { kind: 'round', axis: 'H' }];
    case 'dpy': return [{ kind: 'diamond', axis: 'W' }, { kind: 'diamond', axis: 'H' }];
    default: return [];
  }
}

/** True when the shape cuts into the picture plane (the ⊙ shapes), so the sprite's own outline can change. */
export const cutsSpritePlane = (shape: ShapeCode) => shapeCuts(shape).some(c => c.axis === 'T');

/** Tube and Diamond are the shapes with ends to shape (DESIGN.md §3, "Ends for Tube and Diamond"). */
export const hasEnds = (shape: ShapeCode) => /^(cy|di)/.test(shape);

/** One cut of shaped ends: slices across `axis`, each piece rounded (or pointed) only within one radius of its ends
    along `along`, at the first end (low sprite coordinate: left, top, front), the last one, or both. */
export interface EndCut { kind: CutKind; axis: SpriteAxis; along: SpriteAxis; first: boolean; last: boolean }

/** The cuts a Tube's or Diamond's shaped ends make: the Egg cut (Tube) or the Gem cut (Diamond) across the axis,
    kept to the ends. They are the cuts of the other sprite axes, whose slices hold the tube's axis; the picture
    plane is never cut, so the sprite's outline stays, as with Egg and Gem. A ↔ tube gets the ↕ cut and a ↕ tube the
    ↔ cut. A ⊙ tube, whose ends the drawing can't show at all, gets one entry across and along ⊙: its ends aren't
    a cut but the Egg or Gem rule kept to the ends (`inflate`), so they follow the drawing's outline. */
export function endCuts(shape: ShapeCode, ends: EndsCode): EndCut[] {
  if (!hasEnds(shape) || ends === 'flat') return [];
  const [own] = shapeCuts(shape), first = ends !== 'cL', last = ends !== 'cF';
  const across: SpriteAxis = own.axis === 'W' ? 'H' : own.axis === 'H' ? 'W' : 'T';
  return [{ kind: own.kind, axis: across, along: own.axis, first, last }];
}

/** Shaped ends as a fit on a grid: the grid axis the ends lie along, and whether its low and high ends are shaped. */
export interface EndsFit { axis: 0 | 1 | 2; lo: boolean; hi: boolean }

/** How far a point is into a shaped end, 0–1 (0 = outside every cap), for a piece spanning [s0, s1) along the
    axis whose half-size across is `hq`. A cap is one radius long (the half-size across), or shorter when the piece
    is: then the caps of both ends meet in the middle and the piece becomes one ellipse or diamond. */
export function capDepth(sc: number, s0: number, s1: number, hq: number, lo: boolean, hi: boolean): number {
  const r = Math.min(hq, lo && hi ? (s1 - s0) / 2 : s1 - s0);
  if (hi && sc > s1 - r) return (sc - (s1 - r)) / r;
  if (lo && sc < s0 + r) return (s0 + r - sc) / r;
  return 0;
}

/** Is a pixel centre at (a, b), measured from the piece's centre in half-sizes (−1…1), inside the cross-section?
    Pixel centres are tested, so a 4 × 4 circle loses its corners but a 2 × 2 or 3 × 3 one stays square. */
function inside(kind: CutKind, a: number, b: number) {
  const eps = 1e-9;
  if (kind === 'round') return a * a + b * b <= 1 + eps;
  if (kind === 'diamond') return Math.abs(a) + Math.abs(b) <= 1 + eps;
  const a2 = a * a, b2 = b * b;
  return a2 * a2 + b2 * b2 <= 1 + eps;
}

/** Optional depth profile for a cut: along grid axis `axis`, a piece is at most `scale` times as deep as it is wide
    in the slice's other direction (see `applyShape`). */
export interface DepthProfile { axis: 0 | 1 | 2; scale: number }

/** The middle part of [lo, hi] that is at most `depth` long, in whole voxels. The length keeps the parity of the
    full range so the part sits exactly in the middle; that way Phase 2, fitting to the bounding box of what Phase 1
    kept, finds the very same box. */
function profiled(lo: number, hi: number, depth: number): [number, number] {
  const full = hi - lo + 1, shortest = full % 2 ? 1 : 2;
  let len = Math.min(full, Math.max(shortest, Math.round(depth)));
  if ((full - len) % 2) {
    // one voxel more or less, whichever is closer to the wanted depth and still fits
    const up = len + 1, down = len - 1;
    len = up > full || (down >= shortest && depth - down <= up - depth) ? down : up;
  }
  const start = lo + (full - len) / 2;
  return [start, start + len - 1];
}

/** Applies one cut along grid axis `axis` (0 = x, 1 = y, 2 = z) and returns the new voxel data. With `ends`, the
    cross-section only shapes the pieces' ends along `ends.axis` (one of the slice's two axes); the rest of each piece
    keeps its box. */
export function cutSlices(g: Grid3, axis: 0 | 1 | 2, kind: CutKind, profile?: DepthProfile, ends?: EndsFit, keepLines = true): Uint8Array {
  const dims = [g.nx, g.ny, g.nz];
  const [pa, pb] = axis === 0 ? [1, 2] : axis === 1 ? [0, 2] : [0, 1];
  const na = dims[pa], nb = dims[pb], ns = dims[axis];
  const strides = [1, g.nx, g.nx * g.ny];
  const out = new Uint8Array(g.data.length);
  const label = new Int32Array(na * nb), stack = new Int32Array(na * nb);
  const members = new Int32Array(na * nb);
  for (let s = 0; s < ns; s++) {
    const base = s * strides[axis], at = (a: number, b: number) => base + a * strides[pa] + b * strides[pb];
    label.fill(0);
    let next = 0;
    for (let b0 = 0; b0 < nb; b0++) for (let a0 = 0; a0 < na; a0++) {
      if (label[b0 * na + a0] || !g.data[at(a0, b0)]) continue;
      // flood one 8-connected piece, remembering its bounding box and cells
      next++;
      let top = 0, count = 0, amin = a0, amax = a0, bmin = b0, bmax = b0;
      stack[top++] = b0 * na + a0; label[b0 * na + a0] = next;
      while (top) {
        const k = stack[--top], a = k % na, b = (k - a) / na;
        members[count++] = k;
        if (a < amin) amin = a; if (a > amax) amax = a; if (b < bmin) bmin = b; if (b > bmax) bmax = b;
        for (let db = -1; db <= 1; db++) for (let da = -1; da <= 1; da++) {
          const aa = a + da, bb = b + db;
          if (aa < 0 || bb < 0 || aa >= na || bb >= nb) continue;
          const kk = bb * na + aa;
          if (label[kk] || !g.data[at(aa, bb)]) continue;
          label[kk] = next; stack[top++] = kk;
        }
      }
      // the box the cross-section is fitted to: the piece's bounding box, or less deep along a depth profile
      let fa0 = amin, fa1 = amax, fb0 = bmin, fb1 = bmax;
      if (profile?.axis === pa) [fa0, fa1] = profiled(amin, amax, (bmax - bmin + 1) * profile.scale);
      if (profile?.axis === pb) [fb0, fb1] = profiled(bmin, bmax, (amax - amin + 1) * profile.scale);
      const ca = (fa0 + fa1 + 1) / 2, cb = (fb0 + fb1 + 1) / 2, ha = (fa1 - fa0 + 1) / 2, hb = (fb1 - fb0 + 1) / 2;
      const alongA = ends?.axis === pa;
      const keeps = (a: number, b: number) => {
        if (!ends) return inside(kind, (a + .5 - ca) / ha, (b + .5 - cb) / hb);
        // shaped ends: how far into a cap along the axis, against the offset across it
        return alongA ? inside(kind, capDepth(a + .5, fa0, fa1 + 1, hb, ends.lo, ends.hi), (b + .5 - cb) / hb)
          : inside(kind, (a + .5 - ca) / ha, capDepth(b + .5, fb0, fb1 + 1, ha, ends.lo, ends.hi));
      };
      let kept = 0;
      for (let i = 0; i < count; i++) {
        const k = members[i], a = k % na, b = (k - a) / na;
        if (keeps(a, b)) { out[at(a, b)] = g.data[at(a, b)]; kept++; }
      }
      // A cut never empties a line: every row and column of the fitted box that lost all its voxels keeps the one
      // or two nearest the middle. So the piece keeps its full size in both directions (a diamond keeps its tips,
      // a long thin tube its ends, a drawn sprite its outline), and cutting a second time changes nothing, which is
      // what lets Phase 2 apply the shape again to a Phase 1 model without cutting off its paint.
      // A ⊙ cut (`keepLines` off) is the exception: it is meant to change the outline, and keeping one pixel in each
      // emptied row or column left loose pixels, rods through the whole thickness, wherever the drawing doesn't fill
      // the fitted box (the corners of a triangle's base, session 8). It only keeps them when nothing else is left.
      if (kept < count && (keepLines || !kept)) {
        const la = fa1 - fa0 + 1, lb = fb1 - fb0 + 1;
        const hasA = new Uint8Array(la), hasB = new Uint8Array(lb);
        const nearA = new Float64Array(la).fill(Infinity), nearB = new Float64Array(lb).fill(Infinity);
        for (let i = 0; i < count; i++) {
          const k = members[i], a = k % na, b = (k - a) / na, on = out[at(a, b)] !== 0;
          if (a >= fa0 && a <= fa1) { if (on) hasA[a - fa0] = 1; else nearA[a - fa0] = Math.min(nearA[a - fa0], Math.abs(b + .5 - cb)); }
          if (b >= fb0 && b <= fb1) { if (on) hasB[b - fb0] = 1; else nearB[b - fb0] = Math.min(nearB[b - fb0], Math.abs(a + .5 - ca)); }
        }
        for (let i = 0; i < count; i++) {
          const k = members[i], a = k % na, b = (k - a) / na;
          const keepA = a >= fa0 && a <= fa1 && !hasA[a - fa0] && Math.abs(b + .5 - cb) <= nearA[a - fa0] + 1e-9;
          const keepB = b >= fb0 && b <= fb1 && !hasB[b - fb0] && Math.abs(a + .5 - ca) <= nearB[b - fb0] + 1e-9;
          if (keepA || keepB) out[at(a, b)] = g.data[at(a, b)];
        }
      }
    }
  }
  return out;
}

/** Applies a shape's cuts to a grid. `axes` says which grid axis is the sprite's width, height and thickness.
    Several cuts are each made on the original grid and then combined, so their order doesn't matter.

    `depthScale` is for Phase 1, where the model is still a plain extrusion and every piece is as deep as the whole
    thickness. With it, the round and diamond cuts make each piece's depth follow its drawn size instead: at most
    `depthScale[axis]` times its size in the picture. Phase 1 passes thickness ÷ the largest piece, so the widest part
    of the drawing gets the full thickness and narrower parts taper with it, like a real tube or ball. (A circle drawn
    with thickness = width becomes a sphere.) The soft box keeps its full thickness: it only rounds edges. Phase 2
    doesn't need this, because the painted panels already carry the depth of every piece. */
export function applyShape(g: Grid3, shape: ShapeCode, axes: Record<SpriteAxis, 0 | 1 | 2>, depthScale?: Partial<Record<SpriteAxis, number>>): Grid3 {
  if (shape === 'ell' || shape === 'dpy') return inflate(g, shape === 'ell' ? 'round' : 'diamond', axes.T);
  const cuts = shapeCuts(shape);
  if (!cuts.length) return g;
  const results = cuts.map(c => {
    const scale = c.kind === 'soft' ? undefined : depthScale?.[c.axis];
    return cutSlices(g, axes[c.axis], c.kind, scale ? { axis: axes.T, scale } : undefined, undefined, c.axis !== 'T');
  });
  const data = results[0];
  for (const r of results.slice(1)) for (let i = 0; i < data.length; i++) data[i] = data[i] && r[i];
  return { ...g, data };
}

/** Squared distance from every cell of a w × h mask to the nearest empty cell (outside the mask counts as empty),
    exact, two passes of the 1D lower-envelope transform. */
function emptyDistance2(mask: Uint8Array, w: number, h: number): Float64Array {
  const INF = 1e20, out = new Float64Array(w * h), n = Math.max(w, h) + 2;
  const f = new Float64Array(n), d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
  const pass = (len: number) => { // f[0..len) → d[0..len)
    let k = 0; v[0] = 0; z[0] = -INF; z[1] = INF;
    for (let q = 1; q < len; q++) {
      let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
      k++; v[k] = q; z[k] = s; z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < len; q++) { while (z[k + 1] < q) k++; d[q] = (q - v[k]) * (q - v[k]) + f[v[k]]; }
  };
  // columns, padded with an empty cell at each end
  for (let x = 0; x < w; x++) {
    f[0] = 0; f[h + 1] = 0;
    for (let y = 0; y < h; y++) f[y + 1] = mask[y * w + x] ? INF : 0;
    pass(h + 2);
    for (let y = 0; y < h; y++) out[y * w + x] = d[y + 1];
  }
  for (let y = 0; y < h; y++) {
    f[0] = 0; f[w + 1] = 0;
    for (let x = 0; x < w; x++) f[x + 1] = Math.min(out[y * w + x], INF);
    pass(w + 2);
    for (let x = 0; x < w; x++) out[y * w + x] = d[x + 1];
  }
  return out;
}

/** Egg and Gem (session 8): the drawing inflated by its distance from the outline. Seen along the thickness axis `t`,
    every line of the grid keeps a span centred in the model's thickness, as long as the pixel's distance to the
    nearest edge of the drawing allows: the pixel farthest from every edge gets the whole thickness, and the rest
    follow a round profile (Egg: a circle drawn with thickness = width becomes a sphere) or a straight one (Gem: a
    double cone, a pyramid on a square). Narrow parts of the drawing come out thinner, like the cuts' depth scaling,
    and a donut becomes a ring. Phase 2 finds the very same depths from the sheet: the outline is the model seen
    along `t` and the thickness its extent along `t`, both of which the panels show. Span lengths keep the parity of
    the thickness so every span sits exactly in the middle, and a line never loses its last voxel (the edge of the
    drawing keeps its middle one or two). (The two combined cuts this replaces only reached the full thickness where
    a long column met a long row: a triangle as a Gem came out half as thick, and a donut as an Egg grew chunks.)

    With `ends`, the same rule shapes a ⊙ Tube's or Diamond's ends (session 7c): only the ends along `t` that `ends`
    names are rounded or pointed, each by a cap as long as the drawing's radius (its largest distance to the outline),
    at most the thickness, or half of it with both ends shaped; the middle stays a full-thickness extrusion. A circle
    gets a hemisphere, a donut a rounded ring, a triangle a cap that follows its three sides. With one end shaped, the
    outline keeps one voxel at the flat end. (The two combined end cuts this replaces broke a donut's caps into
    spikes, and fitted to the bounding box they gave a rectangle's caps slanted faces.) */
function inflate(g: Grid3, kind: CutKind, t: 0 | 1 | 2, ends?: { lo: boolean; hi: boolean }): Grid3 {
  const dims = [g.nx, g.ny, g.nz], strides = [1, g.nx, g.nx * g.ny];
  const [pa, pb] = t === 0 ? [1, 2] : t === 1 ? [0, 2] : [0, 1];
  const na = dims[pa], nb = dims[pb], nt = dims[t];
  // the model seen along t, and its extent along t
  const mask = new Uint8Array(na * nb);
  let lo = nt, hi = -1;
  for (let b = 0; b < nb; b++) for (let a = 0; a < na; a++) {
    const base = a * strides[pa] + b * strides[pb];
    for (let s = 0; s < nt; s++) if (g.data[base + s * strides[t]]) { mask[b * na + a] = 1; if (s < lo) lo = s; break; }
    for (let s = nt - 1; s >= 0; s--) if (g.data[base + s * strides[t]]) { if (s > hi) hi = s; break; }
  }
  if (hi < 0) return g;
  const full = hi - lo + 1, shortest = full % 2 ? 1 : 2;
  // distance from each pixel centre to the outline (half a pixel short of the nearest empty pixel's centre)
  const d2 = emptyDistance2(mask, na, nb), dist = new Float64Array(na * nb);
  let most = 0;
  for (let i = 0; i < dist.length; i++) if (mask[i]) { dist[i] = Math.sqrt(d2[i]) - .5; most = Math.max(most, dist[i]); }
  // how far each end's cap reaches in: half the thickness from both ends for Egg and Gem
  const cap = ends ? Math.min(most + .5, ends.lo && ends.hi ? full / 2 : full) : full / 2;
  const one = ends && ends.lo !== ends.hi;
  const out = new Uint8Array(g.data.length);
  for (let b = 0; b < nb; b++) for (let a = 0; a < na; a++) {
    const i = b * na + a;
    if (!mask[i]) continue;
    const s = most > 0 ? dist[i] / most : 1, f = kind === 'round' ? Math.sqrt(Math.max(0, 1 - (1 - s) * (1 - s))) : s;
    let start: number, len: number;
    if (one) {
      // one end shaped: cut in from that end only, keeping at least the voxel at the flat end
      const cut = Math.min(full - 1, Math.round(cap * (1 - f)));
      start = ends!.lo ? lo + cut : lo; len = full - cut;
    } else {
      // both ends: a span centred in the thickness (Egg and Gem: as long as full × f)
      const want = ends ? full - 2 * cap * (1 - f) : full * f;
      len = Math.min(full, Math.max(shortest, Math.round(want)));
      if ((full - len) % 2) len = len + 1 <= full && (len - 1 < shortest || want - (len - 1) > len + 1 - want) ? len + 1 : len - 1;
      start = lo + (full - len) / 2;
    }
    const base = a * strides[pa] + b * strides[pb];
    for (let s2 = start; s2 < start + len; s2++) { const k = base + s2 * strides[t]; out[k] = g.data[k]; }
  }
  return { ...g, data: out };
}

/** Shapes the ends of a Tube or Diamond (`endCuts`). It is applied after the shape itself, so a cap's radius is the
    tube's real radius there (in Phase 1 the grid is still a full-thickness extrusion before the shape's cut). Several
    cuts are each made on the same grid and combined. `flip` says which sprite axes run reversed in the grid, so the
    first end (left, top, front) is found wherever the side put it. */
export function applyEnds(g: Grid3, shape: ShapeCode, ends: EndsCode, axes: Record<SpriteAxis, 0 | 1 | 2>, flip: Partial<Record<SpriteAxis, boolean>> = {}): Grid3 {
  const cuts = endCuts(shape, ends);
  if (!cuts.length) return g;
  if (cuts[0].along === 'T') {
    const c = cuts[0], rev = !!flip.T;
    return inflate(g, c.kind, axes.T, { lo: rev ? c.last : c.first, hi: rev ? c.first : c.last });
  }
  const results = cuts.map(c => {
    const rev = !!flip[c.along];
    return cutSlices(g, axes[c.axis], c.kind, undefined, { axis: axes[c.along], lo: rev ? c.last : c.first, hi: rev ? c.first : c.last });
  });
  const data = results[0];
  for (const r of results.slice(1)) for (let i = 0; i < data.length; i++) data[i] = data[i] && r[i];
  return { ...g, data };
}
