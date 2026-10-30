"""Must-fail proof for tools/check-media-checklist.py (NEXT-CONNECT 161): each mutant breaks ONE rule in a scratch copy of tools/ and the check must then FAIL (a baseline on the unbroken copy passes first).

    py -I tools/check-media-checklist-mutants.py <scratch base folder on D:>
"""
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
BASE = Path(sys.argv[1])
NL = chr(10)
MC, RQ, DM = "maker_checklist.py", "ryagram_requests.py", "desktop_maker.py"
M = [
    ("a folder name may be a path", MC, "NAME = re.compile(r'^[^\\\\/:*?\"<>|\\x00-\\x1f]{1,80}$')", "NAME = re.compile(r'^.{1,300}$')"),
    ("a folder that is a link is followed", MC, "if cand.is_dir() and not _is_link(cand):", "if cand.is_dir():"),
    ("a note file counts as a video", MC, 'VIDEO_EXTS = (".mp4", ".mkv", ".mov", ".avi", ".webm", ".m4v")', 'VIDEO_EXTS = (".mp4", ".mkv", ".mov", ".avi", ".webm", ".m4v", ".txt", ".part")'),
    ("a huge folder is read to the end", MC, "if seen > MAX_ENTRIES:", "if False:"),
    ("a tick is stored under any key", MC, "if not isinstance(key, str) or not KEY.match(key):", "if not isinstance(key, str):"),
    ("a tick file with a false value counts", MC, "if KEY.match(k) and v is True}", "if KEY.match(k)}"),
    ("a hand tick does not make an item done", MC, '"done": bool(manual or (folder is not None and have >= int(it.get("count") or 1)))', '"done": bool(folder is not None and have >= int(it.get("count") or 1))'),
    ("an item is done one file early", MC, "have >= int(it.get(\"count\") or 1)", "have >= int(it.get(\"count\") or 1) - 1"),
    ("the key ignores the words of the item", MC, 'str(item.get("what", "")), ', ""),
    ("a link in an item's words is accepted", RQ, "if not what or _PATHISH.search(what) or _LINKISH.search(what):", "if not what or _PATHISH.search(what):"),
    ("a place in an item's words is accepted", RQ, "if not what or _PATHISH.search(what) or _LINKISH.search(what):", "if not what or _LINKISH.search(what):"),
    ("a link in the optional words is kept", RQ, "if _PATHISH.search(where) or _LINKISH.search(where):", "if False:"),
    ("a place in the optional words is kept", RQ, "if _PATHISH.search(must) or _LINKISH.search(must):", "if False:"),
    ("a folder that is a path is accepted", RQ, 'if not _mc.NAME.match(folder) or folder in (".", ".."):', "if False:"),
    ("a count of any size is accepted", RQ, "1 <= count <= 20 else 1", "1 <= count else 1"),
    ("any number of items", RQ, "MAX_CHECKLIST = 12", "MAX_CHECKLIST = 1200"),
    ("the card counts nothing (the checklist is not decorated)", DM, "r = {**r, \"requests\": maker_checklist.decorate(", "r = {**r, \"requests_unused\": maker_checklist.decorate("),
    ("any word ticks an item", DM, 'key, done = body.get("key"), body.get("done") is True', 'key, done = body.get("key"), bool(body.get("done"))'),
    ("the tick route is not one of the page's routes", DM, '"ai-requests", "ai-checklist", "links",', '"ai-requests", "links",'),
    ("the page says Ryagram downloads something", DM, "Ryagram downloads nothing: put the files", "Ryagram downloads the files: put the files"),
]


def run(root: Path, scratch: Path):
    return subprocess.run([sys.executable, "-I", str(root / "tools" / "check-media-checklist.py"), str(scratch)], capture_output=True, text=True, timeout=600)


work = Path(tempfile.mkdtemp(prefix="ZZTckl-mut-", dir=str(BASE)))
bad = 0
try:
    for i, item in enumerate([("baseline", None, None, None)] + M):
        name, fname, a, b = item
        root = work / f"r{i}"
        shutil.copytree(HERE, root / "tools", ignore=shutil.ignore_patterns("__pycache__", "maker-live", "*.zip"))
        if fname:
            f = root / "tools" / fname
            t = f.read_bytes().decode("utf-8").replace(chr(13) + NL, NL)
            if t.count(a) != 1:
                print(f"  BROKEN MUTANT (anchor found {t.count(a)}x): {name}")
                bad += 1
                continue
            f.write_bytes(t.replace(a, b).encode("utf-8"))
        s = work / f"s{i}"
        s.mkdir()
        r = run(root, s)
        if fname is None:
            if r.returncode != 0:
                print("BASELINE FAILS:" + NL + r.stdout[-900:] + r.stderr[-300:])
                sys.exit(1)
            print("baseline passes")
            continue
        print(("caught  " if r.returncode != 0 else "MISSED  ") + name)
        bad += 0 if r.returncode != 0 else 1
finally:
    shutil.rmtree(work, ignore_errors=True)
print("all mutants caught" if not bad else f"{bad} PROBLEM(S)")
sys.exit(1 if bad else 0)
