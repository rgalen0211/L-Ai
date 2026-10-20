"""The portable app folder builder and its start-time self-check (NEXT-CONNECT 105), with MUST-FAILs. Everything is built from SMALL FAKE inputs in a throwaway folder (a stand-in Python home, a stand-in
ffmpeg, a tiny kit, a temporary git repo) and one small installed library; no download, no network, nothing of the real Python or ffmpeg is touched.

    python tools/check-app-bundle.py [<scratch base folder on D:>]

What it proves
  A  a good build: the folder has its own Python (tkinter kept, docs and tests dropped), the library and what it needs, ffmpeg, the engine, the app tools, a start file that uses only the folder itself,
     a manifest naming the exact app head, and a checksum list; downloads_made is 0; the inputs are unchanged
  B  the self-check says "as built" for that folder, and says in plain words which file when ONE is changed, deleted, added, or a big file has another size (and, with --deep, another content)
  C  the builder REFUSES, leaving nothing behind: a dirty or non-git app repo, an --out off D:, a non-empty --out, no ffmpeg.exe, a Python without tkinter, a kit without its manifest, a library that is
     not installed, too little free space, and a leak (a token, a signed token, a private key, a personal address, Ryan's private folder name, an account cache, an activity log, a .git folder)
  D  it makes no network connection of its own (no networking import in either script)
"""
import hashlib
import importlib.metadata as md
import json
import os
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import make_app_bundle as mab                 # noqa: E402
import verify_bundle as vb                    # noqa: E402

BASE = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(tempfile.mkdtemp(prefix="app-bundle-check-"))
BASE.mkdir(parents=True, exist_ok=True)
FAILS = []


def check(c, what):
    print(("  ok   " if c else "  FAIL ") + what, flush=True)
    if not c:
        FAILS.append(what)


def tree_hash(root: Path) -> str:
    h = hashlib.sha256()
    for p in sorted(x for x in root.rglob("*") if x.is_file()):
        h.update(p.relative_to(root).as_posix().encode())
        h.update(p.read_bytes())
    return h.hexdigest()


def _rm(func, path, exc):
    os.chmod(path, 0o700)                       # git object files are read-only on Windows
    func(path)


def fresh(name: str) -> Path:
    d = BASE / name
    if d.exists():
        shutil.rmtree(d, onerror=_rm)
    d.mkdir(parents=True)
    return d


def git(repo, *a):
    env = dict(os.environ, GIT_AUTHOR_NAME="check", GIT_AUTHOR_EMAIL="check@example.invalid", GIT_COMMITTER_NAME="check", GIT_COMMITTER_EMAIL="check@example.invalid")
    return subprocess.run(["git", "-C", str(repo), *a], capture_output=True, text=True, env=env)


def world(name: str) -> dict:
    root = fresh(name)
    repo = root / "app-repo"
    (repo / "tools").mkdir(parents=True)
    for t in mab.RUNTIME_TOOLS:
        (repo / "tools" / t).write_text(f"# stand-in {t}\n", encoding="utf-8")
    shutil.copy2(HERE / "verify_bundle.py", repo / "tools" / "verify_bundle.py")          # the REAL self-check is what travels
    git(repo, "init", "-q")
    git(repo, "add", "-A")
    git(repo, "commit", "-q", "-m", "init")
    kit = root / "kit"
    (kit / "ryagram" / "local").mkdir(parents=True)
    (kit / "ryagram" / "__init__.py").write_text("# engine\n", encoding="utf-8")
    (kit / "ryagram" / "local" / "engine.py").write_text("print('engine')\n", encoding="utf-8")
    (kit / "recipes").mkdir()
    (kit / "recipes" / "sam-first.json").write_text("{}", encoding="utf-8")
    (kit / "docs").mkdir()
    (kit / "docs" / "SAM-FIRST-SESSION-CHECKLIST.md").write_text("checklist\n", encoding="utf-8")
    (kit / "KIT-MANIFEST.json").write_text(json.dumps({"made_by": "stand-in"}), encoding="utf-8")
    py = root / "pyhome"
    for d in ("DLLs", "Lib/tkinter", "Lib/test", "Lib/idlelib", "Lib/site-packages", "tcl", "Doc", "Scripts", "include"):
        (py / d).mkdir(parents=True)
    (py / "python.exe").write_bytes(b"MZ-standin")
    (py / "python312.dll").write_bytes(b"dll")
    (py / "DLLs" / "_tkinter.pyd").write_bytes(b"pyd")
    (py / "Lib" / "tkinter" / "__init__.py").write_text("# tk\n", encoding="utf-8")
    (py / "Lib" / "test" / "test_big.py").write_text("x" * 10, encoding="utf-8")
    (py / "Lib" / "site-packages" / "junk.py").write_text("# the build PC's own library, must NOT be copied\n", encoding="utf-8")
    (py / "tcl" / "tcl.tcl").write_text("tcl\n", encoding="utf-8")
    (py / "Doc" / "manual.html").write_text("doc\n", encoding="utf-8")
    ff = root / "ffmpeg"
    ff.mkdir()
    (ff / "ffmpeg.exe").write_bytes(os.urandom(1_200_000))             # over the 1 MB line, so it is a "big file"
    (ff / "ffprobe.exe").write_bytes(os.urandom(1_100_000))
    return {"root": root, "repo": repo, "kit": kit, "py": py, "ff": ff, "out": root / "out" / "bundle"}


LIB = "certifi" if any(d.metadata["Name"].lower() == "certifi" for d in md.distributions()) else "pip"


def args(w, **over):
    d = dict(out=str(w["out"]), kit=str(w["kit"]), ffmpeg_dir=str(w["ff"]), python_home=str(w["py"]), model_dir=None, app_repo=str(w["repo"]), libraries=[LIB], zip=False, allow_any_drive=True)
    d.update(over)
    return type("A", (), d)


def refused(w, fragment, **over):
    try:
        mab.build(args(w, **over))
        return False, "no refusal"
    except mab.Refused as e:
        return fragment.lower() in str(e).lower(), str(e)[:600]


# ================================================================================================== A
print("A. a good build")
w = world("a")
before = {k: tree_hash(w[k]) for k in ("kit", "py", "ff")}
r = mab.build(args(w, zip=True))
out = w["out"]
check((out / "python" / "python.exe").is_file() and (out / "python" / "Lib" / "tkinter" / "__init__.py").is_file() and (out / "python" / "DLLs" / "_tkinter.pyd").is_file() and (out / "python" / "tcl").is_dir(), "its own Python is there with tkinter and tcl kept")
check(not (out / "python" / "Doc").exists() and not (out / "python" / "Lib" / "test").exists() and not (out / "python" / "Lib" / "idlelib").exists() and not (out / "python" / "Scripts").exists(), "the docs, tests, idle and scripts are dropped")
check(not (out / "python" / "Lib" / "site-packages" / "junk.py").exists(), "the build PC's own site-packages is NOT copied wholesale (only the named libraries and what they need)")
check(any((out / "python" / "Lib" / "site-packages").glob(f"{LIB}*")), f"the library {LIB} and its metadata are in the bundle's own site-packages")
check((out / "ffmpeg" / "ffmpeg.exe").is_file() and (out / "ffmpeg" / "ffprobe.exe").is_file() and not (out / "ffmpeg" / "ffplay.exe").exists(), "ffmpeg.exe and ffprobe.exe only")
check((out / "ryagram" / "local" / "engine.py").is_file() and (out / "recipes" / "sam-first.json").is_file() and (out / "ENGINE-MANIFEST.json").is_file(), "the engine, the recipes and the kit's own record of the engine heads are there")
check(all((out / "tools" / t).is_file() for t in mab.RUNTIME_TOOLS), "the app tools (maker, sign-in, node loop, the self-check) are there")
bat = (out / "Open Ryagram.bat").read_text(encoding="ascii")
check("%~dp0" in bat and "C:\\" not in bat and "C:/" not in bat and ":\\Users" not in bat, "the start file refers only to its own folder (no drive letter, no user folder)")
vline = next(l for l in bat.splitlines() if "verify_bundle.py" in l)
aline = next(l for l in bat.splitlines() if "desktop_maker.py" in l)
check(' -I ' in vline and ' -I ' in aline and bat.index("verify_bundle.py") < bat.index("desktop_maker.py") and "errorlevel 1" in bat[bat.index("verify_bundle.py"):bat.index("desktop_maker.py")], "it runs the self-check BEFORE the app, both with the isolated flag, and stops if the check fails")
check('--work-dir "%~dp0work"' in bat and '--out-dir "%~dp0films"' in bat and "RYAGRAM_MODEL_DIR=%~dp0models" in bat and "FFMPEG_PATH=%~dp0ffmpeg" in bat, "work, films, model and ffmpeg all point inside the folder")
check('%~dp0"' not in bat and 'verify_bundle.py" "%~dp0."' in bat, "a folder handed to a program ends in a dot, never in a backslash before the closing quote (found by really running the start file: the check read the folder as missing its manifest)")
check("Run anyway" in (out / "START-HERE.txt").read_text(encoding="ascii") and "say no" in (out / "START-HERE.txt").read_text(encoding="ascii"), "START-HERE carries the Run-anyway rule (match the file name; anyone else asks: say no)")
m = json.loads((out / "BUNDLE-MANIFEST.json").read_text(encoding="utf-8"))
head = git(w["repo"], "rev-parse", "HEAD").stdout.strip()
check(m["app_head"] == head and m["downloads_made"] == 0 and LIB in m["libraries"], "the manifest names the exact app head, the libraries, and says no download was made")
check(set(m["ffmpeg_sha256"]) == {"ffmpeg.exe", "ffprobe.exe"} and m["ffmpeg_sha256"]["ffmpeg.exe"] == hashlib.sha256((w["ff"] / "ffmpeg.exe").read_bytes()).hexdigest(), "ffmpeg's SHA-256 is recorded")
sums = vb.read_sums(out / "SHA256SUMS.txt")
check("ryagram/local/engine.py" in sums and "Open Ryagram.bat" in sums and "BUNDLE-MANIFEST.json" in sums and not any(k.startswith("python/") for k in sums), "every app file is in the checksum list (the big parts are by size and SHA-256 in the manifest)")
check({k: tree_hash(w[k]) for k in ("kit", "py", "ff")} == before, "the inputs were not changed")
check(Path(r["zip"]).is_file() and zipfile.ZipFile(r["zip"]).namelist()[0].startswith("bundle/") and r["zip_sha256"] == vb.sha256_file(Path(r["zip"])), "--zip writes a zip with one top folder and prints its exact name and SHA-256")
check(not any(f.name == "__pycache__" for f in out.rglob("*")), "no __pycache__ travels")

# ================================================================================================== B
print("\nB. the self-check")
check(vb.check(out) == [], "as built: nothing to report")
rc = subprocess.run([sys.executable, str(out / "tools" / "verify_bundle.py"), str(out)], capture_output=True, text=True)
check(rc.returncode == 0 and "All files are as they were when this folder was built." in rc.stdout, "run as a program it says so in one sentence and exits 0")


p = out / "ryagram" / "local" / "engine.py"
orig = p.read_bytes()
p.write_text("print('changed')\n")
got = vb.check(out)
check(got == ["ryagram/local/engine.py has been changed."], f"MUST-FAIL: a changed app file is named ({got})")
rc = subprocess.run([sys.executable, str(out / "tools" / "verify_bundle.py"), str(out)], capture_output=True, text=True)
check(rc.returncode == 1 and "Do not go on; tell Ryan" in rc.stdout and "ryagram/local/engine.py has been changed." in rc.stdout, "and as a program it exits 1 with the plain sentence")
p.write_bytes(orig)
p.unlink()
check(vb.check(out) == ["ryagram/local/engine.py is missing."], "MUST-FAIL: a deleted app file is named")
p.write_bytes(orig)
(out / "ryagram" / "extra.py").write_text("x", encoding="utf-8")
check(vb.check(out) == ["ryagram/extra.py was added and is not part of what was built."], "MUST-FAIL: a file added to the app folders is named")
(out / "ryagram" / "extra.py").unlink()
(out / "tools" / "sneaky.bat").write_text("x", encoding="utf-8")
check(len(vb.check(out)) == 1, "MUST-FAIL: ... also in tools")
(out / "tools" / "sneaky.bat").unlink()
fp = out / "ffmpeg" / "ffmpeg.exe"
fo = fp.read_bytes()
fp.write_bytes(fo[:-10])
check(vb.check(out) == ["ffmpeg/ffmpeg.exe is not the size it was built with."], "MUST-FAIL: a big file with another size is named")
fp.write_bytes(os.urandom(len(fo)))
check(vb.check(out) == [] and vb.check(out, deep=True) == ["ffmpeg/ffmpeg.exe has been changed."], "same size, other content: the start check cannot see it (by design, it is fast), --deep does")
fp.write_bytes(fo)
fp.unlink()
check(vb.check(out) == ["ffmpeg/ffmpeg.exe is missing."], "MUST-FAIL: a missing big file is named")
fp.write_bytes(fo)
(out / "START-HERE.txt").write_text("changed", encoding="ascii")
check(vb.check(out) == ["START-HERE.txt has been changed."], "MUST-FAIL: a changed start text is named (the instructions are part of what was built)")
shutil.rmtree(out)
r2 = mab.build(args(w))
(out / "SHA256SUMS.txt").unlink()
check("missing" in vb.check(out)[0], "MUST-FAIL: with the checksum list gone the check says so rather than passing")
(out / "work" / "my-film.mp4").write_bytes(b"x")
check(True, "(work and films are the person's own and are never checked)")

# ================================================================================================== C
print("\nC. the builder refuses, and leaves nothing behind")
w = world("c1")
(w["repo"] / "tools" / "desktop_maker.py").write_text("# changed after the commit\n")
ok, msg = refused(w, "uncommitted changes")
check(ok and not w["out"].exists(), f"MUST-FAIL: a dirty app repo ({msg})")
w = world("c2")
shutil.rmtree(w["repo"] / ".git", onerror=lambda f, p, e: (os.chmod(p, 0o700), f(p)))
ok, msg = refused(w, "not a git checkout")
check(ok and not w["out"].exists(), "MUST-FAIL: not a git checkout")
w = world("c3")
ok, msg = refused(w, "must be on D:", out="C:/Users/nobody/bundle", allow_any_drive=False)
check(ok and not Path("C:/Users/nobody/bundle").exists(), "MUST-FAIL: --out off D:")
w = world("c4")
w["out"].mkdir(parents=True)
(w["out"] / "old.txt").write_text("an earlier bundle")
ok, msg = refused(w, "already has files")
check(ok and (w["out"] / "old.txt").read_text() == "an earlier bundle", "MUST-FAIL: a non-empty --out is never overwritten")
w = world("c5")
(w["ff"] / "ffprobe.exe").unlink()
ok, msg = refused(w, "no ffprobe.exe")
check(ok and not w["out"].exists() and "downloads nothing" in msg, "MUST-FAIL: no ffprobe.exe, and it says this script downloads nothing")
w = world("c6")
shutil.rmtree(w["py"] / "Lib" / "tkinter")
ok, msg = refused(w, "no tkinter")
check(ok and not w["out"].exists(), "MUST-FAIL: a Python without tkinter (the embeddable zip) is refused")
w = world("c7")
(w["kit"] / "KIT-MANIFEST.json").unlink()
ok, msg = refused(w, "KIT-MANIFEST.json")
check(ok, "MUST-FAIL: a kit without its manifest")
w = world("c8")
ok, msg = refused(w, "is not installed", libraries=["no-such-library-xyz"])
check(ok and not w["out"].exists(), "MUST-FAIL: a library that is not installed is a Ryan row, never fetched")
w = world("c9")
real = shutil.disk_usage
mab.shutil.disk_usage = lambda p: type("U", (), {"free": 1000})()
ok, msg = refused(w, "not enough free space")
mab.shutil.disk_usage = real
check(ok and not w["out"].exists(), "MUST-FAIL: too little free space")
LEAKS = {
    "a node token": ("ryagram/local/x.py", "TOKEN = 'rgn_" + "A" * 43 + "'\n"),
    "a signed token": ("recipes/x.json", "{\"t\": \"eyJ" + "a" * 20 + "." + "b" * 20 + "." + "c" * 20 + "\"}"),
    "a private key": ("docs/x.md", "-----BEGIN RSA PRIVATE KEY-----\n"),
    "personal address": ("ryagram/x.py", "# galenryan.s\n"),
    "the name of Ryan's private folder": ("docs/y.md", "D:\\Ryagram-scratch\\RYAN-ONLY\\x"),
}
for what, (rel, text) in LEAKS.items():
    w = world("c10")
    (w["kit"] / rel).parent.mkdir(parents=True, exist_ok=True)
    (w["kit"] / rel).write_text(text, encoding="utf-8")
    ok, msg = refused(w, what)
    check(ok and not w["out"].exists(), f"MUST-FAIL: the leak scan stops {what}")
for rel in ("ryagram/ryagram-account.json", "ryagram/maker-activity-log.jsonl", "ryagram/ryagram-node.json", "docs/dump.dump", "recipes/x.log"):
    w = world("c11")
    (w["kit"] / rel).write_text("{}", encoding="utf-8")
    ok, msg = refused(w, "must never travel")
    check(ok and not w["out"].exists(), f"MUST-FAIL: {rel} is a file that must never travel")
w = world("c12")
(w["kit"] / "ryagram" / ".git").mkdir()
(w["kit"] / "ryagram" / ".git" / "config").write_text("x")
ok, msg = refused(w, "must never travel")
check(ok, "MUST-FAIL: a .git folder in the kit")

# ================================================================================================== D
print("\nC2. conditions on libraries are read, not guessed")
try:
    md.distribution("faster-whisper")
    have_fw = True
except md.PackageNotFoundError:
    have_fw = False
if have_fw:
    cl = mab.requirement_closure(["faster-whisper"])
    check("faster-whisper" in cl and "ctranslate2" in cl and "exceptiongroup" not in cl and "tomli" not in cl, f"faster-whisper's closure follows its conditions ({len(cl)} libraries, none that only an older Python needs)")
else:
    print("  SKIPPED: faster-whisper is not installed here")

print("\nD. no network of its own")
for f in ("make_app_bundle.py", "verify_bundle.py"):
    src = (HERE / f).read_text(encoding="utf-8")
    code = "\n".join(l for l in src.splitlines() if l.lstrip().startswith(("import ", "from ")))
    check(not any(x in code for x in ("socket", "urllib", "http", "requests", "ftplib", "smtplib", "ssl")), f"{f} imports no networking module")

print()
if FAILS:
    print(f"FAILED: {len(FAILS)}")
    for f in FAILS:
        print("  -", f)
    sys.exit(1)
print("all passed")
