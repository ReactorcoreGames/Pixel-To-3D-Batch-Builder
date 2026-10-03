/* Phase 1: one sprite in, one contact sheet out (DESIGN.md §3 and §4).

   1. The Phase 1 model: the sprite's silhouette extruded through the thickness, then shaped by the cross-section
      shape (shape.ts). Everything happens in the sprite's own frame: u = across the picture, v = down it,
      t = thickness, t = 0 nearest the person looking at the sprite.
   2. The model is placed in the middle of an N × N × N cube and each of the six panels is its view from outside,
      oriented as DESIGN.md §4 says. Because every panel is a projection of one model in one cube, the panels
      always agree with each other: an unedited sheet has nothing that Phase 2 would cut off.
   3. Colours: the sprite's own panel shows the sprite, the opposite panel shows it mirrored, and the four inferred
      panels use the edge scan (the first painted pixel of the sprite row or column the view looks along, or the
      pixel just past it for outlined sprites, with a 1px outline redrawn around the panel's shape).
   4. The frame, the collision guard for its colours, and the legend strip. */

import { applyEnds, applyShape, cutsSpritePlane, endCuts, grid3, shapeCuts, type Grid3, type SpriteAxis } from './shape';
import { carveModel, labelPieces, projectModel } from './voxel';
import { cubeSize, modelSize } from './sprite';
import { ENDS_CODES, SIDE_CODES, SOLID_ALPHA, SHAPE_CODES, type EndsCode, type RGBAImage, type ShapeCode, type SideCode } from './types';

// ------------------------------------------------------------------ layout

/** Gutter width: three 1px lines, edge | core | edge. */
export const GUTTER = 3;
/** Height of the legend strip under the frame. */
export const LEGEND_H = 7;
/** Column and row of each panel: Front : Back / Left : Right / Top : Bottom. */
export const SHEET_LAYOUT: Record<SideCode, [number, number]> = { F: [0, 0], Bk: [1, 0], L: [0, 1], R: [1, 1], T: [0, 2], Bt: [1, 2] };

/** Picture size of a sheet with cube size n. */
export const sheetSize = (n: number) => ({ width: 3 * GUTTER + 2 * n, height: 4 * GUTTER + 3 * n + LEGEND_H });

/** Top-left pixel of a panel's N × N cell on the sheet. */
export function cellOrigin(side: SideCode, n: number): [number, number] {
  const [c, r] = SHEET_LAYOUT[side];
  return [GUTTER + c * (n + GUTTER), GUTTER + r * (n + GUTTER)];
}

// ------------------------------------------------------------------ orientation

/** Where the sprite's axes go in the world, per input side. For world x (right), y (up) and z (towards the front):
    the sprite axis it comes from (0 = u, 1 = v, 2 = t) and whether it runs the same way (1) or reversed (−1). */
const SIDE_MAP: Record<SideCode, [number, 1 | -1][]> = {
  F: [[0, 1], [1, -1], [2, -1]],
  Bk: [[0, -1], [1, -1], [2, 1]],
  R: [[2, -1], [1, -1], [0, -1]],
  L: [[2, 1], [1, -1], [0, 1]],
  T: [[0, 1], [2, -1], [1, 1]],
  Bt: [[0, 1], [2, 1], [1, -1]],
};

/** How each panel sees the cube (DESIGN.md §4, viewer-relative naming, nothing upside down): the world axis across
    the panel and down it (reversed or not), and the axis the viewer looks along (from its high end or its low end).
    Back is mirrored against Front; Right's left edge and Left's right edge meet the Front; Top has the front edge
    at the bottom and Bottom has it at the top; Top and Bottom run left to right like Front.
    Phase 2 (reader.ts, voxel.ts) uses the same table in reverse, so reading a sheet is exactly the inverse of writing one. */
export const VIEW: Record<SideCode, { px: [number, boolean]; py: [number, boolean]; look: [number, boolean] }> = {
  F: { px: [0, false], py: [1, true], look: [2, true] },
  Bk: { px: [0, true], py: [1, true], look: [2, false] },
  R: { px: [2, true], py: [1, true], look: [0, true] },
  L: { px: [2, false], py: [1, true], look: [0, false] },
  T: { px: [0, false], py: [2, false], look: [1, true] },
  Bt: { px: [0, false], py: [2, true], look: [1, false] },
};

/** The direction a panel's view runs through the sprite: along its thickness (the sprite's own panel or the one
    opposite), or along a row (du) or column (dv) of the picture (an inferred panel). */
export function viewDirection(input: SideCode, panel: SideCode): { axis: 0 | 1 | 2; dir: 1 | -1 } {
  const [worldAxis, fromHigh] = VIEW[panel].look;
  const [axis, sign] = SIDE_MAP[input][worldAxis];
  return { axis: axis as 0 | 1 | 2, dir: ((fromHigh ? -1 : 1) * sign) as 1 | -1 };
}

/** Which world axis (0 = x, 1 = y, 2 = z) the sprite's width, height and thickness run along, for a sprite drawn from
    `side`. Phase 2 uses it to apply the cross-section shape to the model in the cube. */
export function spriteAxes(side: SideCode): Record<'W' | 'H' | 'T', 0 | 1 | 2> {
  const find = (a: number) => SIDE_MAP[side].findIndex(([s]) => s === a) as 0 | 1 | 2;
  return { W: find(0), H: find(1), T: find(2) };
}

/** Which of the sprite's axes run reversed in the world for a sprite drawn from `side` (for finding the first and
    last ends of a Tube or Diamond in the cube). */
export function spriteFlips(side: SideCode): Record<SpriteAxis, boolean> {
  const rev = (a: number) => SIDE_MAP[side].find(([s]) => s === a)![1] < 0;
  return { W: rev(0), H: rev(1), T: rev(2) };
}

/** Where cube voxel c (world x right, y up, z towards the front) lands on a panel: [panel x, panel y]. */
export function panelPixel(panel: SideCode, c: ArrayLike<number>, n: number): [number, number] {
  const v = VIEW[panel];
  return [pick(v.px, c[v.px[0]], n), pick(v.py, c[v.py[0]], n)];
}

// ------------------------------------------------------------------ the Phase 1 model

export interface Phase1Model {
  /** Sprite width, height and thickness. */
  w: number; h: number; d: number;
  /** The picture that goes on the sprite's own panel: the sprite's solid pixels, minus anything a ⊙ shape cut off. */
  face: RGBAImage;
  /** Solid voxels in the sprite's frame: x = u, y = v, z = t. */
  grid: Grid3;
}

const solidAt = (img: RGBAImage, x: number, y: number) => x >= 0 && y >= 0 && x < img.width && y < img.height && img.data[(y * img.width + x) * 4 + 3] >= SOLID_ALPHA;

/** The sprite extruded through its thickness and shaped by the cross-section shape (and a Tube's or Diamond's ends). */
export function buildPhase1Model(sprite: RGBAImage, depth: number, shape: ShapeCode, outlined: boolean, ends: EndsCode = 'flat'): Phase1Model {
  const { width: w, height: h } = sprite, d = depth;
  // 1. the silhouette, cut in the picture plane first if the shape is a ⊙ one
  let mask: Uint8Array = new Uint8Array(w * h);
  for (let v = 0; v < h; v++) for (let u = 0; u < w; u++) mask[v * w + u] = solidAt(sprite, u, v) ? 1 : 0;
  const planeCut = cutsSpritePlane(shape);
  if (planeCut) mask = applyShape({ nx: w, ny: h, nz: 1, data: mask }, shape, { W: 0, H: 1, T: 2 }).data;
  const face = faceImage(sprite, mask, planeCut && outlined);

  // 2. extrude, then the width/height cuts (they never touch the picture plane's outline, see below)
  let grid = grid3(w, h, d);
  for (let t = 0; t < d; t++) grid.data.set(mask, t * w * h);
  if (!planeCut) {
    // each piece's depth follows its drawn size: the longest run across the picture gets the whole thickness
    let longestCol = 0, longestRow = 0;
    for (let u = 0; u < w; u++) for (let v = 0, run = 0; v < h; v++) { run = mask[v * w + u] ? run + 1 : 0; longestCol = Math.max(longestCol, run); }
    for (let v = 0; v < h; v++) for (let u = 0, run = 0; u < w; u++) { run = mask[v * w + u] ? run + 1 : 0; longestRow = Math.max(longestRow, run); }
    // a W cut slices across the width, so its pieces are column runs; an H cut's pieces are row runs
    grid = applyShape(grid, shape, { W: 0, H: 1, T: 2 }, { W: d / Math.max(1, longestCol), H: d / Math.max(1, longestRow) });
  }
  // shaped ends come after the shape, so their radius is the shaped tube's
  const shapedEnds = endCuts(shape, ends).length > 0;
  if (shapedEnds) grid = applyEnds(grid, shape, ends, { W: 0, H: 1, T: 2 });
  if (!planeCut || shapedEnds) {
    // The sprite's outline is always kept (for a ⊙ shape, the outline it was cut to): a pixel whose whole line
    // through the thickness was cut away (the thin ends of a long run) keeps its middle voxel, or middle two for an
    // even thickness, so the model stays symmetric.
    const mids = d % 2 ? [(d - 1) / 2] : [d / 2 - 1, d / 2];
    for (let i = 0; i < w * h; i++) {
      if (!mask[i]) continue;
      let any = false;
      for (let t = 0; t < d && !any; t++) any = !!grid.data[t * w * h + i];
      if (!any) for (const t of mids) grid.data[t * w * h + i] = 1;
    }
  }
  return { w, h, d, face, grid };
}

/** Makes sure Phase 2 reads the sheet back without cutting off any of its paint (DESIGN.md §3, "Why the sheet shows
    the shaped model"). Phase 2 carves the model from the six panels and applies the shape again to what it carved.
    Cuts are fitted to each connected piece, and on the carved model a piece can come out a little different from
    Phase 1's (pieces that touch, pieces a cut split in two), so re-applying the shape can remove a few more voxels.
    So Phase 1 runs Phase 2's carving on its own panels and takes the result until nothing more changes. Most models
    pass the first time and stay exactly as they were. Every step can only remove voxels, so it always ends. */
export function settleModel(model: Phase1Model, side: SideCode, shape: ShapeCode, n: number, ends: EndsCode = 'flat'): Phase1Model {
  if (!shapeCuts(shape).length) return model; // a box is its own visual hull
  const { w, h, d, grid } = model, sSize = [w, h, d], map = SIDE_MAP[side];
  const off = modelSize(w, h, d, side).map(s => Math.floor((n - s) / 2));
  const at = (u: number, v: number, t: number) => {
    const s = [u, v, t], c = [0, 1, 2].map(k => { const [a, sign] = map[k]; return off[k] + (sign > 0 ? s[a] : sSize[a] - 1 - s[a]); });
    return (c[2] * n + c[1]) * n + c[0];
  };
  let solid: Uint8Array = new Uint8Array(n * n * n), changed = false;
  for (let t = 0; t < d; t++) for (let v = 0; v < h; v++) for (let u = 0; u < w; u++) if (grid.data[(t * h + v) * w + u]) solid[at(u, v, t)] = 1;
  const start = labelPieces(solid, n, true).label, stride = [1, n, n * n][spriteAxes(side).T];
  // the voxels that are alone on their line through the sprite's thickness: they draw the sprite's own panel
  const alone = (k: number) => { let c = 0; for (let i = k % stride + Math.floor(k / (stride * n)) * stride * n, s = 0; s < n; s++, i += stride) c += solid[i]; return c === 1; };
  for (let round = 0; round < 16; round++) {
    const m = carveModel(projectModel(solid, n), n, side, shape, { x: .5, y: .5, z: .5 }, undefined, ends);
    if (!m.trimmed.length) break;
    solid = m.solid; changed = true;
    // Shaving can cut a piece of the model in two (an uneven outline as Egg or Gem, where each round fits the shape
    // to a slightly smaller box): the smaller parts would float. Of each piece Phase 1 made, only its largest part
    // stays; parts the sprite drew apart from the start are pieces of their own, and a part holding the only voxel
    // of a line through the thickness stays too, so the sprite's own panel never loses a pixel.
    const { pieces } = labelPieces(solid, n, true), biggest = new Map<number, number>();
    for (const [p, cells] of pieces.entries()) {
      const was = start[cells[0]], b = biggest.get(was);
      if (b === undefined || cells.length > pieces[b].length) biggest.set(was, p);
    }
    for (const [p, cells] of pieces.entries()) {
      if (biggest.get(start[cells[0]]) === p || cells.some(alone)) continue;
      for (const k of cells) solid[k] = 0;
    }
  }
  if (!changed) return model;
  const out = grid3(w, h, d), face = { ...model.face, data: new Uint8Array(model.face.data) };
  for (let t = 0; t < d; t++) for (let v = 0; v < h; v++) for (let u = 0; u < w; u++) out.data[(t * h + v) * w + u] = solid[at(u, v, t)];
  // a pixel of the sprite whose whole line through the thickness went is no longer on the sprite's panel
  for (let v = 0; v < h; v++) for (let u = 0; u < w; u++) {
    let any = false;
    for (let t = 0; t < d && !any; t++) any = out.data[(t * h + v) * w + u] === 1;
    if (!any) face.data.fill(0, (v * w + u) * 4, (v * w + u) * 4 + 4);
  }
  return { ...model, grid: out, face };
}

/** The sprite's solid pixels inside the mask. When a ⊙ shape cut an outlined sprite, the pixels on the new edge get
    the colour of the nearest pixel of the sprite's original outline, so the outline stays closed. */
function faceImage(sprite: RGBAImage, mask: Uint8Array, redrawOutline: boolean): RGBAImage {
  const { width: w, height: h, data: src } = sprite, data = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) if (mask[i]) for (let k = 0; k < 4; k++) data[i * 4 + k] = src[i * 4 + k];
  if (redrawOutline) {
    const border: number[] = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (solidAt(sprite, x, y) && (!solidAt(sprite, x - 1, y) || !solidAt(sprite, x + 1, y) || !solidAt(sprite, x, y - 1) || !solidAt(sprite, x, y + 1))) border.push(y * w + x);
    }
    const cut = (x: number, y: number) => solidAt(sprite, x, y) && !mask[y * w + x];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (!mask[y * w + x] || !(cut(x - 1, y) || cut(x + 1, y) || cut(x, y - 1) || cut(x, y + 1))) continue;
      let best = -1, bestD = Infinity;
      for (const b of border) { const bx = b % w, by = (b - bx) / w, dd = (bx - x) * (bx - x) + (by - y) * (by - y); if (dd < bestD) { bestD = dd; best = b; } }
      for (let k = 0; k < 4; k++) data[(y * w + x) * 4 + k] = src[best * 4 + k];
    }
  }
  return { width: w, height: h, data };
}

// ------------------------------------------------------------------ panels

export interface Panel {
  /** RGBA, n × n, transparent outside the model. */
  data: Uint8Array;
  /** The model's bounding box inside the panel. */
  x: number; y: number; w: number; h: number;
}

/** Which inferred panels fold the drawing instead of the edge scan: [views along the sprite's rows (u), views along
    its columns (v)]. A panel facing around the axis of a round or diamond cross-section sees the curved surface the
    drawing is painted on from a quarter turn away: each half of the panel is the half of the drawing nearest that
    viewer, split down the middle and mirrored (a gun drawn from the side, seen from above, shows its top edge down
    the middle and its sides at the rims). A ↕ cut rounds each row, so the views along the rows (Left/Right for a
    Front sprite) fold; a ↔ cut folds the views along the columns. Box and Soft box have flat sides, and panels
    looking down a tube's axis see an end cap the drawing says nothing about, so those keep the edge scan. */
export function splitViews(shape: ShapeCode): [boolean, boolean] {
  const cuts = shapeCuts(shape).filter(c => c.kind !== 'soft');
  return [cuts.some(c => c.axis === 'H'), cuts.some(c => c.axis === 'W')];
}

/** The inferred panels that look at a shaped end of a Tube or Diamond: the view along the sprite's rows (axis 0) or
    columns (axis 1), from the end's side (dir +1 = the viewer at the first end, looking in). A shaped end is round
    (or pointed) around the tube's axis, so its panel shows the drawing's end folded round it, instead of the edge
    scan's stripes: the tip in the middle, the pixels one radius back at the rim (see `renderPanels`). The ⊙ shapes'
    ends face the sprite's own panel and the one opposite, which show the drawing anyway. */
export function foldedViews(shape: ShapeCode, ends: EndsCode): { axis: 0 | 1; dir: 1 | -1 }[] {
  const out: { axis: 0 | 1; dir: 1 | -1 }[] = [], cut = endCuts(shape, ends)[0];
  if (!cut || cut.along === 'T') return out;
  const axis = cut.along === 'W' ? 0 : 1;
  if (cut.first) out.push({ axis, dir: 1 });
  if (cut.last) out.push({ axis, dir: -1 });
  return out;
}

/** Renders the six N × N panels of a model placed in the middle of the cube. With `copy` (the "Copy sides" setting),
    every inferred panel but a shaped end's shows the drawing itself, turned to face that viewer. */
export function renderPanels(model: Phase1Model, side: SideCode, n: number, outlined: boolean, split: [boolean, boolean] = [false, false], fold: { axis: 0 | 1; dir: 1 | -1 }[] = [], copy = false): Record<SideCode, Panel> {
  const { w, h, d, face, grid } = model;
  const sSize = [w, h, d], map = SIDE_MAP[side];
  const size = modelSize(w, h, d, side);
  const off = size.map(s => Math.floor((n - s) / 2));
  // cube coordinate of a sprite-frame voxel along world axis k
  const cube = (k: number, s: number[]) => { const [a, sign] = map[k]; return off[k] + (sign > 0 ? s[a] : sSize[a] - 1 - s[a]); };

  const faceSolid = (u: number, v: number) => u >= 0 && v >= 0 && u < w && v < h && face.data[(v * w + u) * 4 + 3] >= SOLID_ALPHA;
  // the model seen along the rows (indexed v · d + t) and along the columns (u · d + t), for copied panels
  const along = [new Uint8Array(h * d), new Uint8Array(w * d)];
  if (copy) for (let t = 0; t < d; t++) for (let v = 0; v < h; v++) for (let u = 0; u < w; u++) {
    if (grid.data[(t * h + v) * w + u]) { along[0][v * d + t] = 1; along[1][u * d + t] = 1; }
  }
  const out = {} as Record<SideCode, Panel>;
  for (const p of SIDE_CODES) {
    const view = VIEW[p], hit = new Int32Array(n * n).fill(-1), depthBuf = new Int32Array(n * n).fill(n);
    // panel x, panel y and depth are affine in (u, v, t): work out the coefficients once
    const affine = (ax: [number, boolean]) => {
      const at = (s: number[]) => pick(ax, cube(ax[0], s), n), c = at([0, 0, 0]);
      return [c, at([1, 0, 0]) - c, at([0, 1, 0]) - c, at([0, 0, 1]) - c];
    };
    const [x0, xu, xv, xt] = affine(view.px), [y0, yu, yv, yt] = affine(view.py), [z0, zu, zv, zt] = affine(view.look);
    for (let t = 0; t < d; t++) for (let v = 0; v < h; v++) for (let u = 0; u < w; u++) {
      if (!grid.data[(t * h + v) * w + u]) continue;
      const i = (y0 + yu * u + yv * v + yt * t) * n + x0 + xu * u + xv * v + xt * t, dep = z0 + zu * u + zv * v + zt * t;
      if (dep < depthBuf[i]) { depthBuf[i] = dep; hit[i] = (t * h + v) * w + u; }
    }
    // colour every hit
    const { axis, dir } = viewDirection(side, p), data = new Uint8Array(n * n * 4);
    const edge = new Int32Array(n * n).fill(-1); // outline colour source for inferred panels
    for (let i = 0; i < n * n; i++) {
      if (hit[i] < 0) continue;
      const k = hit[i] % (w * h), t = (hit[i] - k) / (w * h), hu = k % w, hv = (k - hu) / w;
      let src = k;
      if (axis !== 2) {
        // edge scan: walk back to the start of the run the view hits
        const du = axis === 0 ? dir : 0, dv = axis === 1 ? dir : 0;
        let u = hu, v = hv;
        while (faceSolid(u - du, v - dv)) { u -= du; v -= dv; }
        edge[i] = v * w + u;
        src = outlined && faceSolid(u + du, v + dv) ? (v + dv) * w + u + du : v * w + u;
        const endFold = fold.some(f => f.axis === axis && f.dir === dir);
        if (copy && !endFold) {
          // Copy sides: the drawing itself, as if the object were turned so its drawn face points at this viewer. This
          // panel row's depth span maps onto the whole sprite run the view hits, unmirrored (a boulder's sides look
          // like more boulder, a crate's sides get the crate's front).
          const b = axis === 0 ? hv : hu, line = along[axis];
          let t0 = t, t1 = t;
          while (t0 > 0 && line[b * d + t0 - 1]) t0--;
          while (t1 < d - 1 && line[b * d + t1 + 1]) t1++;
          let ue = hu, ve = hv;
          while (faceSolid(ue + du, ve + dv)) { ue += du; ve += dv; }
          const a = axis === 0 ? [u, ue] : [v, ve];
          let lo = Math.min(a[0], a[1]), hi = Math.max(a[0], a[1]);
          if (outlined && hi - lo >= 2) { lo++; hi--; } // the panel gets its own outline below
          // turning the drawn face towards a viewer on the low side puts the run's start at the far end (t1)
          let f = (t - t0 + .5) / (t1 - t0 + 1);
          if (dir > 0) f = 1 - f;
          const c = lo + Math.min(hi - lo, Math.floor(f * (hi - lo + 1)));
          src = axis === 0 ? hv * w + c : c * w + hu;
        } else if (endFold || split[axis]) {
          // Fold the drawing round the cross-section: the pixel the view hits takes the drawing's colour at that voxel,
          // as if the drawing were projected straight through the thickness onto the curved surface. Where the surface
          // faces the viewer (the middle of the panel) that is the run's pixel nearest the viewer; where it curves
          // away it is a pixel further in, so each half of the panel mirrors the other: a gun seen from above shows
          // its top edge down the middle and its sides at the rims, a shaped end its tip in the middle. Following the
          // model's real surface keeps a narrow dome on a wide base round, and a small socket on a bulb.
          src = outlined && hu === u && hv === v && faceSolid(u + 2 * du, v + 2 * dv) ? src : k; // the panel gets its own outline below
        }
      }
      data.set(face.data.subarray(src * 4, src * 4 + 4), i * 4);
    }
    // Copy sides: the column of the sheet that holds the sprite shows the copies as drawn, the other column mirrors
    // them, so each opposite pair is the drawing and its mirror, like the sprite's own panel and the one opposite
    // (which is already mirrored). Each row is mirrored within the model's shape on that row, so the shape stays.
    if (copy && axis !== 2 && SHEET_LAYOUT[p][0] !== SHEET_LAYOUT[side][0] && !fold.some(f => f.axis === axis && f.dir === dir)) {
      for (let y = 0; y < n; y++) for (let x0 = 0; x0 < n;) {
        if (hit[y * n + x0] < 0) { x0++; continue; }
        let x1 = x0;
        while (x1 + 1 < n && hit[y * n + x1 + 1] >= 0) x1++;
        for (let a = y * n + x0, b = y * n + x1; a < b; a++, b--) {
          for (let c = 0; c < 4; c++) { const tmp = data[a * 4 + c]; data[a * 4 + c] = data[b * 4 + c]; data[b * 4 + c] = tmp; }
        }
        x0 = x1 + 1;
      }
    }
    // outlined sprites: redraw a 1px outline around the shape of each inferred panel
    if (outlined && axis !== 2) {
      const on = (x: number, y: number) => x >= 0 && y >= 0 && x < n && y < n && hit[y * n + x] >= 0;
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        const i = y * n + x;
        if (hit[i] >= 0 && (!on(x - 1, y) || !on(x + 1, y) || !on(x, y - 1) || !on(x, y + 1))) data.set(face.data.subarray(edge[i] * 4, edge[i] * 4 + 4), i * 4);
      }
    }
    // the model's bounding box on this panel
    const lo = [0, 1, 2].map(k => off[k]), hi = [0, 1, 2].map(k => off[k] + size[k] - 1);
    const xs = [pick(view.px, lo[view.px[0]], n), pick(view.px, hi[view.px[0]], n)], ys = [pick(view.py, lo[view.py[0]], n), pick(view.py, hi[view.py[0]], n)];
    out[p] = { data, x: Math.min(...xs), y: Math.min(...ys), w: Math.abs(xs[1] - xs[0]) + 1, h: Math.abs(ys[1] - ys[0]) + 1 };
  }
  return out;
}

const pick = ([, rev]: [number, boolean], c: number, n: number) => (rev ? n - 1 - c : c);

// ------------------------------------------------------------------ frame colours and the collision guard

export interface Frame { edge: string; core: string }

const hexToInt = (hex: string) => parseInt(hex.slice(1), 16);
const intToHex = (v: number) => '#' + v.toString(16).padStart(6, '0');
/** A frame colour counts as too close to a sprite colour when every channel is within this distance. */
export const FRAME_MIN_DISTANCE = 16;

const closeTo = (a: number, b: number) =>
  Math.abs((a >> 16) - (b >> 16)) <= FRAME_MIN_DISTANCE && Math.abs(((a >> 8) & 255) - ((b >> 8) & 255)) <= FRAME_MIN_DISTANCE && Math.abs((a & 255) - (b & 255)) <= FRAME_MIN_DISTANCE;

// directions to step in, tried in this order at growing distances, so the result is always the same
const NUDGES = [[1, 1, 1], [-1, -1, -1], [1, -1, 1], [-1, 1, -1], [1, 1, -1], [-1, -1, 1], [-1, 1, 1], [1, -1, -1], [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

/** Nudges a frame colour away from the sprite's colours (DESIGN.md §4, collision guard), so a wand click, flood fill
    or "replace colour" on the art can never grab the frame too. Returns the colour unchanged when it's clear. */
export function guardColour(hex: string, used: Set<number>): string {
  const clear = (c: number) => { for (const u of used) if (closeTo(c, u)) return false; return true; };
  const c0 = hexToInt(hex);
  if (clear(c0)) return hex;
  const [r, g, b] = [c0 >> 16, (c0 >> 8) & 255, c0 & 255];
  for (let step = 1; step <= 16; step++) for (const [dr, dg, db] of NUDGES) {
    const k = step * (FRAME_MIN_DISTANCE + 1), ch = (v: number, dv: number) => Math.max(0, Math.min(255, v + dv * k));
    const c = (ch(r, dr) << 16) | (ch(g, dg) << 8) | ch(b, db);
    if (clear(c)) return intToHex(c);
  }
  return hex; // a sprite that uses nearly every colour: nothing is clear, keep the user's pick
}

// ------------------------------------------------------------------ legend (a 3 × 5 pixel font)

const FONT: Record<string, string[]> = {
  A: ['.#.', '#.#', '###', '#.#', '#.#'], B: ['##.', '#.#', '##.', '#.#', '##.'], C: ['.##', '#..', '#..', '#..', '.##'],
  D: ['##.', '#.#', '#.#', '#.#', '##.'], E: ['###', '#..', '##.', '#..', '###'], F: ['###', '#..', '##.', '#..', '#..'],
  G: ['.##', '#..', '#.#', '#.#', '.##'], H: ['#.#', '#.#', '###', '#.#', '#.#'], I: ['###', '.#.', '.#.', '.#.', '###'],
  K: ['#.#', '#.#', '##.', '#.#', '#.#'], L: ['#..', '#..', '#..', '#..', '###'], M: ['#.#', '###', '###', '#.#', '#.#'],
  N: ['##.', '#.#', '#.#', '#.#', '#.#'], O: ['.#.', '#.#', '#.#', '#.#', '.#.'], P: ['##.', '#.#', '##.', '#..', '#..'],
  R: ['##.', '#.#', '##.', '#.#', '#.#'], S: ['.##', '#..', '.#.', '..#', '##.'], T: ['###', '.#.', '.#.', '.#.', '.#.'],
  Z: ['###', '..#', '.#.', '#..', '###'], ':': ['...', '.#.', '...', '.#.', '...'], ' ': ['...', '...', '...', '...', '...'],
  0: ['###', '#.#', '#.#', '#.#', '###'], 1: ['.#.', '##.', '.#.', '.#.', '###'], 2: ['##.', '..#', '.#.', '#..', '###'],
  3: ['##.', '..#', '.#.', '..#', '##.'], 4: ['#.#', '#.#', '###', '..#', '..#'], 5: ['###', '#..', '##.', '..#', '##.'],
  6: ['.##', '#..', '###', '#.#', '###'], 7: ['###', '..#', '.#.', '.#.', '.#.'], 8: ['###', '#.#', '###', '#.#', '###'],
  9: ['###', '#.#', '###', '..#', '##.'],
};
export const LEGEND_BG = '#1d1a26';
export const LEGEND_FG = '#e9e3ff';

/** The longest legend text that fits the sheet's width (DESIGN.md §4, tiered legend). Each letter is 3px plus 1px gap. */
export function legendText(n: number): string {
  const fit = Math.floor((sheetSize(n).width - 1) / 4);
  const tiers = [`FRONT:BACK LEFT:RIGHT TOP:BOTTOM N${n} DO NOT RESIZE`, `F:B L:R T:BOT N${n} DO NOT RESIZE`, `F:B L:R T:BOT N${n}`, 'F:B L:R T:BOT', `N${n}`];
  return tiers.find(t => t.length <= fit) ?? '';
}

// ------------------------------------------------------------------ the sheet

export interface SheetOptions {
  side: SideCode;
  /** Thickness in px. */
  depth: number;
  shape: ShapeCode;
  /** Ends for Tube and Diamond (default flat; ignored by the other shapes). */
  ends?: EndsCode;
  outlined: boolean;
  /** "Copy sides": the inferred panels show the drawing turned to face them, instead of what the sides would show. */
  copySides?: boolean;
  /** The frame colours the user picked; the sheet may use nudged versions (see `frame` in the result). */
  frame: Frame;
}

export interface SheetRect {
  /** The panel's N × N cell on the sheet. */
  cx: number; cy: number;
  /** The model's bounding box on the sheet. */
  x: number; y: number; w: number; h: number;
}

export interface Sheet {
  image: RGBAImage;
  n: number;
  /** World X × Y × Z of the model. */
  size: [number, number, number];
  rects: Record<SideCode, SheetRect>;
  legend: string;
  /** The frame colours actually used, after the collision guard. */
  frame: Frame;
  nudged: boolean;
}

const rgbOf = (hex: string) => { const v = hexToInt(hex); return [v >> 16, (v >> 8) & 255, v & 255]; };

/** Makes the contact sheet for one sprite. Returns null when the model doesn't fit in 128 px. */
export function makeSheet(sprite: RGBAImage, o: SheetOptions): Sheet | null {
  const size = modelSize(sprite.width, sprite.height, o.depth, o.side);
  const n = cubeSize(Math.max(...size));
  if (!n || sprite.width > 128 || sprite.height > 128) return null;
  const ends = o.ends ?? 'flat';
  const model = settleModel(buildPhase1Model(sprite, o.depth, o.shape, o.outlined, ends), o.side, o.shape, n, ends);
  const panels = renderPanels(model, o.side, n, o.outlined, splitViews(o.shape), foldedViews(o.shape, ends), o.copySides);

  // collision guard against every colour the panels use (they all come from the sprite's face)
  const used = new Set<number>();
  const fd = model.face.data;
  for (let i = 0; i < fd.length; i += 4) if (fd[i + 3] >= SOLID_ALPHA) used.add((fd[i] << 16) | (fd[i + 1] << 8) | fd[i + 2]);
  const frame = { edge: guardColour(o.frame.edge, used), core: guardColour(o.frame.core, used) };
  const nudged = frame.edge !== o.frame.edge || frame.core !== o.frame.core;

  const { width: W, height: H } = sheetSize(n), data = new Uint8Array(W * H * 4);
  const fill = (x0: number, y0: number, w: number, h: number, rgb: number[]) => {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) { const i = (y * W + x) * 4; data[i] = rgb[0]; data[i + 1] = rgb[1]; data[i + 2] = rgb[2]; data[i + 3] = 255; }
  };
  // frame: edge colour everywhere, the core line through the middle of every gutter, then the cells are cut out
  const frameH = H - LEGEND_H, edge = rgbOf(frame.edge), core = rgbOf(frame.core);
  fill(0, 0, W, frameH, edge);
  for (let c = 0; c < 3; c++) fill(c * (n + GUTTER) + 1, 0, 1, frameH, core);
  for (let r = 0; r < 4; r++) fill(0, r * (n + GUTTER) + 1, W, 1, core);

  const rects = {} as Record<SideCode, SheetRect>;
  for (const p of SIDE_CODES) {
    const [cx, cy] = cellOrigin(p, n), pd = panels[p].data;
    for (let y = 0; y < n; y++) data.set(pd.subarray(y * n * 4, (y + 1) * n * 4), ((cy + y) * W + cx) * 4);
    rects[p] = { cx, cy, x: cx + panels[p].x, y: cy + panels[p].y, w: panels[p].w, h: panels[p].h };
  }

  // legend strip under the frame
  fill(0, frameH, W, LEGEND_H, rgbOf(LEGEND_BG));
  const legend = legendText(n), fg = rgbOf(LEGEND_FG);
  [...legend].forEach((ch, k) => {
    const glyph = FONT[ch] ?? FONT[' '];
    for (let gy = 0; gy < 5; gy++) for (let gx = 0; gx < 3; gx++) if (glyph[gy][gx] === '#') fill(1 + k * 4 + gx, frameH + 1 + gy, 1, 1, fg);
  });

  return { image: { width: W, height: H, data }, n, size, rects, legend, frame, nudged };
}

// ------------------------------------------------------------------ file names

/** The ends a sheet actually has: Flat for every shape but Tube and Diamond. */
export const effectiveEnds = (shape: ShapeCode, ends: EndsCode): EndsCode => (endCuts(shape, ends).length ? ends : 'flat');

/** `name__N_side_shape.png` (DESIGN.md §4), plus `_cF` / `_cL` / `_cB` for a Tube or Diamond with shaped ends. The
    shape code is sprite-relative (W / H / T). Flat ends add nothing, so every older sheet name stays valid. */
export function sheetFileName(base: string, n: number, side: SideCode, shape: ShapeCode, ends: EndsCode = 'flat'): string {
  const e = effectiveEnds(shape, ends);
  return `${base}__${n}_${side}_${shape}${e === 'flat' ? '' : '_' + e}.png`;
}

const NAME_RE = new RegExp(`^(.*)__(\\d+)_(${SIDE_CODES.join('|')})_(${SHAPE_CODES.join('|')})(?:_(${ENDS_CODES.slice(1).join('|')}))?\\.png$`, 'i');

/** Reads the settings back from a sheet's file name, or null when the name lost them. Codes are case-sensitive.
    A name without an ends code has flat ends (every sheet made before ends existed). */
export function parseSheetName(file: string): { base: string; n: number; side: SideCode; shape: ShapeCode; ends: EndsCode } | null {
  const m = file.match(NAME_RE);
  if (!m || !(SIDE_CODES as readonly string[]).includes(m[3]) || !(SHAPE_CODES as readonly string[]).includes(m[4])) return null;
  if (m[5] && !(ENDS_CODES as readonly string[]).includes(m[5])) return null;
  return { base: m[1], n: +m[2], side: m[3] as SideCode, shape: m[4] as ShapeCode, ends: (m[5] as EndsCode | undefined) ?? 'flat' };
}

/** Output names for a batch of sheets. Two sheets in one batch never share a name, and with `neverOverwrite` a name
    already in `existing` (the output folder) isn't reused: a number goes on the end of the name part, before the
    settings code, so the file still reads back in Phase 2: `rifle__32_R_cyW.png` → `rifle_2__32_R_cyW.png`.
    Names are compared ignoring case, as Windows does.
    `own[i]` is the existing file sheet i replaces (a remade sheet, moved aside before the new one is written): that
    sheet may take its name, and no other sheet in the batch may. */
export function planFileNames(names: string[], existing: Iterable<string> = [], neverOverwrite = true, own: (string | undefined)[] = []): string[] {
  const taken = new Set<string>();
  const onDisk = new Set([...existing].map(s => s.toLowerCase()));
  const reserved = new Set(own.filter((s): s is string => !!s).map(s => s.toLowerCase()));
  return names.map((name, i) => {
    const mine = own[i]?.toLowerCase();
    const free = (s: string) => {
      const k = s.toLowerCase();
      return !taken.has(k) && (k === mine || (!reserved.has(k) && !(neverOverwrite && onDisk.has(k))));
    };
    let out = name;
    if (!free(out)) {
      const cut = name.lastIndexOf('__'), head = cut >= 0 ? name.slice(0, cut) : name.replace(/\.png$/i, ''), tail = cut >= 0 ? name.slice(cut) : '.png';
      for (let k = 2; !free(out = `${head}_${k}${tail}`); k++);
    }
    taken.add(out.toLowerCase());
    return out;
  });
}
