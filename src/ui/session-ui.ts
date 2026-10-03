/* Session files and autosave (DESIGN.md §13). One JSON file holds both lists and every setting. The browser build can't
   see real folders, so it embeds each picture as a PNG data URL next to its path, and autosaves to browser storage.
   The desktop app stores paths relative to the session file (pictures that aren't files on disk are still embedded)
   and autosaves to a file in its data folder, also just before the window closes. */

import { fileOf, parseSession, serializeSession, SESSION_EXT, SessionError, type Session, type SessionImage } from '../core';
import { applySettingsToDom } from './bind';
import { autosavePath, beforeClose, dirOf, exampleSession, isAbsolute, isDesktop, pickSaveSession, readFile, readText, writeFile } from './desktop';
import { $ } from './dom';
import { registerImage, syncWatch } from './load';
import { clearModels } from './models';
import { defaultSets } from './presets';
import { images, S, sheetData, sheetRow, spriteData, spriteRow } from './state';
import { refreshSel, renderT1, renderT2 } from './ui-core';
import { renderSets, syncExportCards, syncTurntable } from './ui-exports';
import { clampFocus, setMode, setView } from './ui-preview';
import { syncFolders, syncFrameUI, toast } from './ui-shell';

const AUTOSAVE_KEY = 'p3d.autosave';

// ------------------------------------------------------------------ state ↔ session

/** The current state as a session. Only pictures still used by a row are included. Pictures read from a file on disk
    (desktop app) are stored by path only; the others carry the picture itself, unless `withPictures` is off. */
export function toSession(withPictures = true): Session {
  const sprites = S.t[1].rows.map(spriteData), sheets = S.t[2].rows.map(sheetData);
  const used = new Set([...sprites.map(r => r.image), ...sheets.map(r => r.image)].filter((x): x is string => !!x));
  const imgs: Record<string, SessionImage> = {};
  for (const id of used) { const im = images.get(id); if (im) imgs[id] = withPictures && !im.disk ? { path: im.path, png: im.png } : { path: im.path }; }
  return {
    app: 'pixel-to-3d-batch-builder', version: 1, name: S.name, savedAt: '', mode: S.mode,
    sprites: { rows: sprites, output: S.m1.output, addToSheets: S.m1.addToSheets, neverOverwrite: S.m1.neverOverwrite, download: S.m1.download, frame: { ...S.frame } },
    sheets: { rows: sheets, output: S.m2.output, folderPerModel: S.m2.folderPerModel },
    exports: structuredClone(S.exp),
    images: imgs,
  };
}

/** Brings back one picture of a session: from its file on disk (desktop app), else from the copy embedded in the file. */
async function restoreImage(id: string, im: SessionImage) {
  if (isDesktop && isAbsolute(im.path)) {
    try { await registerImage(new Blob([await readFile(im.path) as Uint8Array<ArrayBuffer>], { type: 'image/png' }), im.path, id, undefined, true); return; }
    catch { /* moved or deleted: try the embedded copy */ }
  }
  if (im.png) await registerImage(await (await fetch(im.png)).blob(), im.path, id, im.png);
}

/** Replaces the whole state with a session. Rows whose picture can't be restored are left out; returns how many. */
export async function applySession(s: Session): Promise<number> {
  images.clear();
  clearModels();
  const list = Object.entries(s.images);
  for (let i = 0; i < list.length; i += 8) {
    await Promise.all(list.slice(i, i + 8).map(([id, im]) => restoreImage(id, im).catch(() => { /* left out below */ })));
  }
  const m1 = s.sprites.rows.filter(r => images.has(r.image));
  const m2 = s.sheets.rows.filter(r => r.image && images.has(r.image));
  S.name = s.name;
  S.m1 = { output: s.sprites.output, addToSheets: s.sprites.addToSheets, neverOverwrite: s.sprites.neverOverwrite, download: s.sprites.download };
  S.m2 = { output: s.sheets.output, folderPerModel: s.sheets.folderPerModel };
  S.frame = { ...s.sprites.frame };
  S.exp = s.exports;
  S.t[1].rows = m1.map(spriteRow);
  S.t[2].rows = m2.map(sheetRow);
  for (const m of [1, 2] as const) {
    const T = S.t[m];
    T.focus = 0; T.anchor = 0; T.sel = new Set(T.rows.length ? [0] : []);
    clampFocus(m);
  }
  refreshAll(s.mode);
  syncWatch();
  return s.sprites.rows.length - m1.length + s.sheets.rows.length - m2.length;
}

/** Redraws everything after the state was replaced. */
export function refreshAll(mode = S.mode) {
  renderSets();
  applySettingsToDom();
  syncExportCards();
  syncTurntable();
  syncFrameUI();
  syncFolders();
  renderT1(); renderT2();
  setView(S.m2view);
  refreshSel(2);
  setMode(mode);
  refreshSel(mode);
  $('#sessionName').textContent = S.name;
}

// ------------------------------------------------------------------ save and load files

type SaveHandle = { name: string; createWritable(): Promise<{ write(d: string): Promise<void>; close(): Promise<void> }> };
type SavePicker = (o: object) => Promise<SaveHandle>;

/** Desktop app: asks where to save (starting at the current session file) and writes paths relative to it. */
async function saveSessionDesktop() {
  let path = await pickSaveSession(S.sessionPath ?? `${S.name}${SESSION_EXT}`);
  if (!path) return;
  if (!/\.json$/i.test(path)) path += SESSION_EXT;
  try { await writeFile(path, serializeSession(toSession(), { sessionDir: dirOf(path) })); }
  catch (e) { return toast(`💾 Couldn't save the session: ${e}`); }
  S.sessionPath = path;
  S.name = sessionNameOf(path);
  $('#sessionName').textContent = S.name;
  autosaveNow();
  toast(`💾 Saved session ${fileOf(path)}`);
}

const sessionNameOf = (file: string) => fileOf(file).replace(/(\.p3d)?\.json$/i, '');

export async function saveSessionFile() {
  if (isDesktop) return saveSessionDesktop();
  const text = serializeSession(toSession());
  const suggested = S.name + SESSION_EXT;
  const picker = (window as unknown as { showSaveFilePicker?: SavePicker }).showSaveFilePicker;
  if (picker) {
    // Chromium browsers (and the WebView2 the desktop app uses) can save to a real file
    let h: SaveHandle;
    try { h = await picker({ suggestedName: suggested, types: [{ description: 'Pixel to 3D session', accept: { 'application/json': [SESSION_EXT, '.json'] } }] }); }
    catch { return; } // cancelled
    const w = await h.createWritable(); await w.write(text); await w.close();
    S.name = h.name.replace(/(\.p3d)?\.json$/i, '');
  } else {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    a.download = suggested; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  $('#sessionName').textContent = S.name;
  autosaveNow();
  toast(`💾 Saved session ${S.name}${SESSION_EXT}`);
}

export async function loadSessionFile(file: Blob & { name: string }) {
  let s: Session;
  try { s = parseSession(await file.text(), defaultSets()); }
  catch (e) { return toast(`📂 ${e instanceof SessionError ? e.message : 'That file couldn\'t be opened.'}`); }
  s.name = file.name.replace(/(\.p3d)?\.json$/i, '');
  const lost = await applySession(s);
  autosaveNow();
  toast(`📂 Opened ${s.name}: ${S.t[1].rows.length} sprites, ${S.t[2].rows.length} sheets${lost ? ` (${lost} rows left out: their pictures weren't in the file)` : ''}`);
}

/** Desktop app: opens a session file by its path; paths in it are relative to its folder. */
export async function loadSessionPath(path: string, example = false) {
  let s: Session;
  try { s = parseSession(await readText(path), defaultSets(), { sessionDir: dirOf(path) }); }
  catch (e) { return toast(`📂 ${e instanceof SessionError ? e.message : `That file couldn't be opened (${e}).`}`); }
  s.name = sessionNameOf(path);
  const lost = await applySession(s);
  // the example isn't tied to its file, so Save asks for a new place rather than overwriting it
  S.sessionPath = example ? null : path;
  autosaveNow();
  if (example) toast('👋 Welcome! This is an example batch to learn from: click through the rows in ① and ②. To start your own, press Select all, then Remove, in each tab (the files stay where they are).', 12000);
  else toast(`📂 Opened ${s.name}: ${S.t[1].rows.length} sprites, ${S.t[2].rows.length} sheets${lost ? ` (${lost} rows left out: their pictures couldn't be found)` : ''}`);
}

/** Desktop app, very first start (nothing autosaved yet): opens the example session that ships in `examples/`, so a
    new user sees a finished batch to learn from. */
export async function openExample() {
  const path = isDesktop ? await exampleSession().catch(() => null) : null;
  if (path) await loadSessionPath(path, true);
}

// ------------------------------------------------------------------ autosave

let dirtyTimer = 0, lastSaved = 0, withoutPictures = false;

/** Call after any change that belongs in the session; the autosave follows a moment later. */
export function markDirty() {
  clearTimeout(dirtyTimer);
  dirtyTimer = window.setTimeout(autosaveNow, 1500);
}

/** Desktop autosave: the session with full paths, plus which session file it belongs to. */
interface DesktopAutosave { sessionPath: string | null; session: unknown }
let autosaveFile: Promise<string> | null = null;
const autosaveFileOf = () => (autosaveFile ??= autosavePath());

async function autosaveDesktop() {
  clearTimeout(dirtyTimer); dirtyTimer = 0;
  syncWatch();
  try {
    const save: DesktopAutosave = { sessionPath: S.sessionPath, session: JSON.parse(serializeSession(toSession())) };
    await writeFile(await autosaveFileOf(), JSON.stringify(save));
    lastSaved = Date.now();
  } catch (e) { console.error('Autosave failed', e); lastSaved = 0; }
  showAutosave();
}

function autosaveNow() {
  if (isDesktop) { autosaveDesktop(); return; }
  clearTimeout(dirtyTimer);
  try {
    try { localStorage.setItem(AUTOSAVE_KEY, serializeSession(toSession(true))); withoutPictures = false; }
    catch { localStorage.setItem(AUTOSAVE_KEY, serializeSession(toSession(false))); withoutPictures = true; } // too big for browser storage
    lastSaved = Date.now();
  } catch { lastSaved = 0; }
  showAutosave();
}

function showAutosave() {
  const el = $('#autosaveState');
  if (!lastSaved) { el.textContent = 'Autosave on'; return; }
  const min = Math.floor((Date.now() - lastSaved) / 60000);
  el.textContent = `Autosaved ${min < 1 ? 'just now' : `${min} min ago`}${withoutPictures ? ' (list only — too many pictures for browser storage)' : ''}`;
}

/** Desktop app: the last autosave, from the app's data folder. */
async function restoreDesktop(): Promise<boolean> {
  let saved: DesktopAutosave;
  try { saved = JSON.parse(await readText(await autosaveFileOf())); } catch { return false; }
  try {
    const s = parseSession(JSON.stringify(saved.session), defaultSets());
    const lost = await applySession(s);
    S.sessionPath = typeof saved.sessionPath === 'string' ? saved.sessionPath : null;
    const n = S.t[1].rows.length + S.t[2].rows.length;
    if (n || lost) toast(`↺ Picked up where you left off${lost ? ` (${lost} rows left out: their pictures couldn't be found)` : ''}`);
    lastSaved = Date.now();
    showAutosave();
    return true;
  } catch { return false; }
}

/** Brings back the last autosaved session, if there is one. */
export async function restoreAutosave(): Promise<boolean> {
  if (isDesktop) return restoreDesktop();
  let text: string | null = null;
  try { text = localStorage.getItem(AUTOSAVE_KEY); } catch { /* storage blocked */ }
  if (!text) return false;
  try {
    const s = parseSession(text, defaultSets());
    const lost = await applySession(s);
    const n = S.t[1].rows.length + S.t[2].rows.length;
    if (n || lost) toast(`↺ Picked up where you left off${lost ? ` (${lost} rows couldn't be restored)` : ''}`);
    lastSaved = Date.now();
    showAutosave();
    return true;
  } catch { return false; }
}

export function initAutosave() {
  setInterval(showAutosave, 30000);
  if (isDesktop) beforeClose(async () => { if (dirtyTimer) await autosaveDesktop(); });
  else window.addEventListener('beforeunload', () => { if (dirtyTimer) autosaveNow(); });
  showAutosave();
}

/** Desktop app: the folder of the session file, for pickers to start in. */
export const sessionDir = () => (S.sessionPath ? dirOf(S.sessionPath) : undefined);
