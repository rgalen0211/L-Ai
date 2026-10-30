"""The guided-footage checklist on the desktop maker's page, in REAL Chrome (NEXT-CONNECT 161).

    py -I tools/check-maker-checklist-chrome.py <a Ryagram folder that has ryagram/local (a kit folder or a checkout)> <scratch base folder on D:>

Starts the real maker in this process with a stand-in for the 'what your AI asked for' read (no site, no network), two small scratch folders as the places the maker looks, opens the page in Chrome and checks what
a person sees: the request with its checklist, the line that says Ryagram downloads nothing, a line ticking itself when its folder holds enough videos, a hand tick that stays after a reload, and that nothing
is requested from outside 127.0.0.1. The browser and the server are closed at the end."""
import importlib.util
import json
import re
import shutil
import sys
import tempfile
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
ENGINE = Path(sys.argv[1]).resolve()
BASE = Path(sys.argv[2])
FAILED = []


def check(ok, what):
    print(("  ok   " if ok else "  FAIL ") + what)
    if not ok:
        FAILED.append(what)


spec = importlib.util.spec_from_file_location("desktop_maker", HERE / "desktop_maker.py")
dm = importlib.util.module_from_spec(spec)
sys.modules["desktop_maker"] = dm
spec.loader.exec_module(dm)
import ryagram_requests as RQ  # noqa: E402
import ryagram_signin as si  # noqa: E402

PID = "11111111-2222-3333-4444-555555555555"
ROW = {"project_id": PID, "title": "Moon film", "request": {"schema": "ryagram.compilation-request/0", "phrase": "lift-off", "search": "every", "note": "For Friday.", "checklist": [
    {"id": "c1", "what": "The 1969 launch, wide shot", "from": "the National Archives", "must_contain": "the word lift-off", "folder": "Apollo", "count": 2},
    {"id": "c2", "what": "A hearing clip", "folder": "Hearings", "count": 1}]}, "sha256": "a" * 64, "updated_at": "2026-10-30T10:00:00Z"}


class FakeAirq:
    def status(self, force=False):
        return {"on": True, "requests": [RQ._clean(ROW)], "message": ""}


tmp = Path(tempfile.mkdtemp(prefix="ZZTckl-chrome-", dir=str(BASE)))
srv = None
try:
    rec = tmp / "recipes"
    rec.mkdir()
    for n in list((ENGINE / "recipes").glob("*.json"))[:2]:
        shutil.copy(n, rec / n.name)
    videos = tmp / "Videos"
    (videos / "Apollo").mkdir(parents=True)
    (videos / "Apollo" / "launch1.mp4").write_bytes(b"x")
    srv = dm.make_server(ENGINE, rec, tmp / "work", tmp / "films", port=0, token="tok", activity=False, site=None, signin_store=si.MemoryStore(), approval_hosts=())
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    dm.STATE["airq"] = FakeAirq()
    dm.STATE["search_roots"] = [videos]
    dm.STATE["recent_dirs"] = []
    url = f"http://127.0.0.1:{dm.STATE['port']}/?t=tok"
    outside = []
    with sync_playwright() as pw:
        b = pw.chromium.launch(channel="chrome")
        pg = b.new_context(viewport={"width": 1100, "height": 1500}).new_page()
        errors = []
        pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.on("request", lambda r: outside.append(r.url) if not re.match(r"^(http://127\.0\.0\.1:\d+/|data:|blob:)", r.url) else None)
        posts = []
        pg.on("request", lambda r: posts.append((r.url, r.post_data)) if "/api/ai-checklist" in r.url else None)
        pg.goto(url, wait_until="load")
        pg.wait_for_function("() => !document.getElementById('airq').hidden && document.querySelectorAll('#airq-list .ckl li').length === 2", timeout=20000)
        text = pg.inner_text("#airq")
        check("A compilation of every time: “lift-off”" in text and "Moon film" in text, "the request is shown")
        check("Ryagram downloads nothing: put the files in the folder named on each line" in text, "it says Ryagram downloads nothing")
        check("The 1969 launch, wide shot" in text and "Where to look: the National Archives" in text and "It must contain: the word lift-off" in text, "the first line says what, where to look and what it must contain")
        check("(1 of 2 videos there)" in text, "the first folder holds 1 of the 2 asked for")
        check("A hearing clip" in text and "not among the places Ryagram looks yet" in text, "the second line says its folder is not among the places Ryagram looks")
        boxes = pg.locator("#airq-list .ckl input[type=checkbox]")
        check(boxes.count() == 2 and not boxes.nth(0).is_checked() and not boxes.nth(1).is_checked(), "two boxes, both empty")
        (videos / "Apollo" / "launch2.mp4").write_bytes(b"x")
        pg.reload(wait_until="load")
        pg.wait_for_function("() => document.querySelectorAll('#airq-list .ckl input').length === 2", timeout=20000)
        boxes = pg.locator("#airq-list .ckl input[type=checkbox]")
        check(boxes.nth(0).is_checked() and "(2 of 2 videos there)" in pg.inner_text("#airq"), "a second video in the folder: the first line ticks itself")
        pg.screenshot(path=str(tmp / "checklist.png"), full_page=False)
        boxes.nth(1).check()
        pg.wait_for_function("() => true")
        pg.wait_for_timeout(600)
        check(len(posts) == 1 and json.loads(posts[0][1]).get("done") is True and re.match(r"^[0-9a-f]{16}$", json.loads(posts[0][1]).get("key", "")), "ticking the second box sends only its key and a yes to the maker's own route")
        pg.reload(wait_until="load")
        pg.wait_for_function("() => document.querySelectorAll('#airq-list .ckl input').length === 2", timeout=20000)
        check(pg.locator("#airq-list .ckl input[type=checkbox]").nth(1).is_checked(), "the hand tick is still there after a reload")
        pg.locator("#airq-list .ckl input[type=checkbox]").nth(1).uncheck()
        pg.wait_for_timeout(600)
        pg.reload(wait_until="load")
        pg.wait_for_function("() => document.querySelectorAll('#airq-list .ckl input').length === 2", timeout=20000)
        check(not pg.locator("#airq-list .ckl input[type=checkbox]").nth(1).is_checked(), "unticking it sticks too")
        check(pg.locator("#airq a").count() == 0, "the card holds no link at all")
        check(not errors, f"no page errors ({errors[:1]})")
        check(not outside, f"nothing was requested from outside 127.0.0.1 ({outside[:2]})")
        b.close()
finally:
    try:
        if srv:
            srv.shutdown()
    except Exception:  # noqa: BLE001
        pass
    shutil.rmtree(tmp, ignore_errors=True)
print()
print("RESULT: " + ("PASS" if not FAILED else f"FAIL ({len(FAILED)})"))
sys.exit(1 if FAILED else 0)
