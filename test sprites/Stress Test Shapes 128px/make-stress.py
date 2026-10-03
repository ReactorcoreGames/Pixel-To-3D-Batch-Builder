# Makes 128x128 noise-filled shape sprites for the performance pass.
# Each shape is written once per cross-section shape to try; set the row's shape to match the name.
import random, math
from PIL import Image

N = 128
def inside(name, x, y):
    cx, cy = x - 63.5, y - 63.5
    if name == "rectangle": return 4 <= x < 124 and 20 <= y < 108
    if name == "triangle": return 6 <= y < 122 and abs(cx) <= (y - 6) * 0.52
    if name == "diamond": return abs(cx) + abs(cy) <= 62
    r = math.hypot(cx, cy)
    if name == "circle": return r <= 62
    if name == "donut": return 26 <= r <= 62

for i, shape in enumerate(["rectangle", "triangle", "diamond", "circle", "donut"], 1):
    for mode in ["box", "tube", "diamond", "egg", "gem"]:
        rnd = random.Random(f"{shape}-{mode}")
        img = Image.new("RGBA", (N, N), (0, 0, 0, 0))
        for y in range(N):
            for x in range(N):
                if inside(shape, x, y):
                    edge = not all(inside(shape, x + dx, y + dy) for dx, dy in ((1,0),(-1,0),(0,1),(0,-1)))
                    img.putpixel((x, y), (24, 20, 30, 255) if edge else tuple(rnd.randrange(40, 230) for _ in range(3)) + (255,))
        img.save(f"{i}{'abcde'['box tube diamond egg gem'.split().index(mode)]} - {shape} - {mode}.png")
