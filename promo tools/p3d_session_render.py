"""Shared by the promo scripts: renders one isometric frame of every model in the GUI session file
(`test sprites/untitled.p3d.json`) through the CLI, so every sheet keeps the settings set up in the GUI
(round sides, straighten, shapes, ends ...). Only the sprite-render export is switched on, and its source
(low-poly mesh or voxels) is chosen here."""
import json
import re
import subprocess
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SESSION = ROOT / "test sprites/untitled.p3d.json"


def render_session(tmp: Path, draw_from: str):
    """draw_from: 'mesh' or 'voxels'. Returns {number: (name, first frame RGBA)} for every model in the session."""
    sess = json.loads(SESSION.read_text(encoding="utf8"))
    sess["exports"]["glb"]["on"] = False
    sess["exports"]["sprites"]["on"] = True
    sess["exports"]["sprites"]["sets"][0]["from"] = draw_from
    f = tmp / f"session_{draw_from}.p3d.json"
    f.write_text(json.dumps(sess), encoding="utf8")
    out = tmp / draw_from
    subprocess.run(["node", str(ROOT / "cli/p3d.mjs"), "run", str(f), "--only", "models", "--out", str(out), "--quiet"],
                   check=True, capture_output=True)
    frames = {}
    for png in sorted((out / "models").glob("*/*_custom.png")):
        m = re.match(r"(\d+) - (.+)_custom$", png.stem)
        strip = Image.open(png).convert("RGBA")
        frames[m.group(1)] = (m.group(2), strip.crop((0, 0, strip.height, strip.height)))   # 1st of the 4 directions
    return frames
