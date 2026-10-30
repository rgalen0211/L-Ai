"""The app writes its own site-film settings at first start (NEXT-CONNECT 171): tools/node_settings.py, the --node-auto wiring, and the plain-words reasons when a PC is not ready, with MUST-FAILs.

    py -I tools/check-node-settings.py <scratch base folder on D:> [<a Ryagram checkout with ryagram/worker/config.py, to read the file with the house worker's own Config>]

Fake app folders only (a few empty files) on the scratch drive; no network, no render, nothing real is started. The scratch folder must be on a drive other than C: (the renderer refuses C: and so would this check)."""
import os
import sys
import tempfile
import tomllib
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import node_settings as ns                    # noqa: E402
import ryagram_node_render as rr              # noqa: E402
import make_app_bundle as mab                 # noqa: E402

BASE = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(tempfile.mkdtemp(prefix="node-settings-"))
BASE.mkdir(parents=True, exist_ok=True)
ENGINE = Path(sys.argv[2]) if len(sys.argv) > 2 else None
FAILS = []


def check(c, what):
    print(("  ok   " if c else "  FAIL ") + what, flush=True)
    if not c:
        FAILS.append(what)


def fake_app(name, *, engine=True, python=True, ffmpeg=True, lock=True, browser=True):
    app = BASE / name / "Ryagram App"                                   # a space in the folder name, as a person's unzip may have
    (app / "tools").mkdir(parents=True)
    if engine:
        (app / "ryagram" / "worker").mkdir(parents=True)
        (app / "ryagram" / "worker" / "engine.py").write_text("# engine\n", encoding="utf-8")
    if python:
        (app / "python").mkdir()
        (app / "python" / "python.exe").write_bytes(b"MZ")
    if ffmpeg:
        (app / "ffmpeg").mkdir()
        (app / "ffmpeg" / "ffmpeg.exe").write_bytes(b"MZ")
    if lock:
        (app / "tools" / "gpu_lock.py").write_text("# lock\n", encoding="utf-8")
    pf = BASE / name / "ProgramFiles"
    if browser:
        (pf / "Google" / "Chrome" / "Application").mkdir(parents=True)
        (pf / "Google" / "Chrome" / "Application" / "chrome.exe").write_bytes(b"MZ")
    env = {"PROGRAMFILES": str(pf), "PROGRAMFILES(X86)": str(BASE / name / "nothing-x86"), "LOCALAPPDATA": str(BASE / name / "nothing-local"), "FFMPEG_PATH": str(app / "ffmpeg" / "ffmpeg.exe")}
    return app, env


print("A. the text")
app, env = fake_app("a")
txt = ns.settings_text(app, python=app / "python" / "python.exe", ffmpeg_dir=app / "ffmpeg", browser="C:/Program Files/Google/Chrome/Application/chrome.exe", computer="DESKTOP-SAM")
raw = tomllib.loads(txt)
check(raw["root"].endswith("work/node-root") and raw["worker_id"] == "DESKTOP-SAM-NODE" and raw["engine"]["engine_dir"].replace(chr(92), "/") == str(app).replace(chr(92), "/"), "the root is inside the app's work folder, the engine is the app folder itself, the computer is named")
check(raw["engine"]["sequence_argv"][1:] == ["-m", "ryagram.sequence"] and raw["engine"]["sheet_argv"][1:] == ["-m", "ryagram.sequence.sheet"] and raw["engine"]["sequence_argv"][0].endswith("python/python.exe"), "the film runs on the app's own Python")
check(raw["engine"]["env"]["RYAGRAM_CACHE_DIR"].endswith("work/node-data") and raw["datasets"]["allow"] == list(ns.STARTER_DATASETS) == ["bps_county_permits"], "the data folder is inside the app, and only the starter dataset is allowed")
check(set(raw["limits"]) == {"contact_sheet", "preview", "final_render"} and raw["limits"]["contact_sheet"] == {"wall_s": 1800, "output_bytes": 20971520}, "the house limits are there for the three job types")
check(raw["node"]["no_house_worker"] is True and raw["node"]["gpu_lock"].endswith("tools/gpu_lock.py") and raw["node"]["gpu_lock_dir"].endswith("work/node-lock") and raw["node"]["who"] == "MAKER" and "house_jobs" not in raw["node"], "a tester PC has no house worker, and the GPU lock keeps its state inside the work folder")
check(chr(92) not in txt.replace(chr(92) + chr(92), "") or "\\\\" not in txt, "paths are written with forward slashes")
check("password" not in txt.lower() and "token" not in txt.lower() and "key" not in txt.lower().replace("keep", ""), "nothing secret is in the file")
empty = tomllib.loads(ns.settings_text(app, python=app / "python" / "python.exe", ffmpeg_dir=app / "ffmpeg", browser=None, computer=""))
check(empty["engine"]["chrome"] == "" and empty["worker_id"] == "TESTER-NODE", "no browser found: the file says empty (make() then says so in words); no computer name: a plain default")

print("B. finding Google Chrome (only Chrome: the film job refuses Edge)")
app, env = fake_app("b1")
check(ns.find_browser(env).endswith("chrome.exe"), "Chrome in Program Files is found")
app2, env2 = fake_app("b2", browser=False)
edge = Path(env2["PROGRAMFILES"]) / "Microsoft" / "Edge" / "Application"
edge.mkdir(parents=True)
(edge / "msedge.exe").write_bytes(b"MZ")
check(ns.find_browser(env2) is None, "MUST-FAIL: a PC with only Edge has NO usable browser (the film job refuses Edge)")
loc = Path(env2["LOCALAPPDATA"])
(loc / "Google" / "Chrome" / "Application").mkdir(parents=True)
(loc / "Google" / "Chrome" / "Application" / "chrome.exe").write_bytes(b"MZ")
check(ns.find_browser(env2).endswith("chrome.exe"), "a per-user Chrome is found")

print("C. writing it: only inside the app's work folder, refreshed when it changes, never a secret")
app, env = fake_app("c")
before = {p for p in (BASE / "c").rglob("*")}
path = ns.ensure(app, python=app / "python" / "python.exe", ffmpeg_dir=app / "ffmpeg", env=env, computer="DESKTOP-SAM")
after = {p for p in (BASE / "c").rglob("*")} - before
check(path.is_file() and path.name == "ryagram-node.toml" and all(str(p).startswith(str(app / "work")) for p in after), "the file and its folders are made, all inside <app>/work")
m1 = path.stat().st_mtime_ns
ns.ensure(app, python=app / "python" / "python.exe", ffmpeg_dir=app / "ffmpeg", env=env, computer="DESKTOP-SAM")
check(path.stat().st_mtime_ns == m1, "starting again with nothing changed does not rewrite it")
path.write_text("# hand-edited\n", encoding="utf-8")
ns.ensure(app, python=app / "python" / "python.exe", ffmpeg_dir=app / "ffmpeg", env=env, computer="DESKTOP-SAM")
check(tomllib.loads(path.read_text(encoding="utf-8"))["worker_id"] == "DESKTOP-SAM-NODE", "a hand-edited file is rewritten (it is generated, never hand-written)")

print("D. the renderer's own readiness check, on the generated file")
app, env = fake_app("d")
path = ns.ensure(app, python=app / "python" / "python.exe", ffmpeg_dir=app / "ffmpeg", env=env, computer="DESKTOP-SAM")
s = rr.read_settings(path)
ok_kw = dict(ram=lambda: 16 << 30, free_gb=lambda: 50)
check(rr.find_problems(s, app / "work", **ok_kw) == [], f"a complete app folder on this drive: make() finds NO problem ({rr.find_problems(s, app / 'work', **ok_kw)[:2]})")
for label, kw, frag in (("no full engine (the node-job closure missing)", dict(engine=False), "full Ryagram folder"), ("no Python", dict(python=False), "Python"), ("no ffmpeg", dict(ffmpeg=False), "ffmpeg"),
                        ("no GPU lock tool", dict(lock=False), "lock tool"), ("no Google Chrome", dict(browser=False), "Google Chrome was not found")):
    a2, e2 = fake_app("d-" + label[:6].replace(" ", ""), **kw)
    p2 = ns.ensure(a2, python=a2 / "python" / "python.exe", ffmpeg_dir=a2 / "ffmpeg", env=e2, computer="X")
    probs = rr.find_problems(rr.read_settings(p2), a2 / "work", **ok_kw)
    check(any(frag in x for x in probs), f"MUST-FAIL: {label}: {[x for x in probs if frag in x][:1]}")
saved = rr.on_c
rr.on_c = lambda p: True
try:
    probs = rr.find_problems(s, app / "work", **ok_kw)
    check(any("C:" in x for x in probs), "MUST-FAIL: on a PC whose app folder is on C: make() still says so in words (Ryan's storage rule is untouched; a tester PC on C: needs his word)")
finally:
    rr.on_c = saved
check(any("memory" in x for x in rr.find_problems(s, app / "work", ram=lambda: 2 << 30, free_gb=lambda: 50)) and any("GB free" in x for x in rr.find_problems(s, app / "work", ram=lambda: 16 << 30, free_gb=lambda: 3)), "MUST-FAIL: too little memory or disk is said in words")
if ENGINE:
    sys.path.insert(0, str(ENGINE))
    from ryagram.worker.config import Config          # noqa: E402
    cfg = Config.from_toml(path)
    check(cfg.datasets == frozenset(["bps_county_permits"]) and set(cfg.limits) == {"contact_sheet", "preview", "final_render"} and cfg.engine.engine_dir == app.resolve(), "the house worker's OWN Config reads the generated file")
else:
    print("  SKIP the house worker's own Config was not given (pass a Ryagram checkout as the second argument)")

print("E. the wiring: --node-auto in the start file, the module travels, the page's parser knows it")
sig = mab.check_signin("https://jxtkfishqfxuptwjzczz.supabase.co/functions/v1/node", ["uselai.com"], True)
check(sig.endswith('--approval-host uselai.com --node-auto') and mab.check_signin("https://jxtkfishqfxuptwjzczz.supabase.co/functions/v1/node", ["uselai.com"]).endswith("uselai.com"), "--node-auto is added to the sign-in text only when asked for")
try:
    mab.check_signin("", [], True)
    check(False, "MUST-FAIL: --node-auto without a sign-in site is refused")
except mab.Refused as e:
    check("needs --signin-site" in str(e), "MUST-FAIL: --node-auto without a sign-in site is refused: " + str(e)[:80])
check("node_settings.py" in mab.RUNTIME_TOOLS, "MUST-FAIL guard: the module travels in the app folder")
import desktop_maker as dm                         # noqa: E402


class _Parsed(Exception):
    pass


_orig = dm.argparse.ArgumentParser.parse_args


def _grab(self, args_=None, ns_=None):
    raise _Parsed(_orig(self, args_, ns_))


dm.argparse.ArgumentParser.parse_args = _grab
try:
    dm.main(["--site", "https://jxtkfishqfxuptwjzczz.supabase.co/functions/v1/node", "--approval-host", "uselai.com", "--node-auto"])
    got = None
except _Parsed as e:
    got = e.args[0]
finally:
    dm.argparse.ArgumentParser.parse_args = _orig
check(got is not None and got.node_auto is True and got.node_config in ("", None), "the real desktop_maker reads --node-auto")
src = (HERE / "desktop_maker.py").read_text(encoding="utf-8")
check("a.node_auto and a.site and not a.node_config" in src, "MUST-FAIL guard: --node-auto does nothing without --site, and never overrides a --node-config the person gave")

print()
if FAILS:
    print(f"FAILED: {len(FAILS)}")
    for f in FAILS:
        print("  -", f)
    sys.exit(1)
print("all passed")
