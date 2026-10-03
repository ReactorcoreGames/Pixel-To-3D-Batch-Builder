"""Makes the three showcase contact sheets in promo/ from the 71 Sheet 4 example objects:

  showcase_2d_sprites.png   the original flat sprites
  showcase_lowpoly.png      one isometric frame of each low-poly model (CLI: --draw-from mesh)
  showcase_voxel.png        one isometric frame of each voxel model   (CLI: --draw-from voxels)

Run:  python "promo tools/make_showcase_sheets.py"      (needs Pillow and Node.js)
"""
import re
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from p3d_session_render import render_session

ROOT = Path(__file__).resolve().parent.parent
SHEETS = ROOT / "examples/Example sheets"
SPRITES = ROOT / "test sprites/PSRC Starter Pack Sprites"
OUTDIR = ROOT / "promo"

BG, PLUM = (23, 19, 39), (38, 32, 67)
TANGERINE, LIME, SUN = (255, 154, 60), (143, 220, 74), (255, 210, 63)
TEXT, DIM = (236, 232, 250), (150, 140, 190)

COLS, CELL_W, CELL_H, ZOOM, PAD = 8, 200, 236, 3, 28
HEADER = 120


def font(size, bold=False):
    for f in ("bahnschrift.ttf", "arialbd.ttf" if bold else "arial.ttf"):
        try:
            return ImageFont.truetype(f, size)
        except OSError:
            pass
    return ImageFont.load_default()


def names():
    """[(number, nice name)] from the sheet file names: '02 - wooden barrel__64_F_cyH.png'."""
    out = []
    for p in sorted(SHEETS.glob("*.png")):
        m = re.match(r"(\d+) - (.+?)__", p.name)
        out.append((m.group(1), m.group(2)))
    return out


def sheet(title, subtitle, items, path):
    rows = (len(items) + COLS - 1) // COLS
    W = COLS * CELL_W + 2 * PAD
    H = HEADER + rows * CELL_H + PAD
    im = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(im)
    d.text((PAD, 26), title, font=font(46, True), fill=TEXT)
    d.text((PAD, 82), subtitle, font=font(22), fill=DIM)
    d.rectangle((PAD, 108, PAD + 120, 111), fill=SUN)
    d.rectangle((PAD + 120, 108, PAD + 240, 111), fill=TANGERINE)
    d.rectangle((PAD + 240, 108, PAD + 360, 111), fill=LIME)
    for i, (num, name, img) in enumerate(items):
        x = PAD + (i % COLS) * CELL_W
        y = HEADER + (i // COLS) * CELL_H
        d.rounded_rectangle((x + 6, y + 6, x + CELL_W - 6, y + CELL_H - 6), 10, fill=(30, 25, 52))
        im.paste(img, (x + (CELL_W - img.width) // 2, y + 12 + (CELL_H - 56 - img.height) // 2), img)
        label = f"{num}  {name}"
        f = font(17)
        while d.textlength(label, font=f) > CELL_W - 24 and f.size > 11:
            f = font(f.size - 1)
        d.text((x + CELL_W // 2, y + CELL_H - 30), label, font=f, fill=TEXT, anchor="mm")
    im.save(path)
    print("wrote", path)


def main():
    items = names()
    with tempfile.TemporaryDirectory() as t:
        t = Path(t)
        renders = {}
        for kind, draw_from in (("lowpoly", "mesh"), ("voxel", "voxels")):
            fr = render_session(t, draw_from)
            renders[kind] = [(num, name, fr[num][1].resize((fr[num][1].width * ZOOM,) * 2, Image.NEAREST))
                             for num, name in items]

    flat = []
    for num, name in items:
        s = Image.open(next(SPRITES.glob(f"{num} - *.png"))).convert("RGBA")
        k = max(1, min(160 // s.width, 150 // s.height))
        flat.append((num, name, s.resize((s.width * k, s.height * k), Image.NEAREST)))

    sheet("2D sprites", "71 flat sprites, the input", flat, OUTDIR / "showcase_2d_sprites.png")
    sheet("Low-poly models", "the same 71 objects as low-poly 3D, one isometric frame each", renders["lowpoly"],
          OUTDIR / "showcase_lowpoly.png")
    sheet("Voxel models", "the same 71 objects as voxels, one isometric frame each", renders["voxel"],
          OUTDIR / "showcase_voxel.png")


if __name__ == "__main__":
    main()
