/* GLB export (DESIGN.md §9 materials, §10 surface detail, §11 export controls), written by hand so the core stays
   UI-free: Three.js's exporter needs a browser canvas for textures, and the command-line tool has none.
   One mesh, one material, the atlas as an embedded PNG with nearest filtering so the pixel art stays crisp.
   glTF convention: +Y up, the front faces +Z, one unit = one metre. */

import type { TexturedMesh } from './mesh';
import { encodePng } from './png';
import type { MaterialCode, RGBAImage } from './types';

/** Metallic and roughness per material preset (DESIGN.md §9). Unlit has neither; these are its fallback values. */
export const MATERIAL_PBR: Record<MaterialCode, [number, number]> = {
  matte: [0, 1], plastic: [0, .4], dull: [1, .7], shiny: [1, .25], unlit: [0, .9],
};

export interface GlbOptions {
  /** The model's name inside the file. */
  name: string;
  /** Sprite pixels per metre (default 32). */
  scale: number;
  /** Where the origin goes: the middle of the model, or the middle of its base. */
  pivot: 'centre' | 'bottom';
  material: MaterialCode;
  /** Raw metallic / roughness (the Metal and Rough columns); the preset's values when left out. */
  metallic?: number;
  roughness?: number;
  /** A tangent-space normal map the size of the atlas (`normalMapOf`), or null. Unlit models never get one. */
  normalMap?: RGBAImage | null;
  /** Crevice shadows as a grey picture the size of the atlas (`occlusionMapOf`), or null. Not for unlit models. */
  occlusionMap?: RGBAImage | null;
  /** Shiny trims: a metallic-roughness texture holding the row's own values (`trimMapOf`), or null. The factors are
      then 1, since the texture already holds them. Not for unlit models. */
  trimMap?: RGBAImage | null;
}

const NEAREST = 9728, CLAMP = 33071, FLOAT = 5126, U16 = 5123, U32 = 5125, ARRAY = 34962, ELEMENTS = 34963;

/** Where the pivot sits in cube coordinates. */
export function pivotOf(mesh: { lo: number[]; hi: number[] }, pivot: GlbOptions['pivot']): [number, number, number] {
  const c = [0, 1, 2].map(k => (mesh.lo[k] + mesh.hi[k]) / 2) as [number, number, number];
  if (pivot === 'bottom') c[1] = mesh.lo[1];
  return c;
}

/** Writes a textured mesh as a binary glTF (.glb). Returns null when the mesh is empty. */
export function writeGlb(mesh: TexturedMesh, o: GlbOptions): Uint8Array | null {
  if (!mesh.triangles) return null;
  const nv = mesh.positions.length / 3, piv = pivotOf(mesh, o.pivot), s = 1 / o.scale;
  const pos = new Float32Array(nv * 3);
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < nv * 3; i++) {
    const k = i % 3, v = (mesh.positions[i] - piv[k]) * s;
    pos[i] = v; if (v < min[k]) min[k] = v; if (v > max[k]) max[k] = v;
  }
  const idx = nv < 65536 ? Uint16Array.from(mesh.indices) : mesh.indices;
  const unlit = o.material === 'unlit';
  const [metal, rough] = MATERIAL_PBR[o.material];
  const pngs = [encodePng(mesh.atlas)];
  const texture = (img: RGBAImage | null | undefined) => (img && !unlit ? { index: pngs.push(encodePng(img)) - 1 } : null);
  const normal = texture(o.normalMap), occlusion = texture(o.occlusionMap), trims = texture(o.trimMap);

  // one binary buffer, every part 4-byte aligned
  const parts: Uint8Array[] = [], views: object[] = [];
  let offset = 0;
  const addView = (bytes: Uint8Array, target?: number) => {
    const pad = (4 - (bytes.byteLength % 4)) % 4;
    views.push({ buffer: 0, byteOffset: offset, byteLength: bytes.byteLength, ...(target ? { target } : {}) });
    parts.push(bytes, new Uint8Array(pad));
    offset += bytes.byteLength + pad;
    return views.length - 1;
  };
  const bytesOf = (a: ArrayBufferView) => new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
  const accessors = [
    { bufferView: addView(bytesOf(pos), ARRAY), componentType: FLOAT, count: nv, type: 'VEC3', min, max },
    { bufferView: addView(bytesOf(mesh.normals), ARRAY), componentType: FLOAT, count: nv, type: 'VEC3' },
    { bufferView: addView(bytesOf(mesh.uvs), ARRAY), componentType: FLOAT, count: nv, type: 'VEC2' },
    { bufferView: addView(bytesOf(idx), ELEMENTS), componentType: idx instanceof Uint16Array ? U16 : U32, count: idx.length, type: 'SCALAR' },
  ];
  const images = pngs.map(p => ({ bufferView: addView(p), mimeType: 'image/png' }));

  const material: Record<string, unknown> = {
    name: o.material,
    pbrMetallicRoughness: {
      baseColorTexture: { index: 0 },
      metallicFactor: trims ? 1 : clamp01(o.metallic ?? metal),
      roughnessFactor: trims ? 1 : clamp01(o.roughness ?? rough),
      ...(trims ? { metallicRoughnessTexture: trims } : {}),
    },
  };
  if (normal) material.normalTexture = normal;
  if (occlusion) material.occlusionTexture = occlusion;
  if (unlit) material.extensions = { KHR_materials_unlit: {} };
  const gltf = {
    asset: { version: '2.0', generator: 'Pixel to 3D Batch Builder' },
    ...(unlit ? { extensionsUsed: ['KHR_materials_unlit'] } : {}),
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name: o.name, mesh: 0 }],
    meshes: [{ name: o.name, primitives: [{ attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 }, indices: 3, material: 0 }] }],
    materials: [material],
    samplers: [{ magFilter: NEAREST, minFilter: NEAREST, wrapS: CLAMP, wrapT: CLAMP }],
    textures: pngs.map((_, i) => ({ sampler: 0, source: i })),
    images,
    accessors,
    bufferViews: views,
    buffers: [{ byteLength: offset }],
  };

  // GLB: 12-byte header, a JSON chunk padded with spaces, a BIN chunk padded with zeros
  const json = new TextEncoder().encode(JSON.stringify(gltf));
  const jsonLen = json.length + ((4 - (json.length % 4)) % 4);
  const total = 12 + 8 + jsonLen + 8 + offset;
  const out = new Uint8Array(total), dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true);
  dv.setUint32(12, jsonLen, true); dv.setUint32(16, 0x4e4f534a, true);
  out.set(json, 20); out.fill(0x20, 20 + json.length, 20 + jsonLen);
  let at = 20 + jsonLen;
  dv.setUint32(at, offset, true); dv.setUint32(at + 4, 0x004e4942, true);
  at += 8;
  for (const p of parts) { out.set(p, at); at += p.byteLength; }
  return out;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** Reads a GLB back into its JSON and binary chunk (for tests and checks). */
export function readGlb(bytes: Uint8Array): { json: any; bin: Uint8Array } {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error('not a GLB file');
  const jsonLen = dv.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLen)));
  const binLen = dv.getUint32(20 + jsonLen, true);
  return { json, bin: bytes.subarray(28 + jsonLen, 28 + jsonLen + binLen) };
}
