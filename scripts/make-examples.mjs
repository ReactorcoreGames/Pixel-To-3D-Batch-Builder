// Turns a session file into the example session that ships with the program (the desktop app opens it on its very
// first start). Every picture the session embeds is written out as a real file, sprites into `Example sprites/` and
// sheets into `Example sheets/`, and the session is rewritten with paths relative to itself and no embedded pictures.
// Output folders are left empty, so the first run asks where the user's own files go instead of writing into the
// examples. Starts in ①, where the workflow starts.
//
//   node scripts/make-examples.mjs "test sprites/untitled.p3d.json"

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const src = process.argv[2];
if (!src) { console.error('usage: node scripts/make-examples.mjs <session.p3d.json>'); process.exit(1); }
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'examples');
const SPRITES = 'Example sprites', SHEETS = 'Example sheets', SESSION = 'Example session.p3d.json';

const s = JSON.parse(fs.readFileSync(src, 'utf8'));
const fileOf = p => p.split(/[\\/]/).pop();

// a fresh folder each time; an old one is kept next to it rather than deleted
if (fs.existsSync(OUT)) fs.renameSync(OUT, `${OUT}-old-${Date.now()}`);
for (const d of [SPRITES, SHEETS]) fs.mkdirSync(path.join(OUT, d), { recursive: true });

const written = new Map();
function writeImage(id, folder) {
  const im = s.images[id];
  if (!im?.png) throw new Error(`picture ${id} (${im?.path}) isn't embedded in the session`);
  const rel = `${folder}/${fileOf(im.path)}`;
  if (written.has(rel) && written.get(rel) !== im.png) throw new Error(`two different pictures are both called ${rel}`);
  fs.writeFileSync(path.join(OUT, folder, fileOf(im.path)), Buffer.from(im.png.split(',')[1], 'base64'));
  written.set(rel, im.png);
  return rel;
}

const images = {};
for (const r of s.sprites.rows) { r.path = writeImage(r.image, SPRITES); images[r.image] = { path: r.path }; }
for (const r of s.sheets.rows) { if (!r.image) continue; r.path = writeImage(r.image, SHEETS); images[r.image] = { path: r.path }; }

const out = {
  ...s, name: 'Example session', savedAt: new Date().toISOString(), mode: 1, images,
  sprites: { ...s.sprites, output: '' }, sheets: { ...s.sheets, output: '' },
};
fs.writeFileSync(path.join(OUT, SESSION), JSON.stringify(out, null, 1));
console.log(`examples/: ${s.sprites.rows.length} sprites, ${s.sheets.rows.length} sheets, ${SESSION}`);
