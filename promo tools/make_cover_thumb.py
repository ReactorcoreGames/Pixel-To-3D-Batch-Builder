"""Makes promo/cover_1280x720.png and promo/thumbnail_630x500.png: big title text over promo/icon_og_main.png.

Uses the app's own fonts (public/fonts, converted from woff2 on the fly).
Run from anywhere:  python "promo tools/make_cover_thumb.py"
Needs: Pillow, fontTools, brotli (pip install pillow fonttools brotli).
"""
import io
from pathlib import Path

from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
ART = Image.open(ROOT / "promo/icon_og_main.png").convert("RGB")

BG = (23, 19, 39)
TANGERINE, LIME, SUN, WHITE, LAVENDER = (255, 154, 60), (143, 220, 74), (255, 210, 63), (245, 240, 255), (185, 174, 224)


def font(name: str, weight: int, size: int) -> ImageFont.FreeTypeFont:
    f = TTFont(ROOT / "public/fonts" / name)
    f.flavor = None
    if "fvar" in f:
        f = instancer.instantiateVariableFont(f, {"wght": weight})
    buf = io.BytesIO()
    f.save(buf)
    buf.seek(0)
    return ImageFont.truetype(buf, size)


def pixel(size): return font("pixelify-sans-latin.woff2", 700, size)
def nunito(size): return font("nunito-latin.woff2", 900, size)


def text(img: Image.Image, xy, parts, fnt, shadow=8, anchor="la"):
    """Draws [(string, colour), ...] side by side with a strong dark shadow behind."""
    x, y = xy
    widths = [fnt.getlength(s) for s, _ in parts]
    if anchor == "ma":
        x -= sum(widths) / 2
    layer = Image.new("L", img.size, 0)
    d = ImageDraw.Draw(layer)
    cx = x
    for (s, _), w in zip(parts, widths):
        d.text((cx, y), s, font=fnt, fill=255, stroke_width=shadow // 2, stroke_fill=255)
        cx += w
    glow = layer.filter(ImageFilter.GaussianBlur(shadow))
    img.paste(Image.new("RGB", img.size, (8, 6, 16)), (0, 0), glow.point(lambda v: min(255, v * 3)))
    img.paste(Image.new("RGB", img.size, (8, 6, 16)), (0, 0), layer)
    d = ImageDraw.Draw(img)
    cx = x
    for (s, c), w in zip(parts, widths):
        d.text((cx, y), s, font=fnt, fill=c)
        cx += w


def fade(size, horizontal: bool, start: float, end: float) -> Image.Image:
    """A mask going from 0 at `start` to 255 at `end` (fractions of the width or height; end < start fades the other way)."""
    w, h = size
    n = w if horizontal else h
    vals = [int(255 * min(1, max(0, (i / n - start) / (end - start)))) for i in range(n)]
    line = Image.new("L", (n, 1))
    line.putdata(vals)
    return line.resize((w, h)) if horizontal else line.transpose(Image.Transpose.ROTATE_270).resize((w, h))


def dots(img: Image.Image, step=18, colour=(34, 28, 58)):
    d = ImageDraw.Draw(img)
    for y in range(step // 2, img.height, step):
        for x in range(step // 2, img.width, step):
            d.ellipse((x - 1.5, y - 1.5, x + 1.5, y + 1.5), fill=colour)


def cover():
    W, H = 1280, 720
    img = Image.new("RGB", (W, H), BG)
    dots(img)
    art = ART.resize((760, 760), Image.Resampling.LANCZOS).crop((0, 20, 760, 740))
    # the art sits on the right and fades into the background on its left
    img.paste(art, (W - 760, 0), fade(art.size, True, 0.0, 0.22))
    text(img, (56, 70), [("Pixel", TANGERINE), (" to ", WHITE), ("3D", LIME)], pixel(124))
    text(img, (62, 218), [("BATCH BUILDER", SUN)], nunito(54))
    lines = [[("Pixel sprites in,", WHITE)], [("3D models out.", WHITE)], [("Hundreds at once.", SUN)]]
    for i, ln in enumerate(lines):
        text(img, (62, 330 + i * 62), ln, nunito(50))
    text(img, (62, 540), [("GLB", LIME), ("  ·  ", LAVENDER), ("VOX", LIME), ("  ·  ", LAVENDER), ("SPRITE SHEETS", LIME)], nunito(38))
    text(img, (62, 600), [("SNES / N64 / PS1 look", TANGERINE)], nunito(38))
    img.save(ROOT / "promo/cover_1280x720.png", optimize=True)


def thumbnail():
    W, H = 630, 500
    art = ART.resize((630, 630), Image.Resampling.LANCZOS).crop((0, 70, 630, 570))
    img = art.copy()
    dark = Image.new("RGB", (W, H), BG)
    # darken the top and bottom bands where the text goes
    img.paste(dark, (0, 0), fade((W, H), False, 0.36, 0.0).point(lambda v: int(v * 0.85)))
    img.paste(dark, (0, 0), fade((W, H), False, 0.66, 1.0).point(lambda v: int(v * 0.85)))
    text(img, (W // 2, 14), [("Pixel", TANGERINE), (" to ", WHITE), ("3D", LIME)], pixel(98), anchor="ma")
    text(img, (W // 2, 126), [("BATCH BUILDER", SUN)], nunito(40), anchor="ma")
    text(img, (W // 2, 372), [("Sprites ", WHITE), ("to", SUN), (" 3D models", WHITE)], nunito(46), anchor="ma")
    text(img, (W // 2, 432), [("GLB", LIME), (" · ", LAVENDER), ("VOX", LIME), (" · ", LAVENDER), ("SPRITES", LIME)], nunito(38), anchor="ma")
    img.save(ROOT / "promo/thumbnail_630x500.png", optimize=True)


if __name__ == "__main__":
    cover()
    thumbnail()
    print("wrote promo/cover_1280x720.png and promo/thumbnail_630x500.png")
