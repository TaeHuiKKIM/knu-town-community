"""Build lightweight destination cards from the same map art as the game."""
import json
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image

root = Path(__file__).resolve().parents[2]
assets = root / "design/stage1/assets"
dest = assets / "previews"
dest.mkdir(exist_ok=True)
catalog = subprocess.check_output(
    ["node", "--input-type=module", "-e",
     "import {SCENES} from './public/campus/scenes.js'; console.log(JSON.stringify(SCENES));"],
    cwd=root, encoding="utf-8",
)
scenes = json.loads(catalog)
selected = sys.argv[1:] or list(scenes)
unknown = set(selected) - scenes.keys()
if unknown:
    raise SystemExit("Unknown scene: " + ", ".join(sorted(unknown)))
with tempfile.TemporaryDirectory() as temporary:
    layered = [key for key in selected if key in {"lecture", "lounge"} or scenes[key].get("signs")]
    if layered:
        helper = Path(__file__).with_name("render-place-layers.mjs")
        subprocess.run(["node", str(helper), temporary, *layered], cwd=root, check=True)
    for key in selected:
        source = Path(temporary) / (key + ".png") if key in layered else assets / Path(scenes[key]["image"]).name
        with Image.open(source) as image:
            image.thumbnail((240, 160), Image.Resampling.LANCZOS)
            image.convert("RGB").quantize(192).save(dest / (key + ".png"), optimize=True)
