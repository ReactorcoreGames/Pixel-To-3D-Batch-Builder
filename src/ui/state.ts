/* The app's typed state (from the mockup's ui-core.js): both lists with their selection, the settings that go into the
   session file, the loaded pictures, and the preview's view state. */

import {
  defaultSession, fileOf, type ExportSettings, type FrameColours, type RGBAImage, type SheetRowData, type SpriteRowData, type SpriteSet,
} from '../core';
import { defaultSets } from './presets';

export type Mode = 1 | 2;
export type View = 'poly' | 'vox' | 'sheet';

export interface SpriteRow extends SpriteRowData { file: string }
export interface SheetRow extends SheetRowData { file: string }

export interface TableState<R> {
  sel: Set<number>;
  anchor: number;
  focus: number;
  rows: R[];
}

/** A picture loaded from disk (or from a session file), decoded to RGBA. */
export interface LoadedImage {
  id: string;
  path: string;
  img: RGBAImage;
  /** The original file as a data URL, embedded in browser session files. */
  png: string;
  /** Read from a real file on disk (desktop app): session files store its path instead of the picture. */
  disk?: boolean;
  /** No pixel is at least half opaque. */
  empty: boolean;
}

export const images = new Map<string, LoadedImage>();

const d = defaultSession(defaultSets());

export const S = {
  mode: 1 as Mode,
  m2view: 'poly' as View,
  /** ② preview: eighth turns to the right, the low camera (from below), and the light background (kept in browser
      storage, not the session). */
  rot: 0,
  low: false,
  light: false,
  plane: null as { axis: 'x' | 'y' | 'z'; t: number } | null,
  peel: { axis: 'front' as 'front' | 'top', n: 0 },
  frame: d.sprites.frame as FrameColours,
  name: d.name,
  /** Desktop app: the session file this list was last saved to or opened from (not part of the session itself). */
  sessionPath: null as string | null,
  /** Phase 1 output settings. */
  m1: { output: d.sprites.output, addToSheets: d.sprites.addToSheets, neverOverwrite: d.sprites.neverOverwrite, download: d.sprites.download },
  /** Phase 2 output settings. */
  m2: { output: d.sheets.output, folderPerModel: d.sheets.folderPerModel },
  exp: d.exports as ExportSettings,
  t: {
    1: { sel: new Set<number>(), anchor: 0, focus: 0, rows: [] as SpriteRow[] } as TableState<SpriteRow>,
    2: { sel: new Set<number>(), anchor: 0, focus: 0, rows: [] as SheetRow[] } as TableState<SheetRow>,
  },
  get sets(): SpriteSet[] { return this.exp.sprites.sets; },
  set sets(v: SpriteSet[]) { this.exp.sprites.sets = v; },
};

/** Either table, when only the selection matters. */
export const table = (m: Mode) => S.t[m] as TableState<SpriteRow | SheetRow>;

export const spriteRow = (r: SpriteRowData): SpriteRow => ({ ...r, file: fileOf(r.path) });
export const sheetRow = (r: SheetRowData): SheetRow => ({ ...r, file: fileOf(r.path) });

/** Strips the UI-only fields, leaving what the session file stores. */
export const spriteData = ({ file: _f, ...r }: SpriteRow): SpriteRowData => r;
export const sheetData = ({ file: _f, ...r }: SheetRow): SheetRowData => r;

let idCounter = 0;
export const newImageId = () => `i${Date.now().toString(36)}${(idCounter++).toString(36)}`;
