/* Tweakable defaults (from the mockup's presets.js). The sprite set presets and inside-style colours are data files
   in the project's `presets/` folder; a broken file is skipped with a console error.
   The browser build bundles the folder at build time and keeps "Save as my preset" presets in browser storage, in the
   same format as the files. The desktop app reads the folder next to the exe at start-up (`loadDiskPresets`), falling
   back to the bundled copy when it's missing, and saves the user's own presets into it as `my-<name>.json`. */

import { parseInsideColours, parseSpritePreset, setFromPreset, spritePresetFile, type SpritePreset, type SpriteSetSettings, type StartCode } from '../core';
import { isDesktop, joinPath, listDir, presetsDir, readText, removePresetFile, writeFile } from './desktop';
import insideColours from '../../presets/inside-colours.json';

const files = import.meta.glob('../../presets/sprite-sets/*.json', { eager: true, import: 'default' });

const loaded: SpritePreset[] = [];
for (const [path, raw] of Object.entries(files)) {
  try {
    const p = parseSpritePreset(raw, path.replace(/^.*\//, ''));
    if (loaded.some(x => x.id === p.id)) throw new Error(`${path}: the id "${p.id}" is already used by another preset`);
    loaded.push(p);
  } catch (e) { console.error(e); }
}
loaded.sort((a, b) => a.order - b.order);

/** A preset button in the sprite set picker. `settings` is null for Custom, which isn't a data file. */
export interface PresetEntry { id: string; name: string; file: string; sub: string; tip: string; settings: SpriteSetSettings | null; mine?: boolean }

const MINE_KEY = 'p3d.myPresets';
const mine: SpritePreset[] = [];
if (!isDesktop) {
  try {
    const raw = JSON.parse(localStorage.getItem(MINE_KEY) ?? '[]');
    if (Array.isArray(raw)) for (const o of raw) { try { mine.push(parseSpritePreset(o, 'my presets')); } catch (e) { console.error(e); } }
  } catch { /* no storage: no saved presets */ }
}

export const SPRITE_PRESETS = loaded;
const CUSTOM: PresetEntry = { id: 'custom', name: 'Custom', file: 'custom', sub: 'your own mix', tip: 'Your own settings. Change anything below and the set becomes Custom.', settings: null };
/** Every preset button: the preset files, the user's own presets, then Custom. */
export const DIR_PRESETS: PresetEntry[] = [];
function listPresets() { DIR_PRESETS.splice(0, DIR_PRESETS.length, ...loaded, ...mine.map(p => ({ ...p, mine: true })), CUSTOM); }
listPresets();
const storeMine = () => { try { localStorage.setItem(MINE_KEY, JSON.stringify(mine.map(spritePresetFile))); } catch { /* storage full or blocked */ } };

/** Desktop app: the presets folder in use (null: none found, the bundled presets are used), and the file each of the
    user's own presets was read from or written to. */
let diskDir: string | null = null;
const mineFiles = new Map<string, string>();
const spriteSetsDir = () => joinPath(diskDir!, 'sprite-sets');

/** Saves settings as the user's own preset (a name already taken by one of theirs is replaced). Returns the preset.
    The desktop app writes it into the presets folder; `saved` says whether that worked. */
export async function saveMyPreset(name: string, settings: SpriteSetSettings): Promise<{ preset: SpritePreset; problem?: string }> {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'preset';
  const id = 'my-' + slug, old = mine.findIndex(p => p.id === id);
  const p: SpritePreset = { id, name, file: slug, sub: 'my preset', tip: `Your own preset "${name}".`, order: 1000 + (old >= 0 ? old : mine.length), settings: { ...settings } };
  let problem: string | undefined;
  if (isDesktop) {
    if (!diskDir) problem = 'there is no presets folder next to the program, so it only lasts until you close it';
    else {
      const file = mineFiles.get(id) ?? joinPath(spriteSetsDir(), `${id}.json`);
      try { await writeFile(file, JSON.stringify(spritePresetFile(p), null, 2) + '\n'); mineFiles.set(id, file); }
      catch (e) { problem = `it couldn't be written into the presets folder (${e}), so it only lasts until you close the program`; }
    }
  }
  if (old >= 0) mine[old] = p; else mine.push(p);
  if (!isDesktop) storeMine();
  listPresets();
  return { preset: p, problem };
}

export async function removeMyPreset(id: string): Promise<string | undefined> {
  const i = mine.findIndex(p => p.id === id);
  if (i < 0) return;
  let problem: string | undefined;
  const file = mineFiles.get(id);
  if (isDesktop && file) {
    try { await removePresetFile(file); mineFiles.delete(id); }
    catch (e) { problem = `its file couldn't be removed (${e})`; }
  }
  mine.splice(i, 1);
  if (!isDesktop) storeMine();
  listPresets();
  return problem;
}

/** Desktop app: reads the presets folder (sprite sets, inside colours, palettes) instead of the bundled copy. Files whose
    id starts with `my-` are the user's own presets. Returns the folder's Doom palette text, if it has one. */
export async function loadDiskPresets(): Promise<{ dir: string | null; doom?: string; problems: string[] }> {
  const problems: string[] = [];
  diskDir = await presetsDir().catch(() => null);
  if (!diskDir) return { dir: null, problems };
  const builtIn: SpritePreset[] = [], own: SpritePreset[] = [];
  for (const e of (await listDir(spriteSetsDir()).catch(() => [])).sort((a, b) => a.name.localeCompare(b.name))) {
    if (e.dir || !/\.json$/i.test(e.name)) continue;
    const file = joinPath(spriteSetsDir(), e.name);
    try {
      const p = parseSpritePreset(JSON.parse(await readText(file)), `presets/sprite-sets/${e.name}`);
      if ([...builtIn, ...own].some(x => x.id === p.id)) throw new Error(`presets/sprite-sets/${e.name}: the id "${p.id}" is already used by another preset`);
      if (p.id.startsWith('my-')) { own.push({ ...p, sub: p.sub || 'my preset' }); mineFiles.set(p.id, file); }
      else builtIn.push(p);
    } catch (err) { console.error(err); problems.push(e.name); }
  }
  if (builtIn.length) { builtIn.sort((a, b) => a.order - b.order); loaded.splice(0, loaded.length, ...builtIn); }
  own.sort((a, b) => a.order - b.order);
  mine.splice(0, mine.length, ...own);
  listPresets();
  try { Object.assign(INSIDE_PAL, parseInsideColours(JSON.parse(await readText(joinPath(diskDir, 'inside-colours.json'))), 'presets/inside-colours.json')); }
  catch (err) { console.error(err); problems.push('inside-colours.json'); }
  let doom: string | undefined;
  try { doom = await readText(joinPath(diskDir, 'palettes', 'doom.hex')); } catch { problems.push('palettes/doom.hex'); }
  return { dir: diskDir, doom, problems };
}

export const START: Record<StartCode, [string, number | null, string]> = {
  front: ['Front', 0, 'Front (0°): the first picture looks straight at the front. The others go round from there.'],
  diag: ['Diagonal', 45, 'Diagonal (45°): the first picture looks at the front-right corner, like isometric games.'],
  side: ['Side', 90, 'Side (90°): the first picture looks straight at the side, like side-view and Advance Wars-style units.'],
  custom: ['Custom', null, 'Pick any turn yourself — handy for a single angled picture like an inventory icon.'],
};

export const INSIDE_PAL = parseInsideColours(insideColours, 'presets/inside-colours.json');

/** A new sprite set from a preset id (falls back to the first preset if the id is unknown). */
export function mkSet(id: string, open = false) {
  const p = SPRITE_PRESETS.find(x => x.id === id) ?? SPRITE_PRESETS[0];
  return setFromPreset(p, open);
}

/** The starting sprite sets, as in the mockup: Isometric plus an open Doom-style set. */
export const defaultSets = () => [mkSet('iso'), mkSet('doom', true)];
