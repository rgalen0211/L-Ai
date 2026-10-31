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
    (repo / "tools" / "get_word_builder.py").write_text("# stand-in get_word_builder.py" + chr(10), encoding="utf-8")        # not a runtime tool: it travels only with --word-builder
    for t in mab.RUNTIME_TOOLS:
        (repo / "tools" / t).write_text(f"# stand-in {t}\n", encoding="utf-8")
    for d in mab.RUNTIME_PAGE_DIRS:
        (repo / "tools" / d).mkdir()
        for f in ("page.html", "page.js", "page.css", "fixture.js"):
            (repo / "tools" / d / f).write_text(f"/* stand-in {d}/{f} */\n", encoding="utf-8")
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
check(set(mab.RUNTIME_PAGE_DIRS) == {"maker-edit", "maker-live", "maker-song"} and all((out / "tools" / d / "page.html").is_file() and not (out / "tools" / d / "fixture.js").exists() for d in mab.RUNTIME_PAGE_DIRS), "the edit, live and song page folders travel with their html, js and css, and the test fixture beside them does not")
check({"maker_edit.py", "maker_song.py"} <= set(mab.RUNTIME_TOOLS), "MUST-FAIL guard: the edit page and the song page modules travel (desktop_maker imports them when --edit/--song is on; without them the folder cannot open either page)")
bat = (out / "Open Ryagram.bat").read_text(encoding="ascii")
check("%~dp0" in bat and "C:\\" not in bat and "C:/" not in bat and ":\\Users" not in bat, "the start file refers only to its own folder (no drive letter, no user folder)")
vline = next(l for l in bat.splitlines() if "verify_bundle.py" in l)
aline = next(l for l in bat.splitlines() if "desktop_maker.py" in l)
check(' -I ' in vline and ' -I ' in aline and bat.index("verify_bundle.py") < bat.index("desktop_maker.py") and "errorlevel 1" in bat[bat.index("verify_bundle.py"):bat.index("desktop_maker.py")], "it runs the self-check BEFORE the app, both with the isolated flag, and stops if the check fails")
check(aline.rstrip().endswith("%OPEN% %MAKER_EXTRA%") and "MAKER_EXTRA=" not in bat, "the start file adds whatever the tester set in MAKER_EXTRA (for example --edit --song) and sets none itself: the edit and song pages stay off unless asked for")
check('--work-dir "%~dp0work"' in bat and '--out-dir "%~dp0films"' in bat and "RYAGRAM_MODEL_DIR=%~dp0models" in bat and "FFMPEG_PATH=%~dp0ffmpeg" in bat, "work, films, model and ffmpeg all point inside the folder")
check(not any('%~dp0"' in l for l in bat.splitlines() if "python.exe" in l) and 'verify_bundle.py" "%~dp0."' in bat, "a folder handed to a program ends in a dot, never in a backslash before the closing quote (found by really running the start file: the check read the folder as missing its manifest)")
sh = (out / "START-HERE.txt").read_text(encoding="ascii")
check((out / "tools" / "model_download.py").is_file() and not (out / "tools" / "get-model.bat").exists() and "Download the listening model" in sh and "get-model" not in sh, "106: the folder carries the in-app model download and no script that needs a system Python; START-HERE points at the button")
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

print("E. the start file can turn the song page on (NEXT-CONNECT 130)")
w = world("e")
mab.build(args(w, maker_extra="--song --song-forge"))
bat = (w["out"] / "Open Ryagram.bat").read_text(encoding="ascii")
lines = bat.splitlines()
dflt = [l for l in lines if "MAKER_EXTRA" in l and "set" in l]
check(dflt == ['if not defined MAKER_EXTRA set "MAKER_EXTRA=--song --song-forge"'], "the start file sets the song switches ONLY when the tester has not set MAKER_EXTRA himself")
check(lines.index(dflt[0]) < next(i for i, l in enumerate(lines) if "desktop_maker.py" in l) and next(l for l in lines if "desktop_maker.py" in l).rstrip().endswith("%OPEN% %MAKER_EXTRA%"), "the setting comes before the app line and the app line still ends with %MAKER_EXTRA%")
w = world("f")
good, why = refused(w, "may only hold", maker_extra="--song --site https://evil.example")
check(good, "MUST-FAIL: a switch outside the allowed list (here --site) is refused: " + why)
w = world("g")
good, why = refused(w, "may only hold", maker_extra="--song&calc")
check(good, "MUST-FAIL: a shell character cannot ride in (the word is checked whole): " + why)

print("F. the second start file (fill missing words) and the rule that the normal one never passes --song-forge (CC1 18:15)")
w = world("h")
mab.build(args(w, maker_extra="--song", forge_bat=True))
normal = (w["out"] / "Open Ryagram.bat").read_text(encoding="ascii")
forge = (w["out"] / mab.FORGE_BAT).read_text(encoding="ascii")
check("song-forge" not in normal and 'MAKER_EXTRA=--song"' in normal, "MUST-FAIL guard: the normal start file passes --song and NEVER --song-forge")
check('MAKER_EXTRA=--song --song-forge"' in forge and forge.rstrip().splitlines()[-2].endswith("%OPEN% %MAKER_EXTRA%"), "the second start file turns the forge on, and still ends with the app line")
check(forge.replace('MAKER_EXTRA=--song --song-forge', 'MAKER_EXTRA=--song') == normal, "the two start files differ ONLY in the forge switch")
sums = (w["out"] / "SHA256SUMS.txt").read_text(encoding="utf-8")
check(mab.FORGE_BAT in sums, "the second start file is in the self-check's list (so it cannot be swapped unseen)")
w = world("i")
mab.build(args(w, maker_extra="--song"))
check(not (w["out"] / mab.FORGE_BAT).exists(), "without --forge-bat the second start file is not written")

print("G. the word-builder add-on INSIDE the bundle (NEXT-CONNECT 136, one zip)")
import make_forge_addon as mfa                                  # noqa: E402
w = world("j")
mab.build(args(w, maker_extra="--song", forge_bat=True, word_builder=True))
o = w["out"]
bat = (o / mab.WORD_BUILDER_BAT).read_bytes().decode("ascii")
check((o / "tools" / "get_word_builder.py").read_text(encoding="utf-8") == "# stand-in get_word_builder.py" + chr(10) and not (o / "get_word_builder.py").exists(), "the script travels in tools/ (not at the root); only the .bat is a new root file")
check(bat == mfa.bat_text("tools" + chr(92) + "get_word_builder.py") and "%~dp0tools" + chr(92) + "get_word_builder.py" in bat and "--models" in bat, "the .bat runs the bundle's own python on tools" + chr(92) + "get_word_builder.py with the bundle's models folder")
check(mfa.bat_text() == mfa.BAT and "%~dp0get_word_builder.py" in mfa.BAT, "MUST-FAIL guard: the add-on zip's own .bat text is exactly what it was (default argument unchanged)")
sums = (o / "SHA256SUMS.txt").read_text(encoding="utf-8")
check(mab.WORD_BUILDER_BAT in sums and "tools/get_word_builder.py" in sums, "both add-on files are in the self-check's list")
check(vb.check(o) == [], "the self-check still says 'as built' with the add-on inside")
sh = (o / "START-HERE.txt").read_text(encoding="ascii")
check("Get word builder.bat" in sh and "378 MB" in sh and "type YES" in sh, "START-HERE says what the word builder is, its size, and that it asks for YES")
(o / "tools" / "get_word_builder.py").write_text("# changed" + chr(10), encoding="utf-8")
check(vb.check(o) == ["tools/get_word_builder.py has been changed."], "MUST-FAIL: a changed tools/get_word_builder.py is named")
(o / "tools" / "get_word_builder.py").write_text("# stand-in get_word_builder.py" + chr(10), encoding="utf-8")
(o / mab.WORD_BUILDER_BAT).write_bytes(bat.replace("-I", "").encode("ascii"))
check(vb.check(o) == ["Get word builder.bat has been changed."], "MUST-FAIL: a changed Get word builder.bat is named")
(o / mab.WORD_BUILDER_BAT).write_bytes(bat.encode("ascii"))
check(vb.check(o) == [], "(restored: as built again)")
(o / "models").mkdir(exist_ok=True)
(o / "models" / "alignment-model.bin").write_bytes(b"a downloaded model")
check(vb.check(o) == [], "a model downloaded later into models/ never makes the self-check fail")
w = world("k")
mab.build(args(w, maker_extra="--song"))
check(not (w["out"] / mab.WORD_BUILDER_BAT).exists() and not (w["out"] / "tools" / "get_word_builder.py").exists() and "Get word builder" not in (w["out"] / "START-HERE.txt").read_text(encoding="ascii"), "without --word-builder none of it is written and START-HERE does not mention it")
w = world("l")
(w["repo"] / "tools" / "get_word_builder.py").unlink()
git(w["repo"], "add", "-A")
git(w["repo"], "commit", "-q", "-m", "no script")
good, why = refused(w, "the add-on", word_builder=True)
check(good and not w["out"].exists(), "MUST-FAIL: --word-builder with no script in the app repo is refused, leaving nothing: " + why)

# ================================================================================================== H
print("H. the face finder (Ryan 2026-10-28 08:55: ONLY YuNet ships, pinned by hash in the builder and the self-check; nothing about who a face is)")
REAL = Path(os.environ.get("YUNET_MODEL") or r"D:/Ryagram-scratch/FACES/models/yunet.onnx")
LIC = HERE / "model-licences"
check(REAL.is_file() and REAL.stat().st_size == mab.YUNET_BYTES and hashlib.sha256(REAL.read_bytes()).hexdigest() == mab.YUNET_SHA256 == vb.YUNET_SHA256, f"the real YuNet file ({REAL}) is the pinned one, and the builder and the self-check carry the SAME pin")
w = world("h")
r = mab.build(args(w, face_model=str(REAL), model_licences=str(LIC), public=False))
o = w["out"]
mf = json.loads((o / "BUNDLE-MANIFEST.json").read_text(encoding="utf-8"))
check((o / "models" / "yunet.onnx").read_bytes() == REAL.read_bytes() and mf["face_model"]["sha256"] == mab.YUNET_SHA256 and not any(p.name in ("sface.onnx", "blaze.tflite", "landmarker.task") for p in o.rglob("*")), "ONLY yunet.onnx is in the bundle; the manifest names it and its pin; no recognition or landmark model")
nt = (o / "docs" / "THIRD-PARTY-NOTICES.txt").read_text(encoding="utf-8")
check("Model file: YuNet" in nt and "Copyright (c) 2020 Shiqi Yu" in nt and "Permission is hereby granted" in nt and mab.YUNET_SHA256 in nt and "does not say who anyone is" in nt, "the notices carry YuNet's MIT licence text verbatim, its copyright line, its source and its pinned hash")
check("yunet.onnx" in (o / "START-HERE.txt").read_text(encoding="ascii") and "never says who" in (o / "START-HERE.txt").read_text(encoding="ascii"), "START-HERE says what the file is for in plain words")
check(vb.check(o) == [], "as built: the self-check is quiet")
rc = subprocess.run([sys.executable, str(o / "tools" / "verify_bundle.py"), str(o)], capture_output=True, text=True)
check(rc.returncode == 0, "run as a program from the folder, the real self-check passes too")
(o / "models" / "yunet.onnx").unlink()
got = vb.check(o)
check(any("yunet.onnx" in g and "missing" in g for g in got), f"MUST-FAIL: a MISSING face finder fails the self-check ({got[:2]})")
rc = subprocess.run([sys.executable, str(o / "tools" / "verify_bundle.py"), str(o)], capture_output=True, text=True)
check(rc.returncode == 1, "and as a program it exits 1")
swap = bytearray(REAL.read_bytes())
swap[100] ^= 1
(o / "models" / "yunet.onnx").write_bytes(bytes(swap))
got = vb.check(o)
check(any("face finder" in g and "not the file this program was built with" in g for g in got), f"MUST-FAIL: a SWAPPED face finder (one bit) fails the self-check even though its size is right ({got[:2]})")
mf2 = dict(mf)
(o / "models" / "yunet.onnx").write_bytes(REAL.read_bytes())
check(vb.check(o) == [], "(restored: as built again)")
# a self-check that trusts the manifest alone would be fooled by a rewritten manifest: the pin is in the program
mfp = json.loads((o / "BUNDLE-MANIFEST.json").read_text(encoding="utf-8"))
mfp["large_files"]["models/yunet.onnx"] = {"bytes": len(swap), "sha256": hashlib.sha256(bytes(swap)).hexdigest()}
(o / "models" / "yunet.onnx").write_bytes(bytes(swap))
(o / "BUNDLE-MANIFEST.json").write_text(json.dumps(mfp, indent=1, sort_keys=True), encoding="utf-8")
sumsp = vb.read_sums(o / "SHA256SUMS.txt")
sumsp["BUNDLE-MANIFEST.json"] = vb.sha256_file(o / "BUNDLE-MANIFEST.json")
(o / "SHA256SUMS.txt").write_text("".join(f"{hh}  {rel}\n" for rel, hh in sorted(sumsp.items())), encoding="utf-8", newline="\n")
got = vb.check(o)
check(any("face finder" in g for g in got), f"MUST-FAIL: even with the manifest and the checksum list rewritten to match a swapped file, the PIN inside the self-check catches it ({got[:2]})")
w = world("h2")
mab.build(args(w))
(w["out"] / "models").mkdir(exist_ok=True)
(w["out"] / "models" / "yunet.onnx").write_bytes(REAL.read_bytes())
check(any("added" in g for g in vb.check(w["out"])), "MUST-FAIL: a face finder in a bundle that was built without one is reported as added")
# the builder refuses anything else
for label, name, content in (("a different file with the YuNet name", "yunet.onnx", b"not yunet"), ("the recognition model (sface)", "sface.onnx", REAL.read_bytes()), ("blaze", "blaze.tflite", b"x"),
                             ("the landmarker", "landmarker.task", b"x"), ("a recognition model with the right bytes", "arcface_yunet.onnx", REAL.read_bytes())):
    w = world("h3")
    bad = w["root"] / name
    bad.write_bytes(content)
    good, why = refused(w, "yunet" if name == "yunet.onnx" else "recognition", face_model=str(bad), model_licences=str(LIC))
    check(good and not w["out"].exists(), f"MUST-FAIL: {label} is refused and nothing is built: {why[:120]}")
w = world("h4")
good, why = refused(w, "not a file", face_model=str(w["root"] / "nowhere.onnx"), model_licences=str(LIC))
check(good and not w["out"].exists(), "MUST-FAIL: a missing face-model path is refused: " + why[:100])
w = world("h5")
good, why = refused(w, "yunet", face_model=str(REAL), model_licences=str(w["root"] / "no-licences"), public=True, notices_contact="x@example.test")
check(good and not w["out"].exists(), "MUST-FAIL: a PUBLIC build whose YuNet licence record is missing is refused: " + why[:140])

print("I. a tester build can sign in: the start file passes --site and --approval-host (NEXT-CONNECT 163, WORKER 45 blocker 1); OFF unless asked for")
SITE = "https://jxtkfishqfxuptwjzczz.supabase.co/functions/v1/node"
w = world("m")
mab.build(args(w, maker_extra="--song"))
plain = (w["out"] / "Open Ryagram.bat").read_text(encoding="ascii")
check("--site" not in plain and "approval-host" not in plain and "RYAGRAM_SITE" not in plain, "without the option the start file has no site and no approval host (the app shows no Sign in card, as before)")
w = world("n")
mab.build(args(w, maker_extra="--song", signin_site=SITE, signin_approval_host=["uselai.com"]))
sbat = (w["out"] / "Open Ryagram.bat").read_text(encoding="ascii")
sline = next(l for l in sbat.splitlines() if "desktop_maker.py" in l)
check(sline.endswith(' --out-dir "%~dp0films" --site "' + SITE + '" --approval-host uselai.com %OPEN% %MAKER_EXTRA%'), "the app line carries --site (quoted) and --approval-host, after the folders and before %OPEN% %MAKER_EXTRA% (which still end it)")
check(sbat.replace(' --site "' + SITE + '" --approval-host uselai.com', "") == plain, "the two start files differ ONLY by that one added text")
check("RYAGRAM_SITE" not in sbat and "MAKER_EXTRA=" in sbat, "no environment variable is set for the site; the song switch is still set only as a default")
sums = (w["out"] / "SHA256SUMS.txt").read_text(encoding="utf-8")
check("Open Ryagram.bat" in sums and vb.check(w["out"]) == [], "the self-check lists the start file and says 'as built' for the sign-in build")
(w["out"] / "Open Ryagram.bat").write_bytes(sbat.replace(SITE, SITE.replace("jxtkfishqfxuptwjzczz", "aaaaaaaaaaaaaaaaaaaa")).encode("ascii"))
check(vb.check(w["out"]) == ["Open Ryagram.bat has been changed."], "MUST-FAIL: a start file whose site address was changed is named by the self-check")
(w["out"] / "Open Ryagram.bat").write_bytes(sbat.encode("ascii"))

# the REAL maker reads these arguments the way the start file writes them, and the REAL sign-in accepts the address
import shlex                                                      # noqa: E402
import desktop_maker as dm                                        # noqa: E402
import ryagram_signin as rsi                                      # noqa: E402


class _Parsed(Exception):
    pass


_orig = dm.argparse.ArgumentParser.parse_args


def _grab(self, args_=None, ns=None):
    r = _orig(self, args_, ns)
    raise _Parsed(r)


words = shlex.split(sline.split('desktop_maker.py"', 1)[1].replace("%~dp0", "X:/app/").replace("%OPEN%", "--open").replace("%MAKER_EXTRA%", "--song"), posix=True)
dm.argparse.ArgumentParser.parse_args = _grab
try:
    dm.main(words)
    got = None
except _Parsed as e:
    got = e.args[0]
finally:
    dm.argparse.ArgumentParser.parse_args = _orig
check(got is not None and got.site == SITE and got.approval_host == ["uselai.com"] and got.song and got.open, f"the real desktop_maker reads --site and --approval-host from that line ({getattr(got, 'site', None)}, {getattr(got, 'approval_host', None)})")
check(rsi.check_site(SITE) == ("https://jxtkfishqfxuptwjzczz.supabase.co/functions/v1/node", "jxtkfishqfxuptwjzczz.supabase.co"), "the real sign-in module accepts that address")

w = world("o")
mab.build(args(w, maker_extra="--song", forge_bat=True, signin_site=SITE, signin_approval_host=["uselai.com", "www.uselai.com"]))
both = (w["out"] / "Open Ryagram.bat").read_text(encoding="ascii")
frg = (w["out"] / mab.FORGE_BAT).read_text(encoding="ascii")
check(' --site "' + SITE + '" --approval-host uselai.com --approval-host www.uselai.com %OPEN%' in both and frg.replace("MAKER_EXTRA=--song --song-forge", "MAKER_EXTRA=--song") == both, "two approval hosts are both passed, and the fill-missing-words start file carries the same sign-in")

w = world("na")
mab.build(args(w, maker_extra="--song", signin_site=SITE, signin_approval_host=["uselai.com"], node_auto=True))
nabat = (w["out"] / "Open Ryagram.bat").read_text(encoding="ascii")
naline = next(l for l in nabat.splitlines() if "desktop_maker.py" in l)
check(naline.endswith(' --site "' + SITE + '" --approval-host uselai.com --node-auto %OPEN% %MAKER_EXTRA%') and (w["out"] / "tools" / "node_settings.py").is_file(), "NEXT-CONNECT 171: with --node-auto the app line also passes --node-auto, and the settings module travels")
check(sbat.replace(" --node-auto", "") == sbat and nabat.replace(" --node-auto", "") == sbat, "without --node-auto the start file is the sign-in one, unchanged; with it, it differs only by that switch")
w = world("nb")
good, why = refused(w, "needs --signin-site", node_auto=True)
check(good and not w["out"].exists(), "MUST-FAIL: --node-auto without a sign-in site is refused and nothing is built: " + why[:90])
for label, over in (("a plain http site", dict(signin_site="http://jxtkfishqfxuptwjzczz.supabase.co/functions/v1/node", signin_approval_host=["uselai.com"])),
                    ("another host's site (a look-alike)", dict(signin_site="https://jxtkfishqfxuptwjzczz.supabase.co.evil.example/functions/v1/node", signin_approval_host=["uselai.com"])),
                    ("a site that is not a Ryagram node address", dict(signin_site="https://evil.example/functions/v1/node", signin_approval_host=["uselai.com"])),
                    ("a site with a query", dict(signin_site=SITE + "?a=b", signin_approval_host=["uselai.com"])),
                    ("a site with another path", dict(signin_site=SITE.replace("/node", "/other"), signin_approval_host=["uselai.com"])),
                    ("a site with a quote and a command", dict(signin_site=SITE + '" & calc & "', signin_approval_host=["uselai.com"])),
                    ("a site with a trailing slash", dict(signin_site=SITE + "/", signin_approval_host=["uselai.com"])),
                    ("a site in capital letters", dict(signin_site=SITE.upper(), signin_approval_host=["uselai.com"])),
                    ("a site with a percent sign", dict(signin_site=SITE.replace("jxtk", "%x%k"), signin_approval_host=["uselai.com"]))):
    w = world("p")
    good, why = refused(w, "--signin-site must be", **over)
    check(good and not w["out"].exists(), f"MUST-FAIL: {label} is refused and nothing is built: {why[:90]}")
for label, over, frag in (("a site with no approval host", dict(signin_site=SITE), "needs at least one"),
                          ("an approval host with no site", dict(signin_approval_host=["uselai.com"]), "needs --signin-site"),
                          ("an approval host with a command", dict(signin_site=SITE, signin_approval_host=["uselai.com&calc"]), "plain lower-case host"),
                          ("an approval host with a space", dict(signin_site=SITE, signin_approval_host=["uselai.com --x"]), "plain lower-case host"),
                          ("an approval host with a path", dict(signin_site=SITE, signin_approval_host=["uselai.com/x"]), "plain lower-case host"),
                          ("an approval host in capitals", dict(signin_site=SITE, signin_approval_host=["UseLai.com"]), "plain lower-case host"),
                          ("an approval host with a percent sign", dict(signin_site=SITE, signin_approval_host=["%PATH%.com"]), "plain lower-case host"),
                          ("a bare word as approval host", dict(signin_site=SITE, signin_approval_host=["localhost"]), "plain lower-case host")):
    w = world("q")
    good, why = refused(w, frag, **over)
    check(good and not w["out"].exists(), f"MUST-FAIL: {label} is refused and nothing is built: {why[:90]}")
w = world("r")
rc = mab.main(["--out", str(w["out"]), "--kit", str(w["kit"]), "--ffmpeg-dir", str(w["ff"]), "--python-home", str(w["py"]), "--app-repo", str(w["repo"]), "--libraries", LIB, "--allow-any-drive", "--signin-site", "http://x"])
check(rc == 2 and not w["out"].exists(), "from the command line, a bad --signin-site ends with the REFUSED code and builds nothing")
w = world("s")
rc = mab.main(["--out", str(w["out"]), "--kit", str(w["kit"]), "--ffmpeg-dir", str(w["ff"]), "--python-home", str(w["py"]), "--app-repo", str(w["repo"]), "--libraries", LIB, "--allow-any-drive", "--signin-site", SITE, "--signin-approval-host", "uselai.com"])
check(rc == 0 and ' --site "' + SITE + '" --approval-host uselai.com ' in (w["out"] / "Open Ryagram.bat").read_text(encoding="ascii"), "from the command line, --signin-site and --signin-approval-host reach the start file")

print("J. the engine's node-job closure merged into the bundle (NEXT-CONNECT 164, ENGINE 44): only the settings reader and its fellows, checked against the closure's own manifest")
WORKER_FILES = ("__init__.py", "config.py", "contract.py", "engine.py", "runner.py", "schema.py", "restricted.py")


def nodekit(w, name, extra=None, drop=(), tamper=None, same_engine=True, manifest_extra=(), skip_manifest=False, skip_listing=()):
    nk = w["root"] / name
    files = {f"ryagram/worker/{f}": f"# node-job stand-in {f}\n" for f in WORKER_FILES if f not in drop}
    files["ryagram/local/engine.py"] = (w["kit"] / "ryagram" / "local" / "engine.py").read_bytes().decode("utf-8") if same_engine else "print('another engine head')" + chr(10)
    files["ryagram/sequence/RENDER.py"] = "# render driver stand-in" + chr(10)                    # the node job starts the render driver: the closure carries the modules the kit lacks
    files.update(extra or {})
    lines = []
    for rel, text in files.items():
        dest = nk / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(text, encoding="utf-8", newline="")
        if rel not in skip_listing:
            lines.append(f"{hashlib.sha256(text.encode('utf-8')).hexdigest()}  {rel}")
    if tamper:
        (nk / tamper).write_text("# changed after the manifest\n", encoding="utf-8", newline="")
    lines += list(manifest_extra)
    if not skip_manifest:
        (nk / "MANIFEST.sha256").write_text("\n".join(lines) + "\n", encoding="utf-8")
    return nk


w = world("t")
nk = nodekit(w, "nk-good")
before = tree_hash(w["kit"])
mab.build(args(w, maker_extra="--song", node_job_kit=str(nk)))
o = w["out"]
check((o / "ryagram" / "sequence" / "RENDER.py").is_file(), "a render-driver module the kit does not have (ryagram/sequence) is carried too")
check(all((o / "ryagram" / "worker" / f).is_file() for f in WORKER_FILES) and (o / "ryagram" / "local" / "engine.py").read_text(encoding="utf-8") == "print('engine')" + chr(10), "the closure's seven worker files are in the bundle's ryagram/worker, and the kit's own engine file is untouched")
sums = (o / "SHA256SUMS.txt").read_text(encoding="utf-8")
check("ryagram/worker/config.py" in sums and vb.check(o) == [], "they are in the self-check's list, and it says 'as built'")
check(tree_hash(w["kit"]) == before, "the kit folder is unchanged")
(o / "ryagram" / "worker" / "config.py").write_text("# swapped", encoding="utf-8")
check(vb.check(o) == ["ryagram/worker/config.py has been changed."], "MUST-FAIL: a changed worker/config.py is named by the self-check")
w = world("t2")
mab.build(args(w, maker_extra="--song"))
check(not (w["out"] / "ryagram" / "worker").exists(), "without --node-job-kit the bundle has no ryagram/worker at all (as before)")

w = world("t3")
kw = w["kit"] / "ryagram" / "worker"
kw.mkdir(parents=True)
(kw / "safesheet.py").write_text("# the kit already ships this one" + chr(10), encoding="utf-8", newline="")
nk3 = nodekit(w, "nk-twin", extra={"ryagram/worker/safesheet.py": "# the kit already ships this one" + chr(10)})
mab.build(args(w, maker_extra="--song", node_job_kit=str(nk3)))
check((w["out"] / "ryagram" / "worker" / "safesheet.py").read_text(encoding="utf-8") == "# the kit already ships this one" + chr(10) and (w["out"] / "ryagram" / "worker" / "config.py").is_file(), "a closure file the kit already ships (identical) is accepted whatever its name, and is not copied twice")
for label, build_kit, frag in (
        ("a folder with no MANIFEST.sha256", dict(skip_manifest=True), "no MANIFEST.sha256"),
        ("a file that is not the one the manifest names", dict(tamper="ryagram/worker/runner.py"), "not the file its manifest"),
        ("an extra file the manifest does not list", dict(extra={"ryagram/worker/notes.py": "x = 1" + chr(10)}, skip_listing=("ryagram/worker/notes.py",)), "not the files in its manifest"),
        ("a listed file that is missing", dict(manifest_extra=("a" * 64 + "  ryagram/worker/ghost.py",)), "not the files in its manifest"),
        ("a malformed manifest line", dict(manifest_extra=("not a hash line",)), "not 'sha256  path'"),
        ("the house worker's queue", dict(extra={"ryagram/worker/queue.py": "x = 1" + chr(10)}), "house-worker module"),
        ("the house worker's uploads and safesheet", dict(extra={"ryagram/worker/uploads.py": "x = 1" + chr(10), "ryagram/worker/safesheet.py": "x = 1" + chr(10)}), "house-worker module"),
        ("the house worker itself", dict(extra={"ryagram/worker/worker.py": "x = 1" + chr(10)}), "house-worker module"),
        ("a worker sub-folder", dict(extra={"ryagram/worker/sub/config.py": "x = 1" + chr(10)}), "house-worker module"),
        ("a file outside the ryagram folder", dict(extra={"tools/evil.py": "x = 1" + chr(10)}), "outside the ryagram folder"),
        ("a manifest line whose path climbs out (the folder cannot hold such a file, so the lists differ)", dict(extra={"ryagram/../evil.py": "x = 1" + chr(10)}), "not the files in its manifest"),
        ("a new file outside ryagram/worker and ryagram/sequence", dict(extra={"ryagram/extra.py": "x = 1" + chr(10)}), "may be added"),
        ("a new module in another package", dict(extra={"ryagram/maprace/newthing.py": "x = 1" + chr(10)}), "may be added"),
        ("a sub-folder inside ryagram/sequence", dict(extra={"ryagram/sequence/sub/x.py": "x = 1" + chr(10)}), "may be added"),
        ("a file the kit has with other content", dict(same_engine=False), "different engine heads"),
        ("no config.py", dict(drop=("config.py",)), "no ryagram/worker/config.py")):
    w = world("u")
    try:
        nk2 = nodekit(w, "nk-bad", **build_kit)
    except OSError:
        continue
    good, why = refused(w, frag, node_job_kit=str(nk2))
    check(good and not w["out"].exists(), f"MUST-FAIL: {label} is refused and nothing is built: {why[:110]}")
w = world("v")
good, why = refused(w, "no MANIFEST.sha256", node_job_kit=str(w["root"] / "nowhere"))
check(good and not w["out"].exists(), "MUST-FAIL: a --node-job-kit folder that does not exist is refused: " + why[:100])
w = world("x")
nk3 = nodekit(w, "nk-cli")
rc = mab.main(["--out", str(w["out"]), "--kit", str(w["kit"]), "--ffmpeg-dir", str(w["ff"]), "--python-home", str(w["py"]), "--app-repo", str(w["repo"]), "--libraries", LIB, "--allow-any-drive", "--node-job-kit", str(nk3)])
check(rc == 0 and (w["out"] / "ryagram" / "worker" / "config.py").is_file(), "from the command line, --node-job-kit reaches the builder")

print()
if FAILS:
    print(f"FAILED: {len(FAILS)}")
    for f in FAILS:
        print("  -", f)
    sys.exit(1)
print("all passed")
