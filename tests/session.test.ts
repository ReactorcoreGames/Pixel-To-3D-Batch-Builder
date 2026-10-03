import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  defaultSession, defaultSheetRow, defaultSpriteRow, parseInsideColours, parseSession, parseSpritePreset, pixelHash, relativePath, resolvePath,
  serializeSession, SessionError, setFromPreset, sheetRecipe, type Session,
} from '../src/core';

const presetDir = 'presets/sprite-sets';
const presets = readdirSync(presetDir).map(f => parseSpritePreset(JSON.parse(readFileSync(`${presetDir}/${f}`, 'utf8')), f));
const sets = () => [setFromPreset(presets.find(p => p.id === 'iso')!), setFromPreset(presets.find(p => p.id === 'doom')!, true)];

function sample(): Session {
  const s = defaultSession(sets());
  s.name = 'props_batch_01';
  s.mode = 2;
  s.sprites.rows = [
    { ...defaultSpriteRow('Sheet4Color/rifle_R.png', 'i1', 'R'), depth: 3, shape: 'cyW', ends: 'cL' },
    { ...defaultSpriteRow('Sheet4Color/mug.png', 'i2', null), depth: 9, shape: 'cyH', outline: false },
  ];
  s.sheets.rows = [{ ...defaultSheetRow('rifle__32_R_cyW_cL.png', 'R', 'cyW', 'cL'), ends: 'cB', sy: .2, bstyle: 'stepped', bw: 3, inside: 'machine', icol: ['#112233', '#445566', '#778899'], hcore: 3, mraw: [.3, .65], image: 'i1' }];
  s.sprites.frame = { preset: 'custom', edge: '#123456', core: '#abcdef' };
  s.exports.glb.pivot = 'centre';
  Object.assign(s.exports.glb, { normalMap: true, style: 'chisel', bump: 8, grit: 3, ao: 'paint', aoDepth: 7, trims: 'metal' });
  s.exports.stack.axis = 'x';
  s.exports.look.light = 'flat';
  s.exports.sprites.sets[0].tilt = -45;
  s.images = { i1: { path: 'Sheet4Color/rifle_R.png', png: 'data:image/png;base64,AAAA' }, i2: { path: 'Sheet4Color/mug.png', png: 'data:image/png;base64,BBBB' } };
  return s;
}

describe('presets', () => {
  it('every sprite set preset file is valid and ids are unique', () => {
    expect(presets.length).toBeGreaterThanOrEqual(8);
    expect(new Set(presets.map(p => p.id)).size).toBe(presets.length);
  });

  it('keeps the mockup values', () => {
    const icon = presets.find(p => p.id === 'icon')!;
    expect(icon.settings).toMatchObject({ dirs: 1, start: 'custom', yaw: 35, ref: 'drawing', elev: 30, cell: 32 });
    expect(presets.find(p => p.id === 'iso')!.settings).toMatchObject({ dirs: 4, start: 'diag', elev: 30, ref: 'object', tilt: 0, fov: 40 });
  });

  it('refuses a broken preset with a readable message', () => {
    expect(() => parseSpritePreset({ id: 'x', name: 'X', file: 'x', sub: '', tip: 't', dirs: 3 }, 'x.json')).toThrow(/x\.json/);
  });

  it('reads the inside colours', () => {
    const pal = parseInsideColours(JSON.parse(readFileSync('presets/inside-colours.json', 'utf8')), 'inside-colours.json');
    expect(pal.rings).toEqual(['#8a5a2c', '#c08a4e', '#e3c08a']);
    expect(() => parseInsideColours({ ...pal, rings: ['#fff'] }, 'f')).toThrow(/rings/);
  });
});

describe('session file', () => {
  it('round-trips both modes, the frame, the exports and the sprite sets', () => {
    const s = sample();
    const back = parseSession(serializeSession(s, { savedAt: new Date('2026-09-28T12:00:00Z') }), sets());
    expect(back).toEqual({ ...s, savedAt: '2026-09-28T12:00:00.000Z' });
  });

  it('fills in defaults and clamps values from an old or hand-edited file', () => {
    const raw = JSON.parse(serializeSession(sample()));
    raw.sprites.rows[0].depth = 999;
    raw.sprites.rows[0].side = 'Q';
    delete raw.sprites.rows[0].copySides; // a file from before Copy sides
    raw.sheets.rows[0].sx = 7;
    raw.sheets.rows[0].inside = 'lava';
    raw.sheets.rows[0].mraw = [2, -1];
    raw.sheets.rows[0].hcore = 99.4;
    delete raw.exports.turntable;
    Object.assign(raw.exports.glb, { style: 'wobbly', grit: 50, ao: 'sometimes', aoDepth: 0 });
    raw.sprites.rows.push({ nonsense: true });
    const s = parseSession(JSON.stringify(raw), sets());
    expect(s.sprites.rows).toHaveLength(2);
    expect(s.sprites.rows[0].depth).toBe(128);
    expect(s.sprites.rows[0].side).toBe('F');
    expect(s.sprites.rows[0].copySides).toBe(false);
    expect(s.sheets.rows[0].sx).toBe(1);
    expect(s.sheets.rows[0].inside).toBe('nearest');
    expect(s.sheets.rows[0].mraw).toEqual([1, 0]);
    expect(s.sheets.rows[0].hcore).toBe(32);
    // files from before the hollow core: solid
    const solid = JSON.parse(JSON.stringify(raw)); delete solid.sheets.rows[0].hcore;
    expect(parseSession(JSON.stringify(solid), sets()).sheets.rows[0].hcore).toBe(0);
    // files from before Ends: flat everywhere, and a named sheet's name had flat ends
    const old = JSON.parse(JSON.stringify(raw));
    delete old.sprites.rows[0].ends; delete old.sheets.rows[0].ends; delete old.sheets.rows[0].fileEnds;
    const o = parseSession(JSON.stringify(old), sets());
    expect([o.sprites.rows[0].ends, o.sheets.rows[0].ends, o.sheets.rows[0].fileEnds]).toEqual(['flat', 'flat', 'flat']);
    old.sheets.rows[0].fileShape = null;
    expect(parseSession(JSON.stringify(old), sets()).sheets.rows[0].fileEnds).toBeNull();
    raw.sheets.rows[0].ends = 'pointy';
    expect(parseSession(JSON.stringify(raw), sets()).sheets.rows[0].ends).toBe('flat');
    delete raw.sheets.rows[0].mraw; // files from before session 4: the material preset's own values
    expect(parseSession(JSON.stringify(raw), sets()).sheets.rows[0].mraw).toBeNull();
    expect(s.exports.turntable).toEqual({ on: true, elev: 0, frames: 24, size: 128, from: 'mesh' });
    expect(s.exports.glb).toMatchObject({ style: 'chisel', grit: 10, ao: 'off', aoDepth: 1, trims: 'metal' });
    // files from before the surface detail settings: the default style (Chiselled), nothing extra
    for (const k of ['style', 'grit', 'ao', 'aoDepth', 'trims']) delete raw.exports.glb[k];
    expect(parseSession(JSON.stringify(raw), sets()).exports.glb).toMatchObject({ style: 'chisel', bump: 8, grit: 0, ao: 'off', aoDepth: 5, trims: 'off' });
  });

  it('refuses files that are not sessions, or are from a newer version', () => {
    expect(() => parseSession('not json', sets())).toThrow(SessionError);
    expect(() => parseSession('{"app":"something-else","version":1}', sets())).toThrow(/isn't a Pixel to 3D/);
    expect(() => parseSession('{"app":"pixel-to-3d-batch-builder","version":99}', sets())).toThrow(/newer version/);
  });

  it('stores paths relative to the session file and resolves them back', () => {
    const s = sample();
    s.sprites.rows[0].path = 'D:\\art\\props\\rifle_R.png';
    s.sprites.output = 'D:\\art\\props\\sheets';
    s.images.i1.path = 'D:\\art\\props\\rifle_R.png';
    const text = serializeSession(s, { sessionDir: 'D:\\art\\sessions' });
    const raw = JSON.parse(text);
    expect(raw.sprites.rows[0].path).toBe('../props/rifle_R.png');
    expect(raw.sprites.output).toBe('../props/sheets');
    const back = parseSession(text, sets(), { sessionDir: 'D:/art/sessions' });
    expect(back.sprites.rows[0].path).toBe('D:/art/props/rifle_R.png');
  });

  it('keeps the link from a ② sheet to the ① sprite that made it, with its path made relative', () => {
    const s = sample();
    s.sheets.rows[0].link = { sprite: 'D:\\art\\props\\rifle_R.png', made: '0badf00d', with: 'x|R|3|cyW|cL|1|0' };
    const text = serializeSession(s, { sessionDir: 'D:\\art\\sessions' });
    expect(JSON.parse(text).sheets.rows[0].link.sprite).toBe('../props/rifle_R.png');
    expect(parseSession(text, sets(), { sessionDir: 'D:/art/sessions' }).sheets.rows[0].link).toEqual({ sprite: 'D:/art/props/rifle_R.png', made: '0badf00d', with: 'x|R|3|cyW|cL|1|0' });
    // a broken link is dropped; sheets added by hand never had one
    const raw = JSON.parse(text); raw.sheets.rows[0].link = { sprite: 3 };
    expect(parseSession(JSON.stringify(raw), sets()).sheets.rows[0].link).toBeUndefined();
    expect(parseSession(serializeSession(sample()), sets()).sheets.rows[0]).not.toHaveProperty('link');
  });
});

describe('sheet fingerprints', () => {
  const img = (px: number[]) => ({ width: px.length / 4, height: 1, data: new Uint8Array(px) });
  it('changes with any visible pixel, but not with the colour of an invisible one', () => {
    const a = pixelHash(img([10, 20, 30, 255, 0, 0, 0, 0]));
    expect(a).toMatch(/^[0-9a-f]{8}$/);
    expect(pixelHash(img([10, 20, 30, 255, 99, 99, 99, 0]))).toBe(a);
    expect(pixelHash(img([10, 20, 31, 255, 0, 0, 0, 0]))).not.toBe(a);
    expect(pixelHash({ width: 1, height: 2, data: new Uint8Array([10, 20, 30, 255, 0, 0, 0, 0]) })).not.toBe(a);
  });
  it('a sprite row\'s recipe changes with every setting that changes its sheet', () => {
    const r = { ...defaultSpriteRow('a.png', 'i1', null), shape: 'cyW' as const };
    const base = sheetRecipe(r, 'h');
    for (const change of [{ depth: 5 }, { side: 'R' as const }, { shape: 'ell' as const }, { ends: 'cL' as const }, { outline: false }, { copySides: true }]) {
      expect(sheetRecipe({ ...r, ...change }, 'h')).not.toBe(base);
    }
    expect(sheetRecipe(r, 'h2')).not.toBe(base);
    // ends a box can't use don't change its sheet
    expect(sheetRecipe({ ...r, shape: 'box', ends: 'cL' }, 'h')).toBe(sheetRecipe({ ...r, shape: 'box' }, 'h'));
  });
});

describe('relative paths', () => {
  it('works on Windows paths, ignoring case', () => {
    expect(relativePath('C:\\Art\\Sessions', 'c:\\art\\sprites\\a.png')).toBe('../sprites/a.png');
    expect(relativePath('C:\\art', 'C:\\art\\a.png')).toBe('a.png');
  });

  it('keeps paths on another drive absolute', () => {
    expect(relativePath('C:\\art', 'D:\\other\\a.png')).toBe('D:/other/a.png');
  });

  it('works on POSIX paths, respecting case', () => {
    expect(relativePath('/home/me/s', '/home/me/sprites/a.png')).toBe('../sprites/a.png');
    expect(relativePath('/home/Me', '/home/me/a.png')).toBe('../me/a.png');
  });

  it('leaves relative paths alone and resolves them against a folder', () => {
    expect(relativePath('/home/me', 'Sheet4Color/a.png')).toBe('Sheet4Color/a.png');
    expect(resolvePath('/home/me/s', '../sprites/a.png')).toBe('/home/me/sprites/a.png');
    expect(resolvePath('C:\\art\\s', '../x/./a.png')).toBe('C:/art/x/a.png');
    expect(resolvePath('C:\\art', 'D:/abs.png')).toBe('D:/abs.png');
  });
});
