/* ① → ② hand-off and remaking sheets (DESIGN.md §4, "Remaking a sheet"). Every sheet ① puts in ② remembers the
   sprite it came from, a fingerprint of the sheet as written and the ① settings it was made with (`SheetLink`).
   Running ① again for that sprite then remakes the sheet in place: the ② row keeps its settings and the old file
   moves into a `replaced` folder. A sheet with painting on it is never replaced: the new sheet goes next to it. */

import { defaultSheetRow, fileOf, handOffEnds, pixelHash, sheetRecipe, type RGBAImage, type SheetLink } from '../core';
import { isAbsolute, isDesktop, readFile, samePath } from './desktop';
import { decodeImage } from './load';
import { images, newImageId, S, sheetData, sheetRow, type SheetRow, type SpriteRow } from './state';

const spriteHashes = new Map<string, string>();
/** `pixelHash` of a loaded picture; pictures never change under one id, so it's kept. */
const hashOf = (imageId: string) => {
  let h = spriteHashes.get(imageId);
  if (!h) spriteHashes.set(imageId, h = pixelHash(images.get(imageId)!.img));
  return h;
};

/** What the ① row's sheet would be made from now (see `sheetRecipe`). */
export const recipeOf = (r: SpriteRow) => sheetRecipe(r, hashOf(r.image));

/** The ① sprite a ② row was made from, if it's still in the ① list. */
export const spriteOf = (row: SheetRow) => (row.link ? S.t[1].rows.find(r => samePath(r.path, row.link!.sprite)) : undefined);

/** The sprite or its ① settings changed since this ② row's sheet was made, and no other ② row has the current sheet
    (a painted sheet that was kept, with its remade version below it, isn't flagged). */
export function outOfDate(row: SheetRow) {
  const sp = spriteOf(row);
  if (!sp) return false;
  const now = recipeOf(sp);
  return row.link!.with !== now && !S.t[2].rows.some(x => x.link && x.link.with === now && samePath(x.link.sprite, sp.path));
}

/** A sheet's pixels the way the app reads them back from a file, so fingerprints of written and re-read sheets match. */
export const decodePng = (png: Uint8Array) => decodeImage(new Blob([png as Uint8Array<ArrayBuffer>], { type: 'image/png' }));

type SheetState = 'clean' | 'painted' | 'gone';

/** Whether a linked ② row's sheet is still exactly as ① wrote it. The desktop app reads the file itself (a sheet saved
    a moment ago may not be read again yet); the browser looks at the picture it has. A file that can't be decoded
    counts as painted, so it's left alone. */
async function stateOf(row: SheetRow): Promise<SheetState> {
  let img: RGBAImage;
  if (isDesktop && isAbsolute(row.path)) {
    let bytes: Uint8Array;
    try { bytes = await readFile(row.path); } catch { return 'gone'; }
    try { img = await decodePng(bytes); } catch { return 'painted'; }
  } else {
    const im = row.image ? images.get(row.image) : undefined;
    if (!im) return 'gone';
    img = im.img;
  }
  return pixelHash(img) === row.link!.made ? 'clean' : 'painted';
}

/** What happens to one ① row's sheet in a run. `target`: the ② row it replaces (in place, settings kept). `like`: no
    row to replace, but a painted sheet from the same sprite is in ②, so the new row copies its settings and goes
    right after it. */
export interface HandOff { target?: SheetRow; state?: SheetState; like?: SheetRow }

/** Picks, for each ① row, the ② row its new sheet replaces: the first linked row that's unpainted (or whose file is
    gone). With "never overwrite" off, a painted one is replaced too (its file is still moved aside, not lost). */
export async function planHandOff(rows: SpriteRow[], neverOverwrite: boolean): Promise<HandOff[]> {
  const claimed = new Set<SheetRow>(), out: HandOff[] = [];
  for (const r of rows) {
    const linked = S.t[2].rows.filter(x => x.link && !claimed.has(x) && samePath(x.link.sprite, r.path));
    let plan: HandOff = {};
    for (const x of linked) {
      const state = await stateOf(x);
      if (state !== 'painted') { plan = { target: x, state }; break; }
    }
    if (!plan.target && linked.length) plan = neverOverwrite ? { like: linked[linked.length - 1] } : { target: linked[0], state: 'painted' };
    if (plan.target) claimed.add(plan.target);
    out.push(plan);
  }
  return out;
}

/** A finished sheet. `path` is where it was saved (desktop app), or its file name (browser). `png`: the file's bytes,
    `img`: its pixels as read back. `unchanged`: it came out exactly like the unpainted sheet it remakes, under the same
    name, so the file was left alone. */
export interface MadeSheet { row: SpriteRow; plan: HandOff; file: string; path: string; png: Uint8Array; img: RGBAImage; hash: string; unchanged: boolean }

/** Inserts a row into ② at `at`, keeping the selection on the same rows. */
function insertSheetRow(at: number, row: SheetRow) {
  const T = S.t[2], shift = (i: number) => (i >= at ? i + 1 : i);
  T.rows.splice(at, 0, row);
  T.sel = new Set([...T.sel].map(shift)); T.focus = shift(T.focus); T.anchor = shift(T.anchor);
}

/** Puts the sheets a ① run made into the ② list (the "Also add finished sheets to ②" option). A remade sheet takes
    over its row: new picture, name and side / shape / ends from ①, every other ② setting kept. A sheet that sits
    next to a painted one copies that row's settings. Anything else is a new row at the end (or, when a row already
    shows that very file, that row gets the new picture). */
export function addToSheets(made: MadeSheet[]) {
  const T = S.t[2];
  for (const { row: r, plan, path, png, img, hash } of made) {
    const id = newImageId();
    images.set(id, { id, path, img, png: 'data:image/png;base64,' + base64(png), empty: false, disk: isDesktop });
    const link: SheetLink = { sprite: r.path, made: hash, with: recipeOf(r) };
    const ends = handOffEnds(r);
    const fresh = { path, file: fileOf(path), image: id, link, side: r.side, shape: r.shape, ends, fileSide: r.side, fileShape: r.shape, fileEnds: ends, renamed: false };
    const old = plan.target ?? T.rows.find(x => samePath(x.path, path));
    if (old) {
      // the old picture goes, so the file watcher doesn't take the new file for a change made in the art app
      if (old.image && !T.rows.some(x => x !== old && x.image === old.image)) images.delete(old.image);
      Object.assign(old, fresh);
      continue;
    }
    if (plan.like && T.rows.includes(plan.like)) {
      insertSheetRow(T.rows.indexOf(plan.like) + 1, sheetRow({ ...sheetData(plan.like), ...fresh }));
    } else T.rows.push(sheetRow({ ...defaultSheetRow(path, r.side, r.shape, ends), ...fresh }));
  }
  if (!T.sel.size && T.rows.length) T.sel = new Set([T.focus]);
}

function base64(bytes: Uint8Array) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
