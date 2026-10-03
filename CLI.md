# Pixel to 3D Batch Builder: command-line tool (`p3d`)

## Before you start: install Node.js

The command-line tool is a JavaScript file that runs with Node.js, which is not part of Windows and not part of this program. If you (or your Claude) want to use it, install Node.js once: download the LTS version from [nodejs.org](https://nodejs.org) and run the installer (version 20 or newer). Check it worked by opening a terminal and typing `node --version`. The desktop program itself never needs Node; only this tool does.

To let Claude use the tool in another project, point it at this file, for example: "Read `C:\Tools\Pixel to 3D Batch Builder\CLI.md` and use p3d to turn the sprites in `art/props` into GLB models."

## What it is

`cli/p3d.mjs` is one self-contained file: it makes the same files as the GUI (the same code, checked byte for byte), with no project checkout, no `npm install` and no browser. It reads `presets/` from the folder above it (the release layout) if it's there, and otherwise uses the copy built into it.

The program works in two steps:

1. **① Sprites → Sheets.** Each sprite PNG (max 128 × 128) becomes a *contact sheet*: a PNG with six boxes, one per side of the object (front, back, left, right, top, bottom), the sprite in its own box and the other sides inferred. An artist can paint on the sheet to fix the sides.
2. **② Sheets → Models.** Each sheet becomes a 3D model, written out as any of: a low-poly `.glb`, a MagicaVoxel `.vox`, six side pictures, rendered sprite sets (isometric, Doom-style, RPG Maker…), a sprite stack strip, a turntable GIF and a colour palette.

Without painting, `p3d build` does both steps at once. Sheet file names carry their settings (`rifle__32_R_cyW.png` = cube size 32, drawn from the Right, Tube ↔ shape), so step ② needs no flags for those.

Run it as `node "<path>/cli/p3d.mjs" <command> …`. Below, `p3d` stands for that.

## Commands

| Command | What it does |
|---|---|
| `p3d build <sprites…> <out>` | Sprites → sheets → models in one go: `<out>/sheets` and `<out>/models`. The usual command for "make 3D models from these sprites". |
| `p3d sheets <sprites…> <out>` | Sprites → sheets only (for painting). |
| `p3d models <sheets…> <out>` | Sheets → models and exports (after painting, or for sheets from the GUI). |
| `p3d run <session.p3d.json>` | Runs a session file saved by the GUI exactly as its Run buttons would: every row with its own settings. |
| `p3d presets` | Lists the sprite set presets and every code the flags take. |
| `p3d --help` | All commands and flags. |

Inputs (`<sprites…>`, `<sheets…>`) are any mix of PNG files and folders. A folder means the PNGs directly inside it (not sub-folders), sorted by name. The last argument is always the output folder; it's made if needed.

## Flags

**Sheet flags** (`sheets`, `build`), the same for every sprite:

| Flag | Values | Default |
|---|---|---|
| `--thickness N` | 1–128 px, how deep the object is | 4 |
| `--side CODE` | `F` front, `Bk` back, `L` left, `R` right, `T` top, `Bt` bottom: which side the sprite shows | from the file name ending (`sword_R.png` → R), else `F` |
| `--shape CODE` | `box`, `rbox` soft box, `cyW`/`cyH`/`cyT` tube along the sprite's width/height/depth, `diW`/`diH`/`diT` diamond, `ell` egg/ball, `dpy` gem | `box` |
| `--ends CODE` | for tubes and diamonds: `flat`, `cF` first end (left/top/front) rounded or pointed, `cL` last end, `cB` both | `flat` |
| `--no-outline` | the sprites have no 1px dark outline | outlined |
| `--copy-sides` | put the drawing itself on every inferred side | off |
| `--frame F` | sheet frame colours: `jv`, `classic`, `single` or `"#edge,#core"` | `jv` |
| `--overwrite` | reuse the names of sheets already in the out folder | never overwrite |

**Model flags** (`models`, `build`):

| Flag | Values | Default |
|---|---|---|
| `--exports LIST` | comma list of `glb`, `vox`, `sides`, `sprites`, `stack`, `turntable`, `palette`, or `all` / `none` | `glb,vox,sprites,turntable` |
| `--sets LIST` | sprite set presets for `sprites`: `isometric`, `headon`, `sideview`, `battle`, `oblique`, `icon`, `doom`, `rpgmaker`, `diablo`, `rts` (`battle` and `oblique` are single 256 px pictures of the drawn side; `p3d presets` describes each) | `isometric,doom` |
| `--draw-from WHAT` | `mesh` (low-poly) or `voxels`, for sprite sets and the turntable | `mesh` |
| `--flat` | all files in one folder | one folder per model |
| `--material M` | `matte`, `plastic`, `dull`, `shiny`, `unlit` | `matte` |
| `--inside S` | the `.vox` inside: `nearest`, `solid`, `hollow`, `noise`, `onion`, `rings`, `strata`, `crystal`, `fractal`, `flesh`, `machine` | `nearest` |
| `--hollow N` | hollow core with walls N voxels thick (0 = solid) | 0 |
| `--gap opp\|near` | colour for unpainted gaps: opposite side or nearest pixel | `opp` |
| `--slope X` | straighten slopes, 0–3 px (0 = keep every pixel step) | 0.9 |
| `--round-sides N` | sides on round shapes, 3–24 | 8 |
| `--scale N` | GLB: sprite pixels per metre | 32 |
| `--pivot P` | GLB origin: `bottom` or `centre` | `bottom` |
| `--normal-map` | GLB normal map; with `--bump-style` (`soft`, `chisel`, `terrace`, `engrave`, `stud`, `lit`), `--bump 1–10`, `--grit 0–10` | off (`chisel`, 5, 0) |
| `--crevices C` | crevice shadows: `off`, `map` (glTF occlusion texture), `paint` (into the colours) | `off` |
| `--trims T` | shiny trims: `off`, `glossy`, `metal` | `off` |
| `--vox-colours C` | over 255 colours: `merge` or `skip` the `.vox` | `merge` |
| `--turntable-frames N`, `--turntable-size N`, `--turntable-height DEG` | the turntable GIF | 24, 128, 0 |
| `--light L` | rendered sprites: `flat`, `2`, `3`, `4` light bands | `3` |
| `--no-render-outline` | rendered sprites without a 1px outline | outlined |
| `--snap S` | snap rendered colours to the `model`'s colours, the `preset`'s palette, or `off` | `model` |
| `--settings FILE` | take every export setting from a GUI session file; the flags above then change them | |

**`run` flags:** `--only sheets|models` (one step only), `--out DIR` (writes to `DIR/sheets` and `DIR/models` instead of the session's folders), `--sheets-out DIR`, `--models-out DIR`.

**Everywhere:** `--quiet` (only ⚠ / ✖ lines and the summary), `--strict` (exit code 1 on ⚠ too), `--presets DIR` (another presets folder).

For per-sprite settings (a different shape or thickness per sprite, split planes, inside colours), set the batch up in the GUI, save the session and use `p3d run`.

## Output

One line per item, then a summary:

```
Sheets → C:\work\out\sheets
✅ rifle_R.png → rifle__32_R_cyW.png
✖ banner.png — too big: 200 × 64 px, the limit is 128 × 128
Models → C:\work\out\models
✅ rifle (rifle__32_R_cyW.png) → rifle/ rifle.glb, rifle.vox, rifle_isometric.png, rifle_doom/RIFLA1.png +5 more
⚠ mug (mug__16_F_cyH.png) — 3 painted pixels cut off → mug/ mug.glb, mug.vox
Done in 2.1 s: 2 ✅, 1 ⚠, 1 ✖; 12 files written.
```

- ✅ done. ⚠ done, but worth a look (painted pixels that the other sides don't back up were cut off; a sheet whose name lost its settings code, so side/shape are guesses; a `.vox` skipped for too many colours). ✖ skipped or failed, with the reason; the rest of the batch still runs.
- **Exit code:** 0 when nothing got a ✖, 1 when something did (or a ⚠ with `--strict`), 2 for a bad command line, a missing input or a broken session file (nothing is written then).

## Where the files go

- **Sheets:** `<out>/<name>__<N>_<side>_<shape>[_<ends>].png`. A sheet is never overwritten (it may have been painted): if the name is taken, the new one gets a number (`rifle_2__32_R_cyW.png`), which still reads back in step ②. `--overwrite` turns this off.
- **Models:** one folder per model (`<out>/rifle/…`) unless `--flat`. The model name is the sheet name without its code. Files: `rifle.glb`, `rifle.vox`, `rifle_front.png` … (sides), `rifle_isometric.png` (one sheet per sprite set), `rifle_doom/RIFLA1.png` … (Doom sets), `!$rifle_rpgmaker.png` (RPG Maker), `rifle_stack.png`, `rifle_turntable.gif`, `rifle.gpl` / `rifle.hex`. Model exports are written over on every run.
- **`run`:** the session's own sheets and exports folders (relative paths are read from the session file's folder); `--out` overrides them. As in the GUI, with "Also add finished sheets to ②" on, the sheets ① makes are also built in ②, so a session that already lists the painted sheets builds both; use `--only models` to rebuild only what's in ②. The session file itself is never changed.

## Examples

```sh
# Props drawn from the front, 8 px deep, as GLB + .vox only
node p3d.mjs build art/props out/props --thickness 8 --exports glb,vox

# Guns drawn from the side (file names end in _R), round barrels, Doom sprites and an icon each
node p3d.mjs build art/guns out/guns --shape cyW --thickness 6 --exports glb,sprites --sets doom,icon

# Sheets to paint on, then models from the painted sheets
node p3d.mjs sheets art/props sheets
node p3d.mjs models sheets models --material plastic --normal-map --crevices map

# A batch set up in the GUI, into a scratch folder
node p3d.mjs run "my batch.p3d.json" --out C:\temp\check
```

## Rebuilding the tool (developers)

`npm run cli:build` writes `cli/p3d.mjs` (about 1 MB: the core library, its dependencies, manifold's WASM and the presets, bundled by `vite.cli.config.ts`). The source is `src/cli/`; `tests/cli.test.ts` checks it against two recorded GUI runs.
