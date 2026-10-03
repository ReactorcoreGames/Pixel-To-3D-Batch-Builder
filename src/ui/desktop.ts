/* The desktop app (Tauri, DESIGN.md §12): the same page in a WebView2 window, with real files and folders.
   This module is the only place that talks to Tauri. In the browser build `isDesktop` is false and none of the
   functions below are called; the rest of the UI branches on `isDesktop` where the two builds differ. */

import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { open, save } from '@tauri-apps/plugin-dialog';
import { openUrl } from '@tauri-apps/plugin-opener';

export const isDesktop = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

// ------------------------------------------------------------------ paths (Windows: either slash, case-insensitive)

export const dirOf = (path: string) => path.replace(/[\\/][^\\/]*$/, '');
export const joinPath = (dir: string, ...names: string[]) => [dir.replace(/[\\/]+$/, ''), ...names].join('\\').replace(/\//g, '\\');
export const samePath = (a: string, b: string) => a.replace(/\//g, '\\').toLowerCase() === b.replace(/\//g, '\\').toLowerCase();
/** A path written the Windows way, for showing it (session files store forward slashes). */
export const nativePath = (path: string) => path.replace(/\//g, '\\');
/** A real path on disk (drive letter or network share), not a bare name from the browser build. */
export const isAbsolute = (path: string) => /^([a-zA-Z]:[\\/]|\\\\)/.test(path);

// ------------------------------------------------------------------ files

export const readFile = async (path: string) => new Uint8Array(await invoke<ArrayBuffer>('read_file', { path }));
export const readText = async (path: string) => new TextDecoder().decode(await readFile(path));
/** Writes a whole file (through a temporary file, so it's never left half-written); missing folders are made. */
export const writeFile = (path: string, data: Uint8Array | string) =>
  invoke<void>('write_file', typeof data === 'string' ? new TextEncoder().encode(data) : data, { headers: { path: encodeURIComponent(path) } });
/** Moves a file into a `replaced` folder next to it (a free name is picked there); returns where it went. */
export const moveAside = (path: string) => invoke<string>('move_aside', { path });
export interface DirEntry { name: string; dir: boolean }
export const listDir = (path: string) => invoke<DirEntry[]>('list_dir', { path });
export const pathKinds = (paths: string[]) => invoke<('file' | 'dir' | 'missing')[]>('path_kinds', { paths });
export const presetsDir = () => invoke<string | null>('presets_dir');
export const removePresetFile = (path: string) => invoke<void>('remove_preset', { path });
export const autosavePath = () => invoke<string>('autosave_path');
export const startArgs = () => invoke<string[]>('start_args');
/** The example session in the `examples/` folder next to the exe, if there is one. */
export const exampleSession = () => invoke<string | null>('example_session');
export const openFolder = (path: string) => invoke<void>('open_folder', { path });
/** The "How to paint a sheet" page on disk, if the app can find it. */
export const guidePath = (page: string) => invoke<string | null>('guide_path', { page });

// ------------------------------------------------------------------ dialogs

const PNG = [{ name: 'PNG pictures', extensions: ['png'] }];
const SESSION = [{ name: 'Pixel to 3D session', extensions: ['json'] }];
const one = (v: string | string[] | null) => (Array.isArray(v) ? v[0] ?? null : v);

export const pickPngs = async (defaultPath?: string) => {
  const v = await open({ multiple: true, filters: PNG, defaultPath, title: 'Add pictures' });
  return v ? (Array.isArray(v) ? v : [v]) : [];
};
export const pickFolder = async (title: string, defaultPath?: string) => one(await open({ directory: true, title, defaultPath }));
export const pickSession = async (defaultPath?: string) => one(await open({ filters: SESSION, defaultPath, title: 'Load session' }));
export const pickSaveSession = (defaultPath: string) => save({ filters: SESSION, defaultPath, title: 'Save session' });

// ------------------------------------------------------------------ events

/** Called with the paths of watched files that were written (a sheet saved in the art app). */
export const watchFiles = (paths: string[]) => invoke<void>('watch_files', { paths });
export const onFilesChanged = (f: (paths: string[]) => void) => listen<string[]>('files-changed', e => f(e.payload));
/** Files and folders dropped on the window, with their real paths. */
export const onDropPaths = (f: (paths: string[]) => void) => getCurrentWebview().onDragDropEvent(e => { if (e.payload.type === 'drop') f(e.payload.paths); });
/** Runs (and waits for) `f` before the window closes. */
export const beforeClose = (f: () => Promise<void>) => getCurrentWindow().onCloseRequested(async () => { try { await f(); } catch (e) { console.error(e); } });
export const openLink = (url: string) => openUrl(url);
