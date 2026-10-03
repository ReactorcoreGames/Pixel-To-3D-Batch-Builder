"""Makes promo/one_sprite_infographic_2560x1440.png: everything the program makes from ONE sprite (PSRC 02 wooden
barrel), as one 16:9 infographic. The sprite and its contact sheet on the left, every export fanning out on the right.

The exports are made by the command-line tool from the user's GUI session (`test sprites/untitled.p3d.json`), so the
barrel keeps its tuned settings (Tube, depth, round sides ...); every export is switched on for this run. The two big
3D pictures are drawn from the exported .glb and .vox files by render3d.py (a small software renderer).

Run:  python "promo tools/make_one_sprite_infographic.py"
Needs: Node.js, the tool built (`npm run cli:build`), Pillow, numpy, fontTools, brotli.
"""
import base64
import io
import json
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

from make_cover_thumb import BG, LAVENDER, LIME, SUN, TANGERINE, WHITE, dots, nunito, pixel
from render3d import load_glb, render_glb, render_vox

ROOT = Path(__file__).resolve().parent.parent
SESSION = ROOT / "test sprites/untitled.p3d.json"
CLI = ROOT / "cli/p3d.mjs"
PRESETS = ROOT / "presets/sprite-sets"
OUT = ROOT / "promo/one_sprite_infographic_2560x1440.png"
MODEL = "02 - wooden barrel"
SETS = ["isometric", "doom", "rpgmaker", "diablo", "rts", "headon", "sideview", "icon", "battle", "oblique"]

W, H = 2560, 1440
CARD, CARD_EDGE, INK = (32, 27, 56), (52, 44, 88), (12, 9, 22)
CAT = {"3d": TANGERINE, "sets": SUN, "extra": LIME}


# ---------------------------------------------------------------- the barrel's exports

def preset(pid):
    p = json.loads((PRESETS / f"{pid}.json").read_text(encoding="utf8"))
    meta = ("order", "id", "name", "file", "sub", "tip")
    return {"preset": p["id"], **{k: v for k, v in p.items() if k not in meta}, "from": "mesh", "open": False}


def export_everything(tmp: Path) -> tuple[Path, dict]:
    """Runs the barrel's sheet from the session through every export. Returns its model folder and the session."""
    s = json.loads(SESSION.read_text(encoding="utf8"))
    s["sheets"]["rows"] = [r for r in s["sheets"]["rows"] if Path(r["path"]).name.startswith(MODEL + "__")]
    s["sprites"]["rows"] = []
    s["sheets"]["folderPerModel"] = True
    e = s["exports"]
    e["glb"].update(on=True, normalMap=True, ao="map")
    e["vox"]["on"] = True
    e["sides"]["on"] = True
    e["stack"]["on"] = True
    e["palette"].update(on=True, gpl=True, hex=True)
    e["turntable"].update({"on": True, "elev": 15, "frames": 24, "size": 128, "from": "mesh"})
    e["sprites"].update(on=True, sets=[preset(p) for p in SETS])
    f = tmp / "barrel.p3d.json"
    f.write_text(json.dumps(s), encoding="utf8")
    r = subprocess.run(["node", str(CLI), "run", str(f), "--only", "models", "--out", str(tmp / "out")],
                       capture_output=True, text=True, encoding="utf8")
    if r.returncode != 0:
        sys.exit(f"The tool failed:\n{r.stdout}\n{r.stderr}")
    return tmp / "out/models" / MODEL, s


def session_image(s, key_path_end):
    for im in s["images"].values():
        if im["path"].endswith(key_path_end):
            return Image.open(io.BytesIO(base64.b64decode(im["png"].split(",")[1]))).convert("RGBA")
    sys.exit(f"{key_path_end} not in the session")


# ---------------------------------------------------------------- picture helpers

def cells(img, cw, ch):
    return [img.crop((x, y, x + cw, y + ch)) for y in range(0, img.height, ch) for x in range(0, img.width, cw)]


def trim(frames):
    """Crops every frame to the box all of them share, so a set keeps its alignment but loses the empty margins."""
    boxes = [f.getbbox() for f in frames if f.getbbox()]
    box = (min(b[0] for b in boxes), min(b[1] for b in boxes), max(b[2] for b in boxes), max(b[3] for b in boxes))
    return [f.crop(box) for f in frames if f.getbbox()]


def grid(frames, cols, gap):
    fw, fh = max(f.width for f in frames), max(f.height for f in frames)
    rows = (len(frames) + cols - 1) // cols
    g = Image.new("RGBA", (cols * fw + (cols - 1) * gap, rows * fh + (rows - 1) * gap), (0, 0, 0, 0))
    for i, f in enumerate(frames):
        g.paste(f, ((i % cols) * (fw + gap) + (fw - f.width) // 2, (i // cols) * (fh + gap) + fh - f.height))
    return g


def zoom(img, k):
    return img if k == 1 else img.resize((img.width * k, img.height * k), Image.NEAREST)


def fit_zoom(img, w, h, most=8):
    """The biggest whole-number zoom that fits, so pixels stay square and crisp."""
    k = max(1, min(most, w // img.width, h // img.height))
    return zoom(img, k)


def scaled_grid(frames, cols, w, h, gap=6, most=8):
    """Frames in a grid inside w × h: the biggest whole-number zoom that fits, trying `cols` columns and fewer
    (more rows) when that lets the frames be bigger or is the only way to fit."""
    fw, fh = max(f.width for f in frames), max(f.height for f in frames)
    best = None
    for c in [c for c in range(cols, 0, -1) if c == cols or len(frames) % c == 0]:   # only full rows
        rows = (len(frames) + c - 1) // c
        for g in (gap, 2):
            k = min(most, (w - (c - 1) * g) // (c * fw), (h - (rows - 1) * g) // (rows * fh))
            if k >= 1 and (best is None or k > best[0]):
                best = (k, c, g)
    k, c, g = best or (1, cols, 2)
    return grid([zoom(f, k) for f in frames], c, g)


# ---------------------------------------------------------------- drawing helpers

def glow(img, box, colour, radius, strength=1.0):
    layer = Image.new("L", img.size, 0)
    ImageDraw.Draw(layer).ellipse(box, fill=int(255 * strength))
    layer = layer.filter(ImageFilter.GaussianBlur(radius))
    img.paste(Image.new("RGB", img.size, colour), (0, 0), layer)


def shadow_text(d, xy, s, fnt, fill, anchor="la"):
    x, y = xy
    d.text((x + 3, y + 4), s, font=fnt, fill=INK, anchor=anchor)
    d.text((x, y), s, font=fnt, fill=fill, anchor=anchor)


def chip(d, xy, s, colour, fnt, anchor="ra", pad=(12, 6)):
    """A small rounded label; xy is its top-right corner (anchor 'ra') or top-left ('la')."""
    tw = d.textlength(s, font=fnt)
    x, y = xy
    if anchor == "ra":
        x -= tw + 2 * pad[0]
    h = fnt.size + 2 * pad[1]
    d.rounded_rectangle((x, y, x + tw + 2 * pad[0], y + h), radius=h // 2, fill=colour)
    d.text((x + pad[0], y + pad[1] + fnt.size // 2 + 1), s, font=fnt, fill=INK, anchor="lm")
    return x, y, x + tw + 2 * pad[0], y + h


def card(img, box, cat, title, sub, file_chip=None):
    """A card with a coloured top edge (its category), a title and a one-line explanation. Returns the content box."""
    d = ImageDraw.Draw(img)
    x0, y0, x1, y1 = box
    d.rounded_rectangle((x0 + 4, y0 + 6, x1 + 4, y1 + 6), 16, fill=(14, 11, 26))
    d.rounded_rectangle(box, 16, fill=CARD, outline=CARD_EDGE, width=2)
    d.rounded_rectangle((x0, y0, x1, y0 + 8), 4, fill=CAT[cat])
    d.text((x0 + 20, y0 + 22), title, font=nunito(27), fill=WHITE)
    d.text((x0 + 20, y0 + 58), sub, font=nunito(19), fill=LAVENDER)
    if file_chip:
        chip(d, (x1 - 16, y0 + 22), file_chip, CAT[cat], pixel(20))
    return x0 + 16, y0 + 92, x1 - 16, y1 - 14


def place(img, pic, box, valign="c"):
    x0, y0, x1, y1 = box
    x = x0 + (x1 - x0 - pic.width) // 2
    y = y0 + (y1 - y0 - pic.height) // 2 if valign == "c" else y1 - pic.height
    img.alpha_composite(pic, (x, y))
    return x, y


def captioned(pics_labels, gap, fnt, colour=LAVENDER):
    """Pictures side by side, bottom-aligned, each with a small label under it."""
    h = max(p.height for p, _ in pics_labels)
    cw = [max(p.width, int(fnt.getlength(l))) for p, l in pics_labels]
    out = Image.new("RGBA", (sum(cw) + gap * (len(cw) - 1), h + fnt.size + 12), (0, 0, 0, 0))
    d = ImageDraw.Draw(out)
    x = 0
    for (p, l), w in zip(pics_labels, cw):
        out.alpha_composite(p, (x + (w - p.width) // 2, h - p.height))
        d.text((x + w // 2, h + 8), l, font=fnt, fill=colour, anchor="ma")
        x += w + gap
    return out


def arrow(d, a, b, colour, width=6, head=18):
    d.line((a, b), fill=colour, width=width)
    (ax, ay), (bx, by) = a, b
    if ax == bx:   # pointing down
        d.polygon([(bx - head * 0.75, by - head), (bx + head * 0.75, by - head), (bx, by + 2)], fill=colour)
    else:          # pointing right
        d.polygon([(bx - head, by - head * 0.75), (bx - head, by + head * 0.75), (bx + 2, by)], fill=colour)


def run_pill(d, centre, n, colour):
    """A 'click Run (1)' pill; the number sits in a dark circle like the program's own step badges.
    Returns the pill's box."""
    f, fn = nunito(26), nunito(22)
    s = "click  Run"
    tw = d.textlength(s, font=f)
    cx, cy = centre
    w = tw + 10 + 36
    box = (cx - w / 2 - 22, cy - 26, cx + w / 2 + 22, cy + 26)
    d.rounded_rectangle((box[0] + 3, box[1] + 5, box[2] + 3, box[3] + 5), 26, fill=INK)
    d.rounded_rectangle(box, 26, fill=colour)
    d.text((box[0] + 22, cy + 1), s, font=f, fill=INK, anchor="lm")
    bx = box[0] + 22 + tw + 10 + 18
    d.ellipse((bx - 18, cy - 18, bx + 18, cy + 18), fill=INK)
    d.text((bx, cy + 1), str(n), font=fn, fill=colour, anchor="mm")
    return box


def right_arrow(d, x, cy, colour, length=54):
    """A drawn → (the fonts have no arrow glyph). Returns the width it takes."""
    d.rectangle((x, cy - 4, x + length - 18, cy + 4), fill=colour)
    d.polygon([(x + length - 22, cy - 15), (x + length - 22, cy + 15), (x + length, cy)], fill=colour)
    return length


# ---------------------------------------------------------------- the infographic

def main():
    with tempfile.TemporaryDirectory() as t:
        t = Path(t)
        m, sess = export_everything(t)
        name = lambda part: m / f"{MODEL}{part}"
        files = [p for p in m.rglob("*") if p.is_file()]
        sprite = session_image(sess, MODEL + ".png")
        sheet = session_image(sess, MODEL + "__64_F_cyH.png")
        glb_pic = render_glb(name(".glb"), 330, 330, yaw=32, elev=20)
        vox_pic = render_vox(name(".vox"), 330, 330, yaw=32, elev=20)
        tex = load_glb(name(".glb"))
        maps = [tex["base"], tex["normal"], tex["ao"]]
        tt = Image.open(name("_turntable.gif"))
        turntable = []
        for i in range(tt.n_frames):
            tt.seek(i)
            turntable.append(tt.convert("RGBA"))
        tt.close()
        S = lambda part: Image.open(name(part)).convert("RGBA")
        iso = trim(cells(S("_isometric.png"), 64, 64))
        doom = trim([Image.open(p).convert("RGBA") for p in sorted(name("_doom").glob("*.png"))])
        diablo = trim(cells(S("_diablo.png"), 96, 96))
        rpg = trim(cells(Image.open(m / f"!${MODEL}_rpgmaker.png").convert("RGBA"), 48, 48))
        rts = trim(cells(S("_rts.png"), 48, 48))
        battle, oblique = S("_battle.png"), S("_oblique.png")
        icon, unit = S("_icon.png"), trim(cells(S("_sideview.png"), 16, 16))
        sides = [(S(f"_{s}.png"), s) for s in ("front", "back", "left", "right", "top", "bottom")]
        stack = S("_stack.png")
        stack = cells(stack, stack.height, stack.height)
        palette = [l.strip() for l in name(".hex").read_text().split() if l.strip()]
        sprite_frames = len(iso) + 8 + len(diablo) + len(rpg) + len(rts) + 4 + 2 + 3   # Doom: 8 ways in 5 files
        n_files = len(files)

    img = Image.new("RGB", (W, H), BG)
    dots(img)
    glow(img, (60, 260, 660, 760), (70, 48, 110), 120)
    glow(img, (1100, 300, 2300, 1300), (44, 34, 80), 220)
    img = img.convert("RGBA")
    d = ImageDraw.Draw(img)

    # ---- header
    big = pixel(88)
    x = 60
    for s, c in (("One sprite in.  ", WHITE), ("A whole asset pack out.", SUN)):
        shadow_text(d, (x, 52), s, big, c)
        x += d.textlength(s, font=big)
    d.text((62, 168), "Draw one small barrel, press Run twice, and Pixel to 3D Batch Builder makes all of this from it.",
           font=nunito(34), fill=LAVENDER)
    logo = Image.open(ROOT / "branding/logo-lockup-dark.png").convert("RGBA")
    logo = logo.crop(logo.getbbox()).resize((480, 120), Image.Resampling.LANCZOS)
    mask = Image.new("L", logo.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, *logo.size), 20, fill=255)
    img.paste(logo, (W - 60 - 480, 50), mask)

    # ---- left: the sprite, then its contact sheet
    LX0, LX1 = 60, 640
    ImageDraw.Draw(img)
    d.rounded_rectangle((LX0, 250, LX1, 720), 22, fill=(36, 30, 64), outline=SUN, width=4)
    chip(d, (LX0 + 22, 268), "YOUR SPRITE", SUN, pixel(24), anchor="la")
    sp = zoom(sprite, 10)
    sx, sy = place(img, sp, (LX0, 300, LX1, 650))
    # a faint pixel grid over the zoomed sprite, so it reads as hand-placed pixels
    gl = Image.new("RGBA", sp.size, (0, 0, 0, 0))
    gd = ImageDraw.Draw(gl)
    for gx in range(0, sp.width + 1, 10):
        gd.line((gx, 0, gx, sp.height), fill=(0, 0, 0, 38))
    for gy in range(0, sp.height + 1, 10):
        gd.line((0, gy, sp.width, gy), fill=(0, 0, 0, 38))
    gl.putalpha(Image.composite(gl.getchannel("A"), Image.new("L", sp.size, 0), sp.getchannel("A")))
    img.alpha_composite(gl, (sx, sy))
    d.text(((LX0 + LX1) // 2, 668), f"{sprite.width} × {sprite.height} pixels, drawn from the front", font=nunito(25),
           fill=WHITE, anchor="ma")

    arrow(d, ((LX0 + LX1) // 2, 724), ((LX0 + LX1) // 2, 806), WHITE)
    run_pill(d, ((LX0 + LX1) // 2, 762), 1, SUN)

    d.rounded_rectangle((LX0, 812, LX1, 1290), 22, fill=CARD, outline=CARD_EDGE, width=2)
    sh = zoom(sheet, 2)
    place(img, sh, (LX0 + 18, 830, LX0 + 18 + sh.width, 1272))
    tx = LX0 + 18 + sh.width + 26
    d.text((tx, 846), "Its contact sheet", font=nunito(28), fill=WHITE)
    body = nunito(22)
    lines = ["Made for you: the back,", "sides, top and bottom", "are worked out from", "your one drawing.", "",
             "Paint over any side to", "fix it, if you like."]
    for i, l in enumerate(lines):
        d.text((tx, 894 + i * 32), l, font=body, fill=LAVENDER)

    # ---- the bus from the sheet to every output row
    BX = 690
    rows = [(250, 650), (670, 980), (1000, 1310)]
    mids = [(a + b) // 2 for a, b in rows]
    PY = 1225
    pill = run_pill(d, (LX0 + 18 + 2 * sheet.width + 26 + 112, PY), 2, LIME)
    d.line((pill[2], PY, BX, PY), fill=WHITE, width=6)
    d.line((BX, mids[0], BX, PY + 3), fill=WHITE, width=6)
    for y in mids:
        arrow(d, (BX, y), (734, y), WHITE)

    # ---- right: the outputs, one card each
    RX0, RX1, GAP = 744, W - 60, 20

    def row(y0, y1, specs):
        """specs: [(width or None, draw(box))]; None widths share what's left."""
        fixed = sum(w for w, _ in specs if w)
        free = [i for i, (w, _) in enumerate(specs) if not w]
        rest = (RX1 - RX0 - fixed - GAP * (len(specs) - 1)) // max(1, len(free))
        x = RX0
        for w, draw in specs:
            w = w or rest
            draw((x, y0, x + w, y1))
            x += w + GAP

    def glb_card(b):
        place(img, glb_pic, card(img, b, "3d", "Low-poly 3D model", "for Godot, Unity, Blender", ".glb"))

    def vox_card(b):
        place(img, vox_pic, card(img, b, "3d", "Voxel model", "opens in MagicaVoxel", ".vox"))

    def turntable_card(b):
        c = card(img, b, "3d", "Turntable animation", f"{len(turntable)} frames, all the way round", ".gif")
        place(img, scaled_grid(trim(turntable[::4]), 3, c[2] - c[0], c[3] - c[1], gap=14), c)

    def maps_card(b):
        c = card(img, b, "3d", "Surface-detail maps", "packed into the .glb for real-time lighting")
        f = nunito(20)
        place(img, captioned([(zoom(mp, 2), l) for mp, l in zip(maps, ("colour", "bumps", "crevices"))], 22, f), c)

    row(*rows[0], [(380, glb_card), (380, vox_card), (None, turntable_card), (470, maps_card)])

    def set_card(title, sub, frames, cols, fchip=None, most=8):
        def draw(b):
            c = card(img, b, "sets", title, sub, fchip)
            place(img, scaled_grid(frames, cols, c[2] - c[0], c[3] - c[1], most=most), c)
        return draw

    row(*rows[1], [
        (380, set_card("Isometric", "RollerCoaster Tycoon look, 4 ways", iso, 4)),
        (512, set_card("Doom-style", "8 ways, saved as Doom sprite files", doom, 5)),
        (None, set_card("Diablo-style", "8 ways, seen from 30° up", diablo, 8)),
        (300, set_card("RPG Maker", "ready-to-use walk sheet", rpg, 3)),
    ])

    def singles_card(b):
        c = card(img, b, "sets", "Battle & oblique", "one big picture each")
        cw, ch = (c[2] - c[0] - 24) // 2, c[3] - c[1]
        pics = []
        for p in (trim([battle])[0], trim([oblique])[0]):
            k = min(cw / p.width, ch / p.height)   # 256 px pictures: shrink them smoothly to fit
            pics.append(p.resize((int(p.width * k), int(p.height * k)), Image.Resampling.LANCZOS) if k < 1 else p)
        place(img, grid(pics, 2, 24), c)

    def icon_card(b):
        c = card(img, b, "sets", "Icon & map unit", "for menus and maps")
        place(img, captioned([(zoom(icon, 4), "32 px"), (zoom(unit[0], 5), "16 px")], 26, nunito(18)), c)

    def sides_card(b):
        c = card(img, b, "extra", "Six side views", "flat pictures of every side", ".png")
        place(img, captioned([(zoom(p, 3), l) for p, l in sides], 8, nunito(17)), c)

    def stack_card(b):
        c = card(img, b, "extra", "Stack & palette", "slices, .gpl / .hex")
        st = grid([zoom(f, 2) for f in stack[1::3]], 4, 4)
        sw = 13
        cols = 16
        pal = Image.new("RGBA", (cols * sw, ((len(palette) + cols - 1) // cols) * sw), (0, 0, 0, 0))
        pd = ImageDraw.Draw(pal)
        for i, h in enumerate(palette):
            x, y = (i % cols) * sw, (i // cols) * sw
            pd.rectangle((x, y, x + sw - 1, y + sw - 1), fill="#" + h[-6:])
        both = Image.new("RGBA", (max(st.width, pal.width), st.height + 14 + pal.height), (0, 0, 0, 0))
        both.alpha_composite(st, ((both.width - st.width) // 2, 0))
        both.alpha_composite(pal, ((both.width - pal.width) // 2, st.height + 14))
        place(img, both, c)

    row(*rows[2], [
        (370, set_card("Classic RTS", "Red Alert look, 32 ways", rts, 8)),
        (None, singles_card),
        (240, icon_card),
        (528, sides_card),
        (250, stack_card),
    ])

    # ---- footer: the count
    f_big, f_small = pixel(46), nunito(30)
    parts = [("1 sprite", SUN), None, ("a few clicks", WHITE), None, (f"{n_files} files", LIME)]
    tail = f"2 kinds of 3D model  ·  10 game sprite sets ({sprite_frames}+ sprites)  ·  and more"
    arrow_w, sp = 54, 26
    total = sum(d.textlength(p[0], font=f_big) if p else arrow_w + 2 * sp for p in parts) + 40 + d.textlength(tail, font=f_small)
    x, FY = (W - total) / 2, 1338
    for p in parts:
        if p:
            shadow_text(d, (x, FY), p[0], f_big, p[1])
            x += d.textlength(p[0], font=f_big)
        else:
            right_arrow(d, x + sp, FY + 30, WHITE, arrow_w)
            x += arrow_w + 2 * sp
    d.text((x + 40, FY + 16), tail, font=f_small, fill=LAVENDER)

    img.convert("RGB").save(OUT)
    print("wrote", OUT, f"({n_files} files exported)")


if __name__ == "__main__":
    main()
