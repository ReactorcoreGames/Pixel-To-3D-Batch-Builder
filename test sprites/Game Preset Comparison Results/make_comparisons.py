"""Makes the comparison sheets in this folder: each sprite set preset rendered from PSRC models, under the real game
sprites it imitates, for judging the presets by eye. Also fills `Render Variations/` beside it with the same models
drawn in other ways.

In this folder, one sheet per preset, `<preset> vs <game>.png`: the game's reference sprites (in `Real Game Refs/`,
from The Spriters Resource) side by side on top, then one row per model (the whole sprite set the preset makes for it).

In `Render Variations/`:
  - `<preset> vs <game> (voxels).png`: the same sheets drawn from the voxel model instead of the low-poly mesh
  - `look settings.png`: a few models under every Look setting of ② (outline, lighting, colour fix, palette snap)
  - `camera angles vs Advance Wars 2 battle sprites.png`: custom single-picture cameras (turn, height, perspective,
    oblique) next to the Advance Wars battle sprites, for trying how close a 3D camera gets to that look (the
    "+ perspective 40" column became the Battle view preset, "oblique 45, half" the Oblique view preset)
  - `turntables/`: a turntable GIF of a few models, from the mesh and from the voxels

The models are rendered by the command-line tool from the user's GUI session (`test sprites/untitled.p3d.json`), so
every model keeps the settings set up there (round sides, straighten, shapes, ends ...), and the sprite sets are the
presets in `presets/sprite-sets/` as they are now.

Needs Python with Pillow, and the tool built first (`npm run cli:build`). Run from anywhere:
    python "test sprites/Game Preset Comparison Results/make_comparisons.py"                  everything
    python "test sprites/Game Preset Comparison Results/make_comparisons.py" doom isometric   only these presets' sheets
    python "test sprites/Game Preset Comparison Results/make_comparisons.py" --no-variations  only the preset sheets
Options: --refs <folder>, --out <folder> (default: this folder; the variations go in its `Render Variations/`)."""
import argparse
import json
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
SESSION = ROOT / "test sprites/untitled.p3d.json"
CLI = ROOT / "cli/p3d.mjs"
PRESETS = ROOT / "presets/sprite-sets"
REFS = HERE / "Real Game Refs"
VARIATIONS = "Render Variations"

BG = (38, 32, 67, 255)
GAP = 8
TEXT = (230, 226, 245)

# preset file: (game, reference sprites, scale of the reference, scale of the renders, PSRC model numbers)
CASES = {
    "isometric": ("RollerCoaster Tycoon 2", [
        "Isometric_RollerCoaster Tycoon 2 - Stalls - Cookie Shop.png",
        "Isometric_RollerCoaster Tycoon 2 - Stalls - Drinks Stall.png",
        "Isometric_RollerCoaster Tycoon 2 - Stalls - Pizza Stall.png",
        "Isometric_RollerCoaster Tycoon 2 - Gentle Rides - Maze.png",
    ], 2, 2, [2, 4, 27, 28, 1, 21, 66, 59]),
    "doom": ("Doom II", ["Doom II FPS imp character.png"], 2, 2, [2, 27, 65, 3, 17, 42, 21, 28]),
    "sideview": ("Advance Wars 2 map units", ["Advance Wars 2 Map Units red only.png"], 2, 4, [4, 59, 65, 2, 28, 43, 60]),
    "rpgmaker": ("RPG Maker 2003", ["RPG Maker 2003 Style - The Legend of Zelda Customs - Link.png"], 2, 2, [2, 4, 34, 28, 21, 42]),
    "diablo": ("Diablo 2", [
        "PC _ Computer - Diablo 2 _ Diablo 2_ Lord of Destruction - Objects - Blood Vassel.png",
        "PC _ Computer - Diablo 2 _ Diablo 2_ Lord of Destruction - Objects - Fireplace 10.png",
        "PC _ Computer - Diablo 2 _ Diablo 2_ Lord of Destruction - Act 5 Tiles - Baal's Temple Floor.png",
        "PC _ Computer - Diablo 2 _ Diablo 2_ Lord of Destruction - Non-Playable Characters - Meshif.png",
    ], 2, 2, [27, 2, 34, 28, 1, 42, 18]),
    "rts": ("Red Alert 2", [
        "RTS_RA2_Rhino_Tank_img.png",
        "RTS_RA2_Apocalypse_Tank_img.png",
        "RTS_RA2_Flak_Track_img.png",
        "RTS_CNCRA2_IFV_Default_img.png",
        "RTS_CNCRA2YR_Lasher_Light_Tank_img.png",
        "RTS_RA2 building placeholder.png",
    ], 2, 2, [4, 59, 28, 66, 3, 54]),
    "headon": ("RollerCoaster Tycoon mugshots", ["HeadOn Literally RollerCoaster Tycoon - Miscellaneous - Guest Mugshots.png"], 2, 2, [2, 27, 65, 10, 29, 56]),
    "icon": ("Advance Wars 2 battle sprites", ["Advance Wars 2 Battlesprites red only.png"], 3, 3, [2, 34, 45, 59, 30, 17, 43, 64]),
    # the battle-sprite presets are 256 px pictures, so the references are scaled up to roughly their size
    "battle": ("Advance Wars 2 battle sprites", ["Advance Wars 2 Battlesprites red only.png"], 3, 1, [59, 60, 64, 28, 54, 43, 66, 3]),
    "oblique": ("Advance Wars 2 battle sprites", ["Advance Wars 2 Battlesprites red only.png"], 3, 1, [59, 60, 64, 28, 54, 43, 66, 3]),
}
# a band of reference sprites wider than this (in pixels, after scaling) wraps onto a second line
MAX_REF_ROW = 1600

# look settings.png: the first frame of the isometric set, for these models, under each of these Look settings
LOOK_MODELS = [1, 2, 10, 28, 42, 56, 59, 21]
LOOK_DEFAULT = {"outline": True, "light": "3", "snap": "model", "fix": "auto"}
LOOK_VARIANTS = [
    ("default", {}),
    ("no outline", {"outline": False}),
    ("light: flat", {"light": "flat"}),
    ("light: 2 bands", {"light": "2"}),
    ("light: 4 bands", {"light": "4"}),
    ("fix: never", {"fix": "never"}),
    ("fix: always", {"fix": "always"}),
    ("snap: off", {"snap": "off"}),
]

# camera angles sheet: one picture per model from each camera, turned from the drawn side ("ref": "drawing")
CAMERA_MODELS = [59, 60, 64, 28, 54, 43, 66, 3]
CAMERA_BASE = {"preset": "custom", "dirs": 1, "start": "custom", "ref": "drawing", "tilt": 0, "cell": 48, "mirror": False,
               "pal": "No limit", "layout": "grid", "fit": "fit", "from": "mesh", "open": False}
CAMERA_VARIANTS = [
    ("icon preset", None),
    ("turn 20, up 20", {"yaw": 20, "elev": 20, "cam": "ortho", "fov": 40}),
    ("+ perspective 40", {"yaw": 20, "elev": 20, "cam": "persp", "fov": 40}),
    ("+ perspective 70", {"yaw": 20, "elev": 20, "cam": "persp", "fov": 70}),
    ("turn 25, up 25, persp 90", {"yaw": 25, "elev": 25, "cam": "persp", "fov": 90}),
    # oblique: the drawn side flat-on, the depth slanting up and right (the Oblique view preset is 45°, half depth)
    ("oblique 2:1, half", {"yaw": 0, "elev": 0, "cam": "oblique", "oangle": 26.57, "odepth": 50, "oside": "right"}),
    ("oblique 45, half", {"yaw": 0, "elev": 0, "cam": "oblique", "oangle": 45, "odepth": 50, "oside": "right"}),
    ("oblique 45, full", {"yaw": 0, "elev": 0, "cam": "oblique", "oangle": 45, "odepth": 100, "oside": "right"}),
]

TURNTABLE_MODELS = [2, 10, 28, 42, 43, 59, 21, 66]
TURNTABLE = {"elev": 15, "frames": 24, "size": 128}


def preset_json(file: str) -> dict:
    return json.loads((PRESETS / f"{file}.json").read_text(encoding="utf8"))


def set_from_preset(p: dict, draw_from: str) -> dict:
    """A session's sprite set made from a preset, as the GUI does (`setFromPreset`): its id plus its settings."""
    meta = ("order", "id", "name", "file", "sub", "tip")
    return {"preset": p["id"], **{k: v for k, v in p.items() if k not in meta}, "from": draw_from, "open": False}


def render(numbers, setup, tmp: Path, tag: str) -> Path:
    """Runs the tool on the session's sheets for these models, with every export off until `setup(exports)` turns
    some on. Returns the models folder (one folder per model)."""
    sess = json.loads(SESSION.read_text(encoding="utf8"))
    sess["sheets"]["rows"] = [r for r in sess["sheets"]["rows"] if int(Path(r["path"]).name.split(" ")[0]) in set(numbers)]
    for e in sess["exports"].values():
        if isinstance(e, dict) and "on" in e:
            e["on"] = False
    sess["sheets"]["folderPerModel"] = True
    setup(sess["exports"])
    f = tmp / f"{tag}.p3d.json"
    f.write_text(json.dumps(sess), encoding="utf8")
    out = tmp / tag
    r = subprocess.run(["node", str(CLI), "run", str(f), "--only", "models", "--out", str(out)], capture_output=True, text=True, encoding="utf8")
    if r.returncode != 0:
        sys.exit(f"The tool failed:\n{r.stdout}\n{r.stderr}")
    return out / "models"


def sprite_sets(sets: list[dict], look: dict | None = None):
    def setup(e):
        e["sprites"]["on"] = True
        e["sprites"]["sets"] = sets
        if look is not None:
            e["look"] = look
    return setup


def model_folder(models: Path, number: int) -> Path:
    return next(d for d in models.iterdir() if d.is_dir() and d.name.startswith(f"{number:02d} - "))


def model_picture(models: Path, number: int, part: str, cell: int) -> Image.Image:
    """The whole sprite set one model got (`part` is the set's file part, `doom`, `custom2` ...), as one picture."""
    d = model_folder(models, number)
    doom = d / f"{d.name}_{part}"
    if doom.is_dir():
        # Doom sprite files (A1, A2A8 ... A5), each cropped to the sprite: bottom-aligned in a row of cells
        frames = [Image.open(p).convert("RGBA") for p in sorted(doom.glob("*.png"))]
        row = Image.new("RGBA", (cell * len(frames), max(cell, *(f.height for f in frames))), (0, 0, 0, 0))
        for i, fr in enumerate(frames):
            row.paste(fr, (i * cell + (cell - fr.width) // 2, row.height - fr.height))
        return row
    return Image.open(next(d.glob(f"*{d.name}_{part}.png"))).convert("RGBA")   # RPG Maker sheets start with "!$"


def scaled(img: Image.Image, k: int) -> Image.Image:
    return img if k == 1 else img.resize((img.width * k, img.height * k), Image.NEAREST)


def on_bg(img: Image.Image) -> Image.Image:
    out = Image.new("RGBA", img.size, BG)
    out.alpha_composite(img)
    return out


def ref_band(refs: list[Image.Image]) -> Image.Image:
    """The reference sprites side by side, wrapping onto more lines when too wide."""
    lines, line, w = [], [], 0
    for r in refs:
        if line and w + r.width > MAX_REF_ROW:
            lines.append(line)
            line, w = [], 0
        line.append(r)
        w += r.width + GAP
    lines.append(line)
    W = max(sum(r.width for r in l) + GAP * (len(l) - 1) for l in lines)
    H = sum(max(r.height for r in l) for l in lines) + GAP * (len(lines) - 1)
    band = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    y = 0
    for l in lines:
        x = 0
        for r in l:
            band.paste(r, (x, y))
            x += r.width + GAP
        y += max(r.height for r in l) + GAP
    return band


def column(pics: list[Image.Image]) -> Image.Image:
    W = max(p.width for p in pics) + 2 * GAP
    H = sum(p.height + GAP for p in pics) + GAP
    out = Image.new("RGBA", (W, H), BG)
    y = GAP
    for p in pics:
        out.alpha_composite(on_bg(p), (GAP, y))
        y += p.height + GAP
    return out


def font():
    try:
        return ImageFont.load_default(14)
    except TypeError:   # Pillow before 10.1
        return ImageFont.load_default()


def grid(labels: list[str], rows: list[list[Image.Image]]) -> Image.Image:
    """Pictures in labelled columns, each column as wide as its widest picture."""
    f = font()
    widths = [max([*(r[c].width for r in rows), int(f.getlength(labels[c]))]) for c in range(len(labels))]
    head = Image.new("RGBA", (sum(widths) + GAP * (len(widths) - 1), 20), (0, 0, 0, 0))
    d, x = ImageDraw.Draw(head), 0
    for w, lab in zip(widths, labels):
        d.text((x + (w - f.getlength(lab)) / 2, 2), lab, fill=TEXT, font=f)
        x += w + GAP
    lines = [head]
    for r in rows:
        line = Image.new("RGBA", (head.width, max(p.height for p in r)), (0, 0, 0, 0))
        x = 0
        for w, p in zip(widths, r):
            line.paste(p, (x + (w - p.width) // 2, line.height - p.height))
            x += w + GAP
        lines.append(line)
    return column(lines)


def save(img: Image.Image, path: Path):
    img.convert("RGB").save(path)
    print(f"{f'{VARIATIONS}/' if path.parent.name == VARIATIONS else ''}{path.name}  ({img.width} x {img.height})")


def preset_sheets(files: list[str], draw_from: str, refs: Path, out: Path, tmp: Path):
    numbers = {n for f in files for n in CASES[f][4]}
    models = render(numbers, sprite_sets([set_from_preset(preset_json(f), draw_from) for f in files]), tmp, f"presets_{draw_from}")
    for f in files:
        game, ref_files, ref_k, k, picks = CASES[f]
        cell = preset_json(f)["cell"]
        band = ref_band([scaled(Image.open(refs / r).convert("RGBA"), ref_k) for r in ref_files])
        sheet = column([band] + [scaled(model_picture(models, n, f, cell), k) for n in picks])
        save(sheet, out / f"{f} vs {game}{' (voxels)' if draw_from == 'voxels' else ''}.png")


def look_sheet(out: Path, tmp: Path):
    iso = set_from_preset(preset_json("isometric"), "mesh")
    rows = [[] for _ in LOOK_MODELS]
    for i, (_, change) in enumerate(LOOK_VARIANTS):
        models = render(LOOK_MODELS, sprite_sets([iso], {**LOOK_DEFAULT, **change}), tmp, f"look{i}")
        for row, n in zip(rows, LOOK_MODELS):
            strip = model_picture(models, n, "isometric", iso["cell"])
            row.append(scaled(strip.crop((0, 0, iso["cell"], iso["cell"])), 2))   # the first direction
    save(grid([lab for lab, _ in LOOK_VARIANTS], rows), out / "look settings.png")


def camera_sheet(refs: Path, out: Path, tmp: Path):
    sets = [set_from_preset(preset_json("icon"), "mesh") if v is None else {**CAMERA_BASE, **v} for _, v in CAMERA_VARIANTS]
    parts = ["icon"] + ["custom" if i == 0 else f"custom{i + 1}" for i in range(len(sets) - 1)]
    models = render(CAMERA_MODELS, sprite_sets(sets), tmp, "cameras")
    rows = [[scaled(model_picture(models, n, p, s["cell"]), 3) for p, s in zip(parts, sets)] for n in CAMERA_MODELS]
    ref = scaled(Image.open(refs / "Advance Wars 2 Battlesprites red only.png").convert("RGBA"), 2)
    save(column([ref, grid([lab for lab, _ in CAMERA_VARIANTS], rows)]), out / "camera angles vs Advance Wars 2 battle sprites.png")


def turntables(out: Path, tmp: Path):
    (out / "turntables").mkdir(exist_ok=True)
    for draw_from in ("mesh", "voxels"):
        def setup(e):
            e["turntable"] = {**e["turntable"], **TURNTABLE, "on": True, "from": draw_from}
        models = render(TURNTABLE_MODELS, setup, tmp, f"turntable_{draw_from}")
        for n in TURNTABLE_MODELS:
            d = model_folder(models, n)
            gif = out / "turntables" / f"{d.name}{' (voxels)' if draw_from == 'voxels' else ''}.gif"
            gif.write_bytes((d / f"{d.name}_turntable.gif").read_bytes())
            print(f"turntables/{gif.name}")


def main():
    ap = argparse.ArgumentParser(description="Makes the preset vs real game comparison sheets and the render variations.")
    ap.add_argument("presets", nargs="*", help=f"only these presets' sheets, no variations (default: all of {', '.join(CASES)})")
    ap.add_argument("--no-variations", action="store_true", help=f"skip the {VARIATIONS}/ folder")
    ap.add_argument("--refs", type=Path, default=REFS, help="folder holding the reference sprites")
    ap.add_argument("--out", type=Path, default=HERE)
    a = ap.parse_args()
    files = a.presets or list(CASES)
    unknown = [f for f in files if f not in CASES]
    if unknown:
        sys.exit(f"Unknown preset: {', '.join(unknown)}. Known: {', '.join(CASES)}")
    if not CLI.exists():
        sys.exit(f"{CLI} is missing: run `npm run cli:build` in the project folder first.")
    missing = [r for f in files for r in CASES[f][1] if not (a.refs / r).exists()]
    if missing:
        sys.exit(f"Reference sprites missing from {a.refs}:\n  " + "\n  ".join(missing))
    variations = not a.presets and not a.no_variations
    a.out.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as t:
        tmp = Path(t)
        preset_sheets(files, "mesh", a.refs, a.out, tmp)
        if variations:
            var = a.out / VARIATIONS
            var.mkdir(exist_ok=True)
            preset_sheets(files, "voxels", a.refs, var, tmp)
            look_sheet(var, tmp)
            camera_sheet(a.refs, var, tmp)
            turntables(var, tmp)


if __name__ == "__main__":
    main()
