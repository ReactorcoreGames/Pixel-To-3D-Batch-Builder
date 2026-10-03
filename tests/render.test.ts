import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  bandLevel, buildMesh, buildVoxelModel, colourCounts, colourModel, decodePng, doomPrefix, effectiveLayout, encodePng, fitScale, initMesh, makeSheet, modelPalette,
  parseHexPalette, parseSpritePreset, readSheet, renderFrame, renderSetFrames, renderSpriteSet, sanitizeSpriteSet, setAngles, setCamera, TWO_TO_ONE, sheetFileName, snapPalette, spritePresetFile,
  supersampling, textureMesh, voxelSource, turntableFrames, writeTurntable, type LookSpec, type RGBAImage, type RenderOptions, type ShapeCode, type SideCode, type SpriteSetSettings,
} from '../src/core';

const FRAME = { edge: '#1f5a44', core: '#a63ec5' };
const MID = { x: .5, y: .5, z: .5 };
const DOOM = parseHexPalette(readFileSync('presets/palettes/doom.hex', 'utf8'));
const PALETTES = { doom: DOOM };
const PLAIN: LookSpec = { outline: false, bands: 1, fix: 'never' };
const presets = Object.fromEntries(readdirSync('presets/sprite-sets').map(f => {
  const p = parseSpritePreset(JSON.parse(readFileSync(`presets/sprite-sets/${f}`, 'utf8')), f);
  return [p.id, p.settings];
})) as Record<string, SpriteSetSettings>;

/** A 10 × 6 sprite with a different colour in every pixel, so any misplaced pixel shows. */
function checker(w = 10, h = 6): RGBAImage {
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set([20 + x * 20, 30 + y * 30, (x * 7 + y * 13) % 200 + 40, 255], (y * w + x) * 4);
  return { width: w, height: h, data };
}

function source(img: RGBAImage, side: SideCode, depth: number, shape: ShapeCode = 'box', outlined = false, slope = .9) {
  const sh = makeSheet(img, { side, depth, shape, outlined, frame: FRAME })!;
  const read = readSheet(sh.image, sheetFileName('x', sh.n, side, shape));
  const model = buildVoxelModel(read, side, shape, MID), col = colourModel(model, read, side, 'opp');
  const mesh = textureMesh(buildMesh(model, { slope, sides: 8 }), model, read, 'opp');
  return { mesh, model, read, colours: modelPalette(model, col), voxels: voxelSource(model, col) };
}

const px = (img: RGBAImage, x: number, y: number) => Array.from(img.data.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 4));
const opts = (look: LookSpec = PLAIN, snap: number[] | null = null): RenderOptions => ({ look, shaded: look.bands > 1, snap, palettes: PALETTES });

await initMesh();

describe('pixel-clean rendering', () => {
  it('draws a box straight on at scale 1 as exactly the drawing, pixel for pixel', () => {
    const img = checker(), { mesh } = source(img, 'F', 4);
    const out = renderFrame(mesh, { yaw: 0, elev: 0 }, 16, 1, PLAIN, false).image;
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const inside = x >= 3 && x < 13 && y >= 5 && y < 11;
      expect(px(out, x, y)).toEqual(inside ? px(img, x - 3, y - 5) : [0, 0, 0, 0]);
    }
  });

  it('turns 90° to the Right side and 180° to the mirrored back, and counts from the drawing when asked', () => {
    const img = checker(8, 6), { mesh } = source(img, 'R', 4);
    const right = renderFrame(mesh, { yaw: 90, elev: 0 }, 16, 1, PLAIN, false).image;
    for (let y = 0; y < 6; y++) for (let x = 0; x < 8; x++) expect(px(right, x + 4, y + 5)).toEqual(px(img, x, y));
    const left = renderFrame(mesh, { yaw: 270, elev: 0 }, 16, 1, PLAIN, false).image;
    for (let y = 0; y < 6; y++) for (let x = 0; x < 8; x++) expect(px(left, 11 - x, y + 5)).toEqual(px(img, x, y));
    const st = { ...presets.headon, dirs: 1, ref: 'drawing', cell: 16, fit: 'drawing' } as SpriteSetSettings;
    const [f] = renderSetFrames(mesh, st, 'R', opts());
    expect(f.image.data).toEqual(right.data);
  });

  it('leans the picture right with a positive tilt', () => {
    const img = checker(10, 6), { mesh } = source(img, 'F', 4);
    const out = renderFrame(mesh, { yaw: 0, elev: 0, tilt: 90 }, 16, 1, PLAIN, false).image;
    // turned a quarter clockwise: the drawing's top-left pixel is now at the top right
    expect(px(out, 10, 3)).toEqual(px(img, 0, 0));
    expect(px(out, 5, 12)).toEqual(px(img, 9, 5));
  });

  it('only shrinks from a bigger render when a view needs it', () => {
    expect(supersampling('auto', { yaw: 0, elev: 0 }, 1, 64)).toBe(1);
    expect(supersampling('auto', { yaw: 90, elev: 90 }, 2.5, 64)).toBe(1);
    expect(supersampling('auto', { yaw: 45, elev: 30 }, 1, 64)).toBe(4);
    expect(supersampling('auto', { yaw: 0, elev: 0 }, .6, 64)).toBe(4);
    expect(supersampling('auto', { yaw: 0, elev: 0, persp: true }, 1, 64)).toBe(4);
    expect(supersampling('never', { yaw: 45, elev: 30 }, 1, 64)).toBe(1);
    expect(supersampling('always', { yaw: 0, elev: 0 }, 1, 512)).toBe(2);
  });

  it('has hard light steps: 1 band is the texture, more bands never exceed their count', () => {
    expect(bandLevel(.3, 1)).toBe(1);
    for (const b of [2, 3, 4] as const) {
      const levels = new Set(Array.from({ length: 101 }, (_, i) => bandLevel(i / 50 - 1, b)));
      expect(levels.size).toBeLessThanOrEqual(b);
      expect(Math.max(...levels)).toBe(1);
    }
    expect(bandLevel(1, 3)).toBeGreaterThan(bandLevel(-1, 3));
  });

  it('draws a 1px outline round the silhouette, in a dark version of the colour next to it', () => {
    const img = checker(), { mesh } = source(img, 'F', 4);
    const out = renderFrame(mesh, { yaw: 0, elev: 0 }, 16, 1, { ...PLAIN, outline: true }, false).image;
    expect(px(out, 2, 5)[3]).toBe(255); // left of the drawing
    expect(px(out, 2, 4)[3]).toBe(0); // corners stay empty (4-neighbours only)
    const [r, g, b] = px(out, 2, 5), [r0, g0, b0] = px(img, 0, 0);
    expect(r + g + b).toBeLessThan((r0 + g0 + b0) / 2);
    expect(px(out, 3, 5)).toEqual(px(img, 0, 0)); // the drawing itself is untouched
  });

  it('keeps every view of a set inside its pictures, with room for the outline', () => {
    const session = JSON.parse(readFileSync('test sprites/untitled.p3d.json', 'utf8'));
    const rows = session.sprites.rows as { image: string; side: SideCode; depth: number; shape: ShapeCode; outline: boolean }[];
    for (const r of rows.filter((_, i) => i % 7 === 0)) {
      const img = decodePng(Buffer.from(session.images[r.image].png.split(',')[1], 'base64'));
      const { mesh } = source(img, r.side, r.depth, r.shape, r.outline);
      for (const id of ['iso', 'rts', 'icon']) {
        const st = { ...presets[id], dirs: 8 } as SpriteSetSettings;
        const look: LookSpec = { outline: true, bands: 3, fix: 'auto' };
        const angles = setAngles(st).drawn, scale = fitScale(mesh, angles.map(y => ({ yaw: y, elev: st.elev })), st.cell, 1);
        for (const y of angles) {
          // the model stays a pixel away from the edge, so its outline fits in the picture
          const { cover } = renderFrame(mesh, { yaw: y, elev: st.elev }, st.cell, scale, look), cc = st.cell;
          let touching = 0, covered = 0;
          for (let i = 0; i < cc * cc; i++) if (cover[i]) { covered++; const x = i % cc, yy = (i / cc) | 0; if (!x || !yy || x === cc - 1 || yy === cc - 1) touching++; }
          expect(touching).toBe(0);
          expect(covered).toBeGreaterThan(0);
        }
      }
    }
  }, 60_000);
});

describe('oblique camera', () => {
  const OBL = { angle: 45, depth: .5 };
  /** Where a picture holds the drawing exactly, pixel for pixel: [x, y], or null. */
  const findDrawing = (out: RGBAImage, img: RGBAImage) => {
    for (let oy = 0; oy + img.height <= out.height; oy++) for (let ox = 0; ox + img.width <= out.width; ox++) {
      let ok = true;
      for (let y = 0; y < img.height && ok; y++) for (let x = 0; x < img.width && ok; x++) ok = px(out, ox + x, oy + y).join() === px(img, x, y).join();
      if (ok) return [ox, oy];
    }
    return null;
  };
  /** Each column's top covered row (−1 for an empty column). */
  const tops = (out: RGBAImage) => Array.from({ length: out.width }, (_, x) => {
    for (let y = 0; y < out.height; y++) if (px(out, x, y)[3]) return y;
    return -1;
  });

  it('keeps the side it looks at flat-on: a box drawn straight on is exactly the drawing', () => {
    const img = checker(10, 6), { mesh } = source(img, 'F', 4);
    const out = renderFrame(mesh, { yaw: 0, elev: 0, oblique: OBL }, 24, 1, PLAIN, false).image;
    expect(findDrawing(out, img)).not.toBeNull();
    // elevation means nothing to an oblique camera
    expect(renderFrame(mesh, { yaw: 0, elev: 40, oblique: OBL }, 24, 1, PLAIN, false).image.data).toEqual(out.data);
  });

  it('keeps level edges level, with the top and the right end showing (or the left end, receding left)', () => {
    const img = checker(20, 4), { mesh } = source(img, 'F', 8);
    for (const [angle, right] of [[45, true], [26.57, true], [135, false]] as const) {
      const out = renderFrame(mesh, { yaw: 0, elev: 0, oblique: { angle, depth: .5 } }, 32, 1, PLAIN, false).image;
      const at = findDrawing(out, img)!;
      expect(at).not.toBeNull();
      const [ox, oy] = at, t = tops(out);
      // above the drawing: the top face, whose back edge is one level row across the middle
      expect(t[ox + 10]).toBeLessThan(oy);
      expect(new Set(t.slice(ox + 4, ox + 16)).size).toBe(1);
      // the end face shows beside the drawing on the receding side only
      const beside = right ? ox + 20 : ox - 1, other = right ? ox - 1 : ox + 20;
      expect(t[beside]).toBeGreaterThanOrEqual(0);
      expect(t[other]).toBe(-1);
    }
  });

  it('turns with the set: "Your drawing" keeps a side-drawn sprite flat-on', () => {
    const img = checker(8, 6), { mesh } = source(img, 'R', 4);
    const st = { ...presets.oblique, cell: 24, fit: 'drawing' } as SpriteSetSettings;
    const [f] = renderSetFrames(mesh, st, 'R', opts());
    expect(findDrawing(f.image, img)).not.toBeNull();
  });

  it('fits the sheared model into the picture with room for the outline', () => {
    const { mesh } = source(checker(30, 10), 'F', 20);
    const cam = { yaw: 0, elev: 0, oblique: { angle: 45, depth: 1 } }, scale = fitScale(mesh, [cam], 48, 1);
    const { cover } = renderFrame(mesh, cam, 48, scale, { outline: true, bands: 3, fix: 'auto' });
    for (let i = 0; i < 48; i++) for (const j of [i, 47 * 48 + i, i * 48, i * 48 + 47]) expect(cover[j]).toBe(0);
  });

  it('always uses the odd-angle fix when needed, since the top and end faces are squeezed', () => {
    expect(supersampling('auto', { yaw: 0, elev: 0, oblique: OBL }, 1, 64)).toBe(4);
  });
});

describe('drawing from the voxel model', () => {
  it('draws a box straight on exactly like the drawing and like the low-poly model', () => {
    const img = checker(), { mesh, voxels } = source(img, 'F', 4, 'box', false, 0);
    expect(voxels.indices.length / 6).toBe(2 * (10 * 6 + 10 * 4 + 6 * 4)); // every outside face of the 10 × 6 × 4 block
    expect([...Array.from(voxels.lo), ...Array.from(voxels.hi)]).toEqual([...mesh.lo, ...mesh.hi]);
    for (const cam of [{ yaw: 0, elev: 0 }, { yaw: 90, elev: 0 }, { yaw: 0, elev: 90 }]) {
      const a = renderFrame(voxels, cam, 16, 1, PLAIN, false).image, b = renderFrame(mesh, cam, 16, 1, PLAIN, false).image;
      expect(a.data).toEqual(b.data);
    }
  });

  it("takes the voxel file's colours", () => {
    const img = checker(), { voxels, colours } = source(img, 'F', 4);
    const frame = renderFrame(voxels, { yaw: 45, elev: 30 }, 32, 1.5, PLAIN, false).image;
    for (const c of colourCounts([frame]).keys()) expect(colours).toContain(c);
  });

  it('leaves one-cube stair steps without inner lines, but keeps lines where a part stands in front', () => {
    const session = JSON.parse(readFileSync('test sprites/untitled.p3d.json', 'utf8'));
    const r = session.sprites.rows[1]; // the wooden barrel: a Tube, all stair steps
    const img = decodePng(Buffer.from(session.images[r.image].png.split(',')[1], 'base64'));
    const { voxels } = source(img, r.side, r.depth, r.shape, r.outline);
    const look: LookSpec = { outline: true, bands: 3, fix: 'auto' }, cam = { yaw: 45, elev: 30 }, scale = fitScale(voxels, [cam], 64, 1);
    const inner = (src: typeof voxels) => {
      const { image, cover } = renderFrame(src, cam, 64, scale, look), plain = renderFrame(src, cam, 64, scale, { ...look, outline: false }).image;
      let n = 0;
      for (let i = 0; i < 64 * 64; i++) if (cover[i] && image.data[i * 4] !== plain.data[i * 4]) n++;
      return n;
    };
    expect(inner({ ...voxels, stepGap: 0 })).toBeGreaterThan(20);
    expect(inner(voxels)).toBeLessThan(inner({ ...voxels, stepGap: 0 }) / 4);
    // a block 3 cubes in front of a wall still gets its line
    const wall: RGBAImage = { width: 12, height: 12, data: new Uint8Array(12 * 12 * 4) };
    for (let i = 0; i < 144; i++) wall.data.set([120, 140, 160, 255], i * 4);
    const w = source(wall, 'F', 8, 'box', false, 0);
    const m = w.model;
    // carve the front 3 layers away except a 4 × 4 block in the middle, so the block stands 3 in front of the wall
    for (let z = m.lo[2]; z <= m.hi[2]; z++) for (let y = m.lo[1]; y <= m.hi[1]; y++) for (let x = m.lo[0]; x <= m.hi[0]; x++) {
      const inBlock = x - m.lo[0] >= 4 && x - m.lo[0] < 8 && y - m.lo[1] >= 4 && y - m.lo[1] < 8;
      if (z > m.hi[2] - 3 && !inBlock) m.solid[(z * m.n + y) * m.n + x] = 0;
    }
    const src = voxelSource(m, colourModel(m, w.read, 'F', 'opp'));
    expect(inner(src)).toBeGreaterThan(0);
  });
});

describe('colours', () => {
  const img = checker(), { mesh, colours } = source(img, 'F', 4);
  const look: LookSpec = { outline: true, bands: 3, fix: 'auto' };
  const colourSet = (imgs: RGBAImage[]) => [...colourCounts(imgs).keys()];

  it('snaps to the model\'s own colours', () => {
    const st = presets.iso;
    const frames = renderSetFrames(mesh, st, 'F', opts(look, snapPalette('model', st, colours, PALETTES)));
    for (const c of colourSet(frames.map(f => f.image))) expect(colours).toContain(c);
  });

  it('locks Doom sets to the Doom palette, and "The preset\'s palette" means it too', () => {
    expect(DOOM.length).toBe(256);
    expect(DOOM.slice(0, 4)).toEqual([0x000000, 0x1f170b, 0x170f07, 0x4b4b4b]);
    const st = presets.doom;
    expect(snapPalette('preset', st, colours, PALETTES)).toBe(DOOM);
    expect(snapPalette('preset', presets.iso, colours, PALETTES)).toBe(colours);
    expect(snapPalette('off', st, colours, PALETTES)).toBeNull();
    const frames = renderSetFrames(mesh, st, 'F', opts(look, null));
    for (const c of colourSet(frames.map(f => f.image))) expect(DOOM).toContain(c);
  });

  it('brings a whole sheet down to 16 colours together', () => {
    const st = { ...presets.iso, pal: '16 colours' } as SpriteSetSettings;
    const frames = renderSetFrames(mesh, st, 'F', opts(look, null));
    expect(colourSet(frames.map(f => f.image)).length).toBeLessThanOrEqual(16);
  });
});

describe('sprite sets', () => {
  const { mesh } = source(checker(), 'F', 4);
  const o = opts({ outline: true, bands: 3, fix: 'auto' });

  it('lists the directions, leaving mirrored ones to the game', () => {
    expect(setAngles({ dirs: 8, start: 'front', yaw: 0, mirror: true }).drawn).toEqual([0, 45, 90, 135, 180]);
    expect(setAngles({ dirs: 4, start: 'diag', yaw: 0, mirror: true }).drawn).toEqual([45, 135]);
    expect(setAngles({ dirs: 2, start: 'side', yaw: 0, mirror: true }).drawn).toEqual([90]);
    expect(setAngles({ dirs: 1, start: 'custom', yaw: 200, mirror: true }).drawn).toEqual([200]);
  });

  it('saves pictures in rows of up to 8', () => {
    const f8 = renderSpriteSet(mesh, { ...presets.iso, dirs: 8 }, 'F', 'rifle', 'isometric', o);
    expect(f8.map(f => [f.name, f.image.width, f.image.height])).toEqual([['rifle_isometric.png', 512, 64]]);
    const f32 = renderSpriteSet(mesh, presets.rts, 'F', 'rifle', 'rts', o);
    expect([f32[0].image.width, f32[0].image.height]).toEqual([384, 192]);
  });

  it('makes an RPG Maker character sheet: down, left, right, up, the pose in all three walking columns', () => {
    const [f] = renderSpriteSet(mesh, presets.rpgm, 'F', 'chest', 'rpgmaker', o);
    expect(f.name).toBe('!$chest_rpgmaker.png');
    expect([f.image.width, f.image.height]).toEqual([144, 192]);
    const cell = (c: number, r: number) => Array.from({ length: 48 * 48 }, (_, i) => px(f.image, c * 48 + (i % 48), r * 48 + Math.floor(i / 48)).join()).join('|');
    for (let r = 0; r < 4; r++) { expect(cell(1, r)).toBe(cell(0, r)); expect(cell(2, r)).toBe(cell(0, r)); }
    const frames = renderSetFrames(mesh, presets.rpgm, 'F', o, 48, [0, 90, 270, 180]);
    const one = (img: RGBAImage) => Array.from({ length: 48 * 48 }, (_, i) => px(img, i % 48, Math.floor(i / 48)).join()).join('|');
    expect(cell(0, 1)).toBe(one(frames[1].image)); // row 2 faces left: seen from the Right side
    expect(cell(0, 2)).toBe(one(frames[2].image));
    expect(effectiveLayout({ ...presets.rpgm, dirs: 8 })).toBe('grid');
  });

  it('writes Doom sprite files with rotation names and offsets', () => {
    expect(doomPrefix('rifle')).toBe('RIFL');
    expect(doomPrefix('ak-47')).toBe('AK47');
    expect(doomPrefix('x')).toBe('XXXX');
    expect(doomPrefix('01 - large boulder')).toBe('LARG');
    expect(doomPrefix('2024')).toBe('2024');
    const files = renderSpriteSet(mesh, presets.doom, 'F', 'crate', 'doom', o);
    expect(files.map(f => f.name)).toEqual(['A1', 'A2A8', 'A3A7', 'A4A6', 'A5'].map(r => `crate_doom/CRAT${r}.png`));
    for (const f of files) {
      // cropped to the picture, standing on its base: the offset's y is the bottom of the picture
      expect(f.image.width).toBeLessThanOrEqual(64);
      expect(f.grab![1]).toBeGreaterThanOrEqual(f.image.height - 2);
      expect(Math.abs(f.grab![0] - f.image.width / 2)).toBeLessThanOrEqual(2);
      const png = encodePng(f.image, f.grab);
      expect(Buffer.from(png).includes(Buffer.from('grAb'))).toBe(true);
      expect(decodePng(png).width).toBe(f.image.width);
    }
    const one = renderSpriteSet(mesh, { ...presets.doom, dirs: 1 }, 'F', 'crate', 'doom', o);
    expect(one.map(f => f.name)).toEqual(['crate_doom/CRATA0.png']);
  });
});

describe('turntable GIF', () => {
  it('writes a looping GIF whose frames read back exactly', () => {
    const { mesh } = source(checker(), 'F', 4);
    const frames = turntableFrames(mesh, { elev: 15, frames: 12, size: 32 }, opts({ outline: true, bands: 3, fix: 'auto' }));
    const gif = readGif(writeTurntable(frames));
    expect(gif.frames.length).toBe(12);
    expect(gif.delay).toBe(17);
    expect(gif.loop).toBe(true);
    for (let f = 0; f < 12; f++) for (let i = 0; i < 32 * 32; i++) {
      const a = frames[f].data;
      if (!a[i * 4 + 3]) expect(gif.frames[f][i]).toBe(0);
      else expect(gif.palette[gif.frames[f][i]]).toBe((a[i * 4] << 16) | (a[i * 4 + 1] << 8) | a[i * 4 + 2]);
    }
  });

  it('merges colours when there are more than 255', () => {
    const img = checker(40, 40), { mesh } = source(img, 'F', 4); // 1,600 colours
    const frames = turntableFrames(mesh, { elev: 0, frames: 4, size: 48 }, opts());
    expect(colourCounts(frames).size).toBeGreaterThan(255);
    const gif = readGif(writeTurntable(frames));
    expect(gif.frames.length).toBe(4);
  });
});

describe('presets as data files', () => {
  it('reads every preset file, with a layout for Doom and RPG Maker', () => {
    expect(Object.keys(presets).sort()).toEqual(['battle', 'diablo', 'doom', 'headon', 'icon', 'iso', 'oblique', 'rpgm', 'rts', 'side34']);
    expect(presets.doom.layout).toBe('doom');
    expect(presets.rpgm.layout).toBe('rpgmaker');
    expect(presets.iso.layout).toBe('grid');
    expect(presets.iso.fit).toBe('fit');
    expect(presets.rts.from).toBe('mesh');
    expect(sanitizeSpriteSet({ preset: 'rts', from: 'voxels' })!.from).toBe('voxels');
    expect(sanitizeSpriteSet({ preset: 'rts' })!.from).toBe('mesh');
  });

  it('reads the camera types, with oblique settings only mattering for an oblique camera', () => {
    expect(presets.battle).toMatchObject({ dirs: 1, start: 'custom', yaw: 20, ref: 'drawing', elev: 20, cam: 'persp', fov: 40, tilt: 0, cell: 256 });
    expect(presets.oblique).toMatchObject({ dirs: 1, ref: 'drawing', cam: 'oblique', oangle: 45, odepth: 50, oside: 'right', cell: 256 });
    // presets and sets without the oblique fields get the defaults
    expect(presets.iso).toMatchObject({ cam: 'ortho', oangle: TWO_TO_ONE, odepth: 50, oside: 'right' });
    expect(sanitizeSpriteSet({ preset: 'iso', cam: 'ortho' })).toMatchObject({ cam: 'ortho', oangle: TWO_TO_ONE, odepth: 50, oside: 'right' });
    expect(sanitizeSpriteSet({ preset: 'custom', cam: 'oblique', oangle: 26.5651, odepth: 300, oside: 'left' })).toMatchObject({ cam: 'oblique', oangle: 26.57, odepth: 100, oside: 'left' });
    expect(sanitizeSpriteSet({ preset: 'custom', cam: 'fisheye' })!.cam).toBe('ortho');
    expect(() => parseSpritePreset({ ...spritePresetFile(parseSpritePreset(JSON.parse(readFileSync('presets/sprite-sets/oblique.json', 'utf8')), 'o')), oside: 'down' }, 'bad.json')).toThrow(/oside/);
    expect(setCamera(presets.oblique, 'R', 0)).toMatchObject({ yaw: 90, persp: false, oblique: { angle: 45, depth: .5 } });
    expect(setCamera({ ...presets.oblique, oside: 'left' }, 'F', 0).oblique).toEqual({ angle: 135, depth: .5 });
    expect(setCamera(presets.battle, 'F', 0)).not.toHaveProperty('oblique');
  });

  it('writes a preset back in the file format it reads', () => {
    for (const f of ['doom.json', 'oblique.json']) {
      const p = parseSpritePreset(JSON.parse(readFileSync(`presets/sprite-sets/${f}`, 'utf8')), f);
      expect(parseSpritePreset(spritePresetFile(p), 'again')).toEqual(p);
    }
  });

  it('gives sets from older session files the layout their preset implied', () => {
    expect(sanitizeSpriteSet({ preset: 'doom', dirs: 8 })!.layout).toBe('doom');
    expect(sanitizeSpriteSet({ preset: 'rpgm', dirs: 4 })!.layout).toBe('rpgmaker');
    expect(sanitizeSpriteSet({ preset: 'custom', dirs: 4, layout: 'doom', fit: 'drawing' })).toMatchObject({ layout: 'doom', fit: 'drawing' });
    expect(sanitizeSpriteSet({ preset: 'iso', layout: 'nope' })!.layout).toBe('grid');
  });

  it('fits big and small models to the same picture size', () => {
    const small = source(checker(6, 6), 'F', 2).mesh, big = source(checker(40, 30), 'F', 12).mesh;
    const cams = [{ yaw: 45, elev: 30 }];
    expect(fitScale(small, cams, 64, 1)).toBeGreaterThan(fitScale(big, cams, 64, 1));
  });
});

/** A minimal GIF reader for the tests: global palette, frame indices, delay and the loop block. */
function readGif(b: Uint8Array) {
  expect(String.fromCharCode(...b.subarray(0, 6))).toBe('GIF89a');
  const w = b[6] | (b[7] << 8), h = b[8] | (b[9] << 8);
  const palette: number[] = [];
  for (let i = 0; i < 256; i++) palette.push((b[13 + i * 3] << 16) | (b[14 + i * 3] << 8) | b[15 + i * 3]);
  let o = 13 + 768, delay = 0, loop = false;
  const frames: Uint8Array[] = [];
  while (b[o] !== 0x3b) {
    if (b[o] === 0x21) {
      if (b[o + 1] === 0xff) loop = String.fromCharCode(...b.subarray(o + 3, o + 14)) === 'NETSCAPE2.0';
      if (b[o + 1] === 0xf9) delay = b[o + 4] | (b[o + 5] << 8);
      o += 2;
      while (b[o]) o += b[o] + 1;
      o++;
    } else {
      expect(b[o]).toBe(0x2c);
      o += 10;
      const min = b[o++], data: number[] = [];
      while (b[o]) { for (let i = 1; i <= b[o]; i++) data.push(b[o + i]); o += b[o] + 1; }
      o++;
      frames.push(unlzw(data, min, w * h));
    }
  }
  return { palette, frames, delay, loop };
}

function unlzw(data: number[], min: number, n: number) {
  const clear = 1 << min, eoi = clear + 1, out = new Uint8Array(n);
  let size = min + 1, dict: number[][] = [], prev: number[] | null = null, pos = 0, bit = 0;
  const reset = () => { dict = Array.from({ length: clear + 2 }, (_, i) => [i]); size = min + 1; prev = null; };
  reset();
  for (;;) {
    let code = 0;
    for (let i = 0; i < size; i++, bit++) code |= ((data[bit >> 3] >> (bit & 7)) & 1) << i;
    if (code === clear) { reset(); continue; }
    if (code === eoi) break;
    const entry: number[] = code < dict.length ? dict[code] : [...prev!, prev![0]];
    for (const v of entry) out[pos++] = v;
    if (prev) dict.push([...prev, entry[0]]);
    prev = entry;
    if (dict.length === 1 << size && size < 12) size++;
  }
  expect(pos).toBe(n);
  return out;
}
