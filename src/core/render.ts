/* Pixel-clean rendering (DESIGN.md §11): the textured low-poly model drawn straight into small pixel sprites, for the
   rendered sprite sets and the turntable GIF. A small software rasterizer rather than Three.js's RenderPixelatedPass,
   so the core still runs in Node (tests, the command-line tool), for the same reason the GLB writer is hand-written.

   The pipeline: render at the target size with nearest texture sampling (or, for views where texture pixels would
   drop out, 4× bigger and shrunk by the most common colour in each block: the odd-angle fix), flat or banded light
   fixed to the camera, 1px outlines around the silhouette and along depth edges, then a palette snap. */

import { nearestColour, quantize } from './palette';
import type { RGBAImage } from './types';
import type { ColouredModel, VoxelModel } from './voxel';
import { cos, sin, tan } from './fmath';

/** What the renderer draws: the textured mesh (cube coordinates, x right, y up, z towards the front). */
export interface RenderSource {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  uvs: Float32Array;
  atlas: RGBAImage;
  lo: ArrayLike<number>;
  hi: ArrayLike<number>;
  /** Inner outlines only where the two parts are further apart than this, measured square to their surfaces (model
      pixels). Voxel models set it, so their one-cube stair steps don't all get lines; 0 or absent = no such rule. */
  stepGap?: number;
}

/** The four corners of each cube face, by outward direction (+x, −x, +y, −y, +z, −z). */
const CUBE_FACES: [number[], number[][]][] = [
  [[1, 0, 0], [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]]], [[-1, 0, 0], [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]]],
  [[0, 1, 0], [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]]], [[0, -1, 0], [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]]],
  [[0, 0, 1], [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]]], [[0, 0, -1], [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]]],
];

/**
 * The voxel model as something the renderer can draw ("Draw from: Voxel model"): every cube face open to the
 * outside as two triangles, textured from a small atlas holding each surface colour once. The colours are the
 * voxel file's (the surface colour rule, DESIGN.md §8), and cube coordinates match the mesh's, so both line up.
 */
export function voxelSource(m: VoxelModel, c: ColouredModel): RenderSource {
  const { n, solid, lo, hi } = m, at = (x: number, y: number, z: number) => x >= 0 && y >= 0 && z >= 0 && x < n && y < n && z < n && solid[(z * n + y) * n + x] === 1;
  const cols = new Map<number, number>(), pos: number[] = [], nor: number[] = [], faceCol: number[] = [];
  for (let z = lo[2]; z <= hi[2]; z++) for (let y = lo[1]; y <= hi[1]; y++) for (let x = lo[0]; x <= hi[0]; x++) {
    const i = (z * n + y) * n + x;
    if (!solid[i]) continue;
    for (const [d, corners] of CUBE_FACES) {
      if (at(x + d[0], y + d[1], z + d[2])) continue;
      for (const k of corners) { pos.push(x + k[0], y + k[1], z + k[2]); nor.push(d[0], d[1], d[2]); }
      if (!cols.has(c.colour[i])) cols.set(c.colour[i], cols.size);
      faceCol.push(cols.get(c.colour[i])!);
    }
  }
  const W = Math.max(1, Math.ceil(Math.sqrt(cols.size))), H = Math.max(1, Math.ceil(cols.size / W)), data = new Uint8Array(W * H * 4);
  for (const [col, j] of cols) data.set([col >> 16, (col >> 8) & 255, col & 255, 255], j * 4);
  const nf = faceCol.length, uvs = new Float32Array(nf * 8), idx = new Uint32Array(nf * 6);
  faceCol.forEach((j, f) => {
    const u = (j % W + .5) / W, v = (Math.floor(j / W) + .5) / H;
    for (let k = 0; k < 4; k++) { uvs[f * 8 + k * 2] = u; uvs[f * 8 + k * 2 + 1] = v; }
    idx.set([f * 4, f * 4 + 1, f * 4 + 2, f * 4, f * 4 + 2, f * 4 + 3], f * 6);
  });
  return {
    positions: new Float32Array(pos), normals: new Float32Array(nor), indices: idx, uvs, atlas: { width: W, height: H, data },
    lo: [lo[0], lo[1], lo[2]], hi: [hi[0] + 1, hi[1] + 1, hi[2] + 1], stepGap: 1.5,
  };
}

export interface CameraSpec {
  /** Turn in degrees: 0 looks at the front, 90 at the Right side (+x), 180 at the back. */
  yaw: number;
  /** Camera height in degrees: 0 = eye level, 90 = straight down, negative = from below. */
  elev: number;
  /** Leans the finished picture inside its frame, in degrees (positive leans right). */
  tilt?: number;
  persp?: boolean;
  /** Field of view in degrees, for perspective. */
  fov?: number;
  /** An oblique projection instead of a turned camera (`elev` is then ignored): the side the camera turn looks at is
      drawn flat-on, and the depth recedes at `angle` degrees on screen (counter-clockwise from screen right, so 0–90
      goes up and right, 90–180 up and left), drawn at `depth` times its length (½ cabinet, 1 cavalier). */
  oblique?: { angle: number; depth: number };
}

/** 1 = flat (the texture's own colours), 2–4 = that many hard steps of light. */
export type Bands = 1 | 2 | 3 | 4;
export type FixCode = 'auto' | 'always' | 'never';
export interface LookSpec {
  outline: boolean;
  bands: Bands;
  /** The odd-angle fix: render bigger and shrink by the most common colour. */
  fix: FixCode;
}

type V3 = [number, number, number];
const dot = (a: ArrayLike<number>, b: ArrayLike<number>) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const RAD = Math.PI / 180;

interface View { r: V3; u: V3; d: V3; lr: V3; lu: V3; cen: V3; persp: boolean; D: number }

/** The camera's axes: `d` points towards the camera, `r` / `u` are screen right and up (after the tilt; for an
    oblique camera they are the shear's screen axes, not square to `d`), `lr` / `lu` the light's right and up. */
function viewOf(src: RenderSource, cam: CameraSpec): View {
  const t = cam.yaw * RAD, f = cam.oblique ? 0 : cam.elev * RAD;
  let d: V3 = [sin(t) * cos(f), sin(f), cos(t) * cos(f)];
  let r0: V3 = [cos(t), 0, -sin(t)];
  let u0: V3 = [-sin(t) * sin(f), cos(f), -cos(t) * sin(f)];
  let lr = r0, lu = u0;
  if (cam.oblique) {
    // a shear, not a turn: screen x = x + k·depth·cos α, screen y = y + k·depth·sin α (depth = distance into the
    // screen), so level lines stay level and the flat-on side keeps its drawing. The screen axes stop being square
    // to each other, which project() doesn't mind. Depth order, facing and the light use the direction the shear
    // looks along (points on a line along it land on the same pixel): p = d + k cos α r + k sin α u.
    const a = cam.oblique.angle * RAD, sx = cam.oblique.depth * cos(a), sy = cam.oblique.depth * sin(a);
    const p = d.map((v, i) => v + sx * r0[i] + sy * u0[i]), pl = Math.sqrt(p[0] * p[0] + p[1] * p[1] + p[2] * p[2]);
    const view = p.map(v => v / pl) as V3;
    r0 = r0.map((v, i) => v - sx * d[i]) as V3;
    u0 = u0.map((v, i) => v - sy * d[i]) as V3;
    d = view;
    // the light's frame: up as close to the world's up as square to the view allows, right = up × view
    const ud = dot(lu, d), lu1 = lu.map((v, i) => v - ud * d[i]), ul = Math.sqrt(lu1[0] * lu1[0] + lu1[1] * lu1[1] + lu1[2] * lu1[2]);
    lu = lu1.map(v => v / ul) as V3;
    lr = [lu[1] * d[2] - lu[2] * d[1], lu[2] * d[0] - lu[0] * d[2], lu[0] * d[1] - lu[1] * d[0]];
  }
  // the tilt spins the picture, not the light: a lean doesn't change which side is lit
  const c = cos((cam.tilt ?? 0) * RAD), s = sin((cam.tilt ?? 0) * RAD);
  const r = r0.map((v, i) => v * c + u0[i] * s) as V3, u = u0.map((v, i) => v * c - r0[i] * s) as V3;
  const cen = [0, 1, 2].map(k => (src.lo[k] + src.hi[k]) / 2) as V3;
  const R = .5 * Math.hypot(src.hi[0] - src.lo[0], src.hi[1] - src.lo[1], src.hi[2] - src.lo[2]) || 1;
  const persp = !!cam.persp;
  return { r, u, d, lr, lu, cen, persp, D: persp ? R / tan((cam.fov ?? 40) * RAD / 2) + R : 0 };
}

/** Screen offset of a point from the picture's middle at scale 1 (y up), and its perspective factor. */
function project(v: View, x: number, y: number, z: number): [number, number, number] {
  const q: V3 = [x - v.cen[0], y - v.cen[1], z - v.cen[2]];
  const k = v.persp ? v.D / (v.D - dot(q, v.d)) : 1;
  return [dot(q, v.r) * k, dot(q, v.u) * k, k];
}

/**
 * The scale (picture pixels per model pixel) that fits the model into a `size` square in every one of the views,
 * with `margin` pixels free round the edge. The model turns about its box's middle, which sits in the middle of the
 * picture, so every view of a set shares one scale and one centre.
 */
export function fitScale(src: RenderSource, cams: CameraSpec[], size: number, margin: number): number {
  let ext = 0;
  const p = src.positions;
  for (const cam of cams) {
    const v = viewOf(src, cam);
    for (let i = 0; i < p.length; i += 3) {
      const [x, y] = project(v, p[i], p[i + 1], p[i + 2]);
      ext = Math.max(ext, Math.abs(x), Math.abs(y));
    }
  }
  return ext > 0 ? Math.max(1e-3, (size / 2 - margin) / ext) : 1;
}

/** Where the model's ground point (the middle of its base) lands in a `size` picture: [x, y], y down. */
export function groundPoint(src: RenderSource, cam: CameraSpec, size: number, scale: number): [number, number] {
  const v = viewOf(src, cam);
  const [x, y] = project(v, v.cen[0], src.lo[1], v.cen[2]);
  return [size / 2 + x * scale, size / 2 - y * scale];
}

const square = (a: number) => Math.abs(((a % 90) + 90) % 90) < 1e-6 || Math.abs(((a % 90) + 90) % 90 - 90) < 1e-6;

/** How much bigger to render before shrinking (the odd-angle fix). "Only when needed" skips it for straight views
    (a quarter turn, eye level or straight down, upright, flat camera) at a scale of at least 1, where every texture
    pixel lands on at least one picture pixel. */
export function supersampling(fix: FixCode, cam: CameraSpec, scale: number, size: number): number {
  if (fix === 'never') return 1;
  const k = Math.max(1, Math.min(4, Math.floor(1024 / size)));
  if (fix === 'always') return k;
  const straight = !cam.persp && !cam.oblique && square(cam.yaw) && (cam.elev === 0 || Math.abs(cam.elev) === 90) && square(cam.tilt ?? 0);
  return straight && scale >= 1 - 1e-9 ? 1 : k;
}

/** The light, fixed to the camera: from the upper left, a little in front. */
const LIGHT: V3 = (() => { const l: V3 = [-.5, .75, .55], n = Math.hypot(...l); return l.map(x => x / n) as V3; })();
const SHADOW = .55;

/** How bright a face is (1 = its texture colour), in `bands` hard steps. */
export function bandLevel(nDotL: number, bands: Bands): number {
  if (bands === 1) return 1;
  const lit = Math.max(0, Math.min(1, .35 + .75 * nDotL)); // ambient plus the light, clamped
  const step = Math.min(bands - 1, Math.floor(lit * bands));
  return SHADOW + (1 - SHADOW) * step / (bands - 1);
}

const shade = (c: number, f: number) => f === 1 ? c
  : (Math.min(255, Math.round((c >> 16) * f)) << 16) | (Math.min(255, Math.round(((c >> 8) & 255) * f)) << 8) | Math.min(255, Math.round((c & 255) * f));

/** The colour outlines are drawn in: a dark version of the colour they border. */
const OUTER = .3, INNER = .45;

export interface RenderedFrame {
  image: RGBAImage;
  /** Covered pixels (the model, without the outline). */
  cover: Uint8Array;
}

/**
 * Draws the model from one camera into a `size` square at `scale` picture pixels per model pixel. `shaded` false draws
 * the texture's own colours (unlit models). Outlines need a free pixel round the model; `fitScale` with a margin of
 * 1 leaves it.
 */
export function renderFrame(src: RenderSource, cam: CameraSpec, size: number, scale: number, look: LookSpec, shaded = true): RenderedFrame {
  const k = supersampling(look.fix, cam, scale, size), S = size * k, sc = scale * k, v = viewOf(src, cam);
  const P = src.positions, N = src.normals, I = src.indices, UV = src.uvs, tex = src.atlas, TW = tex.width, TH = tex.height;
  const nv = P.length / 3;
  // vertices on screen (sample space, y down) with their linear depth term: z towards the camera (flat camera) or
  // 1 / distance (perspective), bigger = nearer either way
  const vx = new Float32Array(nv), vy = new Float32Array(nv), vz = new Float32Array(nv);
  for (let i = 0; i < nv; i++) {
    const q: V3 = [P[i * 3] - v.cen[0], P[i * 3 + 1] - v.cen[1], P[i * 3 + 2] - v.cen[2]];
    const zc = dot(q, v.d), kk = v.persp ? v.D / (v.D - zc) : 1;
    vx[i] = S / 2 + dot(q, v.r) * sc * kk;
    vy[i] = S / 2 - dot(q, v.u) * sc * kk;
    vz[i] = v.persp ? 1 / (v.D - zc) : zc;
  }
  const col = new Uint32Array(S * S), near = new Float32Array(S * S).fill(-Infinity), tri = new Int32Array(S * S).fill(-1);
  const nt = I.length / 3;
  // each triangle's depth term as a plane over the screen (sample space): A x + B y + C
  const plane = new Float64Array(nt * 3), facingCos = new Float32Array(nt);
  const camPos: V3 = [v.cen[0] + v.d[0] * v.D, v.cen[1] + v.d[1] * v.D, v.cen[2] + v.d[2] * v.D];
  for (let t = 0; t < nt; t++) {
    let a = I[t * 3], b = I[t * 3 + 1], c = I[t * 3 + 2];
    const n: V3 = [N[a * 3], N[a * 3 + 1], N[a * 3 + 2]];
    const facing = v.persp ? dot(n, [camPos[0] - P[a * 3], camPos[1] - P[a * 3 + 1], camPos[2] - P[a * 3 + 2]]) : dot(n, v.d);
    if (facing <= 1e-9) continue;
    facingCos[t] = Math.abs(dot(n, v.d));
    let area = (vx[b] - vx[a]) * (vy[c] - vy[a]) - (vy[b] - vy[a]) * (vx[c] - vx[a]);
    if (Math.abs(area) < 1e-12) continue;
    if (area < 0) { const s = b; b = c; c = s; area = -area; }
    const level = shaded ? bandLevel(n[0] * dotL(v, 0) + n[1] * dotL(v, 1) + n[2] * dotL(v, 2), look.bands) : 1;
    // plane of the depth term through the three screen points
    const ax = vx[a], ay = vy[a], az = vz[a], bx = vx[b] - ax, by = vy[b] - ay, bz = vz[b] - az, cx = vx[c] - ax, cy = vy[c] - ay, cz = vz[c] - az;
    const PA = (bz * cy - cz * by) / (bx * cy - cx * by), PB = (cz * bx - bz * cx) / (bx * cy - cx * by);
    plane[t * 3] = PA; plane[t * 3 + 1] = PB; plane[t * 3 + 2] = az - PA * ax - PB * ay;
    const x0 = Math.max(0, Math.floor(Math.min(vx[a], vx[b], vx[c]))), x1 = Math.min(S - 1, Math.ceil(Math.max(vx[a], vx[b], vx[c])));
    const y0 = Math.max(0, Math.floor(Math.min(vy[a], vy[b], vy[c]))), y1 = Math.min(S - 1, Math.ceil(Math.max(vy[a], vy[b], vy[c])));
    const e = [[b, c], [c, a], [a, b]];
    // top-left rule, so neighbouring triangles never both or neither cover a pixel on their shared edge
    const bias = e.map(([p, q]) => { const dy = vy[q] - vy[p], dx = vx[q] - vx[p]; return dy < 0 || (dy === 0 && dx > 0) ? 0 : 1e-9; });
    for (let y = y0; y <= y1; y++) {
      const py = y + .5;
      for (let x = x0; x <= x1; x++) {
        const px = x + .5;
        const w0 = (vx[c] - vx[b]) * (py - vy[b]) - (vy[c] - vy[b]) * (px - vx[b]);
        if (w0 < bias[0]) continue;
        const w1 = (vx[a] - vx[c]) * (py - vy[c]) - (vy[a] - vy[c]) * (px - vx[c]);
        if (w1 < bias[1]) continue;
        const w2 = area - w0 - w1;
        if (w2 < bias[2]) continue;
        const b0 = w0 / area, b1 = w1 / area, b2 = w2 / area;
        const z = b0 * vz[a] + b1 * vz[b] + b2 * vz[c], i = y * S + x;
        if (z <= near[i]) continue;
        let tu: number, tv: number;
        if (v.persp) {
          tu = (b0 * UV[a * 2] * vz[a] + b1 * UV[b * 2] * vz[b] + b2 * UV[c * 2] * vz[c]) / z;
          tv = (b0 * UV[a * 2 + 1] * vz[a] + b1 * UV[b * 2 + 1] * vz[b] + b2 * UV[c * 2 + 1] * vz[c]) / z;
        } else {
          tu = b0 * UV[a * 2] + b1 * UV[b * 2] + b2 * UV[c * 2];
          tv = b0 * UV[a * 2 + 1] + b1 * UV[b * 2 + 1] + b2 * UV[c * 2 + 1];
        }
        const sx = Math.min(TW - 1, Math.max(0, Math.floor(tu * TW))), sy = Math.min(TH - 1, Math.max(0, Math.floor(tv * TH))), o = (sy * TW + sx) * 4;
        col[i] = shade((tex.data[o] << 16) | (tex.data[o + 1] << 8) | tex.data[o + 2], level);
        near[i] = z; tri[i] = t;
      }
    }
  }
  // shrink by the most common colour in each block (never by averaging, which would blur the pixels)
  const n2 = size * size;
  const oCol = new Uint32Array(n2), oNear = new Float32Array(n2).fill(-Infinity), oTri = new Int32Array(n2).fill(-1), cover = new Uint8Array(n2);
  if (k === 1) { oCol.set(col); oNear.set(near); oTri.set(tri); for (let i = 0; i < n2; i++) cover[i] = tri[i] >= 0 ? 1 : 0; }
  else {
    const cs: number[] = [], cn: number[] = [], cz: number[] = [], ct: number[] = [];
    for (let Y = 0; Y < size; Y++) for (let X = 0; X < size; X++) {
      cs.length = cn.length = cz.length = ct.length = 0;
      let covered = 0;
      for (let y = Y * k; y < Y * k + k; y++) for (let x = X * k; x < X * k + k; x++) {
        const i = y * S + x;
        if (tri[i] < 0) continue;
        covered++;
        const j = cs.indexOf(col[i]);
        if (j < 0) { cs.push(col[i]); cn.push(1); cz.push(near[i]); ct.push(tri[i]); }
        else { cn[j]++; if (near[i] > cz[j]) { cz[j] = near[i]; ct[j] = tri[i]; } }
      }
      if (covered * 2 < k * k) continue;
      let best = 0;
      for (let j = 1; j < cs.length; j++) if (cn[j] > cn[best] || (cn[j] === cn[best] && cz[j] > cz[best])) best = j;
      const o = Y * size + X;
      oCol[o] = cs[best]; oNear[o] = cz[best]; oTri[o] = ct[best]; cover[o] = 1;
    }
  }
  const out = new Uint8Array(n2 * 4);
  for (let i = 0; i < n2; i++) if (cover[i]) put(out, i, oCol[i]);
  if (look.outline) outline(out, cover, oCol, oNear, oTri, plane, size, k, v.persp, scale, src.stepGap ? { cos: facingCos, gap: src.stepGap } : null);
  return { image: { width: size, height: size, data: out }, cover };
}

/** The camera-fixed light in world axes, one component (uses the camera before its tilt). */
function dotL(v: View, axis: number) { return LIGHT[0] * v.lr[axis] + LIGHT[1] * v.lu[axis] + LIGHT[2] * v.d[axis]; }

function put(out: Uint8Array, i: number, c: number) { out[i * 4] = c >> 16; out[i * 4 + 1] = (c >> 8) & 255; out[i * 4 + 2] = c & 255; out[i * 4 + 3] = 255; }

/**
 * 1px outlines: every empty pixel next to the model (4-neighbours) and every pixel just behind a depth edge, where
 * a nearer part of the model stands in front of a farther one. A depth edge is where each of the two surfaces,
 * extended to the other pixel, misses it by more than about a model pixel, the nearer one in front; so creases,
 * where two faces meet, get no line (the light bands show them). Lines sit outside the nearer part, so it keeps its
 * size, and take a dark version of the nearer part's colour.
 */
function outline(out: Uint8Array, cover: Uint8Array, col: Uint32Array, near: Float32Array, tri: Int32Array, plane: Float64Array, size: number, k: number, persp: boolean, scale: number,
  step: { cos: Float32Array; gap: number } | null) {
  const depth = (z: number) => persp ? 1 / z : -z;
  const at = (t: number, X: number, Y: number) => plane[t * 3] * (X + .5) * k + plane[t * 3 + 1] * (Y + .5) * k + plane[t * 3 + 2];
  const gap = Math.max(1.2, 1.5 / scale); // in model pixels; a picture pixel may span several of them
  const lines = new Map<number, number>();
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (let Y = 0; Y < size; Y++) for (let X = 0; X < size; X++) {
    const p = Y * size + X;
    if (!cover[p]) continue;
    for (const [dx, dy] of dirs) {
      const qx = X + dx, qy = Y + dy;
      if (qx < 0 || qy < 0 || qx >= size || qy >= size) continue;
      const q = qy * size + qx;
      if (!cover[q]) { if (!lines.has(q) || darker(col[p], lines.get(q)!)) lines.set(q, shade(col[p], OUTER)); continue; }
      if (tri[q] === tri[p]) continue;
      // q behind p's surface, and p in front of q's surface
      const dq = depth(near[q]) - depth(at(tri[p], qx, qy)), dp = depth(at(tri[q], X, Y)) - depth(near[p]);
      if (!(dq > gap && dp > gap)) continue;
      // a step no deeper than the step gap, measured square to either surface, is a stair step, not a part in front
      if (step && Math.max(dq * step.cos[tri[p]], dp * step.cos[tri[q]]) <= step.gap) continue;
      { const c = shade(col[p], INNER); if (!lines.has(q) || darker(c, lines.get(q)!)) lines.set(q, c); }
    }
  }
  for (const [i, c] of lines) put(out, i, c);
}

const lum = (c: number) => (c >> 16) * .3 + ((c >> 8) & 255) * .59 + (c & 255) * .11;
const darker = (a: number, b: number) => lum(a) < lum(b);

// ------------------------------------------------------------------ colours

/** Snaps every visible pixel to the nearest palette colour, in place. */
export function snapImage(img: RGBAImage, palette: ArrayLike<number>) {
  if (!palette.length) return;
  const d = img.data, memo = new Map<number, number>();
  for (let i = 0; i < d.length; i += 4) {
    if (!d[i + 3]) continue;
    const c = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];
    let s = memo.get(c);
    if (s === undefined) memo.set(c, s = palette[nearestColour(c, palette)]);
    d[i] = s >> 16; d[i + 1] = (s >> 8) & 255; d[i + 2] = s & 255;
  }
}

/** Every visible colour of some pictures with how often it's used. */
export function colourCounts(imgs: RGBAImage[]): Map<number, number> {
  const m = new Map<number, number>();
  for (const img of imgs) for (let i = 0; i < img.data.length; i += 4) {
    if (!img.data[i + 3]) continue;
    const c = (img.data[i] << 16) | (img.data[i + 1] << 8) | img.data[i + 2];
    m.set(c, (m.get(c) ?? 0) + 1);
  }
  return m;
}

/** Brings some pictures down to at most `k` colours together (one shared palette), in place. */
export function limitColours(imgs: RGBAImage[], k: number) {
  const counts = colourCounts(imgs);
  if (counts.size <= k) return;
  const pal = quantize(counts, k);
  for (const img of imgs) snapImage(img, pal);
}

/** Reads a Lospec-style `.hex` palette (one RRGGBB per line, `#` optional). */
export function parseHexPalette(text: string): number[] {
  return text.split(/\r?\n/).map(l => l.trim().replace(/^#/, '')).filter(l => /^[0-9a-f]{6}$/i.test(l)).map(l => parseInt(l, 16));
}

/** The part of a picture holding visible pixels: [x, y, w, h] (all 0 when it's empty). */
export function contentBox(img: RGBAImage): [number, number, number, number] {
  let x0 = img.width, y0 = img.height, x1 = -1, y1 = -1;
  for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) {
    if (!img.data[(y * img.width + x) * 4 + 3]) continue;
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  return x1 < 0 ? [0, 0, 0, 0] : [x0, y0, x1 - x0 + 1, y1 - y0 + 1];
}

/** A rectangle of a picture as a new picture. */
export function cropImage(img: RGBAImage, x: number, y: number, w: number, h: number): RGBAImage {
  const out = new Uint8Array(w * h * 4);
  for (let r = 0; r < h; r++) out.set(img.data.subarray(((y + r) * img.width + x) * 4, ((y + r) * img.width + x + w) * 4), r * w * 4);
  return { width: w, height: h, data: out };
}

/** Copies a picture into a bigger one at (x, y). */
export function blit(dst: RGBAImage, src: RGBAImage, x: number, y: number) {
  for (let r = 0; r < src.height; r++) dst.data.set(src.data.subarray(r * src.width * 4, (r + 1) * src.width * 4), ((y + r) * dst.width + x) * 4);
}
