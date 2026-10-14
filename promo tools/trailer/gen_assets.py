"""Makes the raw material for the trailer through the CLI, from the user's tuned session:
  tt_grid/   every model's turntable (mesh), small, for the batch grid
  tt_mesh/   hero models' turntables (mesh), big
  tt_vox/    hero models' turntables (voxels), big
  sets/      the barrel (and a few others) through every sprite set preset
  sheets/    the session's contact sheets and sprites as PNGs
"""
import base64, io, json, subprocess, sys, time
from pathlib import Path
from PIL import Image

ROOT = Path(r"C:\14 Repos\Pixel-To-3D-Batch-Builder")
SESSION = ROOT / "test sprites/untitled.p3d.json"
CLI = ROOT / "cli/p3d.mjs"
OUT = Path(__file__).parent / "assets"
HERO = ["02 - wooden barrel", "28 - chest", "20 - lamp (1)", "10 - basketball", "21 - potted plant (2)", "43 - battle axe",
        "42 - lit torch", "17 - HP kit", "59 - scifi energy pistol", "66 - tyre upright (2)", "01 - large boulder", "04 - wooden crate"]
SET_MODELS = ["02 - wooden barrel", "28 - chest", "20 - lamp (1)", "21 - potted plant (2)", "17 - HP kit"]
SETS = ["isometric", "doom", "rpgmaker", "diablo", "rts", "headon", "sideview", "icon", "battle", "oblique"]


def base():
    return json.loads(SESSION.read_text(encoding="utf8"))


def only(s, names):
    s["sheets"]["rows"] = [r for r in s["sheets"]["rows"] if r["path"].split("__")[0] in names]
    return s


def all_off(s):
    s["sprites"]["rows"] = []
    s["sheets"]["folderPerModel"] = True
    for k in ("glb", "vox", "sides", "stack", "turntable", "palette", "sprites"):
        s["exports"][k]["on"] = False
    return s


def run(name, s):
    d = OUT / "_runs" / name
    d.mkdir(parents=True, exist_ok=True)
    f = d / "s.p3d.json"
    f.write_text(json.dumps(s), encoding="utf8")
    t = time.time()
    r = subprocess.run(["node", str(CLI), "run", str(f), "--only", "models", "--out", str(d / "out"), "--quiet"],
                       capture_output=True, text=True, encoding="utf8")
    if r.returncode:
        sys.exit(f"{name} failed:\n{r.stdout}\n{r.stderr}")
    print(name, f"{time.time() - t:.0f}s", flush=True)
    return d / "out/models"


def gif_frames(gif, dest):
    dest.mkdir(parents=True, exist_ok=True)
    im = Image.open(gif)
    i = 0
    while True:
        im.convert("RGBA").save(dest / f"{i:03d}.png")
        i += 1
        try:
            im.seek(i)
        except EOFError:
            break


def turntables(tag, names, size, frames, src):
    s = all_off(base())
    if names:
        only(s, names)
    s["exports"]["turntable"].update(on=True, elev=15, frames=frames, size=size, **{"from": src})
    models = run(tag, s)
    for gif in models.glob("*/*_turntable.gif"):
        gif_frames(gif, OUT / tag / gif.parent.name)


def sets():
    s = only(all_off(base()), SET_MODELS)
    meta = ("order", "id", "name", "file", "sub", "tip")
    presets = []
    for pid in SETS:
        p = json.loads((ROOT / "presets/sprite-sets" / f"{pid}.json").read_text(encoding="utf8"))
        presets.append({"preset": p["id"], **{k: v for k, v in p.items() if k not in meta}, "from": "mesh", "open": False})
    s["exports"]["sprites"].update(on=True, sets=presets)
    models = run("sets", s)
    for png in models.glob("*/*.png"):
        d = OUT / "sets" / png.parent.name
        d.mkdir(parents=True, exist_ok=True)
        Image.open(png).save(d / png.name)


def sheets():
    s = base()
    d = OUT / "sheets"
    d.mkdir(parents=True, exist_ok=True)
    for im in s["images"].values():
        Image.open(io.BytesIO(base64.b64decode(im["png"].split(",")[1]))).save(d / Path(im["path"]).name)


if __name__ == "__main__":
    what = sys.argv[1:] or ["sheets", "grid", "mesh", "vox", "sets"]
    if "sheets" in what: sheets()
    if "grid" in what: turntables("tt_grid", None, 160, 72, "mesh")
    if "mesh" in what: turntables("tt_mesh", HERO, 400, 90, "mesh")
    if "vox" in what: turntables("tt_vox", HERO, 400, 90, "voxels")
    if "sets" in what: sets()
