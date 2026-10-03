# Pixel to 3D Batch Builder

A layperson-friendly desktop batch tool that turns single-side pixel-art sprites (up to 128×128) into rough-draft low-poly models in two phases: ① each sprite becomes a contact sheet (front/side/top views) for the user to paint on, ② the painted sheets become GLB models, MagicaVoxel `.vox` models and 2D exports (rendered sprite sets, turntable GIFs, surface-detail maps). Target look: SNES / N64 / PS1, optionally with a modern twist. Built with TypeScript + Vite, wrapped as a Tauri desktop app, plus a command-line tool (`p3d`) on the same core library.

## Read these first

- `DESIGN.md`: the design. Sections marked **LOCKED** are agreed, **OPEN** still need a decision. The "as built" subsections record how each part was actually implemented.
- `checklist-todo.md`: the build plan, session by session, and what is done or still to do.
- `README.md`: the public readme (what the program is, licence, links) with a "For developers" section at the bottom: dev commands (`npm run dev`, `npm test`, `npm run desktop`, ...) and a detailed source layout.
- `CLI.md`: usage of the command-line tool, written for Claude using it from another project.

## Where things are

- `src/core/`: UI-free library (pixels in, files out). `exports.ts` is the shared export path for the UI and the CLI.
- `src/ui/`: the browser interface, ported from the mockup. `desktop.ts` is the only module that talks to Tauri.
- `src/cli/`: the command-line tool, bundled into `cli/p3d.mjs` (build output, not in git).
- `src-tauri/`: the Rust desktop shell (file access, presets folder, autosave, file watching).
- `tests/`: Vitest tests for the core and the CLI; `tests/fixtures/` holds GUI-run hashes the CLI must match, the painted Phase 2 test sheets and the Ends test sprites. `tests/out/` (not in git) is where `WRITE_TEST_VOX=1` writes sample `.vox` files.
- `presets/`: sprite set presets (one JSON each in `sprite-sets/`), inside colours, fixed palettes.
- `examples/`: the example session opened on first start, with its sprites and sheets; rebuilt by `scripts/make-examples.mjs`.
- `test sprites/`: `PSRC Starter Pack Sprites/` is the main set (71 sprites, the same as the examples), `Stress Test Shapes 128px/` the stress shapes, `Game Preset Comparison Results/` the sprite set presets rendered next to the real games they imitate (reference sprites in `Real Game Refs/`; its `make_comparisons.py` remakes the sheets through the CLI from the tuned session, plus voxel versions, a Look settings sheet, camera experiments and turntable GIFs in `Render Variations/`), and `untitled.p3d.json` the user's tuned session.
- `public/guide/`: the user guide (`user-guide.html`, opened by the ❔ button) and `paint-a-sheet.html` (opened from ①), plain HTML pages shipped as `guide/` in the release. Update them when the UI changes; their screenshots in `img/` come from the browser build.
- `godot-preview/`: a Godot 4.7 project for viewing exported GLBs under real lighting, with a beginner guide.
- `branding/`: logo and icons (also used by Tauri); `make-icons.mjs` regenerates them.
- `promo/`: finished promo images (itch thumbnail, cover, screenshots, showcase contact sheets). `promo tools/`: the Python scripts and prompt notes that made them. `promo.md`: marketing notes and copy-paste texts for itch.io, GitHub, YouTube and Reddit.
- `build_release.bat`: builds the CLI and the exe and assembles `release\Pixel to 3D Batch Builder\` plus its zip (exe, `presets/`, `examples/`, `guide/`, `godot-preview/` without `.godot/`, `cli/p3d.mjs`, README, CLI.md, promo.md, `promo/`). `release/` is not in git.
- `old wip/` (not in git): material kept out of the public repo: the original mockup (with its screenshot folders, kept on purpose), `inspo/`, the user's release checklist (`RC prompt to make releases easier.md`), the other sprite batches (OMA, JAGER, STARBOUND, NOITA, PSRC Sheet3Color / Sheet6Color) and old `.vox` samples.

## Working notes

- Never delete files permanently (a hook blocks it); move them to a folder under `C:\trash` instead.
- Keep `DESIGN.md` and `checklist-todo.md` updated when a decision is made or a session's work lands.
- When testing anything on the PSRC sprites, use the user's own session file `test sprites/untitled.p3d.json` (e.g. `node cli/p3d.mjs run "test sprites/untitled.p3d.json" --out <scratch folder>`). It has the per-row settings the user tuned, such as 16 Round sides on the balls (8 is too low for them); the CLI's defaults don't.
- `test sprites/Stress Test Shapes 128px/` holds 128×128 noise-filled shapes (`make-stress.py`) and contact sheets of how they turn out; good for checking shape changes on large and awkward outlines (triangles, donuts).
- Don't run the program from inside `release/` (its `settings/` folder would be wiped by the next build); copy the release folder somewhere else to test it.
- The mockup screenshot folders (`old wip/mockup/old wip screenshots/s1`–`s4`) are kept on purpose as developer memories of how the project started. Never move, delete or tidy them, even during release cleanup; ask first if a cleanup would touch them.
- Release model: sold on itch.io and the source is public on GitHub under the commercial licence with source access (`LICENSE.md`). Readmes, guides and promo texts never state a price and never call the program "free", since the price changes over time. Keep promo advice low-effort (no campaigns or community management). Claude can't browse Reddit (it blocks bots), so just say that briefly when it comes up.
