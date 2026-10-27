"""Must-fail proof for tools/check-maker-share.py: each mutant breaks ONE thing in a scratch copy of the maker's tools and the check must then FAIL (a baseline on the unbroken copy passes first).

    py -I tools/check-maker-share-mutants.py <Ryagram checkout> <scratch base folder on D:>"""
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
ENGINE, BASE = sys.argv[1], Path(sys.argv[2])
NL = chr(10)
MUTANTS = [
    ("blur is never applied to the list", "maker_edit.py", '    if not S().get("blur"):' + NL + "        return lst" + NL, "    return lst" + NL),
    ("the final build ignores the blur switch", "maker_edit.py", "        lst = _with_blur(lst)" + NL, ""),
    ("the switch can be turned on with no face finder", "maker_edit.py", '    if blur_model() is None and body.get("on"):', "    if False:"),
    ("the face finder is looked for nowhere", "maker_edit.py", "    for d in dirs:" + NL + "        if d and Path(d).is_dir():", "    for d in []:" + NL + "        if d and Path(d).is_dir():"),
    ("a shared recipe ignores the name the person typed", "maker_edit.py", '    name = " ".join(str(body.get("name") or "").split())[:60] or None', "    name = None"),
    ("a shared recipe is built from an empty recipe, not the one that ran", "maker_edit.py", '    base = _dm.STATE.get("last_recipe")', '    base = _dm.STATE.get("last_recipe") and {}'),
    ("an imported recipe skips the portability check", "desktop_maker.py", "        portable.check(rec)", "        pass"),
    ("an imported recipe replaces one with the same name", "desktop_maker.py", "    while dest.exists():", "    while False:"),
    ("an import without the portability check is allowed through", "desktop_maker.py", '        raise Problem("This app cannot check recipe files yet, so that recipe was not added.") from None', "        portable = type('P', (), {'check': staticmethod(lambda r: None)})"),
    ("an imported recipe is not checked by the engine", "desktop_maker.py", '        rec = STATE["R"].parse_recipe(raw)', "        rec = json.loads(raw)"),
    ("the share card is not on the page", "desktop_maker.py", '(SHARE_CARD if STATE.get("edit_on") else "")', '""'),
    ("a words recipe is not filled in", "desktop_maker.py", "current.has_find && current.op === 'words' ? current.find : ''", "''"),
]


def run(tools: Path, scratch: Path):
    return subprocess.run([sys.executable, "-I", str(tools / "check-maker-share.py"), ENGINE, str(scratch)], capture_output=True, text=True, timeout=300)


work = Path(tempfile.mkdtemp(prefix="share-mut-", dir=str(BASE)))
bad = 0
try:
    for i, (name, fname, a, b) in enumerate([("baseline", None, None, None)] + MUTANTS):
        tools = work / f"t{i}"
        shutil.copytree(HERE, tools, ignore=shutil.ignore_patterns("__pycache__", "maker-live", "licence-supplements", "*.zip"))
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
        r = run(tools, scratch)
        if fname is None:
            if r.returncode != 0:
                print("BASELINE FAILS:" + NL + r.stdout[-800:] + r.stderr[-400:])
                sys.exit(1)
            print("baseline passes")
            continue
        caught = r.returncode != 0
        print(("caught  " if caught else "MISSED  ") + name)
        bad += 0 if caught else 1
finally:
    shutil.rmtree(work, ignore_errors=True)
print("all mutants caught" if not bad else f"{bad} PROBLEM(S)")
sys.exit(1 if bad else 0)
