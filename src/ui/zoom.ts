/* Zoom and pan for a flat picture in a preview stage: the ① sheet preview and ②'s Sheet check.
   Fit scales the picture to the box at any exact scale (below 1× too); the zoom steps go from 1:1 to 32×. The
   header buttons read Fit | − | 1:1 | +, the mouse wheel zooms around the cursor, and a zoomed picture can be dragged
   around or scrolled. The canvas holds the picture at its real size and CSS scales it (pixelated), so zooming costs
   no memory. */

import { $, $$ } from './dom';

/** Zoom levels the − / + buttons and the mouse wheel step through (screen pixels per picture pixel). */
export const ZOOMS = [1, 2, 3, 4, 6, 8, 12, 16, 24, 32];

export type Zoom = 'fit' | number;

export class PictureZoom {
  zoom: Zoom = 'fit';
  /** The picture currently shown, for zooming around it (null when there's nothing to zoom). */
  shown: { W: number; H: number; fit: number } | null = null;

  /** `seg` is the Fit | − | 1:1 | + group; `picture` the element whose position the zoom keeps under the mouse;
      `redraw` draws the stage again at the current zoom; `active` says whether the stage shows a picture right now. */
  constructor(private stageSel: string, private segSel: string, private pictureSel: string, private redraw: () => void, private active: () => boolean = () => true) {}

  private get stage() { return $(this.stageSel); }

  /** The scale that fits a W × H picture in the stage with a 10px margin. */
  fitScale(W: number, H: number) {
    const st = this.stage;
    return Math.min((st.clientWidth - 20) / W, (st.clientHeight - 20) / H);
  }

  /** The scale to draw a W × H picture at, remembering it for zooming; also sets the stage's scroll mode. */
  scaleFor(W: number, H: number) {
    const fit = this.fitScale(W, H);
    this.shown = { W, H, fit };
    this.stage.classList.toggle('scroll', this.zoom !== 'fit');
    return this.zoom === 'fit' ? fit : this.zoom;
  }

  /** The zoom showing right now, as a number, even in Fit. */
  current() { return this.zoom === 'fit' ? this.shown?.fit ?? 1 : this.zoom; }

  syncButtons() {
    const z = this.zoom, seg = $(this.segSel);
    seg.querySelector('[data-z="fit"]')!.classList.toggle('on', z === 'fit');
    const val = seg.querySelector<HTMLElement>('[data-z="1"]')!;
    val.classList.toggle('on', z !== 'fit');
    val.textContent = z === 'fit' || z === 1 ? '1:1' : `${z}×`;
    seg.querySelector<HTMLButtonElement>('[data-z="out"]')!.disabled = this.next(-1) === null;
    seg.querySelector<HTMLButtonElement>('[data-z="in"]')!.disabled = this.next(1) === null;
  }

  /** The zoom one step in (dir 1) or out (dir −1) from what's showing, or null if there's nowhere to go.
      Zooming out of a zoom bigger than Fit lands on Fit before going smaller. */
  next(dir: 1 | -1): Zoom | null {
    if (!this.shown) return null;
    const cur = this.current(), fit = this.shown.fit;
    if (dir > 0) return ZOOMS.find(z => z > cur + 1e-6) ?? null;
    const lower = [...ZOOMS].reverse().find(z => z < cur - 1e-6) ?? null;
    if (this.zoom !== 'fit' && cur > fit + 1e-6 && (lower === null || lower < fit)) return 'fit';
    return lower;
  }

  /** Sets the zoom, keeping the picture point under (mx, my) — stage coordinates, default the middle — in place. */
  set(z: Zoom, mx?: number, my?: number) {
    const stage = this.stage, pic = $(this.pictureSel), old = this.current();
    mx ??= stage.clientWidth / 2; my ??= stage.clientHeight / 2;
    const px = (stage.scrollLeft + mx - pic.offsetLeft) / old, py = (stage.scrollTop + my - pic.offsetTop) / old;
    this.zoom = z;
    this.redraw();
    if (z !== 'fit') {
      stage.scrollLeft = px * z + pic.offsetLeft - mx;
      stage.scrollTop = py * z + pic.offsetTop - my;
    }
  }

  step(dir: 1 | -1, mx?: number, my?: number) {
    const next = this.next(dir);
    if (next !== null) this.set(next, mx, my);
  }

  /** Buttons, wheel to zoom and drag to move around. */
  bind() {
    const stage = this.stage;
    $$<HTMLButtonElement>(`${this.segSel} button`).forEach(b => b.onclick = () => {
      const z = b.dataset.z;
      if (z === 'in') this.step(1); else if (z === 'out') this.step(-1);
      else this.set(z === 'fit' ? 'fit' : 1);
    });
    stage.addEventListener('wheel', e => {
      if (!this.shown || !this.active()) return;
      e.preventDefault();
      const box = stage.getBoundingClientRect();
      this.step(e.deltaY < 0 ? 1 : -1, e.clientX - box.left, e.clientY - box.top);
    }, { passive: false });
    let drag: { x: number; y: number; sl: number; st: number } | null = null;
    stage.addEventListener('pointerdown', e => {
      if (!stage.classList.contains('scroll') || e.button !== 0 || !this.active()) return;
      drag = { x: e.clientX, y: e.clientY, sl: stage.scrollLeft, st: stage.scrollTop };
      stage.setPointerCapture(e.pointerId); stage.classList.add('panning');
    });
    stage.addEventListener('pointermove', e => {
      if (!drag) return;
      stage.scrollLeft = drag.sl - (e.clientX - drag.x); stage.scrollTop = drag.st - (e.clientY - drag.y);
    });
    const end = () => { drag = null; stage.classList.remove('panning'); };
    stage.addEventListener('pointerup', end); stage.addEventListener('pointercancel', end);
  }
}
