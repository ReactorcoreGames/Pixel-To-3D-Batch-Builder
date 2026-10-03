/* The export panel: sprite sets, live export previews and the export cards (from the mockup's ui-exports.js).
   Export settings live in S.exp (saved in the session); the cards' controls are tied to it with data-bind (see bind.ts). */

import { effectiveLayout, doomPrefix, SIDE_CODES, setAngles, startDeg, TWO_TO_ONE, type RGBAImage, type SpriteSet } from '../core';
import { isDesktop } from './desktop';
import { $, $$, esc } from './dom';
import { DIR_PRESETS, mkSet, removeMyPreset, saveMyPreset, START } from './presets';
import { markDirty } from './session-ui';
import { S, type SheetRow } from './state';
import { m2info } from './ui-core';
import { modelOf, paletteOf, setFramesOf, sidesOf, sourceReady, stackOf, turntableOf } from './models';
import { enhanceNumbers } from './ui-core';
import { previewM2, setView, updateRunLabel } from './ui-preview';
import { modal, toast } from './ui-shell';
import { SIDE_NAME } from './vocab';
import { baseName } from '../core';

// ------------------------------------------------------------------ exports panel

function compass(n: number | undefined, on: boolean, startDegree = 0) {
  const col = on ? '#8fdc4a' : '#b9aee0';
  let s = `<svg viewBox="0 0 30 30"><circle cx="15" cy="15" r="13" fill="none" stroke="${col}" stroke-opacity=".35" stroke-width="2"/>`;
  if (n) for (let i = 0; i < n; i++) {
    const a = (i / n * 360 + startDegree) * Math.PI / 180 + Math.PI / 2;
    const lc = i === 0 && n > 1 && on ? '#ffd23f' : col; // first picture's direction in yellow
    s += `<line x1="15" y1="15" x2="${(15 + Math.cos(a) * 11).toFixed(1)}" y2="${(15 + Math.sin(a) * 11).toFixed(1)}" stroke="${lc}" stroke-width="${n > 16 ? 1 : 2}" stroke-linecap="round"/>`;
  }
  else s += `<text x="15" y="20" text-anchor="middle" font-size="14" fill="${col}" font-weight="900">✎</text>`;
  return s + '</svg>';
}

/** A set value as shown next to its slider: the oblique depth in percent, angles in degrees (26.57 shows as 26.6). */
const valText = (k: string, v: number) => k === 'odepth' ? `${v}%` : `${Math.round(v * 10) / 10}°`;
const NUMERIC = new Set(['dirs', 'tilt', 'oangle', 'odepth', 'cell']);

function setSummary(st: SpriteSet) {
  const view = st.cam === 'oblique' ? `oblique ${st.oside === 'left' ? '↖' : '↗'} ${valText('oangle', st.oangle)}, ${st.odepth}% deep`
    : `${st.elev}° up · ${st.cam === 'ortho' ? 'flat' : 'perspective'}`;
  return `${st.dirs} way${st.dirs === 1 ? '' : 's'} · ${st.start === 'custom' ? `turned ${st.yaw}°` : `${START[st.start][0].toLowerCase()} first`}${st.ref === 'drawing' ? ' of drawing' : ''} · ${view}${st.tilt ? ` · tilted ${st.tilt}°` : ''} · ${st.cell}px`;
}
/** Quick-pick buttons that set `k` to one of `picks` ([value, label, tip]); the one matching `cur` is lit. */
const chips = (k: string, picks: [number, string, string][], cur: number) =>
  `<div class="row chips fill">${picks.map(([v, l, tip]) => `<button data-k="${k}" data-v="${v}"${cur === v ? ' class="on"' : ''} data-tip="${esc(tip)}">${l}</button>`).join('')}</div>`;
export function renderSets() {
  const segBtns = (k: string, list: (string | number)[][], cur: string | number) => list.map(([v, label, tip]) => `<button data-k="${k}" data-v="${v}"${String(v) === String(cur) ? ' class="on"' : ''}${tip ? ` data-tip="${esc(tip)}"` : ''}>${label}</button>`).join('');
  $('#sets').innerHTML = S.sets.map((st, i) => {
    const p = DIR_PRESETS.find(x => x.id === st.preset) ?? DIR_PRESETS[DIR_PRESETS.length - 1];
    return `<div class="set${st.open ? ' open' : ''}" data-s="${i}">
      <div class="set-head">
        ${compass(st.dirs, true, startDeg(st))}
        <div class="ttl"><b>${esc(p.name)}</b><small>${setSummary(st)}</small></div>
        <button class="gear" data-k="toggle" aria-expanded="${st.open}" data-tip="Show or hide this set's settings."><span class="chev">▸</span> Edit</button>
        <button class="gear" data-k="del" data-tip="Remove this sprite set.">✕</button>
      </div>
      <div class="set-body"${st.open ? '' : ' hidden'}>
        <div class="xpv"></div>
        <div class="field">
          <span class="lbl" data-tip="Which of the two models the pictures are drawn from.">Draw from</span>
          <div class="seg wide">${segBtns('from', [['mesh', '🔺 Low-poly model', 'Draw the low-poly model, as in the 3D model file: straightened slopes and smooth rounding.'], ['voxels', '🧊 Voxel model', 'Draw the voxel model, as in the .vox file: every pixel a little cube, like Red Alert 2 units or a MagicaVoxel render.']], st.from)}</div>
        </div>
        <div class="field">
          <span class="lbl" data-tip="Ready-made settings that match popular games and engines. You can also make your own.">Style preset</span>
          <div class="presets">${DIR_PRESETS.map(q => `<button class="preset${q.id === st.preset ? ' on' : ''}" data-k="preset" data-v="${esc(q.id)}" data-tip="${esc(q.tip)}"${q.id === 'custom' ? ' style="grid-column: span 2"' : ''}>${compass(q.settings?.dirs, q.id === st.preset, q.settings ? startDeg(q.settings) : 0)}<span><b>${esc(q.name)}</b><small>${esc(q.sub)}</small></span></button>`).join('')}</div>
        </div>
        <div class="field">
          <span class="lbl" data-tip="Flat (orthographic) keeps sizes the same everywhere so sprites line up on a grid. Perspective makes near parts bigger, for a pre-rendered 90s look.">Camera</span>
          <div class="seg wide">${segBtns('cam', [['ortho', '📐 Flat', 'Flat camera: no shrinking with distance. Best for tile and isometric games.'], ['persp', '🎥 Perspective', 'Real-camera look: close parts appear bigger. Gives a pre-rendered 90s feel.'], ['oblique', '📦 Oblique', 'The side the camera looks at stays flat-on, exactly as drawn, and the depth slants away up to one side, so the top and one end show too. The look of hand-drawn side-view sprites such as Advance Wars battle scenes. There is no camera height.']], st.cam)}</div>
        </div>
        ${st.cam === 'oblique' ? `<div class="field">
          <span class="lbl" data-tip="Which way the depth slants away. Up and right shows the right end of the side you look at, up and left its left end.">Depth slants</span>
          <div class="seg wide">${segBtns('oside', [['right', '↗ Up and right', 'The depth slants up and to the right: the top and the right end show.'], ['left', '↖ Up and left', 'The depth slants up and to the left: the top and the left end show.']], st.oside)}</div>
        </div>
        <div class="field"><label data-tip="How steeply the depth slants. Low = mostly the end shows, high = mostly the top shows. 45° and 2:1 (26.6°) give clean pixel steps.">Depth angle</label>
          <div class="row"><input type="range" min="0" max="90" value="${st.oangle}" data-k="oangle" data-tip="How steeply the depth slants. Low = mostly the end shows, high = mostly the top shows."><span class="val">${valText('oangle', st.oangle)}</span></div>
          ${chips('oangle', [[TWO_TO_ONE, '2:1 (26.6°)', 'Slants 2 pixels across for 1 up, like 2:1 isometric lines.'], [30, '30°', 'A classic oblique angle.'], [45, '45°', 'Slants 1 across for 1 up: clean diagonal pixel steps.']], st.oangle)}</div>
        <div class="field"><label data-tip="How long the depth is drawn compared with its real length. Half (cabinet) looks natural; full length (cavalier) looks deep and boxy.">Depth length</label>
          <div class="row"><input type="range" min="10" max="100" value="${st.odepth}" data-k="odepth" data-tip="How long the depth is drawn compared with its real length."><span class="val">${valText('odepth', st.odepth)}</span></div>
          ${chips('odepth', [[50, 'Half', 'Half its real length (cabinet): looks natural.'], [75, '¾', 'Three quarters of its real length.'], [100, 'Full', 'Its full length (cavalier): deep and boxy.']], st.odepth)}</div>` : ''}
        ${st.cam === 'persp' ? `<div class="field"><label data-tip="How wide the camera lens is. Small = zoomed-in and flatter, big = fish-eye and dramatic.">Lens width (field of view)</label>
          <div class="row"><input type="range" min="10" max="90" value="${st.fov}" data-k="fov" data-tip="How wide the camera lens is. Small = zoomed-in and flatter, big = fish-eye and dramatic."><span class="val">${st.fov}°</span></div></div>` : ''}
        <div class="field">
          <label data-tip="How many directions to draw the model from. 1 = a single picture.">Directions</label>
          <div class="seg wide">${segBtns('dirs', [[1, '1'], [2, '2'], [4, '4'], [8, '8'], [16, '16'], [32, '32']], st.dirs)}</div>
        </div>
        <div class="field">
          <label data-tip="Which way the camera looks for the first picture. The rest turn evenly from there.">First picture looks at the…</label>
          <div class="seg wide">${segBtns('start', Object.entries(START).map(([k, [l, , tip]]) => [k, l, tip]), st.start)}</div>
          <div class="row"><span class="hint" style="white-space:nowrap">Turns count from</span><div class="seg" style="flex:1">${segBtns('ref', [['object', "Object's front", "Turns count from the object's front, whichever side you drew. This is what game direction sheets expect: the first picture faces the player."], ['drawing', 'Your drawing', 'Turns count from the side you drew, so 0° shows your drawing straight on. Handy for icons. (Sprites drawn from the top or bottom count from the front.)']], st.ref)}</div></div>
          ${st.start === 'custom' ? `<div class="row"><input type="range" min="0" max="359" value="${st.yaw}" data-k="yaw" data-tip="How far the model is turned for the first picture. 0° = straight at the front, 90° = the right side, 180° = the back."><span class="val">${st.yaw}°</span></div>` : ''}
        </div>
        ${st.cam === 'oblique' ? '' : `<div class="field">
          <label data-tip="How high the camera looks down from. 0° = eye level, 90° = straight down. 30° gives classic 2:1 pixel isometric.">Camera height</label>
          <div class="row"><input type="range" min="0" max="90" value="${st.elev}" data-k="elev" data-tip="How high the camera looks down from. 0° = eye level, 90° = straight down. 30° gives classic 2:1 pixel isometric."><span class="val">${st.elev}°</span></div>
        </div>`}
        <div class="field">
          <label data-tip="Leans the finished picture inside its frame, like the diagonal swords in many inventory screens. 0° = upright.">Tilt the picture</label>
          <div class="row"><input type="range" min="-90" max="90" value="${st.tilt}" data-k="tilt" data-tip="Leans the finished picture inside its frame. Negative = lean left, positive = lean right."><span class="val">${st.tilt}°</span></div>
          <div class="row chips">${([[-45, '−45°'], [0, 'Upright'], [45, '+45°']] as [number, string][]).map(([v, l]) => `<button data-k="tilt" data-v="${v}"${st.tilt === v ? ' class="on"' : ''} data-tip="Tilt the picture ${v ? `${Math.abs(v)}° to the ${v < 0 ? 'left' : 'right'}` : 'back to upright'}.">${l}</button>`).join('')}</div>
        </div>
        <div class="field">
          <label data-tip="The size of each picture in the sheet, in pixels.">Picture size</label>
          <div class="row"><input type="number" value="${st.cell}" data-k="cell" data-tip="The size of each picture in the sheet, in pixels (1 to 1024)."><span class="hint">px square</span></div>
          ${chips('cell', [32, 64, 128, 256, 512, 1024].map(v => [v, String(v), `${v} × ${v} px pictures.`] as [number, string, string]), st.cell)}
        </div>
        <div class="field">
          <span class="lbl" data-tip="How big the model is drawn in each picture.">Model size</span>
          <div class="seg wide">${segBtns('fit', [['fit', 'Fill the picture', 'Each model is drawn as big as fits the picture in every direction. Small and big models all fill their pictures.'], ['drawing', "Drawing's pixel size", 'One pixel of your drawing becomes one pixel of the picture (seen straight on), so every model keeps its size compared with the others. Models bigger than the picture get cut off.']], st.fit)}</div>
        </div>
        <div class="field">
          <label data-tip="How the pictures are saved.">Save as</label>
          <select data-k="layout" data-tip="How the pictures are saved. RPG Maker needs 4 directions and Doom 1 or 8; with other counts they're saved in rows.">${([['grid', 'One sheet, up to 8 pictures a row'], ['rpgmaker', 'RPG Maker character sheet (4 ways)'], ['doom', 'Doom sprite files (1 or 8 ways)']] as [string, string][]).map(([v, l]) => `<option value="${v}"${v === st.layout ? ' selected' : ''}>${l}</option>`).join('')}</select>
        </div>
        <label class="switch" data-tip="Skip directions that are just mirror images of others (like facing left vs right). Your game flips them instead — smaller sheets.">
          <input type="checkbox" data-k="mirror"${st.mirror ? ' checked' : ''}><span class="knob"></span>Skip mirrored directions
        </label>
        <div class="field">
          <label data-tip="Limit the sprites to a fixed number of colours — some old engines need this.">Colour limit</label>
          <select data-k="pal" data-tip="Limit the sprites to a fixed number of colours — some old engines need this.">${['No limit', 'Doom palette (256)', '16 colours', '32 colours'].map(o => `<option${o === st.pal ? ' selected' : ''}>${o}</option>`).join('')}</select>
        </div>
        <div class="row"><button class="btn small" data-k="save" data-tip="Save these settings as your own preset so you can pick them with one click next time.">⭐ Save as my preset</button>${p.mine ? `<button class="btn small" data-k="unsave" data-tip="Remove your preset &quot;${esc(p.name)}&quot; from the list. This set keeps its settings.">🗑 Remove my preset</button>` : ''}</div>
      </div>
    </div>`;
  }).join('');
  enhanceNumbers($('#sets'));
  refreshExportPreviews();
}

// ------------------------------------------------------------------ export previews (live, for the previewed ② row)

function pvRow(): SheetRow | undefined { const T = S.t[2]; return T.rows[T.focus]; }
function pvHead(el: HTMLElement, what: string) {
  const r = pvRow();
  el.innerHTML = `<div class="xpv-h">👁 ${what}<b>${r ? esc(baseName(r.file).split('__')[0]) : ''}</b></div>`;
  if (!r || m2info(r).read.problem || !modelOf(r)?.count) { el.insertAdjacentHTML('beforeend', '<div class="empty">No preview: this sheet can\'t be read.</div>'); return null; }
  return r;
}
/** A picture on a canvas at 1:1. */
function imageCanvas(img: RGBAImage) {
  const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height;
  if (img.width && img.height) cv.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
  return cv;
}
const scaled = (cv: HTMLCanvasElement, target: number) => { const k = Math.max(1, Math.floor(target / Math.max(cv.width, cv.height))); cv.style.width = cv.width * k + 'px'; cv.style.height = cv.height * k + 'px'; return cv; };
function frameEl(cv: HTMLCanvasElement, label: string | null, target: number) {
  const d = document.createElement('div'); d.className = 'fr';
  d.append(scaled(cv, target));
  if (label != null) { const s = document.createElement('small'); s.textContent = label; d.append(s); }
  return d;
}
/** What a set saves per model, in words, e.g. "rifle_isometric.png". */
function setFileText(st: SpriteSet, name: string) {
  const layout = effectiveLayout(st), file = DIR_PRESETS.find(x => x.id === st.preset)?.file ?? 'custom';
  if (layout === 'rpgmaker') return `!$${name}_${file}.png, a 3 × 4 character sheet`;
  if (layout === 'doom') return `${doomPrefix(name)}A${st.dirs === 1 ? 0 : 1}.png… in ${name}_${file}/`;
  return `${name}_${file}.png` + (st.layout !== 'grid' ? ` (${st.layout === 'rpgmaker' ? 'RPG Maker needs 4 directions' : 'Doom needs 1 or 8 directions'}, so in rows)` : '');
}
function renderSetPreview(el: HTMLElement, st: SpriteSet) {
  const r = pvHead(el, 'Preview of'); if (!r) return;
  if (!sourceReady(st.from)) { el.insertAdjacentHTML('beforeend', '<div class="empty">The 3D model is still loading…</div>'); return; }
  const size = Math.max(8, Math.min(st.cell, 64));
  const { all, drawn } = setAngles(st);
  const angles = effectiveLayout(st) === 'rpgmaker' ? all : drawn;
  const frames = setFramesOf(r, st, size, angles.slice(0, 8)) ?? [];
  const strip = document.createElement('div'); strip.className = 'strip';
  const target = frames.length === 1 ? 110 : 52; // a single picture (e.g. an icon) gets a bigger preview
  frames.forEach(f => strip.append(frameEl(imageCanvas(f.image), Math.round(f.angle) + '°', target)));
  el.append(strip);
  const more = angles.length > 8 ? ` · first 8 of ${angles.length} shown` : '';
  const mir = all.length - angles.length;
  const name = baseName(r.file).split('__')[0];
  el.insertAdjacentHTML('beforeend', `<div class="xpv-f">${angles.length} picture${angles.length === 1 ? '' : 's'} drawn${mir ? ` · ${mir} mirrored by your game` : ''}${more}${st.cell > 64 ? ' · previewed at 64 px' : ''}<br>Saved as ${esc(setFileText(st, name))}</div>`);
}
function renderSidesPreview(el: HTMLElement) {
  const r = pvHead(el, 'Preview of'); if (!r) return;
  const pics = sidesOf(r);
  const strip = document.createElement('div'); strip.className = 'strip';
  for (const k of SIDE_CODES) if (pics[k]) strip.append(frameEl(imageCanvas(pics[k]), SIDE_NAME[k], 40));
  el.append(strip);
}
function renderStackPreview(el: HTMLElement) {
  const r = pvHead(el, 'Preview of'); if (!r) return;
  const { image, layers, w, h } = stackOf(r, S.exp.stack.axis, S.exp.stack.order)!;
  const all = imageCanvas(image), strip = document.createElement('div'); strip.className = 'strip';
  for (let k = 0; k < layers; k++) {
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    cv.getContext('2d')!.drawImage(all, k * w, 0, w, h, 0, 0, w, h);
    strip.append(frameEl(cv, String(k + 1), 30));
  }
  el.append(strip);
  el.insertAdjacentHTML('beforeend', `<div class="xpv-f">${layers} layers of ${w} × ${h} px, saved side by side in one strip</div>`);
}
function renderPalPreview(el: HTMLElement) {
  const r = pvHead(el, 'Preview of'); if (!r) return;
  const cols = paletteOf(r)!.map(c => '#' + c.toString(16).padStart(6, '0'));
  el.insertAdjacentHTML('beforeend', `<div class="pal">${cols.map(c => `<span style="background:${c}" title="${c}"></span>`).join('')}</div><div class="xpv-f">${cols.length} colours</div>`);
}
let turnTimer = 0, turnFrame = 0;
function renderTurnPreview(el: HTMLElement) {
  const r = pvHead(el, 'Preview of'); clearInterval(turnTimer); if (!r) return;
  if (!sourceReady(S.exp.turntable.from)) { el.insertAdjacentHTML('beforeend', '<div class="empty">The 3D model is still loading…</div>'); return; }
  const size = Math.min(64, S.exp.turntable.size);
  const frames = (turntableOf(r, size) ?? []).map(imageCanvas);
  const holder = document.createElement('div'); holder.className = 'strip'; el.append(holder);
  el.insertAdjacentHTML('beforeend', `<div class="xpv-f">Loops like the GIF will${S.exp.turntable.size > 64 ? ' (previewed at 64 px)' : ''}</div>`);
  if (!frames.length) return;
  const tick = () => {
    if (!el.offsetParent) return; // hidden: don't burn time
    turnFrame = (turnFrame + 1) % frames.length;
    holder.replaceChildren(frameEl(frames[turnFrame], null, 128));
  };
  tick(); turnTimer = window.setInterval(tick, Math.max(20, Math.round(2000 / frames.length)));
}
export function refreshExportPreviews() {
  if (S.mode !== 2) return;
  const kinds: Record<string, (el: HTMLElement) => void> = { sides: renderSidesPreview, stack: renderStackPreview, pal: renderPalPreview, turn: renderTurnPreview };
  $$('#exports .xpv[data-pv]').forEach(el => {
    if (!el.offsetParent) return;
    kinds[el.dataset.pv!](el);
  });
  $$('#sets .set').forEach(setEl => {
    const el = setEl.querySelector<HTMLElement>('.xpv'); if (el && el.offsetParent) renderSetPreview(el, S.sets[+setEl.dataset.s!]);
  });
}

// refresh a set's header, preset highlight and preview without rebuilding it
function updateSetInPlace(setEl: HTMLElement, st: SpriteSet) {
  const head = setEl.querySelector('.set-head')!;
  head.querySelector('b')!.textContent = 'Custom';
  head.querySelector('small')!.textContent = setSummary(st);
  head.querySelector('svg')!.outerHTML = compass(st.dirs, true, startDeg(st));
  $$('.preset', setEl).forEach(b => b.classList.toggle('on', b.dataset.v === 'custom'));
  const pv = setEl.querySelector<HTMLElement>('.xpv'); if (pv) renderSetPreview(pv, st);
}

export function bindSets() {
  const box = $('#sets');
  const setOf = (el: Element) => S.sets[+el.closest<HTMLElement>('.set')!.dataset.s!];
  box.addEventListener('click', e => {
    const el = (e.target as Element).closest<HTMLElement>('[data-k]'); if (!el || el.tagName === 'INPUT' || el.tagName === 'SELECT') return;
    e.stopPropagation();
    const st = setOf(el), k = el.dataset.k!;
    if (k === 'toggle') st.open = !st.open;
    else if (k === 'del') { S.sets.splice(S.sets.indexOf(st), 1); toast('Sprite set removed'); }
    else if (k === 'save') { askPresetName(st); return; }
    else if (k === 'unsave') {
      const id = st.preset, name = DIR_PRESETS.find(x => x.id === id)?.name;
      st.preset = 'custom';
      removeMyPreset(id).then(problem => { renderSets(); toast(problem ? `🗑 Removed your preset "${name}" from the list, but ${problem}` : `🗑 Removed your preset "${name}"`); });
    }
    else if (k === 'preset') {
      const p = DIR_PRESETS.find(x => x.id === el.dataset.v)!;
      if (p.settings) Object.assign(st, { preset: p.id, ...p.settings });
      else st.preset = 'custom';
    } else {
      const rec = st as unknown as Record<string, unknown>;
      rec[k] = NUMERIC.has(k) ? +el.dataset.v! : el.dataset.v;
      st.preset = 'custom';
    }
    markDirty();
    const ex = $('#exports'), keep = ex.scrollTop;
    renderSets();
    ex.scrollTop = keep;
  });
  box.addEventListener('input', e => {
    const el = e.target as HTMLInputElement; if (el.type !== 'range') return;
    const st = setOf(el); (st as unknown as Record<string, unknown>)[el.dataset.k!] = +el.value; st.preset = 'custom';
    el.parentElement!.querySelector('.val')!.textContent = valText(el.dataset.k!, +el.value);
    $$(`.chips [data-k="${el.dataset.k}"]`, el.closest('.field')!).forEach(b => b.classList.toggle('on', +b.dataset.v! === +el.value));
    markDirty();
    updateSetInPlace(el.closest<HTMLElement>('.set')!, st);
  });
  box.addEventListener('change', e => {
    const el = e.target as HTMLInputElement | HTMLSelectElement, k = el.dataset.k; if (!k) return;
    e.stopPropagation();
    const st = setOf(el), rec = st as unknown as Record<string, unknown>;
    if (el instanceof HTMLSelectElement) rec[k] = el.value;
    else if (el.type === 'checkbox') rec[k] = el.checked;
    else if (el.type === 'number') rec[k] = Math.max(1, Math.min(1024, Math.round(+el.value) || (rec[k] as number)));
    else rec[k] = +el.value;
    st.preset = 'custom';
    markDirty();
    updateSetInPlace(el.closest<HTMLElement>('.set')!, st); // no full redraw, so the panel doesn't jump while you click the arrows
  });
  $('#addSet').onclick = () => {
    S.sets.forEach(x => { x.open = false; });
    S.sets.push(mkSet('side34', true)); renderSets();
    markDirty();
    toast('➕ Added a sprite set — pick a style for it');
  };
}

/** "Save as my preset": asks for a name, then adds the set's settings to the preset list. */
function askPresetName(st: SpriteSet) {
  modal(`<h2>⭐ Save as my preset</h2>
    <p>Your preset appears in the list of styles, here and in later sessions${isDesktop ? ' (it is saved as a file in the presets folder next to the program)' : ' in this browser'}. Its name is also used in the file names, e.g. <b>rifle_<span id="presetSlug">preset</span>.png</b>.</p>
    <div class="field"><label for="presetName">Name</label><input type="text" id="presetName" maxlength="32" placeholder="My style"></div>
    <div class="row" style="margin-top:10px"><button class="btn accent" id="presetOk">⭐ Save preset</button></div>`);
  const input = $<HTMLInputElement>('#presetName');
  const slug = () => input.value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'preset';
  input.oninput = () => { $('#presetSlug').textContent = slug(); };
  input.focus();
  const save = async () => {
    const name = input.value.trim() || 'My style';
    const { preset: _p, open: _o, ...settings } = st;
    $('#modalBg').hidden = true;
    const { preset: p, problem } = await saveMyPreset(name, settings);
    st.preset = p.id;
    markDirty(); renderSets();
    toast(problem ? `⭐ Saved your preset "${name}", but ${problem}.` : `⭐ Saved your preset "${name}"`);
  };
  $('#presetOk').onclick = save;
  input.onkeydown = e => { if (e.key === 'Enter') save(); };
}

/** Ticked-export count, the cards' on/off look and the Run button label. */
export function syncExportCards() {
  $$<HTMLInputElement>('#exports .exp .check input').forEach(cb => cb.closest('.exp')!.classList.toggle('on', cb.checked));
  const n = $$('#exports .check input:checked').length;
  $('#expCount').textContent = `${n} on`;
  updateRunLabel();
  syncSurface();
}

export function bindExports() {
  const root = $('#exports');
  root.addEventListener('click', e => {
    const t = e.target as Element;
    const gear = t.closest('.gear');
    if (gear) {
      const adv = gear.closest('.exp')!.querySelector<HTMLElement>('.adv')!;
      adv.hidden = !adv.hidden; gear.setAttribute('aria-expanded', String(!adv.hidden));
      refreshExportPreviews();
      return;
    }
    const segBtn = t.closest('.seg button');
    if (segBtn) {
      $$('button', segBtn.parentElement!).forEach(b => b.classList.toggle('on', b === segBtn));
      refreshExportPreviews();
      return;
    }
    const sv = t.closest<HTMLElement>('.showview');
    if (sv) {
      e.preventDefault(); setView(sv.dataset.v as 'poly' | 'vox'); previewM2();
      $('#m2stage').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      return;
    }
  });
  root.addEventListener('change', e => {
    const t = e.target as HTMLElement;
    if (t.id === 'stackAxis' || t.id === 'ppOutline' || t.closest('select')) refreshExportPreviews();
    if (/^exp\.glb\.(normalMap|style|bump|grit|ao|aoDepth|trims)$/.test(t.dataset.bind ?? '')) {
      syncSurface();
      if (S.m2view === 'poly') previewM2(); // the Model view shows the surface detail
    }
    if (t.dataset.bind === 'exp.vox.tooMany' && S.m2view === 'vox') previewM2(); // the facts show the voxel file
    if (t.closest('.check input')) syncExportCards();
  });
  // turntable: free slider plus the three recommended quick picks
  const tt = $<HTMLInputElement>('#ttElev');
  const syncTT = () => { $('#ttVal').textContent = tt.value + '°'; $$('#ttChips button').forEach(b => b.classList.toggle('on', b.dataset.v === tt.value)); };
  tt.addEventListener('input', syncTT);
  $$('#ttChips button').forEach(b => b.onclick = e => {
    e.stopPropagation(); tt.value = b.dataset.v!; syncTT();
    S.exp.turntable.elev = +tt.value; markDirty();
  });
  // every range shows its value next to it
  document.addEventListener('input', e => {
    const el = e.target as HTMLInputElement;
    if (el.type !== 'range') return;
    const val = el.parentElement!.querySelector('.val'); if (!val) return;
    const unit = val.textContent!.replace(/^-?[\d.]+/, '');
    val.textContent = el.value + unit;
  });
}

/** Greys out the surface detail settings that don't apply with the current switches (they stay editable). */
export function syncSurface() {
  const g = S.exp.glb;
  $('#glbStyle').classList.toggle('off', !g.normalMap && g.ao === 'off');
  $('#glbBump').classList.toggle('off', !g.normalMap);
  $('#glbGrit').classList.toggle('off', !g.normalMap);
  $('#glbAODepth').classList.toggle('off', g.ao === 'off');
}

/** Sets the turntable label and quick picks after the value was changed from outside (a loaded session). */
export function syncTurntable() {
  const tt = $<HTMLInputElement>('#ttElev');
  $('#ttVal').textContent = tt.value + '°';
  $$('#ttChips button').forEach(b => b.classList.toggle('on', b.dataset.v === tt.value));
}
