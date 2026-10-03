/* The command-line tool (DESIGN.md §12): folder in, folder out, on top of the core library. It runs a session file
   the way the GUI's Run buttons do, or makes sheets / models from folders with flags for the common settings. Both go
   through the same core code as the GUI (core/sheet.ts for ①, core/exports.ts for ②), so they make the same files.
   Its output is written for Claude and scripts: one line per item, a summary, and a non-zero exit code when
   something failed. CLI.md is its usage doc. */

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import {
  BUMP_STYLES, checkSprite, decodePng, defaultExports, defaultSheetRow, defaultSpriteRow, DRAW_FROM_CODES, encodePng, ENDS_CODES, exportModel, FALLBACK_CODES,
  fileOf, FRAME_PRESETS, handOffEnds, hasEnds, hasSolidPixels, initMesh, INSIDE_CODES, isHexColour, isOneOf, makeSheet, MATERIAL_CODES, modelNames, modelParts, needsMesh,
  parseSession, planFileNames, readSheet, SESSION_EXT, SessionError, setFileParts, setFromPreset, SHAPE_CODES, sheetNameOf, sheetOptionsOf, SIDE_CODES, sideFromFilename,
  type ExportContext, type ExportSettings, type FrameColours, type RGBAImage, type SheetRowData, type SideCode, type SpriteRowData,
  type SpriteSetSettings,
} from '../core';
import { INSIDES, MATERIALS, SHAPES, SIDES } from '../ui/vocab';
import { defaultSets, findSet, loadPresets, type Presets } from './presets';

export const VERSION = '1.0.0';

/** Where the tool's lines go, and the WASM bytes the bundled tool carries (tests load the file from node_modules). */
export interface CliOptions { log?: (line: string) => void; wasmBinary?: Uint8Array }

/** Thrown for a bad command line or input: printed with a hint, exit code 2. */
class UsageError extends Error {}

// ------------------------------------------------------------------ the command line

/** Flags and whether they take a value. */
const FLAGS: Record<string, boolean> = {
  help: false, version: false, quiet: false, strict: false, presets: true,
  // run
  only: true, out: true, 'sheets-out': true, 'models-out': true,
  // sheets
  thickness: true, side: true, shape: true, ends: true, 'no-outline': false, 'copy-sides': false, frame: true, overwrite: false,
  // models
  settings: true, exports: true, sets: true, 'draw-from': true, flat: false, scale: true, pivot: true,
  material: true, inside: true, hollow: true, gap: true, slope: true, 'round-sides': true,
  'normal-map': false, 'bump-style': true, bump: true, grit: true, crevices: true, trims: true, 'vox-colours': true,
  'turntable-frames': true, 'turntable-size': true, 'turntable-height': true,
  light: true, 'no-render-outline': false, snap: true,
};

interface Args { cmd: string; pos: string[]; flags: Map<string, string> }

function parseArgs(argv: string[]): Args {
  const pos: string[] = [], flags = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h') { flags.set('help', ''); continue; }
    if (!a.startsWith('--')) { pos.push(a); continue; }
    const eq = a.indexOf('='), name = a.slice(2, eq < 0 ? undefined : eq);
    if (!(name in FLAGS)) throw new UsageError(`Unknown flag --${name}.`);
    if (!FLAGS[name]) { if (eq >= 0) throw new UsageError(`--${name} doesn't take a value.`); flags.set(name, ''); continue; }
    const v = eq >= 0 ? a.slice(eq + 1) : argv[++i];
    if (v === undefined) throw new UsageError(`--${name} needs a value.`);
    flags.set(name, v);
  }
  return { cmd: pos.shift() ?? '', pos, flags };
}

function oneOf<T extends string>(a: Args, flag: string, list: readonly T[]): T | undefined {
  const v = a.flags.get(flag);
  if (v === undefined) return undefined;
  const hit = list.find(x => x.toLowerCase() === v.toLowerCase());
  if (!hit) throw new UsageError(`--${flag} must be one of ${list.join(', ')} (got "${v}").`);
  return hit;
}

function number(a: Args, flag: string, lo: number, hi: number, int = false): number | undefined {
  const v = a.flags.get(flag);
  if (v === undefined) return undefined;
  const n = Number(v);
  if (!Number.isFinite(n) || n < lo || n > hi || (int && !Number.isInteger(n))) throw new UsageError(`--${flag} must be ${int ? 'a whole number' : 'a number'} from ${lo} to ${hi} (got "${v}").`);
  return n;
}

// ------------------------------------------------------------------ files

/** The PNGs to work on: each argument is a PNG file or a folder (the PNGs directly inside it, as the GUI's Add folder
    takes them), sorted by name with numbers in order. */
function pngsOf(inputs: string[]): string[] {
  const out: string[] = [];
  for (const raw of inputs) {
    const p = resolve(raw);
    if (!existsSync(p)) throw new UsageError(`Not found: ${p}`);
    if (statSync(p).isDirectory()) {
      out.push(...readdirSync(p).filter(f => /\.png$/i.test(f) && statSync(join(p, f)).isFile()).map(f => join(p, f))
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true })));
    } else if (/\.png$/i.test(p)) out.push(p);
    else throw new UsageError(`Not a PNG file or a folder: ${p}`);
  }
  return out;
}

/** Windows compares paths ignoring case. */
const samePath = (a: string, b: string) => (process.platform === 'win32' ? resolve(a).toLowerCase() === resolve(b).toLowerCase() : resolve(a) === resolve(b));

function writeOut(path: string, bytes: Uint8Array) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes);
}

/** A picture to work on, decoded; `missing` says why there's none. */
interface Picture { path: string; img: RGBAImage | null; missing?: string }

function readPicture(path: string, embedded?: string): Picture {
  try { if (existsSync(path)) return { path, img: decodePng(readFileSync(path)) }; }
  catch (e) { return { path, img: null, missing: `can't read the picture (${(e as Error).message})` }; }
  if (embedded?.startsWith('data:')) {
    try { return { path, img: decodePng(Buffer.from(embedded.slice(embedded.indexOf(',') + 1), 'base64')) }; }
    catch (e) { return { path, img: null, missing: `can't read the picture saved in the session (${(e as Error).message})` }; }
  }
  return { path, img: null, missing: 'picture not found' };
}

// ------------------------------------------------------------------ the report

class Report {
  ok = 0; warn = 0; fail = 0; files = 0;
  constructor(private log: (l: string) => void, private quiet: boolean) {}
  line(mark: '✅' | '⚠' | '✖', text: string) {
    if (mark === '✅') this.ok++; else if (mark === '⚠') this.warn++; else this.fail++;
    if (!this.quiet || mark !== '✅') this.log(`${mark} ${text}`);
  }
  say(text: string) { this.log(text); }
}

const listFiles = (names: string[]) => (names.length > 4 ? `${names.slice(0, 4).join(', ')} +${names.length - 4} more` : names.join(', '));
const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;

// ------------------------------------------------------------------ ① sprites → sheets

interface SpriteJob { row: SpriteRowData; pic: Picture }
interface MadeSheet { row: SpriteRowData; path: string; img: RGBAImage }

/** Why a sprite row gets a red ✖ in ①, or null when it's ready. */
function spriteProblem(j: SpriteJob): string | null {
  if (!j.pic.img) return j.pic.missing!;
  const { width: w, height: h } = j.pic.img;
  const c = checkSprite(w, h, j.row.depth, j.row.side, !hasSolidPixels(j.pic.img));
  if (c.problem === 'too-big') return `too big: ${w} × ${h} px, the limit is 128 × 128`;
  if (c.problem === 'too-thick') return `too thick: thickness ${j.row.depth} makes the model bigger than 128 px`;
  if (c.problem === 'empty') return 'nothing to build: every pixel is see-through (or less than half visible)';
  return null;
}

/** How items are named in the lines: the file name, or `folder/file` when another input has the same file name. */
function labeller(paths: string[]): (path: string) => string {
  const seen = new Map<string, number>();
  for (const p of paths) seen.set(fileOf(p).toLowerCase(), (seen.get(fileOf(p).toLowerCase()) ?? 0) + 1);
  return p => (seen.get(fileOf(p).toLowerCase())! > 1 ? `${fileOf(dirname(p))}/${fileOf(p)}` : fileOf(p));
}

function makeSheets(jobs: SpriteJob[], frame: FrameColours, dir: string, neverOverwrite: boolean, rep: Report): MadeSheet[] {
  rep.say(`Sheets → ${dir}`);
  const label = labeller(jobs.map(j => j.row.path));
  const ready: SpriteJob[] = [];
  for (const j of jobs) { const why = spriteProblem(j); if (why) rep.line('✖', `${label(j.row.path)} — ${why}`); else ready.push(j); }
  const existing = existsSync(dir) ? readdirSync(dir).filter(f => statSync(join(dir, f)).isFile()) : [];
  // the same names the GUI gives: never a painted sheet's name (with --overwrite, only names within this batch differ)
  const names = planFileNames(ready.map(j => sheetNameOf(j.row, fileOf(j.row.path), checkSprite(j.pic.img!.width, j.pic.img!.height, j.row.depth, j.row.side).n!)), existing, neverOverwrite);
  const made: MadeSheet[] = [];
  ready.forEach((j, i) => {
    const sheet = makeSheet(j.pic.img!, sheetOptionsOf(j.row, frame));
    if (!sheet) return rep.line('✖', `${label(j.row.path)} — the sheet couldn't be made`);
    const path = join(dir, names[i]);
    try { writeOut(path, encodePng(sheet.image)); }
    catch (e) { return rep.line('✖', `${label(j.row.path)} — couldn't save ${names[i]}: ${(e as Error).message}`); }
    rep.files++;
    made.push({ row: j.row, path, img: sheet.image });
    const renamed = names[i] !== sheetNameOf(j.row, fileOf(j.row.path), sheet.n);
    rep.line('✅', `${label(j.row.path)} → ${names[i]}${renamed ? ' (numbered: that name was taken)' : ''}`);
  });
  return made;
}

// ------------------------------------------------------------------ ② sheets → models

interface SheetJob { row: SheetRowData; pic: Picture }

/** A ② row for a sheet file, as the GUI's Add sheets makes it: side, shape and ends from its name. */
function sheetRowFor(path: string, img: RGBAImage): SheetRowData {
  const read = readSheet(img, path);
  return {
    ...defaultSheetRow(path, read.side, read.shape, read.ends),
    fileSide: read.named?.side ?? null, fileShape: read.named?.shape ?? null, fileEnds: read.named?.ends ?? null, renamed: read.guessed,
  };
}

async function makeModels(jobs: SheetJob[], ctx: ExportContext, folderPerModel: boolean, dir: string, presets: Presets, opts: CliOptions, rep: Report) {
  const e = ctx.exports;
  rep.say(`Models → ${dir}`);
  const label = labeller(jobs.map(j => j.row.path));
  const ready: { job: SheetJob; read: ReturnType<typeof readSheet> }[] = [];
  for (const job of jobs) {
    if (!job.pic.img) { rep.line('✖', `${label(job.row.path)} — ${job.pic.missing}`); continue; }
    const read = readSheet(job.pic.img, job.row.path);
    if (read.problem) rep.line('✖', `${label(job.row.path)} — ${read.problem}`);
    else ready.push({ job, read });
  }
  if (!ready.length) return;
  if (needsMesh(e)) await initMesh(opts.wasmBinary);
  const names = modelNames(ready.map(x => fileOf(x.job.row.path))), setParts = setFileParts(e.sprites.sets, presets.sets);
  ready.forEach(({ job, read }, i) => {
    const r = job.row, res = exportModel(modelParts(read, r, ctx), r, e, names[i], setParts, folderPerModel);
    const line = `${names[i]} (${label(r.path)})`;
    if (res.failed) return rep.line('✖', `${line} — ${res.why.join(', ')}`);
    const lost: string[] = [];
    for (const f of res.files) {
      try { writeOut(join(dir, f.path), f.bytes); rep.files++; } catch (err) { lost.push(`${f.path} (${(err as Error).message})`); }
    }
    const why = [...res.why];
    if (r.renamed) why.push('the file name lost its settings code, so side, shape and ends are guesses (Front, Box, flat)');
    if (lost.length) return rep.line('✖', `${line} — couldn't save ${listFiles(lost)}`);
    const folder = folderPerModel ? `${names[i]}/` : '';
    const files = res.files.length ? ` → ${folder ? `${folder} ` : ''}${listFiles(res.files.map(f => f.path.slice(folder.length)))}` : ' → no files (no export is on)';
    rep.line(why.length ? '⚠' : '✅', `${line}${why.length ? ` — ${why.join('; ')}` : ''}${files}`);
  });
}

// ------------------------------------------------------------------ settings from flags

/** Sprite row settings from the sheet flags (side from the file name unless --side is given). */
function spriteRowFrom(a: Args, path: string): SpriteRowData {
  const r = defaultSpriteRow(path, path, sideFromFilename(fileOf(path)));
  const side = oneOf(a, 'side', SIDE_CODES);
  if (side) r.side = side;
  r.depth = number(a, 'thickness', 1, 128, true) ?? r.depth;
  r.shape = oneOf(a, 'shape', SHAPE_CODES) ?? r.shape;
  r.ends = oneOf(a, 'ends', ENDS_CODES) ?? r.ends;
  if (a.flags.has('no-outline')) r.outline = false;
  if (a.flags.has('copy-sides')) r.copySides = true;
  return r;
}

function frameFrom(a: Args): FrameColours {
  const v = a.flags.get('frame') ?? 'jv';
  if (v in FRAME_PRESETS) { const [edge, core] = FRAME_PRESETS[v as keyof typeof FRAME_PRESETS]; return { preset: v as FrameColours['preset'], edge, core }; }
  const [edge, core = edge] = v.split(',').map(s => s.trim().toLowerCase());
  if (!isHexColour(edge) || !isHexColour(core)) throw new UsageError(`--frame must be jv, classic, single or two colours like "#1f5a44,#a63ec5" (got "${v}").`);
  return { preset: 'custom', edge, core };
}

/** The ② per-sheet settings the flags change, for every sheet. */
function applySheetFlags(a: Args, r: SheetRowData) {
  r.mat = oneOf(a, 'material', MATERIAL_CODES) ?? r.mat;
  r.inside = oneOf(a, 'inside', INSIDE_CODES) ?? r.inside;
  r.hcore = number(a, 'hollow', 0, 32, true) ?? r.hcore;
  r.fb = oneOf(a, 'gap', FALLBACK_CODES) ?? r.fb;
  r.slope = number(a, 'slope', 0, 3) ?? r.slope;
  r.sides = number(a, 'round-sides', 3, 24, true) ?? r.sides;
}

const EXPORT_KEYS = ['glb', 'vox', 'sides', 'sprites', 'stack', 'turntable', 'palette'] as const;

/** The export settings: the GUI's defaults, or a session file's (--settings), changed by the flags. */
function exportsFrom(a: Args, presets: Presets): { exp: ExportSettings; folderPerModel: boolean } {
  let exp = defaultExports(defaultSets(presets)), folderPerModel = true;
  const from = a.flags.get('settings');
  if (from) {
    const s = loadSession(from, presets);
    exp = s.exports; folderPerModel = s.sheets.folderPerModel;
  }
  const list = a.flags.get('exports');
  if (list !== undefined) {
    const want = list.toLowerCase() === 'all' ? [...EXPORT_KEYS] : list.toLowerCase() === 'none' ? [] : list.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    for (const w of want) if (!isOneOf(EXPORT_KEYS, w)) throw new UsageError(`--exports takes ${EXPORT_KEYS.join(', ')}, all or none (got "${w}").`);
    for (const k of EXPORT_KEYS) exp[k].on = want.includes(k);
  }
  const sets = a.flags.get('sets');
  if (sets !== undefined) {
    exp.sprites.sets = sets.split(',').map(s => s.trim()).filter(Boolean).map(key => {
      const p = findSet(presets, key);
      if (!p) throw new UsageError(`Unknown sprite set preset "${key}". Known: ${presets.sets.map(s => s.file).join(', ')} (see "p3d presets").`);
      return setFromPreset(p);
    });
  }
  const drawFrom = oneOf(a, 'draw-from', DRAW_FROM_CODES);
  if (drawFrom) { for (const st of exp.sprites.sets) st.from = drawFrom; exp.turntable.from = drawFrom; }
  if (a.flags.has('flat')) folderPerModel = false;
  const g = exp.glb;
  g.scale = number(a, 'scale', 1, 100000) ?? g.scale;
  g.pivot = (oneOf(a, 'pivot', ['centre', 'bottom'] as const)) ?? g.pivot;
  if (a.flags.has('normal-map')) g.normalMap = true;
  g.style = oneOf(a, 'bump-style', BUMP_STYLES) ?? g.style;
  g.bump = number(a, 'bump', 1, 10, true) ?? g.bump;
  g.grit = number(a, 'grit', 0, 10, true) ?? g.grit;
  g.ao = oneOf(a, 'crevices', ['off', 'map', 'paint'] as const) ?? g.ao;
  g.trims = oneOf(a, 'trims', ['off', 'glossy', 'metal'] as const) ?? g.trims;
  exp.vox.tooMany = oneOf(a, 'vox-colours', ['merge', 'skip'] as const) ?? exp.vox.tooMany;
  const t = exp.turntable;
  t.frames = number(a, 'turntable-frames', 4, 120, true) ?? t.frames;
  t.size = number(a, 'turntable-size', 8, 1024, true) ?? t.size;
  t.elev = number(a, 'turntable-height', -30, 60, true) ?? t.elev;
  exp.look.light = oneOf(a, 'light', ['flat', '2', '3', '4'] as const) ?? exp.look.light;
  if (a.flags.has('no-render-outline')) exp.look.outline = false;
  exp.look.snap = oneOf(a, 'snap', ['model', 'preset', 'off'] as const) ?? exp.look.snap;
  return { exp, folderPerModel };
}

function loadSession(file: string, presets: Presets) {
  const path = resolve(file);
  if (!existsSync(path)) throw new UsageError(`Session file not found: ${path}`);
  try { return { ...parseSession(readFileSync(path, 'utf8'), defaultSets(presets), { sessionDir: dirname(path) }), path }; }
  catch (e) { if (e instanceof SessionError) throw new UsageError(`${path}: ${e.message}`); throw e; }
}

// ------------------------------------------------------------------ commands

/** `p3d run <session>`: both modes of a session, as the GUI's Run buttons would run them. */
async function cmdRun(a: Args, presets: Presets, opts: CliOptions, rep: Report) {
  if (a.pos.length !== 1) throw new UsageError('run takes one session file: p3d run <session.p3d.json>');
  const s = loadSession(a.pos[0], presets);
  const only = oneOf(a, 'only', ['sheets', 'models'] as const);
  const out = a.flags.get('out');
  const sheetsDir = a.flags.get('sheets-out') ?? (out ? join(out, 'sheets') : s.sprites.output);
  const modelsDir = a.flags.get('models-out') ?? (out ? join(out, 'models') : s.sheets.output);
  const doSheets = only !== 'models' && s.sprites.rows.length > 0, doModels = only !== 'sheets';
  const willModel = doModels && (s.sheets.rows.length > 0 || (doSheets && s.sprites.addToSheets));
  if (doSheets && !sheetsDir) throw new UsageError('The session has no sheets folder (it was never picked in the GUI). Pass --out or --sheets-out.');
  if (willModel && !modelsDir) throw new UsageError('The session has no exports folder (it was never picked in the GUI). Pass --out or --models-out.');
  rep.say(`Session ${s.path}: ${plural(s.sprites.rows.length, 'sprite')} in ①, ${plural(s.sheets.rows.length, 'sheet')} in ②.`);
  const pics = new Map<string, Picture>();
  const pictureOf = (id: string | undefined, path: string) => {
    const im = id ? s.images[id] : undefined;
    if (!im) return { path, img: null, missing: 'picture not found' };
    let p = pics.get(id!);
    if (!p) pics.set(id!, p = readPicture(im.path, im.png));
    return p;
  };
  const sheetRows: SheetJob[] = s.sheets.rows.map(row => ({ row, pic: pictureOf(row.image, row.path) }));
  if (doSheets) {
    const jobs = s.sprites.rows.map(row => ({ row, pic: pictureOf(row.image, row.path) }));
    const made = makeSheets(jobs, s.sprites.frame, resolve(sheetsDir), s.sprites.neverOverwrite, rep);
    // "Also add finished sheets to ②": a sheet already in ② gets the new picture and keeps its settings
    if (s.sprites.addToSheets && doModels) for (const m of made) {
      const old = sheetRows.find(x => samePath(x.row.path, m.path));
      const pic = { path: m.path, img: m.img };
      if (old) old.pic = pic;
      else sheetRows.push({ row: defaultSheetRow(m.path, m.row.side, m.row.shape, handOffEnds(m.row)), pic });
    }
  }
  if (doModels && sheetRows.length) {
    await makeModels(sheetRows, { exports: s.exports, insideColours: presets.insideColours, palettes: presets.palettes }, s.sheets.folderPerModel, resolve(modelsDir), presets, opts, rep);
  }
}

/** `p3d sheets <in…> <out>`: sprites → sheets with the flags' settings. Returns the sheets it made. */
function cmdSheets(a: Args, rep: Report, outDir: string, inputs: string[]): MadeSheet[] {
  const frame = frameFrom(a);
  const jobs = pngsOf(inputs).map(path => ({ row: spriteRowFrom(a, path), pic: readPicture(path) }));
  if (!jobs.length) throw new UsageError(`No PNG files in ${inputs.join(', ')}.`);
  return makeSheets(jobs, frame, outDir, !a.flags.has('overwrite'), rep);
}

async function cmdModels(a: Args, presets: Presets, opts: CliOptions, rep: Report, outDir: string, sheets: { path: string; img: RGBAImage | null; missing?: string }[]) {
  const { exp, folderPerModel } = exportsFrom(a, presets);
  const jobs = sheets.map(pic => {
    const row = pic.img ? sheetRowFor(pic.path, pic.img) : defaultSheetRow(pic.path, 'F', 'box');
    applySheetFlags(a, row);
    return { row, pic };
  });
  await makeModels(jobs, { exports: exp, insideColours: presets.insideColours, palettes: presets.palettes }, folderPerModel, outDir, presets, opts, rep);
}

/** Checks the sheet and model flags before anything is written, so a typo doesn't leave a half-done batch. */
function checkFlags(a: Args, presets: Presets, sheets: boolean, models: boolean) {
  if (sheets) { spriteRowFrom(a, 'x.png'); frameFrom(a); }
  if (models) { exportsFrom(a, presets); applySheetFlags(a, defaultSheetRow('x.png', 'F', 'box')); }
}

const SIDE_HINT: Record<SideCode, string> = {
  F: 'the sprite shows the object from the front', Bk: 'from behind', L: 'its left side (as you look at its front)',
  R: 'its right side (typical for items drawn from the side, like guns)', T: 'from above', Bt: 'from below',
};

/** A preset's camera in words: "camera 30°", "perspective camera 20° (40° lens)" or "oblique, depth 45° up-right at 50%". */
function cameraText(st: SpriteSetSettings) {
  if (st.cam === 'oblique') return `oblique, depth ${st.oangle}° up-${st.oside} at ${st.odepth}%`;
  return `${st.cam === 'persp' ? 'perspective ' : ''}camera ${st.elev}°${st.cam === 'persp' ? ` (${st.fov}° lens)` : ''}`;
}

function cmdPresets(presets: Presets, log: (l: string) => void) {
  log(`Sprite set presets (for --sets; ${presets.dir ? `from ${presets.dir}` : 'the copy built into the tool'}):`);
  for (const p of presets.sets) log(`  ${p.file.padEnd(11)} ${p.name} (${p.sub}): ${p.settings.dirs} direction${p.settings.dirs === 1 ? '' : 's'}, ${p.settings.cell} px, ${cameraText(p.settings)}${p.settings.layout !== 'grid' ? `, saved as ${p.settings.layout === 'doom' ? 'Doom sprite files' : 'an RPG Maker sheet'}` : ''}`);
  const strip = (s: string) => s.replace(/^[^\p{L}]+/u, '');
  log('Sides (--side; also from file names ending in _F, _Bk, _L, _R, _T, _Bt):');
  for (const [c, n] of SIDES) log(`  ${c.padEnd(8)} ${n}: ${SIDE_HINT[c]}`);
  log('Shapes (--shape):');
  for (const [c, n, tip] of SHAPES) log(`  ${c.padEnd(8)} ${strip(n)}: ${tip}`);
  log(`Ends (--ends, only for ${SHAPE_CODES.filter(hasEnds).join(', ')}): flat, cF (first end: left / top / front), cL (last end: right / bottom / back), cB (both)`);
  log(`Materials (--material): ${MATERIALS.map(([c, n]) => `${c} (${strip(n)})`).join(', ')}`);
  log(`Inside styles (--inside): ${INSIDES.map(([c, n]) => `${c} (${strip(n)})`).join(', ')}`);
  log(`Bump styles (--bump-style): ${BUMP_STYLES.join(', ')}`);
}

// ------------------------------------------------------------------ help

export const HELP = `p3d ${VERSION}: Pixel to 3D Batch Builder on the command line.
Sprites → contact sheets (①) → 3D models and exports (②), the same files the GUI makes.

Usage:
  p3d run <session.p3d.json> [--only sheets|models] [--out DIR | --sheets-out DIR --models-out DIR]
      Runs a session file saved by the GUI, as its Run buttons would: ① makes sheets for every sprite into the
      session's sheets folder (and adds them to ② when the session says so), then ② builds every sheet's model and
      writes the ticked exports into its exports folder. --out DIR uses DIR/sheets and DIR/models instead.
  p3d sheets <sprites folder or PNGs…> <out folder> [sheet flags]
      Makes a contact sheet per sprite. The side comes from a file name ending (_F, _Bk, _L, _R, _T, _Bt), else Front.
  p3d models <sheets folder or PNGs…> <out folder> [model flags]
      Builds a model per sheet and writes the exports. Side, shape and ends come from the sheet's file name.
  p3d build <sprites folder or PNGs…> <out folder> [sheet flags] [model flags]
      Both steps at once, without painting: out/sheets and out/models.
  p3d presets
      Lists the sprite set presets and every code the flags take.

Sheet flags (sheets, build):
  --thickness N        thickness in pixels, 1–128 (default 4)
  --side CODE          F, Bk, L, R, T or Bt for every sprite (default: from the file name, else F)
  --shape CODE         box, rbox, cyW, cyH, cyT, diW, diH, diT, ell, dpy (default box)
  --ends CODE          flat, cF, cL, cB for Tube and Diamond shapes (default flat)
  --no-outline         the sprites have no 1px outline to look past
  --copy-sides         put the drawing on every inferred side ("Copy sides")
  --frame F            jv (default), classic, single, or "#edge,#core"
  --overwrite          reuse names of sheets already in the out folder (default: never overwrite, number new ones)

Model flags (models, build):
  --settings FILE      take the export settings from a session file (then the flags below change them)
  --exports LIST       comma list of glb, vox, sides, sprites, stack, turntable, palette; or all / none
                       (default glb,vox,sprites,turntable, as in the GUI)
  --sets LIST          sprite set presets for "sprites", e.g. isometric,doom (default isometric,doom; see p3d presets)
  --draw-from WHAT     mesh (default) or voxels, for sprite sets and the turntable
  --flat               all files in one folder (default: one folder per model)
  --material M         matte, plastic, dull, shiny, unlit (default matte)
  --inside S           inside style for .vox files (default nearest; see p3d presets)
  --hollow N           hollow core: walls N voxels thick, 0 = solid (default 0)
  --gap opp|near       colour for unpainted gaps: opposite side (default) or nearest pixel
  --slope X            straighten slopes, 0–3 px (default 0.9)
  --round-sides N      sides on round shapes, 3–24 (default 8)
  --scale N            GLB: sprite pixels per metre (default 32)
  --pivot P            GLB origin: bottom (default) or centre
  --normal-map         GLB: add a normal map; --bump-style S (soft, chisel, terrace, engrave, stud, lit), --bump 1–10, --grit 0–10
  --crevices C         GLB crevice shadows: off (default), map, paint
  --trims T            GLB shiny trims: off (default), glossy, metal
  --vox-colours C      over 255 colours: merge (default) or skip the .vox
  --turntable-frames N, --turntable-size N, --turntable-height DEG (-30–60)
  --light L            rendered sprites' light: flat, 2, 3 (default), 4 bands
  --no-render-outline  no 1px outline on rendered sprites
  --snap S             snap rendered colours to: model (default), preset, off

Other flags:
  --presets DIR        the presets folder (default: presets/ next to the tool or above it, else the built-in copy)
  --quiet              print only ⚠ and ✖ lines and the summary
  --strict             exit with 1 on ⚠ too
  --help, --version

Output: one line per item (✅ done, ⚠ done but check it, ✖ skipped or failed, with the reason), then a summary.
Exit code: 0 when nothing failed, 1 when something got a ✖ (or a ⚠ with --strict), 2 for a bad command line.
Never overwrites a painted sheet; model exports are written over. More in CLI.md.`;

// ------------------------------------------------------------------ main

/** Runs the tool with the given arguments; returns the exit code. */
export async function main(argv: string[], opts: CliOptions = {}): Promise<number> {
  const log = opts.log ?? ((l: string) => console.log(l));
  let a: Args;
  try { a = parseArgs(argv); } catch (e) { log(`✖ ${(e as Error).message} Run "p3d --help" for the commands and flags.`); return 2; }
  if (a.flags.has('version')) { log(VERSION); return 0; }
  if (a.flags.has('help') || !a.cmd || a.cmd === 'help') { log(HELP); return a.cmd || a.flags.has('help') ? 0 : 2; }
  const rep = new Report(log, a.flags.has('quiet'));
  const t0 = Date.now();
  try {
    const presets = loadPresets(a.flags.get('presets'));
    for (const p of presets.problems) log(`⚠ presets: ${p}`);
    if (a.cmd === 'presets') { cmdPresets(presets, log); return 0; }
    if (a.cmd === 'run') await cmdRun(a, presets, opts, rep);
    else if (a.cmd === 'sheets' || a.cmd === 'models' || a.cmd === 'build') {
      if (a.pos.length < 2) throw new UsageError(`${a.cmd} takes one or more inputs and an out folder: p3d ${a.cmd} <in…> <out folder>`);
      const out = resolve(a.pos[a.pos.length - 1]), inputs = a.pos.slice(0, -1);
      if (existsSync(out) && !statSync(out).isDirectory()) throw new UsageError(`The out folder is a file: ${out}`);
      if (inputs.some(i => /\.json$/i.test(i) || i.endsWith(SESSION_EXT))) throw new UsageError(`To run a session file, use: p3d run <session${SESSION_EXT}>`);
      checkFlags(a, presets, a.cmd !== 'models', a.cmd !== 'sheets');
      if (a.cmd === 'sheets') cmdSheets(a, rep, out, inputs);
      else if (a.cmd === 'models') await cmdModels(a, presets, opts, rep, out, pngsOf(inputs).map(p => readPicture(p)));
      else {
        const made = cmdSheets(a, rep, join(out, 'sheets'), inputs);
        await cmdModels(a, presets, opts, rep, join(out, 'models'), made.map(m => ({ path: m.path, img: m.img })));
      }
    } else throw new UsageError(`Unknown command "${a.cmd}".`);
  } catch (e) {
    if (e instanceof UsageError) { log(`✖ ${e.message} Run "p3d --help" for the commands and flags.`); return 2; }
    log(`✖ Unexpected error: ${(e as Error).stack ?? e}`);
    return 1;
  }
  rep.say(`Done in ${((Date.now() - t0) / 1000).toFixed(1)} s: ${rep.ok} ✅, ${rep.warn} ⚠, ${rep.fail} ✖; ${plural(rep.files, 'file')} written.`);
  return rep.fail || (a.flags.has('strict') && rep.warn) ? 1 : 0;
}
