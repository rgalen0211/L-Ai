"""The live editor in REAL Chrome against the REAL maker, the real engine modules and two real (made-up) videos: NEXT-CONNECT 142.

    py tools/check-maker-live-chrome.py <engine checkout with ryagram/local/edittracks.py> <scratch folder on D:> [ffmpeg folder]

It builds a portable set exactly as the app's folder does (tools/ and the engine, started with python -I), makes two small test videos with ffmpeg, writes the edit list the engine would have
planned, starts the maker with --edit --live on a free port (127.0.0.1 only), opens the live editor page in Chrome, reorders a clip with the keyboard, and then reads the edit list FROM DISK:
the chain page -> the maker's route -> the draft -> the engine's own tracks module -> edit.json. Then the main page's card. Nothing is rendered, nothing leaves this computer (any other
address Chrome asks for fails the check). Closes the browser and the maker when done."""
import json
import os
import re
import shutil
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

from playwright.sync_api import sync_playwright

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import make_app_bundle as mab  # noqa: E402

ENGINE = Path(sys.argv[1]).resolve()
BASE = Path(sys.argv[2]).resolve()
FF = Path(sys.argv[3]) if len(sys.argv) > 3 else Path("C:/Users/Ryan/AppData/Local/Microsoft/WinGet/Packages/Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-9.0.1-full_build/bin")
FAILED = []


def check(ok, what):
    print(("  ok   " if ok else "  FAIL ") + what)
    if not ok:
        FAILED.append(what)


root = BASE / "live-chrome"
if root.exists():
    shutil.rmtree(root)
(root / "tools").mkdir(parents=True)
for t in mab.RUNTIME_TOOLS:
    shutil.copy2(HERE / t, root / "tools" / t)
for d in mab.RUNTIME_PAGE_DIRS:
    shutil.copytree(HERE / d, root / "tools" / d, ignore=shutil.ignore_patterns("fixture.js"))
shutil.copytree(ENGINE / "ryagram", root / "ryagram", ignore=shutil.ignore_patterns("__pycache__"))
shutil.copytree(ENGINE / "recipes", root / "recipes")
for d in ("work", "films", "media"):
    (root / d).mkdir()

# two made-up videos (a colour and a tone; nobody is in them)
vids = []
for name, secs, colour in (("one.mp4", 6, "0x335577"), ("two.mp4", 5, "0x775533")):
    out = root / "media" / name
    subprocess.run([str(FF / "ffmpeg.exe"), "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", f"color=c={colour}:s=320x180:r=30:d={secs}", "-f", "lavfi", "-i", f"sine=f=440:d={secs}",
                    "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", str(out)], check=True, capture_output=True)
    vids.append(str(out))
(root / "work" / "edit-media.json").write_text(json.dumps(vids), encoding="utf-8")
edit = {"schema": "ryagram.maker-edit/0", "mode": "compilation", "film": {"width": 1280, "height": 720, "fps": 30}, "seq": 1,
        "clips": [{"id": "c1", "file_name": "one.mp4", "in_s": 1.0, "out_s": 3.0, "join": {"kind": "cut", "s": 0}, "words": []},
                  {"id": "c2", "file_name": "two.mp4", "in_s": 0.0, "out_s": 2.5, "join": {"kind": "cut", "s": 0}, "words": []}],
        "images": [], "rules": [], "texts": [{"text": "Day one", "start_s": 0.5, "length_s": 2.0, "position": "top"}],
        "captions": {"on": True, "size": "medium", "position": "bottom"}, "look": {"theme": "dark"}, "music": None}
(root / "films" / "edit.json").write_text(json.dumps(edit), encoding="utf-8")

env = dict(os.environ, NO_PROXY="127.0.0.1,localhost", PYTHONDONTWRITEBYTECODE="1", PYTHONNOUSERSITE="1")
p = subprocess.Popen([sys.executable, "-I", str(root / "tools" / "desktop_maker.py"), "--port", "0", "--work-dir", str(root / "work"), "--out-dir", str(root / "films"), "--edit", "--live"],
                     cwd=root, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
url, t0 = None, time.time()
while time.time() - t0 < 40 and url is None:
    line = p.stdout.readline()
    if not line:
        break
    m = re.search(r"(http://127\.0\.0\.1:\d+)/\?t=(\S+)", line)
    if m:
        url = (m.group(1), m.group(2))
try:
    check(url is not None, "the maker starts with --edit --live from the portable set")
    if url:
        base, tok = url
        other, calls, errors = [], [], []
        with sync_playwright() as pw:
            b = pw.chromium.launch(channel="chrome")
            ctx = b.new_context(viewport={"width": 1280, "height": 900})
            pg = ctx.new_page()
            pg.on("request", lambda r: other.append(r.url) if not r.url.startswith(base) else None)
            pg.on("request", lambda r: calls.append(json.loads(r.post_data or "{}").get("name")) if r.url.endswith("/api/live/rpc") else None)
            pg.on("pageerror", lambda e: errors.append(str(e)))
            pg.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
            pg.goto(f"{base}/live?t={tok}&mode=compilation&project=local", wait_until="load")
            pg.wait_for_selector('.le-clip[data-id="c1"]', timeout=15000)               # the page starts on a stand-in drawing and switches to the maker's draft when it answers
            order = lambda: pg.eval_on_selector_all(".le-lane:first-child .le-clip", "els => els.map(e => e.dataset.id)")
            ids = order()
            check(len(ids) == 2, f"the page shows the film's two video clips from the real edit list ({ids})")
            check(tok not in pg.url, "the token is out of the address bar")
            n0 = len(calls)
            pg.focus(f'.le-clip[data-id="{ids[1]}"]')
            pg.keyboard.press("ArrowLeft")
            pg.wait_for_timeout(1500)
            check(order() == [ids[1], ids[0]] and "editor_apply_ops" in calls[n0:], "a reorder goes to the maker first and the screen follows its answer")
            saved = json.loads((root / "films" / "edit.json").read_text(encoding="utf-8"))
            check([c["file_name"] for c in saved["clips"]] == ["two.mp4", "one.mp4"], "and the edit list ON DISK has the new order (page, route, draft, engine's tracks module, file)")
            check(saved["texts"][0]["text"] == "Day one" and saved["clips"][1]["in_s"] == 1.0 and saved["clips"][1]["out_s"] == 3.0, "everything the tracks do not show is carried over unchanged")
            pg.screenshot(path=str(BASE / "live-chrome.png"), full_page=True)
            check(not other, "nothing was requested from outside the maker's own address" + (f": {other[:2]}" if other else ""))
            check(set(calls) <= {"my_edit_ops_since", "editor_apply_ops", "editor_undo", "editor_undo_all_ai", "editor_heartbeat"}, "the page used only the five editor names")
            check(not errors, "no console errors" + (f": {errors[:2]}" if errors else ""))
            # the main page's card
            mp = ctx.new_page()
            mp.goto(f"{base}/?t={tok}", wait_until="load")
            mp.wait_for_selector("#live-card", timeout=10000)
            check(mp.is_visible("#live-card") and mp.locator("#live-ai").is_disabled(), "the main page has the card; 'Let my AI see my track list' stays off until the mirror is on")
            mp.check("#live-mirror")
            mp.wait_for_timeout(800)
            msg = mp.inner_text("#live-msg")
            check("Sign this computer in" in msg and not mp.is_checked("#live-mirror") or "Choose the project" in msg or "Sign this computer in" in msg, "switching the mirror on while this computer is not signed in says so in plain words")
            b.close()
finally:
    if p.poll() is None:
        p.terminate()
        try:
            p.wait(10)
        except subprocess.TimeoutExpired:
            p.kill()
    p.stdout.close()

print("RESULT: " + ("PASS" if not FAILED else f"FAIL ({len(FAILED)})"))
sys.exit(1 if FAILED else 0)
