"""The blur switch with the REAL shipped face finder, a clip that has faces in it and the REAL engine (WORKER 48 found two faults the fake-finder check could not: CC1 09:29).

    py -I tools/check-maker-blur-real.py <Ryagram checkout> <scratch base folder on D:> <a video with faces in it> [<yunet.onnx>]

What it proves, with nothing faked but the file dialog: with the switch ON the editor's Build final film makes a film whose faces are pixelated (the picture at the face is measurably softer than the same build with the switch OFF)
and whose receipt names the blur; the main page's Build and the song page's film button refuse in words and make no film. MUST-FAIL: the same build with the face tracks left as numpy float32 (the fault WORKER found) cannot be written.
The video is only read. Scratch is deleted at the end. Needs ffmpeg (the engine's own), numpy, Pillow."""
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
ENGINE = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else None
if ENGINE is None or len(sys.argv) < 4 or not (ENGINE / "ryagram" / "local" / "bystander_detect.py").is_file():
    print("usage: check-maker-blur-real.py <Ryagram checkout> <scratch base folder on D:> <video with faces> [<yunet.onnx>]")
    sys.exit(2)
sys.path[:0] = [str(HERE), str(ENGINE)]
os.environ.setdefault("NO_PROXY", "127.0.0.1,localhost")
import desktop_maker as DM  # noqa: E402
import maker_edit as ME  # noqa: E402
import maker_song as MS  # noqa: E402
from ryagram.core import binaries  # noqa: E402
from ryagram.local import bystander as BL  # noqa: E402
from ryagram.local import editbuild as EB  # noqa: E402

CLIP = Path(sys.argv[3]).resolve()
YUNET = Path(sys.argv[4] if len(sys.argv) > 4 else "D:/Ryagram-scratch/FACES/models/yunet.onnx")
FAILS = []


def check(cond, what):
    print(("  ok   " if cond else "  FAIL ") + what)
    if not cond:
        FAILS.append(what)


def frame_at(ff, film, t, dest):
    subprocess.run(ff + ["-v", "error", "-y", "-ss", str(t), "-i", str(film), "-frames:v", "1", str(dest)], check=True)
    from PIL import Image  # noqa: PLC0415
    import numpy as np  # noqa: PLC0415
    return np.asarray(Image.open(dest).convert("L"), dtype="float32")


def edge_energy(a):
    import numpy as np  # noqa: PLC0415
    return float(np.abs(np.diff(a, axis=1)).mean() + np.abs(np.diff(a, axis=0)).mean())


tmp = Path(tempfile.mkdtemp(prefix="blurreal-", dir=str(Path(sys.argv[2]))))
try:
    check(CLIP.is_file() and YUNET.is_file() and hashlib.sha256(YUNET.read_bytes()).hexdigest() == ME.YUNET_SHA256, "the video is there, and the face finder file is the one the app pins")
    models, vids = tmp / "models", tmp / "videos"
    models.mkdir()
    vids.mkdir()
    shutil.copy(YUNET, models / "yunet.onnx")
    shutil.copy(CLIP, vids / CLIP.name)
    os.environ["RYAGRAM_MODEL_DIR"] = str(models)
    work, out, recipes = tmp / "work", tmp / "films", tmp / "recipes"
    for d in (work, out, recipes):
        d.mkdir()
    DM.STATE.update(engine=ENGINE, recipes=recipes, work=work, out=out, edit_on=True, live_on=False, job=None, last_film=None, last_recipe=None, last_plan=None)
    DM.STATE.pop("edit", None)
    ME.attach(DM)
    ME.S()["media_items"] = [str(vids / CLIP.name)]
    ff = binaries.ffmpeg().argv
    size = BL.video_size(ff, vids / CLIP.name)
    check(size is not None, f"the video's size can be read ({size})")
    edit = {"schema": EB.SCHEMA, "mode": "compilation", "film": {"width": size[0], "height": size[1], "fps": 30}, "seq": 1,
            "clips": [{"id": "c1", "file_name": CLIP.name, "in_s": 0.5, "out_s": 3.0, "join": {"kind": "cut", "s": 0}, "words": [{"w": "river", "s": 0.6, "e": 0.9}]}],
            "images": [], "rules": [], "texts": [], "captions": {"on": False, "size": "medium", "position": "bottom"}, "look": {"theme": "dark"}, "music": None}

    # the real finder on the real clip: it finds faces, and what it returns is plain numbers once the app has handled it
    ME.set_blur({"on": True})
    blurred_list = ME._with_blur(json.loads(json.dumps(edit)))
    spec = blurred_list["clips"][0].get("bystander_blur")
    check(bool(spec) and len(spec["tracks"]) >= 1 and all(t["kept"] is False and t["name"] is None for t in spec["tracks"]), "the real finder finds a face; nobody is marked as named")
    try:
        json.dumps(blurred_list)
        plain = True
    except TypeError:
        plain = False
    check(plain, "the list with the face tracks can be written (no numpy float32 left in it)")

    # BUTTON 1: the editor's Build final film, switch ON
    ME.set_blur({"on": True})
    r_on = ME.render({"edit": edit})
    film_on = out / r_on["film"]
    check(film_on.is_file() and film_on.stat().st_size > 1000, f"switch ON: Build final film makes a film ({r_on['film']})")
    rc_text = film_on.with_suffix(".receipt.json").read_text(encoding="utf-8") if film_on.with_suffix(".receipt.json").is_file() else ""
    check("bystander_blur" in rc_text, "and its receipt names the blur (bystander_blur)")
    # the same build with the switch OFF, for the comparison
    ME.set_blur({"on": False})
    import time  # noqa: PLC0415
    time.sleep(1.1)                                                                         # film names carry the second
    r_off = ME.render({"edit": edit})
    film_off = out / r_off["film"]
    check(film_off.is_file() and "bystander_blur" not in film_off.with_suffix(".receipt.json").read_text(encoding="utf-8"), "switch OFF: a film is made and its receipt has no blur")
    a_on, a_off = frame_at(ff, film_on, 1.0, tmp / "on.png"), frame_at(ff, film_off, 1.0, tmp / "off.png")
    e_on, e_off = edge_energy(a_on), edge_energy(a_off)
    import numpy as np  # noqa: PLC0415
    changed = float((np.abs(a_on - a_off) > 12).mean())
    check(e_on < 0.85 * e_off and changed > 0.002, f"the face is pixelated: the picture is measurably softer with the switch ON (edge energy {e_on:.2f} against {e_off:.2f}; {changed * 100:.1f}% of the picture changed)")

    # BUTTON 2 and 3: the other Build buttons refuse while it is ON, and make nothing
    ME.set_blur({"on": True})
    before = sorted(p.name for p in out.iterdir())
    for label, fn in (("the main page's Build", lambda: DM.start_job("build", {})), ("the song page's film button", lambda: MS.render({}))):
        try:
            fn()
            said = None
        except (DM.Problem, MS.Problem) as e:
            said = str(e)
        check(said is not None and "does not blur" in said, f"switch ON: {label} refuses in words")
    check(sorted(p.name for p in out.iterdir()) == before, "and no film was made by them")

    # MUST-FAIL: the fault WORKER found. A finder that returns numpy float32 must NOT get through if the app does not make the numbers plain
    import numpy as np  # noqa: PLC0415,F811
    keep = ME._plain
    ME._plain = lambda x: x                                                                  # the mutant: the app trusts the finder's numbers
    real_scan = BL.scan
    BL.scan = lambda *a, **k: [{**t, "kf": [[np.float32(v) for v in kf] for kf in t["kf"]]} for t in real_scan(*a, **k)]
    try:
        ME._with_blur(json.loads(json.dumps(edit)))
        bad_list = ME._with_blur(json.loads(json.dumps(edit)))
        json.dumps(bad_list)
        caught = False
    except TypeError:
        caught = True
    finally:
        ME._plain, BL.scan = keep, real_scan
    # An engine that coerces the numbers itself (FACES' faces-blur-json, 2eb4d9b) covers this too: then the mutant is NOT a fault any more, and that is said, not hidden. Two layers; either alone is enough.
    new_spec_plain = True
    try:
        json.dumps(BL.new_spec(size, [{"id": "t1", "kf": [[np.float32(0.5), np.float32(100), np.float32(100), np.float32(80), np.float32(80)]], "n": 1, "score": np.float32(0.9)}]))
    except TypeError:
        new_spec_plain = False
    check(caught or new_spec_plain, "MUST-FAIL: with the numbers left as numpy float32 the list cannot be written, unless the engine itself makes them plain" + ("" if caught else " (this engine does: the app's own plain-number step is a second layer)"))
    print("  note the engine " + ("makes numpy numbers plain itself" if new_spec_plain else "does NOT make numpy numbers plain: the app's step is the only protection"))
finally:
    shutil.rmtree(tmp, ignore_errors=True)
print()
print("RESULT: " + ("PASS" if not FAILS else f"FAIL ({len(FAILS)})"))
sys.exit(1 if FAILS else 0)
