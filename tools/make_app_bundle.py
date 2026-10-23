"""Builds the r9 portable app folder (install option A, NEXT-CONNECT 105): one folder with its own Python (tkinter included), the libraries, ffmpeg, the engine, the app, a start file, a
manifest and a start-time self-check. Standard library only. NOTHING IS DOWNLOADED: every input is a folder that already exists on this PC. If one is missing, the script says which and what it
would need, and stops (that is a Ryan row, not something this script fetches). It ships nothing: --zip only writes a zip next to the folder, and Ryan decides who gets it.

    python tools/make_app_bundle.py --out D:/Ryagram-bundles/app-N --kit <a built kit folder: ryagram/ recipes/ docs/ KIT-MANIFEST.json> --ffmpeg-dir <folder with ffmpeg.exe and ffprobe.exe>
                                    [--python-home <a normal Python 3.12 install; default: the python running this script>] [--model-dir <a folder holding the listening model>] [--zip]

It REFUSES to run when: the app repo is not a clean git checkout (so a bundle names an exact head); --out is not on D: (the storage rule; --allow-any-drive overrides in tests only) or already has files;
there is not enough free space; any input is missing; or the leak scan finds a token, a key, a personal address, Ryan's private folder name or a file that must never travel (an account cache, an
activity log, a switch file, a database dump, a .git folder).
"""
from __future__ import annotations

import argparse
import fnmatch
import hashlib
import importlib.metadata as md
import json
import os
import re
import shutil
import subprocess
import sys
import time
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from verify_bundle import sha256_file, APP_DIRS, SKIP_NAMES, SKIP_SUFFIX           # noqa: E402

LARGE_BYTES = 1_000_000
RUNTIME_TOOLS = ("desktop_maker.py", "maker_edit.py", "maker_song.py", "ryagram_signin.py", "ryagram_node.py", "verify_bundle.py", "model_download.py")
RUNTIME_PAGE_DIRS = ("maker-edit", "maker-song")          # the edit and song pages (html, js, css); a test fixture beside them is left out
FORBIDDEN_NAMES ={"ryagram-account.json", "ryagram-node.json", "maker-activity-log.jsonl", "maker-activity-log.off", "library.db", "words-cache"}
FORBIDDEN_DIRS = {".git", "node_modules", "RYAN-ONLY", "faces", "my-answers"}
FORBIDDEN_SUFFIX = {".dump", ".log", ".env", ".pem", ".key", ".pfx", ".sqlite", ".db"}
SECRET_PATTERNS = [
    (re.compile(rb"rgn_[A-Za-z0-9_-]{43}"), "a node token"),
    (re.compile(rb"eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]*"), "a signed token (JWT)"),
    (re.compile(rb"-----BEGIN [A-Z ]*PRIVATE KEY-----"), "a private key"),
    (re.compile(rb"RYAN-ONLY"), "the name of Ryan's private folder"),
    (re.compile(rb"galenryan"), "Ryan's personal address"),
]
# python install pieces the app never needs (the docs, the tests, the build tools); tcl and tkinter STAY (the file picker is a tkinter dialog)
PY_DROP_DIRS = {"Doc", "Tools", "include", "libs", "Scripts", "test", "tests", "idlelib", "turtledemo", "lib2to3", "ensurepip", "__pycache__", "site-packages"}
LIB_DROP_DIRS = {"test", "idlelib", "turtledemo", "lib2to3", "ensurepip", "__pycache__", "site-packages"}


class Refused(Exception):
    pass


def git(repo: Path, *args) -> str:
    r = subprocess.run(["git", "-C", str(repo), *args], capture_output=True, text=True)
    return r.stdout.strip()


def require_clean(repo: Path) -> dict:
    head = git(repo, "rev-parse", "HEAD")
    if not head:
        raise Refused(f"{repo} is not a git checkout, so the bundle could not name an exact head.")
    if git(repo, "status", "--porcelain", "--untracked-files=no"):
        raise Refused(f"{repo} has uncommitted changes. Commit or stash them, so the bundle names an exact head.")
    return {"head": head, "branch": git(repo, "rev-parse", "--abbrev-ref", "HEAD")}


def requirement_closure(roots) -> dict:
    """{distribution name: version} for the roots and everything they need, read from the INSTALLED metadata (nothing is looked up online; extras are not followed)."""
    seen = {}

    def walk(name):
        key = re.sub(r"[-_.]+", "-", name).lower()
        if key in seen:
            return
        try:
            d = md.distribution(name)
        except md.PackageNotFoundError:
            raise Refused(f"The library '{name}' is not installed on this PC, so it cannot be copied. (Ryan row: it would have to be installed first.)")
        seen[key] = d.version
        for r in d.requires or []:
            try:
                from packaging.requirements import Requirement          # installed beside pip/huggingface_hub; needed to read "only on Python < 3.11" style conditions
            except ImportError:
                raise Refused("The 'packaging' library is not installed on this PC, and it is needed to read which libraries apply to this Python. (Ryan row: it would have to be installed first.)") from None
            req = Requirement(r)
            if req.marker is not None and not req.marker.evaluate({"extra": ""}):
                continue                                                # a library only for another Python, another system, or an optional extra
            walk(req.name)
    for r in roots:
        walk(r)
    return seen


def copy_distribution(name: str, dst_site: Path) -> int:
    """Copies every file of one installed distribution that lives under its site-packages (its RECORD says which), nothing else. Returns the number of files."""
    d = md.distribution(name)
    base = Path(str(d.locate_file("")))
    n = 0
    for f in d.files or []:
        parts = Path(str(f)).parts
        if ".." in parts or "__pycache__" in parts or str(f).endswith(".pyc"):
            continue
        src = base / f
        if not src.is_file():
            continue
        tgt = dst_site / f
        tgt.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, tgt)
        n += 1
    return n


def copy_python(home: Path, dst: Path) -> None:
    for need in ("python.exe", "DLLs", "Lib", "tcl"):
        if not (home / need).exists():
            raise Refused(f"{home} is not a full Python install (no {need}); tkinter would be missing and the file picker would not open.")
    if not (home / "Lib" / "tkinter").is_dir():
        raise Refused("That Python has no tkinter (the python.org embeddable zip does not), so the file picker would not open.")

    def ignore(d, names):
        dp = Path(d)
        drop = set(PY_DROP_DIRS if dp == home else LIB_DROP_DIRS if dp == home / "Lib" else {"__pycache__"})
        return [n for n in names if n in drop or n.endswith(".pyc")]
    shutil.copytree(home, dst, ignore=ignore)
    (dst / "Lib" / "site-packages").mkdir(parents=True, exist_ok=True)


def list_files(root: Path):
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = sorted(n for n in dirnames if n not in SKIP_NAMES)
        for fn in sorted(filenames):
            if Path(fn).suffix in SKIP_SUFFIX:
                continue
            yield Path(dirpath) / fn


def leak_scan(root: Path) -> list:
    """Names everywhere; contents of the app's own text files (small, ours). The libraries and ffmpeg are scanned by name only."""
    found = []
    for p in list_files(root):
        rel = p.relative_to(root).as_posix()
        parts = set(Path(rel).parts)
        if parts & FORBIDDEN_DIRS:
            found.append(f"{rel}: a folder that must never travel ({sorted(parts & FORBIDDEN_DIRS)[0]})")
            continue
        ours = Path(rel).parts[0] in APP_DIRS or rel in ("START-HERE.txt", "Open Ryagram.bat")
        # the file-type rule is for OUR folders; a library may legitimately ship a .pem (certifi's public CA list) or a .db, so libraries are held to the NAME rule only
        if p.name in FORBIDDEN_NAMES or (ours and p.suffix.lower() in FORBIDDEN_SUFFIX):
            found.append(f"{rel}: a file that must never travel")
            continue
        if ours:
            data = p.read_bytes()
            for pat, what in SECRET_PATTERNS:
                if pat.search(data):
                    found.append(f"{rel}: contains {what}")
    return found


def write_start_files(out: Path, has_model: bool) -> None:
    # The file is called "Open Ryagram.bat" and not "Start ...": from a command line, cmd /c "Start X.bat" runs cmd's own START command instead of the file.
    bat = "\r\n".join([
        "@echo off",
        "rem Starts the Ryagram desktop app from THIS folder, with this folder's own Python. Nothing is installed; nothing outside this folder is changed except the sign-in kept in Windows.",
        "setlocal",
        "title Ryagram",
        'cd /d "%~dp0"',
        'set "PATH=%~dp0python;%~dp0ffmpeg;%PATH%"',
        'set "FFMPEG_PATH=%~dp0ffmpeg\\ffmpeg.exe"',
        'set "FFPROBE_PATH=%~dp0ffmpeg\\ffprobe.exe"',
        'set "RYAGRAM_MODEL_DIR=%~dp0models"',
        'set "PYTHONNOUSERSITE=1"',
        'set "PYTHONDONTWRITEBYTECODE=1"',
        '"%~dp0python\\python.exe" -I "%~dp0tools\\verify_bundle.py" "%~dp0."',
        "if errorlevel 1 (",
        "  echo.",
        "  echo Do not go on. Close this window and tell Ryan what is written above.",
        "  pause",
        "  exit /b 1",
        ")",
        'set "OPEN=--open"',
        'if defined MAKER_NO_OPEN set "OPEN="',
        '"%~dp0python\\python.exe" -I "%~dp0tools\\desktop_maker.py" --work-dir "%~dp0work" --out-dir "%~dp0films" %OPEN% %MAKER_EXTRA%',
        "if errorlevel 1 pause",
        "",
    ])
    (out / "Open Ryagram.bat").write_bytes(bat.encode("ascii"))
    txt = ("RYAGRAM\r\n\r\n1. Double-click  Open Ryagram.bat  in this folder. It checks that every file is as it was built, then opens the app in your browser.\r\n"
           "2. If Windows says it protected your PC: press More info, and press Run anyway ONLY if the file name matches the one Ryan read to you. If anyone else ever asks you to press Run anyway, say no.\r\n"
           "3. Films are saved in the  films  folder here. Nothing outside this folder is changed, except the sign-in Windows keeps for you.\r\n"
           + ("" if has_model else "4. The first time, press  Download the listening model  on the page (Balanced, about 464 MB, once). It is the only step that uses the internet, and every file is checked before it is kept.\r\n"))
    (out / "START-HERE.txt").write_bytes(txt.encode("ascii"))


def build(a) -> dict:
    out, kit, ffd = Path(a.out), Path(a.kit), Path(a.ffmpeg_dir)
    app_repo = Path(a.app_repo)
    pyhome = Path(a.python_home)
    model = Path(a.model_dir) if a.model_dir else None
    if not a.allow_any_drive and not re.match(r"^[dD]:", str(out.resolve())):
        raise Refused(f"--out must be on D: (the storage rule), not {out}.")
    if out.exists() and any(out.iterdir()):
        raise Refused(f"{out} already has files. A bundle is built into a new, empty folder (a rebuild never overwrites an earlier one).")
    heads = {"app": require_clean(app_repo)}
    for need in ("ryagram", "recipes"):
        if not (kit / need).is_dir():
            raise Refused(f"The kit folder {kit} has no {need} folder (it should be a built kit: ryagram, recipes, docs, KIT-MANIFEST.json).")
    if not (kit / "KIT-MANIFEST.json").is_file():
        raise Refused(f"The kit folder {kit} has no KIT-MANIFEST.json, so the engine heads inside it are not recorded.")
    for exe in ("ffmpeg.exe", "ffprobe.exe"):
        if not (ffd / exe).is_file():
            raise Refused(f"{ffd} has no {exe}. (Ryan row: ffmpeg would have to be downloaded; this script downloads nothing.)")
    if model and not model.is_dir():
        raise Refused(f"--model-dir {model} does not exist.")
    for t in RUNTIME_TOOLS:
        if not (app_repo / "tools" / t).is_file():
            raise Refused(f"The app repo has no tools/{t}.")
    for d in RUNTIME_PAGE_DIRS:
        if not (app_repo / "tools" / d).is_dir():
            raise Refused(f"The app repo has no tools/{d} folder (the page the app serves).")
    closure = requirement_closure(a.libraries)
    need = sum(f.stat().st_size for f in list_files(pyhome)) + sum((ffd / e).stat().st_size for e in ("ffmpeg.exe", "ffprobe.exe")) + 400_000_000
    probe = out
    while not probe.exists():                      # measure the drive the folder will live on BEFORE making anything
        probe = probe.parent
    free = shutil.disk_usage(probe).free
    if free < 2 * need:
        raise Refused(f"Not enough free space: about {2 * need // 1_000_000} MB needed, {free // 1_000_000} MB free.")
    out.mkdir(parents=True, exist_ok=True)
    t0 = time.time()
    try:
        copy_python(pyhome, out / "python")
        n_files = 0
        for name in sorted(closure):
            n_files += copy_distribution(name, out / "python" / "Lib" / "site-packages")
        (out / "ffmpeg").mkdir()
        for e in ("ffmpeg.exe", "ffprobe.exe"):
            shutil.copy2(ffd / e, out / "ffmpeg" / e)
        shutil.copytree(kit / "ryagram", out / "ryagram", ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
        shutil.copytree(kit / "recipes", out / "recipes", ignore=shutil.ignore_patterns("__pycache__"))
        if (kit / "docs").is_dir():
            shutil.copytree(kit / "docs", out / "docs")
        shutil.copy2(kit / "KIT-MANIFEST.json", out / "ENGINE-MANIFEST.json")
        (out / "tools").mkdir()
        for t in RUNTIME_TOOLS:
            shutil.copy2(app_repo / "tools" / t, out / "tools" / t)
        for d in RUNTIME_PAGE_DIRS:
            shutil.copytree(app_repo / "tools" / d, out / "tools" / d, ignore=shutil.ignore_patterns("fixture.js"))
        (out / "models").mkdir()
        if model:
            shutil.copytree(model, out / "models" / model.name)
        (out / "work").mkdir()
        (out / "films").mkdir()
        write_start_files(out, has_model=bool(model))
        leaks = leak_scan(out)
        if leaks:
            raise Refused("The leak scan stopped the build:\n  " + "\n  ".join(leaks[:20]))
        # the manifest: small files by hash (SHA256SUMS.txt), big files by size AND hash (the start check uses the size; --deep the hash)
        sums, large = {}, {}
        for p in list_files(out):
            rel = p.relative_to(out).as_posix()
            if rel in ("SHA256SUMS.txt", "BUNDLE-MANIFEST.json"):
                continue
            top = Path(rel).parts[0]
            if top in ("work", "films"):
                continue
            size = p.stat().st_size
            if size >= LARGE_BYTES or top in ("python", "ffmpeg", "models"):
                large[rel] = {"bytes": size, "sha256": sha256_file(p)}
            else:
                sums[rel] = sha256_file(p)
        manifest = {
            "schema": "ryagram.app-bundle/0", "built_at": time.strftime("%Y-%m-%d %H:%M"), "built_by": "tools/make_app_bundle.py",
            "app_head": heads["app"]["head"], "app_branch": heads["app"]["branch"], "engine_manifest": "ENGINE-MANIFEST.json (the kit's own record of the engine heads)",
            "python": sys.version.split()[0] if Path(a.python_home).resolve() == Path(sys.base_prefix).resolve() else "see python/",
            "libraries": closure, "ffmpeg_sha256": {e: large[f"ffmpeg/{e}"]["sha256"] for e in ("ffmpeg.exe", "ffprobe.exe")},
            "model": model.name if model else None, "large_files": large, "large_file_count": len(large), "app_file_count": len(sums),
            "downloads_made": 0, "note": "Nothing was downloaded to build this folder; every part was copied from this PC. verify_bundle.py checks it at every start.",
        }
        (out / "BUNDLE-MANIFEST.json").write_text(json.dumps(manifest, indent=1, sort_keys=True), encoding="utf-8")
        sums["BUNDLE-MANIFEST.json"] = sha256_file(out / "BUNDLE-MANIFEST.json")
        (out / "SHA256SUMS.txt").write_text("".join(f"{h}  {rel}\n" for rel, h in sorted(sums.items())), encoding="utf-8", newline="\n")
    except Exception:
        shutil.rmtree(out, ignore_errors=True)                      # a half-built folder is never left lying about
        raise
    result = {"out": str(out), "seconds": round(time.time() - t0, 1), "files_copied_from_libraries": n_files, "large_files": len(large), "bytes": sum(f.stat().st_size for f in list_files(out))}
    if a.zip:
        zp = out.with_name(out.name + ".zip")
        with zipfile.ZipFile(zp, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as z:
            for p in list_files(out):
                z.write(p, Path(out.name) / p.relative_to(out))
        result.update(zip=str(zp), zip_name=zp.name, zip_bytes=zp.stat().st_size, zip_sha256=sha256_file(zp))
    return result


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--out", required=True)
    ap.add_argument("--kit", required=True)
    ap.add_argument("--ffmpeg-dir", required=True)
    ap.add_argument("--python-home", default=sys.base_prefix)
    ap.add_argument("--model-dir")
    ap.add_argument("--app-repo", default=str(HERE.parent))
    ap.add_argument("--libraries", nargs="*", default=["faster-whisper"], help="the libraries to copy, with everything they need (default: faster-whisper)")
    ap.add_argument("--zip", action="store_true")
    ap.add_argument("--allow-any-drive", action="store_true", help="tests only")
    a = ap.parse_args(argv)
    try:
        r = build(a)
    except Refused as e:
        print("REFUSED: " + str(e))
        return 2
    print(json.dumps(r, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
