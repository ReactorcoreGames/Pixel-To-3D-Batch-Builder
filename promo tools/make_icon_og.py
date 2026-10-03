"""Composes promo/icon_og_main.png (1024x1024) from real project assets.

- 3D renders: one isometric frame per model, made by the CLI (cli/p3d.mjs) from the example
  sheets, drawn from the low-poly mesh (LEFT) or from the voxels (RIGHT)
- the hero cube is drawn here on a chunky 4px grid: bevelled brand-colour faces in a dark frame
- every object gets a thin bright white outline plus a soft white glow (no shadows)

Run from anywhere:  python "promo tools/make_icon_og.py"
Needs: Pillow, Node.js (for the CLI).
"""
import math
import random
import tempfile
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter

from p3d_session_render import render_session

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "promo/icon_og_main.png"
S = 1024
random.seed(7)

# brand colours
BG, PLUM = (23, 19, 39), (38, 32, 67)
TANGERINE, LIME, SUN = (255, 154, 60), (143, 220, 74), (255, 210, 63)
PERI, SKY = (124, 108, 255), (77, 184, 255)

# which sheet goes to which engine; (sheet number prefix, frame 0-3)
MESH_MODELS = ["28", "20", "29", "56", "22"]                    # chest, lamp, lock, bottle, flower plant
VOX_MODELS = ["04", "17", "42", "63", "43", "14", "40"]         # crate, HP kit, torch, AK, axe, volleyball, flashlight


def render_models(tmp: Path):
    """{number: cropped frame}: low-poly for MESH_MODELS, voxel for VOX_MODELS, with the session's settings."""
    mesh, vox = render_session(tmp, "mesh"), render_session(tmp, "voxels")
    frames = {}
    for src, nums in ((mesh, MESH_MODELS), (vox, VOX_MODELS)):
        for n in nums:
            f = src[n][1]
            frames[n] = f.crop(f.getbbox())
    return frames


def up(img, k):
    return img.resize((img.width * k, img.height * k), Image.NEAREST)


def snap(v):
    return int(v) // 4 * 4


# ---------------------------------------------------------------- background
def background():
    img = Image.new("RGB", (S, S), BG)
    # soft plum glow behind the cube + vignette
    glow = Image.new("RGB", (S, S), BG)
    gd = ImageDraw.Draw(glow)
    cx, cy = 512, 450
    for r in range(560, 0, -8):
        t = (1 - r / 560) ** 1.7
        c = tuple(int(BG[i] + (PLUM[i] - BG[i]) * t * 1.15 + ((110, 70, 190)[i] - BG[i]) * t ** 3 * 0.35) for i in range(3))
        gd.ellipse((cx - r, cy - r, cx + r, cy + r), fill=c)
    img = glow.filter(ImageFilter.GaussianBlur(14))
    d = ImageDraw.Draw(img)
    # faint dot grid
    for y in range(32, S, 48):
        for x in range(32, S, 48):
            dist = math.hypot(x - cx, y - cy)
            a = max(0.0, 1 - dist / 700)
            c = tuple(int(BG[i] + (PERI[i] - BG[i]) * (0.30 + 0.45 * a)) for i in range(3))
            d.rectangle((x - 2, y - 2, x + 2, y + 2), fill=c)
    return img.convert("RGBA")


# ---------------------------------------------------------------- hero cube
def lerp(c1, c2, t):
    t = max(0.0, min(1.0, t))
    return tuple(c1[i] + (c2[i] - c1[i]) * t for i in range(3))


def hero_cube():
    """Isometric cube on a 4px grid: three faces with diagonal gradients, a light bevel and a soft gloss."""
    W, E = 44, 44
    H = W // 2
    gw, gh = 2 * W + 6, 2 * H + E + 6
    cx, top = gw // 2, 3
    T, R, Ct, L = (cx, top), (cx + W, top + H), (cx, top + 2 * H), (cx - W, top + H)
    BL, BR, B = (L[0], L[1] + E), (R[0], R[1] + E), (Ct[0], Ct[1] + E)
    faces = {                    # polygon, light corner colour, deep corner colour, bevel colour
        "T": ([T, R, Ct, L], (255, 240, 150), (255, 176, 40), (255, 250, 205)),
        "L": ([L, Ct, B, BL], (255, 182, 92), (214, 70, 14), (255, 214, 150)),
        "R": ([Ct, R, BR, B], (204, 246, 104), (70, 164, 40), (232, 255, 170)),
    }
    im = Image.new("RGBA", (gw, gh), (0, 0, 0, 0))
    px = im.load()
    for key, (poly, light, deep, bevel) in faces.items():
        m = Image.new("L", (gw, gh), 0)
        ImageDraw.Draw(m).polygon(poly, fill=255)
        inner = Image.new("L", (gw, gh), 0)
        mx = sum(p[0] for p in poly) / 4
        my = sum(p[1] for p in poly) / 4
        ImageDraw.Draw(inner).polygon([(mx + (x - mx) * 0.9, my + (y - my) * 0.9) for x, y in poly], fill=255)
        mp, ip = m.load(), inner.load()
        for y in range(gh):
            for x in range(gw):
                if not mp[x, y]:
                    continue
                if key == "T":                      # light from the back corner, deepening toward the front
                    t = ((y - top) / (2 * H)) * 0.8 + abs(x - cx) / W * 0.35
                elif key == "L":                    # light at the top-left, deep at the bottom
                    t = (y - L[1]) / (E + H) * 0.9 + (x - L[0]) / W * 0.25
                else:                               # light at the top-right, deep at the bottom
                    t = (y - R[1]) / (E + H) * 0.9 + (R[0] - x) / W * 0.25
                c = lerp(light, deep, t)
                if not ip[x, y]:
                    c = lerp(c, bevel, 0.55)        # bevel rim
                px[x, y] = tuple(int(v) for v in c) + (255,)
    # gloss streaks and a few chunky highlight pixels
    d = ImageDraw.Draw(im)
    for (x, y, w) in ((cx - 18, top + 9, 6), (cx - 8, top + 6, 4), (cx - 26, top + 13, 3)):
        d.rectangle((x, y, x + w, y + 1), fill=(255, 252, 215, 255))
    d.rectangle((cx - 36, top + H + 8, cx - 35, top + H + 20), fill=(255, 230, 190, 255))
    d.rectangle((cx + 34, top + H + 8, cx + 35, top + H + 14), fill=(240, 255, 200, 255))
    # crisp light seam where the three faces meet
    d.line((Ct, B), fill=(255, 250, 215, 255), width=1)
    return up(im, 4)


def starburst(canvas, cx, cy, rays=12, length=820):
    """Soft rays of light in every direction, fading with distance, drawn behind the cube."""
    sc = 2
    layer = Image.new("L", (S * sc, S * sc), 0)
    d = ImageDraw.Draw(layer)
    for i in range(rays):
        ang = 2 * math.pi * i / rays + 0.07
        ln = length * (1.0 if i % 2 == 0 else 0.62)
        half = math.radians(2.6 if i % 2 == 0 else 2.0)
        pts = [(cx * sc, cy * sc)]
        for a in (ang - half, ang + half):
            pts.append(((cx + math.cos(a) * ln) * sc, (cy + math.sin(a) * ln) * sc))
        d.polygon(pts, fill=255)
    layer = layer.resize((S, S), Image.LANCZOS).filter(ImageFilter.GaussianBlur(1.2))
    fade = Image.new("L", (S, S), 0)
    fd = ImageDraw.Draw(fade)
    for r in range(length, 0, -6):
        fd.ellipse((cx - r, cy - r, cx + r, cy + r), fill=int(210 * (1 - r / length) ** 1.5))
    alpha = ImageChops.multiply(layer, fade)
    rays_img = Image.new("RGBA", (S, S), (255, 234, 160, 255))
    rays_img.putalpha(alpha)
    canvas.alpha_composite(rays_img)


# ---------------------------------------------------------------- helpers for the composition
def glow_blob(canvas, cx, cy, r, color, strength):
    layer = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=color + (int(255 * strength),))
    layer = layer.filter(ImageFilter.GaussianBlur(r * 0.55))
    canvas.alpha_composite(layer)


def place(canvas, img, cx, cy):
    """Centre img on (cx, cy), snapped to the 4px grid, with a thin bright white outline and a soft glow."""
    x, y = snap(cx - img.width / 2), snap(cy - img.height / 2)
    pad = 24
    a = Image.new("L", (img.width + 2 * pad, img.height + 2 * pad), 0)
    a.paste(img.getchannel("A").point(lambda v: 255 if v > 40 else 0), (pad, pad))
    ring = ImageChops.subtract(a.filter(ImageFilter.MaxFilter(5)), a)          # 2px hard ring
    glow = a.filter(ImageFilter.MaxFilter(9)).filter(ImageFilter.GaussianBlur(7)).point(lambda v: int(v * 0.55))
    white = Image.new("RGBA", a.size, (255, 255, 255, 255))
    gl = white.copy(); gl.putalpha(glow)
    rg = white.copy(); rg.putalpha(ring)
    canvas.alpha_composite(gl, (x - pad, y - pad))
    canvas.alpha_composite(rg, (x - pad, y - pad))
    canvas.alpha_composite(img, (x, y))


def sparkle(canvas, cx, cy, size, color=(255, 236, 160)):
    """4-point pixel star on the 4px grid."""
    d = ImageDraw.Draw(canvas)
    cx, cy = snap(cx), snap(cy)
    for i in range(1, size + 1):
        a = int(255 * (1 - i / (size + 1)) ** 0.6)
        for ox, oy in ((i, 0), (-i, 0), (0, i), (0, -i)):
            d.rectangle((cx + ox * 4, cy + oy * 4, cx + ox * 4 + 3, cy + oy * 4 + 3), fill=color + (a,))
    d.rectangle((cx, cy, cx + 3, cy + 3), fill=(255, 255, 255, 255))
    glow_blob(canvas, cx + 2, cy + 2, size * 6, color, 0.35)


def confetti(canvas, n, avoid, colors, region=(0, 0, S, S)):
    d = ImageDraw.Draw(canvas)
    tries = 0
    while n > 0 and tries < 5000:
        tries += 1
        x = snap(random.uniform(region[0], region[2]))
        y = snap(random.uniform(region[1], region[3]))
        if any(math.hypot(x - ax, y - ay) < ar for ax, ay, ar in avoid):
            continue
        sz = random.choice((4, 4, 4, 8))
        c = random.choice(colors)
        d.rectangle((x, y, x + sz - 1, y + sz - 1), fill=c + (random.choice((110, 170, 230)),))
        n -= 1


# ---------------------------------------------------------------- main
def main():
    with tempfile.TemporaryDirectory() as t:
        models = render_models(Path(t))

    canvas = background()
    cx, cy = 512, 420

    # hero cube with glow
    glow_blob(canvas, cx, cy, 340, (140, 80, 235), 0.75)
    glow_blob(canvas, cx, cy, 230, (255, 150, 70), 0.40)
    starburst(canvas, cx, cy)
    place(canvas, hero_cube(), cx, cy)

    # every object is a real model from the CLI: low-poly on the left, voxel on the right
    r3d = [
        # sheet number, scale, centre
        ("43", 3, (185, 130)),     # battle axe  (vox)
        ("63", 3, (860, 92)),     # assault rifle (vox)
        ("28", 3, (150, 310)),     # chest   (mesh)
        ("29", 3, (80, 505)),      # lock    (mesh)
        ("20", 3, (235, 680)),     # lamp    (mesh)
        ("22", 3, (95, 800)),     # flower plant (mesh)
        ("56", 3, (375, 845)),     # bottle  (mesh)
        ("04", 3, (850, 275)),     # crate   (vox)
        ("14", 3, (925, 465)),     # volleyball (vox)
        ("17", 3, (815, 655)),     # HP kit  (vox)
        ("42", 3, (690, 835)),     # torch   (vox)
        ("40", 3, (895, 830)),     # flashlight (vox)
    ]
    avoid = [(cx, cy, 260)]
    for num, k, (x, y) in r3d:
        f = up(models[num], k)
        place(canvas, f, x, y)
        avoid.append((x, y, max(f.size) // 2 + 20))

    confetti(canvas, 70, avoid, [SUN, TANGERINE, LIME, SKY, PERI, (240, 235, 255)], (20, 20, S - 20, 880))
    for (x, y, s) in [(470, 190, 3), (640, 360, 2), (395, 520, 2), (610, 650, 3), (440, 790, 2), (820, 400, 2), (210, 440, 2)]:
        sparkle(canvas, x, y, s)

    # keep the lower third calmer for a title: gently darken it
    fade = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    fd = ImageDraw.Draw(fade)
    for y in range(840, S):
        fd.line((0, y, S, y), fill=(BG[0], BG[1], BG[2], int(120 * (y - 840) / (S - 840))))
    # (applied before we decide below whether to use it)
    canvas.alpha_composite(fade)

    canvas.convert("RGB").save(OUT)
    print("wrote", OUT)


if __name__ == "__main__":
    main()
