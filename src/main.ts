/* Pixel to 3D Batch Builder: boot (from the end of the mockup's ui-shell.js). */

import { initMesh, parseHexPalette } from './core';
import { bindSettings } from './ui/bind';
import { isDesktop } from './ui/desktop';
import { initLoading, openStartArgs } from './ui/load';
import { PALETTES } from './ui/models';
import { defaultSets, loadDiskPresets } from './ui/presets';
import { initAutosave, markDirty, openExample, refreshAll, restoreAutosave } from './ui/session-ui';
import { S } from './ui/state';
import { bindTable, watchSideScroll, enhanceNumbers, initSpinButtons } from './ui/ui-core';
import { bindExports, bindSets } from './ui/ui-exports';
import { renderPreview } from './ui/ui-preview';
import { initShell, toast } from './ui/ui-shell';

// the desktop app reads the presets folder next to the exe before anything is drawn (the browser build bundles it)
let presetProblems: string[] = [];
if (isDesktop) {
  document.body.classList.add('desktop');
  const disk = await loadDiskPresets();
  if (disk.doom) { try { PALETTES.doom = parseHexPalette(disk.doom); } catch (e) { console.error(e); disk.problems.push('palettes/doom.hex'); } }
  presetProblems = disk.dir ? disk.problems : [];
  S.sets = defaultSets();
}

bindTable(1); bindTable(2); watchSideScroll(1); watchSideScroll(2); bindExports(); bindSets(); initSpinButtons(); initShell(); initLoading();
bindSettings(markDirty);
enhanceNumbers();
initAutosave();
const restored = await restoreAutosave();
if (!restored) refreshAll(1);
// the very first start of the desktop app (nothing autosaved, nothing given on the command line) shows the example
if (!(await openStartArgs()) && !restored) await openExample();
if (presetProblems.length) toast(`⚠ Some files in the presets folder couldn't be read, so they were left out: ${presetProblems.join(', ')}`);
if (document.fonts) document.fonts.ready.then(() => renderPreview(S.mode));
// the mesh library (WASM) loads in the background; until then the Model tab shows the voxel surface
initMesh().then(() => { if (S.mode === 2) renderPreview(2); }, e => console.error('The mesh library failed to load', e));
