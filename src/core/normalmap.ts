/* Surface detail for the GLB (DESIGN.md §10), no dependency: the normal map ("Bumpy surface") in six styles, Grit on
   top of any of them, crevice shadows (ambient occlusion) and Shiny trims (a metallic-roughness map). They fake
   carved and embossed detail without adding triangles, the way pixel art itself suggests depth.

   Every style reads the texture atlas the same way first: patches of similar colour (a plank, a rivet, a lock plate)
   meet at clear colour changes, and darker pixels count as lower. Then each style turns that into a surface:
     Soft        each patch a raised tile with 2px bevels, height from brightness too, slopes by a Sobel filter
     Chiselled   the same tiles, but every pixel is either flat or one of 8 fixed bevel facets
     Terraced    every patch a flat plateau, brighter ones higher, with a 1px lip on the upper side of each step
     Engraved    only the dark side of each colour change is cut in, as a sharp V-groove; the rest stays flat
     Studded     every pixel its own little bevelled tile, whatever its colour
     Drawn light the artist's own shading read as facing: lighter than its surroundings faces the upper-left light

   The atlas holds each panel's crop with a 1px border repeating its edge pixels. Given those crops (`AtlasRect`),
   every lookup stays inside its own panel, so a panel never picks up grooves from its neighbour in the atlas, and the
   border gets its crop's own values. Normals are tangent space in the glTF convention (+X right, +Y towards the top
   of the picture); Studded and Engraved need detail inside a pixel, so their normal map is 4× or 2× the atlas size,
   still pixel-aligned under nearest filtering. */

import type { RGBAImage } from './types';
import { atan2, cos, sin } from './fmath';

export const BUMP_STYLES = ['soft', 'chisel', 'terrace', 'engrave', 'stud', 'lit'] as const;
export type BumpStyle = (typeof BUMP_STYLES)[number];

/** A panel's crop in the atlas, without its 1px border (TexturedMesh.rects). */
export interface AtlasRect { x: number; y: number; w: number; h: number }

export interface BumpSettings {
  style: BumpStyle;
  /** Bump strength, 1–10. */
  bump: number;
  /** Grit, 0 (off) to 10. */
  grit: number;
}

/** How many pixels a Soft or Chiselled patch's edge bevel runs in over. */
const BEVEL = 2;
/** Two neighbouring pixels belong to different patches when their colours differ by more than this (0–255 per
    channel, the largest channel difference). Shades within one material usually stay under it. */
const PATCH_EDGE = 40;
/** How much brightness adds to the height, next to the bevels (which run from 0 to 1). */
const BRIGHTNESS = .6;
/** The light the pixel art is assumed to be drawn with: from the upper left. */
const LIGHT_X = -Math.SQRT1_2, LIGHT_Y = Math.SQRT1_2;

/** Normal-map slope for the 1–10 Bump strength setting: how steep a slope of one height unit per pixel gets (Soft). */
export const bumpStrength = (setting: number) => .5 * Math.max(0, setting);
/** The fixed facet tilt (tan of its angle) of the crisp styles at a Bump strength setting: 6 gives about 35°. */
export const facetTilt = (setting: number) => .12 * Math.max(0, setting);

// ------------------------------------------------------------------ reading the atlas

/** The atlas as brightness and colour patches, with neighbour lookups kept inside each panel's crop. */
class Surface {
  readonly W: number; readonly H: number; readonly n: number;
  readonly lum: Float32Array;
  /** Per pixel: the crop it belongs to (its border included), or -1. */
  private owner: Int32Array;
  private box: Int32Array;
  constructor(readonly img: RGBAImage, rects?: AtlasRect[]) {
    const { width: W, height: H, data } = img;
    this.W = W; this.H = H; this.n = W * H;
    this.lum = new Float32Array(this.n);
    for (let i = 0; i < this.n; i++) this.lum[i] = (data[i * 4] * .299 + data[i * 4 + 1] * .587 + data[i * 4 + 2] * .114) / 255;
    const list = rects?.length ? rects : [{ x: 0, y: 0, w: W, h: H }];
    this.owner = new Int32Array(this.n).fill(-1);
    this.box = new Int32Array(list.length * 4);
    list.forEach((r, k) => {
      this.box.set([r.x, r.y, r.x + r.w - 1, r.y + r.h - 1], k * 4);
      for (let y = Math.max(0, r.y - 1); y <= Math.min(H - 1, r.y + r.h); y++)
        for (let x = Math.max(0, r.x - 1); x <= Math.min(W - 1, r.x + r.w); x++) this.owner[y * W + x] = k;
    });
  }
  /** The crop bounds [x0, y0, x1, y1] of pixel i (the whole picture when it's in none). */
  bounds(i: number): [number, number, number, number] {
    const k = this.owner[i];
    return k < 0 ? [0, 0, this.W - 1, this.H - 1] : [this.box[k * 4], this.box[k * 4 + 1], this.box[k * 4 + 2], this.box[k * 4 + 3]];
  }
  /** The pixel whose values pixel i takes: itself inside a crop, the nearest crop pixel on its border. */
  home(i: number): number {
    const [x0, y0, x1, y1] = this.bounds(i), x = i % this.W, y = (i - x) / this.W;
    return Math.min(y1, Math.max(y0, y)) * this.W + Math.min(x1, Math.max(x0, x));
  }
  /** The neighbour (dx, dy) of pixel i, clamped to i's crop. */
  at(i: number, dx: number, dy: number): number {
    const [x0, y0, x1, y1] = this.bounds(i), x = i % this.W, y = (i - x) / this.W;
    return Math.min(y1, Math.max(y0, y + dy)) * this.W + Math.min(x1, Math.max(x0, x + dx));
  }
  /** Do pixels i and j belong to different colour patches? */
  differs(i: number, j: number): boolean {
    const d = this.img.data;
    return Math.max(Math.abs(d[i * 4] - d[j * 4]), Math.abs(d[i * 4 + 1] - d[j * 4 + 1]), Math.abs(d[i * 4 + 2] - d[j * 4 + 2])) > PATCH_EDGE;
  }
  /** Brightness minus the average brightness around it (5 × 5), from about -0.5 to 0.5. */
  relief(): Float32Array {
    return this.map(i => {
      let s = 0;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) s += this.lum[this.at(i, dx, dy)];
      return this.lum[i] - s / 25;
    });
  }
  /** A value per pixel, worked out on crop pixels and copied onto their borders. */
  map(f: (i: number) => number): Float32Array {
    const out = new Float32Array(this.n);
    for (let i = 0; i < this.n; i++) if (this.home(i) === i) out[i] = f(i);
    for (let i = 0; i < this.n; i++) { const h = this.home(i); if (h !== i) out[i] = out[h]; }
    return out;
  }
}

/** Soft's height of every pixel, 0 (deepest) to about 1.6 (the middle of a bright patch): patches are tiles with
    bevelled edges, and brightness adds height. */
function tileHeights(s: Surface): Float32Array {
  const { n } = s;
  // distance to the nearest patch edge, in 8-connected steps within the crop (edge pixels themselves are 0)
  const dist = new Int32Array(n).fill(-1), queue = new Int32Array(n);
  let head = 0, tail = 0;
  for (let i = 0; i < n; i++) {
    if (s.home(i) !== i) continue;
    if (s.differs(i, s.at(i, -1, 0)) || s.differs(i, s.at(i, 1, 0)) || s.differs(i, s.at(i, 0, -1)) || s.differs(i, s.at(i, 0, 1))) { dist[i] = 0; queue[tail++] = i; }
  }
  while (head < tail) {
    const i = queue[head++];
    if (dist[i] >= BEVEL) continue;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const j = s.at(i, dx, dy);
      if (dist[j] < 0) { dist[j] = dist[i] + 1; queue[tail++] = j; }
    }
  }
  return s.map(i => (dist[i] < 0 ? 1 : Math.min(BEVEL, dist[i]) / BEVEL) + s.lum[i] * BRIGHTNESS);
}

/** Engraved's cut pixels: the darker side of every clear colour change. */
function inkOf(s: Surface): Uint8Array {
  const ink = new Uint8Array(s.n), f = s.map(i => {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const j = s.at(i, dx, dy);
      if (j !== i && s.differs(i, j) && s.lum[j] > s.lum[i]) return 1;
    }
    return 0;
  });
  for (let i = 0; i < s.n; i++) ink[i] = f[i];
  return ink;
}

/** The height field a style's crevice shadows come from (same scale as Soft: about 0 to 1.6). */
function heightsFor(s: Surface, style: BumpStyle): Float32Array {
  if (style === 'terrace') return s.map(i => s.lum[i] * 1.6);
  if (style === 'engrave') { const ink = inkOf(s); return s.map(i => (ink[i] ? .4 : 1)); }
  return tileHeights(s);
}

// ------------------------------------------------------------------ the normal map

/** How much bigger than the atlas a style's normal map is. */
export const normalScale = (style: BumpStyle) => (style === 'stud' ? 4 : style === 'engrave' ? 2 : 1);

/** A cheap stable hash of a pixel, 0–1, for Grit. */
const hash = (x: number, y: number, k: number) => {
  let h = (x * 374761393 + y * 668265263 + k * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

/** The normal map of an atlas: `normalScale(style)` times its size. `rects` are the panel crops (see AtlasRect). */
export function normalMapOf(img: RGBAImage, o: BumpSettings, rects?: AtlasRect[]): RGBAImage {
  const s = new Surface(img, rects), { W, H } = s, sc = normalScale(o.style);
  const T = facetTilt(o.bump), k = bumpStrength(o.bump);
  /** The slope (nx, ny) of sub-pixel (sx, sy) of crop pixel i: the normal is (nx, ny, 1), normalised. */
  let slope: (i: number, sx: number, sy: number) => [number, number];
  if (o.style === 'soft') {
    const h = tileHeights(s);
    const gx = new Float32Array(s.n), gy = new Float32Array(s.n);
    for (let i = 0; i < s.n; i++) {
      if (s.home(i) !== i) continue;
      const a = (dx: number, dy: number) => h[s.at(i, dx, dy)];
      gx[i] = ((a(1, -1) + 2 * a(1, 0) + a(1, 1)) - (a(-1, -1) + 2 * a(-1, 0) + a(-1, 1))) / 8;
      gy[i] = ((a(-1, 1) + 2 * a(0, 1) + a(1, 1)) - (a(-1, -1) + 2 * a(0, -1) + a(1, -1))) / 8;
    }
    // the surface tilts away from uphill; picture rows run down while +Y runs up
    slope = i => [-gx[i] * k, gy[i] * k];
  } else if (o.style === 'chisel') {
    // a 1px chamfer round every patch: an edge pixel faces the patches it borders, snapped to one of 8 directions,
    // so neighbouring patches meet in a sharp V; a pixel with other patches on opposite sides stays flat
    const tx = new Float32Array(s.n), ty = new Float32Array(s.n);
    for (let i = 0; i < s.n; i++) {
      if (s.home(i) !== i) continue;
      let vx = 0, vy = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const j = s.at(i, dx, dy);
        if (j === i || !s.differs(i, j)) continue;
        const w = dx && dy ? .5 : 1;
        vx += dx * w; vy -= dy * w;
      }
      if (Math.hypot(vx, vy) < .75) continue;
      const a = Math.round(atan2(vy, vx) / (Math.PI / 4)) * (Math.PI / 4);
      tx[i] = cos(a) * T; ty[i] = sin(a) * T;
    }
    slope = i => [tx[i], ty[i]];
  } else if (o.style === 'terrace') {
    // a pixel on the upper side of a step tilts down towards every lower patch next to it
    const tx = new Float32Array(s.n), ty = new Float32Array(s.n);
    for (let i = 0; i < s.n; i++) {
      if (s.home(i) !== i) continue;
      let vx = 0, vy = 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const j = s.at(i, dx, dy);
        if (j !== i && s.differs(i, j) && s.lum[j] < s.lum[i]) { vx += dx; vy -= dy; }
      }
      const m = Math.hypot(vx, vy);
      if (m) { tx[i] = vx / m * T * 1.4; ty[i] = vy / m * T * 1.4; }
    }
    slope = i => [tx[i], ty[i]];
  } else if (o.style === 'engrave') {
    // each cut pixel is a V-groove: its half next to an uncut neighbour is a wall facing away from that neighbour
    const ink = inkOf(s);
    slope = (i, sx, sy) => {
      if (!ink[i]) return [0, 0];
      const ddx = sx ? 1 : -1, ddy = sy ? 1 : -1;
      const side = !ink[s.at(i, ddx, 0)], vert = !ink[s.at(i, 0, ddy)];
      let nx = side ? -ddx * T : 0, ny = vert ? ddy * T : 0;
      if (!side && !vert && !ink[s.at(i, ddx, ddy)]) { nx = -ddx * T * Math.SQRT1_2; ny = ddy * T * Math.SQRT1_2; }
      return [nx, ny];
    };
  } else if (o.style === 'stud') {
    // every pixel a raised tile: its outer ring of sub-pixels is the bevel
    slope = (_i, sx, sy) => [sx === 0 ? -T : sx === sc - 1 ? T : 0, sy === 0 ? T : sy === sc - 1 ? -T : 0];
  } else {
    // drawn light: lighter than the surroundings faces the light, darker faces away
    const rel = s.relief();
    slope = i => [LIGHT_X * rel[i] * k * 1.2, LIGHT_Y * rel[i] * k * 1.2];
  }

  // Grit: a stable random tilt per pixel, stronger where the colours around it vary
  const grit = o.grit > 0 ? s.map(i => {
    let v = 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) v += Math.abs(s.lum[i] - s.lum[s.at(i, dx, dy)]);
    return o.grit * .05 * (.35 + .65 * Math.min(1, v / 4 / .1));
  }) : null;

  const OW = W * sc, OH = H * sc, out = new Uint8Array(OW * OH * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, home = s.home(i), hx = home % W, hy = (home - hx) / W;
    let gnx = 0, gny = 0;
    if (grit) {
      const a = hash(hx, hy, 1) * Math.PI * 2, m = grit[home] * (.5 + .5 * hash(hx, hy, 2));
      gnx = cos(a) * m; gny = sin(a) * m;
    }
    for (let sy = 0; sy < sc; sy++) for (let sx = 0; sx < sc; sx++) {
      // a border pixel repeats the sub-pixels of its crop's edge that face it
      const qx = hx < x ? sc - 1 : hx > x ? 0 : sx, qy = hy < y ? sc - 1 : hy > y ? 0 : sy;
      const [px, py] = slope(home, qx, qy);
      let nx = px + gnx, ny = py + gny, nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len; ny /= len; nz /= len;
      const o4 = ((y * sc + sy) * OW + x * sc + sx) * 4;
      out[o4] = Math.round((nx * .5 + .5) * 255); out[o4 + 1] = Math.round((ny * .5 + .5) * 255); out[o4 + 2] = Math.round((nz * .5 + .5) * 255); out[o4 + 3] = 255;
    }
  }
  return { width: OW, height: OH, data: out };
}

// ------------------------------------------------------------------ crevice shadows and shiny trims

/** How much light reaches each pixel (1 = all, 0 = none) at a Crevice depth setting (1–10): from the style's height
    field, by how high the surface rises around the pixel in 8 directions within 3 pixels (horizon-based ambient
    occlusion). */
export function occlusionOf(img: RGBAImage, style: BumpStyle, depth: number, rects?: AtlasRect[]): Float32Array {
  const s = new Surface(img, rects), h = heightsFor(s, style), scale = .25 * Math.max(0, depth);
  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  return s.map(i => {
    let occ = 0;
    for (const [dx, dy] of DIRS) {
      const len = Math.hypot(dx, dy);
      let m = 0;
      for (let r = 1; r <= 3; r++) m = Math.max(m, (h[s.at(i, dx * r, dy * r)] - h[i]) * scale / (r * len));
      occ += m / Math.hypot(1, m);
    }
    return Math.max(0, 1 - occ / DIRS.length * 1.6);
  });
}

/** Crevice shadows as a grey picture, for the glTF occlusion texture (it reads the red channel). */
export function occlusionMapOf(img: RGBAImage, style: BumpStyle, depth: number, rects?: AtlasRect[]): RGBAImage {
  const ao = occlusionOf(img, style, depth, rects), data = new Uint8Array(ao.length * 4);
  for (let i = 0; i < ao.length; i++) { const v = Math.round(ao[i] * 255); data.set([v, v, v, 255], i * 4); }
  return { width: img.width, height: img.height, data };
}

/** The atlas with crevice shadows painted into its colours. */
export function shadedAtlas(img: RGBAImage, style: BumpStyle, depth: number, rects?: AtlasRect[]): RGBAImage {
  const ao = occlusionOf(img, style, depth, rects), data = new Uint8Array(img.data);
  for (let i = 0; i < ao.length; i++) for (let c = 0; c < 3; c++) data[i * 4 + c] = Math.round(img.data[i * 4 + c] * ao[i]);
  return { width: img.width, height: img.height, data };
}

export type TrimMode = 'glossy' | 'metal';
/** Roughness of a trim pixel at most (it's never rougher than the row's own value). */
const TRIM_ROUGHNESS = .25;

/** Shiny trims: a glTF metallic-roughness texture (green = roughness, blue = metallic) that holds the row's own Metal
    and Rough values, except on pixels lighter than their surroundings (light trims, rivets, edges), which get glossy,
    and metallic too with 'metal'. The material's factors must then be 1. */
export function trimMapOf(img: RGBAImage, mode: TrimMode, metallic: number, roughness: number, rects?: AtlasRect[]): RGBAImage {
  const s = new Surface(img, rects), rel = s.relief(), data = new Uint8Array(s.n * 4);
  const trimRough = Math.min(roughness, TRIM_ROUGHNESS), trimMetal = mode === 'metal' ? 1 : metallic;
  for (let i = 0; i < s.n; i++) {
    const t = Math.min(1, Math.max(0, (rel[i] - .03) / .09));
    data.set([255, Math.round((roughness + (trimRough - roughness) * t) * 255), Math.round((metallic + (trimMetal - metallic) * t) * 255), 255], i * 4);
  }
  return { width: s.W, height: s.H, data };
}
