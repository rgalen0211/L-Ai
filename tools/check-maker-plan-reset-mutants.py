"""Must-fail proof for tools/check-maker-plan-reset.py: each mutant breaks ONE thing in a scratch copy of the maker's tools and the check must then FAIL (a baseline on the unbroken copy passes first).

    py -I tools/check-maker-plan-reset-mutants.py <engine checkout> <scratch base folder on D:>"""
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
ENGINE, BASE = sys.argv[1], Path(sys.argv[2])
MUTANTS = [
    ("the same plan resets the person's edits", "maker_edit.py", "    if old == sha:\n        return False\n", ""),
    ("the saved edit list is kept on a new plan", "maker_edit.py", "gone = [edit_path(), _dm.STATE", "gone = [_dm.STATE"),
    ("the committed list of the old plan is kept", "maker_edit.py", '_dm.STATE["work"] / "edit" / "committed-edit.json", _dm.STATE["work"] / "edit-media.json"]', '_dm.STATE["work"] / "edit-media.json"]'),
    ("a FIRST plan counts as a change (the live draft starts again before any change)", "maker_edit.py", "    return had_something", "    return True"),
    ("the plan's fingerprint is not written to disk", "maker_edit.py", '        mark.write_text(sha, encoding="utf-8")', "        pass"),
    ("the live draft is not started again", "maker_live.py", '        s["draft"].set_base("compilation", _tracks().tracks_from_edit(lst, _media_seconds()))', "        pass"),
    ("an old draft file is not removed", "maker_live.py", '(_dm.STATE["work"] / "live" / "live-draft.json").unlink(missing_ok=True)', "pass"),
    ("job_status never tells the editor about a new plan", "desktop_maker.py", '        _new_plan(out.get("plan"))\n', ""),
    ("without --live the edit page is not told", "desktop_maker.py", "        if _edit_mod().plan_changed(plan) and STATE.get(\"live_on\"):", "        if False:"),
]


def run(tools: Path, scratch: Path):
    return subprocess.run([sys.executable, "-I", str(tools / "check-maker-plan-reset.py"), ENGINE, str(scratch)], capture_output=True, text=True, timeout=300)


work = Path(tempfile.mkdtemp(prefix="plan-mut-", dir=str(BASE)))
bad = 0
try:
    for i, (name, fname, a, b) in enumerate([("baseline", None, None, None)] + MUTANTS):
        tools = work / f"t{i}"
        shutil.copytree(HERE, tools, ignore=shutil.ignore_patterns("__pycache__", "maker-live", "licence-supplements", "*.zip"))
        if fname:
            f = tools / fname
            t = f.read_bytes().decode("utf-8").replace("\r\n", "\n")
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
                print("BASELINE FAILS:\n" + r.stdout[-800:] + r.stderr[-400:])
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
