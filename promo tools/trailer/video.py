"""The YouTube trailer for Pixel to 3D Batch Builder: motion graphics drawn frame by frame with PIL, piped to ffmpeg.

  python gen_assets.py            first: renders the turntables and sprite sets into assets/ (~85 MB, a few minutes)
  python video.py                 renders trailer.mp4 (copy it to promo/trailer_1080p.mp4)
  python video.py stills 1 5.5 9  writes stills.png: a contact strip of those moments (seconds), to check layouts
"""
import math
import subprocess
import sys
from functools import lru_cache
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(r"C:\14 Repos\Pixel-To-3D-Batch-Builder")
sys.path.insert(0, str(ROOT / "promo tools"))
from make_cover_thumb import BG, LAVENDER, LIME, SUN, TANGERINE, WHITE, nunito, pixel  # noqa: E402

HERE = Path(__file__).parent
A = HERE / "assets"
W, H, FPS = 1920, 1080, 30
INK = (12, 9, 22)
CARD, CARD_EDGE = (32, 27, 56), (60, 50, 100)


# ---------------------------------------------------------------- timing helpers

def clamp(x, a=0.0, b=1.0): return max(a, min(b, x))
def prog(t, t0, d): return clamp((t - t0) / d)
def smooth(x): return x * x * (3 - 2 * x)
def out_cubic(x): return 1 - (1 - x) ** 3
def out_back(x, s=1.7): return 1 + (s + 1) * (x - 1) ** 3 + s * (x - 1) ** 2
def lerp(a, b, x): return a + (b - a) * x


# ---------------------------------------------------------------- images

@lru_cache(None)
def img(path):
    return Image.open(path).convert("RGBA")


@lru_cache(None)
def frames(folder):
    return [img(p) for p in sorted(Path(folder).glob("*.png"))]


def zoom(im, k): return im.resize((round(im.width * k), round(im.height * k)), Image.NEAREST)


def fit_px(im, w, h):
    """Whole-number nearest zoom that fits (crisp pixels); shrinks smoothly when even 1× is too big."""
    k = min(w / im.width, h / im.height)
    if k >= 1:
        return zoom(im, int(k))
    return im.resize((max(1, round(im.width * k)), max(1, round(im.height * k))), Image.LANCZOS)


def with_alpha(im, a):
    if a >= 0.999:
        return im
    im = im.copy()
    im.putalpha(im.getchannel("A").point(lambda v: int(v * a)))
    return im


def put(canvas, im, cx, cy, scale=1.0, alpha=1.0, smooth_scale=False):
    """Pastes im centred on (cx, cy)."""
    if alpha <= 0.003 or scale <= 0.01:
        return
    if abs(scale - 1) > 1e-3:
        im = im.resize((max(1, round(im.width * scale)), max(1, round(im.height * scale))),
                       Image.LANCZOS if smooth_scale else Image.NEAREST)
    im = with_alpha(im, alpha)
    canvas.alpha_composite(im, (round(cx - im.width / 2), round(cy - im.height / 2)))


def spin(folder, t, fps=FPS):
    fr = frames(folder)
    return fr[int(max(0, t) * fps) % len(fr)]


# ---------------------------------------------------------------- text

@lru_cache(None)
def label(parts, size, face="nunito", shadow=6):
    """parts: ((text, colour), ...) side by side, with a soft dark shadow. Returns a tight RGBA image."""
    fnt = pixel(size) if face == "pixel" else nunito(size)
    widths = [runs_len(s, fnt) for s, _ in parts]
    asc, desc = fnt.getmetrics()
    pad = shadow * 3 + 4
    w, h = int(sum(widths)) + 2 * pad, asc + desc + 2 * pad
    mask = Image.new("L", (w, h), 0)
    d = ImageDraw.Draw(mask)
    x = pad
    for (s, _), wd in zip(parts, widths):
        draw_runs(d, (x, pad), s, fnt, fill=255, stroke_width=max(1, shadow // 2), stroke_fill=255)
        x += wd
    out = Image.new("RGBA", (w, h), INK + (0,))
    if shadow:
        glow = mask.filter(ImageFilter.GaussianBlur(shadow)).point(lambda v: min(255, int(v * 2.2)))
        out.putalpha(glow)
        out.alpha_composite(Image.merge("RGBA", (*Image.new("RGB", (w, h), INK).split(), mask.point(lambda v: v * 0.9))))
    d = ImageDraw.Draw(out)
    x = pad
    for (s, c), wd in zip(parts, widths):
        draw_runs(d, (x, pad), s, fnt, fill=c + (255,))
        x += wd
    return out.crop(out.getbbox())


SYMBOLS = set("→★·")


@lru_cache(None)
def symfont(size): return ImageFont.truetype("seguisym.ttf", size)


def runs(text, fnt):
    """Splits text into (piece, font) runs: the symbols Nunito lacks come from Segoe UI Symbol."""
    out = []
    for ch in text:
        f = symfont(int(fnt.size * 0.95)) if ch in SYMBOLS - {"·"} else fnt
        if out and out[-1][1] is f:
            out[-1][0] += ch
        else:
            out.append([ch, f])
    return out


def draw_runs(d, xy, text, fnt, **kw):
    x, y = xy
    asc = fnt.getmetrics()[0]
    for piece, f in runs(text, fnt):
        d.text((x, y + asc), piece, font=f, anchor="ls", **kw)
        x += f.getlength(piece)
    return x


def runs_len(text, fnt): return sum(f.getlength(p) for p, f in runs(text, fnt))


def T(text, colour=WHITE): return ((text, colour),)


def text_in(canvas, parts, size, cx, cy, t, t0, face="nunito", rise=24, dur=0.45, anchor="c"):
    """Text fading and rising into place from t0."""
    if t < t0:
        return
    x = out_cubic(prog(t, t0, dur))
    im = label(parts, size, face)
    if anchor == "l":
        cx += im.width / 2
    put(canvas, im, cx, cy + rise * (1 - x), alpha=x)


@lru_cache(None)
def pill(text, colour, size=40, fg=INK, pad=(26, 12)):
    fnt = nunito(size)
    w = int(runs_len(text, fnt)) + 2 * pad[0]
    asc, desc = fnt.getmetrics()
    h = asc + desc + 2 * pad[1] - 8
    im = Image.new("RGBA", (w + 8, h + 8), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle((4, 8, w + 4, h + 6), h // 2, fill=INK + (200,))
    d.rounded_rectangle((2, 2, w + 2, h + 2), h // 2, fill=colour + (255,))
    asc, desc = fnt.getmetrics()
    draw_runs(d, (2 + pad[0], 2 + (h - asc - desc) / 2 + 1), text, fnt, fill=fg + (255,))
    return im


def step_title(canvas, t, n, colour, chip, title, y=88):
    """'(1) Sprites → Sheets   Every sprite becomes a sheet' header, sliding in."""
    x = out_cubic(prog(t, 0.15, 0.5))
    p = pill(f"{n}  {chip}", colour, 38)
    tl = label(T(title), 60, "nunito")
    gap = 30
    total = p.width + gap + tl.width
    left = (W - total) / 2
    put(canvas, p, left + p.width / 2 - 40 * (1 - x), y, alpha=x)
    put(canvas, tl, left + p.width + gap + tl.width / 2 + 40 * (1 - x), y, alpha=x)


# ---------------------------------------------------------------- frames, cards, arrows

@lru_cache(None)
def window(path, w, h):
    """A screenshot box: the size of the window, rounded, with a border; returns (frame RGBA, inner box)."""
    im = Image.new("RGBA", (w + 60, h + 60), (0, 0, 0, 0))
    sh = Image.new("L", im.size, 0)
    ImageDraw.Draw(sh).rounded_rectangle((30, 40, w + 30, h + 40), 18, fill=170)
    im.putalpha(sh.filter(ImageFilter.GaussianBlur(14)))
    return im


def screenshot(canvas, path, cx, cy, w, h, t, z0=1.0, z1=1.1, focus=(0.5, 0.5), dur=5.0, alpha=1.0):
    """A screenshot in a rounded frame, slowly zooming towards `focus` (fractions of the image)."""
    src = img(path)
    z = lerp(z0, z1, smooth(clamp(t / dur)))
    cw, ch = src.width / z, src.height / z
    fx, fy = focus[0] * src.width, focus[1] * src.height
    # zoom towards the focus point while keeping the crop inside the image
    x0 = clamp(lerp(src.width / 2, fx, (z - 1) / max(1e-6, z1 - 1) if z1 > 1 else 0) - cw / 2, 0, src.width - cw)
    y0 = clamp(lerp(src.height / 2, fy, (z - 1) / max(1e-6, z1 - 1) if z1 > 1 else 0) - ch / 2, 0, src.height - ch)
    view = src.resize((w, h), Image.LANCZOS, box=(x0, y0, x0 + cw, y0 + ch))
    mask = rounded_mask(w, h, 16)
    view.putalpha(mask)
    layer = window(path, w, h).copy()
    layer.alpha_composite(view, (30, 30))
    ImageDraw.Draw(layer).rounded_rectangle((29, 29, w + 30, h + 30), 17, outline=CARD_EDGE + (255,), width=3)
    put(canvas, layer, cx, cy + 5, alpha=alpha)


@lru_cache(None)
def rounded_mask(w, h, r):
    m = Image.new("L", (w * 2, h * 2), 0)
    ImageDraw.Draw(m).rounded_rectangle((0, 0, w * 2 - 1, h * 2 - 1), r * 2, fill=255)
    return m.resize((w, h), Image.LANCZOS)


@lru_cache(None)
def card(w, h, edge=CARD_EDGE, top=None):
    im = Image.new("RGBA", (w + 40, h + 40), (0, 0, 0, 0))
    sh = Image.new("L", im.size, 0)
    ImageDraw.Draw(sh).rounded_rectangle((20, 28, w + 20, h + 28), 16, fill=150)
    im.putalpha(sh.filter(ImageFilter.GaussianBlur(10)))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle((20, 20, w + 20, h + 20), 16, fill=CARD + (255,), outline=edge + (255,), width=2)
    if top:
        d.rounded_rectangle((20, 20, w + 20, 27), 4, fill=top + (255,))
    return im


def arrow(canvas, x0, x1, y, x, colour=SUN, width=12, head=30):
    """A right-pointing arrow drawn from x0 towards x1, x = 0..1 of the way."""
    if x <= 0:
        return
    d = ImageDraw.Draw(canvas)
    xe = lerp(x0, x1, out_cubic(x))
    d.line((x0, y, xe - head * 0.6, y), fill=INK + (255,), width=width + 8)
    d.line((x0, y, xe - head * 0.6, y), fill=colour + (255,), width=width)
    pts = [(xe, y), (xe - head, y - head * 0.8), (xe - head, y + head * 0.8)]
    d.polygon([(px + 2, py + 3) for px, py in pts], fill=INK + (255,))
    d.polygon(pts, fill=colour + (255,))


def background():
    bg = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(bg)
    for y in range(12, H, 24):
        for x in range(12, W, 24):
            d.ellipse((x - 1.6, y - 1.6, x + 1.6, y + 1.6), fill=(36, 30, 62))
    g = Image.new("L", (W, H), 0)
    ImageDraw.Draw(g).ellipse((W * 0.15, H * 0.05, W * 0.85, H * 1.1), fill=255)
    g = g.filter(ImageFilter.GaussianBlur(220))
    bg.paste(Image.new("RGB", (W, H), (48, 36, 92)), (0, 0), g.point(lambda v: int(v * 0.55)))
    return bg.convert("RGBA")


# ---------------------------------------------------------------- source material

SPR = A / "sheets"
MESH, VOX, GRID, SETS = A / "tt_mesh", A / "tt_vox", A / "tt_grid", A / "sets"
BARREL = "02 - wooden barrel"


def sprite(name): return img(SPR / f"{name}.png")


@lru_cache(None)
def models():
    return sorted([p.name for p in GRID.iterdir()], key=lambda n: int(n.split(" ")[0]))


# ---------------------------------------------------------------- scenes
# Each scene draws onto a transparent layer; t is seconds from the scene's start.

def s_hook(c, t):
    y = 560
    spr = zoom(sprite(BARREL), 11)
    move = smooth(prog(t, 1.7, 0.7))
    sx = lerp(960, 560, move)
    pop = out_back(prog(t, 0.25, 0.5))
    put(c, spr, sx, y, scale=pop)
    if t > 1.7:
        put(c, label(T("your sprite", LAVENDER), 34), sx, y + 255, alpha=prog(t, 2.0, 0.4))
    arrow(c, 800, 1060, y, prog(t, 2.2, 0.5))
    if t > 2.5:
        put(c, spin(MESH / BARREL, t - 2.5), 1340, y, scale=out_back(prog(t, 2.5, 0.5)))
        put(c, label(T("its 3D model", LAVENDER), 34), 1340, y + 255, alpha=prog(t, 2.8, 0.4))
    # headline: centred as a whole, its second half arriving later
    a, b = label(T("Pixel art in."), 92, "pixel"), label(T("3D models out.", TANGERINE), 92, "pixel")
    gap = 40
    left = (W - a.width - gap - b.width) / 2
    text_x = out_cubic(prog(t, 0.6, 0.5))
    bx = out_cubic(prog(t, 2.9, 0.5))
    slide = smooth(prog(t, 2.6, 0.5))
    put(c, a, lerp(960, left + a.width / 2, slide), 150 + 20 * (1 - text_x), alpha=text_x)
    put(c, b, left + a.width + gap + b.width / 2, 150 + 20 * (1 - bx), alpha=bx)
    logo = img(ROOT / "branding/logo-lockup.png")
    lx = out_cubic(prog(t, 4.2, 0.6))
    put(c, logo, 960, 960 + 20 * (1 - lx), scale=0.62, alpha=lx, smooth_scale=True)


GCOLS, GROWS, CW, CH = 12, 6, 136, 124
GX0, GY0 = (W - GCOLS * CW) / 2, 200


@lru_cache(None)
def grid_sprite(name): return fit_px(sprite(name), 100, 100)


def s_batch(c, t):
    text_in(c, T("A whole folder at once."), 80, 960, 100, t, 0.1, "pixel")
    for i, name in enumerate(models()):
        col, row = i % GCOLS, i // GCOLS
        cx, cy = GX0 + col * CW + CW / 2, GY0 + row * CH + CH / 2
        t_in = 0.3 + (col + row) * 0.03
        t_swap = 1.5 + (col + row) * 0.16
        if t < t_swap:
            put(c, grid_sprite(name), cx, cy, scale=out_back(prog(t, t_in, 0.35)))
        else:
            k = prog(t, t_swap, 0.4)
            if k < 0.35:   # flash: the sprite brightens and shrinks
                put(c, grid_sprite(name), cx, cy, scale=1 - k / 0.35 * 0.6, alpha=1 - k / 0.35)
            fr = spin(GRID / name, t - t_swap)
            put(c, fr, cx, cy, scale=0.74 * out_back(k), smooth_scale=True)
    text_in(c, ((("71 sprites in, ", WHITE)), ("71 models out", LIME), (", in one run.", WHITE)), 46, 960, 990, t, 4.6)


SHEET_CELLS = [((3, 3), "Front", True), ((70, 3), "Back", False), ((3, 70), "Left", False), ((70, 70), "Right", False),
               ((3, 137), "Top", False), ((70, 137), "Bottom", False)]


def s_step1(c, t):
    step_title(c, t, "1", TANGERINE, "Sprites → Sheets", "Every sprite becomes a sheet")
    # A: the app
    if t < 5.6:
        a = 1 - prog(t, 5.0, 0.5)
        screenshot(c, ROOT / "promo/screenshot_1_sprites_to_sheets.png", 960, 595, 1472, 828, t, 1.0, 1.0, alpha=a * prog(t, 0.2, 0.4))
        if t > 1.8:
            put(c, pill("Thickness, side and shape per sprite, or for many at once", SUN, 34), 960, 1025,
                alpha=prog(t, 1.8, 0.4) * a)
        return
    t -= 5.6
    # B: sprite -> sheet
    y = 590
    spr = zoom(sprite(BARREL), 8)
    put(c, spr, 400, y, scale=out_back(prog(t, 0.0, 0.45)))
    put(c, label(T("your sprite", LAVENDER), 32), 400, y + 185, alpha=prog(t, 0.3, 0.4))
    arrow(c, 540, 670, y, prog(t, 0.4, 0.4))
    sheet = img(SPR / "02 - wooden barrel__64_F_cyH.png")
    k = 4
    sx, sy = 960 - sheet.width * k / 2, y - sheet.height * k / 2
    bg = card(sheet.width * k + 20, sheet.height * k + 20)
    put(c, bg, 960, y + 4, alpha=prog(t, 0.6, 0.3))
    frame = sheet.copy()
    cells = Image.new("RGBA", sheet.size, (0, 0, 0, 0))
    for (x, yy), _, _ in SHEET_CELLS:
        frame.paste((0, 0, 0, 0), (x, yy, x + 64, yy + 64))
    put(c, zoom(frame, k), 960, y, alpha=prog(t, 0.7, 0.3))
    for i, ((x, yy), name, star) in enumerate(SHEET_CELLS):
        t0 = 1.0 + i * 0.28
        if t < t0:
            continue
        cell = zoom(sheet.crop((x, yy, x + 64, yy + 64)), k)
        put(c, cell, sx + (x + 32) * k, sy + (yy + 32) * k, scale=out_back(prog(t, t0, 0.35)))
        chip = pill(name + (" ★" if star else ""), TANGERINE if star else (70, 60, 120), 22, INK if star else WHITE, (12, 6))
        put(c, chip, sx + x * k + chip.width / 2 + 6, sy + yy * k + chip.height / 2 + 6, alpha=prog(t, t0 + 0.15, 0.3))
    text_in(c, T("The back, sides, top"), 50, 1300, 470, t, 2.9, anchor="l")
    text_in(c, T("and bottom are worked"), 50, 1300, 530, t, 2.95, anchor="l")
    text_in(c, T("out for you.", SUN), 50, 1300, 590, t, 3.0, anchor="l")
    text_in(c, T("Optional: paint over any side", LAVENDER), 36, 1300, 690, t, 4.0, anchor="l")
    text_in(c, T("in your own art app to fix it.", LAVENDER), 36, 1300, 736, t, 4.05, anchor="l")


CYCLE = [BARREL, "28 - chest", "17 - HP kit", "20 - lamp (1)"]


def s_step2(c, t):
    step_title(c, t, "2", LIME, "Sheets → Models", "The sheets become 3D models")
    if t < 4.4:
        a = 1 - prog(t, 3.8, 0.5)
        screenshot(c, ROOT / "promo/screenshot_2_low_poly_model.png", 960, 595, 1472, 828, t, 1.0, 1.0, alpha=a * prog(t, 0.2, 0.4))
        return
    t -= 4.4
    for i, (cx, title, chip, sub, src) in enumerate(((560, "Low-poly model", ".glb", "for Godot, Unity, Blender", MESH),
                                                    (1360, "Voxel model", ".vox", "opens in MagicaVoxel", VOX))):
        a = out_cubic(prog(t, i * 0.15, 0.45))
        put(c, card(720, 760, top=TANGERINE), cx, 600 + 30 * (1 - a), alpha=a)
        put(c, label(T(title), 46, shadow=0), cx - 340 + label(T(title), 46, shadow=0).width / 2, 270, alpha=a)
        p = pill(chip, TANGERINE, 28, INK, (14, 6))
        put(c, p, cx + 340 - p.width / 2, 272, alpha=a)
        put(c, label(T(sub, LAVENDER), 30, shadow=0), cx - 340 + label(T(sub, LAVENDER), 30, shadow=0).width / 2, 318, alpha=a)
        # cycle through a few models, each popping in facing front
        slot = min(len(CYCLE) - 1, int(max(0, t - 0.3) / 1.9))
        ts = 0.3 + slot * 1.9
        fr = spin(src / CYCLE[slot], t - ts)
        sc = out_back(prog(t, ts, 0.4))
        if slot + 1 < len(CYCLE) and t > ts + 1.65:
            sc = 1 - prog(t, ts + 1.65, 0.25)
        put(c, fr, cx, 640, scale=1.2 * sc, smooth_scale=True)


def trim(frs):
    """Crops every frame to the box they all share, so a set keeps its alignment but loses its empty margins."""
    boxes = [f.getbbox() for f in frs if f.getbbox()]
    box = (min(b[0] for b in boxes), min(b[1] for b in boxes), max(b[2] for b in boxes), max(b[3] for b in boxes))
    return [f.crop(box) for f in frs]


def strip(path, cw, ch):
    im = img(path)
    return trim([im.crop((x, y, x + cw, y + ch)) for y in range(0, im.height, ch) for x in range(0, im.width, cw)])


@lru_cache(None)
def set_cards():
    def f(m, s): return SETS / m / f"{m}_{s}.png"
    return [
        ("Isometric", "RollerCoaster Tycoon look, 4 ways", strip(f("28 - chest", "isometric"), 64, 64), 4, 3),
        ("Doom-style", "8 ways, saved as Doom sprite files", trim([img(p) for p in sorted((A / "doom").glob("*.png"))]), 5, 3),
        ("Diablo-style", "8 ways, seen from 30° up", strip(f("20 - lamp (1)", "diablo"), 96, 96), 4, 3),
        ("RPG Maker", "ready-to-use walk sheet", strip(SETS / "21 - potted plant (2)" / "!$21 - potted plant (2)_rpgmaker.png", 48, 48), 6, 3),
        ("Classic RTS", "Red Alert look, 32 ways", strip(f("17 - HP kit", "rts"), 48, 48)[::4], 4, 3),
        ("Turntable GIF", "a full spin, any size", None, 1, 1),
    ]


def s_sets(c, t):
    text_in(c, T("Plus ready-made 2D sprite sets"), 72, 960, 100, t, 0.1, "pixel")
    cw, chh, gap = 580, 360, 30
    for i, (title, sub, frs, cols, k) in enumerate(set_cards()):
        t0 = 0.4 + i * 0.4
        if t < t0:
            continue
        cx = 960 + (i % 3 - 1) * (cw + gap)
        cy = 390 + (i // 3) * (chh + gap)
        a = out_cubic(prog(t, t0, 0.4))
        dy = 30 * (1 - a)
        put(c, card(cw, chh, top=SUN), cx, cy + dy, alpha=a)
        tl, sl = label(T(title), 40, shadow=0), label(T(sub, LAVENDER), 26, shadow=0)
        put(c, tl, cx - cw / 2 + 24 + tl.width / 2, cy - chh / 2 + 44 + dy, alpha=a)
        put(c, sl, cx - cw / 2 + 24 + sl.width / 2, cy - chh / 2 + 84 + dy, alpha=a)
        ay = cy + 50 + dy
        if frs is None:
            put(c, spin(MESH / BARREL, t - t0), cx, ay, scale=0.55 * a, smooth_scale=True)
            continue
        rows = math.ceil(len(frs) / cols)
        g = 10 if cols <= 5 else 6
        fw0, fh0 = max(f.width for f in frs), max(f.height for f in frs)
        k = max(1, min(k, int((cw - 50 - (cols - 1) * g) / (cols * fw0)), int((chh - 130 - (rows - 1) * g) / (rows * fh0))))
        fw, fh = fw0 * k, fh0 * k
        x0 = cx - (cols * fw + (cols - 1) * g) / 2 + fw / 2
        y0 = ay - (rows * fh + (rows - 1) * g) / 2 + fh / 2
        step = min(0.06, 1.2 / len(frs))
        for j, fr in enumerate(frs):
            tj = t0 + 0.3 + j * step
            if t < tj:
                break
            put(c, zoom(fr, k), x0 + (j % cols) * (fw + g), y0 + (j // cols) * (fh + g), scale=out_back(prog(t, tj, 0.3)))
    text_in(c, T("10 presets (isometric, side view, battle, icons...) or set up your own camera", LAVENDER), 36, 960, 1010, t, 3.2)


def s_summary(c, t):
    im = img(ROOT / "promo/one_sprite_infographic_2560x1440.png")
    z = lerp(1.0, 1.06, t / 5.5)
    cw, ch = im.width / z, im.height / z
    view = im.resize((W, H), Image.LANCZOS, box=((im.width - cw) / 2, (im.height - ch) / 2, (im.width + cw) / 2, (im.height + ch) / 2))
    c.alpha_composite(view)


def s_included(c, t):
    text_in(c, T("Also included"), 80, 960, 100, t, 0.1, "pixel")
    a = out_cubic(prog(t, 0.3, 0.5))
    screenshot(c, ROOT / "promo/godot example previewer grid.png", 500, 520 + 30 * (1 - a), 820, 487, t, 1.0, 1.0, alpha=a)
    b = out_cubic(prog(t, 0.6, 0.5))
    screenshot(c, ROOT / "promo/guide screenshots (1).png", 1420, 520 + 30 * (1 - b), 866, 487, t, 1.0, 1.0, alpha=b)
    text_in(c, T("A Godot 4 previewer"), 46, 500, 830, t, 1.0)
    text_in(c, T("see your models under real lighting", LAVENDER), 32, 500, 885, t, 1.1)
    text_in(c, T("A full user guide"), 46, 1420, 830, t, 1.3)
    text_in(c, T("plus a command-line tool for scripting", LAVENDER), 32, 1420, 885, t, 1.4)


END_ROW = ["01 - large boulder", "28 - chest", "20 - lamp (1)", BARREL, "42 - lit torch", "10 - basketball", "21 - potted plant (2)"]


def s_end(c, t):
    logo = img(ROOT / "branding/logo-lockup.png")
    a = out_back(prog(t, 0.1, 0.6), 1.2)
    put(c, logo, 960, 250, scale=1.05 * a, smooth_scale=True)
    text_in(c, T("Pixel-art sprites in, low-poly & voxel models out, a whole batch at a time.", LAVENDER), 38, 960, 440, t, 0.6)
    for i, name in enumerate(END_ROW):
        x = 960 + (i - 3) * 230
        put(c, spin(MESH / name, t - 0.8 - i * 0.1), x, 640, scale=0.48 * out_back(prog(t, 0.8 + i * 0.08, 0.4)), smooth_scale=True)
    p = pill("For Windows  ·  Link in the description", SUN, 46, INK, (34, 16))
    put(c, p, 960, 860, scale=out_back(prog(t, 1.4, 0.45)))
    text_in(c, T("Made by Reactorcore", LAVENDER), 32, 960, 1000, t, 1.8)


SCENES = [(s_hook, 6.5), (s_batch, 8.5), (s_step1, 12.6), (s_step2, 12.2), (s_sets, 9.5), (s_summary, 5.5), (s_included, 5.5), (s_end, 6.0)]
FADE = 0.35


def timeline():
    t0, out = 0.0, []
    for f, d in SCENES:
        out.append((f, t0, d))
        t0 += d
    return out, t0


BGIMG = None


def frame(t):
    global BGIMG
    if BGIMG is None:
        BGIMG = background()
    scenes, total = timeline()
    out = BGIMG.copy()
    for i, (f, t0, d) in enumerate(scenes):
        if t0 <= t < t0 + d:
            lt = t - t0
            layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
            f(layer, lt)
            fade = min(1.0, lt / FADE if i else 1.0, (d - lt) / FADE if i < len(scenes) - 1 else 1.0)
            out.alpha_composite(with_alpha(layer, clamp(fade)))
    # fade in from black at the start, out to black at the end
    k = min(1.0, t / 0.5, (total - t) / 0.8)
    if k < 1:
        out = Image.blend(Image.new("RGBA", (W, H), (0, 0, 0, 255)), out, clamp(k))
    return out.convert("RGB")


def render(path):
    _, total = timeline()
    n = int(total * FPS)
    ff = subprocess.Popen(["ffmpeg", "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}",
                           "-r", str(FPS), "-i", "-", "-c:v", "libx264", "-preset", "slow", "-crf", "16", "-pix_fmt", "yuv420p",
                           "-movflags", "+faststart", str(path)], stdin=subprocess.PIPE)
    for i in range(n):
        ff.stdin.write(frame(i / FPS).tobytes())
        if i % 150 == 0:
            print(f"{i / FPS:5.1f}s / {total:.1f}s", flush=True)
    ff.stdin.close()
    ff.wait()


def stills(times, path):
    ims = [frame(float(s)) for s in times]
    cols = 3
    rows = math.ceil(len(ims) / cols)
    sw, sh = W // 3, H // 3
    sheet = Image.new("RGB", (cols * sw + (cols - 1) * 8, rows * sh + (rows - 1) * 8), (255, 255, 255))
    for i, im in enumerate(ims):
        sheet.paste(im.resize((sw, sh), Image.LANCZOS), ((i % cols) * (sw + 8), (i // cols) * (sh + 8)))
    sheet.save(path)


if __name__ == "__main__":
    if sys.argv[1:2] == ["stills"]:
        stills(sys.argv[2:], HERE / "stills.png")
    elif sys.argv[1:2] == ["full"]:
        for s in sys.argv[2:]:
            frame(float(s)).save(HERE / f"still_{s}.png")
    else:
        _, total = timeline()
        print(f"{total:.1f}s")
        render(HERE / "trailer.mp4")
