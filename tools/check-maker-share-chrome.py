"""The three new controls on the desktop maker's main page, in REAL Chrome against the REAL maker (NEXT-CONNECT 149).

    py tools/check-maker-share-chrome.py <Ryagram checkout> <scratch base folder on D:>

Starts tools/desktop_maker.py (--edit) on a free port with two recipes in a scratch recipes folder, opens the page, and checks what a first-timer sees: a words recipe fills the words box with its own
words (an every-time recipe does not), 'Use a recipe from a file' is there, 'Share this film as a recipe' tells the person to build a final film first, and 'Blur faces I haven't named' is switched off
and says why. Nothing is requested from outside 127.0.0.1; the browser and the maker are closed at the end."""
import os
import re
import shutil
import socket
import subprocess
import sys
import tempfile
from pathlib import Path

from playwright.sync_api import sync_playwright

HERE = Path(__file__).resolve().parent
ENGINE = Path(sys.argv[1]).resolve()
BASE = Path(sys.argv[2])
FAILED = []


def check(ok, what):
    print(("  ok   " if ok else "  FAIL ") + what)
    if not ok:
        FAILED.append(what)


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


tmp = Path(tempfile.mkdtemp(prefix="share-chrome-", dir=str(BASE)))
proc = None
try:
    rec = tmp / "recipes"
    rec.mkdir()
    for n in ("sam-first.json", "every-time.json"):
        shutil.copy(ENGINE / "recipes" / n, rec / n)
    port = free_port()
    env = dict(os.environ, NO_PROXY="127.0.0.1,localhost", PYTHONIOENCODING="utf-8", RYAGRAM_MODEL_DIR=str(tmp / "no-models"))
    proc = subprocess.Popen([sys.executable, "-I", str(HERE / "desktop_maker.py"), "--engine", str(ENGINE), "--recipes", str(rec), "--work-dir", str(tmp / "work"), "--out-dir", str(tmp / "films"),
                             "--port", str(port), "--edit"], cwd=str(HERE), env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8")
    token = None
    for _ in range(60):
        m = re.search(r"\?t=(\S+)", proc.stdout.readline())
        if m:
            token = m.group(1)
            break
    check(token is not None, "the maker starts with --edit")
    outside = []
    with sync_playwright() as pw:
        b = pw.chromium.launch(channel="chrome")
        pg = b.new_context(viewport={"width": 1100, "height": 1400}).new_page()
        errors = []
        pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.on("request", lambda r: outside.append(r.url) if not re.match(r"^(http://127\.0\.0\.1:\d+/|data:|blob:)", r.url) else None)
        pg.goto(f"http://127.0.0.1:{port}/?t={token}", wait_until="load")
        pg.wait_for_function("document.querySelectorAll('#recipe option').length >= 2", timeout=20000)
        opts = pg.eval_on_selector_all("#recipe option", "o => o.map(x => ({v: x.value, t: x.textContent}))")
        check(len(opts) == 2, "both recipes are in the list")
        pg.select_option("#recipe", "sam-first.json")
        check(pg.input_value("#words") == "well that is great news for everyone", "a words recipe fills the words box with its own words (no retyping)")
        pg.select_option("#recipe", "every-time.json")
        check(pg.input_value("#words") == "", "an every-time recipe still asks for the person's own word")
        check(pg.locator("#recipe-import").is_visible() and "recipe from a file" in pg.inner_text("#recipe-import"), "'Use a recipe from a file' is on the page")
        check(pg.locator("#share-card").is_visible(), "the share card is on the page")
        pg.click("#share-go")
        pg.wait_for_function("document.getElementById('share-msg').textContent.length > 0", timeout=10000)
        check("Build a final film" in pg.inner_text("#share-msg"), "'Share this film as a recipe' tells the person to build a final film first")
        pg.wait_for_function("document.getElementById('blur-msg').textContent.length > 0", timeout=10000)
        check(pg.is_disabled("#blur-on") and not pg.is_checked("#blur-on") and "face finder" in pg.inner_text("#blur-msg"), "'Blur faces I haven't named' is off, cannot be switched on, and says why")
        pg.screenshot(path=str(tmp / "page.png"), full_page=True)
        check(not errors, "no page errors" + (f": {errors[:2]}" if errors else ""))
        check(not outside, "nothing was requested from outside the maker's own address" + (f": {outside[:2]}" if outside else ""))
        b.close()
finally:
    if proc is not None and proc.poll() is None:
        proc.terminate()
        try:
            proc.wait(10)
        except subprocess.TimeoutExpired:
            proc.kill()
    if proc is not None and proc.stdout:
        proc.stdout.close()
    shutil.rmtree(tmp, ignore_errors=True)
print("RESULT: " + ("PASS" if not FAILED else f"FAIL ({len(FAILED)})"))
sys.exit(1 if FAILED else 0)
