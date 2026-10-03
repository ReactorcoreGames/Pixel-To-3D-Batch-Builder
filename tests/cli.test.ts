/* The command-line tool (src/cli/p3d.ts): the same files as the GUI, and the folder commands on a few test batches.
   `fixtures/gui-run-hashes.json` holds the files of two GUI runs (the browser build driven by script in session 7b, on
   the user's PSRC session with every export ticked in two different ways, A and B below). When an export changes on
   purpose, make the runs again in the GUI and rewrite the fixture, or check the change by eye and set
   UPDATE_GUI_HASHES=1 to take the tool's files as the new reference. */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { encodePng, modelNames, parseSheetName, readGlb, type RGBAImage } from '../src/core';
import { main } from '../src/cli/p3d';

const SPRITES = 'test sprites';
const FIXTURES = 'tests/fixtures';
const tmp = mkdtempSync(join(tmpdir(), 'p3d-cli-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

/** Runs the tool; returns its exit code and lines. */
async function p3d(...args: string[]) {
  const lines: string[] = [];
  const code = await main(args, { log: l => lines.push(...l.split('\n')) });
  return { code, lines, text: lines.join('\n') };
}

/** Every file under a folder, by its path inside it. */
function filesIn(dir: string): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  const walk = (d: string) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else out.set(relative(dir, p).replace(/\\/g, '/'), readFileSync(p)); } };
  if (existsSync(dir)) walk(dir);
  return out;
}
const hash = (b: Buffer) => createHash('sha256').update(b).digest('hex').slice(0, 16);

// ------------------------------------------------------------------ the two GUI runs' sessions

type Json = Record<string, any>;
/** The user's PSRC session with every export ticked: A (one folder per model, surface maps in the file, three sets,
    a voxel turntable) and B (flat, painted-in shadows, other look settings, .vox skip). */
function guiSessions(): Record<'A' | 'B', Json> {
  const src = JSON.parse(readFileSync(join(SPRITES, 'untitled.p3d.json'), 'utf8'));
  const base = src.exports.sprites.sets[0];
  const set = (file: string, extra: Json = {}) => {
    const f = JSON.parse(readFileSync(join('presets', 'sprite-sets', `${file}.json`), 'utf8')), s: Json = { ...base };
    for (const k of Object.keys(base)) if (k !== 'preset' && k !== 'open' && k in f) s[k] = f[k];
    return { ...s, preset: f.id, open: false, from: 'mesh', ...extra };
  };
  const a = structuredClone(src), ea = a.exports;
  for (const k of ['glb', 'vox', 'sides', 'sprites', 'stack', 'turntable', 'palette']) ea[k].on = true;
  Object.assign(ea.glb, { normalMap: true, style: 'stud', ao: 'map', trims: 'glossy', grit: 3 });
  ea.sprites.sets = [set('isometric'), set('doom'), set('rpgmaker', { from: 'voxels' })];
  Object.assign(ea.palette, { gpl: true, hex: true });
  Object.assign(ea.turntable, { frames: 8, size: 64, from: 'voxels' });
  const b = structuredClone(src), eb = b.exports;
  for (const k of ['glb', 'vox', 'sprites', 'turntable', 'stack']) eb[k].on = true;
  Object.assign(eb.glb, { normalMap: true, style: 'engrave', ao: 'paint', trims: 'metal', pivot: 'centre' });
  eb.vox.tooMany = 'skip';
  Object.assign(eb.stack, { axis: 'x', order: 'top' });
  eb.sprites.sets = [set('icon'), set('isometric', { fit: 'drawing' })];
  Object.assign(eb.look, { light: 'flat', snap: 'off', outline: false });
  Object.assign(eb.turntable, { frames: 12, size: 96 });
  b.sheets.folderPerModel = false;
  return { A: a, B: b };
}

describe('p3d run: the same files as the GUI', () => {
  const fixture = join('tests', 'fixtures', 'gui-run-hashes.json');
  const want: Record<string, Record<string, string>> = JSON.parse(readFileSync(fixture, 'utf8'));
  const got: Record<string, Record<string, string>> = {};
  const sessions = guiSessions();

  for (const [run, only] of [['A', 'models'], ['A', 'sheets'], ['B', 'models']] as const) {
    it(`run ${run}, ${only}`, async () => {
      const dir = join(tmp, `gui-${run}`);
      mkdirSync(dir, { recursive: true });
      const session = join(dir, 'session.p3d.json');
      writeFileSync(session, JSON.stringify(sessions[run]));
      const r = await p3d('run', session, '--only', only, '--out', join(dir, 'out'), '--quiet');
      expect(r.code, r.text).toBe(0);
      expect(r.text).toMatch(/71 ✅, 0 ⚠, 0 ✖/);
      const files = filesIn(join(dir, 'out', only));
      got[`${run}/${only}`] = Object.fromEntries([...files].sort(([x], [y]) => (x < y ? -1 : 1)).map(([n, b]) => [n, hash(b)]));
      if (process.env.UPDATE_GUI_HASHES) return;
      expect(Object.keys(got[`${run}/${only}`]).sort()).toEqual(Object.keys(want[`${run}/${only}`]).sort());
      const differ = Object.keys(want[`${run}/${only}`]).filter(n => got[`${run}/${only}`][n] !== want[`${run}/${only}`][n]);
      expect(differ, 'files that differ from the GUI run').toEqual([]);
    }, 180_000);
  }
  afterAll(() => {
    if (process.env.UPDATE_GUI_HASHES && Object.keys(got).length === 3) writeFileSync(fixture, JSON.stringify(got, null, 1) + '\n');
  });
});

// ------------------------------------------------------------------ folder commands

/** A small test picture: a filled rectangle of one colour. */
function rect(w: number, h: number, rgba = [200, 80, 40, 255]): RGBAImage {
  const data = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) data.set(rgba, i * 4);
  return { width: w, height: h, data };
}

describe('p3d sheets / models / build', () => {
  it('build: sprites → sheets → every export, with flags; side from the file name', async () => {
    const out = join(tmp, 'build');
    const r = await p3d('build', join(FIXTURES, 'ends test sprites'), out, '--thickness', '6', '--shape', 'cyW', '--ends', 'cB', '--exports', 'all', '--sets', 'icon,doom', '--turntable-frames', '8', '--material', 'shiny', '--flat');
    expect(r.code, r.text).toBe(0);
    expect(r.text).toMatch(/bullet side_R\.png → bullet side__\d+_R_cyW_cB\.png/);
    const sheets = readdirSync(join(out, 'sheets'));
    expect(sheets).toHaveLength(3);
    const models = filesIn(join(out, 'models'));
    for (const name of ['stake', 'bullet side', 'bullet end-on']) {
      for (const f of ['.glb', '.vox', '_front.png', '_icon.png', '_stack.png', '_turntable.gif', '.gpl']) expect(models.has(name + f), name + f).toBe(true);
      expect([...models.keys()].some(k => k.startsWith(`${name}_doom/`))).toBe(true);
      const glb = readGlb(new Uint8Array(models.get(name + '.glb')!));
      expect(glb.json.materials[0].pbrMetallicRoughness.metallicFactor).toBeGreaterThan(.5);
    }
  }, 120_000);

  it('sheets: several folders, never overwrites, numbers the second run', async () => {
    const out = join(tmp, 'sheets');
    const ins = [join(SPRITES, 'PSRC Starter Pack Sprites'), join(FIXTURES, 'ends test sprites')];
    const first = await p3d('sheets', ...ins, out, '--quiet');
    expect(first.code, first.text).toBe(0);
    const n = readdirSync(out).length;
    expect(n).toBe(74);
    const painted = join(out, readdirSync(out)[0]), before = readFileSync(painted);
    const second = await p3d('sheets', ...ins, out);
    expect(second.code).toBe(0);
    expect(second.text).toMatch(/numbered: that name was taken/);
    expect(readdirSync(out)).toHaveLength(2 * n);
    expect(readFileSync(painted).equals(before)).toBe(true);
    // numbered names still read back in ②
    expect(readdirSync(out).filter(f => !parseSheetName(f))).toEqual([]);
  }, 120_000);

  it('skips broken rows with the reason and exits with 1', async () => {
    const dir = join(tmp, 'broken');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'huge.png'), encodePng(rect(130, 20)));
    writeFileSync(join(dir, 'empty.png'), encodePng(rect(8, 8, [0, 0, 0, 0])));
    writeFileSync(join(dir, 'fine_R.png'), encodePng(rect(12, 6)));
    const r = await p3d('sheets', dir, join(dir, 'out'));
    expect(r.code).toBe(1);
    expect(r.text).toMatch(/✖ huge\.png — too big: 130 × 20 px/);
    expect(r.text).toMatch(/✖ empty\.png — nothing to build/);
    expect(r.text).toMatch(/✅ fine_R\.png → fine__16_R_box\.png/);
    expect(r.text).toMatch(/1 ✅, 0 ⚠, 2 ✖; 1 file written/);
  });

  it('models: painted sheets, cut-off paint is a ⚠, a renamed sheet is a guess, a wrong size is a ✖', async () => {
    const dir = join(tmp, 'models-in');
    mkdirSync(dir, { recursive: true });
    for (const f of readdirSync(join(FIXTURES, 'phase2 test sheets'))) writeFileSync(join(dir, f), readFileSync(join(FIXTURES, 'phase2 test sheets', f)));
    writeFileSync(join(dir, 'mug copy.png'), readFileSync(join(FIXTURES, 'phase2 test sheets', 'mug__16_F_box.png')));
    writeFileSync(join(dir, 'odd__16_F_box.png'), encodePng(rect(30, 30)));
    const r = await p3d('models', dir, join(tmp, 'models-out'), '--exports', 'glb,vox', '--strict');
    expect(r.code).toBe(1);
    expect(r.text).toMatch(/✅ fish \(fish__32_F_box\.png\) → fish\/ fish\.glb, fish\.vox/);
    expect(r.text).toMatch(/⚠ mug stray paint .*painted pixels? cut off/);
    expect(r.text).toMatch(/⚠ mug copy .*guesses/);
    expect(r.text).toMatch(/✖ odd__16_F_box\.png — Wrong picture size/);
    const ok = await p3d('models', join(FIXTURES, 'phase2 test sheets', 'fish__32_F_box.png'), join(tmp, 'models-out2'), '--exports', 'none');
    expect(ok.code).toBe(0);
    expect(ok.text).toMatch(/no files \(no export is on\)/);
  }, 120_000);

  it('two sheets with the same model name get numbered models (rifle, rifle_2)', () => {
    expect(modelNames(['rifle__32_R_cyW.png', 'rifle__16_F_box.png', 'RIFLE_2__16_F_box.png', 'x__y.png', 'x__y.png']))
      .toEqual(['rifle', 'rifle_2', 'RIFLE_2_2', 'x__y', 'x__y_2']);
  });

  it('the command line: help, unknown flags and bad values', async () => {
    expect((await p3d('--help')).text).toMatch(/p3d run <session\.p3d\.json>/);
    expect((await p3d()).code).toBe(2);
    const bad = await p3d('sheets', 'x', 'y', '--colour', 'red');
    expect(bad.code).toBe(2);
    expect(bad.text).toMatch(/Unknown flag --colour/);
    expect((await p3d('sheets', join(FIXTURES, 'ends test sprites'), join(tmp, 'bad'), '--shape', 'cube')).text).toMatch(/--shape must be one of box, rbox/);
    expect((await p3d('models', join(FIXTURES, 'phase2 test sheets'), join(tmp, 'bad'), '--sets', 'nope')).text).toMatch(/Unknown sprite set preset "nope"/);
    expect(existsSync(join(tmp, 'bad'))).toBe(false);
    expect((await p3d('presets')).text).toMatch(/isometric +Isometric/);
  });
});
