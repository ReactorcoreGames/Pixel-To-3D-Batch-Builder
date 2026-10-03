/* Getting pictures in: the Add buttons, the folder picker and drag-and-drop anywhere in the window.
   The browser decodes each PNG to RGBA pixels; from there on everything goes through the core.
   In the desktop app the pickers are native dialogs, every picture keeps its real path, and loaded pictures are
   watched: one saved again in the art app is read again by itself (DESIGN.md §2). */

import { defaultSheetRow, defaultSpriteRow, fileOf, hasSolidPixels, readSheet, sideFromFilename, type RGBAImage } from '../core';
import { dirOf, isDesktop, joinPath, listDir, onDropPaths, onFilesChanged, pathKinds, pickFolder, pickPngs, pickSession, readFile, samePath, startArgs, watchFiles } from './desktop';
import { $, q } from './dom';
import { loadSessionFile, loadSessionPath, markDirty } from './session-ui';
import { images, newImageId, S, sheetRow, spriteRow, type LoadedImage } from './state';
import { refreshSel, renderT1, renderT2 } from './ui-core';
import { renderPreview } from './ui-preview';
import { toast } from './ui-shell';

/** A picked or dropped file with the path we know for it (the folder name is included when a folder was added).
    `disk`: desktop app, `path` is the file's real path. */
export interface Incoming { file: Blob & { name: string }; path: string; disk?: boolean }

/** Decodes a PNG (or any picture the browser can read) into RGBA pixels, without colour-space conversion. */
export async function decodeImage(blob: Blob): Promise<RGBAImage> {
  const bmp = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  try {
    const cv = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = cv.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(bmp, 0, 0);
    const { data } = ctx.getImageData(0, 0, bmp.width, bmp.height);
    return { width: bmp.width, height: bmp.height, data };
  } finally { bmp.close(); }
}

export const dataUrlOf = (blob: Blob) => new Promise<string>((res, rej) => {
  const fr = new FileReader();
  fr.onload = () => res(fr.result as string);
  fr.onerror = () => rej(fr.error);
  fr.readAsDataURL(blob);
});

/** Decodes a picture and registers it; the id is kept when given (pictures restored from a session). */
export async function registerImage(blob: Blob, path: string, id = newImageId(), png?: string, disk = false): Promise<LoadedImage> {
  const img = await decodeImage(blob);
  const li: LoadedImage = { id, path, img, png: png ?? await dataUrlOf(blob), empty: !hasSolidPixels(img), disk };
  images.set(id, li);
  return li;
}

const isPng = (f: Incoming) => /\.png$/i.test(f.file.name) || f.file.type === 'image/png';
const sizeOfDataUrl = (u: string) => Math.floor((u.length - u.indexOf(',') - 1) * 3 / 4) - (u.endsWith('==') ? 2 : u.endsWith('=') ? 1 : 0);

/** Adds sprites to the ① list. Non-PNG files and files already in the list are skipped. */
export async function addSprites(list: Incoming[]) {
  const pngs = list.filter(isPng), skippedType = list.length - pngs.length;
  const have = new Set(S.t[1].rows.map(r => `${r.path}|${sizeOfDataUrl(images.get(r.image)!.png)}`));
  const fresh = pngs.filter(f => !have.has(`${f.path}|${f.file.size}`)).sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }));
  const dupes = pngs.length - fresh.length;
  const failed: string[] = [];
  const T = S.t[1], start = T.rows.length;
  // decode a few at a time so a big folder doesn't block the window
  for (let i = 0; i < fresh.length; i += 8) {
    const batch = await Promise.all(fresh.slice(i, i + 8).map(f => registerImage(f.file, f.path, undefined, undefined, f.disk).then(li => ({ f, li }), () => { failed.push(f.file.name); return null; })));
    for (const x of batch) if (x) T.rows.push(spriteRow(defaultSpriteRow(x.f.path, x.li.id, sideFromFilename(x.f.file.name))));
  }
  const added = T.rows.length - start;
  if (added) {
    // like the mockup, only the (first) new row is selected, so the next edit doesn't silently change the whole batch
    T.sel = new Set([start]); T.focus = start; T.anchor = start;
    renderT1(); refreshSel(1);
    for (let k = start; k < T.rows.length; k++) q(`#t1 tr[data-i="${k}"]`)?.classList.add('flash');
    q(`#t1 tr[data-i="${start}"]`)?.scrollIntoView({ block: 'nearest' });
    markDirty();
  }
  const notes = [
    dupes && `${dupes} already in the list`,
    skippedType && `${skippedType} not PNG`,
    failed.length && `${failed.length} couldn't be read`,
  ].filter(Boolean);
  toast(`➕ Added ${added} sprite${added === 1 ? '' : 's'}${notes.length ? ` (skipped: ${notes.join(', ')})` : ''}`);
}

/** Adds painted sheets to the ② list. Side and shape come from the file name (or are guessed, see core/reader.ts).
    A sheet that is already in the list (same path) with a different picture replaces that row's picture and keeps its
    settings: in the browser that's how a sheet saved again in the art app gets back in. Broken sheets are added too,
    with a red ✖ that explains the problem. */
export async function addSheets(list: Incoming[]) {
  const pngs = list.filter(isPng), skippedType = list.length - pngs.length;
  const fresh = [...pngs].sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }));
  const failed: string[] = [];
  const T = S.t[2], start = T.rows.length;
  let updated = 0, same = 0;
  for (let i = 0; i < fresh.length; i += 8) {
    const batch = await Promise.all(fresh.slice(i, i + 8).map(f => registerImage(f.file, f.path, undefined, undefined, f.disk).then(li => ({ f, li }), () => { failed.push(f.file.name); return null; })));
    for (const x of batch) {
      if (!x) continue;
      const old = T.rows.find(r => (x.f.disk ? samePath(r.path, x.f.path) : r.path === x.f.path));
      if (old) {
        if (images.get(old.image!)?.png === x.li.png) { same++; images.delete(x.li.id); continue; }
        old.image = x.li.id; updated++;
        continue;
      }
      const read = readSheet(x.li.img, x.f.path);
      T.rows.push(sheetRow({
        ...defaultSheetRow(x.f.path, read.side, read.shape, read.ends),
        fileSide: read.named?.side ?? null, fileShape: read.named?.shape ?? null, fileEnds: read.named?.ends ?? null, renamed: read.guessed, image: x.li.id,
      }));
    }
  }
  const added = T.rows.length - start;
  if (added) { T.sel = new Set([start]); T.focus = start; T.anchor = start; }
  if (added || updated) {
    renderT2(); refreshSel(2);
    for (let k = start; k < T.rows.length; k++) q(`#t2 tr[data-i="${k}"]`)?.classList.add('flash');
    if (added) q(`#t2 tr[data-i="${start}"]`)?.scrollIntoView({ block: 'nearest' });
    markDirty();
  }
  const notes = [
    same && `${same} already in the list`,
    skippedType && `${skippedType} not PNG`,
    failed.length && `${failed.length} couldn't be read`,
  ].filter(Boolean);
  toast(`➕ Added ${added} sheet${added === 1 ? '' : 's'}${updated ? `, updated ${updated}` : ''}${notes.length ? ` (skipped: ${notes.join(', ')})` : ''}`);
}

async function addFiles(list: Incoming[]) {
  const session = list.find(f => /\.json$/i.test(f.file.name));
  if (session) return session.disk ? loadSessionPath(session.path) : loadSessionFile(session.file);
  return S.mode === 2 ? addSheets(list) : addSprites(list);
}

// ------------------------------------------------------------------ desktop: real paths

const isPngPath = (p: string) => /\.png$/i.test(p);

/** Reads files by path for addFiles: dropped or picked files as they are, and the PNGs directly inside folders.
    A session file comes back unread (it's opened by its path). */
async function incomingFromPaths(paths: string[]): Promise<Incoming[]> {
  const kinds = await pathKinds(paths), files: string[] = [];
  for (let i = 0; i < paths.length; i++) {
    if (kinds[i] === 'file') files.push(paths[i]);
    else if (kinds[i] === 'dir') {
      // like the browser's folder drop: only the files directly inside, not sub-folders
      for (const e of await listDir(paths[i]).catch(() => [])) if (!e.dir && isPngPath(e.name)) files.push(joinPath(paths[i], e.name));
    }
  }
  const out: Incoming[] = [];
  for (const p of files) {
    const name = fileOf(p);
    if (/\.json$/i.test(name)) { out.push({ file: Object.assign(new Blob(), { name }), path: p, disk: true }); continue; }
    if (!isPngPath(p)) { out.push({ file: Object.assign(new Blob(), { name }), path: p, disk: true }); continue; } // counted as "not PNG"
    try { out.push({ file: new File([await readFile(p) as Uint8Array<ArrayBuffer>], name, { type: 'image/png' }), path: p, disk: true }); }
    catch (e) { console.error(e); }
  }
  return out;
}

/** Adds files and folders by path (desktop app). */
export const addPaths = async (paths: string[]) => { if (paths.length) await addFiles(await incomingFromPaths(paths)); };

/** Where pickers start: the folder of the selected row's picture, if it has one. */
function startDir(): string | undefined {
  const T = S.t[S.mode], r = T.rows[T.focus] as { image?: string } | undefined;
  const im = r?.image ? images.get(r.image) : undefined;
  return im?.disk ? dirOf(im.path) : undefined;
}

// ------------------------------------------------------------------ desktop: watching loaded pictures

let watched = '';
/** Tells the desktop app which files to watch: every picture a row uses that came from disk. Cheap to call often. */
export function syncWatch() {
  if (!isDesktop) return;
  const ids = new Set([...S.t[1].rows.map(r => r.image), ...S.t[2].rows.map(r => r.image)].filter((x): x is string => !!x));
  const paths = [...new Set([...ids].map(id => images.get(id)).filter(im => im?.disk).map(im => im!.path))].sort();
  const key = paths.join('\n');
  if (key === watched) return;
  watched = key;
  watchFiles(paths).catch(e => console.error('Watching files failed', e));
}

/** Reads these files again and gives every row that shows one of them the new picture (its settings stay).
    Returns the paths whose picture changed. A file that can't be read or decoded yet (the art app is still writing
    it) is tried once more a moment later. */
export async function reloadPaths(paths: string[], retry = true): Promise<string[]> {
  const changed: string[] = [], later: string[] = [];
  for (const path of new Set(paths)) {
    const olds = [...images.values()].filter(im => im.disk && samePath(im.path, path));
    if (!olds.length) continue;
    let li: LoadedImage;
    try { li = await registerImage(new Blob([await readFile(path) as Uint8Array<ArrayBuffer>], { type: 'image/png' }), olds[0].path, undefined, undefined, true); }
    catch { later.push(path); continue; }
    if (olds.every(o => o.png === li.png)) { images.delete(li.id); continue; }
    const oldIds = new Set(olds.map(o => o.id));
    for (const r of [...S.t[1].rows, ...S.t[2].rows]) if (r.image && oldIds.has(r.image)) r.image = li.id;
    for (const id of oldIds) images.delete(id);
    changed.push(olds[0].path);
  }
  if (changed.length) {
    renderT1(); renderT2(); refreshSel(S.mode); renderPreview(S.mode);
    markDirty();
  }
  if (later.length && retry) setTimeout(() => reloadPaths(later, false).then(c => { if (c.length) toast(`🔄 Read again: ${c.map(fileOf).join(', ')}`); }), 700);
  return changed;
}

/** The desktop app's file events. Art apps write a file in several steps, so changes are gathered for a moment. */
function initWatching() {
  let pending = new Set<string>(), timer = 0;
  onFilesChanged(paths => {
    for (const p of paths) pending.add(p);
    clearTimeout(timer);
    timer = window.setTimeout(async () => {
      const list = [...pending]; pending = new Set();
      const changed = await reloadPaths(list);
      if (changed.length) toast(`🔄 Read again: ${changed.length > 3 ? `${changed.length} pictures` : changed.map(fileOf).join(', ')}`);
    }, 350);
  });
}

// ------------------------------------------------------------------ drag and drop (files and folders)

async function entriesOf(dir: FileSystemDirectoryEntry): Promise<FileSystemEntry[]> {
  const reader = dir.createReader(), out: FileSystemEntry[] = [];
  for (;;) {
    const chunk = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
    if (!chunk.length) return out;
    out.push(...chunk);
  }
}
const fileOfEntry = (e: FileSystemFileEntry) => new Promise<File>((res, rej) => e.file(res, rej));

/** Dropped items: files as they are, and the files directly inside dropped folders (not sub-folders). */
async function droppedFiles(dt: DataTransfer): Promise<Incoming[]> {
  const entries = [...dt.items].map(it => it.webkitGetAsEntry?.()).filter((e): e is FileSystemEntry => !!e);
  if (!entries.length) return [...dt.files].map(f => ({ file: f, path: f.name }));
  const out: Incoming[] = [];
  for (const e of entries) {
    if (e.isFile) out.push({ file: await fileOfEntry(e as FileSystemFileEntry), path: e.name });
    else if (e.isDirectory) {
      for (const c of await entriesOf(e as FileSystemDirectoryEntry)) if (c.isFile) out.push({ file: await fileOfEntry(c as FileSystemFileEntry), path: `${e.name}/${c.name}` });
    }
  }
  return out;
}

export function initLoading() {
  if (isDesktop) return initDesktopLoading();
  const pick = $<HTMLInputElement>('#pickFiles'), folder = $<HTMLInputElement>('#pickFolder'), sess = $<HTMLInputElement>('#pickSession');
  $('#btnAddFiles').onclick = () => { pick.value = ''; pick.click(); };
  $('#btnAddFolder').onclick = () => { folder.value = ''; folder.click(); };
  $('#btnLoad').onclick = () => { sess.value = ''; sess.click(); };
  pick.onchange = () => addFiles([...pick.files!].map(f => ({ file: f, path: f.name })));
  // the folder picker lists sub-folders too; like a drop, only the files directly inside the folder are added
  folder.onchange = () => addFiles([...folder.files!].filter(f => f.webkitRelativePath.split('/').length === 2).map(f => ({ file: f, path: f.webkitRelativePath })));
  sess.onchange = () => { if (sess.files![0]) loadSessionFile(sess.files![0]); };

  const hasFiles = (e: DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].includes('Files');
  window.addEventListener('dragover', e => { if (hasFiles(e)) { e.preventDefault(); e.dataTransfer!.dropEffect = 'copy'; } });
  window.addEventListener('drop', async e => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    addFiles(await droppedFiles(e.dataTransfer!));
  });
}

function initDesktopLoading() {
  $('#btnAddFiles').onclick = async () => addPaths(await pickPngs(startDir()));
  $('#btnAddFolder').onclick = async () => { const d = await pickFolder('Add every PNG in a folder', startDir()); if (d) addPaths([d]); };
  $('#btnLoad').onclick = async () => { const p = await pickSession(S.sessionPath ? dirOf(S.sessionPath) : undefined); if (p) loadSessionPath(p); };
  onDropPaths(paths => addPaths(paths));
  initWatching();
}

/** Files given on the command line: a session file, or pictures and folders ("Open with", or dropped on the exe).
    Returns whether there were any. */
export async function openStartArgs(): Promise<boolean> {
  if (!isDesktop) return false;
  const args = await startArgs().catch(() => [] as string[]);
  const session = args.find(a => /\.json$/i.test(a));
  if (session) await loadSessionPath(session);
  else await addPaths(args);
  return args.length > 0;
}
