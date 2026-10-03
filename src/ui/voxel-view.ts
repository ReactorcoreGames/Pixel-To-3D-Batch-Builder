/* The ② preview's 3D views on Three.js: the low-poly mesh with its texture (Model tab, what the GLB holds) and the
   voxel model (Voxels tab, with Peel and the inside style). Until the mesh library has loaded, the Model tab shows
   the voxel surface.
   The camera looks from the front-right, 30° up, like the mockup, or 30° from below with the low camera (to see the
   bottom; the model isn't flipped, so it stays lit from above, and the floor is hidden). The model turns in eighth
   turns. Shading is flat and fixed to the camera (tops brightest, then the face turned to the viewer's left, then the
   right, the bottom darker), so turning the model never darkens it.
   Red ghost cubes (cut-off paint) are drawn on the 2D overlay canvas on top, where they blink. */

import * as THREE from 'three';
import { keepsVoxel, type ColouredModel, type InsideCode, type InsideShader, type RGBAImage, type TexturedMesh, type VoxelModel } from '../core';

export interface VoxelViewOptions {
  mode: 'poly' | 'vox';
  /** Eighth turns (45°) to the right. */
  rot: number;
  /** The low camera: from below, looking up. */
  low: boolean;
  /** The light preview background: darker floor lines and split plane edge. */
  light: boolean;
  peel: { axis: 'front' | 'top'; n: number } | null;
  /** Colours for the voxels inside (Voxels tab only). */
  inside: InsideShader | null;
  /** Cache key for `inside`: its settings, including the hollow core. */
  insideKey: string;
  /** The inside style and hollow core, which decide which inside voxels exist (as in the .vox file). */
  insideCode: InsideCode;
  hollowCore: number;
  /** Draw the split plane on this axis. */
  plane: 0 | 1 | 2 | null;
  /** Cube voxels to mark as cut-off paint. */
  ghosts: [number, number, number][];
  /** Model tab: the low-poly mesh (null = draw the voxel surface instead). */
  mesh: TexturedMesh | null;
  /** Model tab: the colour texture, when it isn't the mesh's own atlas (crevice shadows painted in). */
  atlas: RGBAImage | null;
  /** Model tab: surface detail for the mesh's atlas (DESIGN.md §10): normal map, crevice shadows, shiny trims. */
  normalMap: RGBAImage | null;
  occlusionMap: RGBAImage | null;
  trimMap: RGBAImage | null;
  /** Model tab: the Unlit material, drawn without shading. */
  unlit: boolean;
}

const VERT = /* glsl */ `
  varying vec3 vColor; varying vec2 vUv; varying vec3 vN;
  void main() {
    vColor = color; vUv = uv; vN = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;
const FRAG = /* glsl */ `
  uniform vec3 shade; uniform float dim; uniform float under; uniform float edges;
  varying vec3 vColor; varying vec2 vUv; varying vec3 vN;
  void main() {
    float f = vN.y > .5 ? shade.x : vN.z > .5 ? shade.y : vN.x > .5 ? shade.z : vN.y < -.5 ? under : dim;
    vec3 c = vColor * f;
    if (edges > .5) {
      vec2 e = min(vUv, 1.0 - vUv) / fwidth(vUv);
      c = mix(c, vec3(15.0, 8.0, 30.0) / 255.0, .45 * (1.0 - clamp(min(e.x, e.y), 0.0, 1.0)));
    }
    gl_FragColor = vec4(c, 1.0);
  }`;

// the low-poly mesh: its texture, shaded the same camera-fixed way but smoothly for slanted faces, optionally with
// the normal map (tangent frame from screen-space derivatives; glTF's picture-down v means green is flipped), the
// crevice shadows and the shiny trims' highlight
const MESH_VERT = /* glsl */ `
  varying vec2 vUv; varying vec3 vN; varying vec3 vPos;
  void main() {
    vUv = uv; vN = normalize(mat3(modelMatrix) * normal); vPos = (modelMatrix * vec4(position, 1.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;
const MESH_FRAG = /* glsl */ `
  uniform sampler2D map; uniform sampler2D nmap; uniform float useN; uniform float lit; uniform vec3 shade; uniform float dim; uniform float under;
  uniform sampler2D aomap; uniform float useAO; uniform sampler2D mrmap; uniform float useMR;
  varying vec2 vUv; varying vec3 vN; varying vec3 vPos;
  float light(vec3 n) {
    vec3 q = n * n;
    return q.x * (n.x > 0.0 ? shade.z : dim) + q.y * (n.y > 0.0 ? shade.x : under) + q.z * (n.z > 0.0 ? shade.y : dim);
  }
  vec3 perturb(vec3 N) {
    vec3 m = texture2D(nmap, vUv).xyz * 2.0 - 1.0; m.y = -m.y;
    vec3 q0 = dFdx(vPos), q1 = dFdy(vPos); vec2 st0 = dFdx(vUv), st1 = dFdy(vUv);
    vec3 q1p = cross(q1, N), q0p = cross(N, q0);
    vec3 T = q1p * st0.x + q0p * st1.x, B = q1p * st0.y + q0p * st1.y;
    float det = max(dot(T, T), dot(B, B)), sc = det == 0.0 ? 0.0 : inversesqrt(det);
    return normalize(T * (m.x * sc) + B * (m.y * sc) + N * m.z);
  }
  // with bumps, a key light from the upper left of the view shows the carving: each pixel is lit by how its bumped
  // normal faces the key, relative to the face's own normal, so the face keeps its usual tone on average
  const vec3 KEY = vec3(-0.45, 0.75, 0.5);
  void main() {
    vec3 N0 = normalize(vN), N = N0;
    vec3 c = texture2D(map, vUv).rgb;
    float f = light(N0);
    vec3 K = normalize(KEY);
    if (useN > 0.5) {
      N = perturb(N0);
      f *= clamp(1.0 + 1.1 * (dot(N, K) - dot(N0, K)), 0.25, 1.9);
    }
    // engines darken mostly the ambient part of the light with it, so the preview doesn't go all the way
    if (useAO > 0.5) f *= mix(1.0, texture2D(aomap, vUv).r, 0.8);
    vec3 col = lit > 0.5 ? c * f : c;
    // shiny trims: glossy pixels pick up a sheen (standing in for the sky and room an engine reflects) and a
    // highlight of the key light, both stronger the glossier the pixel, tinted by the colour when metallic
    if (useMR > 0.5 && lit > 0.5) {
      vec2 mr = texture2D(mrmap, vUv).gb;
      float rough = max(mr.x, 0.05), gloss = 1.0 - rough;
      vec3 H = normalize(K + normalize(cameraPosition - vPos));
      float spec = pow(max(dot(N, H), 0.0), clamp(2.0 / (rough * rough), 2.0, 256.0)) * gloss;
      float sheen = gloss * gloss * 0.5 * (0.5 + 0.5 * max(dot(N, K), 0.0));
      col += (spec + sheen) * mix(vec3(1.0), c * 1.6, mr.y);
    }
    gl_FragColor = vec4(col, 1.0);
  }`;

let renderer: THREE.WebGLRenderer | null = null, failed = false;
const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -2000, 2000);
const group = new THREE.Group();
scene.add(group);
const material = new THREE.ShaderMaterial({
  vertexShader: VERT, fragmentShader: FRAG, vertexColors: true, side: THREE.DoubleSide,
  uniforms: { shade: { value: new THREE.Vector3(1.12, .9, .68) }, dim: { value: .55 }, under: { value: .55 }, edges: { value: 0 } },
});
const meshMaterial = new THREE.ShaderMaterial({
  vertexShader: MESH_VERT, fragmentShader: MESH_FRAG, side: THREE.FrontSide,
  uniforms: { map: { value: null }, nmap: { value: null }, useN: { value: 0 }, aomap: { value: null }, useAO: { value: 0 }, mrmap: { value: null }, useMR: { value: 0 }, lit: { value: 1 }, shade: { value: new THREE.Vector3(1.08, .92, .74) }, dim: { value: .55 }, under: { value: .55 } },
});
let mesh: THREE.Mesh | null = null, meshKey = '', floor: THREE.Group | null = null, floorKey = '';
let planeObj: THREE.Object3D | null = null;
// the camera looks from the front-right, 30° up (30° from below with the low camera)
const camDir = (low: boolean) => new THREE.Vector3(Math.sin(Math.PI / 4) * Math.cos(Math.PI / 6), (low ? -1 : 1) * Math.sin(Math.PI / 6), Math.cos(Math.PI / 4) * Math.cos(Math.PI / 6));
// the bottom's tone: with the low camera it faces the viewer, so it gets a mid tone (still darker than the sides, as
// the light comes from above) instead of the shadow tone of the faces turned away
const UNDER_LOW = .74;

function getRenderer(canvas: HTMLCanvasElement): THREE.WebGLRenderer | null {
  if (renderer || failed) return renderer;
  try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true }); renderer.setClearColor(0x000000, 0); }
  catch { failed = true; }
  return renderer;
}

/** The model axis and direction that currently face the viewer (what "Front" peels): the side at the viewer's lower
    left when looking at a corner, and the side facing the camera straight on at the in-between turns. */
function frontAxis(rot: number): [0 | 2, 1 | -1] {
  const toward = turnStep(rot) % 2 ? new THREE.Vector3(1, 0, 1).normalize() : new THREE.Vector3(0, 0, 1);
  const v = toward.applyAxisAngle(new THREE.Vector3(0, 1, 0), -turnAngle(rot));
  return Math.abs(v.x) > .5 ? [0, v.x > 0 ? 1 : -1] : [2, v.z > 0 ? 1 : -1];
}
const turnStep = (rot: number) => ((rot % 8) + 8) % 8;
/** Group rotation for a number of eighth turns to the right: clockwise seen from above, so the front moves to the
    viewer's left, as in the mockup. Even steps look at a corner (as the mockup), odd steps straight at a side. */
const turnAngle = (rot: number) => -turnStep(rot) * Math.PI / 4;

const FACES: [number, number, number][] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
// the four corners of each face, counter-clockwise seen from outside, as offsets from the voxel's low corner
const CORNERS: number[][][] = [
  [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]], [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]],
  [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]],
  [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]],
];
const UVS = [0, 0, 1, 0, 1, 1, 0, 1];

type VoxelFn<T> = (i: number, x: number, y: number, z: number) => T;

/** One mesh of every voxel face that borders empty space. Colours (0xRRGGBB) are only worked out for voxels that
    show a face, since some inside styles are costly. */
function buildGeometry(m: VoxelModel, shown: VoxelFn<boolean>, colour: VoxelFn<number>, centre: number[]): THREE.BufferGeometry {
  const { n, lo, hi } = m;
  const box = [hi[0] - lo[0] + 1, hi[1] - lo[1] + 1, hi[2] - lo[2] + 1];
  const on = new Uint8Array(box[0] * box[1] * box[2]), cols = new Int32Array(on.length).fill(-1);
  const at = (x: number, y: number, z: number) => ((z - lo[2]) * box[1] + (y - lo[1])) * box[0] + (x - lo[0]);
  for (let z = lo[2]; z <= hi[2]; z++) for (let y = lo[1]; y <= hi[1]; y++) for (let x = lo[0]; x <= hi[0]; x++) {
    const i = (z * n + y) * n + x;
    if (m.solid[i] && shown(i, x, y, z)) on[at(x, y, z)] = 1;
  }
  const filled = (x: number, y: number, z: number) => x >= lo[0] && y >= lo[1] && z >= lo[2] && x <= hi[0] && y <= hi[1] && z <= hi[2] && on[at(x, y, z)] === 1;
  let faces = 0;
  for (let pass = 0; pass < 2; pass++) {
    const pos = pass ? new Float32Array(faces * 12) : null, nor = pass ? new Float32Array(faces * 12) : null;
    const col = pass ? new Uint8Array(faces * 12) : null, uv = pass ? new Float32Array(faces * 8) : null;
    let f = 0;
    for (let z = lo[2]; z <= hi[2]; z++) for (let y = lo[1]; y <= hi[1]; y++) for (let x = lo[0]; x <= hi[0]; x++) {
      const a = at(x, y, z);
      if (!on[a]) continue;
      for (let d = 0; d < 6; d++) {
        const [dx, dy, dz] = FACES[d];
        if (filled(x + dx, y + dy, z + dz)) continue;
        if (pass) {
          if (cols[a] < 0) cols[a] = colour((z * n + y) * n + x, x, y, z);
          const c = cols[a];
          for (let k = 0; k < 4; k++) {
            const o = (f * 4 + k) * 3, cc = CORNERS[d][k];
            pos![o] = x + cc[0] - centre[0]; pos![o + 1] = y + cc[1] - centre[1]; pos![o + 2] = z + cc[2] - centre[2];
            nor![o] = dx; nor![o + 1] = dy; nor![o + 2] = dz;
            col![o] = c >> 16; col![o + 1] = (c >> 8) & 255; col![o + 2] = c & 255;
            uv![(f * 4 + k) * 2] = UVS[k * 2]; uv![(f * 4 + k) * 2 + 1] = UVS[k * 2 + 1];
          }
        }
        f++;
      }
    }
    if (!pass) { faces = f; continue; }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos!, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor!, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col!, 3, true));
    g.setAttribute('uv', new THREE.BufferAttribute(uv!, 2));
    const index = new Uint32Array(faces * 6);
    for (let q = 0; q < faces; q++) index.set([q * 4, q * 4 + 1, q * 4 + 2, q * 4, q * 4 + 2, q * 4 + 3], q * 6);
    g.setIndex(new THREE.BufferAttribute(index, 1));
    return g;
  }
  throw new Error('unreachable');
}

/** The low-poly mesh as a Three.js geometry, centred like the voxel view. */
function polyGeometry(t: TexturedMesh, centre: number[]): THREE.BufferGeometry {
  const pos = new Float32Array(t.positions.length);
  for (let i = 0; i < pos.length; i++) pos[i] = t.positions[i] - centre[i % 3];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(t.normals, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(t.uvs, 2));
  g.setIndex(new THREE.BufferAttribute(t.indices, 1));
  return g;
}

/** A picture as a texture with nearest filtering, rows top to bottom (glTF's texture coordinates). */
function pixelTexture(img: RGBAImage): THREE.DataTexture {
  const tex = new THREE.DataTexture(img.data, img.width, img.height, THREE.RGBAFormat);
  tex.magFilter = tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false; tex.flipY = false; tex.needsUpdate = true;
  return tex;
}

/** The floor under the model: a dark plate with a faint grid, as in the mockup (plum on the light background). */
function makeFloor(sx: number, sz: number, bottom: number, light: boolean): THREE.Group {
  const g = new THREE.Group(), pad = 1.5;
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(sx + pad * 2, sz + pad * 2), new THREE.MeshBasicMaterial({ color: light ? 0x3b3163 : 0x0a0618, transparent: true, opacity: light ? .16 : .35, depthWrite: false }));
  plate.rotation.x = -Math.PI / 2;
  const pts: number[] = [], sx2 = sx / 2, sz2 = sz / 2;
  for (let i = 0; i <= sx; i += Math.max(1, Math.round(sx / 8))) pts.push(i - sx2, 0, -sz2 - pad, i - sx2, 0, sz2 + pad);
  for (let i = 0; i <= sz; i += Math.max(1, Math.round(sz / 8))) pts.push(-sx2 - pad, 0, i - sz2, sx2 + pad, 0, i - sz2);
  const lines = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)), new THREE.LineBasicMaterial({ color: light ? 0x3b3163 : 0xb9aee0, transparent: true, opacity: light ? .3 : .12, depthWrite: false }));
  g.add(plate, lines);
  g.position.y = bottom - .01;
  g.renderOrder = -1;
  return g;
}

function disposeTree(o: THREE.Object3D) {
  o.traverse(c => {
    const any = c as THREE.Mesh;
    any.geometry?.dispose();
    const mat = any.material as THREE.Material | THREE.Material[] | undefined;
    if (mat && mat !== material) (Array.isArray(mat) ? mat : [mat]).forEach(x => x.dispose());
  });
}

export interface DrawnView {
  /** The deepest peel for the current turn and axis. */
  peelMax: number;
  /** Screen position (CSS px) of a model-cube point. */
  project: (x: number, y: number, z: number) => [number, number];
}

/** Draws the model into `canvas` (WebGL) at the given CSS size. Returns null when WebGL isn't available. */
export function drawVoxelView(canvas: HTMLCanvasElement, overlay: HTMLCanvasElement, W: number, H: number, m: VoxelModel, c: ColouredModel, o: VoxelViewOptions, key: string): DrawnView | null {
  const r = getRenderer(canvas);
  if (!r) return null;
  const dpr = window.devicePixelRatio || 1;
  r.setPixelRatio(dpr);
  r.setSize(W, H, true);
  const { lo, hi } = m;
  const centre = [0, 1, 2].map(k => (lo[k] + hi[k] + 1) / 2);
  const size = [0, 1, 2].map(k => hi[k] - lo[k] + 1);

  // peel: which model axis is "front" at this turn, and how deep we may go
  const [fAxis, fSign] = frontAxis(o.rot);
  // "Top" peels the lid the camera looks at: the bottom with the low camera
  const peelAxis = o.peel?.axis === 'top' ? 1 : fAxis, peelSign = o.peel?.axis === 'top' ? (o.low ? -1 : 1) : fSign;
  const peelMax = Math.max(1, size[peelAxis] - 1);
  const peelN = o.mode === 'vox' && o.peel ? Math.min(o.peel.n, peelMax) : 0;
  const peeled = (x: number, y: number, z: number) => {
    const v = peelAxis === 0 ? x : peelAxis === 1 ? y : z;
    return peelSign > 0 ? v > hi[peelAxis] - peelN : v < lo[peelAxis] + peelN;
  };

  const poly = o.mode === 'poly' && o.mesh ? o.mesh : null;
  const gkey = [key, o.mode, poly ? 'mesh' : '', o.mode === 'vox' ? o.insideKey : '', peelN ? `${peelAxis}${peelSign}${peelN}` : ''].join('|');
  if (gkey !== meshKey) {
    if (mesh) { group.remove(mesh); mesh.geometry.dispose(); }
    if (poly) {
      mesh = new THREE.Mesh(polyGeometry(poly, centre), meshMaterial);
    } else {
      const inside = o.mode === 'vox' ? o.inside : null;
      // the voxels the .vox file holds (Hollow and a hollow core leave out the middle); peeled layers are gone
      const shown: VoxelFn<boolean> = (i, x, y, z) => !(peelN && peeled(x, y, z)) && (!inside || keepsVoxel(c.dist[i], o.insideCode, o.hollowCore));
      const colour: VoxelFn<number> = (i, x, y, z) => (c.dist[i] === 1 || !inside ? c.colour[i] : inside(x, y, z, c.dist[i], c.deep[i], c.colour[i]));
      mesh = new THREE.Mesh(buildGeometry(m, shown, colour, centre), material);
    }
    group.add(mesh);
    meshKey = gkey;
  }
  if (poly) {
    const u = meshMaterial.uniforms;
    // each texture is swapped only when its picture changed
    const setTex = (name: string, img: RGBAImage | null) => {
      if (u[name].value?.image?.data === img?.data) return;
      (u[name].value as THREE.Texture | null)?.dispose();
      u[name].value = img ? pixelTexture(img) : null;
    };
    setTex('map', o.atlas ?? poly.atlas);
    setTex('nmap', o.normalMap); setTex('aomap', o.occlusionMap); setTex('mrmap', o.trimMap);
    u.useN.value = o.normalMap && !o.unlit ? 1 : 0;
    u.useAO.value = o.occlusionMap && !o.unlit ? 1 : 0;
    u.useMR.value = o.trimMap && !o.unlit ? 1 : 0;
    u.lit.value = o.unlit ? 0 : 1;
  }
  const fkey = size.join(',') + (o.light ? 'L' : '');
  if (fkey !== floorKey) {
    if (floor) { group.remove(floor); disposeTree(floor); }
    floor = makeFloor(size[0], size[2], -size[1] / 2, o.light);
    group.add(floor);
    floorKey = fkey;
  }
  // from below, the floor would sit between the camera and the model
  floor!.visible = !o.low;
  group.rotation.y = turnAngle(o.rot);
  group.updateMatrixWorld(true);

  // fit the camera to the model's box (and the floor) so it fills about three quarters of the stage, at whichever of
  // the eight turns needs the most room, so the model keeps its size while it's turned
  camera.position.copy(camDir(o.low)).multiplyScalar(500);
  camera.up.set(0, 1, 0);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  const view = new THREE.Vector3(), turn = new THREE.Matrix4(), bmin = [Infinity, Infinity], bmax = [-Infinity, -Infinity];
  for (let t = 0; t < 8; t++) for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    view.set(sx * (size[0] / 2 + 1.5), sy * size[1] / 2, sz * (size[2] / 2 + 1.5)).applyMatrix4(turn.makeRotationY(turnAngle(t))).applyMatrix4(camera.matrixWorldInverse);
    bmin[0] = Math.min(bmin[0], view.x); bmax[0] = Math.max(bmax[0], view.x);
    bmin[1] = Math.min(bmin[1], view.y); bmax[1] = Math.max(bmax[1], view.y);
  }
  const unit = Math.max((bmax[0] - bmin[0]) / (W * .82), (bmax[1] - bmin[1]) / (H * .8)); // world units per CSS px
  const cx = (bmin[0] + bmax[0]) / 2, cy = (bmin[1] + bmax[1]) / 2;
  camera.left = cx - W / 2 * unit; camera.right = cx + W / 2 * unit;
  camera.top = cy + H / 2 * unit; camera.bottom = cy - H / 2 * unit;
  camera.updateProjectionMatrix();

  // voxel outlines when a voxel is at least 3.5 px big, like the mockup
  const u = material.uniforms;
  u.edges.value = o.mode === 'vox' && 1 / unit >= 3.5 ? 1 : 0;
  if (o.mode === 'poly') (u.shade.value as THREE.Vector3).set(1.08, .92, .74);
  else (u.shade.value as THREE.Vector3).set(1.12, .9, .68);
  u.under.value = meshMaterial.uniforms.under.value = o.low ? UNDER_LOW : .55;

  // split plane
  if (planeObj) { group.remove(planeObj); disposeTree(planeObj); planeObj = null; }
  if (o.plane !== null) {
    const k = o.plane, mgn = 1.2, at = m.split[k] - centre[k];
    const ext = size.map(s => s / 2 + mgn);
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([p, q]) => {
      const v = [0, 0, 0];
      v[k] = at;
      const [a, b] = k === 0 ? [1, 2] : k === 1 ? [0, 2] : [0, 1];
      v[a] = p * ext[a]; v[b] = q * ext[b];
      return new THREE.Vector3(v[0], v[1], v[2]);
    });
    const fill = new THREE.Mesh(new THREE.BufferGeometry().setFromPoints([corners[0], corners[1], corners[2], corners[0], corners[2], corners[3]]),
      new THREE.MeshBasicMaterial({ color: 0x4db8ff, transparent: true, opacity: .28, side: THREE.DoubleSide, depthTest: false, depthWrite: false }));
    const edge = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(corners), new THREE.LineDashedMaterial({ color: o.light ? 0x1a7fd0 : 0x4db8ff, dashSize: 5 * unit, gapSize: 4 * unit, depthTest: false }));
    edge.computeLineDistances();
    planeObj = new THREE.Group();
    planeObj.add(fill, edge);
    planeObj.renderOrder = 10; fill.renderOrder = 10; edge.renderOrder = 11;
    group.add(planeObj);
  }
  r.render(scene, camera);

  const project = (x: number, y: number, z: number): [number, number] => {
    const p = new THREE.Vector3(x - centre[0], y - centre[1], z - centre[2]).applyMatrix4(group.matrixWorld).project(camera);
    return [(p.x + 1) / 2 * W, (1 - p.y) / 2 * H];
  };
  drawGhosts(overlay, W, H, dpr, o.ghosts, project, camDir(o.low));
  return { peelMax, project };
}

/** Cut-off paint as red see-through cubes, drawn back to front on the blinking overlay. */
function drawGhosts(ov: HTMLCanvasElement, W: number, H: number, dpr: number, ghosts: [number, number, number][], project: DrawnView['project'], cam: THREE.Vector3) {
  const ctx = ov.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  if (!ghosts.length) return;
  const toCam = cam.applyAxisAngle(new THREE.Vector3(0, 1, 0), -group.rotation.y); // camera direction in model space
  const depth = ([x, y, z]: number[]) => x * toCam.x + y * toCam.y + z * toCam.z;
  const sorted = [...ghosts].sort((a, b) => depth(a) - depth(b));
  ctx.lineWidth = 1.2;
  for (const [x, y, z] of sorted) {
    for (let d = 0; d < 6; d++) {
      const [dx, dy, dz] = FACES[d];
      if (dx * toCam.x + dy * toCam.y + dz * toCam.z <= 1e-6) continue;
      ctx.beginPath();
      CORNERS[d].forEach(([a, b, c], k) => { const [px, py] = project(x + a, y + b, z + c); k ? ctx.lineTo(px, py) : ctx.moveTo(px, py); });
      ctx.closePath();
      ctx.fillStyle = 'rgba(255,45,85,.45)'; ctx.fill();
      ctx.strokeStyle = '#ff2d55'; ctx.stroke();
    }
  }
}
