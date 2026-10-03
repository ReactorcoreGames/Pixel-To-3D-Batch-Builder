/* Derived row info, number fields with our own spin buttons, the two spreadsheet tables, and file-explorer style
   selection with mass edit (from the mockup's ui-core.js). */

import { checkSprite, hasEnds, HOLLOW_CORE_MAX, MATERIAL_PBR, sheetNameOf, type SheetRead } from '../core';
import { INSIDE_PAL } from './presets';
import { $, $$, esc, q } from './dom';
import { outOfDate, spriteOf } from './handoff';
import { readOf, trimCountOf } from './models';
import { autoPeek, renderPreview, updateRunLabel } from './ui-preview';
import { markDirty } from './session-ui';
import { toast } from './ui-shell';
import { images, S, table, type Mode, type SheetRow, type SpriteRow } from './state';
import { BLENDS, endsOptions, FALLBACKS, INSIDES, MATERIALS, SHAPES, SIDES } from './vocab';

export type Status = ['ok' | 'warn' | 'err', string, string];

// ------------------------------------------------------------------ derived row info

export function m1info(r: SpriteRow) {
  const im = images.get(r.image)!, sp = { w: im.img.width, h: im.img.height };
  const { size: [X, Y, Z], n: N, problem } = checkSprite(im.img.width, im.img.height, r.depth, r.side, im.empty);
  let status: Status = ['ok', '✓', 'Ready — a sheet will be made for this sprite.'];
  if (problem === 'too-big') status = ['err', '✖', `Too big: this sprite is ${sp.w} × ${sp.h} px, and the limit is 128 × 128. Shrink it or split it into parts. It will be skipped.`];
  else if (problem === 'too-thick') status = ['err', '✖', 'The thickness makes the model bigger than 128 px. Lower the thickness. It will be skipped.'];
  else if (problem === 'empty') status = ['err', '✖', 'Nothing to build: every pixel in this picture is see-through (or less than half visible). It will be skipped.'];
  return { sp, X, Y, Z, N, status };
}

export function m2info(r: SheetRow): { read: SheetRead; trim: number; status: Status } {
  const read = readOf(r);
  const trim = read.problem ? 0 : trimCountOf(r);
  let status: Status = ['ok', '✓', 'All good — every painted pixel made it onto the model.'];
  if (read.problem) status = ['err', '✖', `${read.problem} It will be skipped.`];
  else if (r.renamed) status = ['warn', '?', 'The file name lost its settings code (like __16_F_box). Box size was read from the picture size; the side, shape and ends are guesses — please check them.'];
  else if (trim) status = ['warn', `⚠ ${trim}`, `${trim} painted pixel${trim === 1 ? '' : 's'} didn't make it onto the model, because the other sides don't have paint there. Open "Sheet check" to see them.`];
  else if (read.nameMismatch) status = ['warn', '?', `The file name says box ${read.named!.n}, but the picture is the size of a box-${read.n} sheet. The picture size wins, so box ${read.n} is used. If that's wrong, the sheet was probably resized.`];
  return { read, trim, status };
}

// ------------------------------------------------------------------ number fields with our own spin buttons
// Browsers draw native spin arrows differently (Edge on Windows ignores styling and lets them touch the
// digits), so the native ones are hidden and every number field gets these instead.

type SpinInput = HTMLInputElement & { _where?: string };

export function enhanceNumbers(root: ParentNode = document) {
  $$<HTMLInputElement>('input[type=number]', root).forEach(inp => {
    if (inp.parentElement!.classList.contains('numwrap')) return;
    const wrap = document.createElement('span'); wrap.className = 'numwrap';
    inp.replaceWith(wrap); wrap.append(inp);
    wrap.insertAdjacentHTML('beforeend', '<span class="spin"><button type="button" tabindex="-1" data-d="1" aria-label="Up">▴</button><button type="button" tabindex="-1" data-d="-1" aria-label="Down">▾</button></span>');
  });
}
// find the field again after a table redraw (the old element is gone by then)
function locateNumber(inp: SpinInput): SpinInput | null {
  if (inp.isConnected) return inp;
  return inp._where ? q<SpinInput>(inp._where) : null;
}
let spinRepeat = 0;
export function initSpinButtons() {
  document.addEventListener('mousedown', e => {
    const b = (e.target as Element).closest<HTMLElement>('.spin button'); if (!b) return;
    e.preventDefault();
    let inp: SpinInput | null = b.closest('.numwrap')!.querySelector<SpinInput>('input')!;
    if (inp.disabled) return;
    const tr = inp.closest<HTMLElement>('tr[data-i]'), tbl = inp.closest('table');
    if (tr && tbl && inp.dataset.f) inp._where = `#${tbl.id} tr[data-i="${tr.dataset.i}"] [data-f="${inp.dataset.f}"]`;
    const where = inp._where, d = +b.dataset.d!;
    const step = () => {
      inp = (inp && locateNumber(inp)) || (where ? q<SpinInput>(where) : null); if (!inp || inp.disabled) return;
      if (where) inp._where = where;
      d > 0 ? inp.stepUp() : inp.stepDown();
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      inp.dispatchEvent(new Event('change', { bubbles: true }));
    };
    step();
    clearTimeout(spinRepeat);
    const again = () => { step(); spinRepeat = window.setTimeout(again, 70); };
    spinRepeat = window.setTimeout(again, 420); // hold to keep counting
  });
  ['mouseup', 'mouseleave', 'blur'].forEach(ev => window.addEventListener(ev, () => clearTimeout(spinRepeat)));
  document.addEventListener('mouseup', () => clearTimeout(spinRepeat));
}

// ------------------------------------------------------------------ tables

const opts = (list: [string, string, ...string[]][], val: string) => list.map(([k, label]) => `<option value="${k}"${k === val ? ' selected' : ''}>${esc(label)}</option>`).join('');

const TIP: Record<string, string> = {
  thumb: 'A small picture of the file.',
  file: 'The file name on disk.',
  w: 'The sprite\'s width × height, read from the picture. You can\'t change it here.',
  outline: '<b>Outlined sprite?</b> Tick this if your sprite has a dark outline around it. The new sides then take their colours from just inside the outline and get their own outline, instead of coming out as solid outline colour.',
  copy: '<b>Copy sides</b> — tick this to put your drawing on the new sides too, turned to face each one, instead of working out what the sides would really look like. Half the copies are mirrored for a little variety: each side and the one opposite it are the drawing and its mirror. Good for things that look about the same all round: a boulder, a crate, a barrel. Leave it off for guns, lamps and bottles, whose sides look different from the front. Where the thickness isn\'t the drawing\'s width, the copy is squeezed or stretched to fit. A rounded end of a Tube or Diamond keeps its own look.',
  h: 'How tall the sprite is, read from the picture. You can\'t change it here.',
  depth: '<b>Thickness</b> — how many pixels thick the object is. It\'s the one size a flat picture can\'t tell us. A sword might be 2, a crate as thick as it is wide.',
  side: '<b>Sprite shows…</b> which side of the object your picture is. This decides which way is up and which way is front on the model. Filled in for you if the file name ends in _F, _Bk, _L, _R, _T or _Bt.',
  shape: '<b>Shape</b> — the rough cross-section: square block, round tube, diamond, egg… Your sprite\'s outline is always kept; this only rounds off the parts the sprite can\'t show. The arrows are measured on your sprite as you drew it: ↔ along its width, ↕ along its height, ⊙ straight out of the picture.',
  ends: '<b>Ends</b> — for Tube and Diamond only: round off (Tube) or sharpen (Diamond) one or both ends, like a bullet, a stake or a capsule. The rest stays a straight tube or diamond. The arrows follow your sprite as you drew it, like Shape\'s: ← is its left end. A ⊙ shape points out of the picture, so its ends are the front (at you) and the back.',
  ends2: 'Read from the file name, like the shape. You can change it here. Only Tube and Diamond have ends to shape.',
  size: 'The model\'s 3D size: width × height × depth in pixels, worked out from the sprite, thickness and side.',
  box: 'Each side of the sheet is a square this many pixels big: the model\'s longest size, rounded up to 8, 16, 32, 64 or 128. The spare room lets you paint the model bigger later.',
  status: 'Ready, or a problem that needs fixing.',
  sheet: 'The sheet file. Its name carries the box size, side and shape (and the shaped ends of a Tube or Diamond), e.g. rifle__32_R_cyW.png — please don\'t rename it.',
  side2: 'Which side the original sprite was. Read from the file name — only change it if the name got lost.',
  shape2: 'Read from the file name. You can change it here, e.g. to try a rounder look.',
  changed: 'Changed from what the file name says. The sheet\'s new sides were drawn for the shape in the name, so they may not fit this one perfectly.',
  changedApply: 'Changed from what the file name says, so the sheet and the model don\'t quite match. <b>Click</b> to use this in ① as well and remake the sheet there: this row then gets the new sheet and keeps its other settings. A sheet you\'ve painted on is never replaced: the new one is added below it.',
  stale: 'The sprite or its ① settings changed since this sheet was made. <b>Click</b> to remake the sheet from ①: this row gets the new sheet and keeps its settings. A sheet you\'ve painted on is never replaced: the new one is added below it.',
  sx: '<b>Left ↔ Right split.</b> Where the shape you painted on the Left side hands over to the shape on the Right side. 0.5 = halfway. Only matters if you painted Left and Right differently.',
  sy: '<b>Top ↕ Bottom split.</b> How far down holes painted on the Top side go (0.2 = a shallow dent, 0.5 = halfway, 1 = all the way). Great for mugs, buckets and bowls.',
  sz: '<b>Front ⊙ Back split.</b> Where the Front side\'s shape hands over to the Back side\'s shape. 0.5 = halfway.',
  bstyle: '<b>Blend</b> — how the shape changes at a split. Hard step = sudden. Steps = a few flat terraces (PS1 look). Smooth = a gradual curve (not built yet: drawn as steps for now).',
  bw: '<b>Blend width</b> — how many pixels the change is spread over. Not used with "Hard step".',
  fb: '<b>Gap colour</b> — where the model steps out and no side has paint for that spot. Opposite side = borrow the colour from the side across. Nearest pixel = copy the closest painted pixel.',
  mat: '<b>Material</b> — how the 3D model reacts to light: matte, plastic, metal… Unlit ignores lights completely, very PS1.',
  inside: '<b>Inside</b> — what the voxel model looks like if you cut it open. Peek inside with the 🔪 Peel slider in the Voxels view. Doesn\'t affect the 3D model or file size.',
  slope: '<b>Straighten slopes</b> — how hard jagged pixel slopes are straightened into clean diagonal edges, in pixels. 0 = keep every pixel step. Higher = smoother, but small details can get eaten. Single steps and bumps always stay.',
  sides: '<b>Round sides</b> — how many flat sides a round shape (tube, egg) gets. 8 looks nicely PS1; more sides = rounder but more triangles. Only round shapes use it.',
  metal: '<b>Metal</b> — how metallic the 3D model\'s surface is: 0 = not metal (wood, plastic, stone), 1 = pure metal. Starts at the Material\'s own value; picking a Material resets it. Unlit ignores it.',
  rough: '<b>Rough</b> — how rough the 3D model\'s surface is: 0 = mirror-shiny, 1 = completely dull. Starts at the Material\'s own value; picking a Material resets it. Unlit ignores it.',
  icol: '<b>Inside colours</b> — up to 3 colours for the inside of the voxel model. Each Inside style starts with its own fitting colours; ↺ goes back to them. Not used by "Like the outside" and Hollow.',
  inoise: '<b>Noise</b> — how speckled the inside colours are, in %. 0 = perfectly clean.',
  iscale: '<b>Pattern</b> — how big the inside pattern is (rings, crystals, stripes), in pixels. Bigger = chunkier.',
  hcore: '<b>Hollow core</b> — leaves the middle of the voxel model empty, with walls this many pixels thick. 0 = solid all the way through. Works with every Inside style: Tree rings with walls of 3 make a hollow log. Thin parts stay solid. Only the voxel model (.vox) has an inside, so the 3D model doesn\'t change. Hollow is already a 1-pixel shell, so it doesn\'t use this.',
};

/** Inside styles that don't use colours, noise or pattern size. */
const PLAIN_INSIDE = new Set(['nearest', 'hollow']);
/** Shapes with round cross-sections, which use the Round sides setting. */
const ROUND_SHAPES = new Set(['cyW', 'cyH', 'cyT', 'ell']);
const NO_ENDS = 'Only Tube and Diamond shapes have ends to shape.';

/** The Ends cell's dropdown: named for the row's shape, greyed out for shapes without ends. */
function endsSelect(r: Pick<SpriteRow, 'shape' | 'ends'>, tip: string) {
  if (!hasEnds(r.shape)) return `<select class="cell-sel" data-f="ends" disabled data-tip="${esc(NO_ENDS)}"><option>—</option></select>`;
  const list = endsOptions(r.shape);
  return `<select class="cell-sel" data-f="ends" data-tip="${esc(tip || list.find(e => e[0] === r.ends)![2])}">${opts(list, r.ends)}</select>`;
}

export function renderT1() {
  const T = S.t[1];
  const head = `<thead><tr>
    <th class="stick1" data-tip="${esc(TIP.thumb)}"></th>
    <th class="stick2" data-tip="${esc(TIP.file)}">File</th>
    <th data-tip="${esc(TIP.w)}">Sprite<span class="sub">W × H px</span></th>
    <th data-tip="${esc(TIP.depth)}">Thickness<span class="sub">px</span></th>
    <th data-tip="${esc(TIP.side)}">Sprite shows</th>
    <th data-tip="${esc(TIP.shape)}">Shape</th>
    <th data-tip="${esc(TIP.ends)}">Ends</th>
    <th data-tip="${esc(TIP.outline)}">Outline</th>
    <th data-tip="${esc(TIP.copy)}">Copy sides</th>
    <th data-tip="${esc(TIP.size)}">Model size<span class="sub">W × H × D</span></th>
    <th data-tip="${esc(TIP.box)}">Box</th>
    <th data-tip="${esc(TIP.status)}">OK?</th>
  </tr></thead>`;
  const infos = T.rows.map(m1info);
  const body = T.rows.map((r, i) => {
    const d = infos[i], [st, sym, stTip] = d.status;
    return `<tr data-i="${i}" class="${rowCls(1, i)}${st === 'err' ? ' err' : ''}">
      <td class="thumb stick1"><div class="thumbbox"><canvas data-thumb="${i}"></canvas></div></td>
      <td class="file stick2" title="${esc(r.file)}">${esc(r.file)}</td>
      <td class="ro">${d.sp.w} × ${d.sp.h}</td>
      <td><input class="cell-in" type="number" min="1" max="128" value="${r.depth}" data-f="depth" data-tip="${esc(TIP.depth)}"></td>
      <td><select class="cell-sel" data-f="side" data-tip="${esc(SIDES.find(s => s[0] === r.side)![2])}">${opts(SIDES, r.side)}</select>${r.sideAuto ? `<span class="tag" data-tip="Filled in automatically from the _${r.side} at the end of the file name.">🏷</span>` : ''}</td>
      <td><select class="cell-sel" data-f="shape" data-tip="${esc(SHAPES.find(s => s[0] === r.shape)![2])}">${opts(SHAPES, r.shape)}</select></td>
      <td>${endsSelect(r, '')}</td>
      <td style="text-align:center"><label class="check small" data-tip="${esc(TIP.outline)}"><input type="checkbox" data-f="outline"${r.outline !== false ? ' checked' : ''}><span class="box"></span></label></td>
      <td style="text-align:center"><label class="check small" data-tip="${esc(TIP.copy)}"><input type="checkbox" data-f="copySides"${r.copySides ? ' checked' : ''}><span class="box"></span></label></td>
      <td class="ro">${d.X} × ${d.Y} × ${d.Z}</td>
      <td>${d.N ? `<span class="cubechip" data-tip="${esc(TIP.box)}">${d.N}</span>` : '<span class="status err">—</span>'}</td>
      <td><span class="status ${st}" data-tip="${esc(stTip)}">${sym}</span></td>
    </tr>`;
  }).join('');
  $('#t1').innerHTML = head + '<tbody>' + body + '</tbody>';
  $$<HTMLCanvasElement>('#t1 canvas[data-thumb]').forEach(cv => {
    const im = images.get(T.rows[+cv.dataset.thumb!].image)!.img;
    const sc = Math.min(34 / im.width, 34 / im.height), f = sc >= 1 ? Math.floor(sc) : sc;
    cv.width = Math.max(1, Math.round(im.width * f)); cv.height = Math.max(1, Math.round(im.height * f));
    const ctx = cv.getContext('2d')!;
    ctx.imageSmoothingEnabled = false; ctx.drawImage(spriteCanvas(T.rows[+cv.dataset.thumb!].image), 0, 0, cv.width, cv.height);
  });
  const ok = infos.filter(d => d.status[0] !== 'err').length;
  enhanceNumbers($('#t1'));
  $('#m1count').textContent = String(T.rows.length);
  $('#m1sum').textContent = `${ok} ready · ${T.rows.length - ok} will be skipped`;
  updateRunLabel();
}

export function renderT2() {
  const T = S.t[2];
  const head = `<thead><tr>
    <th class="stick1" data-tip="${esc(TIP.thumb)}"></th>
    <th class="stick2" data-tip="${esc(TIP.sheet)}">Sheet</th>
    <th data-tip="${esc(TIP.status)}">OK?</th>
    <th data-tip="Box size of the sheet, read from the file.">Box</th>
    <th data-tip="${esc(TIP.side2)}">Sprite was</th>
    <th data-tip="${esc(TIP.shape2)}">Shape</th>
    <th data-tip="${esc(TIP.ends)}">Ends</th>
    <th data-tip="${esc(TIP.sides)}">Round sides</th>
    <th data-tip="${esc(TIP.slope)}">Straighten<span class="sub">slopes, px</span></th>
    <th data-tip="${esc(TIP.sx)}">Split ↔<span class="sub">left · right</span></th>
    <th data-tip="${esc(TIP.sy)}">Split ↕<span class="sub">top · bottom</span></th>
    <th data-tip="${esc(TIP.sz)}">Split ⊙<span class="sub">front · back</span></th>
    <th data-tip="${esc(TIP.bstyle)}">Blend</th>
    <th data-tip="${esc(TIP.bw)}">Blend width<span class="sub">px</span></th>
    <th data-tip="${esc(TIP.fb)}">Gap colour</th>
    <th data-tip="${esc(TIP.mat)}">Material<span class="sub">3D model</span></th>
    <th data-tip="${esc(TIP.metal)}">Metal<span class="sub">0–1</span></th>
    <th data-tip="${esc(TIP.rough)}">Rough<span class="sub">0–1</span></th>
    <th data-tip="${esc(TIP.inside)}">Inside<span class="sub">voxels</span></th>
    <th data-tip="${esc(TIP.icol)}">Inside colours</th>
    <th data-tip="${esc(TIP.inoise)}">Noise<span class="sub">%</span></th>
    <th data-tip="${esc(TIP.iscale)}">Pattern<span class="sub">px</span></th>
    <th data-tip="${esc(TIP.hcore)}">Hollow core<span class="sub">walls, px</span></th>
  </tr></thead>`;
  const infos = T.rows.map(m2info);
  // the orange tag for a setting changed from the file name; on a sheet ① made, it's a button that takes the change to ①
  const changedTag = (r: SheetRow) => spriteOf(r)
    ? `<button type="button" class="tag changed" data-remake="apply" data-tip="${esc(TIP.changedApply)}">changed ↻</button>`
    : `<span class="tag changed" data-tip="${esc(TIP.changed)}">changed</span>`;
  const body = T.rows.map((r, i) => {
    const d = infos[i], [st, sym, stTip] = d.status;
    const stale = outOfDate(r) ? `<button type="button" class="tag" data-remake="go" data-tip="${esc(TIP.stale)}">out of date ↻</button>` : '';
    const split = (f: 'sx' | 'sy' | 'sz', ax: string) => `<td data-split="${ax}"><input class="cell-in split" type="number" min="0" max="1" step="0.05" value="${r[f].toFixed(2)}" data-f="${f}" data-tip="${esc(TIP[f])}"></td>`;
    const num = (f: string, v: number, min: number, max: number, step: number, off = false, digits = 0) => `<td><input class="cell-in" type="number" min="${min}" max="${max}" step="${step}" value="${v.toFixed(digits)}" data-f="${f}"${off ? ' disabled' : ''} data-tip="${esc(TIP[f])}"></td>`;
    const [metal, rough] = r.mraw ?? MATERIAL_PBR[r.mat], plain = PLAIN_INSIDE.has(r.inside), pal = r.icol ?? INSIDE_PAL[r.inside];
    return `<tr data-i="${i}" class="${rowCls(2, i)}${st === 'err' ? ' err' : ''}">
      <td class="thumb stick1"><div class="thumbbox"><canvas data-thumb="${i}"></canvas></div></td>
      <td class="file stick2" title="${esc(r.file)}">${esc(r.file)}</td>
      <td><span class="status ${st}" data-tip="${esc(stTip)}">${sym}</span>${stale}</td>
      <td>${d.read.n ? `<span class="cubechip">${d.read.n}</span>` : '<span class="status err">—</span>'}</td>
      <td><select class="cell-sel" data-f="side" data-tip="${esc(TIP.side2)}">${opts(SIDES, r.side)}</select>${r.renamed ? '<span class="tag" data-tip="Guessed, because the file name lost its settings code.">guess</span>' : r.fileSide && r.side !== r.fileSide ? changedTag(r) : ''}</td>
      <td><select class="cell-sel" data-f="shape" data-tip="${esc(TIP.shape2)}">${opts(SHAPES, r.shape)}</select>${r.fileShape && r.shape === r.fileShape ? '<span class="tag" data-tip="Read from the file name.">name</span>' : r.renamed ? '' : changedTag(r)}</td>
      <td>${endsSelect(r, TIP.ends2)}${!hasEnds(r.shape) ? '' : r.fileEnds && r.ends === r.fileEnds ? '<span class="tag" data-tip="Read from the file name.">name</span>' : r.renamed ? '' : changedTag(r)}</td>
      ${num('sides', r.sides, 3, 24, 1, !ROUND_SHAPES.has(r.shape))}${num('slope', r.slope, 0, 3, .1, false, 1)}
      ${split('sx', 'x')}${split('sy', 'y')}${split('sz', 'z')}
      <td><select class="cell-sel" data-f="bstyle" data-tip="${esc(TIP.bstyle)}">${opts(BLENDS, r.bstyle)}</select></td>
      <td><input class="cell-in" type="number" min="0" max="16" value="${r.bw}" data-f="bw" ${r.bstyle === 'hard' ? 'disabled' : ''} data-tip="${esc(TIP.bw)}"></td>
      <td><select class="cell-sel" data-f="fb" data-tip="${esc(TIP.fb)}">${opts(FALLBACKS, r.fb)}</select></td>
      <td><select class="cell-sel" data-f="mat" data-tip="${esc(TIP.mat)}">${opts(MATERIALS, r.mat)}</select></td>
      ${num('metal', metal, 0, 1, .05, r.mat === 'unlit', 2)}${num('rough', rough, 0, 1, .05, r.mat === 'unlit', 2)}
      <td><select class="cell-sel" data-f="inside" data-tip="${esc(TIP.inside)}">${opts(INSIDES, r.inside)}</select></td>
      <td><span class="swatches cell-sw">${pal.map((c, k) => `<input type="color" value="${c}" data-f="icol${k}"${plain ? ' disabled' : ''} data-tip="${esc(TIP.icol)}">`).join('')}<button class="btn small ghost" data-reset="icol"${plain || !r.icol ? ' disabled' : ''} data-tip="Go back to this Inside style's own colours.">↺</button></span></td>
      ${num('inoise', r.inoise, 0, 100, 5, plain)}${num('iscale', r.iscale, 1, 16, 1, plain)}${num('hcore', r.hcore, 0, HOLLOW_CORE_MAX, 1, r.inside === 'hollow')}
    </tr>`;
  }).join('');
  $('#t2').innerHTML = head + '<tbody>' + body + '</tbody>';
  $$<HTMLCanvasElement>('#t2 canvas[data-thumb]').forEach(cv => {
    const pic = spriteCanvas(T.rows[+cv.dataset.thumb!].image!);
    const f = Math.min(34 / pic.width, 34 / pic.height);
    cv.width = Math.max(1, Math.round(pic.width * f)); cv.height = Math.max(1, Math.round(pic.height * f));
    const ctx = cv.getContext('2d')!; ctx.imageSmoothingEnabled = false;
    ctx.drawImage(pic, 0, 0, cv.width, cv.height);
  });
  const bad = infos.filter(d => d.status[0] === 'err').length;
  const warn = infos.filter(d => d.status[0] === 'warn').length;
  enhanceNumbers($('#t2'));
  $('#m2count').textContent = String(T.rows.length);
  $('#m2sum').textContent = `${T.rows.length - bad} ready · ${warn} to check · ${bad} will be skipped`;
  updateRunLabel();
}

const spriteCvCache = new Map<string, HTMLCanvasElement>();
/** A loaded picture on a canvas at 1:1, for thumbnails and Sheet check. */
export function spriteCanvas(imageId: string) {
  const hit = spriteCvCache.get(imageId); if (hit) return hit;
  const { img } = images.get(imageId)!;
  const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height;
  cv.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
  spriteCvCache.set(imageId, cv);
  return cv;
}

const rowCls = (m: Mode, i: number) => { const T = table(m); return (T.sel.has(i) ? 'sel' : '') + (T.focus === i ? ' focus' : ''); };
export const renderTable = (m: Mode) => (m === 1 ? renderT1() : renderT2());

// ------------------------------------------------------------------ selection (file-explorer style)

export function refreshSel(m: Mode) {
  const T = table(m);
  $$(`#t${m} tbody tr`).forEach(tr => {
    const i = +tr.dataset.i!;
    tr.classList.toggle('sel', T.sel.has(i));
    tr.classList.toggle('focus', T.focus === i);
  });
  const bar = $(`#m${m}mass`);
  bar.hidden = T.sel.size < 2;
  $(`#m${m}massN`).textContent = String(T.sel.size);
  renderPreview(m);
}

export function bindTable(m: Mode) {
  const tbl = $(`#t${m}`);
  tbl.addEventListener('mousedown', e => {
    // only the left button selects: the middle one is for scrolling the list (see the "Scroll sideways" hint)
    const tr = (e.target as Element).closest<HTMLElement>('tbody tr'); if (!tr || e.button !== 0) return;
    const T = table(m), i = +tr.dataset.i!;
    const ctl = (e.target as Element).closest('input, select, label, .spin, button');
    if (ctl) {
      // clicking into a cell of an unselected row selects just that row, like Explorer
      if (!T.sel.has(i)) { T.sel = new Set([i]); T.anchor = i; }
      if (T.focus !== i) { T.focus = i; refreshSel(m); }
      return;
    }
    if (e.shiftKey) {
      e.preventDefault();
      const a = Math.min(T.anchor, i), b = Math.max(T.anchor, i);
      if (!(e.ctrlKey || e.metaKey)) T.sel = new Set();
      for (let k = a; k <= b; k++) T.sel.add(k);
    } else if (e.ctrlKey || e.metaKey) {
      T.sel.has(i) ? T.sel.delete(i) : T.sel.add(i);
      T.anchor = i;
    } else {
      T.sel = new Set([i]); T.anchor = i;
    }
    T.focus = i;
    refreshSel(m);
  });

  tbl.addEventListener('change', e => {
    const ctl = (e.target as Element).closest<HTMLInputElement | HTMLSelectElement>('[data-f]'); if (!ctl) return;
    const T = table(m), i = +ctl.closest<HTMLElement>('tr')!.dataset.i!, f = ctl.dataset.f!;
    let v: string | number | boolean = ctl instanceof HTMLInputElement && ctl.type === 'checkbox' ? ctl.checked : ctl.value;
    if (f === 'depth') v = Math.max(1, Math.min(128, parseInt(v as string, 10) || 1));
    if (f === 'bw') v = Math.max(0, Math.min(16, parseInt(v as string, 10) || 0));
    if (f === 'sx' || f === 'sy' || f === 'sz') v = Math.max(0, Math.min(1, parseFloat(v as string) || 0));
    const clampNum = (lo: number, hi: number, int: boolean) => { const x = parseFloat(v as string); return Math.max(lo, Math.min(hi, Number.isFinite(x) ? (int ? Math.round(x) : Math.round(x * 100) / 100) : lo)); };
    if (f === 'sides') v = clampNum(3, 24, true);
    if (f === 'slope') v = clampNum(0, 3, false);
    if (f === 'metal' || f === 'rough') v = clampNum(0, 1, false);
    if (f === 'inoise') v = clampNum(0, 100, true);
    if (f === 'iscale') v = clampNum(1, 16, true);
    if (f === 'hcore') v = clampNum(0, HOLLOW_CORE_MAX, true);
    const targets = T.sel.has(i) && T.sel.size > 1 ? [...T.sel] : [i];
    for (const j of targets) {
      const r = T.rows[j] as unknown as Record<string, unknown>;
      if (m === 2 && (f === 'metal' || f === 'rough' || f.startsWith('icol'))) {
        // these edit one part of a pair or trio, starting from the row's own current values
        const row = T.rows[j] as SheetRow;
        if (f.startsWith('icol')) { const pal = [...(row.icol ?? INSIDE_PAL[row.inside])] as [string, string, string]; pal[+f.slice(4)] = v as string; row.icol = pal; }
        else { const mr = [...(row.mraw ?? MATERIAL_PBR[row.mat])] as [number, number]; mr[f === 'metal' ? 0 : 1] = v as number; row.mraw = mr; }
        continue;
      }
      r[f] = v;
      if (f === 'side') r.sideAuto = false;
      if (f === 'bstyle' && v !== 'hard' && !r.bw) r.bw = 2;
      if (f === 'mat') r.mraw = null; // a new material starts from its own values
    }
    renderTable(m);
    if (m === 2 && (f === 'inside' || f === 'hcore')) autoPeek();
    renderPreview(m);
    markDirty();
    targets.filter(j => j !== i).forEach(j => q(`#t${m} tr[data-i="${j}"]`)?.classList.add('flash'));
    const again = q<HTMLInputElement>(`#t${m} tr[data-i="${i}"] [data-f="${f}"]`);
    if (again && !again.disabled) again.focus({ preventScroll: true });
    if (targets.length > 1) toast(`✏️ Changed ${colName(f)} on ${targets.length} rows`);
  });

  // ↺ in the Inside colours cell: back to the inside style's own colours, on every selected row
  tbl.addEventListener('click', e => {
    const b = (e.target as Element).closest<HTMLButtonElement>('button[data-reset="icol"]'); if (!b || m !== 2) return;
    const T = S.t[2], i = +b.closest<HTMLElement>('tr')!.dataset.i!;
    const targets = T.sel.has(i) && T.sel.size > 1 ? [...T.sel] : [i];
    for (const j of targets) T.rows[j].icol = null;
    renderTable(2); renderPreview(2); markDirty();
    if (targets.length > 1) toast(`✏️ Changed ${colName('icol')} on ${targets.length} rows`);
  });

  // hovering / focusing a split cell shows the plane in the preview
  if (m === 2) {
    const setPlane = (td: Element | null | undefined) => {
      const tr = td && td.closest<HTMLElement>('tr');
      const ax = (td as HTMLElement | null)?.dataset.split as 'x' | 'y' | 'z' | undefined;
      const next = td && tr && ax && +tr.dataset.i! === S.t[2].focus ? { axis: ax, t: S.t[2].rows[+tr.dataset.i!][`s${ax}`] } : null;
      if (JSON.stringify(next) !== JSON.stringify(S.plane)) { S.plane = next; if (S.m2view !== 'sheet') renderPreview(2); }
    };
    const activeSplit = (sel: string) => (document.activeElement && document.activeElement.closest ? document.activeElement.closest(sel) : null);
    tbl.addEventListener('mouseover', e => setPlane((e.target as Element).closest('td[data-split]') || activeSplit('td[data-split]')));
    tbl.addEventListener('mouseleave', () => setPlane(activeSplit('#t2 td[data-split]')));
    tbl.addEventListener('focusin', e => setPlane((e.target as Element).closest('td[data-split]')));
  }
}

/** Shows a list's "Scroll sideways for more settings" hint only while its table is wider than the list. */
export function watchSideScroll(m: Mode) {
  const tbl = $(`#t${m}`), wrap = tbl.parentElement!, hint = $(`#m${m}hint`);
  const sync = () => { hint.hidden = wrap.scrollWidth <= wrap.clientWidth + 1; };
  const ro = new ResizeObserver(sync);
  ro.observe(wrap); ro.observe(tbl);
}

export const colName = (f: string) => ({ outline: 'Outlined', copySides: 'Copy sides', depth: 'Thickness', side: 'Sprite side', shape: 'Shape', ends: 'Ends', sx: 'Split ↔', sy: 'Split ↕', sz: 'Split ⊙', bstyle: 'Blend', bw: 'Blend width', fb: 'Gap colour', mat: 'Material', inside: 'Inside', sides: 'Round sides', slope: 'Straighten slopes', metal: 'Metal', rough: 'Rough', icol0: 'Inside colour 1', icol1: 'Inside colour 2', icol2: 'Inside colour 3', inoise: 'Noise', iscale: 'Pattern', hcore: 'Hollow core', icol: 'Inside colours' } as Record<string, string>)[f] || f;

/** The sheet file name for a Phase 1 row (before the never-overwrite numbering). */
export const sheetNameFor = (r: SpriteRow, n: number) => sheetNameOf(r, r.file, n);
