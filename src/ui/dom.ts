/* Shared DOM helpers (from the mockup's data.js). */

/** The first match. The element is assumed to exist; use `q` when it may not. */
export const $ = <T extends Element = HTMLElement>(s: string, r: ParentNode = document): T => r.querySelector(s) as T;
/** The first match, or null. */
export const q = <T extends Element = HTMLElement>(s: string, r: ParentNode = document): T | null => r.querySelector(s) as T | null;
export const $$ = <T extends Element = HTMLElement>(s: string, r: ParentNode = document): T[] => [...r.querySelectorAll(s)] as T[];
export const esc = (s: unknown) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
