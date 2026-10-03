/* The sheet preview (mode 1), the model / voxels / sheet check preview with peel (mode 2), and
   switching between the two modes (from the mockup's ui-preview.js). */

import type { SideCode } from '../core';
import { colouredOf, insideKeyOf, insideOf, meshKeyOf, meshOf, modelKeyOf, modelOf, surfaceOf, trimmedOnSheet, voxFileOf } from './models';
import { sheetFor } from './sheets';
import { drawVoxelView } from './voxel-view';
import { $, $$, esc, q } from './dom';
import { S, table, type Mode, type View } from './state';
import { m1info, m2info, renderT2, sheetNameFor, spriteCanvas } from './ui-core';
import { refreshExportPreviews } from './ui-exports';
import { hideTip } from './ui-shell';
import { PictureZoom } from './zoom';
import { endsName, INSIDE_NAME, MATERIAL_NAME, SHAPE_NAME, SIDE_NAME } from './vocab';

// ------------------------------------------------------------------ previews

export function renderPreview(m: Mode) { m === 1 ? previewM1() : previewM2(); }

export function previewM1() {
  const T = S.t[1], r = T.rows[T.focus];
  const cv = $<HTMLCanvasElement>('#m1sheet'), lab = $('#m1labels'), stage = $('#m1stage');
  m1Zoom.shown = null; lab.innerHTML = '';
  cv.style.width = cv.style.height = '';
  if (!r) { $('#m1pvTitle').textContent = 'Nothing selected'; cv.width = cv.height = 0; $('#m1facts').innerHTML = ''; return; }
  const d = m1info(r);
  $('#m1pvTitle').innerHTML = `${esc(r.file)}<small>${d.status[0] === 'err' ? 'Can\'t make a sheet for this one' : 'This is the sheet that will be saved'}</small>`;
  const sh = d.status[0] === 'err' ? null : sheetFor(r.image, r.side, r.depth, r.shape, r.ends, r.outline !== false, !!r.copySides, S.frame);
  const ctx = cv.getContext('2d')!;
  if (!sh) {
    stage.classList.remove('scroll');
    cv.width = 360; cv.height = 200; ctx.clearRect(0, 0, 360, 200);
    ctx.fillStyle = '#ff4d6d'; ctx.font = '800 16px Nunito, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('✖  ' + d.status[2].split(':')[0], 180, 90);
    ctx.fillStyle = '#b9aee0'; ctx.font = '600 13px Nunito, sans-serif';
    ctx.fillText('Hover the red ✖ in the list for how to fix it.', 180, 116);
    $('#m1facts').innerHTML = `<dt>Sprite</dt><dd>${d.sp.w} × ${d.sp.h} px</dd><dt>Limit</dt><dd>128 × 128 px</dd>`;
    return;
  }
  // the canvas holds the sheet at its real size and CSS scales it up or down (pixelated), so Fit can use any
  // scale — including below 1× for big sheets — and zooming in costs nothing
  const scale = m1Zoom.scaleFor(sh.W, sh.H);
  cv.width = sh.W; cv.height = sh.H;
  cv.style.width = sh.W * scale + 'px'; cv.style.height = sh.H * scale + 'px';
  ctx.imageSmoothingEnabled = false; ctx.drawImage(sh.cv, 0, 0);

  // side labels (UI only — not part of the saved image); HTML so they stay sharp at any zoom
  lab.style.left = cv.offsetLeft + 'px'; lab.style.top = cv.offsetTop + 'px';
  lab.style.width = cv.style.width; lab.style.height = cv.style.height;
  if ($<HTMLInputElement>('#m1showLabels').checked) {
    const big = sh.N * scale >= 60;
    lab.classList.toggle('small', !big);
    lab.innerHTML = (Object.entries(sh.rects) as [SideCode, (typeof sh.rects)[SideCode]][]).map(([k, rc]) =>
      `<span class="${k === r.side ? 'mine' : ''}" style="left:${rc.cx * scale + 3}px;top:${rc.cy * scale + 3}px">${(big ? SIDE_NAME[k] : k) + (k === r.side ? ' ★' : '')}</span>`).join('');
  }
  m1Zoom.syncButtons();
  const out = sheetNameFor(r, sh.N);
  $('#m1facts').innerHTML = `
    <dt data-tip="The sheet is saved with this name. The part after the double underscore stores the box size, side and shape (and a tube\'s shaped ends) for step ②.">Saved as</dt><dd><code title="${esc(out)}">${esc(out)}</code></dd>
    <dt data-tip="The size of the whole sheet picture, including frames and the legend strip.">Sheet size</dt><dd>${sh.W} × ${sh.H} px</dd>
    <dt data-tip="Each of the six boxes is this big.">Box</dt><dd>${sh.N} × ${sh.N} px, model ${d.X} × ${d.Y} × ${d.Z}</dd>
    <dt data-tip="Which box your original sprite goes into. Marked with ★.">Your sprite</dt><dd>${SIDE_NAME[r.side]} box ★</dd>
    <dt data-tip="The text strip at the bottom of the sheet. At small box sizes only a short version fits.">Legend</dt><dd>${sh.legend ? esc(sh.legend) : '<span style="color:#ffb020">doesn\'t fit</span>'}</dd>${sh.sheet.nudged ? `
    <dt data-tip="Your sprite uses a colour very close to the frame colours, so this sheet's frame is shifted a little. That way a fill or wand click on your art can never grab the frame too.">Frame</dt><dd>shifted away from your colours</dd>` : ''}`;
}

// ------------------------------------------------------------------ zoom (① sheet preview, ② Sheet check)

export const m1Zoom = new PictureZoom('#m1stage', '#m1zoom', '#m1sheet', () => previewM1());
export const m2Zoom = new PictureZoom('#m2stage', '#m2zoom', '#m2canvas', () => previewM2(), () => S.m2view === 'sheet');

export function bindZooms() { m1Zoom.bind(); m2Zoom.bind(); }

/** The ② preview: Sheet check (the painted sheet, cut-off paint blinking red) or the 3D views of the voxel model. */
export function previewM2() {
  const T = S.t[2], r = T.rows[T.focus];
  const cv = $<HTMLCanvasElement>('#m2canvas'), gl = $<HTMLCanvasElement>('#m2gl'), ov = $<HTMLCanvasElement>('#m2overlay'), stage = $('#m2stage');
  const dpr = window.devicePixelRatio || 1;
  if (S.m2view !== 'sheet' || !r) { m2Zoom.shown = null; stage.classList.remove('scroll'); }
  if (!r) { $('#m2pvTitle').textContent = 'Nothing selected'; cv.width = cv.height = 0; gl.style.display = 'none'; cv.style.display = 'block'; ov.width = ov.height = 0; $('#m2facts').innerHTML = ''; $('#m2callout').innerHTML = ''; refreshExportPreviews(); return; }
  const d = m2info(r), read = d.read;
  $('#m2pvTitle').innerHTML = `${esc(r.file)}<small>${SHAPE_NAME[r.shape]}${endsName(r.shape, r.ends) ? ` (${endsName(r.shape, r.ends)})` : ''} · ${MATERIAL_NAME[r.mat]} · inside: ${INSIDE_NAME[r.inside]}</small>`;
  const W = stage.clientWidth, H = stage.clientHeight;
  const showTrim = $<HTMLInputElement>('#m2trim').checked;

  // callout
  let co = '';
  if (read.problem) co = `<div class="callout err"><span class="ico">✖</span><div><b>This sheet can't be read</b>${esc(read.problem)}<br><br><b>Fix:</b> undo the crop or resize in your art app, or make the sheet again in ①.</div></div>`;
  else if (r.renamed) co = `<div class="callout warn"><span class="ico">🏷</span><div><b>File name lost its settings</b>Box size ${read.n} was worked out from the picture size. Side and shape are guesses (and the ends flat) — check the <b>Sprite was</b>, <b>Shape</b> and <b>Ends</b> columns.</div></div>`;
  else if (d.trim) co = `<div class="callout warn"><span class="ico">✂️</span><div><b>${d.trim} painted pixel${d.trim === 1 ? ' was' : 's were'} cut off</b>They're outside what the other sides allow, so the model can't include them. Paint the matching area on the neighbouring sides, or erase them. <a href="#" id="showTrim" style="color:#4db8ff;font-weight:800">Show me →</a></div></div>`;
  $('#m2callout').innerHTML = co;
  const st = q('#showTrim'); if (st) st.onclick = e => { e.preventDefault(); setView('sheet'); $<HTMLInputElement>('#m2trim').checked = true; previewM2(); };

  const model = modelOf(r), col = colouredOf(r);
  const in3d = S.m2view !== 'sheet' && !!model && !!col && model.count > 0;
  stage.classList.toggle('stage-3d', S.m2view !== 'sheet');
  stage.classList.toggle('light', S.light);
  q('#m2stage .watermark')?.toggleAttribute('hidden', S.m2view !== 'poly' || !!meshOf(r));
  gl.style.display = in3d ? 'block' : 'none';
  cv.style.display = in3d ? 'none' : 'block';
  ov.classList.add('blink');
  if (S.m2view === 'sheet') {
    // the sheet at its real size, scaled by CSS (Fit at any scale, or zoomed in and scrolled / dragged around)
    const pic = spriteCanvas(r.image!), scale = m2Zoom.scaleFor(pic.width, pic.height);
    cv.width = pic.width; cv.height = pic.height; cv.style.width = pic.width * scale + 'px'; cv.style.height = pic.height * scale + 'px';
    const ctx = cv.getContext('2d')!; ctx.imageSmoothingEnabled = false;
    ctx.drawImage(pic, 0, 0);
    // the red marks get a few canvas pixels per sheet pixel, so they can have a white edge when zoomed in
    const k = Math.max(1, Math.min(6, Math.floor(scale)));
    ov.width = pic.width * k; ov.height = pic.height * k; ov.style.width = cv.style.width; ov.style.height = cv.style.height;
    const oc = ov.getContext('2d')!; oc.clearRect(0, 0, ov.width, ov.height);
    if (showTrim) {
      oc.fillStyle = 'rgba(255,45,85,.9)'; oc.strokeStyle = '#fff'; oc.lineWidth = 1;
      for (const [x, y] of trimmedOnSheet(r)) { oc.fillRect(x * k, y * k, k, k); if (k > 2) oc.strokeRect(x * k + .5, y * k + .5, k - 1, k - 1); }
    }
    if (read.problem) { const bar = Math.max(1, Math.round(4 * k / scale)); oc.fillStyle = 'rgba(255,77,109,.9)'; oc.fillRect(0, ov.height - bar, ov.width, bar); }
    requestAnimationFrame(() => { ov.style.left = cv.offsetLeft + 'px'; ov.style.top = cv.offsetTop + 'px'; });
    m2Zoom.syncButtons();
  } else {
    ov.style.width = W + 'px'; ov.style.height = H + 'px'; ov.width = W * dpr; ov.height = H * dpr;
    ov.style.left = '0px'; ov.style.top = '0px';
    const oc = ov.getContext('2d')!; oc.setTransform(1, 0, 0, 1, 0, 0); oc.clearRect(0, 0, ov.width, ov.height);
    const message = (big: string, small: string) => {
      cv.style.width = W + 'px'; cv.style.height = H + 'px'; cv.width = W * dpr; cv.height = H * dpr;
      const ctx = cv.getContext('2d')!; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = '#ff4d6d'; ctx.font = '900 44px Nunito, sans-serif'; ctx.textAlign = 'center'; ctx.fillText(big, W / 2, H / 2 - 4);
      ctx.fillStyle = S.light ? '#4a4070' : '#b9aee0'; ctx.font = '700 14px Nunito, sans-serif'; ctx.fillText(small, W / 2, H / 2 + 26);
    };
    if (!in3d) message('✖', read.problem ? 'No model — the sheet size is wrong' : 'No model — nothing on the sheet survived');
    else {
      const isVox = S.m2view === 'vox';
      const mesh = isVox ? null : meshOf(r), surface = mesh && surfaceOf(mesh, r, S.exp.glb);
      const opts = {
        mesh, atlas: surface?.atlas ?? null, normalMap: surface?.normalMap ?? null, occlusionMap: surface?.occlusionMap ?? null, trimMap: surface?.trimMap ?? null,
        unlit: r.mat === 'unlit',
        mode: S.m2view as 'poly' | 'vox', rot: S.rot, low: S.low, light: S.light, peel: isVox ? S.peel : null,
        inside: isVox ? insideOf(r) : null, insideKey: insideKeyOf(r), insideCode: r.inside, hollowCore: r.hcore,
        plane: S.plane ? ({ x: 0, y: 1, z: 2 } as const)[S.plane.axis] : null,
        ghosts: showTrim ? model!.trimmed.map(t => t.at) : [],
      };
      // peel −1 means "cut halfway", which needs the depth along the current peel axis first
      const key = mesh ? meshKeyOf(r) : modelKeyOf(r);
      let drawn = drawVoxelView(gl, ov, W, H, model!, col!, S.peel.n === -1 ? { ...opts, peel: null } : opts, key);
      if (drawn && isVox && S.peel.n === -1) {
        S.peel.n = Math.floor((drawn.peelMax + 1) / 2);
        drawn = drawVoxelView(gl, ov, W, H, model!, col!, { ...opts, peel: S.peel }, key);
      }
      if (drawn && isVox) {
        S.peel.n = Math.min(S.peel.n, drawn.peelMax);
        const peel = $<HTMLInputElement>('#peel');
        peel.max = String(drawn.peelMax); peel.value = String(S.peel.n);
        $('#peelVal').textContent = `${S.peel.n} layer${S.peel.n === 1 ? '' : 's'}`;
      }
      if (!drawn) { gl.style.display = 'none'; cv.style.display = 'block'; message('✖', 'Your browser can\'t show 3D (WebGL is off)'); }
    }
  }

  if (read.problem) {
    $('#m2facts').innerHTML = `<dt>Expected</dt><dd>${read.expected ? `${read.expected.width} × ${read.expected.height} px` : '?'}</dd><dt>Found</dt><dd style="color:#ff4d6d">${read.actual.width} × ${read.actual.height} px</dd>`;
  } else if (model && col) {
    const size = [0, 1, 2].map(k => Math.max(0, model.hi[k] - model.lo[k] + 1));
    const mesh = meshOf(r);
    // what the .vox file holds, worked out only in the Voxels view (the inside styles can take a moment on big models)
    const vf = S.m2view === 'vox' ? voxFileOf(r, S.exp.vox.tooMany) : null;
    $('#m2facts').innerHTML = `
    <dt data-tip="The model's size, measured from what you painted on the sheet.">Measured size</dt><dd>${size.join(' × ')} px</dd>
    <dt data-tip="How many triangles the 3D model has. Lower = lighter for games.">Triangles</dt><dd>${mesh ? mesh.triangles.toLocaleString() : '…'}</dd>
    <dt data-tip="How many little cubes the voxel model has.">Voxels</dt><dd>${model.count.toLocaleString()}</dd>${vf ? `
    <dt data-tip="What the .vox file for MagicaVoxel holds: its cubes (Hollow and a hollow core leave the middle out) and its colours. A .vox file has room for 255 colours; with more, similar colours are merged.">Voxel file</dt><dd>${vf.problem && vf.voxels ? '<span style="color:#ffb020">skipped: too many colours</span>' : `${vf.voxels.toLocaleString()} cubes · ${vf.palette.merged ? `<span style="color:#ffb020" data-tip="The model has ${vf.palette.distinct} colours (${vf.palette.surfaceColours} on its surface, the rest made by the Inside style), so similar ones were merged into ${vf.palette.colours.length}.${vf.palette.surfaceMerged ? '' : ' Only the shades of the inside were merged: the surface keeps its colours exactly.'}">${vf.palette.colours.length} colours</span>` : `${vf.palette.colours.length} colours`}`}</dd>` : ''}
    <dt data-tip="The size of the texture picture packed inside the 3D model: the six sides, cropped to the model.">Texture</dt><dd>${mesh ? `${mesh.atlas.width} × ${mesh.atlas.height} px` : '…'}</dd>${r.bstyle === 'smooth' && r.bw ? `
    <dt data-tip="Smooth blending isn't built yet, so the change at a split is drawn as steps for now.">Blend</dt><dd>shown as steps</dd>` : ''}${col.gaps ? `
    <dt data-tip="Spots where the model steps out and no side has paint for them. They take their colour from the Gap colour setting in the list.">Gap colour</dt><dd>used on ${col.gaps.toLocaleString()} surface cube${col.gaps === 1 ? '' : 's'}</dd>` : ''}`;
  } else $('#m2facts').innerHTML = '';
  scheduleExportPreviews();
}

/** The export previews render the model (sprite sets, turntable), which takes a moment on big models, so they're drawn
    just after the main preview, and only once when rows are clicked through quickly. */
let exportTimer = 0;
function scheduleExportPreviews() {
  clearTimeout(exportTimer);
  exportTimer = window.setTimeout(refreshExportPreviews, 120);
}

export function autoPeek() {
  // picking an Inside style jumps to the voxel view with a slice already taken off, so you see it straight away
  if (S.m2view !== 'vox') setView('vox');
  if (!S.peel.n) S.peel.n = -1; // -1 = cut halfway through, resolved once the model size is known
}

export function setView(v: View) {
  S.m2view = v;
  $('#peelRow').hidden = v !== 'vox';
  $$('#m2view button').forEach(b => b.classList.toggle('on', b.dataset.v === v));
  // Sheet check has nothing to turn: its zoom buttons take the place of the turn buttons
  $('#rotL').hidden = $('#rotR').hidden = $('#m2cam').hidden = v === 'sheet';
  $('#m2zoom').hidden = v !== 'sheet';
}

/** The high or low camera. Peel's "Top" button becomes "Bottom" from below: it peels the side the camera looks at. */
export function setCamera(low: boolean) {
  S.low = low;
  $$('#m2cam button').forEach(b => b.classList.toggle('on', (b.dataset.c === 'low') === low));
  const top = $('#peelAxis button[data-a="top"]');
  top.textContent = low ? 'Bottom' : 'Top';
  top.dataset.tip = low ? 'Slice layers off the bottom, the side you\'re looking up at.' : 'Slice layers off the top, like taking the lid off.';
}

const LIGHT_KEY = 'p3d.lightPreview';

/** The light background for the ② preview, remembered in browser storage (a view preference, not part of the session). */
export function setLight(light: boolean, remember = true) {
  S.light = light;
  $<HTMLInputElement>('#m2light').checked = light;
  if (remember) try { localStorage.setItem(LIGHT_KEY, light ? '1' : '0'); } catch { /* storage blocked */ }
}

export function loadLight() {
  let v: string | null = null;
  try { v = localStorage.getItem(LIGHT_KEY); } catch { /* storage blocked */ }
  setLight(v === '1', false);
}

// ------------------------------------------------------------------ mode switching & top bar

export function setMode(m: Mode) {
  S.mode = m;
  hideTip();
  document.body.classList.toggle('mode-1', m === 1);
  document.body.classList.toggle('mode-2', m === 2);
  $$('.tab').forEach(t => t.classList.toggle('active', +t.dataset.mode! === m));
  $('#mode1').hidden = m !== 1; $('#mode2').hidden = m !== 2;
  $('#btnAddFiles .lbl').textContent = m === 1 ? 'Add sprites' : 'Add sheets';
  $('#btnAddFiles').dataset.tip = m === 1 ? 'Pick one or more sprite pictures (PNG with a see-through background) to add to the list.' : 'Pick one or more painted sheets to add to the list.';
  $('#btnAddFolder').dataset.tip = m === 1 ? 'Add every PNG sprite inside a folder at once.' : 'Add every sheet inside a folder at once.';
  $('#btnSave').dataset.tip = '<b>Save session</b> — remembers both lists and every setting in a small file, so you can pick up where you left off.';
  // ① may have changed since ② was drawn (its "① changed" tags)
  if (m === 2) renderT2();
  updateRunLabel();
  renderPreview(m);
}

/** Rows the Run button will process: everything without a red ✖. */
export function readyRows(m: Mode) {
  return m === 1 ? S.t[1].rows.filter(r => m1info(r).status[0] !== 'err') : S.t[2].rows.filter(r => m2info(r).status[0] !== 'err');
}

export function updateRunLabel() {
  const b = $('#btnRun');
  if (S.mode === 1) {
    const n = readyRows(1).length;
    b.querySelector('.lbl')!.textContent = `Make ${n} sheets`;
    b.dataset.tip = 'Go! Makes a sheet for every sprite in the list (rows with a red ✖ are skipped) and saves them to your sheets folder.';
  } else {
    const n = readyRows(2).length;
    const e = $$('#exports .exp .check input:checked').length;
    b.querySelector('.lbl')!.textContent = `Export ${n} models`;
    b.dataset.tip = `Go! Builds every sheet in the list and saves the ${e} ticked export${e === 1 ? '' : 's'} for each one. Rows with a red ✖ are skipped.`;
  }
}

/** Keeps the focus inside the list after rows were added or removed. */
export function clampFocus(m: Mode) {
  const T = table(m);
  T.focus = Math.max(0, Math.min(T.focus, T.rows.length - 1));
  T.anchor = Math.max(0, Math.min(T.anchor, T.rows.length - 1));
  T.sel = new Set([...T.sel].filter(i => i < T.rows.length));
}
