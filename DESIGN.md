# Pixel to 3D Batch Builder: Design (draft)

Status: built (sessions 1–8) and released as a portable Windows program. This file is the "true design": each section says what was agreed, and its "as built" parts record how it was actually implemented and why it changed along the way. Items marked **LOCKED** are agreed; the few open decisions are listed in section 15. The original idea doc, [2D to 3D batch lowpoly modeller.md](inspo/2D%20to%203D%20batch%20lowpoly%20modeller.md), is kept as-is for reference.

## 1. What it is

A small desktop batch tool that turns single-side pixel art sprites (up to 128×128px) into rough-draft low poly GLB models, MagicaVoxel models and a set of derived 2D exports. The output is meant to be a good starting point for further refinement, not a finished asset. The target look is SNES / N64 / PS1 era, optionally with a modern twist such as normal maps.

It is not a 3D editor. It is a reusable batch tool with a spreadsheet-style list of items and a preview panel for the selected item. The UI is layperson-friendly: plain wording, tooltips, big buttons and a colourful interface.

## 2. The two-phase workflow (LOCKED)

The program has two modes. They are separate pipelines with separate inputs (single sprites vs contact sheets), separate spreadsheet lists and separate settings. The only thing they share is what gets carried through the sheet's filename, plus one session file that stores both (section 13).

**Phase 1: Sprites → Sheets.**

1. The artist draws sprites as individual PNGs with transparent backgrounds.
2. The artist loads a batch of sprites into Phase 1.
3. Per sprite, the artist sets depth (labelled "Thickness" in the UI), input side, cross-section shape and whether the sprite is outlined. Mass-editing works like selection in a file explorer: shift/ctrl-click, then edit many rows at once.
4. The program generates a six-sided contact sheet per sprite, inferred from the sprite and shaped by the cross-section modifier.
5. The sheet is saved to the Phase 1 output folder with all the info it needs baked into its filename. Phase 1 never overwrites a sheet that holds painting work; it adds a number to the new file instead. A sheet nobody has painted on is remade in place when its sprite's settings change (section 4, "Remaking a sheet"). By default the finished sheets are also added to the Phase 2 list, with a "Go to ② →" button when the batch finishes.

**Artist edits the sheets** in their image editor, painting the missing sides. Transparency changes the model's shape (see section 5). Phase 2 watches its loaded sheets on disk and reloads a sheet automatically when it is saved, so the preview follows the painting without re-importing. A manual Reload button is the fallback.

**Phase 2: Sheets → Exports.**

1. The artist loads the edited sheets into Phase 2. The program reads everything it needs from the image size, the filename and the fixed layout.
2. The artist sets Phase 2 parameters (split planes, blend, material, interior mode, etc.) in the Phase 2 spreadsheet.
3. The artist ticks the checkboxes for every export they want and runs the whole batch in one go, into the Phase 2 output folder (optionally one sub-folder per model).

All exports (GLB, .vox and the 2D exports) are Phase 2 only. An unedited Phase 1 sheet is a valid Phase 2 input, so "the single sprite was already enough" still works: the sheet just goes straight into Phase 2.

## 3. Phase 1 parameters

| Field | Source | Notes |
|---|---|---|
| Width, Height | Auto from sprite size | Read-only, in the sprite's own frame |
| Depth ("Thickness" in the UI) | Author | Integer px. The one dimension the sprite can't tell us. The UI says "Thickness" because "depth" is ambiguous for a side-view sprite |
| Input side | Author | Front / Back / Left / Right / Top / Bottom. Decides which face of the model the sprite lands on and therefore which way is up. Can be auto-filled from a filename suffix (codes below) |
| Cross-section shape | Author | See below. Default: Box |
| Outlined sprite | Author | On/off, default on. See "Edge scan" below |
| Copy sides | Author | On/off, default off. The inferred sides show the drawing turned to face them (section 4, "Copy sides"). Sheet colours only, so no filename code |

**Side codes (LOCKED):** `F` Front, `Bk` Back, `L` Left, `R` Right, `T` Top, `Bt` Bottom. Back and Bottom both start with B, so single letters would clash. The same codes are used in filename suffixes (`sword_R.png`) and in the sheet filename.

### Edge scan and outlined sprites (LOCKED)

Phase 1 infers each missing side by scanning the sprite from that edge and taking the first painted pixel in every row or column. Most pixel art has a 1px dark outline, so a plain scan returns the outline colour everywhere and every inferred side becomes a solid block of outline colour.

With **Outlined sprite** on (the default), the scan looks one pixel past the outline for the fill colour, and a 1px outline in the scanned outline colour is redrawn around the border of each inferred panel. The inferred sides then show the sprite's real colours, framed the way the artist frames their art. Sprites without outlines turn it off.

World X/Y/Z are derived from (width, height, depth, side) and shown read-only. They also set the cube size of the contact sheet (section 4). After Phase 1, the model's real dimensions are no longer fixed: Phase 2 measures them from what was painted on the sheet.

### Cross-section shape (LOCKED: per-slice meaning)

The shape modifier works per slice, not as one big shape cut out of the whole object. Along the chosen axis, each slice of the model is rounded (or diamond-cut, etc.) to fit that slice's own extents. A rifle with "Tube ↔" gets a round barrel and a separately rounded stock, instead of one giant cylinder slicing knife edges into everything. The outlines of the sprite are preserved.

The object's dimensions are always given, so shapes stretch to fit them. Several shapes from the original list collapse into one. Presets, with their UI name and filename code:

| Preset | UI name | Code |
|---|---|---|
| Box (default) | ■ Box | `box` |
| Rounded box | ▢ Soft box | `rbox` |
| Cylinder ↔ / ↕ / ⊙ | ⬭ Tube ↔ / ↕ / ⊙ | `cyW` / `cyH` / `cyT` |
| Diamond ↔ / ↕ / ⊙ | ◆ Diamond ↔ / ↕ / ⊙ | `diW` / `diH` / `diT` |
| Ellipsoid (covers sphere, ellipsoid and rugby ball) | ● Egg / ball | `ell` |
| Double pyramid (the old "diamond XYZ") | ◈ Gem | `dpy` |

**Shape axes are sprite-relative (LOCKED).** The axis of a tube or diamond is measured on the input sprite as drawn: ↔ along its width (`W`), ↕ along its height (`H`), ⊙ straight out of the picture through its thickness (`T`). The side code converts this to a world axis internally. The reason: the artist picks the shape while looking at their sprite. With world axes and the locked side naming (Right = +X), a rifle drawn from the Right has its barrel along world Z, so the natural choice "Cylinder X" would round it the wrong way. An earlier version of this doc made exactly that mistake in its own filename example.

This work happens on the voxel grid, which is trivial at these sizes.

### Ends for Tube and Diamond (LOCKED, built in session 4b)

Tube and Diamond get a separate **Ends** setting instead of new shapes, so the shape list stays at 10:

| Ends | Filename code | Meaning |
|---|---|---|
| Flat (default) | none | Today's behaviour |
| First end | `cF` | Rounded (Tube) or tapered (Diamond) at the start of the axis: ← left for ↔, top for ↕, front for ⊙ |
| Last end | `cL` | At the other end: → right for ↔, bottom for ↕, back for ⊙ |
| Both ends | `cB` | A capsule or a tapered crystal: straight middle, shaped ends |

- **Why it's needed.** Tube and Diamond already follow the drawing, so a bullet drawn from the side with a round nose already gets a round nose. What they can't do is shape one end only (bullet, stake, pencil), give a long straight body shaped ends (Egg and Gem curve the whole length, like a rugby ball), or shape the ends at all for the ⊙ shapes, where the drawing looks down the axis and can't show them.
- **Geometry.** Within one radius of a shaped end, the Egg cut (Tube) or the Gem cut (Diamond) is also applied across the axis; the rest of the length stays a plain tube or diamond. The session 3 rules still apply (a cut never empties a line; Phase 1 checks its sheet against Phase 2), so unedited sheets still lose no paint.
- **Texture.** A shaped end's panel wraps the drawing like Egg's panels do, instead of the plain edge scan, so it needs less painting.
- **UI.** An Ends column in ① (and an override in ②, like Shape), greyed out for the other shapes. The dropdown names the ends by the arrow direction ("← left end") so first and last stay readable. Mass edit works as usual. As built: the column sits right after Shape in both tables. The choices are ▭ Flat, then ← Left / → Right / ↔ Both ends for ↔ shapes, ↑ Top / ↓ Bottom / ↕ Both for ↕, and ⊙ Front / ⊗ Back / ⊙⊗ Both for ⊙. For other shapes the cell is a greyed "—" whose tooltip says only Tube and Diamond have ends. A row keeps its Ends value when its shape changes, so switching back restores it, but only Tube and Diamond use it. In ② the cell has the same name / changed tags as Shape. The ② preview title adds the ends, e.g. "⬭ Tube ↔ (← Left end)". Saved in the session (`ends`, and `fileEnds` on ② rows); older session files load as Flat.
- **Filename.** The code goes after the shape code, and only when the ends aren't flat, so every existing sheet name stays valid: `bullet__32_R_cyW_cF.png`. Phase 2 reads it back like the shape; a missing code means Flat. As built, it is written only when the shape has ends (an Egg row with a leftover Ends value gets no code), codes are case-sensitive like the others, and a renamed sheet's ends are guessed Flat.
- **Why after session 4:** the low-poly mesh builds tubes from slice prisms (section 6), and the caps need to be part of that design, not added afterwards. As built in session 4, a piece's rings are lofted into each other, so a shaped end can simply be more rings that shrink towards the end (the Egg or Gem cut applied to the ring boxes near it), lofted like any taper.

**As built (session 4b, `endCuts` / `applyEnds` in `src/core/shape.ts`):**

- **Which cuts.** The Egg (or Gem) cut across the axis is the cut of the other sprite axes, whose slices contain the tube's axis: a ↔ tube gets the ↕ cut and a ↕ tube the ↔ cut. Neither cuts the picture plane, so the sprite's outline stays. A ⊙ tube got both until session 7c; see "⊙ ends by distance" below.
- **⊙ ends by distance from the outline (session 7c).** A ⊙ tube's ends follow the Egg / Gem distance rule, kept to the ends: the middle stays a full-thickness extrusion, and a shaped end is cut back by `cap × (1 − f(s))` at each pixel, with the cap as long as the drawing's radius (its largest distance to the outline), at most the thickness, or half of it with both ends shaped. A circle gets a hemisphere, a donut a rounded ring, a triangle caps that follow its three sides. With one end shaped, a pixel keeps at least the voxel at its flat end. Phase 2 rebuilds it from the panels the same way. (The ↔ and ↕ end cuts combined broke a donut's caps into spikes in the voxels, and fitted to bounding boxes they gave a rectangle's and a triangle's Diamond caps odd slanted faces: `test sprites/stress 128/stress 128 caps.png`.) The ↔ / ↕ tubes keep their cuts, since their caps lie along the drawing's own length, like a bullet tip.
- **The cap.** Each piece of a slice keeps its box, except within one radius of a shaped end, where the round (or diamond) cross-section applies: at distance `s` into the cap of radius `r`, with `u = s / r` and `v` the offset across in half-sizes, the voxel stays when `u² + v² ≤ 1` (diamond: `|u| + |v| ≤ 1`). The radius is half the piece's size across. A piece shorter than that gets a shorter cap, and with both ends shaped the two caps meet in the middle, so the piece becomes one ellipse or diamond. Caps are per piece, like every other cut: in a rifle drawn with Tube ↔ and a shaped right end, every row's piece gets its right end rounded, including pieces that end inside the gun.
- **After the shape's own cut.** The end cut is applied to the model the shape has already cut, in Phase 1 and in Phase 2 alike. That way a cap's radius is the tube's real radius at that point; in Phase 1 the model is still a full-thickness extrusion before the tube's cut, so applying both to the original grid (as Egg does) would give every cap the full thickness as its radius. "A cut never empties a line" holds for the cap too, so a shaped model is exactly as long as a flat one, and the sprite's outline rule then keeps the sprite's own panel intact (for a ⊙ shape, the outline its own cut left).
- **What it looks like.** A bullet drawn end-on as a circle, with Tube ⊙ and the front end shaped, gets a proper dome (a radius-5 cap is 3, 1, 1, 0… pixels short in profile, like a hemisphere); Diamond ⊙ gets a point. For a sprite drawn from the side, the drawing keeps its own outline, as with Egg: a blunt rectangle with Tube ↔ gets its end rounded seen from above but not in the drawing's own view, and a thin one (radius 3) only loses its corner pixels. Where the drawing already shows the shaped end (a bullet with a drawn nose, a stake with a drawn point), Ends adds the missing rounding in the other direction, which "depth follows the drawing" mostly gave already. The real gains are the ⊙ shapes and blunt drawings.
- **Texture (a change from "wraps like Egg's panels").** Egg's wrap mapped the *whole* sprite run onto the panel, as if the object were turned 90°. (After session 6 both use the real surface instead of a linear fold: each hit pixel takes the drawing's colour at that voxel; section 4.) Looking at the end of a long tube that would show the whole length squeezed together: a bullet's brass case on its copper nose. So a shaped end's panel *folds* the drawing instead: each panel row's depth span, folded at its middle, maps onto the last radius of the sprite run from the end inwards. The middle of the panel shows the tip and the rim shows the pixels one radius back (the outline pixel is skipped, since the panel gets its own outline). `foldedViews` in `sheet.ts`. A ⊙ shape's ends face the sprite's own panel and the one opposite, which show the drawing anyway.
- **The mesh.** The end cut is made on the model the tube's slice prisms are fitted to (section 6), so each piece's rings shrink towards its end and the loft turns them into a low-poly dome or point, while the rest of the length stays exactly the flat tube. Separate end prisms, fitted to the voxel rows and intersected with the tube, were tried first: fitted to pixel centres, they cut slightly into the tube's N-gon all along its length (its flats sit just outside the pixel circle), which made the middle no longer a plain tube and added triangles everywhere (Tube ⊙ on the PSRC set: 195 → 870 on average). With the rings instead: ↔ and ↕ tubes gain 2–5% triangles, ⊙ tubes 195 → 470 (one end) or 620 (both), which is what the domes themselves cost. For sheets made with ends, Phase 1's panels already carry the caps, so the carved hull has them too; the cut matters most when Ends is chosen in ② for a sheet made without them.
- **Round trip.** All 71 PSRC sprites × the 6 Tube and Diamond shapes × the 3 shaped settings read back with zero cut-off paint (a test checks this; Phase 1's settle check passes the ends to Phase 2's carving). All 71 × 6 exported with ends pass the Khronos glTF validator.
- **Cost.** On the PSRC set a shaped-end sheet takes about 10–35 ms (flat: 7–13 ms), the voxel model 7–14 ms and the mesh 30–40 ms on average, 320 ms at worst.

### How the shape shapes the Phase 1 sheet (LOCKED, session 2)

Phase 1 builds a small voxel model and draws every panel as that model's view from outside. The model is the sprite's silhouette extruded through the thickness, with the shape's cuts applied (code: `src/core/shape.ts`, reused by Phase 2):

- **A cut** runs along one sprite axis. The model is sliced across that axis, and in every slice each connected piece (8-connected, so pixel-art diagonals hold together) gets the cross-section fitted to its own bounding box. Voxels whose centres fall outside it are removed; nothing is ever added.
- **A cut never empties a line (session 3).** Every row and column of the box a piece is fitted to keeps at least the one or two voxels nearest its middle, even where the cross-section would remove them all. So a piece keeps its full size in both directions: a long diamond keeps its tips, a thin ellipse its ends, and the model keeps the size that was painted. It also makes cutting twice the same as cutting once, which Phase 2 relies on (it applies the shape again). This answers the session 1 feedback that Diamond "ate away the ends of models". On the PSRC sprites, Diamond keeps about 48% of a Box model's voxels on average and Tube about 63%, and neither changes the measured size of any of them.
- **Cross-sections:** round (`u² + v² ≤ 1`), diamond (`|u| + |v| ≤ 1`) and soft (`u⁴ + v⁴ ≤ 1`), with `u, v` measured from the piece's centre in half-sizes. Testing pixel centres means a 4 × 4 circle loses its corners, while 2 × 2 and 3 × 3 pieces stay square.
- **Which cuts each shape makes:** Tube and Diamond ↔ / ↕ / ⊙ cut along their one axis. Soft box is the ↔ cut and the ↕ cut together (each made on the original model, then combined). So it rounds everything a flat sprite can't show, without cutting into the sprite's own outline. Egg / ball and Gem were the same two cuts until session 7c; they now follow the distance rule below.
- **Egg and Gem: depth by distance from the outline (session 7c, `inflate` in `shape.ts`).** Seen along the thickness, every pixel of the model keeps a span centred in the thickness, `full × f(s)` long, where `s` is the pixel's distance to the outline (exact Euclidean distance from its centre) divided by the largest such distance in the drawing, and `f` is round for Egg (`√(1 − (1 − s)²)`) or straight for Gem (`s`). The pixel farthest from every edge gets the whole thickness. A circle drawn with thickness = width becomes an exact ellipsoid, a triangle a cone-like dome (Gem: a pyramid), a donut a ring. Span lengths keep the parity of the thickness so they sit exactly in the middle, and a line never loses its last voxel or two. Phase 2 finds the very same depths from the sheet, since the outline is what the sprite's panel shows and the thickness is the model's extent, so it rebuilds Phase 1's model exactly. The per-slice meaning still holds for Tube, Diamond and Soft box. (Why: the two combined cuts were each deepest in the middle of their own column or row, so the model only reached its thickness where a long column met a long row. On uneven outlines it came out thin (a triangle as Gem at thickness 128 was about 68 deep), Phase 1's settle check shaved it further and could break parts loose, and a donut grew chunks at its diagonals. Found with `test sprites/stress 128/` in session 8.)
- **Depth follows the drawing (round and diamond cuts).** Phase 1 has no depth profile yet: the extruded model is equally thick everywhere. So for Tube, Diamond, Egg and Gem each piece's depth is scaled from its drawn size, and the longest piece across the picture gets the whole thickness. The scaled depth is rounded to whole voxels, keeping the parity of the full thickness so it sits exactly in the middle; that way Phase 2, fitting to the bounding box of what Phase 1 kept, finds the very same box. A pot drawn narrower at the base comes out shallower at the base too, a barrel bulges, and a circle drawn with thickness = width becomes a sphere. The Soft box keeps its full thickness, because it only rounds edges. Phase 2 fits each piece to its bounding box on the hull. The painted panels already carry every piece's depth, so it needs no scaling and reproduces the same shape. (User report after session 2: a pot with Tube ↕ drawn from the side lacked its taper on Front/Back, because every row was as deep as the full thickness.)
- **A ⊙ cut changes the outline, so it doesn't keep lines (session 7c).** It fits the circle or diamond to the drawing's bounding box, and keeping one pixel in every row and column it emptied left lone pixels wherever the drawing doesn't fill that box: on a triangle, at the base's corners, as loose rods through the whole thickness. A ⊙ cut keeps lines only when a piece would vanish entirely. A triangle now gives a teardrop (Tube ⊙) or a kite (Diamond ⊙).
- **The sprite's outline is kept** for every shape except the ⊙ ones. When a cut removes a pixel's whole line through the thickness (the thin ends of a long run), the pixel keeps its middle voxel, or middle two for an even thickness. (For a single cut this is now part of "a cut never empties a line"; the explicit rule still covers Egg, Gem and Soft box, whose two cuts are combined.)
- **Phase 1 checks its own sheet against Phase 2 (session 3).** Phase 2 carves the model from the six panels and applies the shape again to what it carved. On the carved model a piece can come out a little different from Phase 1's (pieces that touch across rows, a piece a cut split in two), so re-applying the shape could still remove a few voxels, and an unedited sheet would come back with cut-off paint warnings. So after building its model, Phase 1 runs Phase 2's carving on its own panels and takes the result, until nothing more changes. Most models pass the first time and stay exactly as they were; every step can only remove voxels, so it always ends. With both rules, all 71 PSRC sprites × all 10 shapes read back with zero cut-off pixels (a test checks this). Box sheets skip the check: a box is its own visual hull.
- **The ⊙ shapes are the exception.** Their cross-section lies in the picture plane, so they round the sprite's own outline. The sprite's panel then shows the cut sprite. For outlined sprites, the pixels on the new edge take the colour of the nearest pixel of the original outline, so the outline stays closed.
- **Why the sheet shows the shaped model:** Phase 2 applies the same shape again (section 5, "round-trip catch"). If the sheet showed anything the shape removes, an unedited sheet would come back with cut-off paint warnings.

## 4. The contact sheet

Goals: easy for the artist to edit by hand, and unambiguous for the program to read back.

- **Carrying the info (LOCKED):** the filename carries the cube size, input side and cross-section shape, e.g. `rifle__32_R_cyW.png`, plus the Ends code for a Tube or Diamond with shaped ends (`_cF`, `_cL` or `_cB` after the shape code, section 3). PNG metadata is not relied on, because image editors often strip it. The object's actual dimensions are not in the filename; Phase 2 measures them from the painted pixels.
  - **Cube size comes from the image size first.** The sheet width is `3·3 + 2·N`, so N is fully determined by the picture. The filename's N is only a cross-check.
  - **Renamed sheets still load.** If the filename lost its settings code, N comes from the image size, and side and shape default to Front / Box. Both are flagged as guesses in the Phase 2 list, where side and shape are editable overrides.
- **Cube canvas (LOCKED).** Every panel is the same N×N square: one full face of an N×N×N cube.
  - **Cube size N** is the largest of X, Y and Z, rounded up to the next standard voxel size (8, 16, 32, 64 or 128). The rounding leaves headroom to grow the model while painting.
  - **Placement:** Phase 1 centres the object in the cube.
  - **Everything else in a panel is transparent**, and the artist may paint anywhere in it, including beyond the Phase 1 outline. This lets the shape be changed freely during the editing step, e.g. making a 3px-deep rifle 5px deep just by painting wider Top/Bottom/Front/Back panels.
  - **Artist discipline:** panels must agree on length and width. Paint that the other panels don't allow is trimmed, because the model keeps only what all panels agree on. The Phase 2 preview highlights painted pixels that didn't end up on the model, so trimming is never a silent surprise.
- **Layout (LOCKED): 2 columns × 3 rows of N×N cells.** The parser locates every panel from N alone.

  ```
  Front  : Back
  Left   : Right
  Top    : Bottom
  ```

  - **Gutters (LOCKED): 3px solid "frame" lines, no stripes.** Each gutter is three 1px lines:

    ```
    edge | core | edge
    ```

    - **Frame colours are user-selectable (LOCKED)**, as a Phase 1 setting stored in the session. The parser never reads the frame, so any colours are valid, and sheets made with different frame colours can be mixed freely in Phase 2. Choices:
      - **Jade + violet (default).**
      - **One colour:** all three lines the same colour, for anyone who prefers a single solid frame.
      - **Grey + magenta:** the earlier look.
      - **Custom two colours:** an edge picker and a core picker.
    - **Why the default uses two colours:** the edge lines touch the art, so they should be calm; the core line is the "system, not art" signal, so it can be brighter. A single colour has to compromise between the two, which is fine but not the best default.
    - **Default edge:** a deep, desaturated jade (`#1f5a44`). Art apps show transparency as a grey or white checkerboard, and the earlier dark-grey edge (`#2e2a36`) melted into it. Jade stays visible on light, grey and dark backgrounds while staying calm next to the art.
    - **Default core:** a muted violet (`#a63ec5`). It clearly reads as "system, not art" but is easier on the eyes over long sessions than the earlier pure magenta (`#f500e1`).
    - **Accepted trade-off:** a tinted edge touching the art nudges colour judgement slightly more than a neutral one. Keeping it dark and desaturated keeps the effect small.
    - **The default frame colours are never used as UI colours**, so in the app the frame always reads as part of the sheet, not the interface.
    - **The frame also runs around the outside of the sheet**, so every panel is framed the same way on all four sides.
  - **Why solid lines instead of stripes:** at 3–4px wide, diagonal stripes read as noise rather than a pattern. Clean lines read as a frame.
  - **Why the gutters are opaque:** a contiguous flood fill or magic-wand selection of a panel's transparent background stops at the frame and can't leak into neighbouring panels.
  - **Collision guard:** gutter colours use deliberately odd exact RGB values, so an exact match with the artist's palette is unlikely.
    - When writing a sheet, Phase 1 checks the sprite's colours and nudges the gutter colours away if anything is identical or very close. This applies to whatever frame colours the user picked.
    - This stops a "replace colour", a global fill or a wand click from grabbing the gutter along with the art, or bridging between panels through it.
    - The gutter colours can differ from sheet to sheet, because the parser never looks at them.
  - **The parser never reads gutter pixels**, so paint on the gutter is harmless.
  - **Sheet size** at the 128px maximum: 3 × 3px + 2 × 128px = 265px wide; 4 × 3px + 3 × 128px + 7px legend strip tall.
  - **Re-import validation:**
    - The image size must match the size expected from N. Otherwise show a clear error that states the expected and actual sizes and the likely cause ("probably cropped or resized in your art app"). A broken sheet is skipped; it doesn't stop the batch.
    - Pixels count as solid at alpha ≥ 50%, so stray soft-brush pixels don't create geometry.
    - **As built (session 3, `src/core/reader.ts`):** only the five standard sizes are sheets. The expected size comes from the file name's N, or, when the name lost its code, from the sheet size nearest in width. The likely cause is picked from the sizes: an exact 2×–8× enlargement ("scaled up 2× in your art app"), the right width but shorter ("probably cropped, maybe the legend strip was cut off"), the right width but taller (canvas resized), smaller (cropped or trimmed), anything else (resized). When the name's N and the picture disagree but the picture is a valid sheet, the picture wins and the row gets a "?" explaining it. A sheet with nothing solid on it is an error too.
    - Broken sheets are still added to the ② list, with a red ✖ whose tooltip and callout explain the problem, and are skipped by the run.
  - The cube-net cross layout was rejected: it's awkward to look at, and some panels end up rotated or upside down.
  - Accepted trade-off: panels that touch on the model don't touch on the sheet.
- **Legend (LOCKED):** a human-readable strip under the frame explains which panel is which and warns not to change the sheet's size or structure. The parser ignores the legend.
  - It is a fixed 7px tall and drawn in a 3×5 pixel font, so it stays crisp at 1:1.
  - Small sheets can't hold much text: an N = 8 sheet is 25px wide, and N = 16 fits about 10 characters. The legend shows the longest text that fits, from `FRONT:BACK LEFT:RIGHT TOP:BOTTOM N32 DO NOT RESIZE` through `F:B L:R T:BOT N32 DO NOT RESIZE`, `F:B L:R T:BOT N32` and `F:B L:R T:BOT` down to just the size, e.g. `N16`.
  - Small sheets therefore rely on the in-app "How to paint a sheet" guide rather than the legend. A minimum sheet width was rejected because it would break "the size is determined by N".
- **Side naming (LOCKED): viewer-relative.** Names describe the view of someone looking at the object's front. Right = the viewer's right = +X. This matches how artists name orthographic views.
- **Orientation (LOCKED, to be illustrated in the guide):** every panel is drawn as seen from outside the object, and no panel is ever upside down.
  - **Front, Back, Left, Right:** up is up.
    - Right's left edge meets the Front.
    - Left's right edge meets the Front.
    - Back is seen from behind, so it looks mirrored compared with Front.
  - **Top:** seen from above, with the front edge at the bottom of the panel.
  - **Bottom:** seen from below, with the front edge at the top of the panel.
  - With this convention, left-to-right in Top and Bottom matches left-to-right in Front. What's on the Front's right is also on the right in Top and Bottom.
- **Panel contents (LOCKED, session 2):**
  - Every panel is a projection of one model in one cube, so the panels always agree with each other.
  - The sprite's own panel shows the sprite and the opposite panel shows it mirrored.
  - The four inferred panels use the edge scan: the view along a sprite row or column hits a run of painted pixels, and the panel pixel takes that run's first pixel (or, for outlined sprites, the pixel just past it). The shape changes only the panel's outline, not how its colours are picked.
  - **Split, mirrored panels for round and diamond shapes** (Tube, Diamond, Egg / ball, Gem). The inferred panels that face around the shape's axis see the curved surface the drawing is painted on from a quarter turn away, so they fold the drawing instead of the edge scan: each pixel the view hits takes the drawing's colour at that voxel, as if the drawing were projected straight through the thickness onto the curved surface. Where the surface faces the viewer (the middle of the panel) that is the run's pixel nearest the viewer; where it curves away it is a pixel further in, so the two halves mirror each other. A shotgun drawn from the side with Tube ↔ gets a Top panel that looks down on it: its top edge along the middle, its sides towards the rims. The outline pixel is skipped because the panel gets its own outline. `splitViews` in `sheet.ts`; the shaped ends' panels use the same rule. A first version folded each panel row's depth span linearly onto half the run; it ignored where the surface really was, so a narrow dome on a wide base came out squeezed (the base's depth set the fold) and a bulb's socket, which Egg makes thinner at the column's end, drew as a band (user report, same day). A ↕ cut folds the views along the rows (Left/Right for a Front sprite) and a ↔ cut folds the views along the columns (Top/Bottom). Egg and Gem have both cuts, so all four inferred panels fold. Panels looking down a tube's axis (a log's end caps) keep the edge scan, and so do Box and Soft box. (User report after session 2: an Egg boulder's sides came out as stretched stripes, which a wrap fixed. User report after session 6: the wrap, which mapped the whole run onto the panel as if the object were turned 90°, drew a gun's Top and Bottom as a squeezed side view, so it became this fold.)
  - **Copy sides (after session 6, a ① checkbox column after Outline).** With it ticked, every inferred panel shows the drawing itself, as if the object were turned so its drawn face points at that viewer: each panel row's depth span maps onto the whole sprite run the view hits, unmirrored, outline pixels left out. This is the session 2 wrap, kept as a choice because it suits things that look about the same all round (the PSRC boulder, which looked better with it than with the split view, and crates, whose flat sides otherwise get the edge scan's stripes), and extended to every shape, Box and Soft box included. The column of the sheet that holds the sprite's own panel shows the copies as drawn and the other column mirrors them (each row mirrored within the model's shape on that row), so every opposite pair is the drawing and its mirror, like the sprite's own panel and the one opposite, and a crate's brace runs / on three sides and \ on the other three (user request: a little variety). A Front sprite gets Back, Right and Bottom mirrored; a Right sprite Front, Left and Top. A shaped end's panel keeps its fold. Where the thickness differs from the drawing's size, the copy is squeezed or stretched. It only changes the sheet's colours: the model is the same, and Phase 2 reads whatever is painted, so it has no filename code and isn't a ② setting. Saved in the session as `copySides`; older files load with it off. `copy` in `renderPanels`, `copySides` in `SheetOptions`.
  - **Folded end panels (session 4b).** The panel looking at a Tube's or Diamond's shaped end folds the drawing's end round the tip instead of the edge scan (section 3, "Ends for Tube and Diamond").
  - Only solid pixels (alpha ≥ 50%) are copied. Fainter pixels aren't part of the model, so they would only show up as cut-off paint in Phase 2.
  - The object's centre in the cube is rounded down on each world axis. When the free space on an axis is odd, panels where that axis runs reversed (Back across, every panel's vertical) show it 1px off from the opposite panel. That is correct: every panel is one face of the same cube.
- **Collision guard numbers (session 2):** a frame colour is "too close" when every RGB channel is within 16 of a colour the sheet's art uses. It is then moved in fixed steps of 17 along a fixed list of directions until it is clear, so the same sprite always gets the same frame. A single-colour frame stays single-colour. The ① preview says when a sheet's frame was shifted.
- **Never overwrite:** a new sheet whose name is taken gets a number at the end of its name part, before the settings code, so it still reads back in Phase 2: `rifle__32_R_cyW.png` → `rifle_2__32_R_cyW.png`. Names are compared ignoring case, as on Windows. Two sheets in one run never share a name either (e.g. the same file name in two folders).
- **Remaking a sheet (after v1.0.0, user report).** Before this, changing a sprite's ① settings after its sheet was in ② meant removing the ② row, losing its ② settings, and running ① again, which piled up `_2`, `_3` copies in the sheets folder: "never overwrite" couldn't tell a painted sheet from one nobody had touched. Now every sheet ① puts in ② carries a link (`SheetLink` in the session's sheet row: the sprite's path, a `pixelHash` fingerprint of the sheet as written, and the `sheetRecipe` of the ① row: sprite pixels, side, thickness, shape, ends, outline, copy sides; not the frame colours, which don't change the model). Running ① for that sprite again then:
  - **remakes it in place** when the file still matches the fingerprint (unpainted) or is gone: the old file moves into a `replaced` folder next to it (Rust `move_aside`, never deleted; a taken name gets " (2)"), the new sheet may keep the old name even when it has a number, and the ② row takes the new sheet, name and side / shape / ends from ① while keeping every other ② setting. A sheet that came out identical under the same name isn't written at all ("already up to date").
  - **keeps a painted sheet** (fingerprint differs, or the file can't be decoded): the new sheet gets a fresh numbered name and a new ② row right below the painted one, copying its ② settings. With "never overwrite" off, a painted sheet is remade in place too, but its file is still moved aside, not lost.
  - Fingerprints are taken from the PNG as decoded back by the app (canvas decoding can round see-through pixels), and fully transparent pixels hash the same whatever their colour. The desktop app reads the file itself when planning; the browser build compares the picture it has, and keeps new names clear of the sheets in ② instead of a folder it can't see.
  - **In ②:** an **out of date ↻** tag shows on a linked row when its sprite or ① settings changed since (not when another row of that sprite is current, e.g. a kept painted sheet with its remake below); clicking it remakes that sheet. On a linked row, the orange **changed** tag of side, shape or ends is a **changed ↻** button that copies the ② choice to the ① row and remakes the sheet to match. Both act on the whole selection when the clicked row is part of it. Reload still only re-reads files.
  - Rows from sessions made before this have no link and behave as before (a remake adds a new row). The CLI doesn't link or remake; it keeps `--overwrite` / numbering. `handoff.ts` in the UI.

Sheets are always written at 1:1 pixel scale. Upscaled copies for editing were considered and rejected, because artists zoom in their editor anyway.

## 5. How shape is determined (LOCKED: split planes with blending)

### Baseline: visual hull

The model is the intersection of the three silhouettes, each extruded straight through the object. In this baseline, opposite panels (Front/Back, etc.) describe the same outline, and a transparent pixel cuts a hole all the way through the object along that axis. Through-holes are free. Holes that stop partway through, and deep valleys hidden from every side, are impossible.

### Adopted: split planes with blending (the "2×2×2 sectors" idea)

Each axis gets a split position (0.0–1.0, default 0.5). The split is relative to the object's actual painted bounds on that axis, not to the cube. For an object 8px wide and 32px deep, 0.5 means 4px in on X and 16px in on Z.

- The Front panel defines the outline of the front part of the object and the Back panel defines the back part.
- Left/Right and Top/Bottom work the same way on their axes.
- A blend width and style control how one outline morphs into the other around the split.

**Formally:** along each axis, the constraint becomes a variable extrusion. It uses the near panel's outline on one side of the split, the far panel's outline on the other, and a morph between them in the blend zone. The model is the intersection of the three variable extrusions.

**How the 8 sectors fall out:** with blend width 0 you get exactly the 8 hard sectors. With a wider blend the sectors merge smoothly.

**Morphing:** the morph is done by interpolating the two outlines' distance fields, a standard shape-morphing technique that gives clean in-between outlines.

**Analysis: this idea is sound.**

- **It is a strict superset of the baseline.** If opposite panels are mirror images, which is true for every unedited Phase 1 sheet, the result is identical to the plain visual hull at any split and blend setting. It can be built from the start with no downside for simple cases.
- **It enables blind holes.** A transparent area on the Top panel carves down only to the Y split (plus the blend), so mugs, buckets, bowls, cockpits and helmets become possible. The hole depth is controlled by the split position.
- **It improves organic shapes.** Fish, dolphins and sharks can have a wide, short head and a tall, thin tail fin as different outlines, instead of one merged outline.

**Limitations and issues to design around:**

- **One depth per axis (accepted).** All blind holes cut from the Top panel stop at the same depth. That's acceptable for a rough-draft tool.
- **The painted outline is no longer exactly what you see head-on (accepted).** Looking straight at the model's front shows the union of the front-part and back-part outlines. The guide needs one clear diagram explaining "Front panel = the shape of the front part".
- **Texture gaps: colour fallback (LOCKED, user-selectable).** If the back part sticks out wider than the front part, the exposed step faces the front, but the Front panel is transparent there. There are two fallback modes, chosen per row in Phase 2:
  - **Opposite panel** (default): take the colour from the opposite panel at the matching (mirrored) position. That panel has pixels exactly where this one is missing them.
  - **Nearest pixel**: take the nearest opaque pixel in the same panel.
- **Mesh path cost.** Hard splits (blend 0) stay on the crisp CSG path. Blending needs one of these:
  - **Stepped loft:** the blend zone is cut into N terraces, each a crisp extrusion of the morphed outline. This fits the faceted PS1 look and is the likely default.
  - **Smooth surface:** extracted from the distance field, then decimated. Smoother, but blobbier and more triangles.

  These map naturally onto the "blend style" setting: Hard / Stepped / Smooth.
- **Round-trip catch: the cross-section shape must survive into Phase 2 (LOCKED).** Silhouettes alone can't reproduce Phase 1's per-slice rounding. A per-slice-rounded rifle, re-hulled from its own silhouettes, gets knife-edged again. So the cross-section shape is carried in the filename and applied again in Phase 2. Blend style is a separate Phase 2 setting; they are two fields, not one field with two meanings.

**Phase 2 shape settings per row:**

| Field | Values |
|---|---|
| Split X / Y / Z | 0.0–1.0, default 0.5 |
| Blend width | 0 = hard split |
| Blend style | Hard / Stepped / Smooth |
| Colour fallback ("Gap colour" in the UI) | Opposite panel / Nearest pixel |
| Cross-section shape | From the filename, overridable |
| Input side | From the filename, overridable (needed when a filename lost its code) |

The Phase 2 row also holds the material preset (section 9) and the voxel interior preset (section 8). These describe the object (a mug is plastic, a sword is metal), so they are row settings, not export options.

**In the UI (LOCKED):**

- Split axes are labelled by the panels they separate: ↔ left · right, ↕ top · bottom, ⊙ front · back. Hovering or focusing a split value on the previewed row draws the split plane in the 3D preview.
- Blend width is disabled while blend style is Hard. Switching to Stepped or Smooth pre-fills a small width so the change is visible.
- All columns stay visible in the Phase 2 table. Hiding the split/blend columns was considered and rejected because it would make the tool more convoluted. The table scrolls sideways with the thumbnail and filename columns frozen.

**Recommended order:**

1. Baseline hull.
2. Hard split planes, which are nearly free once the baseline exists.
3. Stepped blending (built in session 4).
4. Smooth blending, if it's still wanted after seeing stepped.

### The voxel model as built (session 3, `src/core/voxel.ts`)

- **Carving with hard splits.** Each world axis has two panels looking along it: Left / Right on x, Bottom / Top on y, Back / Front on z. On each side of the axis's split, the panel on that side decides the outline; a voxel is solid when all three axes allow it. With mirror-image opposite panels (every unedited sheet) the split makes no difference and the result is exactly the plain visual hull, which a test checks on every PSRC sprite at several split values.
- **What the split numbers mean.** Each split is one panel's share of the object, measured on the object's painted bounds, in whole voxels (share × length, rounded):
  - ↔ (x) is the **Left** panel's share, measured from the left.
  - ↕ (y) is the **Top** panel's share, measured from the top, which is how deep holes painted on Top go: 0.25 = a quarter of the height, 1 = all the way (a through-hole), 0 = no hole at all.
  - ⊙ (z) is the **Front** panel's share, measured from the front.
- **Painted bounds** on an axis are the extent of solid paint on the four panels that show that axis (for x: Front, Back, Top and Bottom).
- **Stepped blending (session 4).** With Steps and a blend width of w voxels, the w layers in a zone centred on the split each get their own in-between outline: the pixels where `(1 − t) · d_near + t · d_far ≤ 0`, with `d` each panel's signed distance to its outline (in pixels, from pixel centres) and `t` how far through the zone the layer's middle is. So the outline morphs one terrace per layer, and the voxel model and the mesh use the very same outlines (`axisOutlines` in `voxel.ts`). When the two panels agree, the blend changes nothing. Smooth isn't built (a stretch goal); it is carved like Steps for now, and the ② facts panel says "shown as steps". A blend can cut off paint like any other change (the painted test fish shows 4 cut-off pixels at width 6, where the morph narrows the body at its widest rows), and it's reported the usual way.
- **The shape** is applied to the carved model with the same cuts as Phase 1 (section 3), fitted to each piece of the carved model, plus the rule that keeps the sprite's own outline (except for ⊙ shapes). A ⊙ shape isn't cut again (session 7c): its hull already is the extrusion of the outline its cut left, which the sprite's own panel shows, and an outline repainted on the sheet is kept as painted. Changing the shape in ② to something the sheet wasn't made with can therefore cut off painted pixels, and they are reported like any other cut-off paint.
- **Ghosts are dropped (session 8).** A visual hull can hold loose blobs that every panel allows but none shows: the 128-thick Egg donut from the stress set (`test sprites/Stress Test Shapes 128px/`) grew 24 little blobs in its corners this way. After the shape, any loose piece (sharing no face with the rest) other than the largest is removed when the rest of the model already covers every line through it on all three axes, so no panel's view changes and no paint is cut off. A separate part that some panel does show stays. `dropGhosts` in `voxel.ts`.
- **Settling keeps each piece whole (session 8).** When Egg and Gem were two cuts combined, Phase 2 could only fit the cuts to each piece's widest point, which the panels show, so Phase 1's settle check (section 3) shaved uneven outlines thinner and could split them into floating parts. Settling keeps only the largest part of each piece Phase 1 made (touching at an edge or corner counts), except parts holding the only voxel of a line through the thickness, so the sprite's own panel never loses a pixel. Since session 7c's distance rule, Phase 2 rebuilds Egg, Gem and the ⊙ shaped ends exactly: on the PSRC set and the stress shapes at thickness 8, 64 and 128 (584 models), settling changes none of them. It stays as a safety net for the cut shapes.
- **Cut-off paint** is every solid panel pixel whose line through the cube has no voxel left. In 3D its red ghost cube sits on that line, on the viewer's side of the model's bounding box, which is where the paint would have been.
- **Test sheets** made in code (`tests/painted.ts`, also saved in `tests/fixtures/phase2 test sheets/`): a mug whose Top panel has a see-through inside (the hole depth follows ↕), with a handle that keeps its through-hole; a fish whose Left panel is a short wide head and Right panel a tall thin tail (with ↔ at 0.5 the head is 8 wide and the tail 2 wide, which the plain hull can't do); and the mug with 4 stray pixels on Top, for the cut-off paint display.

## 6. Mesh generation (LOCKED)

- **Outline to polygon.** Each silhouette (or morphed outline) is traced into a polygon.
- **Ramp straightening.** Pixel staircases of any angle, including multi-pixel steps, are simplified into straight edges with a line-simplification pass. The tolerance is just under 1px by default and exposed per row as the "Straighten slopes" column (section 13), because higher values eat 1px details.
- **Extrude and intersect.** Outlines are extruded and intersected with a robust boolean library (manifold). The result is a closed mesh with flat faces and clean diagonals. Through-holes come for free, and triangle counts are naturally low.
- **Cross-section shapes: stepped slice prisms (LOCKED; the prototype in session 4 turned them into lofted rings, see "Lofted slice prisms" below).**
  1. Walk the chosen axis slice by slice.
  2. Within each slice, find each connected span of filled pixels. Keeping spans separate means a trigger guard hole doesn't get bridged over.
  3. For each span, build the preset's low-poly cross-section (an N-gon, rounded box, diamond, etc.) fitted to that span's extents.
  4. Merge consecutive slices with identical spans into one long prism, so a straight barrel becomes a single cylinder.
  5. Intersect the result with the silhouette hull.

  Because of the final intersection, the outline seen from the side still comes from the straightened silhouette. Tapers don't show stair steps in profile; only the rounding changes in steps.

  The number of sides of the N-gon is a per-row setting, the "Round sides" column (default 8, which suits the PS1 look).

  Possible later refinement: loft between neighbouring runs instead of stepping, for smooth tapers. (Built in session 4, see below: the prototype showed stepping alone doesn't hold up.)
- **Coordinate system.** glTF convention: +Y up, the front faces +Z. Default scale is 32px per metre, settable at export.

### The mesh as built (session 4, `src/core/outline.ts`, `mesh.ts`)

- **Silhouettes.** For each world axis, every run of layers with the same outline (from the voxel model's `axisOutlines`: near panel, far panel, blend terraces) is traced along the pixel edges, straightened, extruded through the run with manifold (WASM) and unioned; the three axes are intersected. Runs are limited to the painted bounds on their axis. A run beyond them holds no voxels, and at a split of 0 or 1 its end face would sit exactly where the model ends, where the intersection kept it as a paper-thin skin across a through-hole (the painted mug's top hole at ↕ = 1 came out closed until this was fixed; a test now checks the mesh has the same holes as the voxel model at many split values). Solids that only touch are fine: manifold's union of touching prisms is clean.
- **Rounded corners are chamfered (after session 6).** A 1 × 1 step where the outline turns from one edge to the next, stepping the same way all along (a rectangle with its corner pixel left out, a small pixel circle's diagonal), is cut into a 45° chamfer when the tolerance is at least 0.71px (the distance the chamfer moves the outline), so the default 0.9 does it. The ramp rule below keeps it as a lone corner, but it is how pixel artists round a corner, and kept square it cut a groove down every diagonal of a bottle, where the slice prisms' octagon bevel met the notch in the top view's outline (user report after session 6). A 1px tooth or notch on a straight edge (the steps go back the way they came) is still a detail and stays square. Bottles on the PSRC set lose 35–45% of their triangles. `chamferCorners` in `outline.ts`. Two neighbouring corners are never both cut; where both could go (a double 1px step, like a bottle's shoulder stepping in twice), the outward one goes, since that only cuts and is the same corner in a mirror image. The first build took whichever corner came first round the ring, so the two sides of a bottle were cut differently and its mesh got a terrace on one side of the shoulder (user report, glass bottle, after session 6). A test checks a mirrored bottle straightens into a mirrored profile and outline.
- **Ramp straightening is pixel-art aware (LOCKED, session 4).** Plain line simplification also flattens a single 1px step between two long edges into a shallow slant, and cuts every lone corner, so details vanish. So a stretch of outline is only straightened when it is a drawn ramp or curve, as well as within the tolerance: it steps the same way throughout (no bumps or notches), has at least two steps each way (a lone corner or a single step is a detail), and its runs are even or steadily growing or shrinking (1-1-1, 2-3-2-3, a circle's 1-1-2-3), with the runs at the ends at most one longer than the inner ones. At the default 0.9 this straightens 1:1 and 2:1 slopes and small circles (a 12px log end becomes a clean octagon) and keeps 1px bumps and single steps crisp. At 0 nothing is straightened, and a Box model is then exactly its voxels (same volume, tested on every PSRC sprite).
- **Cross-sections.** Round shapes use an N-gon ("Round sides" column, default 8) whose sides touch the circle, with one side facing each axis: on a square box, the box with its corners cut at 45°, the classic PS1 octagon, whose flats keep the silhouette's full size. Diamond is the diamond through the box's edge midpoints. Soft box is the box with its corners bevelled through the squircle's 45° point (8 points; an earlier 16-point squircle doubled the triangles for no visible gain).
- **The rounding reaches in by at most half the short side (LOCKED, after session 4).** One ellipse or diamond fitted to a whole long piece made guns look chewed: in a slice through a grip or magazine, the column is much taller than the receiver alone, so the diamond's widest point dropped to the grip's middle and the receiver above it got thin, a bite wherever something hangs off. Now a long box keeps its full thickness in the middle and only its ends are rounded (a stadium), pointed (a hexagon with 45° sides) or bevelled; a square box gets the same octagon, diamond or bevelled box as before. This is the mesh only: the voxel model and Phase 1 sheets still fit to the whole piece (changing that would change existing sheets), and the carved hull, which already carries Phase 1's depth, is what limits the mesh.
- **Corner bridges (LOCKED, after session 4).** Pixel artists draw rings, chains and thin diagonal lines with pixels that touch only at a corner, and the eye reads them as connected (a padlock's shackle, a key's bow). The mesh used to keep such pixels apart, so parts touching only along an edge looked like floating islands. Now every corner where two pixels touch diagonally (the other two of the 2 × 2 block empty) gets a small diamond around the shared corner, a 0.7px neck like a straightened 1px diagonal line, in every silhouette; the slice prisms are fitted to the carved model with those two empty cells filled, so the rounding doesn't cut the neck away again. The lock and both keys come out as one solid (a test checks it). This also applies at "Straighten slopes" 0, since the point is that the parts belong together. The voxel model keeps its exact voxels (diagonal voxels are normal in MagicaVoxel).
- **Lofted slice prisms (LOCKED, session 4; this was the "verify in prototype" item).** Stepping every slice made tapers and balls look like voxels (a 17px basketball came out blocky, a gently sloped zweihander blade got a sawtooth ridge) and made them heavy (a 50px Egg boulder: 5,902 triangles). Now each connected piece is followed from slice to slice while it stays one piece (it overlaps exactly one piece in the next slice and that one overlaps only it); its fitted boxes, one ring per slice at the slice's middle, are straightened like an outline (the same tolerance and ramp rule, applied to each box edge's profile), and consecutive kept rings are joined by a loft (the convex hull of the two rings), with a flat half-slice at each end of the piece. Where pieces split or join, the shape steps. With "Straighten slopes" at 0 every slice steps, which is the pixel-exact option. The boulder is now 2,352 triangles, the basketball 316, and a straight log is still one octagonal prism (28).
- **All-round shapes are lofted along one axis (after session 6).** Soft box, Egg and Gem make the ↔ cut and the ↕ cut, and the mesh used to loft slice prisms for both and intersect them. The two sets of rings, one lying flat and one standing up, met at a slant at every corner of a ball and left shards and slivers there (user report: a 5px baseball and the football looked mangled at their corners, and Round sides and Straighten slopes didn't help). Now the mesh lofts along ↕ only. The carved model it is fitted to already carries the ↔ rounding, so the rings shrink towards every edge by themselves: a ball is a stack of N-gon rings, like a globe. The voxel model and the sheets are unchanged. Crates and chests as Soft box and Gem keep their bevelled edges.
- **Shapes the rings can't follow get a traced surface (session 7c).** With the distance rule (section 3), a ring fitted to each row only follows rows whose depth rises and falls once. A donut's rows just above and below its hole are deep at both ends and shallow in the middle, and their rings filled them in (four "petals"). So for Egg, Gem and a ⊙ tube with shaped ends, `loftFits` checks every row of the drawing (and for the ⊙ tubes every column too): if the depth dips and rises again by more than a fifth of how much it varies (at least 2 voxels), the model gets the traced surface of its rule instead of the loft (`inflatedSolid`). That is the rule before rounding to voxels, traced with `Manifold.levelSet`: each point's signed distance to the straightened outline (on a half-pixel grid) gives its place on the profile. The profile is straight for Gem and, for Egg and the Tube ends, the circumscribed N-gon of Round sides, so the surface comes in bands that follow the outline. The thickness is stretched to the drawing's inscribed diameter while tracing, so triangles are about π × that diameter ÷ Round sides long both ways. The surface is merged within the sag of one N-gon side, intersected with the silhouettes (which decide the outline, straightened or not), and gets a slab for what the rule never cuts, so thin parts keep their voxel thickness. Its faces take their panel from the surface's own direction rather than the facet's, since the facets' normals scattered the pictures' borders into a zigzag. The rest keep the loft. That covers every PSRC sprite, and the stress rectangle, triangle, diamond and circle, which therefore look rounder than their voxel models. The traced surface was tried for every Egg and Gem first: it follows the rule closely, but on the PSRC balls it looked worse than the loft (box-projected textures broke up on its irregular facets, and the 8px balls came out boxy), so the loft stays wherever it fits. On the stress donuts at 16 sides the traced shapes are 2,200–4,600 triangles (8 sides: 800–1,800); a Gem ring's sharp ridge comes out a little blunt. The contact sheets in `test sprites/Stress Test Shapes 128px/` show all of it, with the noise textures and as flat grey renders (`… flat.png`).
- **Profiles traced like outlines (after session 6).** The loft used to put one ring at each slice's middle, a flat half-slice at each end, and dropped rings by its own box-edge rule, which kept single steps. So after the change above a ball looked like a buoy or a capsule, with straight sides and a flat band at each pole, whatever Round sides and Straighten slopes were set to (user report). Now each piece's two profiles along the axis (its box's extent across X and across Y, slice by slice) are traced and straightened with the outline rules (ramps, chamfered 1px corners), and a ring goes at every height where either profile has a corner. So the loft's profile is the outline the Sheet check draws. Each side of a profile is straightened on its own and in stretches that widen or narrow throughout (`rowsOutline` in `outline.ts`): `straighten` splits a ring at two corners that aren't mirror images, which straightened one side of a light bulb's taper and kept the other as steps. **Egg rounds its profiles like its rings:** a pixel ball's straightened profile is an octagon, which lofted round made a spinning top, so each outward corner turns by at most one Round sides step per segment (at 8 a 45° corner stays, at 16 it is cut in two), as a curve between points up to half an edge from the corner, so it stays inside the outline. Corners with an edge under 1.2px stay, since rounding them doesn't show and doubled a boulder's triangles. On the PSRC set at 8 sides and 0.9: the baseball went from 240 triangles (86 of them slivers) to 68, the volleyball from 424 to 114, the football from 436 to 144, the barrel from 316 to 252 and the shotgun from 1,456 to 1,224; a straight log is still 28. At 16 sides the balls are round from every side (volleyball 320, basketball 444). Small tapers follow the outline rule now: a single 1px step stays a step, where the old loft slanted every step over one slice. A test checks that the balls, and the crate and chest as Soft box and Gem, have no faces under 0.05 px² at 8 and 16 sides (since session 7c's Egg, at most one: the basketball at 8 sides has a 0.004 px² face where a straightened outline clips a ring right at its corner).
- **Shaped ends (session 4b).** A Tube's or Diamond's shaped ends are cut into the model the slice prisms are fitted to, so a piece's rings shrink towards the end and the loft makes the dome or point; the rest of the tube is untouched (section 3, "Ends for Tube and Diamond").
- **Triangles on the PSRC set** (default settings, the user's shapes): about 570 on average; Box models about 110; the chaotic potted plants reach 4,000. Building a mesh takes about 20 ms on average and 350 ms at worst (128 models with two cuts), on top of the voxel model.
- **Output.** Flat shading: vertices are shared only within one flat face, which takes one texture panel. Manifold can return zero-area slivers (three points in a line); they are kept so neighbouring edges still meet without a crack. Where two parts of a model touch along an edge (diagonal voxels), four faces share that edge; that is valid and engines accept it.

## 7. UVs and texture (LOCKED)

- **Box projection.** Each face takes its texture from whichever side it faces most, so sprites are "stamped" at their intended scale.
- **Painted from the voxel model (after session 6).** What is stamped is not the sheet's panel itself but what that panel sees of the coloured voxel model: each texel is the colour of the first voxel on its line through the cube, as the surface colour rule chose it (section 8). Stamping each panel's own paint put two different drawings side by side wherever neighbouring faces took different panels. On sheets painted differently on every side (the football and volleyball in the PSRC session), the faces near a ball's diagonals flipped between three pictures and left jagged patches, stray wedges and streaks, while the Voxels view looked clean (user report after session 6). The voxels have already settled which picture each spot of the surface shows, so neighbouring faces on two panels now show the same colours where they meet.
- **The input side's paint stays on the surface that faces it (after session 6).** The surface colour rule gives the input side every voxel it sees, right up to its rim. For voxels that is the right trade, since one voxel shows in both pictures and the input side's drawing matters most, but it carries the drawing's rim round onto the sides: the football's Front drawing put a dark rim pixel on its left side as a black spot, and the volleyball's side views had the Front rim as a stripe down the middle (user report). A mesh face shows only one picture, so the mesh can do better. Faces that take the input side's panel show exactly the voxel colours, which is the drawing. Faces that take another panel show the input side's paint only where the surface faces the input side at least 60° (cos = 0.5), and otherwise the rule's next choice: the side the voxel is most exposed to that has paint there, else the gap colour rule. The surface direction for this test comes from the empty cells up to two steps away; one step is too rough on small round models, where it flipped from voxel to voxel along a seam. A face takes a panel from about 45° and the input side's paint reaches 60°, so both sides of a seam with the input side show its paint. `surfaceColourRule` in `voxel.ts` is the one rule for both: the voxel colours use it without the 60° test, the texture with it.
- **Texels beside the model.** A texel whose line misses the voxels (the mesh's straightened edges can stand a little outside them) takes the colour of the nearest texel that hits, by straight-line distance. Nearest by 8-connected steps counted the pixel diagonally above as near as the one beside it, so the antifreeze bottle's 1px red cap spilled onto the blue neck row below it (user report).
- **Faces in front of others get their own crop (after session 6).** All faces of a panel on the same line share a texel, painted for the face that covers the texel's middle. Where a face stands in front of another face of its panel, the texels along its outline belong to the face behind, and it showed that face's colours. At Straighten slopes 0.4, the clip-mounted spotlight's lens is a stepped dome one voxel in front of its green ring. The lens's flat back faces are rounded at 45° across corner pixels whose line meets the ring, and showed that green as small triangles on the white lens (user report). Such a face now gets a second crop of its panel, painted for its own depth: a texel whose voxel lies well behind it takes the nearest texel whose voxel is at its depth. A face counts as standing in front where it partly covers a pixel whose middle is covered by another face that lies more than 0.75 voxel behind it where this face's outline crosses the pixel: the two meet across a step, not along a shared edge. Neighbouring faces of one surface meet at the same depth, so a curved surface doesn't count. Seen straight on, the lens now shows the octagon the mesh actually has, not the drawing's stepped pixel circle; the lens's corners can't be white at an angle and green straight on at once.
- **Voxels the mesh has cut away.** A texel passes over voxels lying wholly more than 1.5 voxels in front of the mesh's surface, taking the first surface voxel behind them. The mesh's straightened edges and chamfers cut at most about a voxel into the model, so they never reach it.
- **Atlas.** One texture per model, made from the six panels cropped to the model's actual bounds (not the full cube squares), packed with 1px edge padding so seams never show background. A panel's second crop covers only the faces standing in front and is keyed by the panel and `+` in `rects`.
- **Nearest filtering.** Texture filtering is set to nearest in the GLB so pixel art stays crisp.
- **Hidden areas.** Holes and trench walls take whatever projection lands on them. This is accepted and outside scope. A face wholly hidden behind another face of its panel still shares its texels with it and shows the front one's colours; only faces standing in front get their own crop.
- **As built (session 4, painting from the voxels after session 6).**
  - **Which panel.** A flat face takes the panel its normal points at most, decided once for the whole flat face. Components within 1e-4 of each other are a tie: the sprite's own side wins it, and otherwise x before y before z. A face's corners always use the same panel, which a test checks. An early build shared vertices between two triangles of a 45° face that had picked different panels, which stretched the texture across the whole atlas (a streaky wedge on the barrel). Deciding per triangle also let rounding give the two triangles of one 45° face different panels, a small wedge of another picture at a barrel's chamfered edge; a test now checks every flat face has one panel.
  - **The atlas.** Each panel a face uses is cropped to the mesh's bounds on that panel, and the crops are shelf-packed, each with a 1px border repeating its edge pixels, into the smallest power-of-two texture (a 25 × 36 × 25 barrel: 64 × 128). Inside a crop every texel is painted as above, so a face never samples background. The space between crops is left transparent. The atlas is the same size as when it held the panels' own paint.
  - **Filtering.** Nearest for both magnification and minification, no mipmaps, clamp to edge. Godot 4.7 and three.js both honour it.
  - **Measured on the PSRC session** (all 71 rows as the user set them up). Where faces on two panels meet, the share of the seam showing a different colour on each side went from 46% to 35% on average: the football 94% → 59%, the volleyball 96% → 62%, the glass bottle 73% → 20%, a tyre 86% → 43%. The rest is mostly shading that changes every pixel, which the texel grids of two panels sample a pixel apart. Seen straight on from the input side, the mesh shows 94.1% of the drawing's painted pixels in exactly their colour (93.8% before). The other sides seen straight on show 80.2% of their own panels (86.9% before), because near the input side they now show its paint. On unedited sheets those panels are made from the drawing's edge anyway. 29 of the 71 models have faces standing in front of others (guns, lamps, potted plants, the balls' poles). Their second crops made 4 atlases one size larger (three potted plants and the grenade), 3.6% more texels over the whole set. Texturing takes 9 ms on average and 182 ms at worst (the 64px boulder).
  - **Tried and dropped.** Painting every face with the voxels' own colours gave the best seams (35%) but kept the rim smear on the mesh. Moving the 60° test into the voxel rule fixed the Voxels view as well, but on small round models it lost up to 43% of the drawing seen straight on (19 models under 90%, the baseball down to 57%), so the voxel rule is unchanged (section 15). Steering neighbouring faces onto one panel changed nothing visible once the colours came from the voxels, and it turned a barrel's front lopsided.

## 8. Voxel export (LOCKED)

- **Format:** MagicaVoxel `.vox`, hand-written. MagicaVoxel is Z-up, so axes are converted on export. The 256-per-axis limit is fine for 128px sprites.
- **Palette:** `.vox` allows 255 colours. When combined panels exceed that, colours are quantised down.
- **Surface colour rule:** a voxel visible from several sides takes its colour from the original input side first, then from whichever side it is most exposed to. If that panel pixel is transparent (split-plane step faces), it uses the row's colour fallback mode from section 5.
  - **As built (session 3):** "visible from a side" means the voxel is the first one that panel's line of sight hits. "Most exposed" is measured by the surface direction at the voxel: the sum of the directions to its empty neighbours (all 26). The candidates are tried in that order, and the first one whose panel pixel is painted gives the colour. Surface voxels that no panel sees (inside a cavity) use the faces that are open, in the same order.
  - When none of the candidates has paint, the gap colour rule of the first candidate applies. **Opposite panel** takes the pixel on the same line from the panel across; if that's see-through too, it falls back to the nearest pixel. **Nearest pixel** takes the nearest painted pixel in the same panel (8-connected steps). The floor of a blind hole shows the difference: the mug test sheet's floor comes out bottom-coloured with Opposite panel and rim-coloured with Nearest pixel.
  - The preview's facts panel says how many surface cubes took their colour from the gap colour rule.
- **Distance to the surface (session 3):** steps between face neighbours, 1 on the surface. Each interior voxel also keeps the colour of the surface voxel it was reached from (the "Nearest surface" style) and a **local thickness**: the deepest distance reached in that part of the model, carried back outwards. Flesh & bone scales its layers by the local thickness, so a thin tail gets its own small bone core, and parts less than 4 deep get no bone.
- **Interior modes (LOCKED).** Each interior voxel's colour is a formula of its position and its distance to the surface. That distance is already computed, so every mode is cheap.

  | Preset | What it does | Good for |
  |---|---|---|
  | Nearest surface (default) | The inside continues the outside | General use |
  | Solid | One colour | Fruit flesh, simple fills |
  | Hollow | Surface shell only | Smallest files |
  | Noise | 1 colour with shade variation, or 2 colours mixed | Minerals, stone, dirt |
  | Onion | Colour bands by distance to the surface, 1 or 2 colours | Layered objects |
  | Tree rings | Onion with 2 alternating colours | Wood, logs |
  | Strata | Horizontal layers | Rock, cake, soil |
  | Crystal | Cellular (Voronoi) pattern | Minerals, geodes, fruit flesh |
  | Fractal | Swirl or marble pattern | Stone, magic stuff |
  | Flesh & bone | Onion layers scaled by local thickness: skin → flesh → a pale bone core down the thickest middle, plus noise | Creatures |
  | Machine | Dark metal base, a 3D grid of coloured "pipes and wires", occasional bright spots | Robots, vehicles, devices |

  - **Hollow core (LOCKED, built in session 5).** A per-row ② column that works with every inside style: 0 = solid (today), N = walls N voxels thick around an empty middle. So Tree rings with a hollow core is a hollow log, Strata a geode shell, Machine a hull of wiring around a cavity. Voxels deeper than N (distance to the surface > N) are simply left out. Parts thinner than two walls stay solid by themselves. The Hollow style stays as the shortcut for "outside colours, 1 thick". It only affects the `.vox` file and the Voxels preview (Peel shows it); the GLB has no inside. As built: the "Hollow core" column (walls, px, 0–32) sits after Pattern and is greyed out for the Hollow style; changing it jumps to the Voxels view cut halfway, like changing Inside. One rule decides which voxels exist for both the file and the view (`keepsVoxel` in `src/core/vox.ts`). Saved in the session as `hcore`; older files load as 0.
  - **Flesh & bone and Machine are stylised approximations.** The program doesn't know what the object is, but both read convincingly when the model is cut open.
  - **Advanced controls per row** (② columns, section 13): up to 3 colours, noise amount, pattern scale. Each preset starts with its own fitting default colours, and a Reset button returns to them.
- **The `.vox` file as built (session 5, `src/core/vox.ts`).**
  - **Format:** the classic minimal form every reader understands: `VOX ` version 150 with one MAIN chunk holding SIZE, XYZI and RGBA. The model is cropped to its box.
  - **Axes:** MagicaVoxel is Z-up with the front facing −Y, so the model's (x, y, z) becomes (x, front-to-back, y). That's a turn, not a mirror. Checked in MagicaVoxel 0.99.7.2: its default camera shows a front-drawn sprite upright and unmirrored, and the PSRC barrel stands upright with its colours.
  - **Palette:** when everything fits into 255 colours, every colour is kept exactly. Inside voxels coloured like the surface (Like the outside) need no slots of their own. Otherwise the inside keeps up to 32 slots and its shades are merged into them, and the surface keeps every colour if it fits into the rest, or is merged into it. Inside voxels may also use a close surface colour. Merging is a weighted median cut plus two rounds of moving each palette colour to the middle of the colours that picked it (`quantize` in `src/core/palette.ts`).
  - **"Warn me and skip the file"** skips a model only when its surface colours don't fit, which are the colours painted on the sheet. The inside's shades are made up by the Inside style, so they are merged either way; otherwise Speckled with noise would skip nearly every model. The run lists the skipped models.
  - **In the preview:** the Voxels view's facts show what the file holds ("Voxel file: 63 546 cubes · 255 colours"), with the count in amber and an explanation in its tooltip when colours were merged. It is only worked out in the Voxels view, since some inside styles take a moment on big models.
- **Peel preview (LOCKED, preview only).** The voxel view in the Phase 2 preview has a Peel slider that slices layers off the front or the top, so the chosen interior can be judged before exporting. Without it, the artist would be choosing interiors blind.
  - Changing a row's interior preset jumps the preview to the voxel view, already cut halfway through.
  - It is a filter on the voxel list (or a clipping plane in Three.js), so it costs next to nothing.
  - It never affects any exported file.
- **Cost of rich interiors: effectively none.**
  - **File size:** `.vox` stores 4 bytes per voxel regardless of colour. Only the voxel count matters, and only Hollow reduces it.
  - **Rendering:** voxel renderers draw only visible faces, and the interior is invisible until cut open.
  - **GLB:** unaffected, since the mesh has no interior.
  - **The one real cost is palette slots.** The interior reserves up to about 32 of the 255 colours, and surface colours are quantised into the rest when needed.

## 9. Materials (LOCKED)

GLB PBR materials come down to two numbers, metallic and roughness. Presets set them. The preset is a per-row setting in the Phase 2 list, not an export option. Raw values are ② columns (section 13).

**As built (session 4):** Metal and Rough are ② columns next to Material (0–1, steps of 0.05, greyed out for Unlit). They show the row's preset values; changing one stores the row's own pair (`mraw` in the session, null = the preset's values), and picking another material in the list resets them. Unlit writes the `KHR_materials_unlit` extension with metallic 0 and roughness 0.9 as the fallback for viewers without it, and the Model preview draws it without shading.

| Preset | Metallic | Roughness |
|---|---|---|
| Matte | 0 | 1 |
| Plastic | 0 | 0.4 |
| Dull metal | 1 | 0.7 |
| Shiny metal | 1 | 0.25 |
| Unlit | n/a | n/a (glTF unlit extension, very PS1) |

## 10. Surface detail: normal map, crevice shadows, shiny trims (LOCKED as optional)

Generated from the texture atlas; no dependency is needed. All off by default. The intent is a hybrid "retro yet modern 2.5D" surface look: carved and embossed detail without extra triangles.

**History.** Session 4's first prototype used plain brightness as height, which gave a faint shine. The rework after user feedback made each colour patch a bevelled tile (now the Soft style). A spin-off chat then found the user had pictured something crunchier, and that a normal map alone can't give it: it only shows where light hits at an angle. Session 4c added the bump styles, Grit, crevice shadows and shiny trims (`src/core/normalmap.ts`).

**How the atlas is read.** Every style starts the same way: patches of similar colour (neighbours within 40 per channel) meet at clear colour changes, and darker pixels count as lower. The atlas holds each panel's crop with a 1px border repeating its edge pixels, and the crops' borders touch. So every lookup is clamped to the pixel's own crop (`TexturedMesh.rects`): a panel never picks up grooves from its neighbour in the atlas, and a border pixel takes the values of the crop pixel next to it (for maps finer than the atlas, the sub-pixels facing it).

**Bump styles** (the "Bump style" list; also where the crevice shadows come from):

| Style | Normals | Height field (for crevice shadows) | Map size |
|---|---|---|---|
| Soft | each patch a raised tile bevelled over its last 2 pixels, plus brightness (up to 0.6 of a bevel); slope by a Sobel filter, 0.5 × Bump strength per height unit | the same | atlas |
| Chiselled | a 1px chamfer round every patch: an edge pixel faces the other patches it borders (8-neighbourhood, diagonals half weight), snapped to one of 8 directions at one fixed tilt; flat inside and where patches lie on opposite sides | Soft's | atlas |
| Terraced | every patch a plateau, brighter ones higher; a pixel on the upper side of a step tilts towards each lower patch (4-neighbourhood) at 1.4 × the fixed tilt, the lower side stays flat | brightness × 1.6 | atlas |
| Engraved | the darker side of every clear colour change is cut in: each half of the pixel next to an uncut neighbour is a wall facing away from it, so the pixel itself is a V-groove; everything else flat | cut pixels 0.4, the rest 1 | 2× |
| Studded | every pixel its own raised tile: the outer ring of its 4 × 4 sub-pixels is the bevel, the middle 2 × 2 flat, whatever the colours | Soft's | 4× |
| Drawn light | the artist's own shading read as facing: brightness minus the 5 × 5 average tilts the pixel towards the upper-left light (lighter) or away (darker) | Soft's | atlas |

The fixed tilt of the crisp styles is 0.12 × Bump strength (6 gives about 35°). Studded and Engraved need detail inside a pixel, so their normal map is bigger than the atlas; with nearest filtering it stays pixel-aligned, and glTF lets the normal map differ in size from the colour texture. Studded looks like a fine grid from afar; it's meant for close-ups and mosaic looks. Its files are the biggest (71 PSRC models with Grit: 7 MB instead of about 1 MB).

**Grit** (0–10, off by default) adds a stable random tilt per atlas pixel on top of any style (hashed from the pixel's position, so the same every export), 0.05 × Grit at most, from 35% in flat colour to full where the colours around the pixel vary. A slider of its own rather than a style, because it combines with every style ("Chiselled but gritty").

**Crevice shadows** (ambient occlusion, "Off / In the file (AO map) / Painted into the texture", with a Crevice depth slider 1–10, default 5). From the style's height field: in 8 directions, the steepest rise within 3 pixels (height × 0.25 × depth per pixel) gives how much of the sky that direction hides; the light that reaches the pixel is 1 − 1.6 × the average. *In the file* writes it as the glTF `occlusionTexture` (grey, the red channel is read). That's physically correct, but engines apply it mostly to ambient light: Godot only darkens direct light with it when the material's "AO on light" is raised, which the importer doesn't do. So it's subtle under a strong sun or lamp. *Painted into the texture* multiplies it into the colour atlas instead, so it always shows, also on Unlit models and (later) in the rendered sprites. The crevice shadows use the Bump style even when Bumpy surface is off.

**Shiny trims** ("Off / Glossy / Metallic"). Pixel artists often draw light trims on a darker body. Trims are pixels lighter than their 5 × 5 surroundings (a ramp from 0.03 to 0.12 brighter). The GLB gets a glTF metallic-roughness texture (green roughness, blue metallic) that holds the row's own Metal and Rough values on the body and roughness at most 0.25 on trims (Metallic also makes them metal 1). Because glTF multiplies the texture by the material's factors, the factors are then 1.

**The Model preview** shows all of it: the normal map with a key light from the upper left (relative to each face's own shading, so faces keep their tone on average), crevice shadows at 80% (engines apply them mostly to shade), painted-in shadows as part of the texture, and trims as a sheen plus a highlight of the key light, tinted by the colour when metallic.

**Unlit** models never get a normal map, AO map or trim texture (unlit ignores light); painted-in crevice shadows still apply. **Defaults (user's choice after trying every style):** Chiselled at Bump strength 5, the crunchy look the normal map was meant to have from the start; the switch itself stays off by default. The "beta" tag is gone: the user considers the feature complete. It's still called "Bumpy surface" in the UI; the file holds a normal map, which is what engines expect.

**In Godot (session 4d).** The `godot-preview/` project (section 12) shows exported GLBs under real Godot 4.7 lighting. Checked with the PSRC models exported with every bump style, Grit, both crevice shadow modes and both trim modes, and side by side with the Model preview. Every map loads and responds as intended (normal map the right way round, AO in the red channel, roughness green and metallic blue, nearest filtering kept, also when loaded at runtime). What looks noticeably different from the Model preview:

- **Metal is much darker in Godot.** A metal surface shows its colour only by reflecting its surroundings, so Shiny and Dull metal bodies go dark olive or nearly black in a dark room and read well only under a sky. The Model preview draws metal at about its texture brightness with a sheen, so a yellow padlock is bright yellow there and dark gold in Godot. This is the biggest difference.
- **Faces facing away from the light go dark.** The preview's camera-fixed tones keep every face at its tone (top brightest). Godot lights by real direction, so the sides away from the sun are much darker, and with Filmic tonemapping the lit colours look a little paler and less saturated than in the preview. Linear and AgX tonemapping made no real difference.
- **Bumps show mostly where light skims the surface.** The preview lights each face's bumps from its own upper left, so they always show. In Godot, Chiselled relief is clear under the Moving lamp or while turning, and calmer under a head-on sun or Studio. The styles stay clearly distinct from each other.
- **Crevice shadows in the file** behave as described above: visible in sky-only light (Shade), faint in sun unless "AO on light" is raised. At 1 they come close to the preview's look.
- **A Godot-only artefact:** Godot's Screen Space Roughness Limiter (on by default in Forward+) draws thin dotted light lines along pixel edges on shiny, bumpy models, because the nearest-filtered normal map changes sharply there. Turning it off removes them. The preview project turns it off and the guide explains the setting for the user's own game. It isn't a fault in the file (the tangents Godot generates are fine and there are no slivers).
- **The same:** shapes, texture placement, crispness and trims (Godot's highlights are sharper and depend more on the view).

Whether the Model preview should imitate any of this (darker metal, direction-based shading) is an open decision for the user.

**Checks:** all 71 PSRC models exported with each style (and Grit, both crevice shadow modes and both trim modes spread over the runs) pass the Khronos validator with no errors, and 213 of them (Chiselled, Engraved, Studded) import into Godot 4.7 with the normal, AO, roughness and metallic textures picked up and nearest filtering kept.

## 11. Phase 2 exports

All exports are checkboxes in one export panel. They run for the whole batch in one pass, with advanced controls per export.

| Export | Controls |
|---|---|
| GLB model + texture | Scale (px per metre, default 32), origin (Centre / Bottom-centre), surface detail (section 10): normal map on/off with a Bump style (default Chiselled), Bump strength (1–10, default 5) and Grit (0–10), Crevice shadows (off / AO map / painted in) with a depth (1–10), Shiny trims (off / glossy / metallic). The material preset is a per-row setting. Built in session 4: ② Run writes one `name.glb` per model (the sheet's name part), in its own folder with "One folder per model", zipped for download in the browser build |
| MagicaVoxel `.vox` | What to do with more than 255 colours: merge similar colours (default) or warn and skip the file. The interior preset is a per-row setting |
| 6 individual side PNGs | None |
| Sprite stacking strip | Horizontal slices of the voxel model in a strip, for NIUM-style pseudo-3D. Slice axis, order |
| Rendered sprites | One or more sprite sets, each from a preset or custom (see below). Each set writes its own sheet per model, e.g. `rifle_isometric.png`. Replaces the earlier separate "directional sprite sheet" and "isometric sprites" exports |
| Turntable GIF | Camera height: a free slider (−30° to +60°) with Low (−15°), Level (0°) and High (+15°) as recommended quick picks. Frame count, size. Good for itch.io pages and promo |
| Palette | `.gpl` / `.hex` of the model's colours |

Export cards hold only batch-wide output settings. Anything that describes the object itself (material, interior) lives in the row.

**As built (session 5).** ② Run writes every built export per ready model into one zip (`<session> models.zip`), in a folder per model with "One folder per model". File names start with the model's name, which is the sheet's name without its settings code: `rifle.glb`, `rifle.vox`, `rifle_front.png` (then `_back`, `_left`, `_right`, `_top`, `_bottom`), `rifle_stack.png`, `rifle.gpl`, `rifle.hex`. The progress list marks each model ✅, ⚠ (with the reason: cut-off paint, a skipped `.vox`) or ✖ (nothing left to build). The summary counts the files of each kind and names the ⚠ and ✖ models, the skipped `.vox` files and how many ✖ rows were left out. Since session 6 the run also writes the rendered sprite sets and `rifle_turntable.gif`. The 71 PSRC models with the five exports of session 5 take about 11 s in the browser (710 files, 1.6 MB); with every export ticked (two sprite sets and the turntable added) about 19 s (1,207 files).

- **6 side pictures** (`sidePictures` in `src/core/pictures.ts`): each side as painted, cropped to the model's box as seen from that side. So Front and Back are both width × height of the model, and so on, and they line up with the model. Paint outside the model's box is left out.
- **Sprite stack strip** (`stackStrip`): one-voxel layers side by side, first layer on the left, each seen from the way the stack grows. Height layers are seen from above with the front edge at the bottom, like the Top panel. Depth layers are seen from the front and width layers from the right. "Bottom first" starts at the low end (bottom, back, left). Inside voxels show the colour of the nearest surface, so a layer's cut face continues the outside wherever it shows between layers. The mockup's preview drew width layers from the left; the export and the preview now agree on the right.
- **Palette** (`modelPalette`, `writeGpl`, `writeHex`): the model's surface colours, dark to light, as a GIMP palette (also read by Aseprite and Krita) and/or a plain `.hex` list (Lospec style, no `#`).
- **Live previews:** every preview calls the same core functions as the export. Since session 6 the sprite set and turntable previews use the real renderer (at most 64 px; bigger pictures are previewed at 64).

### Export previews (LOCKED)

Each export shows a live preview of the currently selected Phase 2 sheet inside its options, so the angle, rotation and look can be judged before running the batch.

- **Rendered sprite sets:** the actual frames (up to 8 shown), with the direction angle under each and a count of drawn vs mirrored pictures. They update while a camera slider is being dragged.
- **Turntable GIF:** a looping spin at the chosen camera height and frame count.
- **Sprite stacking strip:** the layers, in the chosen axis and order.
- **6 side pictures:** the six cropped sides.
- **Palette:** the colour swatches.
- **GLB and `.vox`:** no separate preview; a "Show it" link switches the main preview to the Model or Voxels view, which already shows exactly that file.

The "Pixel-perfect look" settings (outlines, light bands) show up in these previews too.

Cost: previews use the same render path as the export, just one sheet at thumbnail size (64px or smaller), and are drawn only for export cards that are open. This is not a separate feature to maintain; it's the export code called early.

### Rendered sprites: sprite sets (LOCKED)

Directional sheets, isometric sprites, head-on views and side views are all the same thing: the model rendered from a set of camera angles. So they are one export made of **sprite sets**. Each set is one preset (or custom settings) and produces one sheet per model. A run can hold several sets, e.g. an isometric set and a Doom-style set at the same time. "Add another sprite set" adds one, and each set can be collapsed, edited or removed.

- **Isometric** is a set with 4 directions, the first view on the diagonal (45°) and a 30° camera height. 30° is what gives pixel art's clean "2 across, 1 up" lines (sin 30° = 0.5); true isometric (35.26°) gives slopes that don't sit on the pixel grid.
- **Head-on** is a set with the first view straight at the front and no tilt (0°). 1 direction gives a single front view; 4 gives front, right, back and left.
- **Side view ¾ (Advance Wars-style)** is a slightly elevated side view: the first view looks at the side (90°) from about 25° up, so the top and the side both show. It uses 2 directions with mirroring on, so one is drawn and the game flips it.

### Sprite set presets (LOCKED)

Presets are stored as small data files, so users can add their own. Changing any value in a set switches it to "Custom", and "Save as my preset" writes the current settings as a new preset file. Each preset bundles these settings:

- number of directions (1, 2, 4, 8, 16 or 32)
- first view: Front (0°), Diagonal (45°), Side (90°) or Custom (a 0–359° slider); the other directions turn evenly from there. Custom with 1 direction gives a single angled picture, e.g. an inventory icon or pickup
- turns count from: **Object's front** or **Your drawing**. Game direction sheets need the first frame to face the object's front whichever side the sprite was drawn from, while icons want 0° to mean "my drawing, straight on". So this is a per-set choice rather than a global rule. Inventory icon defaults to Your drawing and every other preset to Object's front. Sprites drawn from the top or bottom count from the front
- camera elevation
- tilt: leans the finished picture inside its frame (−90° to +90°, quick picks −45° / upright / +45°), like the diagonal swords of many inventory screens. It rotates the render itself, so it costs nothing extra
- camera type: orthographic, perspective (with field of view) or oblique (with depth angle, depth length and which way the depth slants; added in session 9)
- mirroring: whether mirrored directions are skipped and left to the game to flip
- cell size
- frame layout and naming
- optional palette limit

**Camera:** orthographic is the default, because isometric and tile-based games need it to line up on the grid. Perspective gives the pre-rendered 90s look. Oblique (session 9) isn't a turned camera at all but a shear: the side the set's turn looks at stays flat-on, exactly as drawn, and the depth slants away up to one side, so the top and one end show too, the way hand-drawn side views such as Advance Wars' battle sprites are drawn. See "Oblique camera" under "Rendered sprites as built".

Starting set. These values were first written from memory; session 6 checked them against real games (see "Preset numbers checked" below):

| Preset | Directions | Camera | Notes |
|---|---|---|---|
| Isometric | 4, diagonal first | 30°, ortho | 2:1 pixel isometric, SimCity 2000 / Transport Tycoon style |
| Head-on | 4 (or 1), front first | Level, 0°, ortho | Side-scrollers, cards, icons |
| Side view ¾ | 2 (1 unique + 1 mirrored), side first | ~25°, ortho | Advance Wars-style map units, 16px cells |
| Battle view | 1, custom turn (20° from your drawing) | 20°, perspective, 40° lens | Advance Wars-style battle scene pictures, 256px cells (session 9) |
| Oblique view | 1, front (your drawing) | Oblique: depth 45° up and right, half length | The drawing flat-on with its top and right end, like Advance Wars battle sprites, 256px cells (session 9) |
| Inventory icon | 1, custom turn (35° from your drawing) | 30°, ortho | Inventory icons, pickups, shop items, 32px cells |
| Doom-style | 8 (5 unique + 3 mirrored) | Level, 0° | Doom rotation naming, optional 256-colour palette lock. Covers monster mods and player skins |
| RPG Maker MV/MZ | 4 (down/left/right/up) | Top-down ¾, 30° | 48px cells in RPG Maker's character sheet layout, pose duplicated into the 3 walk-frame slots |
| Diablo-style | 8 or 16 | Isometric-ish, ~30° | |
| Classic RTS | 32 | 30° (2:1 tiles), ortho | For Tiberian Sun / Red Alert 2 vehicles, which are voxel models in-game, the `.vox` export is the closer fit |

### Pixel-clean rendering (applies to rendered sprites and the turntable)

Rendering a 3D model straight down to small pixel sprites tends to produce noisy, broken pixels. There are known techniques for this, popularised by indie devs doing "3D rendered as pixel art", and Three.js ships a starting point: `RenderPixelatedPass`, an add-on that renders at low resolution and draws outlines from depth and normal edges.

The pipeline:

1. **Render at the exact target resolution** into a low-res render target: no anti-aliasing, nearest texture filtering, orthographic camera.
2. **Outlines:** optional 1px outlines detected from depth and normal differences. Both the outer silhouette and inner edges get clean single-pixel lines.
3. **Lighting:** flat or banded (2–4 hard bands) instead of smooth shading, so there are no gradient smudges.
4. **Palette lock:** snap every output pixel to the model's own palette (or the preset's palette).
5. **Fallback for rotated views:** texel dropout at odd angles is the usual remaining artefact. If it shows up, render at 2–4× and shrink by taking the most common colour in each block, never by averaging.

Feasibility: good. Steps 1–4 are the pixelated pass plus two small post-processing shaders. Treat it as its own prototype before promising results.

**In the UI** these settings are one shared "Pixel-perfect look" group rather than a copy per export: 1px outlines on/off, lighting (flat / 2 / 3 / 4 bands), palette snap target (the model's own colours / the preset's palette / off), and the odd-angle fix (only when needed / always / never).

### Rendered sprites as built (session 6, `src/core/render.ts`, `sprites.ts`, `gif.ts`)

- **A software rasterizer in the core, not `RenderPixelatedPass` (design change).** The renderer has to run in Node for the tests and the command-line tool, like the GLB writer, and at sprite sizes (16–128 px, a few thousand triangles) drawing the textured mesh in plain TypeScript takes a few milliseconds per picture. It is the prototype step 1–5 above, and it held up on the first try across all presets. It draws the same textured low-poly mesh as the GLB, with the 3D model card's colour texture, so "Painted into the texture" crevice shadows show in the sprites too. The normal map is not used (at sprite sizes it only adds noise).
- **Camera.** Turn 0 looks at the front, 90 at the Right side (+x), 180 at the back. The model turns about the middle of its box, which sits in the middle of the picture, so every direction of a set shares one centre and one scale and the frames line up. Tilt spins the picture (the camera's up and right axes), not the light.
- **Draw from: Low-poly model or Voxel model** (added after session 6, user request; a per-set setting and one for the turntable, so one run can mix both, e.g. isometric from the mesh and RTS units from voxels as Red Alert 2 did). *Voxel model* draws every outside cube face of the voxel model as two triangles, coloured by the `.vox` file's surface colour rule through a small atlas holding each colour once (`voxelSource` in `render.ts`), so the rest of the pipeline is unchanged. Cube coordinates match the mesh's, so a Box drawn straight on is identical from both (tested). The hollow core and the inside style don't matter, since only the outside shows. One outline rule is added for voxels: at a camera height a one-cube stair step looks deeper than it is (two cubes deep along a 30° view), so every step of a round voxel model got an inner line; for voxel sources an inner line also needs the two parts to be more than 1.5 cubes apart measured square to their surfaces (`stepGap`). Low-poly renders are unaffected. A 128³ box is about 200,000 triangles as voxels, still quick at sprite sizes; the user's 71 models with a voxel sprite set and a voxel turntable took about 29 s to export instead of 19. Preset files and sessions carry it as `from` (`mesh` / `voxels`, default `mesh`); every preset stays on the low-poly model. The switch sits right under its preview, in the sprite set and in the turntable card (user feedback: further down, it meant scrolling away from the preview to change it and back to see the result).
- **Oblique camera (session 9).** A third camera type next to Flat and Perspective, for the Advance Wars battle-sprite look: the side the set's turn looks at is drawn flat-on (for "Your drawing" sets, the drawn side, so a Box is exactly its drawing), level lines stay level, and the depth recedes sheared to one side: screen x = x + k·depth·cos α, screen y = y + k·depth·sin α. No rotation gives this. In `render.ts` it's a pair of sheared screen axes in `viewOf` (`project()` doesn't need them square); depth order, back-face culling and the camera-fixed light use the direction the shear looks along (d + k cos α r + k sin α u, the line of points that lands on one pixel), with the light's up kept as close to the world's up as that allows. Camera height is ignored (and hidden in the set editor); tilt still spins the picture. The odd-angle fix always applies, since the top and end faces are squeezed. Settings, shown in the set editor only for Oblique: **Depth slants** up and right / up and left (`oside`, default right), **Depth angle** 0–90° (`oangle`, quick picks 2:1 = 26.57°, 30°, 45°; the only setting that keeps two decimals) and **Depth length** 10–100% (`odepth`, quick picks half = cabinet, ¾, full = cavalier). Preset files and sessions without them get 26.57° / 50% / right, which matter only for oblique sets. Decisions: (1) which face is flat-on follows the set's turn, as for the other cameras, so "Your drawing" keeps the drawn side flat-on whichever side was drawn; (2) the slant direction is its own setting, not tied to Skip mirrored directions, which is about which turns are drawn; (3) not for the turntable, which spins; (4) **Oblique view** uses 45° at half length, chosen by eye against the Advance Wars battle sprites: their vehicles face right with the top and the front end showing, which is depth receding up and right; 45° shows the top about as much as theirs and keeps the slants clean 1:1 pixel steps, while 2:1 (also pixel-clean) looked flatter. `Render Variations/camera angles vs Advance Wars 2 battle sprites.png` has 2:1 half, 45° half and 45° full side by side.
- **Picture size** quick picks (session 9): 32, 64, 128, 256, 512 and 1024 under the number box, since the battle presets are single big pictures. Sizes up to 1024 already worked; at 256 a 32px sprite's pixels become 6–8px blocks and the 1px outline reads as a hairline (a crisp low-poly render rather than pixel art), at 64 it reads as pixel art, 128 is in between. The battle presets stay at 256 as the user asked.
- **Model size** (new per-set setting "Model size"): *Fill the picture* (default) fits the model into the cell over all the set's drawn directions, leaving one pixel for the outline; *Drawing's pixel size* draws one model pixel as one picture pixel (seen straight on), so every model in a batch keeps its size relative to the others, and big ones get cut off.
- **Pixels.** Each picture pixel samples the texture at its centre (nearest, top-left fill rule, perspective-correct in perspective). **The odd-angle fix** renders 4× bigger (less for pictures over 256 px, so the big render stays under 1,024) and keeps the most common colour in each block; a block less than half covered is see-through. "Only when needed" skips it for straight views (a quarter turn, eye level or straight down, upright, flat camera) at a scale of at least 1, where no texture pixel can drop out. Drawn straight on at scale 1, a Box model is exactly its drawing, pixel for pixel (tested).
- **Light** is fixed to the camera, from the upper left and a little in front, so every direction is lit the same way on screen (as pre-rendered game sprites are). Flat keeps the texture's own colours; 2–4 bands step from 55% to 100% brightness by the face's angle to the light. Unlit rows are always drawn flat.
- **Outlines.** Every empty pixel next to the model (4-neighbours, so corners stay open, as pixel artists draw them) takes a dark version (30%) of the colour it borders. Inner lines go where a nearer part stands in front of a farther one: each of the two surfaces, extended to the other pixel, misses it by more than about 1.2 model pixels. Creases where two faces meet get no line; the light bands show them. Inner lines sit on the farther part (so the nearer one keeps its size) in a 45% version of the nearer part's colour.
- **Colours.** "Snap colours to" maps every pixel to the nearest of: the model's surface colours (the palette export's colours; shading then lands on the artist's own ramps), the set's fixed palette ("The preset's palette"; a set without one uses the model's colours), or nothing. The set's **Colour limit** then applies to the whole sheet together: *Doom palette (256)* snaps to Doom's palette (`presets/palettes/doom.hex`, Freedoom's copy of PLAYPAL, which is identical to Doom's), *16* or *32 colours* merge the sheet's colours with the median cut shared with the `.vox` writer.
- **Layouts and names** (new per-set setting "Save as", part of every preset):
  - *One sheet, up to 8 pictures a row* (`rifle_isometric.png`): the drawn directions in turn order, 16 directions in 2 rows, 32 in 4.
  - *RPG Maker character sheet* (needs 4 directions): `!$rifle_rpgmaker.png`, 3 × 4 cells, rows facing down, left, right, up, the pose repeated in the three walking columns. `$` makes RPG Maker MV/MZ read the file as one character (3 × 4 frames instead of 8 characters); `!` marks an object (no 6 px lift, no bush effect), which suits models better than characters.
  - *Doom sprite files* (needs 1 or 8 directions): one PNG per drawn rotation in `rifle_doom/`, cropped to the picture, named `RIFLA1.png`, `RIFLA2A8.png`, `RIFLA3A7.png`, `RIFLA4A6.png`, `RIFLA5.png` (with mirroring; without it `A1` to `A8`), or `RIFLA0.png` for 1 direction. The name is the model name's first four letters and digits (leading numbers skipped). Each file carries a `grAb` chunk with its offsets (the middle of the model's base as the sprite's origin), which SLADE, ZDoom and GZDoom read. Doom's rotation 1 is the front and the rotations go round the same way as the set's turns (rotation 3 is the side at 90°), worked out from Doom's own code (`R_ProjectSprite`) and matching the reference imp sheet.
  - A set whose direction count doesn't suit its layout is saved in rows, and the preview's "Saved as" line says so. Two sets with the same preset get a number in their file names (`rifle_isometric2.png`).
- **Presets as data files.** `presets/sprite-sets/*.json` gained `layout` and `fit` (optional: `grid` and `fit`). Sets in older session files get the layout their preset implied (Doom-style → Doom files, RPG Maker → character sheet). **"Save as my preset"** asks for a name and adds the preset to the list; in the browser build it lives in browser storage in the preset file format (`spritePresetFile`), and a set on one of the user's own presets shows "Remove my preset". Changing any value still switches a set to Custom. **In the desktop app (session 7)** the presets folder is read at start-up instead of the bundled copy (sprite sets, inside colours and the Doom palette; a broken file is left out with a message), and "Save as my preset" writes `presets/sprite-sets/my-<name>.json` in the same format. Files whose id starts with `my-` are the user's own: they get the "Remove my preset" button, which deletes that file (and only files inside the presets folder). If the folder can't be written, the preset lasts until the program closes and the message says so.
- **Turntable GIF.** One full turn from the object's front at the chosen camera height, all frames at one scale, with the Pixel-perfect look; one spin takes about 2 seconds whatever the frame count. The GIF writer is hand-written (`gif.ts`: one shared colour table, colour 0 see-through, each frame cleared before the next, looping); frames with more than 255 colours are merged with the same median cut. The preview renders the frames once and loops them.
- **Speed.** A 64 px picture with the odd-angle fix takes a few milliseconds; the 71 PSRC models with an isometric set, a Doom set and a 24-frame 128 px turntable add about 8 s to a browser run.

### Preset numbers checked (session 6, DESIGN open question 1)

Checked against the reference sprites the user collected and what the games are known to use; `test sprites/Game Preset Comparison Results/` holds each preset rendered from PSRC models next to its reference, for judging by eye. `make_comparisons.py` in that folder remakes the sheets through the CLI from the user's session, so they follow the presets as they change (the reference sprites are in its `Real Game Refs/`). It also fills `Render Variations/` there: the sheets drawn from voxels, every Look setting side by side, custom cameras next to the Advance Wars battle sprites, and turntable GIFs.

| Preset | Changed? | Why |
|---|---|---|
| Isometric (4, diagonal, 30°) | No | RollerCoaster Tycoon 2's stalls and SimCity 2000 use the same 2:1 floor, which is a 30° camera (sin 30° = ½) |
| Head-on (4, front, 0°) | No | |
| Side view ¾ (2 mirrored, side, 25°, 16 px) | No | Advance Wars map units are 16 × 16, facing one way (the game flips them), seen slightly from above |
| Inventory icon (1, 35° from the drawing, 30°, 32 px) | No | |
| Doom-style (8 with 3 mirrored, 0°, Doom palette) | Layout | Now saves Doom's own files and names (rotations 1–5, `A2A8`…) with offsets instead of one sheet. 64 px cells suit Doom's scale (the imp is about 56 px tall) |
| RPG Maker (4, 48 px) | Layout, 35° → 30° | MV/MZ's 48 px frames in the `$` single-character 3 × 4 sheet, rows down / left / right / up. The ¾ view of RPG Maker objects is closer to 30° |
| Diablo-style (8, 30°) | No (tooltip) | Diablo II's floor tiles are 160 × 80, the same 2:1 floor; monsters have 8 directions, heroes 16 |
| Battle view (1, 20° from the drawing, 20° up, perspective 40°, 256 px) | New (session 9) | The "+ perspective 40" column of the camera experiment against the Advance Wars 2 battle sprites, picked by the user. Compared at 64 / 128 / 256 before fixing 256 |
| Oblique view (1, the drawing flat-on, oblique 45° up-right, half depth, 256 px) | New (session 9) | Matches how the Advance Wars battle sprites are drawn (flat side, top and front end showing); see "Oblique camera" above |
| Classic RTS (32, 50° → 30°) | Height | Tiberian Sun and Red Alert 2 draw everything over 2:1 tiles (Red Alert 2: 60 × 30), so 30°; their vehicles turn through 32 facings. Rendered next to the reference Rhino tank, 30° matches its view |

Not modelled: each game's own direction order inside a sheet (Diablo II's and the Westwood games' frame orders are specific to their file formats); the rows layout keeps the set's turn order.

## 12. Tech stack (LOCKED)

- **Language and build:** TypeScript + Vite.
- **Preview:** Three.js for the 3D preview. The rendered sprites and the turntable use the core's own software renderer (`src/core/render.ts`, section 11), not Three.js's `RenderPixelatedPass`, so they also run in Node.
- **Booleans:** manifold (`manifold-3d`, WASM) for extrude-and-intersect and the lofts. Its WASM loads in the background at startup (`initMesh`); until it's ready the Model tab shows the voxel surface. The production build bundles the 540 kB WASM file.
- **Hand-written code:** the `.vox` writer, the sheet reader/writer, the PNG encoder/decoder, the surface detail maps (normal, occlusion, trims) and, since session 4, the GLB writer (`src/core/glb.ts`). Three.js's GLB exporter was the plan, but it needs a browser canvas for textures, and the core must also run in Node for the tests and the command-line tool. One mesh, one material and embedded PNGs make a GLB writer about 100 lines. Its files pass the Khronos glTF validator with no errors and import into Godot 4.7.
- **Small helper libraries:** fflate (zlib compression for PNG files, and the zip writer for browser batch downloads), and possibly a mesh simplifier if the smooth-blend path is built. The GIF encoder turned out hand-written too (`src/core/gif.ts`, session 6).
- **Godot preview project (session 4d):** `project.godot` holds no explanatory comments, because the Godot editor rewrites the file (dropping comments) whenever it opens the project; the settings are explained at the top of `main.gd` instead. `godot-preview/` is a ready-to-use Godot 4.7 project (Forward+, GDScript only, no add-ons) that ships with the tool as its own folder, with `model-preview-in-godot-guide.html` for users who have never used Godot. Users download Godot (a zip, no installer), import the folder once and press Play; no exported exe is shipped (decided with the user, session 4d). It loads GLBs at runtime with `GLTFDocument` (about 3.5 ms per model; 497 models in 1.8 s), so there's no editor import step per model, from a folder (sub-folders included, so "One folder per model" on or off), from the zip the browser build downloads (`ZIPReader`), or from dropped `.glb` files. Where models come from: dropped on the window, "Open folder…" (the native folder picker), or the `models/` folder next to it, which wins at start-up when it has models; otherwise the last folder, else the nine `samples/`. Switches per map (normal, AO with Godot's "AO on light", trims, colour only) work on a copy of each material; trims off uses the body's own Metal and Rough, read as the most common values in the trim texture. Lights: Sun, Studio, Shade (sky only), Moving lamp. One model or all side by side (click to open one), orbit camera, turntable. Settings persist in `user://preview.cfg`. The UI uses the Cartridge Night colours and the bundled fonts. Layout: `project.godot`, `main.tscn` + `main.gd` (the whole viewer, built in code), `fonts/`, `samples/`, `models/` and `guide/` (the latter three with `.gdignore`, so the editor doesn't import them).
- **Architecture:** the core is a UI-free library that takes RGBA pixel buffers in and returns files out. A browser UI and a command-line tool (folder in, folder out) both sit on top of it. Since session 7b both go through one export path, `src/core/exports.ts`: `exportModel` makes every ticked export of one ② row as files, from a `ModelParts` (the row's model and what's made from it, each step built on first use). The GUI passes parts backed by the caches its previews share (`partsOf` in `src/ui/models.ts`); the command-line tool uses `modelParts`, which keeps nothing beyond the row.
- **Same bits everywhere (session 7b).** `Math.sin`, `Math.cos`, `Math.atan2` and `Math.pow` with a fractional power are allowed to differ between JavaScript engines, and do: Edge and Node round about 4% of sines and cosines and 17% of `atan2` results differently in the last bit, which changed how a round model's rings triangulated. The core uses its own `sin`, `cos`, `tan` and `atan2` (`src/core/fmath.ts`, the fdlibm kernels in plain + − × ÷, which IEEE arithmetic rounds the same everywhere) and writes out constants like 2^−¼, so the GUI, the command-line tool and future browser or Node versions make byte-identical files. New core code should do the same.
- **Distribution:** develop in the browser, then ship as a Windows exe wrapped with Tauri (a 4.8 MB exe, using the WebView2 that Windows 11 already has; the whole release zip is about 8 MB). No Blender, no Python, no heavy runtime. **Release model (user's decision, session 8):** version 1.0.0, sold on itch.io as a paid program with the source code public on GitHub, under a Commercial License with Source Code Access (`LICENSE.md`: use it, study and modify the code for yourself, but don't redistribute, resell or build it into another commercial product; what people make with it is theirs; the example sprites are CC0). The price is never written into the docs, since it changes with the situation.
- **The desktop app as built (session 7).** Tauri 2 (`src-tauri/`), one 4 MB exe (`Pixel to 3D Batch Builder.exe`, release profile with LTO and size optimisation). It is the same page as the browser build; `src/ui/desktop.ts` is the only module that talks to Tauri, and the UI branches on `isDesktop` where the two differ.
  - **The Rust side is small** (`src-tauri/src/lib.rs`): read a file, write a file (through a temporary file that is then swapped in, so a crash never leaves half a session or sheet; missing folders are made), list a folder, find the presets folder, the autosave path, the command-line arguments, open a folder in Explorer, and watch files. Native dialogs come from the dialog plugin and links from the opener plugin. No fs plugin: the app's own commands need no permission scopes, and it only ever loads its own page. The content security policy is off for the same reason (the mesh library needs WASM, and sessions restore pictures from data URLs).
  - **A release is portable (user's preference, after session 7): unzip and run.** The release folder holds the exe, `presets/`, `examples/`, `guide/`, `godot-preview/` (without Godot's `.godot/` cache), `cli/p3d.mjs` and the docs (README, `CLI.md`, `promo.md`, `promo/`); `build_release.bat` assembles it in `release\Pixel to 3D Batch Builder\` and zips it (session 8). The exe looks for `presets/sprite-sets/` and `examples/` next to itself and up to four folders above it, which is how `npm run desktop` finds the project's own folders; without `presets/` it uses the copy bundled into the page. Everything the program keeps between runs lives in a `settings/` folder next to the exe: the autosave (`settings/autosave.p3d.json`) and WebView2's own data (`settings/webview/`, browser storage such as the light-preview switch, and caches), so the folder can be moved or copied whole. Only when that folder can't be written (the exe in Program Files) does it fall back to `%APPDATA%\com.reactorcore.pixelto3d\`. `npm run desktop:installer` can also make a per-user NSIS installer (it installs `presets/` and `examples/` next to the exe), but the portable zip is the release; the installer would matter mainly for the Microsoft Store, which is not planned.
  - **It feels like a program, not a web page (session 8).** Outside text fields, right-click shows no browser menu, and F5, Ctrl+R, Ctrl+P, Ctrl+F, Ctrl+G, Ctrl+U, Ctrl+J and Ctrl+Shift+I do nothing (WebView2 would reload, print, search or open developer tools). Desktop app only; the browser build keeps them. The same rules as the standard Tauri starter's `initProgramFeel`.
  - **The window opens maximized** (user request after session 7); un-maximized it is 1280 × 800, never smaller than 1024 × 640.
  - **The example session (after session 7).** `examples/` holds `Example sprites/` (the user's PSRC Sheet4Color set, 71 sprites made by the user and given away as public domain), `Example sheets/` (their 71 sheets) and `Example session.p3d.json`, the user's own session with a chosen side, thickness and shape for every sprite, so it shows many ways to set sprites up. On the very first start (no autosave yet, nothing on the command line) the desktop app opens it and says it's an example to learn from, and that Select all + Remove in each tab starts a clean list. That also teaches the app's model of work, which has no New / Close: the list is the workspace. The example isn't tied to its file, so Save asks for a new place rather than overwriting it, and its output folders are empty, so the first run asks where the user's own files go. `node scripts/make-examples.mjs <session>` rebuilds the folder from a session file that embeds its pictures (a browser session), writing every picture out as a file.
  - **Icons** are `branding/icon.ico` and the 32, 128 and 256 px PNGs, used as they are (no `tauri icon` resampling).
  - **Command line (the exe):** the exe takes a session file, or pictures and folders, as arguments ("Open with", or dropped on the exe). The automated checks use this too.
  - **WebView2 does middle-click autoscroll** in the lists by itself, as Edge does, so the "Scroll sideways" pro tip holds without extra code (checked by driving the exe; a custom drag-scroll handler was written and then removed).
  - **Speed** on all 289 test sprites (all five batches) in the exe: ① writes 286 sheets in 9 s; ② exports the 286 models with the default exports (GLB, `.vox`, two sprite sets and the turntable: 2,574 files) in about 150 s, the same rate as the browser. Files are written per model as they are made, so a stopped run keeps what was done.
- **The command-line tool as built (session 7b, `src/cli/`).** `cli/p3d.mjs`, one 1 MB file bundled by `vite.cli.config.ts` (`npm run cli:build`), runs with plain `node` (20 or newer) and needs nothing beside it: manifold's WASM is inside it as base64 (handed to `initMesh(wasmBinary)`), and so is a copy of `presets/`. Like the exe, it prefers a `presets/` folder next to it or up to four folders above it (then next to the working folder), so the user's own presets work. It's written for Claude and scripts, who are expected to use it; people use the GUI. `CLI.md` is its usage doc, with a short "install Node first" section at the top, since Node isn't part of Windows or the program.
  - **Commands:** `run <session>` runs both modes of a GUI session file as its Run buttons would (every row's own settings, the ① → ② hand-off included, into the session's folders or `--out DIR`'s `sheets/` and `models/`; the session file is never changed). `sheets`, `models` and `build` (both steps, no painting) take PNG files and folders (the PNGs directly inside, like Add folder) and an out folder, with flags for the common settings, applied to every row; anything else keeps the GUI's defaults, and `--settings <session>` borrows a session's export settings. `presets` lists the sprite set presets and every code the flags take.
  - **Same rules as the GUI:** sides from file name endings, never overwriting a sheet (`--overwrite` to turn off), ✖ rows skipped with their reason, ⚠ for cut-off paint, sheet names that lost their code (guesses) and skipped `.vox` files. Model exports are written over, as in the desktop app.
  - **Output:** one line per item (✅ / ⚠ / ✖, with the reason and the files written), naming a file as `folder/file` when two inputs share a name, then a summary with counts. Exit code 0 when nothing got a ✖ (⚠ allowed; `--strict` counts them), 1 when something did, 2 for a bad command line, a missing input or a broken session (checked before anything is written). `--quiet` prints only ⚠ / ✖ lines and the summary.
  - **Checked against the GUI:** `tests/cli.test.ts` runs two sessions with every export ticked and compares every file with the hashes of the same runs made in the browser build (`tests/fixtures/gui-run-hashes.json`, 1,846 files). Speed: all five test batches (289 sprites) through `p3d build` with the default exports in 67 s.
  - **Shipping:** the release folder gets `cli/p3d.mjs` and `CLI.md` beside the exe (author's decision after session 7: ship it, with the Node note).
- **The UI started as the mockup (sessions 1–7).** The Tauri window is a WebView2 page, the same Chromium engine the mockup was built and tested in, so the mockup's HTML and CSS carried over as the real UI, not just as a picture of it.
  - `mockup/index.html` and `style.css` are ported as they are.
  - The mockup scripts become TypeScript modules: the table/selection/mass-edit logic, tooltips, dialogs and export panel stay.
  - The fake parts are replaced: hand-typed sprites become real PNG loading, the naive edge scan becomes the core library's sheet writer, and the isometric voxel painter and preview renderer become Three.js views.
  - File and folder pickers become Tauri dialogs.
  - The fonts are bundled locally instead of loaded from Google Fonts.
  - The mockup's scripts are already split along these lines:
    - `data.js`: helpers, sample sprites, word lists.
    - `presets.js`: sprite set presets and inside-style colours; the tweakable defaults, which become the preset data files.
    - `engine.js`: the fake engine, to be thrown away.
    - `ui-core.js`, `ui-preview.js`, `ui-exports.js`, `ui-shell.js`: the UI, to be ported.

    They are plain scripts sharing one global scope, because ES modules don't load from a double-clicked file.

## 13. UI notes

- **Two clearly separated modes, shown as numbered tabs:**
  - **① Sprites → Sheets**
  - **② Sheets → Models**

  Other names considered: "Sprites To Slabs" (but Phase 1 outputs a sheet, and the cross-section shape means it's often not a slab), "Unfold / Build".
- **The mockup (history only, kept outside the repo in `old wip/mockup/`):** `mockup/index.html` (static, clickable) was the reference for layout, wording and tooltips while the app was built (sessions 1–7), and `mockup/UX-NOTES.md` records the reasoning behind it. The app has moved well past it since, so the real app is now the reference; the mockup is kept as a record, not a spec.
- **Session files (LOCKED): one file for both modes.**
  - A single JSON session file holds:
    - both file lists (paths relative to the session file)
    - every row's settings in both modes
    - both output folders
    - the export checkbox selections and their advanced settings, including sprite sets
  - The two modes stay separate pipelines inside it. One file per mode was rejected because Phase 2 usually works on the sheets Phase 1 made, so two files per project would be extra bookkeeping.
  - The app also autosaves the current session, so an interrupted session can be recovered instead of re-entering everything.
  - Session files end in `.p3d.json`. A file that is damaged or hand-edited still loads: unknown or out-of-range values fall back to their defaults, and only a file that isn't a session at all (or comes from a newer version) is refused.
  - **Browser build only:** the browser can't reopen files by path, so each picture is also embedded in the session file as a small PNG, and autosave goes to browser storage. The desktop app uses real relative paths and autosaves to disk.
  - **Desktop app as built (session 7).** Saving asks where (starting at the current session file) and writes every path relative to the session file's folder, output folders included; pictures read from a file on disk are stored by path only. A picture that isn't a file on disk (a browser session opened in the desktop app, whose paths are bare names) is still embedded, so nothing is lost; when a session opens, each picture is read from its path first and from the embedded copy if the file can't be found. Rows whose picture can't be found either way are left out and counted in the message. Autosave writes the session with full paths, plus which session file it belongs to, to `settings/autosave.p3d.json` next to the exe (section 12) 1.5 s after a change and again when the window closes; on start the app picks it up ("Picked up where you left off"). That is the crash recovery: after a hard kill the app came back with every row (checked with 289 + 572 rows).
- **Output folders (LOCKED):** one per mode, stored in the session. Phase 1 has "never overwrite a painted sheet" (default on) and "also add finished sheets to ②" (default on). Phase 2 has "one folder per model".
  - **Desktop app as built (session 7).** Change picks a folder with the native dialog. A mode without a folder shows "Not picked yet" and asks for one on its first run (starting in the folder of the first picture); cancelling cancels the run. Long paths show their last two folders (`…\out\sheets`), the whole path is in the tooltip. ① lists the folder first, so "never overwrite" compares against the sheets really there (a second run of 286 sheets gave 286 `_2` / `_3` names and touched nothing). Sheets are written into the folder and, with "also add to ②", put in ② by their real path, so they are watched. ② writes every export into its folder (sub-folders per model as before); existing exports are replaced, since only sheets hold painting work. Both runs end with an "Open the folder" button. The browser-only "Download the sheets as a zip" switch is hidden.
  - **File watching (desktop app, session 7).** Every picture a row uses that came from disk is watched, in ① and ② alike (so a sprite edited in the art app updates its sheet preview too). The app watches the files' folders, not the files, because many art apps save by writing a new file and renaming it over the old one. Events are gathered for 350 ms, then each changed file is read again; a file that can't be decoded yet (still being written) is tried once more 700 ms later. Rows showing it get the new picture and keep their settings, and a toast names the file. A file saved with the same pixels changes nothing. The ② Reload button reads every sheet again and says how many had changed.
- **Top bar:** the two mode tabs, Add files, Add folder, Save session, Load session, ❔ (the user guide, session 8), and one big run button whose label says what it will do and how many items it covers ("Make 11 sheets" / "Export 9 models"). Rows with errors are left out of the count and skipped.
- **Spreadsheet-style list** with file-explorer selection (click, shift-click range, ctrl-click toggle, Ctrl+A, arrow keys, Esc, Delete).
  - **Mass edit:** changing a control on any selected row changes every selected row. A banner ("4 rows selected — anything you change on one of them changes all of them") makes this obvious, and a toast plus a row flash confirm each change. Clicking into a control on an unselected row selects just that row, as a file explorer does.
  - **Status column:** ✓ ready, ⚠ with a count of cut-off pixels, ? for guessed settings, ✖ for errors. The tooltip explains the problem and the fix. Phase 1 errors are a sprite over 128 × 128, a model over 128 on any axis, and a picture with no pixel at least half opaque.
  - **Adding files:** Add folder (and dropping a folder) adds the PNGs directly inside that folder, not those in sub-folders, so a sheets folder kept inside the sprites folder isn't pulled in. Files already in the list are skipped. After adding, only the first new row is selected, so the next edit doesn't change the whole batch by surprise.
  - **Tags** show where a value came from: from the filename, changed from the filename, or guessed.
- **Preview panel** for the selected row:
  - Phase 1: the sheet (fit or 1:1), with optional panel-name labels drawn as an overlay (never into the file), the sprite's own panel marked ★, and a "How to paint a sheet" guide.
  - **Sheet preview zoom (after session 4c, user feedback).** Fit used to round its scale down to a whole number and never go below 1×, so big sheets spilled out of the box and medium ones sat small in it. Now Fit uses the exact scale, below 1× too, so every sheet fills the box the same way. The canvas holds the sheet at its real size and CSS scales it (pixelated), so an in-between scale can make some sheet pixels one screen pixel wider than others; zooming costs no memory. The header reads Fit | − | 1:1 | +: the middle button shows the zoom (1:1, 2×, 4×…) and resets to real size, and the steps are 1, 2, 3, 4, 6, 8, 12, 16, 24 and 32×. Zooming out of a zoom bigger than Fit lands on Fit first. The mouse wheel over the sheet zooms around the cursor (from Fit too), and when zoomed the sheet can be dragged around or scrolled. The side labels are HTML over the canvas, so they stay sharp and the same size at any zoom. The user found the wheel zooming in Fit fine, not annoying.
  - Phase 2: Model / Voxels / Sheet check views, eighth-turn rotation with a camera from above or below (quarter turns until after session 6), a light background, and the Peel slider in the voxel view (section 8).
  - **Light background (after session 6, user feedback).** Some sheets use dark paint that is hard to see on the dark preview. A "Light" switch in the preview's tool row, shared by Model, Voxels and Sheet check, swaps the stage to a soft, almost-white grey tinted towards the plum: `#d8d4e4` with `#cbc6da` as the second checker tone in Sheet check, and a radial gradient between the two (from `#e2deec`) behind the 3D views. It is never pure white. On the light background the floor plate and grid turn plum and stronger so they still read, the split plane's dashed edge turns a deeper blue (`#1a7fd0`), and the watermark and the "no model" message use darker text. The red cut-off marks need no change. The choice is a view preference, not part of the session: it is kept in browser storage (`p3d.lightPreview`, every read and write wrapped in try/catch, so blocked storage just means it starts dark).
  - **Eighth turns (after session 6, user feedback).** The ⟲ ⟳ buttons turn the model 45° per click, 8 positions, in Model and Voxels. The even positions are the old corner-on views; the odd ones look straight at a side, still from 30° up, so only that side and the top (or bottom) show. Shading is fixed to the camera as before: a side seen straight on gets the left face's tone in Voxels and the in-between tone of a slanted face in Model. The camera is fitted to whichever of the 8 turns needs the most room, so the model keeps its size while it's turned instead of growing at every straight-on step; the corner views of long, thin models come out a little smaller than before as a result. Peel "Front" cuts the side at the viewer's lower left at the corner views and the side facing the viewer at the straight-on views. Seen straight on, a split plane that runs towards the viewer is edge-on and shows as its dashed line only, which still marks where it is. The cut-off ghost cubes show only their faces turned to the camera, so at the straight-on views they draw as one square plus the top.
  - **Camera from below (after session 6, user feedback).** An Above | Below switch next to the turn buttons moves the camera to 30° under the model, looking up at the same angle the high view looks down; all 8 turns work from both heights, so there are 16 views. The model is not flipped: it stays lit from above, so its bottom is darker than the sides (a mid tone, 0.74, instead of the 0.55 shadow tone it would get facing away), and the floor plate and grid are hidden while the camera is low, since they would sit between the camera and the model. In Voxels the Peel "Top" button becomes "Bottom" from below and slices from the side the camera looks at. Switching heights or turning only redraws; the model is built once. The turn and the camera height are not saved in the session.
  - **Sheet check zoom (after session 4b, user feedback).** Sheet check used to draw the sheet at whole-number scales of at least 1×, so a big sheet (box 64 or 128) ran off the bottom of the stage with no way to see the rest. It now zooms exactly like the ① sheet preview (same code, `src/ui/zoom.ts`): Fit at any exact scale, 1:1 to 32× steps, wheel zoom around the cursor and drag to pan. Sheet check has nothing to turn, so its Fit | − | 1:1 | + buttons take the place of the turn buttons. The red cut-off marks are drawn on a canvas of up to 6 pixels per sheet pixel, so they keep their white edge when zoomed in.
  - **As built (session 3):** Model and Voxels are drawn with Three.js from the same camera as the mockup (front-right, 30° up) with flat shading tied to the camera, so a quarter turn never darkens the model. Voxel outlines appear once a voxel is at least 3.5 px on screen. Peel "Front" cuts from whichever side faces the viewer's lower left after turning (see eighth turns above for the straight-on views). The export previews are drawn a moment after the main preview so clicking through the list stays quick. Since session 5 the sides, stack and palette previews show the real export, and since session 6 the sprite set and turntable previews too (the placeholder engine is gone).
  - **As built (session 4):** the Model tab shows the textured low-poly mesh, exactly what the GLB holds. Its shading is the same camera-fixed look, blended by the face's direction so slanted faces fall between the top, left and right tones; Unlit rows are drawn unshaded, and the surface detail settings show in it (section 10). The "placeholder render" mark only shows while the mesh library is still loading. The facts panel gives the real triangle count and texture size.
  - **Browser build only:** a sheet can't be re-read from disk, so dropping a saved sheet on the window again replaces that row's picture (same path) and keeps its settings. The desktop app watches the files instead (section 2).
  - **Cut-off paint** is shown at three levels: the count in the list, a callout with a "Show me" link, and red markers (ghost cubes in 3D, blinking pixels in Sheet check).
- **Sideways scrolling in the lists (after session 4b, user feedback).** Both lists show "Scroll sideways for more settings →" in their footer while the table is wider than the list; its tooltip is a pro tip: hold the middle mouse button over the list and move left or right (or Shift + wheel). The list box is only as tall as its rows, so the sideways scrollbar sits right under the last row, and the scrollbar has a visible track and a lighter thumb. Only the left mouse button selects rows, so a middle click never changes the selection. (The ① list had gained enough columns with Ends to need scrolling at 1280 wide, and its dim scrollbar at the very bottom of the empty list went unnoticed.)
- **Per-row advanced settings are ② columns (LOCKED, changed after session 4).** The mockup put them in a Fine-tuning card under the preview. In use that meant scrolling the preview out of view to reach a slider, and the settings didn't sit with the rest of the batch. So they are now columns like every other row setting, with the same mass edit, and the preview stays in view: Round sides and Straighten slopes after Shape; Metal and Rough after Material; Inside colours (three swatches and ↺), Noise, Pattern and Hollow core (session 5) after Inside. A cell is greyed out where its setting does nothing: Round sides for shapes that aren't round, Metal and Rough for Unlit, the inside colours, noise and pattern for "Like the outside" and Hollow. The table is longer, which is fine: it scrolls sideways with the thumbnail and file name frozen.
- **Plain-language labels:** "Thickness" (depth), "Sprite shows…" (input side), "Box" (cube size N), "Gap colour" (colour fallback), "Inside" (interior preset), "Pivot point" (origin), "Bumpy surface" (normal map), "Flat (ortho)" / "Perspective" (camera). The technical term goes in the tooltip where it helps.
- Big buttons, tooltips on every control, plain language, colourful identity.
- **Screen sizes (LOCKED):** designed for 1280×720 and up, and supports 4:3 down to 1024×768.
  - Below 1280px wide, the top bar's Add buttons become icon-only (their tooltips keep the words), and the status bar shows a shorter selection hint.
  - The ① preview column narrows, and the sprite table scrolls sideways with the thumbnail and filename columns frozen.
  - In ②, Preview and Exports share one right-hand column with a Preview / Exports switch in its header.
- **Native controls** (dropdown lists, colour pickers, scrollbars) are drawn in dark mode (`color-scheme: dark`) so they match the theme.
- **Number fields use the app's own ▴/▾ spin buttons**, not the browser's. Edge on Windows draws its native arrows its own way and ignores styling, so they hugged the digits. The custom buttons always leave a gap, match the theme, repeat when held, and work with mass edit. The keyboard arrows and mouse wheel still work.
- **Branding:** a subtle "Made by Reactorcore" link sits at the right end of the status bar.
- **Guides (session 8).** Two plain HTML pages in `public/guide/`, in the app's colours and with their own copy of Nunito, so the folder works on its own: `user-guide.html` (quick start, what's in the folder, both steps, shapes, thickness and box size with the voxel canvas size guide from the original idea doc, exports, sessions, the Godot preview, the command line, troubleshooting) and `paint-a-sheet.html` (sections 4 and 5 illustrated). The ❔ button in the top bar opens the user guide and "How to paint a sheet" under the ① preview the painting guide, in the system browser, where there's room to read: the desktop app finds them in `guide/` next to the exe (`guide_path` in `lib.rs`, plain `.html` names only), the browser build opens them from its own server. Screenshots in `public/guide/img/` are taken from the browser build with the example session's sprites.

### Logo and icon (LOCKED)

The logo is the 16×16 pixel cube from the top bar (yellow top, tangerine left, lime right), next to "Pixel to 3D" in Pixelify Sans with "Batch Builder" underneath. All files live in `branding/` and are regenerated by `node branding/make-icons.mjs` (no dependencies):

- `icon.ico` (16 to 256px) for the Windows exe, and `favicon.ico` (16/32/48).
- `icon-16.png` to `icon-1024.png`, all exact integer scales of the 16px original, so they stay pixel-sharp.
- `icon.svg` / `logo-mark.svg`: vector versions with and without the 1px dark outline.
- `logo-lockup.png` (transparent, outlined text) and `logo-lockup-dark.png`, rendered from `logo-lockup.html`.
- `promo tools/icon_og_placeholder.png`: the 1024px icon, as a plain placeholder. The real cover art is `promo/icon_og_main.png` (composed by `promo tools/make_icon_og.py` from CLI renders) with `promo/icon_og_alt.jpg` as the alternative; `promo/` is the folder that ships in the release.

The icon versions add a 1px midnight-grape outline so the cube reads on light taskbars and browser tabs. They also fill the three see-through "crease" pixels between the top and right faces, which look like stray dots at large sizes. For Tauri, use the provided `icon.ico` and PNGs directly rather than letting `tauri icon` resample the art, because its smooth scaling blurs pixel art at non-integer sizes.

### Colour scheme: "Cartridge Night" (LOCKED)

A deep grape base frames pixel art the way a CRT bezel does. Each accent has exactly one job, so colour itself teaches the UI.

| Role | Name | Hex |
|---|---|---|
| App background (faint dot grid) | Midnight grape | `#171327` |
| Panels | Cartridge plum | `#262043` |
| Buttons, chips | Plum highlight | `#3b3163` |
| Main text | Moonlight | `#f5f0ff` |
| Secondary text | Lavender mist | `#b9aee0` |
| Mode ① Sprites → Sheets | Tangerine | `#ff9a3c` |
| Mode ② Sheets → Models | Lime pop | `#8fdc4a` |
| The one "go" button | Sunshine | `#ffd23f` |
| Selected rows, mass-edit banner | Periwinkle | `#7c6cff` |
| Info, box sizes, split planes | Sky | `#4db8ff` |
| OK | Mint | `#52e3a4` |
| Warnings (cut-off paint) | Amber | `#ffb020` |
| Errors, cut-off pixel highlight | Cherry | `#ff4d6d` |
| Tooltips (dark text on cream) | Tooltip cream | `#fffbe8` |

Fonts: **Pixelify Sans** for headings and numbers, **Nunito** for everything else. Both are bundled so the app works offline. The sheet frame colours (section 4) are never used in the UI.

## 14. Testing

- **Main test set:** `test sprites/PSRC Starter Pack Sprites/` (71 sprites, the same as `examples/Example sprites/`), the most general mix of objects. Use it first when testing the real program.
- `test sprites/untitled.p3d.json` is the user's session for that set, with the per-row settings they tuned; `test sprites/Stress Test Shapes 128px/` holds the 128 × 128 stress shapes.
- The other batches (OMA, JAGER, STARBOUND, NOITA, and the PSRC Sheet3Color / Sheet6Color sets) cover more specific cases: weapons with outlines, several sizes, and tiny sprites. They are kept outside the repo in `old wip/`, since some are other games' sprites.
- The mockup's own hand-typed sprites are only for the mockup.

## 15. Open questions (summary)

- **Section 11 (planned for session 9): an Oblique camera type and two Advance Wars battle-sprite presets.** A perspective single-picture preset (turned 20° from the drawing, 20° up, 40° field of view, 256 px by default) and an Oblique one: a shear projection where the drawn side stays flat-on with level lines level and the depth recedes at an angle, as in Advance Wars' battle sprites, which no camera rotation can give. Angle, depth scale and direction still to decide; details in `checklist-todo.md`, session 9.

- **Section 8: should the voxel colours keep the input side's paint off voxels that face away from it?** The surface colour rule gives the input side every voxel it sees, so its drawing's rim wraps onto the sides in the Voxels view and the `.vox` file (the dark spot on the football's left side, user report after session 6). The mesh texture already avoids this (section 7). For voxels, the same 60° test loses part of the drawing seen straight on, because the rim voxels show in both pictures: on the PSRC session, 19 of 71 models fall under 90% of their drawing (the mean falls from 98.6% to 91.5%), mostly small round ones. At 20° the loss is small (97.9%, 2 models under 90%) but most of the smear stays. Left as it is until the user decides.

Resolved so far:

- **Section 2:** Phase 1 and Phase 2 are fully separate pipelines.
- **Section 4:**
  - 2×3 grid layout
  - cube canvas: N×N panels, N rounded up to a standard voxel size
  - viewer-relative side naming
  - 3px edge/core/edge frame gutters with a collision guard
  - no upscaled sheets
- **Section 8:** 11 interior presets.
- **Section 11:**
  - origin option for GLB export
  - sprite set presets with an ortho/perspective toggle
  - pixel-clean rendering pipeline
- **Section 5:**
  - split planes + blending adopted
  - user-selectable colour fallback
- **Section 6:** stepped slice prisms for cross-section shapes.
- **Section 13:**
  - mode names "Sprites → Sheets" / "Sheets → Models"
  - one JSON session file for both modes, with autosave
  - output folders, overwrite guard and ① → ② hand-off
  - all Phase 2 columns stay visible
  - per-row advanced settings (first a Fine-tuning card, now ② columns)
  - colour scheme "Cartridge Night"
- **Section 3:**
  - sprite-relative shape axes (`W` / `H` / `T` codes)
  - side codes `F / Bk / L / R / T / Bt`
  - outlined-sprite edge scan
- **Section 4:**
  - cube size read from the image size, filename as cross-check
  - tiered 7px legend
  - jade edge / violet core frame colours
- **Section 8:** peel preview for interiors.
- **Section 11:**
  - rendered sprite sets replace the directional and isometric exports
  - turntable camera-height slider with recommended quick picks (−15° / 0° / +15°)
  - custom first-view angle, tilt, turns from the object's front or your drawing, and an Inventory icon preset
- **Section 13:** 4:3 support down to 1024×768.
  - material and interior are row settings, not export options
  - live export previews
- **Section 4:** user-selectable frame colours (jade + violet default, one colour, grey + magenta, custom).
- **Section 13:** logo and icon files in `branding/`.
- **Section 3:** how the cross-section shape shapes the Phase 1 sheet (the all-round shapes are the ↔ and ↕ cuts together; only the ⊙ shapes cut the sprite's outline).
- **Section 4:** panel contents, collision guard numbers, never-overwrite numbering.
- **Section 3 (session 3):** a cut never empties a line of a piece's box; Phase 1 checks its sheet against Phase 2's carving, so unedited sheets never lose paint.
- **Section 4 (session 3):** reader details (standard sizes only, likely-cause messages, the picture wins over the file name).
- **Section 5 (session 3):** what the split numbers mean (Left's share from the left, Top's share from the top, Front's share from the front, on the painted bounds).
- **Section 8 (session 3):** "visible from" and "most exposed" made exact; gap colour fallbacks; local thickness for Flesh & bone.
- **Section 3 (after session 3):** an Ends setting for Tube and Diamond (`cF` / `cL` / `cB`) instead of 18 new shapes.
- **Section 8 (after session 3):** Hollow core for every inside style.
- **Section 5 (session 4):** stepped blending built (one morphed terrace per layer, shared by voxels and mesh); Smooth still open as a stretch goal.
- **Section 6 (session 4):** pixel-art aware ramp straightening; lofted slice prisms instead of stepping every slice (the "verify in prototype" outcome); runs limited to the painted bounds.
- **Section 7 (session 4):** atlas packing, gap-filled crops, one panel per face.
- **Section 7 (after session 6):** the texture is painted from the voxel model's surface colours, with the input side's paint kept to the surface within 60° of it; one panel per flat face; texels beside the model take the nearest colour by distance; faces standing in front of others on the same lines get their own crop.
- **Section 10 (session 4):** the normal map stays as an optional beta, off by default; reworked into bevelled colour patches with a Bump strength setting.
- **Section 10 (session 4c):** six bump styles, Grit, crevice shadows (AO map or painted in) and shiny trims (metallic-roughness texture). Default style Chiselled at strength 5; no longer beta.
- **Section 12 (session 4):** a hand-written GLB writer instead of Three.js's exporter. GLB checks use Godot, the Khronos validator and three.js; Blender isn't needed.
- **Section 6 (after session 4):** corner bridges for diagonal pixels; rounding reaches in by at most half the short side.
- **Section 13 (after session 4):** the Fine-tuning card became ② columns.
- **Section 3 (session 4b):** Ends for Tube and Diamond built: the end cut comes after the shape's own cut, caps are per piece and one radius long, the shaped end's panel folds the drawing instead of wrapping it like Egg, and the mesh shrinks the tube's rings towards the end instead of adding end prisms.
- **Section 8 (session 5):** `.vox` writer built (version 150, Z-up turn, 255-colour palette with up to 32 inside slots, "skip" only when the painted colours don't fit); Hollow core built as a ② column.
- **Section 11 (session 5):** side pictures cropped to the model's box, stack layers seen from the way the stack grows, palette = surface colours; the batch runner writes every built export into one zip.
- **Section 11 (after session 6):** "Draw from" the low-poly or the voxel model, per set and for the turntable.
- **Section 11 (session 6):** preset numbers checked against real games (RPG Maker 30°, Classic RTS 30°, Doom and RPG Maker layouts); rendered sprites drawn by a software rasterizer in the core instead of `RenderPixelatedPass`; Model size and Save as settings per set; user presets in browser storage.
- **Section 4 (after session 6):** the round and diamond shapes' inferred panels fold the drawing (split down the middle and mirrored, like a view from a quarter turn away) instead of wrapping the whole run onto the panel.
- **Section 3 / 4 (after session 6):** a Copy sides checkbox in ① brings back the wrap as a choice, for every shape.
- **Section 6 (after session 6):** 1px rounded-corner steps are chamfered at tolerances of 0.71px and up.
- **Section 6 (after session 6):** Soft box, Egg and Gem meshes are lofted along ↕ only, which removes the shards at a ball's corners; lofts follow profiles traced with the outline rules, and Egg's profile corners are rounded by Round sides.
- **Section 12 (session 7):** the desktop app is Tauri 2 with a handful of its own Rust commands (no fs plugin); a release is the exe plus `presets/` beside it, with an optional NSIS installer; WebView2's own middle-click autoscroll covers the lists.
- **Section 13 (session 7):** desktop session files store paths relative to the session file and embed only pictures that aren't files on disk; autosave to `settings/` next to the exe (the app's data folder only as a fallback); output folders asked for on the first run; loaded pictures watched in both modes.
- **Section 12 (session 7b):** the command-line tool (`p3d`: run, sheets, models, build, presets) as one bundled Node file that ships in the release with `CLI.md`; one export path in the core shared with the GUI; engine-independent trig in the core so both make byte-identical files.
- **Section 3 / 5 / 6 (session 7c):** Egg, Gem and the ⊙ shaped ends follow each pixel's distance from the outline, which Phase 2 reads back exactly (closes "Egg and Gem thin out on uneven outlines"); a ⊙ cut no longer keeps a pixel in every emptied row and column (closes "⊙ shapes leave loose rods"); the mesh keeps the loft where its rings fit and traces the rule's surface where they don't (rings).
- **Section 12 (session 4d):** a Godot preview project ships as its own folder (project only, no exe; models dropped, picked or put in `models/`); differences from the Model preview written up in section 10.

## 16. Remaining TODO (carried from the original doc)

All three were done in session 8: the release followed `RC prompt to make releases easier.md` (user guide as HTML, `promo.md`, readme, promo images, `build_release.bat` and the zip); the plan was sanity-checked end to end (this file's stale parts fixed; the open questions left are in section 15); the voxel canvas size guide from the original doc is part of the user guide ("Thickness and box size").
