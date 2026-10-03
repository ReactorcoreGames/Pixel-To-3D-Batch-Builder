/* The command-line tool's presets: the `presets/` folder on disk when there is one (the release's, the project's, or
   `--presets`), else the copy bundled into the tool at build time, the same way the desktop app falls back. */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseHexPalette, parseInsideColours, parseSpritePreset, setFromPreset, type InsideColours, type Palettes, type SpritePreset, type SpriteSet,
} from '../core';
import bundledInside from '../../presets/inside-colours.json';
import bundledDoom from '../../presets/palettes/doom.hex?raw';

const bundledSets = import.meta.glob('../../presets/sprite-sets/*.json', { eager: true, import: 'default' });

export interface Presets {
  /** The folder they were read from, or null for the bundled copy. */
  dir: string | null;
  sets: SpritePreset[];
  insideColours: InsideColours;
  palettes: Palettes;
  /** Files that couldn't be read (skipped, or the bundled copy used instead). */
  problems: string[];
}

/** The presets folder: `--presets`, else `presets/` next to the tool or up to four folders above it, else next to the
    working folder. Null when there's none. */
export function findPresetsDir(given?: string): string | null {
  if (given) return resolve(given);
  const starts = [dirname(fileURLToPath(import.meta.url)), process.cwd()];
  for (const start of starts) {
    let dir = start;
    for (let i = 0; i < 5; i++) {
      if (existsSync(join(dir, 'presets', 'sprite-sets'))) return join(dir, 'presets');
      const up = dirname(dir);
      if (up === dir) break;
      dir = up;
    }
  }
  return null;
}

export function loadPresets(given?: string): Presets {
  const dir = findPresetsDir(given), problems: string[] = [];
  let sets: SpritePreset[] = [];
  const add = (raw: unknown, where: string) => {
    try {
      const p = parseSpritePreset(raw, where);
      if (sets.some(x => x.id === p.id)) throw new Error(`${where}: the id "${p.id}" is already used by another preset`);
      sets.push(p);
    } catch (e) { problems.push(String((e as Error).message ?? e)); }
  };
  if (dir && existsSync(join(dir, 'sprite-sets'))) {
    for (const f of readdirSync(join(dir, 'sprite-sets')).filter(f => /\.json$/i.test(f)).sort()) {
      try { add(JSON.parse(readFileSync(join(dir, 'sprite-sets', f), 'utf8')), `presets/sprite-sets/${f}`); }
      catch (e) { problems.push(`presets/sprite-sets/${f}: ${(e as Error).message}`); }
    }
  }
  if (!sets.length) for (const [path, raw] of Object.entries(bundledSets)) add(raw, path.replace(/^.*\//, ''));
  sets = sets.sort((a, b) => a.order - b.order);
  let insideColours = parseInsideColours(bundledInside, 'presets/inside-colours.json');
  let doom = bundledDoom;
  if (dir) {
    try { insideColours = parseInsideColours(JSON.parse(readFileSync(join(dir, 'inside-colours.json'), 'utf8')), 'presets/inside-colours.json'); }
    catch { problems.push('presets/inside-colours.json (the bundled colours are used)'); }
    try { doom = readFileSync(join(dir, 'palettes', 'doom.hex'), 'utf8'); }
    catch { problems.push('presets/palettes/doom.hex (the bundled palette is used)'); }
  }
  return { dir, sets, insideColours, palettes: { doom: parseHexPalette(doom) }, problems };
}

/** A sprite set preset by its id or its file-name part (`iso` or `isometric`), ignoring case. */
export const findSet = (p: Presets, key: string) => p.sets.find(s => [s.id, s.file].some(k => k.toLowerCase() === key.toLowerCase()));

/** The GUI's starting sprite sets: Isometric and Doom-style (the first preset when either is missing). */
export function defaultSets(p: Presets): SpriteSet[] {
  return ['iso', 'doom'].map((id, i) => setFromPreset(p.sets.find(s => s.id === id) ?? p.sets[0], i === 1));
}
