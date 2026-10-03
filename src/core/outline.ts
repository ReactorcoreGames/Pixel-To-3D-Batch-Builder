/* Pixel outlines to polygons (DESIGN.md §6, "Outline to polygon" and "Ramp straightening").
   A mask's boundary is traced along the pixel edges into closed rings, then pixel staircases are straightened into
   clean diagonal edges with a line-simplification pass (Douglas–Peucker) whose tolerance is the row's
   "Straighten slopes" setting. Only real ramps and curves are straightened: a stretch of outline that steps the
   same way throughout, with even or steadily changing runs (1-1-1, 2-3-2-3, a circle's 1-1-2-3), the way pixel
   artists draw lines. A single step between two flat edges, a bump or a lone corner is a detail, not a ramp, so it
   stays crisp. Just under 1px (the default) straightens 1:1 and 2:1 slopes.

   Coordinates: pixel (i, j) covers [i, i + 1] × [j, j + 1]. Rings go round with the solid on their left, so outer
   rings are counter-clockwise and holes clockwise when j points up; that's what a "positive" fill rule expects. */

export type Ring = [number, number][];

/** Traces the boundary of a w × h mask (index j · w + i) into closed rings along the pixel edges. Pixels that touch
    only at a corner get separate rings, so every ring is simple. Collinear points are left out. */
export function traceMask(mask: ArrayLike<number>, w: number, h: number): Ring[] {
  const on = (i: number, j: number) => i >= 0 && j >= 0 && i < w && j < h && mask[j * w + i] !== 0;
  // directed boundary edges, solid on the left, keyed by their start corner; a corner can start two edges
  const W1 = w + 1, next = new Map<number, number[]>();
  const add = (x0: number, y0: number, x1: number, y1: number) => {
    const k = y0 * W1 + x0, list = next.get(k);
    const e = y1 * W1 + x1;
    if (list) list.push(e); else next.set(k, [e]);
  };
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    if (!on(i, j)) continue;
    if (!on(i, j - 1)) add(i, j, i + 1, j);
    if (!on(i + 1, j)) add(i + 1, j, i + 1, j + 1);
    if (!on(i, j + 1)) add(i + 1, j + 1, i, j + 1);
    if (!on(i - 1, j)) add(i, j + 1, i, j);
  }
  const rings: Ring[] = [];
  const xy = (k: number): [number, number] => [k % W1, Math.floor(k / W1)];
  for (const start of [...next.keys()].sort((a, b) => a - b)) {
    while (next.get(start)?.length) {
      const ring: Ring = [];
      let at = start, prev = -1;
      do {
        const outs = next.get(at)!;
        // at a corner where two pixels touch diagonally, turn left, which keeps the two pixels apart
        let pick = 0;
        if (outs.length > 1 && prev >= 0) {
          const [px, py] = xy(prev), [ax, ay] = xy(at), dx = ax - px, dy = ay - py;
          pick = Math.max(0, outs.findIndex(e => { const [ex, ey] = xy(e); return (ex - ax) * dy - (ey - ay) * dx < 0; }));
        }
        const e = outs.splice(pick, 1)[0];
        if (!outs.length) next.delete(at);
        ring.push(xy(at));
        prev = at; at = e;
      } while (at !== start);
      rings.push(dropCollinear(ring));
    }
  }
  return rings;
}

function dropCollinear(r: Ring): Ring {
  const out: Ring = [];
  for (let i = 0; i < r.length; i++) {
    const a = r[(i + r.length - 1) % r.length], b = r[i], c = r[(i + 1) % r.length];
    if ((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]) !== 0) out.push(b);
  }
  return out;
}

/** Signed area (positive = counter-clockwise with y up). */
export function ringArea(r: Ring): number {
  let s = 0;
  for (let i = 0; i < r.length; i++) { const a = r[i], b = r[(i + 1) % r.length]; s += a[0] * b[1] - b[0] * a[1]; }
  return s / 2;
}

/** Distance from p to the segment a–b. */
function segDist(p: [number, number], a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0], dy = b[1] - a[1], len2 = dx * dx + dy * dy;
  if (!len2) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

/** Are these run lengths those of a drawn line or curve? At least two runs, so a lone corner or a single step
    between two flat edges (a detail, not a ramp) is never cut; the inner runs even or steadily growing or shrinking
    (1-1-1, 2-3-2-3, or a curve's 1-1-2-3); and the runs at the ends, which a line can start or stop partway
    through, at most one longer than the longest inner run. */
export function evenRuns(runs: number[]): boolean {
  if (runs.length < 2) return false;
  if (runs.length === 2) return Math.abs(runs[0] - runs[1]) <= 1;
  const inner = runs.slice(1, -1), hi = Math.max(...inner);
  let up = true, down = true;
  for (let i = 1; i < inner.length; i++) { if (inner[i] < inner[i - 1]) up = false; if (inner[i] > inner[i - 1]) down = false; }
  return (up || down || hi - Math.min(...inner) <= 1) && runs[0] <= hi + 1 && runs[runs.length - 1] <= hi + 1;
}

/** Is the stretch of pixel outline p[a..b] a drawn ramp: it steps the same way throughout (no bumps or zigzags),
    with even runs across and even steps down? */
function isRamp(p: Ring, a: number, b: number): boolean {
  const across: number[] = [], down: number[] = [];
  let sx = 0, sy = 0;
  for (let i = a; i < b; i++) {
    const dx = p[i + 1][0] - p[i][0], dy = p[i + 1][1] - p[i][1];
    if (dx) { if (sx && Math.sign(dx) !== sx) return false; sx = Math.sign(dx); across.push(Math.abs(dx)); }
    if (dy) { if (sy && Math.sign(dy) !== sy) return false; sy = Math.sign(dy); down.push(Math.abs(dy)); }
  }
  return evenRuns(across) && evenRuns(down);
}

/** Douglas–Peucker on an open chain of pixel corners, keeping both ends: a stretch becomes one straight edge when it
    is a ramp and no corner is farther than `tol` from the line; otherwise it's split at its farthest corner. */
function simplifyChain(pts: Ring, tol: number): Ring {
  if (pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    if (b - a < 2) continue;
    // the farthest corner; of corners equally far, the one nearest the middle (both, if two are), so a chain and its
    // mirror image (traced the other way round) split at the same corners
    let fd = -1, far: number[] = [];
    for (let i = a + 1; i < b; i++) { const d = segDist(pts[i], pts[a], pts[b]); if (d > fd + 1e-9) { fd = d; far = [i]; } else if (d > fd - 1e-9) far.push(i); }
    if (fd <= tol && isRamp(pts, a, b)) continue;
    const mid = Math.min(...far.map(i => Math.abs(2 * i - a - b)));
    const split = far.filter(i => Math.abs(2 * i - a - b) === mid);
    split.forEach(i => { keep[i] = 1; });
    [a, ...split, b].forEach((p, j, s) => { if (j) stack.push([s[j - 1], p]); });
  }
  return pts.filter((_, i) => keep[i]);
}

/** Straightens a closed ring's pixel staircases: every corner closer than `tol` to the straight line past it goes.
    The ring is split wherever it turns back, left–right or up–down (at a widest, narrowest, highest or lowest
    point), and each stretch between is straightened on its own. No ramp runs past such a point, so nothing is lost,
    and the splits don't depend on where tracing started or which way round it went: a
    mirrored shape straightens into a mirrored outline. It used to split at the lowest-leftmost corner and the one
    farthest from it, which aren't mirror images, so one side of a lamp shade became a slant and the other kept its
    steps (user report after session 6). A ring that would collapse keeps its original shape. */
export function straighten(ring: Ring, tol: number): Ring {
  if (tol <= 0 || ring.length <= 4) return ring;
  const L = ring.length, split = new Uint8Array(L);
  const d = (i: number, c: 0 | 1) => Math.sign(ring[(i + 1) % L][c] - ring[i % L][c]);
  for (const c of [0, 1] as const) {
    // the edges moving along c, in ring order; where two in a row move opposite ways, the edge between them (at the
    // extreme) goes with the side whose edge next to it is shorter, as a ramp's first step, and the ring splits at its
    // other end; with sides of equal length it stays on its own. Anything else between them splits at every corner
    const moving: number[] = [];
    for (let i = 0; i < L; i++) if (d(i, c)) moving.push(i);
    const len = (i: number) => Math.abs(ring[(i + 1) % L][c] - ring[i][c]);
    moving.forEach((e, j) => {
      const prev = moving[(j + moving.length - 1) % moving.length];
      if (d(prev, c) === d(e, c)) return;
      if ((e - prev + L) % L === 2) {
        if (len(prev) >= len(e)) split[(prev + 1) % L] = 1;
        if (len(e) >= len(prev)) split[e] = 1;
      } else for (let v = prev + 1; ; v++) { split[v % L] = 1; if (v % L === e) break; }
    });
  }
  const s = split.indexOf(1);
  if (s < 0) return ring;
  const r = [...ring.slice(s), ...ring.slice(0, s), ring[s]], at = [...split.slice(s), ...split.slice(0, s), 1];
  const out: Ring = [];
  for (let a = 0; a < L;) {
    let b = a + 1;
    while (!at[b]) b++;
    out.push(...simplifyChain(r.slice(a, b + 1), tol).slice(0, -1));
    a = b;
  }
  const chamfered = chamferCorners(out, tol);
  return chamfered.length >= 3 && Math.abs(ringArea(chamfered)) > 1e-9 ? chamfered : ring;
}

/** Cuts the 1px corner steps of rounded corners into a 45° chamfer: a 1 × 1 step where the outline turns from one
    edge to the next, stepping the same way all along (a rectangle with its corner pixel left out, or a pixel circle's
    diagonal). The ramp rule keeps it as a lone corner, but it is how pixel artists round a corner, and kept square it
    cuts a groove down every diagonal of a round model where the slice prisms' bevel meets it. A 1px tooth or notch
    (the steps go back the way they came) is a detail and stays. Needs a tolerance of at least 0.71px, the distance
    the chamfer moves the outline. */
function chamferCorners(r: Ring, tol: number): Ring {
  if (tol < Math.SQRT1_2 - 1e-9 || r.length < 5) return r;
  const L = r.length, cand = new Uint8Array(L), convex = new Uint8Array(L), drop = new Uint8Array(L);
  const edge = (i: number) => { const a = r[(i + L) % L], b = r[(i + 1 + L) % L]; return [b[0] - a[0], b[1] - a[1]]; };
  for (let i = 0; i < L; i++) {
    // edges into and out of corner i are the 1px step; the ones either side must keep stepping the same way
    const e = [edge(i - 2), edge(i - 1), edge(i), edge(i + 1)];
    const unit = (d: number[]) => Math.abs(d[0]) + Math.abs(d[1]) === 1;
    if (!unit(e[1]) || !unit(e[2]) || e[1][0] * e[2][0] + e[1][1] * e[2][1] !== 0) continue;
    const same = (c: 0 | 1) => { const s = e.map(d => Math.sign(d[c])).filter(Boolean); return s.every(v => v === s[0]); };
    if (same(0) && same(1)) cand[i] = 1;
    // the solid is on the ring's left, so a left turn is an outward corner
    convex[i] = e[1][0] * e[2][1] - e[1][1] * e[2][0] > 0 ? 1 : 0;
  }
  // Never two corners in a row: the cut would move the outline too far. Where two neighbouring corners could go (a
  // double 1px step, like a bottle's shoulder), the outward one goes, which only cuts and is the same corner in a
  // mirror image. Taking the first one met, as this used to, cut the lower corner on one side of a bottle and the
  // upper one on the other, and the mesh got a terrace on one side (user report after session 6).
  for (let i = 0; i < L; i++) {
    if (!cand[i]) continue;
    const prev = cand[(i + L - 1) % L], next = cand[(i + 1) % L];
    if ((!prev && !next) || convex[i]) drop[i] = 1;
  }
  for (let i = 0; i < L; i++) if (drop[i] && drop[(i + 1) % L]) drop[(i + 1) % L] = 0;
  return r.filter((_, i) => !drop[i]);
}

/** The straightened outline of a shape with one run per row, row j covering [lo[j], hi[j]] × [j, j + 1] (next rows
    overlapping). Each side is straightened on its own, both from the first row to the last, so a mirrored shape stays
    mirrored; `straighten` splits a ring at two corners that aren't mirror images, so one side of a light bulb's taper
    could become a slant and the other keep a step. Corners are chamfered as in `straighten`. */
export function rowsOutline(lo: number[], hi: number[], tol: number): Ring {
  const side = (x: number[]) => {
    const pts: Ring = [];
    x.forEach((v, j) => pts.push([v, j], [v, j + 1]));
    const r = pts.filter((p, i) => !i || p[0] !== pts[i - 1][0] || p[1] !== pts[i - 1][1]);
    const chain = r.filter((p, i) => i === 0 || i === r.length - 1 || (p[0] - r[i - 1][0]) * (r[i + 1][1] - p[1]) - (p[1] - r[i - 1][1]) * (r[i + 1][0] - p[0]) !== 0);
    if (tol <= 0) return chain;
    // straightened in stretches that widen or narrow throughout, split where the side turns back (the widest or
    // narrowest point stays), as a closed outline is at its extremes; otherwise a bulb's widening base, followed by
    // its narrowing top, was split in the wrong place and kept every step
    const out: Ring = [chain[0]];
    let from = 0, dir = 0;
    for (let i = 1; i < chain.length; i++) {
      const d = Math.sign(chain[i][0] - chain[i - 1][0]);
      if (d && dir && d !== dir) { out.push(...simplifyChain(chain.slice(from, i), tol).slice(1)); from = i - 1; }
      if (d) dir = d;
    }
    out.push(...simplifyChain(chain.slice(from), tol).slice(1));
    return out;
  };
  const left = side(lo), right = side(hi);
  const ring = dropCollinear([...right, ...left.reverse()]);
  return tol > 0 ? chamferCorners(ring, tol) : ring;
}

/** Traced and straightened outline of a mask. */
export function outlineOf(mask: ArrayLike<number>, w: number, h: number, tol: number): Ring[] {
  return traceMask(mask, w, h).map(r => straighten(r, tol));
}
