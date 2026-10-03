/* Ties plain controls to settings in S with a `data-bind="exp.glb.scale"` attribute, so the export cards and the output
   switches are saved in the session. Checkboxes hold booleans, number and range fields numbers, selects strings, and a
   `.seg` with data-bind takes the `data-val` of its buttons. Listeners run in the capture phase, so the state is
   already updated when the mockup's own handlers redraw the previews. */

import { $$ } from './dom';
import { S } from './state';

type Rec = Record<string, unknown>;

function lookup(path: string): [Rec, string] {
  const keys = path.split('.'), last = keys.pop()!;
  let o = S as unknown as Rec;
  for (const k of keys) o = o[k] as Rec;
  return [o, last];
}
const read = (path: string) => { const [o, k] = lookup(path); return o[k]; };

export function bindSettings(onChange: () => void) {
  const write = (path: string, v: unknown) => { const [o, k] = lookup(path); o[k] = v; onChange(); };
  const fromInput = (el: HTMLInputElement | HTMLSelectElement) => {
    const path = el.dataset.bind!;
    if (el instanceof HTMLSelectElement) return write(path, el.value);
    if (el.type === 'checkbox') return write(path, el.checked);
    const n = parseFloat(el.value);
    if (!Number.isFinite(n)) return;
    const lo = el.min === '' ? -Infinity : +el.min, hi = el.max === '' ? Infinity : +el.max;
    write(path, Math.max(lo, Math.min(hi, n)));
  };
  const onEvent = (e: Event) => {
    const el = e.target as HTMLElement;
    if ((el instanceof HTMLInputElement || el instanceof HTMLSelectElement) && el.dataset.bind) fromInput(el);
  };
  document.addEventListener('change', onEvent, true);
  document.addEventListener('input', e => { if ((e.target as HTMLInputElement).type === 'range') onEvent(e); }, true);
  document.addEventListener('click', e => {
    const b = (e.target as Element).closest<HTMLElement>('.seg[data-bind] button[data-val]');
    if (b) write(b.parentElement!.dataset.bind!, b.dataset.val);
  }, true);
}

/** Writes the current settings into every bound control (after a session was loaded). */
export function applySettingsToDom() {
  for (const el of $$<HTMLElement>('[data-bind]')) {
    const v = read(el.dataset.bind!);
    if (el.classList.contains('seg')) $$('button[data-val]', el).forEach(b => b.classList.toggle('on', b.dataset.val === String(v)));
    else if (el instanceof HTMLInputElement && el.type === 'checkbox') el.checked = !!v;
    else if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement) {
      el.value = String(v);
      // a slider's number label next to it keeps its unit
      const val = el.type === 'range' ? el.parentElement?.querySelector('.val') : null;
      if (val) val.textContent = el.value + val.textContent!.replace(/^-?[\d.]+/, '');
    }
  }
}
