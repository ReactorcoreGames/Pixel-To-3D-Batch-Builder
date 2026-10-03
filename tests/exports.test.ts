import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  INSIDE_CODES, INSIDE_SLOTS, SIDE_CODES, VOX_SLOTS, buildVoxelModel, colourModel, decodePng, insideShader, keepsVoxel, makeSheet,
  modelPalette, panelBox, quantize, readSheet, readVox, sheetFileName, sidePictures, stackStrip, voxPalette, voxelList, worstColourError,
  writeGpl, writeHex, writeVox, type ColouredModel, type InsideCode, type RGBAImage, type ShapeCode, type SideCode, type VoxelFill,
} from '../src/core';
import { mugSheet } from './painted';

const FRAME = { edge: '#1f5a44', core: '#a63ec5' };
const MID = { x: .5, y: .5, z: .5 };
const PAL: [number, number, number] = [0x8a5a2c, 0xc08a4e, 0xe3c08a];

const session = JSON.parse(readFileSync('test sprites/untitled.p3d.json', 'utf8'));
const psrc = (session.sprites.rows as { path: string; image: string; side: SideCode; depth: number; shape: ShapeCode; outline: boolean }[])
  .map(r => ({ ...r, img: decodePng(Buffer.from(session.images[r.image].png.split(',')[1], 'base64')) }));

function build(img: RGBAImage, side: SideCode, depth: number, shape: ShapeCode, outlined = true) {
  const sh = makeSheet(img, { side, depth, shape, outlined, frame: FRAME })!;
  const read = readSheet(sh.image, sheetFileName('x', sh.n, side, shape));
  const model = buildVoxelModel(read, side, shape, MID);
  return { img, read, model, col: colourModel(model, read, side, 'opp') };
}
const fill = (inside: InsideCode, hollowCore = 0, noise = 0): VoxelFill => ({ inside, hollowCore, shader: insideShader({ inside, colours: PAL, noise, scale: 4 }) });

/** A solid block with a different colour in every surface pixel of its front (more colours than a .vox holds). */
function rainbow(w: number, h: number): RGBAImage {
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set([x * 13 % 256, y * 13 % 256, (x * 7 + y * 11) % 256, 255], (y * w + x) * 4);
  return { width: w, height: h, data };
}

describe('palette merging', () => {
  it('keeps colours as they are when they fit, and merges down to k otherwise', () => {
    const counts = new Map([[0xff0000, 5], [0x00ff00, 3], [0x0000ff, 1]]);
    expect(quantize(counts, 3).sort()).toEqual([0xff0000, 0x00ff00, 0x0000ff].sort());
    const many = new Map<number, number>();
    for (let i = 0; i < 1000; i++) many.set((i * 2654435761) >>> 8 & 0xffffff, 1 + (i % 7));
    const pal = quantize(many, 40);
    expect(pal.length).toBeLessThanOrEqual(40);
    expect(pal.length).toBeGreaterThan(30);
  });

  it('writes .gpl and .hex files', () => {
    expect(writeGpl('rifle', [0x0c2238, 0xffffff])).toBe('GIMP Palette\nName: rifle\nColumns: 2\n#\n 12  34  56\t#0c2238\n255 255 255\t#ffffff\n');
    expect(writeHex([0x0c2238, 0xffffff])).toBe('0c2238\nffffff\n');
  });
});

describe('hollow core', () => {
  it('keeps the surface always, and inside voxels down to the core', () => {
    expect(keepsVoxel(1, 'hollow', 0)).toBe(true);
    expect(keepsVoxel(2, 'hollow', 0)).toBe(false);
    expect(keepsVoxel(9, 'rings', 0)).toBe(true);
    expect(keepsVoxel(3, 'rings', 3)).toBe(true);
    expect(keepsVoxel(4, 'rings', 3)).toBe(false);
    expect(keepsVoxel(0, 'solid', 0)).toBe(false);
  });

  it('leaves out every voxel deeper than the walls, for every inside style, and thin parts stay solid', () => {
    const log = psrc.find(r => /log/i.test(r.path))!;
    const { model, col } = build(log.img, log.side, 16, 'cyW');
    expect(col.maxDist).toBeGreaterThan(4);
    const deeperThan = (k: number) => { let c = 0; for (let i = 0; i < col.dist.length; i++) if (model.solid[i] && col.dist[i] > k) c++; return c; };
    for (const inside of INSIDE_CODES) {
      if (inside === 'hollow') continue;
      expect(voxelList(model, col, fill(inside)).count).toBe(model.count);
      expect(voxelList(model, col, fill(inside, 2)).count).toBe(model.count - deeperThan(2));
      expect(voxelList(model, col, fill(inside, col.maxDist)).count).toBe(model.count);
    }
    expect(voxelList(model, col, fill('hollow', 5)).count).toBe(model.count - deeperThan(1));
    // a part only 2 thick has nothing deeper than 1, so walls of 1 leave it solid
    const { model: thin, col: tc } = build(rainbow(10, 6), 'F', 2, 'box', false);
    expect(voxelList(thin, tc, fill('solid', 1)).count).toBe(thin.count);
  });
});

describe('.vox writer', () => {
  it('writes every voxel, turned to MagicaVoxel\'s Z-up axes, with the exact colours', () => {
    for (const r of psrc.slice(0, 12)) {
      const { model: m, col } = build(r.img, r.side, r.depth, r.shape, r.outline);
      const f = fill('nearest'), vf = writeVox(m, col, f), back = readVox(vf.bytes!);
      expect(back.version).toBe(150);
      expect(back.size).toEqual([m.hi[0] - m.lo[0] + 1, m.hi[2] - m.lo[2] + 1, m.hi[1] - m.lo[1] + 1]);
      expect(back.voxels.length).toBe(m.count);
      const list = voxelList(m, col, f);
      expect(worstColourError(list, vf.palette)).toBe(0);
      // every voxel lands where the model has one, in its own colour
      for (const [vx, vy, vz, ci] of back.voxels) {
        const x = vx + m.lo[0], z = m.hi[2] - vy, y = vz + m.lo[1], i = (z * m.n + y) * m.n + x;
        expect(m.solid[i]).toBe(1);
        expect(back.palette[ci - 1]).toBe(col.colour[i]);
      }
    }
  }, 30000);

  it('puts the front at MagicaVoxel\'s −Y and the top at +Z', () => {
    const { model: m, col } = build(rainbow(6, 4), 'F', 3, 'box', false);
    const back = readVox(writeVox(m, col, fill('nearest')).bytes!);
    // the sprite (drawn from the front) is 6 wide and 4 tall: x 6, depth 3 along y, height 4 along z
    expect(back.size).toEqual([6, 3, 4]);
    // its top-left pixel (x 0, y 0 in the picture) is the front's top-left voxel: x 0, y 0 (front), z 3 (top)
    const tl = back.voxels.find(([x, y, z]) => x === 0 && y === 0 && z === 3)!;
    expect(back.palette[tl[3] - 1]).toBe(0x000000);
    const br = back.voxels.find(([x, y, z]) => x === 5 && y === 0 && z === 0)!;
    expect(back.palette[br[3] - 1]).toBe((65 << 16) | (39 << 8) | 68);
  });

  it('merges too many colours, or skips the file when asked', () => {
    const { model: m, col } = build(rainbow(24, 24), 'F', 4, 'box', false);
    const merged = writeVox(m, col, fill('nearest'));
    expect(merged.palette.surfaceColours).toBeGreaterThan(VOX_SLOTS);
    expect(merged.palette.merged).toBe(true);
    expect(merged.palette.colours.length).toBeLessThanOrEqual(VOX_SLOTS);
    const back = readVox(merged.bytes!);
    expect(back.voxels.length).toBe(m.count);
    expect(Math.max(...back.voxels.map(v => v[3]))).toBeLessThanOrEqual(VOX_SLOTS);
    const skipped = writeVox(m, col, fill('nearest'), 'skip');
    expect(skipped.bytes).toBeNull();
    expect(skipped.problem).toContain('colours');
  });

  it('merges only the inside when the surface fits, and gives it no more than it needs', () => {
    const log = psrc.find(r => /log/i.test(r.path))!;
    const { model: m, col } = build(log.img, log.side, 16, 'cyW');
    const plain = voxPalette(voxelList(m, col, fill('rings')));
    expect(plain.merged).toBe(false);
    const list = voxelList(m, col, fill('noise', 0, 100)), p = voxPalette(list);
    expect(p.distinct).toBeGreaterThan(VOX_SLOTS);
    expect(p.surfaceMerged).toBe(false);
    expect(p.colours.length).toBeLessThanOrEqual(VOX_SLOTS);
    // the surface keeps its colours exactly
    for (let k = 0; k < list.count; k++) if (list.surface[k]) expect(p.colours[p.pick[k]]).toBe(list.colour[k]);
    expect(writeVox(m, col, fill('noise', 0, 100), 'skip').bytes).not.toBeNull();
  });

  it('reserves inside slots when both surface and inside have too many colours', () => {
    const { model: m, col } = build(rainbow(24, 24), 'F', 12, 'box', false);
    const list = voxelList(m, col, fill('noise', 0, 100)), p = voxPalette(list);
    expect(p.surfaceMerged).toBe(true);
    const insideCols = new Set<number>();
    for (let k = 0; k < list.count; k++) if (!list.surface[k]) insideCols.add(p.colours[p.pick[k]]);
    expect(insideCols.size).toBeGreaterThan(8);
    expect(insideCols.size).toBeLessThanOrEqual(INSIDE_SLOTS + 10); // inside voxels may also use a close surface colour
  });

  it('writes the hollow core into the file', () => {
    const { model: m, col } = build(rainbow(12, 12), 'F', 12, 'box', false);
    const solid = readVox(writeVox(m, col, fill('solid')).bytes!), shell = readVox(writeVox(m, col, fill('solid', 2)).bytes!);
    expect(solid.voxels.length).toBe(12 ** 3);
    expect(shell.voxels.length).toBe(12 ** 3 - 8 ** 3);
    expect(shell.voxels.some(([x, y, z]) => x === 6 && y === 6 && z === 6)).toBe(false);
  });

  it('writes sample files for MagicaVoxel when asked', () => {
    if (!process.env.WRITE_TEST_VOX) return;
    const dir = 'tests/out/vox test files';
    mkdirSync(dir, { recursive: true });
    const log = psrc.find(r => /log/i.test(r.path))!;
    const { model: lm, col: lc } = build(log.img, log.side, 16, 'cyW');
    writeFileSync(`${dir}/log_rings_hollow2.vox`, writeVox(lm, lc, fill('rings', 2)).bytes!);
    const { model: am, col: ac } = build(rainbow(6, 4), 'F', 3, 'box', false);
    writeFileSync(`${dir}/axes_front_6x4x3.vox`, writeVox(am, ac, fill('nearest')).bytes!);
    const { model: rm, col: rc } = build(rainbow(24, 24), 'F', 4, 'box', false);
    writeFileSync(`${dir}/rainbow_merged.vox`, writeVox(rm, rc, fill('nearest')).bytes!);
    for (const r of psrc.slice(0, 6)) {
      const { model: m, col } = build(r.img, r.side, r.depth, r.shape, r.outline);
      writeFileSync(`${dir}/${r.path.replace(/^.*\//, '').replace(/\.png$/i, '')}.vox`, writeVox(m, col, fill('flesh')).bytes!);
    }
  });
});

describe('side pictures, stack strip and palette', () => {
  it('crops every side to the model, so opposite sides match in size', () => {
    for (const r of psrc.slice(0, 20)) {
      const { model: m, read } = build(r.img, r.side, r.depth, r.shape, r.outline);
      const pics = sidePictures(read, m), [X, Y, Z] = [0, 1, 2].map(k => m.hi[k] - m.lo[k] + 1);
      expect([pics.F!.width, pics.F!.height]).toEqual([X, Y]);
      expect([pics.Bk!.width, pics.Bk!.height]).toEqual([X, Y]);
      expect([pics.L!.width, pics.L!.height]).toEqual([Z, Y]);
      expect([pics.R!.width, pics.R!.height]).toEqual([Z, Y]);
      expect([pics.T!.width, pics.T!.height]).toEqual([X, Z]);
      expect([pics.Bt!.width, pics.Bt!.height]).toEqual([X, Z]);
      // no painted pixel of a side falls outside its crop on an unedited sheet
      for (const p of SIDE_CODES) {
        const [x0, y0, x1, y1] = panelBox(m, p), n = m.n, panel = read.panels![p];
        let outside = 0;
        for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (panel[(y * n + x) * 4 + 3] >= 128 && (x < x0 || x > x1 || y < y0 || y > y1)) outside++;
        expect(outside).toBe(0);
      }
    }
  });

  it('gives the sprite\'s own side back unchanged for a box', () => {
    const img = rainbow(7, 5), { model: m, read } = build(img, 'F', 3, 'box', false);
    expect(Buffer.from(sidePictures(read, m).F!.data)).toEqual(Buffer.from(img.data));
  });

  it('cuts the model into layers, bottom or top first', () => {
    const { model: m, col } = buildMug();
    const X = m.hi[0] - m.lo[0] + 1, Y = m.hi[1] - m.lo[1] + 1, Z = m.hi[2] - m.lo[2] + 1;
    const up = stackStrip(m, col, 'y', 'bottom'), down = stackStrip(m, col, 'y', 'top');
    expect([up.layers, up.w, up.h, up.image.width]).toEqual([Y, X, Z, X * Y]);
    const solidIn = (img: RGBAImage, slot: number, w: number) => { let c = 0; for (let y = 0; y < img.height; y++) for (let x = 0; x < w; x++) if (img.data[(y * img.width + slot * w + x) * 4 + 3]) c++; return c; };
    let total = 0;
    for (let k = 0; k < Y; k++) {
      let want = 0;
      for (let z = 0; z < m.n; z++) for (let x = 0; x < m.n; x++) want += m.solid[(z * m.n + m.lo[1] + k) * m.n + x];
      expect(solidIn(up.image, k, X)).toBe(want);
      expect(solidIn(down.image, Y - 1 - k, X)).toBe(want);
      total += want;
    }
    expect(total).toBe(m.count);
    expect([stackStrip(m, col, 'z', 'bottom').layers, stackStrip(m, col, 'x', 'bottom').layers]).toEqual([Z, X]);
  });

  it('lists the model\'s surface colours, dark to light', () => {
    const { model: m, col } = build(rainbow(5, 3), 'F', 2, 'box', false);
    const pal = modelPalette(m, col);
    expect(new Set(pal).size).toBe(15);
    const lum = pal.map(c => (c >> 16) * .3 + ((c >> 8) & 255) * .59 + (c & 255) * .11);
    expect(lum).toEqual([...lum].sort((a, b) => a - b));
  });
});

/** The painted mug (a blind hole a quarter deep, and a handle), read and carved. */
function buildMug() {
  const read = readSheet(mugSheet(), 'mug__16_F_box.png');
  const model = buildVoxelModel(read, 'F', 'box', { ...MID, y: .25 });
  return { read, model, col: colourModel(model, read, 'F', 'opp') as ColouredModel };
}
