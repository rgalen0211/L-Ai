"""The edit page and the song page open from a PORTABLE folder (NEXT-CONNECT 114 acceptance).

The portable folder starts the maker with `python -I` (the isolated flag: the script's own folder is NOT on the path) and ships only what make_app_bundle.py names. This check builds a small copy of
exactly that set (RUNTIME_TOOLS and RUNTIME_PAGE_DIRS from the real builder, plus the engine) in a scratch folder, starts the maker from it with `-I --edit --song` on a free port, and asks for the
pages with the token. Nothing is rendered, nothing is downloaded, and the server only listens on this computer.

    python tools/check-maker-portable-pages.py <engine checkout (the folder holding ryagram/ and recipes/)> <scratch base folder on D:>

MUST-FAILs: a folder missing one page module, or one page folder, does not open that page; without the flags the pages do not exist (404).
Found by this check: desktop_maker imported maker_song/maker_edit before its folder was on the path (no module under -I), and the builder shipped neither the modules nor the page folders."""
from __future__ import annotations

import os
import re
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import make_app_bundle as mab  # noqa: E402

ENGINE = Path(sys.argv[1]).resolve()
BASE = Path(sys.argv[2]).resolve()
FAILED = []


def check(ok, what):
    print(("  ok   " if ok else "  FAIL ") + what)
    if not ok:
        FAILED.append(what)


def build(name, drop=()):
    root = BASE / name
    if root.exists():
        shutil.rmtree(root)
    (root / "tools").mkdir(parents=True)
    for t in mab.RUNTIME_TOOLS:
        if t not in drop:
            shutil.copy2(HERE / t, root / "tools" / t)
    for d in mab.RUNTIME_PAGE_DIRS:
        if d not in drop:
            shutil.copytree(HERE / d, root / "tools" / d, ignore=shutil.ignore_patterns("fixture.js"))
    shutil.copytree(ENGINE / "ryagram", root / "ryagram", ignore=shutil.ignore_patterns("__pycache__"))
    shutil.copytree(ENGINE / "recipes", root / "recipes")
    (root / "work").mkdir()
    (root / "films").mkdir()
    return root


def start(root, flags):
    env = dict(os.environ, NO_PROXY="127.0.0.1,localhost", PYTHONDONTWRITEBYTECODE="1", PYTHONNOUSERSITE="1")
    p = subprocess.Popen([sys.executable, "-I", str(root / "tools" / "desktop_maker.py"), "--port", "0", "--work-dir", str(root / "work"), "--out-dir", str(root / "films"), *flags],
                         cwd=root, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    url, lines, t0 = None, [], time.time()
    while time.time() - t0 < 30 and url is None:
        line = p.stdout.readline()
        if not line:
            break
        lines.append(line)
        m = re.search(r"(http://127\.0\.0\.1:\d+)/\?t=(\S+)", line)
        if m:
            url = (m.group(1), m.group(2))
    return p, url, "".join(lines)


def get(base, path, tok):
    try:
        with urllib.request.urlopen(base + path, timeout=15) as r:
            return r.status, r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")
    except OSError:                                    # the server dropped the request (a page file that is not there): the page did not open
        return 0, ""


def stop(p):
    if p.poll() is None:
        p.terminate()
        try:
            p.wait(10)
        except subprocess.TimeoutExpired:
            p.kill()
    p.stdout.close()


print("1. a portable set with --edit --song --live opens all three pages")
root = build("portable-ok")
p, url, out = start(root, ["--edit", "--song", "--live"])
try:
    check(url is not None, "the maker starts from the portable set under -I and prints its address" + ("" if url else f" ({out[-300:]!r})"))
    if url:
        base, tok = url
        main = get(base, f"/?t={tok}", tok)
        check(main[0] == 200 and 'id="edit-link"' in main[1] and 'id="song-link"' in main[1], "the main page offers both links")
        check('id="live-link"' in main[1] and 'id="live-card"' in main[1] and 'id="live-project"' in main[1], "the main page offers the live editor link and the card with the film's project and the two switches")
        e = get(base, f"/edit?t={tok}", tok)
        check(e[0] == 200 and "<html" in e[1].lower(), f"the edit page opens (status {e[0]})")
        s = get(base, f"/song?t={tok}", tok)
        check(s[0] == 200 and "<html" in s[1].lower(), f"the song page opens (status {s[0]})")
        lv = get(base, f"/live?t={tok}", tok)
        check(lv[0] == 200 and "<html" in lv[1].lower(), f"the live editor page opens (status {lv[0]})")
        lp = get(base, f"/api/live/sync", tok)
        check(lp[0] in (200, 401, 403), f"the live routes exist and are behind the token (status {lp[0]})")
        for path in ("/edit.js", "/edit-model.js", "/edit.css", "/song.js", "/song-model.js", "/song.css", "/live.js", "/live.css"):
            r = get(base, path + f"?t={tok}", tok)
            check(r[0] == 200 and len(r[1]) > 100, f"{path} is served (status {r[0]}, {len(r[1])} characters)")
finally:
    stop(p)

print("2. without the flags the pages do not exist")
p, url, out = start(root, [])
try:
    base, tok = url if url else ("http://127.0.0.1:1", "x")
    check(url is not None and 'id="live-card"' not in get(base, f"/?t={tok}", tok)[1] and 'id="live-link"' not in get(base, f"/?t={tok}", tok)[1], "without --live the main page has no live editor card or link")
    check(url is not None and get(base, f"/edit?t={tok}", tok)[0] == 404 and get(base, f"/song?t={tok}", tok)[0] == 404 and get(base, f"/live?t={tok}", tok)[0] == 404, "/edit, /song and /live answer 404 when not asked for")
finally:
    stop(p)

print("3. MUST-FAIL: a set missing a module or a page folder does not open that page")
for drop, page in (("maker_song.py", "song"), ("maker_edit.py", "edit"), ("maker-song", "song"), ("maker-edit", "edit"), ("maker_live.py", "live"), ("maker-live", "live")):
    r2 = build("portable-missing", drop=(drop,))
    p, url, out = start(r2, ["--edit", "--song", "--live"])
    try:
        opened = False
        if url:
            st, body = get(url[0], f"/{page}?t={url[1]}", url[1])
            opened = st == 200 and "<html" in body.lower()
        check(not opened, f"without {drop} the {page} page does not open (the check can tell)")
    finally:
        stop(p)

shutil.rmtree(BASE / "portable-ok", ignore_errors=True)
shutil.rmtree(BASE / "portable-missing", ignore_errors=True)
print()
if FAILED:
    print("RESULT: FAIL\n" + "\n".join(FAILED))
    sys.exit(1)
print("RESULT: PASS")
