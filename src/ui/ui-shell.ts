/* Tooltips, toast, dialogs, the Run button, top bar buttons, keyboard, the sheet frame card and output folders
   (from the mockup's ui-shell.js). The mockup-only colour scheme and notes dialogs are left out. */

import { zipSync } from 'fflate';
import {
  builtExports, encodePng, exportModel, FRAME_PRESETS, hasEnds, initMesh, modelNames, needsMesh, pixelHash, planFileNames, setFileParts, type FramePreset,
} from '../core';
import { dirOf, guidePath, isAbsolute, isDesktop, joinPath, listDir, moveAside, nativePath, openFolder, openLink, pickFolder, samePath, writeFile } from './desktop';
import { addToSheets, decodePng, outOfDate, planHandOff, spriteOf, type HandOff, type MadeSheet } from './handoff';
import { reloadPaths, syncWatch } from './load';
import { sheetFor } from './sheets';
import { partsOf } from './models';
import { DIR_PRESETS } from './presets';
import { $, $$, esc, q } from './dom';
import { markDirty, saveSessionFile } from './session-ui';
import { images, S, table, type Mode, type SheetRow, type SpriteRow } from './state';
import { m1info, refreshSel, renderT1, renderT2, renderTable, sheetNameFor } from './ui-core';
import { refreshExportPreviews } from './ui-exports';
import { bindZooms, clampFocus, loadLight, previewM1, previewM2, readyRows, renderPreview, setCamera, setLight, setMode, setView } from './ui-preview';

// ------------------------------------------------------------------ tooltips

let tipEl: Element | null = null, tipTimer = 0;
export function hideTip() { clearTimeout(tipTimer); $('#tip').classList.remove('show'); tipEl = null; }

function initTooltips() {
  const tip = $('#tip');
  document.addEventListener('mouseover', e => {
    const el = (e.target as Element).closest<HTMLElement>('[data-tip]');
    if (el === tipEl) return;
    tipEl = el; clearTimeout(tipTimer); tip.classList.remove('show');
    if (!el) return;
    tipTimer = window.setTimeout(() => {
      tip.innerHTML = el.dataset.tip!;
      const r = el.getBoundingClientRect(), tw = tip.offsetWidth, th = tip.offsetHeight;
      let x = r.left + r.width / 2 - tw / 2, y = r.bottom + 8;
      if (y + th > innerHeight - 6) y = r.top - th - 8;
      x = Math.max(8, Math.min(innerWidth - tw - 8, x));
      tip.style.left = x + 'px'; tip.style.top = y + 'px';
      tip.classList.add('show');
    }, 380);
  });
  document.addEventListener('mousedown', () => { clearTimeout(tipTimer); tip.classList.remove('show'); });
}

// ------------------------------------------------------------------ toast & modals

let toastT = 0;
export function toast(msg: string, ms = msg.length > 70 ? 4000 : 1900) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastT); toastT = window.setTimeout(() => t.classList.remove('show'), ms);
}

export function modal(html: string) {
  $('#modal').innerHTML = html + '<div class="close-row"><button class="btn" data-close>Close</button></div>';
  $('#modalBg').hidden = false;
}

/** Opens a page of the guide (public/guide/: `user-guide.html` or `paint-a-sheet.html`, pages of their own so the
    release folder can ship them) in the browser, where there's room to read it. */
async function openGuide(page: string) {
  if (!isDesktop) { window.open(`guide/${page}`, '_blank', 'noopener'); return; }
  const path = await guidePath(page).catch(() => null);
  if (!path) return toast('The guide wasn’t found: it should be in the "guide" folder next to the program.');
  openFolder(path).catch(e => toast(`Couldn't open the guide: ${e}`));
}

// ------------------------------------------------------------------ run batch
// ① makes real sheets: the browser downloads them as one zip, the desktop app writes them into the output folder.
// ② builds every model and saves every ticked export the same way.

/** Puts a ① run's sheets into ② (see handoff.ts) and shows them. */
function handOff(made: MadeSheet[]) {
  addToSheets(made);
  clampFocus(2);
  renderT2(); refreshSel(2);
  markDirty();
}

function download(bytes: Uint8Array, name: string, type: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type }));
  a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
}

const tick = () => new Promise(res => setTimeout(res, 0));

/** The folder of the first row's picture that is a file on disk, for the output folder picker to start in. */
function rowsDir(m: Mode): string | undefined {
  for (const r of S.t[m].rows) { const im = r.image ? images.get(r.image) : undefined; if (im?.disk) return dirOf(im.path); }
  return undefined;
}

/** Desktop app: the mode's output folder, asking for one when none is picked yet. Null when the user cancels. */
async function outputDir(m: Mode): Promise<string | null> {
  const o = m === 1 ? S.m1 : S.m2;
  if (o.output) return o.output;
  return pickOutput(m);
}

async function pickOutput(m: Mode): Promise<string | null> {
  const o = m === 1 ? S.m1 : S.m2;
  const dir = await pickFolder(m === 1 ? 'Where should the sheets go?' : 'Where should the exports go?', o.output || rowsDir(m));
  if (!dir) return null;
  o.output = dir; syncFolders(); markDirty();
  return dir;
}

/** The "Open the folder" button at the end of a desktop run. */
function addOpenFolder(dir: string) {
  $('#modal .close-row').insertAdjacentHTML('afterbegin', '<button class="btn" style="margin-right:8px" id="openOut">📂 Open the folder</button>');
  $('#openOut').onclick = () => openFolder(dir).catch(e => toast(`Couldn't open the folder: ${e}`));
}

/** Makes the sheets for these ① rows. With "Also add finished sheets to ②" (or `toSheets`, a remake asked for from ②)
    each sheet goes into ②, and one ① made before for the same sprite is remade in place (see handoff.ts). */
async function runSheets(rows: SpriteRow[], toSheets = S.m1.addToSheets) {
  const dir = isDesktop ? await outputDir(1) : null;
  if (isDesktop && !dir) return;
  // the window opens first: looking at the sheets already in ② reads each one from disk
  modal(`<h2>Making sheets…</h2>
    <p id="runMsg">${toSheets ? 'Checking the sheets already in ② for painting…' : `${rows.length} sheets`}</p>
    <div class="progress"><div class="bar" id="runBar"></div></div>
    <ul class="joblist"></ul>`);
  const plans: HandOff[] = toSheets ? await planHandOff(rows, S.m1.neverOverwrite) : rows.map(() => ({}));
  if ($('#modalBg').hidden) return toast('Stopped: no sheets were made.');
  // The desktop app passes the output folder's files as `existing`, so a painted sheet is never overwritten. The
  // browser can't see the folder, so it keeps clear of the sheets in ② instead. A remade sheet may keep the name of
  // the one it replaces, when that one is in the same folder (it's moved aside first).
  const existing = dir ? (await listDir(dir).catch(() => [])).filter(e => !e.dir).map(e => e.name) : S.t[2].rows.map(x => x.file);
  const own = plans.map(p => (p.target && (!dir || samePath(dirOf(p.target.path), dir)) ? p.target.file : undefined));
  const names = planFileNames(rows.map(r => sheetNameFor(r, m1info(r).N!)), existing, S.m1.neverOverwrite, own);
  $('#runMsg').textContent = `${rows.length} sheets`;
  $('#modal .joblist').innerHTML = names.map((n, i) => `<li data-j="${i}"><span class="st">⏳</span>${esc(n)}</li>`).join('');
  const made: MadeSheet[] = [], failed: string[] = [];
  for (let i = 0; i < rows.length; i++) {
    await tick();
    if ($('#modalBg').hidden) {
      if (!dir) return toast('Stopped: no sheets were saved.');
      if (toSheets && made.length) handOff(made);
      return toast(`Stopped: ${made.length} sheet${made.length === 1 ? ' was' : 's were'} saved.`);
    }
    const r = rows[i], p = plans[i], sh = sheetFor(r.image, r.side, r.depth, r.shape, r.ends, r.outline !== false, !!r.copySides, S.frame);
    let ok = !!sh, why = '';
    if (sh) {
      const png = encodePng(sh.sheet.image), path = dir ? joinPath(dir, names[i]) : names[i];
      try {
        // fingerprinted the way the sheet will be read back, so an untouched file still matches it later
        const img = await decodePng(png), hash = pixelHash(img);
        const unchanged = !!p.target && p.state === 'clean' && samePath(p.target.path, path) && hash === p.target.link!.made;
        if (dir && !unchanged) {
          // the sheet being remade goes into a "replaced" folder next to it, never thrown away
          if (p.target && p.state !== 'gone' && isAbsolute(p.target.path)) await moveAside(p.target.path);
          await writeFile(path, png);
        }
        made.push({ row: r, plan: p, file: names[i], path, png, img, hash, unchanged });
      } catch (e) { ok = false; why = String(e); }
    }
    if (!ok) failed.push(names[i]);
    const li = q(`.joblist li[data-j="${i}"]`);
    if (li) { li.querySelector('.st')!.textContent = ok ? '✅' : '✖'; if (why) li.title = why; li.scrollIntoView({ block: 'nearest' }); }
    $('#runBar').style.width = ((i + 1) / rows.length * 100) + '%';
  }
  const handed = toSheets && made.length > 0;
  if (handed) handOff(made);
  if (dir) finishSheetsDesktop(made, failed, dir, handed);
  else finishSheetsBrowser(made, failed, handed, toSheets);
  if (handed && S.mode === 1) {
    $('#modal .close-row').insertAdjacentHTML('afterbegin', '<button class="btn accent" style="margin-right:8px" id="goM2">Go to ② →</button>');
    $('#goM2').onclick = () => { $('#modalBg').hidden = true; setMode(2); };
  }
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** What the run did to the sheets ② already had: remade in place, already up to date, or kept for their painting. */
function handOffNotes(made: MadeSheet[], dir: string | null) {
  const replaced = made.filter(m => m.plan.target && !m.unchanged).length, same = made.filter(m => m.unchanged).length;
  const kept = made.filter(m => m.plan.like).length;
  return (replaced ? `<br>♻️ ${replaced} ${plural(replaced, 'sheet', 'sheets')} took the place of ${plural(replaced, 'its', 'their')} earlier version in ②, which kept ${plural(replaced, 'its', 'their')} ② settings.${dir ? ` The old ${plural(replaced, 'file is', 'files are')} in a "replaced" folder next to ${plural(replaced, 'it', 'them')}.` : ''}` : '')
    + (same ? `<br>✔ ${same} ${plural(same, 'sheet was', 'sheets were')} already up to date, so ${plural(same, 'it was', 'they were')} left as ${plural(same, 'it was', 'they were')}.` : '')
    + (kept ? `<br>🎨 ${kept} earlier ${plural(kept, 'sheet has', 'sheets have')} painting on ${plural(kept, 'it', 'them')}, so ${plural(kept, 'it was', 'they were')} kept. The new ${plural(kept, 'sheet sits', 'sheets sit')} right below ${plural(kept, 'it', 'each one')} in ②, with the same ② settings.` : '');
}

function finishSheetsBrowser(made: MadeSheet[], failed: string[], handed: boolean, toSheets: boolean) {
  const zipName = `${S.name || 'sheets'} sheets.zip`;
  // without "Download", the sheets only go to ②; sheets that don't go to ② are always downloaded, or they'd be lost
  const zipped = made.length > 0 && (S.m1.download || !toSheets);
  if (zipped) download(zipSync(Object.fromEntries(made.map(m => [m.file, m.png])), { level: 0 }), zipName, 'application/zip');
  $('#modal h2').textContent = made.length ? 'All done! 🎉' : 'Nothing made';
  $('#runMsg').innerHTML = `<b>${made.length} sheet${made.length === 1 ? '' : 's'}</b> made${zipped ? ` and downloaded as <b>${esc(zipName)}</b>` : ''}${handed ? `${zipped ? ',' : ''} and added to ②` : ''}.${failed.length ? ` ${failed.length} couldn't be made.` : ''}
    ${zipped ? 'Unzip them somewhere, paint the empty sides in your art app, then load them in ②.' : 'Nothing was downloaded. When you want to paint on them, turn on "Download the sheets as a zip" and run again.'}`
    + handOffNotes(made, null);
}

function finishSheetsDesktop(made: MadeSheet[], failed: string[], dir: string, handed: boolean) {
  // sheets kept next to a painted one are counted there, and a remade sheet keeping its numbered name isn't news
  const renamed = made.filter(m => !m.plan.like && !m.plan.target && m.file !== sheetNameFor(m.row, m1info(m.row).N!)).length;
  const saved = made.filter(m => !m.unchanged).length;
  $('#modal h2').textContent = made.length ? 'All done! 🎉' : 'Nothing made';
  $('#runMsg').innerHTML = (saved || !made.length ? `<b>${saved} sheet${saved === 1 ? '' : 's'}</b> saved in <b>${esc(nativePath(dir))}</b>${handed ? ' and added to ②' : ''}.` : 'No sheet needed saving again.')
    + (renamed ? ` ${renamed} got a number at the end of the name, because another sheet already had that name.` : '')
    + (failed.length ? ` ${failed.length} couldn't be made or saved: ${listNames(failed)}.` : '')
    + (made.length ? ' Paint the empty sides in your art app, then build the models in ②. Sheets in ② are read again by themselves whenever you save them.' : '')
    + handOffNotes(made, dir);
  if (made.length) addOpenFolder(dir);
}

const listNames = (names: string[]) => esc(names.length > 6 ? `${names.slice(0, 6).join(', ')} and ${names.length - 6} more` : names.join(', '));

async function runModels(rows: SheetRow[]) {
  const dir = isDesktop ? await outputDir(2) : null;
  if (isDesktop && !dir) return;
  const e = S.exp, built = builtExports(e), setParts = setFileParts(e.sprites.sets, DIR_PRESETS);
  const skippedRows = S.t[2].rows.length - rows.length;
  modal(`<h2>Building & exporting…</h2>
    <p id="runMsg">${rows.length} model${rows.length === 1 ? '' : 's'} × ${built.length} export${built.length === 1 ? '' : 's'}${built.length ? ` (${esc(built.join(', '))})` : ''}</p>
    <div class="progress"><div class="bar" id="runBar"></div></div>
    <ul class="joblist">${rows.map((r, i) => `<li data-j="${i}"><span class="st">⏳</span><span>${esc(r.file)}<small class="why"></small></span></li>`).join('')}</ul>`);
  if (needsMesh(e)) await initMesh();
  const files: Record<string, Uint8Array> = {}, kinds = new Map<string, number>();
  // one name per model; two sheets with the same name get a number, as ① does for sheets
  const names = modelNames(rows.map(r => r.file));
  const warned: string[] = [], failed: string[] = [], voxSkipped: string[] = [], unsaved: string[] = [];
  let made = 0, saved = 0;
  for (let i = 0; i < rows.length; i++) {
    await tick();
    if ($('#modalBg').hidden) return toast(dir ? `Stopped: the files of ${made} model${made === 1 ? ' were' : 's were'} saved.` : 'Stopped: nothing was saved.');
    const r = rows[i], name = names[i];
    // the files are made by the core (core/exports.ts), the same way the command-line tool makes them
    const res = exportModel(partsOf(r), r, e, name, setParts, S.m2.folderPerModel), why = res.why;
    for (const f of res.files) kinds.set(f.kind, (kinds.get(f.kind) ?? 0) + 1);
    if (res.failed) failed.push(name);
    else {
      made++;
      if (res.voxSkipped) voxSkipped.push(name);
      if (res.trimmed) warned.push(name);
    }
    // the desktop app saves each model's files as soon as they're made; the browser zips them all at the end
    if (dir) {
      let lost = 0;
      for (const f of res.files) { try { await writeFile(joinPath(dir, f.path), f.bytes); saved++; } catch (err) { lost++; console.error(err); } }
      if (lost) { unsaved.push(name); why.push(`${lost} file${lost === 1 ? '' : 's'} couldn't be saved`); }
    } else for (const f of res.files) files[f.path] = f.bytes;
    const li = q(`.joblist li[data-j="${i}"]`);
    if (li) {
      li.querySelector('.st')!.textContent = res.failed ? '✖' : why.length ? '⚠' : '✅';
      if (why.length) li.querySelector('.why')!.textContent = ` — ${why.join(', ')}`;
      li.scrollIntoView({ block: 'nearest' });
    }
    $('#runBar').style.width = ((i + 1) / rows.length * 100) + '%';
  }
  const count = dir ? saved : Object.keys(files).length, zipName = `${S.name || 'models'} models.zip`;
  if (count && !dir) download(zipSync(files, { level: 6 }), zipName, 'application/zip');
  const kindText = [...kinds].map(([k, v]) => `${v} ${k.startsWith('.') ? k : k + (v === 1 ? '' : 's')}`).join(', ');
  const where = dir ? `saved in <b>${esc(nativePath(dir))}</b>` : `downloaded as <b>${esc(zipName)}</b>`;
  $('#modal h2').textContent = count ? 'All done! 🎉' : 'Nothing made';
  $('#runMsg').innerHTML = (count ? `<b>${made} model${made === 1 ? '' : 's'}</b> exported (${esc(kindText)}) and ${where}${S.m2.folderPerModel ? ', one folder per model' : ''}.`
    : built.length ? 'Nothing could be saved.' : 'No export is ticked, so nothing was saved.')
    + (unsaved.length ? `<br>✖ Some files couldn't be saved for: ${listNames(unsaved)}. Is the folder read-only, or a file open in another program?` : '')
    + (failed.length ? `<br>✖ Nothing left to build, so skipped: ${listNames(failed)}.` : '')
    + (warned.length ? `<br>⚠ Built, but some paint was cut off: ${listNames(warned)}. Check them in Sheet check.` : '')
    + (voxSkipped.length ? `<br>⚠ Too many colours for a .vox file, so no voxel model for: ${listNames(voxSkipped)}. Pick "Merge similar colours" in the Voxel model options to make them anyway.` : '')
    + (skippedRows ? `<br>${skippedRows} sheet${skippedRows === 1 ? '' : 's'} with a red ✖ ${skippedRows === 1 ? 'was' : 'were'} skipped.` : '');
  if (dir && count) addOpenFolder(dir);
}

function run() {
  const m = S.mode;
  const rows = readyRows(m);
  if (m === 1) runSheets(rows as SpriteRow[]);
  else runModels(rows as SheetRow[]);
}

/** The ② row differs from its file name in side, shape or ends (the orange "changed" tags). */
const changedInM2 = (r: SheetRow) => !r.renamed && (r.side !== r.fileSide || r.shape !== r.fileShape || (hasEnds(r.shape) && r.ends !== r.fileEnds));

/** ②'s remake buttons, on the clicked row (or on every selected row, when it's one of them): remakes the sheets from
    their ① sprites. With `apply`, the side, shape and ends picked in ② go to ① first, so the new sheet matches them. */
function remakeFromM2(i: number, apply: boolean) {
  const T = S.t[2], picked = T.sel.has(i) && T.sel.size > 1 ? [...T.sel].map(j => T.rows[j]) : [T.rows[i]];
  const sprites: SpriteRow[] = [];
  for (const row of picked) {
    const sp = spriteOf(row);
    if (!sp || sprites.includes(sp) || (apply ? !changedInM2(row) : !outOfDate(row))) continue;
    if (apply) {
      if (sp.side !== row.side) { sp.side = row.side; sp.sideAuto = false; }
      sp.shape = row.shape;
      if (hasEnds(row.shape)) sp.ends = row.ends;
    }
    sprites.push(sp);
  }
  if (apply && sprites.length) { renderT1(); markDirty(); }
  const ready = sprites.filter(r => m1info(r).status[0] !== 'err');
  if (!ready.length) return toast(sprites.length ? 'That sprite can\'t be made into a sheet: see its ✖ in ①.' : 'Nothing to remake.');
  runSheets(ready, true);
}

// ------------------------------------------------------------------ sheet frame colours (Phase 1 setting, saved in the session)

const FRAME_HINT: Record<FramePreset, string> = {
  jv: 'Two colours: a calm edge next to your art, and a brighter centre line that says "not art".',
  classic: 'The old look: neutral grey edges with a vivid magenta centre line.',
  single: 'One solid colour for the whole 3 px frame. Simple and calm; pick something your art doesn\'t use.',
  custom: 'Your own pair: edge colour first, centre line second.',
};
export function syncFrameUI() {
  const f = S.frame;
  $<HTMLSelectElement>('#frameSel').value = f.preset;
  $<HTMLInputElement>('#frameEdge').value = f.edge; $<HTMLInputElement>('#frameCore').value = f.core;
  $('#frameCore').hidden = f.preset === 'single';
  $('#frameEdge').dataset.tip = f.preset === 'single' ? 'The frame colour.' : 'Edge colour: the two outer lines that touch your art. A dark, dull colour is easiest to judge colours against.';
  $('#frameHint').textContent = FRAME_HINT[f.preset];
}
function bindFrame() {
  $('#frameSel').onchange = e => {
    const v = (e.target as HTMLSelectElement).value as FramePreset;
    if (v !== 'custom') [S.frame.edge, S.frame.core] = FRAME_PRESETS[v];
    S.frame.preset = v; syncFrameUI(); previewM1(); markDirty();
  };
  $('#frameEdge').addEventListener('input', e => {
    S.frame.edge = (e.target as HTMLInputElement).value;
    if (S.frame.preset === 'single') S.frame.core = S.frame.edge; else S.frame.preset = 'custom';
    syncFrameUI(); previewM1(); markDirty();
  });
  $('#frameCore').addEventListener('input', e => { S.frame.core = (e.target as HTMLInputElement).value; S.frame.preset = 'custom'; syncFrameUI(); previewM1(); markDirty(); });
}

// ------------------------------------------------------------------ output folders

const FOLDER_TIPS = { m1out: $('#m1out').dataset.tip!, m2out: $('#m2out').dataset.tip! };

export function syncFolders() {
  const none = isDesktop ? 'Not picked yet' : 'Downloads (as a zip)';
  for (const [id, out] of [['m1out', S.m1.output], ['m2out', S.m2.output]] as const) {
    const full = out && isDesktop ? nativePath(out) : out, parts = full.split('\\');
    // a long path shows its last two folders, which say the most; the tooltip has all of it
    const short = parts.length > 3 && full.length > 34 ? `…\\${parts.slice(-2).join('\\')}` : full;
    $(`#${id}`).textContent = `📁 ${short || none}`;
    $(`#${id}`).dataset.tip = full ? `${FOLDER_TIPS[id]}<br><b>${esc(full)}</b>` : FOLDER_TIPS[id];
  }
}

// ------------------------------------------------------------------ misc buttons & keys

/** The ② Reload button: the desktop app reads every sheet from disk again (it also does so by itself whenever one is
    saved); the browser can't, and says how to get a saved sheet back in. */
async function reload() {
  if (!isDesktop) {
    renderT2(); renderPreview(2);
    return toast('🔄 In the browser, sheets can\'t be re-read from disk. Drop the saved sheet on the window again: it replaces the old picture and keeps its settings. (The desktop app reloads them by itself.)');
  }
  const paths = S.t[2].rows.map(r => (r.image ? images.get(r.image) : undefined)).filter(im => im?.disk).map(im => im!.path);
  const changed = await reloadPaths(paths);
  renderT2(); renderPreview(2);
  toast(`🔄 Read ${paths.length} sheet${paths.length === 1 ? '' : 's'} again: ${changed.length ? `${changed.length} had changed` : 'none had changed'}`);
}

function removeSel(m: Mode) {
  const T = table(m); if (!T.sel.size) return;
  const n = T.sel.size;
  T.rows = T.rows.filter((_, i) => !T.sel.has(i));
  T.focus = Math.min(T.focus, T.rows.length - 1); T.anchor = Math.max(0, T.focus);
  T.sel = new Set(T.rows.length ? [T.focus] : []);
  T.focus = Math.max(0, T.focus);
  renderTable(m); refreshSel(m);
  markDirty(); syncWatch();
  toast(`🗑 Removed ${n} row${n > 1 ? 's' : ''} from the list (files untouched)`);
}

export function initShell() {
  initTooltips();
  $('#modalBg').addEventListener('click', e => { const t = e.target as Element; if (t.id === 'modalBg' || t.closest('[data-close]')) $('#modalBg').hidden = true; });
  $('#m1guide').onclick = () => openGuide('paint-a-sheet.html');
  $('#btnGuide').onclick = () => openGuide('user-guide.html');
  $('#btnRun').onclick = run;
  $$('.tab').forEach(t => t.onclick = () => { setMode(+t.dataset.mode! as Mode); markDirty(); });
  $('#btnSave').onclick = saveSessionFile;
  if (isDesktop) {
    $('#m1outChange').onclick = () => pickOutput(1);
    $('#m2outChange').onclick = () => pickOutput(2);
    // links open in the system browser, not inside the app's window
    document.addEventListener('click', e => {
      const a = (e.target as Element).closest<HTMLAnchorElement>('a[href^="http"]'); if (!a) return;
      e.preventDefault();
      openLink(a.href).catch(err => toast(`Couldn't open the link: ${err}`));
    });
  } else {
    const folderTip = () => toast('Picking output folders comes with the desktop app. In the browser, finished files will download as a zip.');
    $('#m1outChange').onclick = folderTip;
    $('#m2outChange').onclick = folderTip;
  }

  document.addEventListener('click', e => {
    const b = (e.target as Element).closest<HTMLElement>('[data-act]'); if (!b) return;
    const m = S.mode, T = table(m);
    if (b.dataset.act === 'selall') { T.sel = new Set(T.rows.map((_, i) => i)); refreshSel(m); }
    if (b.dataset.act === 'selnone') { T.sel = new Set(T.rows.length ? [T.focus] : []); refreshSel(m); }
    if (b.dataset.act === 'remove') removeSel(m);
    if (b.dataset.act === 'reload') reload();
  });
  document.addEventListener('click', e => {
    const b = (e.target as Element).closest<HTMLElement>('#t2 [data-remake]'); if (!b) return;
    remakeFromM2(+b.closest<HTMLElement>('tr')!.dataset.i!, b.dataset.remake === 'apply');
  });

  // The desktop app should feel like a program, not a web page: no browser menu on right-click (except in text fields)
  // and no reload, print, find or developer-tools keys.
  if (isDesktop) {
    const editable = (t: EventTarget | null) => t instanceof Element && !!t.closest('input, textarea, select, [contenteditable="true"]');
    document.addEventListener('contextmenu', e => { if (!editable(e.target)) e.preventDefault(); });
    document.addEventListener('keydown', e => {
      const k = e.key.toLowerCase(), ctrl = e.ctrlKey || e.metaKey;
      if (k === 'f5' || (ctrl && 'rpfguj'.includes(k) && k.length === 1) || (ctrl && e.shiftKey && k === 'i')) e.preventDefault();
    });
  }

  document.addEventListener('keydown', e => {
    if (!$('#modalBg').hidden) { if (e.key === 'Escape') $('#modalBg').hidden = true; return; }
    const target = e.target as HTMLElement;
    const inField = target.matches('input, select');
    const m = S.mode, T = table(m);
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a' && !inField) { e.preventDefault(); T.sel = new Set(T.rows.map((_, i) => i)); refreshSel(m); }
    else if (e.key === 'Escape') { T.sel = new Set(T.rows.length ? [T.focus] : []); refreshSel(m); if (inField) target.blur(); }
    else if (e.key === 'Delete' && !inField) removeSel(m);
    else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !inField) {
      e.preventDefault();
      if (!T.rows.length) return;
      const i = Math.max(0, Math.min(T.rows.length - 1, T.focus + (e.key === 'ArrowDown' ? 1 : -1)));
      if (e.shiftKey) { T.sel = new Set(); for (let k = Math.min(T.anchor, i); k <= Math.max(T.anchor, i); k++) T.sel.add(k); }
      else { T.sel = new Set([i]); T.anchor = i; }
      T.focus = i; refreshSel(m);
      q(`#t${m} tr[data-i="${i}"]`)?.scrollIntoView({ block: 'nearest' });
    }
  });

  bindZooms();
  $('#m1showLabels').onchange = previewM1;
  bindFrame();
  $$('#m2view button').forEach(b => b.onclick = () => { setView(b.dataset.v as 'poly' | 'vox' | 'sheet'); previewM2(); });
  $('#rotL').onclick = () => { S.rot--; previewM2(); };
  $('#rotR').onclick = () => { S.rot++; previewM2(); };
  $$('#m2cam button').forEach(b => b.onclick = () => { setCamera(b.dataset.c === 'low'); previewM2(); });
  loadLight();
  $('#m2light').onchange = e => { setLight((e.target as HTMLInputElement).checked); previewM2(); };
  $('#m2trim').onchange = previewM2;
  document.addEventListener('click', e => {
    const b = (e.target as Element).closest<HTMLElement>('.narrow-switch button'); if (!b) return;
    const ex = b.dataset.show === 'ex';
    $('#mode2').classList.toggle('show-ex', ex);
    $$('.narrow-switch button').forEach(x => x.classList.toggle('on', x.dataset.show === b.dataset.show));
    ex ? refreshExportPreviews() : previewM2();
  });
  $('#peel').addEventListener('input', e => { S.peel.n = +(e.target as HTMLInputElement).value; previewM2(); });
  $$('#peelAxis button').forEach(b => b.onclick = () => { S.peel.axis = b.dataset.a as 'front' | 'top'; $$('#peelAxis button').forEach(x => x.classList.toggle('on', x === b)); previewM2(); });
  window.addEventListener('resize', () => renderPreview(S.mode));
}
