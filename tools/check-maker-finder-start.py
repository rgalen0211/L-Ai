"""'Open phrase finder.bat' in the customer's zip (BUILDER 11-22; FACES' Sam sheet: 'installs the desktop app and the phrase finder from the
zip without help'). Proves, with MUST-FAILs, on start files written into a throwaway folder and a STAND-IN engine (nothing real runs, no
network, no model):
  A  the finder's start file is written beside Open Ryagram.bat, with the SAME self-check lines (stop on a changed file), the app's own
     Python, ffmpeg and model folder (so the model is not downloaded twice), and the library kept inside the app's work folder
  B  it names no developer path and no 'Ryan'; START-HERE tells the person about it
  C  tools/open_phrase_finder.py travels in the zip (RUNTIME_TOOLS) and runs `ryagram.library start` from the app folder under -I,
     passing its arguments on; a copy without the first-run page says so in plain words and exits 2, starting nothing
  D  the kit's developer notes (recipes/README-FIRST-RUN.md: Python, winget, INTERNAL) are kept out of the zip's recipes

    python tools/check-maker-finder-start.py
"""
import importlib.util
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FAILED = []


def check(ok, name):
    print(("ok   " if ok else "FAIL ") + name, flush=True)
    if not ok:
        FAILED.append(name)


sys.path.insert(0, str(ROOT / "tools"))
spec = importlib.util.spec_from_file_location("make_app_bundle", ROOT / "tools" / "make_app_bundle.py")
mb = importlib.util.module_from_spec(spec)
sys.modules["make_app_bundle"] = mb
spec.loader.exec_module(mb)
DEV = re.compile(r"\bRyan\b|INTERNAL|D:\\Ryagram|C:\\Users|Ryagram-scratch", re.I)

with tempfile.TemporaryDirectory(prefix="mfs-") as td:
    td = Path(td)
    out = td / "app"
    (out / "tools").mkdir(parents=True)
    mb.write_start_files(out, has_model=False)
    fb = out / mb.FINDER_BAT
    print("A. the start file")
    check(fb.is_file(), f"MUST-FAIL: '{mb.FINDER_BAT}' is written at the zip's root")
    finder = fb.read_bytes().decode("ascii") if fb.is_file() else ""
    app = (out / "Open Ryagram.bat").read_bytes().decode("ascii")
    self_check = app[: app.index("\r\n)\r\n") + 3]
    same = [ln for ln in self_check.split("\r\n") if not ln.startswith(("rem ", "title "))]
    check(all(ln in finder.split("\r\n") for ln in same) and
          "verify_bundle.py" in finder and "exit /b 1" in finder and finder.index("verify_bundle.py") < finder.index("open_phrase_finder.py"),
          "MUST-FAIL: the self-check runs first and stops the finder on a changed file (the same lines as the app's)")
    for line in ('set "RYAGRAM_MODEL_DIR=%~dp0models"', 'set "FFMPEG_PATH=%~dp0ffmpeg\\ffmpeg.exe"', 'set "PATH=%~dp0python;%~dp0ffmpeg;%PATH%"',
                 'set "PYTHONNOUSERSITE=1"', 'set "RYAGRAM_LIBRARY_DIR=%~dp0work\\library"'):
        check(line in finder, f"MUST-FAIL: the finder's start file sets {line.split('=')[0][5:]}")
    check('"%~dp0python\\python.exe" -I "%~dp0tools\\open_phrase_finder.py"' in finder, "it runs the app's own Python with -I on tools\\open_phrase_finder.py")
    check("desktop_maker.py" not in finder and "--site" not in finder, "it does not start the desktop maker or touch the site")
    print("B. words")
    start = (out / "START-HERE.txt").read_text(encoding="ascii")
    check(not DEV.search(finder) and not DEV.search(start), f"MUST-FAIL: no developer path or 'Ryan' in the finder's start file or START-HERE: {DEV.findall(finder + start)}")
    check(mb.FINDER_BAT in start, "START-HERE tells the person how to open the phrase finder")

    print("C. the launcher")
    check("open_phrase_finder.py" in mb.RUNTIME_TOOLS, "MUST-FAIL: tools/open_phrase_finder.py travels in the zip")
    stand = td / "stand"
    (stand / "tools").mkdir(parents=True)
    shutil.copy2(ROOT / "tools" / "open_phrase_finder.py", stand / "tools")
    r = subprocess.run([sys.executable, "-I", str(stand / "tools" / "open_phrase_finder.py")], cwd=td, capture_output=True, text=True, timeout=60)
    check(r.returncode == 2 and "does not have the phrase finder's first-run page" in r.stdout and "Traceback" not in r.stdout + r.stderr,
          "MUST-FAIL: a copy without the first-run page says so in plain words and exits 2")
    lib = stand / "ryagram" / "library"
    lib.mkdir(parents=True)
    (stand / "ryagram" / "__init__.py").write_text("", encoding="utf-8")
    (lib / "__init__.py").write_text("", encoding="utf-8")
    (lib / "firstrun.py").write_text("", encoding="utf-8")
    (lib / "__main__.py").write_text("import sys\nprint('LIBRARY ARGS ' + ' '.join(sys.argv[1:]))\n", encoding="utf-8")
    r = subprocess.run([sys.executable, "-I", str(stand / "tools" / "open_phrase_finder.py"), "--no-browser"], cwd=td, capture_output=True, text=True, timeout=60)
    check(r.returncode == 0 and "LIBRARY ARGS start --no-browser" in r.stdout,
          f"MUST-FAIL: under -I, from another folder, it runs ryagram.library start from the APP folder and passes its arguments on ({r.stdout.strip()[:80]!r})")

print("D. the kit's developer notes stay out")
src = (ROOT / "tools" / "make_app_bundle.py").read_text(encoding="utf-8")
check(mb.FIRST_RUN_DOC == "README-FIRST-RUN.md" and 'ignore=shutil.ignore_patterns("__pycache__", FIRST_RUN_DOC)' in src,
      "MUST-FAIL: recipes/README-FIRST-RUN.md is left out when the kit's recipes are copied")
with tempfile.TemporaryDirectory(prefix="mfs-") as td:
    k = Path(td) / "recipes"
    k.mkdir()
    (k / "README-FIRST-RUN.md").write_text("INTERNAL", encoding="utf-8")
    (k / "every-time.json").write_text("{}", encoding="utf-8")
    shutil.copytree(k, Path(td) / "out", ignore=shutil.ignore_patterns("__pycache__", mb.FIRST_RUN_DOC))
    check(sorted(p.name for p in (Path(td) / "out").iterdir()) == ["every-time.json"], "the same copy rule keeps the recipes and drops only the notes")

if FAILED:
    print(f"FAILED: {len(FAILED)}")
    for f in FAILED:
        print("  " + f)
    sys.exit(1)
print("ALL PASS")
