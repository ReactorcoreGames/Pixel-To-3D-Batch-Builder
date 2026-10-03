"""Makes promo/godot example previewer grid.png and ...single.png: the plain Godot screenshots with a "bonus" sticker on top.

The plain screenshots stay in "promo tools/godot source/" so the sticker can be redone.
Run from anywhere:  python "promo tools/make_godot_stamp.py"
Needs: Pillow, fontTools, brotli (pip install pillow fonttools brotli).
"""
import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

from make_cover_thumb import LIME, ROOT, SUN, TANGERINE, WHITE, nunito, pixel

INK = (23, 19, 39)
SRC = ROOT / "promo tools/godot source"


def sticker() -> Image.Image:
    """The tilted badge with its starburst seal, on a transparent canvas."""
    W, H = 760, 260
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    # the banner: dark outline, white rim, yellow face
    bx0, by0, bx1, by1 = 120, 62, 740, 206
    d.rounded_rectangle((bx0 - 8, by0 - 8, bx1 + 8, by1 + 8), 30, fill=INK)
    d.rounded_rectangle((bx0 - 3, by0 - 3, bx1 + 3, by1 + 3), 26, fill=WHITE)
    d.rounded_rectangle((bx0 + 3, by0 + 3, bx1 - 3, by1 - 3), 22, fill=SUN)
    tx = 236
    d.text((tx, by0 + 14), "BONUS INSIDE:", font=nunito(26), fill=(120, 70, 10))
    d.text((tx, by0 + 40), "Godot 4 previewer", font=pixel(50), fill=INK)
    d.text((tx, by0 + 98), "Your models under real lighting!", font=nunito(25), fill=INK)
    # the seal: a starburst overlapping the banner's left end
    cx, cy, r_out, r_in, n = 128, 134, 112, 90, 18
    pts = [(cx + (r_out if i % 2 == 0 else r_in) * math.cos(math.pi * i / n - math.pi / 2),
            cy + (r_out if i % 2 == 0 else r_in) * math.sin(math.pi * i / n - math.pi / 2)) for i in range(2 * n)]
    d.polygon(pts, fill=INK)
    small = [(cx + (x - cx) * 0.93, cy + (y - cy) * 0.93) for x, y in pts]
    d.polygon(small, fill=WHITE)
    tiny = [(cx + (x - cx) * 0.88, cy + (y - cy) * 0.88) for x, y in pts]
    d.polygon(tiny, fill=TANGERINE)
    d.ellipse((cx - 70, cy - 70, cx + 70, cy + 70), outline=(255, 235, 200), width=3)
    d.text((cx, cy - 16), "GLB", font=pixel(38), fill=WHITE, anchor="mm", stroke_width=3, stroke_fill=INK)
    d.text((cx, cy + 22), "VIEWER", font=nunito(24), fill=INK, anchor="mm")
    d.text((cx, cy + 46), "INCLUDED", font=nunito(17), fill=INK, anchor="mm")
    return img.rotate(5, resample=Image.Resampling.BICUBIC, expand=True)


def stamp(name: str, centre):
    base = Image.open(SRC / name).convert("RGBA")
    s = sticker()
    s = s.resize((int(s.width * 0.88), int(s.height * 0.88)), Image.Resampling.LANCZOS)
    x, y = int(centre[0] - s.width / 2), int(centre[1] - s.height / 2)
    shadow = Image.new("RGBA", s.size, (8, 6, 16, 0))
    shadow.putalpha(s.getchannel("A").point(lambda v: v * 0.6).filter(ImageFilter.GaussianBlur(10)))
    base.alpha_composite(shadow, (x + 6, y + 10))
    base.alpha_composite(s, (x, y))
    base.convert("RGB").save(ROOT / "promo" / name, optimize=True)


if __name__ == "__main__":
    stamp("godot example previewer grid.png", (620, 150))
    stamp("godot example previewer single.png", (612, 100))
    print("wrote the two promo/godot example previewer images")
