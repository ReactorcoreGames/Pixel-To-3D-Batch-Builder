"""A tiny numpy software renderer: textured GLB meshes and MagicaVoxel .vox models, orthographic camera, z-buffer,
simple key + fill lighting, supersampled. Enough for crisp promo renders without Blender or Godot."""
import io
import json
import struct

import numpy as np
from PIL import Image


def load_glb(path):
    b = open(path, "rb").read()
    jl = struct.unpack("<I", b[12:16])[0]
    j = json.loads(b[20:20 + jl])
    bin_ = b[20 + jl + 8:]

    def view(i):
        v = j["bufferViews"][i]
        return bin_[v.get("byteOffset", 0):v.get("byteOffset", 0) + v["byteLength"]]

    def acc(i):
        a = j["accessors"][i]
        dt = {5126: np.float32, 5123: np.uint16, 5125: np.uint32}[a["componentType"]]
        n = {"SCALAR": 1, "VEC2": 2, "VEC3": 3}[a["type"]]
        return np.frombuffer(view(a["bufferView"]), dtype=dt).reshape(-1, n) if n > 1 else np.frombuffer(view(a["bufferView"]), dtype=dt)

    prim = j["meshes"][0]["primitives"][0]
    imgs = [Image.open(io.BytesIO(view(im["bufferView"]))).convert("RGBA") for im in j["images"]]
    mat = j["materials"][prim["material"]]

    def tex(key):
        t = mat.get(key) or mat["pbrMetallicRoughness"].get(key)
        return imgs[j["textures"][t["index"]]["source"]] if t else None

    return dict(pos=acc(prim["attributes"]["POSITION"]).astype(float), nrm=acc(prim["attributes"]["NORMAL"]).astype(float),
                uv=acc(prim["attributes"]["TEXCOORD_0"]).astype(float), idx=acc(prim["indices"]).astype(int).reshape(-1, 3),
                base=tex("baseColorTexture"), normal=tex("normalTexture"), ao=tex("occlusionTexture"))


def load_vox(path):
    b = open(path, "rb").read()
    i = 8
    size, vox, pal = None, None, None

    def walk(i, end):
        nonlocal size, vox, pal
        while i < end:
            cid = b[i:i + 4]; n, m = struct.unpack("<II", b[i + 4:i + 12])
            body = b[i + 12:i + 12 + n]
            if cid == b"SIZE":
                size = struct.unpack("<III", body)
            elif cid == b"XYZI":
                k = struct.unpack("<I", body[:4])[0]
                vox = np.frombuffer(body[4:4 + 4 * k], dtype=np.uint8).reshape(-1, 4)
            elif cid == b"RGBA":
                pal = np.frombuffer(body, dtype=np.uint8).reshape(-1, 4)
            if m:
                walk(i + 12 + n, i + 12 + n + m)
            i += 12 + n + m
    walk(i, len(b))
    return size, vox, pal


def camera(yaw, elev):
    y, e = np.radians(yaw), np.radians(elev)
    ry = np.array([[np.cos(y), 0, np.sin(y)], [0, 1, 0], [-np.sin(y), 0, np.cos(y)]])
    rx = np.array([[1, 0, 0], [0, np.cos(e), -np.sin(e)], [0, np.sin(e), np.cos(e)]])
    return rx @ ry   # world -> view: x right, y up, z towards the viewer


LIGHT = np.array([-0.55, 0.75, 0.55]); LIGHT /= np.linalg.norm(LIGHT)
FILL = np.array([0.7, 0.1, 0.3]); FILL /= np.linalg.norm(FILL)


def shade(n_world):
    k = np.clip(n_world @ LIGHT, 0, 1)
    f = np.clip(n_world @ FILL, 0, 1)
    return 0.42 + 0.68 * k + 0.16 * f


def raster(tris_view, attrs, W, H, fragment):
    """tris_view: (T,3,3) in pixel space (x, y down, z towards viewer). attrs: (T,3,K) per-vertex attributes.
    fragment(attr (N,K), tri ids (N,)) -> rgb (N,3). Returns RGBA image array."""
    zbuf = np.full((H, W), -1e9)
    out_attr = np.zeros((H, W, attrs.shape[2]))
    out_tri = np.full((H, W), -1)
    for t in range(len(tris_view)):
        p = tris_view[t]
        x0, x1 = int(max(0, np.floor(p[:, 0].min()))), int(min(W - 1, np.ceil(p[:, 0].max())))
        y0, y1 = int(max(0, np.floor(p[:, 1].min()))), int(min(H - 1, np.ceil(p[:, 1].max())))
        if x1 < x0 or y1 < y0:
            continue
        xs, ys = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
        (ax, ay, _), (bx, by, _), (cx, cy, _) = p
        d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
        if abs(d) < 1e-12:
            continue
        w0 = ((by - cy) * (xs - cx) + (cx - bx) * (ys - cy)) / d
        w1 = ((cy - ay) * (xs - cx) + (ax - cx) * (ys - cy)) / d
        w2 = 1 - w0 - w1
        inside = (w0 >= -1e-6) & (w1 >= -1e-6) & (w2 >= -1e-6)
        if not inside.any():
            continue
        z = w0 * p[0, 2] + w1 * p[1, 2] + w2 * p[2, 2]
        sub = zbuf[y0:y1 + 1, x0:x1 + 1]
        win = inside & (z > sub)
        if not win.any():
            continue
        sub[win] = z[win]
        a = w0[win][:, None] * attrs[t, 0] + w1[win][:, None] * attrs[t, 1] + w2[win][:, None] * attrs[t, 2]
        out_attr[y0:y1 + 1, x0:x1 + 1][win] = a
        out_tri[y0:y1 + 1, x0:x1 + 1][win] = t
    mask = out_tri >= 0
    img = np.zeros((H, W, 4))
    img[mask, :3] = fragment(out_attr[mask], out_tri[mask])
    img[mask, 3] = 255
    return np.clip(img, 0, 255).astype(np.uint8)


def fit(points_view, W, H, margin):
    lo, hi = points_view[:, :2].min(0), points_view[:, :2].max(0)
    s = min((W - 2 * margin) / (hi[0] - lo[0]), (H - 2 * margin) / (hi[1] - lo[1]))
    cx, cy = (lo + hi) / 2

    def to_px(v):
        return np.stack([(v[..., 0] - cx) * s + W / 2, -(v[..., 1] - cy) * s + H / 2, v[..., 2] * s], -1)
    return to_px


def downsample(arr, ss):
    im = Image.fromarray(arr, "RGBA")
    # premultiply so the transparent edges don't go dark
    a = np.asarray(im).astype(float)
    a[..., :3] *= a[..., 3:4] / 255
    small = Image.fromarray(a.astype(np.uint8), "RGBA").resize((im.width // ss, im.height // ss), Image.Resampling.LANCZOS)
    s = np.asarray(small).astype(float)
    al = np.maximum(s[..., 3:4], 1)
    s[..., :3] = np.clip(s[..., :3] * 255 / al, 0, 255)
    return Image.fromarray(s.astype(np.uint8), "RGBA")


def render_glb(path, W, H, yaw=35, elev=22, ss=3, margin=10, use_ao=True):
    m = load_glb(path)
    R = camera(yaw, elev)
    pv = m["pos"] @ R.T
    to_px = fit(pv, W * ss, H * ss, margin * ss)
    tris = to_px(pv[m["idx"]])
    attrs = np.concatenate([m["uv"][m["idx"]], m["nrm"][m["idx"]]], -1)
    base = np.asarray(m["base"]).astype(float)
    ao = np.asarray(m["ao"]).astype(float)[..., 0] / 255 if (use_ao and m["ao"] is not None) else None
    th, tw = base.shape[:2]

    def frag(a, _):
        u = np.clip((a[:, 0] * tw).astype(int), 0, tw - 1)
        v = np.clip((a[:, 1] * th).astype(int), 0, th - 1)
        n = a[:, 2:5] / np.linalg.norm(a[:, 2:5], axis=1, keepdims=True)
        c = base[v, u, :3] * shade(n)[:, None]
        if ao is not None:
            c *= (0.55 + 0.45 * ao[v, u])[:, None]
        return c
    return downsample(raster(tris, attrs, W * ss, H * ss, frag), ss)


def render_vox(path, W, H, yaw=35, elev=22, ss=3, margin=10):
    size, vox, pal = load_vox(path)
    occ = set(map(tuple, vox[:, :3].tolist()))
    # MagicaVoxel is z-up; turn it into y-up world coordinates (x, z, -y), centred on the floor
    faces = []   # (4 corners world, normal world, colour)
    dirs = [((1, 0, 0), (1, 0, 0)), ((-1, 0, 0), (-1, 0, 0)), ((0, 1, 0), (0, 0, -1)), ((0, -1, 0), (0, 0, 1)),
            ((0, 0, 1), (0, 1, 0)), ((0, 0, -1), (0, -1, 0))]
    sx, sy, sz = size
    for x, y, z, c in vox.tolist():
        col = pal[c - 1][:3].astype(float)
        for dv, nw in dirs:
            if (x + dv[0], y + dv[1], z + dv[2]) in occ:
                continue
            # the face's 4 corners in vox space
            ax = [i for i in range(3) if dv[i] == 0]
            base = [x, y, z]
            k = [i for i in range(3) if dv[i] != 0][0]
            base[k] += 1 if dv[k] > 0 else 0
            corners = []
            for a, b in ((0, 0), (1, 0), (1, 1), (0, 1)):
                q = list(base); q[ax[0]] += a; q[ax[1]] += b
                corners.append(q)
            cw = np.array([[q[0] - sx / 2, q[2], -(q[1] - sy / 2)] for q in corners], float)
            faces.append((cw, np.array(nw, float), col))
    R = camera(yaw, elev)
    allp = np.concatenate([f[0] for f in faces]) @ R.T
    to_px = fit(allp, W * ss, H * ss, margin * ss)
    tris, attrs, cols = [], [], []
    quv = np.array([[0, 0], [1, 0], [1, 1], [0, 1]], float)
    for i, (cw, nw, col) in enumerate(faces):
        pv = to_px(cw @ R.T)
        for tri in ((0, 1, 2), (0, 2, 3)):
            tris.append(pv[list(tri)])
            attrs.append(np.concatenate([quv[list(tri)], np.full((3, 1), i)], 1))
    tris, attrs = np.array(tris), np.array(attrs)
    fcol = np.array([f[2] for f in faces]); fn = np.array([f[1] for f in faces])

    def frag(a, _):
        fi = np.rint(a[:, 2]).astype(int)
        c = fcol[fi] * shade(fn[fi])[:, None]
        e = np.minimum(np.minimum(a[:, 0], 1 - a[:, 0]), np.minimum(a[:, 1], 1 - a[:, 1]))
        c *= (0.86 + 0.14 * np.clip(e / 0.12, 0, 1))[:, None]   # a soft seam between voxels
        return c
    return downsample(raster(tris, attrs, W * ss, H * ss, frag), ss)
