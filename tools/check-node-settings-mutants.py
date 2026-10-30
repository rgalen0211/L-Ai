"""Must-fail proof for tools/node_settings.py, the C:-inside-the-app option and the --node-auto wiring (NEXT-CONNECT 171): each mutant breaks ONE rule in a scratch copy of tools/ and tools/check-node-settings.py must then FAIL;
a baseline on the unbroken copy passes first. No mutant touches a process, a network or anything outside its scratch copy.

    py -I tools/check-node-settings-mutants.py <scratch base folder on D:> <a Ryagram checkout with ryagram/worker/config.py>"""
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
BASE = Path(sys.argv[1])
NL = chr(10)
BS = chr(92)
CHECK = "check-node-settings.py"
NS, NR, MB, DM = "node_settings.py", "ryagram_node_render.py", "make_app_bundle.py", "desktop_maker.py"
ENGINE = sys.argv[2] if len(sys.argv) > 2 else ""
M = [
    ("Edge is accepted as the browser", NS, 'rels = [("Google", "Chrome", "Application", "chrome.exe")]', 'rels = [("Microsoft", "Edge", "Application", "msedge.exe"), ("Google", "Chrome", "Application", "chrome.exe")]'),
    ("the data folder is outside the app's work folder", NS, 'REL_DATA = Path("work") / "node-data"', 'REL_DATA = Path("node-data")'),
    ("a tester PC is said to have a house worker", NS, '"no_house_worker = true"', '"no_house_worker = false"'),
    ("another dataset is allowed", NS, 'STARTER_DATASETS = ("bps_county_permits",)', 'STARTER_DATASETS = ("bps_county_permits", "cbp_suppression")'),
    ("the settings are rewritten at every start", NS, "    if not same:", "    if True:"),
    ("a hand-edited settings file is left alone", NS, "    if not same:", "    if False:"),
    ("backslashes stay in the paths", NS, 'return json.dumps(str(v).replace(chr(92), "/"), ensure_ascii=False)', "return json.dumps(str(v), ensure_ascii=False)"),
    ("the C: option allows ANY path on C:", NR, "    return on_c(path) and not (s.allow_c_inside_app and _inside(path, s.engine_dir))", "    return on_c(path) and not s.allow_c_inside_app"),
    ("the C: option is on for every PC", NR, "    return on_c(path) and not (s.allow_c_inside_app and _inside(path, s.engine_dir))", "    return on_c(path) and not _inside(path, s.engine_dir)"),
    ("the C: option is ignored", NR, "    return on_c(path) and not (s.allow_c_inside_app and _inside(path, s.engine_dir))", "    return on_c(path)"),
    ("the start file never passes --node-auto", MB, '+ (" --node-auto" if node_auto else "")', '+ ""'),
    ("--node-allow-c works without --node-auto", MB, "    if node_allow_c and not node_auto:", "    if False:"),
    ("--node-auto works without a sign-in site", MB, "    if node_auto and not site:", "    if False:"),
    ("the settings module does not travel", MB, 'RUNTIME_TOOLS = RUNTIME_TOOLS + ("node_settings.py",)', "RUNTIME_TOOLS = RUNTIME_TOOLS"),
    ("--node-auto replaces a settings file the person gave", DM, "        if a.node_auto and a.site and not a.node_config:", "        if a.node_auto and a.site:"),
    ("--node-auto works without a site", DM, "        if a.node_auto and a.site and not a.node_config:", "        if a.node_auto and not a.node_config:"),
]


def run(tools: Path, scratch: Path):
    return subprocess.run([sys.executable, "-I", str(tools / CHECK), str(scratch), *([ENGINE] if ENGINE else [])], capture_output=True, text=True, timeout=900)


work = Path(tempfile.mkdtemp(prefix="footage-mut-", dir=str(BASE)))
bad = 0
for i, item in enumerate([("baseline", None, None, None)] + M):
    name, fname, a, b = item
    tools = work / f"t{i}" / "tools"
    shutil.copytree(HERE, tools, ignore=shutil.ignore_patterns("__pycache__", "maker-live", "*.zip"))
    if fname:
        f = tools / fname
        t = f.read_bytes().decode("utf-8").replace(chr(13) + NL, NL)
        if t.count(a) != 1:
            print(f"  BROKEN MUTANT (anchor found {t.count(a)}x): {name}")
            bad += 1
            continue
        f.write_bytes(t.replace(a, b).encode("utf-8"))
    scratch = work / f"s{i}"
    scratch.mkdir()
    if fname is None:
        r = run(tools, scratch)
        if r.returncode != 0:
            print("BASELINE FAILS:" + NL + r.stdout[-900:] + r.stderr[-300:])
            sys.exit(1)
        print("baseline passes")
        continue
    try:
        rc = run(tools, scratch).returncode
    except subprocess.TimeoutExpired:
        rc = 1
    print(("caught  " if rc != 0 else "MISSED  ") + name)
    bad += 0 if rc != 0 else 1
print("all mutants caught" if not bad else f"{bad} PROBLEM(S)")
sys.exit(1 if bad else 0)
