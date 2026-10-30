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
# THE FACE FINDER (Ryan 2026-10-28 08:55, relayed by CC1): ONLY the YuNet detection model ships, pinned by its SHA-256 here, in the self-check (verify_bundle.py) and in the maker. A different file, or any of
# the recognition / landmark models that sit beside it in FACES' folder, is refused by name and by hash: nothing about WHO a face is ever ships.
YUNET_FILE, YUNET_BYTES = "models/yunet.onnx", 232_589
YUNET_SHA256 = "8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4"
FORBIDDEN_MODEL_WORDS = ("sface", "blaze", "landmark", "arcface", "facenet", "recogni")
RUNTIME_TOOLS = ("desktop_maker.py", "maker_edit.py", "maker_live.py", "maker_live_sync.py", "maker_song.py", "ryagram_signin.py", "ryagram_node.py", "ryagram_links.py", "ryagram_requests.py", "maker_fetch.py", "verify_bundle.py", "model_download.py")
RUNTIME_TOOLS = RUNTIME_TOOLS + ("maker_checklist.py",)                    # NEXT-CONNECT 171: desktop_maker and ryagram_requests import it (Q331); without it the packaged app stops at start
RUNTIME_TOOLS = RUNTIME_TOOLS + ("ryagram_node_render.py", "ryagram_node_job.py", "gpu_lock.py")      # NEXT-RENDERER 44: the site-film renderer, its child step and the GPU lock tool a tester PC needs
RUNTIME_PAGE_DIRS = ("maker-edit", "maker-live", "maker-song")          # the edit and song pages (html, js, css); a test fixture beside them is left out
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
        ours = Path(rel).parts[0] in APP_DIRS or rel in ("START-HERE.txt", "Open Ryagram.bat", FORGE_BAT)
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


MAKER_EXTRA_ALLOWED = ("--song", "--song-forge", "--edit", "--live", "--data")      # the only page switches a build may bake into the start file


def check_maker_extra(extra: str) -> str:
    words = extra.split()
    bad = [w for w in words if w not in MAKER_EXTRA_ALLOWED]
    if bad:
        raise Refused(f"--maker-extra may only hold {', '.join(MAKER_EXTRA_ALLOWED)}; got {' '.join(bad)}.")
    return " ".join(words)


# NEXT-CONNECT 163 (tester sign-in): the released app showed no Sign in card because its start file passed no --site. A build may now bake in the site's node address and the host the site sends the person to
# for approving this computer. OFF unless asked for; both are checked whole against a fixed shape here, so nothing but a Ryagram node address and a plain host name can ride into the start file.
SIGNIN_SITE_SHAPE = re.compile(r"^https://[a-z0-9]{20}[.]supabase[.]co/functions/v1/node$")
SIGNIN_HOST_SHAPE = re.compile(r"^(?=.{4,100}$)[a-z0-9]([a-z0-9-]*[a-z0-9])?([.][a-z0-9]([a-z0-9-]*[a-z0-9])?)+$")


def check_signin(site: str, approval_hosts) -> str:
    """The text the start file adds to the app line, or "" when no sign-in is asked for."""
    site = (site or "").strip()
    hosts = [h.strip() for h in (approval_hosts or []) if h and h.strip()]
    if not site and not hosts:
        return ""
    if not site:
        raise Refused("--signin-approval-host needs --signin-site.")
    if not SIGNIN_SITE_SHAPE.fullmatch(site):
        raise Refused("--signin-site must be a Ryagram node address like https://<20 letters or digits>.supabase.co/functions/v1/node (nothing else, no spaces, no query).")
    if not hosts:
        raise Refused("--signin-site needs at least one --signin-approval-host (the site the person is sent to for approving this computer, for example uselai.com).")
    for h in hosts:
        if not SIGNIN_HOST_SHAPE.fullmatch(h):
            raise Refused(f"--signin-approval-host must be a plain lower-case host name like uselai.com; got {h!r}.")
    return f'--site "{site}" ' + " ".join(f"--approval-host {h}" for h in hosts)


# NEXT-CONNECT 164 (tester candidate): the engine's NODE-JOB closure (ENGINE 44: tools/export_render_kit.py --node-job) is the few house-worker modules the render job on a person's own PC imports (config, contract, engine,
# runner, schema, and restricted, which runner reads lazily). The normal kit carries none of ryagram/worker. --node-job-kit merges that closure into the bundle, and ONLY that: every file is checked against the
# closure's own MANIFEST.sha256, nothing outside ryagram/ may ride along, a file also in the kit must be identical, and a house-worker module that is not on the list (queue, uploads, safesheet, liveness,
# progress, worker) is refused by name.
NODE_JOB_WORKER_FILES = ("__init__.py", "config.py", "contract.py", "engine.py", "runner.py", "schema.py", "restricted.py")


def check_node_job_kit(node_kit: Path, kit: Path) -> list:
    """The files (relative paths under the kit folder) to add to the bundle's ryagram folder, or a Refused."""
    mf = node_kit / "MANIFEST.sha256"
    if not mf.is_file():
        raise Refused(f"--node-job-kit {node_kit} has no MANIFEST.sha256 (it should be made by tools/export_render_kit.py --node-job).")
    listed = {}
    for line in mf.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        m = re.fullmatch(r"([0-9a-f]{64})  (.+)", line)
        if not m:
            raise Refused(f"--node-job-kit: a line of MANIFEST.sha256 is not 'sha256  path': {line[:80]!r}")
        listed[m.group(2)] = m.group(1)
    on_disk = {p.relative_to(node_kit).as_posix() for p in node_kit.rglob("*") if p.is_file() and "__pycache__" not in p.parts and p.name != "MANIFEST.sha256"}
    if on_disk != set(listed):
        raise Refused("--node-job-kit: the files in the folder are not the files in its MANIFEST.sha256 (extra: " + ", ".join(sorted(on_disk - set(listed))[:5]) + "; missing: " + ", ".join(sorted(set(listed) - on_disk)[:5]) + ").")
    add = []
    for rel, want in sorted(listed.items()):
        parts = rel.split("/")
        if parts[0] != "ryagram" or ".." in parts or rel.startswith("/") or ":" in rel:
            raise Refused(f"--node-job-kit: {rel} is outside the ryagram folder.")
        if sha256_file(node_kit / rel) != want:
            raise Refused(f"--node-job-kit: {rel} is not the file its MANIFEST.sha256 names.")
        if parts[:2] == ["ryagram", "worker"]:
            if len(parts) != 3 or parts[2] not in NODE_JOB_WORKER_FILES:
                raise Refused(f"--node-job-kit: {rel} is a house-worker module the film job on a person's own PC must not carry (only {', '.join(NODE_JOB_WORKER_FILES)}).")
        twin = kit / rel
        if twin.is_file():
            if sha256_file(twin) != want:
                raise Refused(f"--node-job-kit: {rel} is also in the kit with other content (the two were cut from different engine heads).")
        elif parts[:2] != ["ryagram", "worker"]:
            raise Refused(f"--node-job-kit: {rel} is not in the kit and is not a node-job worker module; only ryagram/worker files may be added.")
        else:
            add.append(rel)
    if not any(r == "ryagram/worker/config.py" for r in listed):
        raise Refused("--node-job-kit has no ryagram/worker/config.py (the settings reader the film job needs).")
    return add


WORD_BUILDER_BAT = "Get word builder.bat"            # --word-builder (NEXT-CONNECT 136, one zip): the add-on's start file at the root; its script travels inside tools\
WORD_BUILDER_PY = "get_word_builder.py"


def write_word_builder(out: Path, app_repo: Path) -> None:
    """The word-builder add-on INSIDE the bundle: the .bat at the root, the script in tools\\ (so the start-time self-check watches both). The 378 MB model is NOT part of this: the .bat fetches it on a YES."""
    import make_forge_addon as mfa
    src = app_repo / "tools" / WORD_BUILDER_PY
    if not src.is_file():
        raise Refused(f"--word-builder needs tools/{WORD_BUILDER_PY} in the app repo (the add-on's script); it is not there.")
    shutil.copy2(src, out / "tools" / WORD_BUILDER_PY)
    (out / WORD_BUILDER_BAT).write_bytes(mfa.bat_text("tools\\" + WORD_BUILDER_PY).encode("ascii"))


FORGE_BAT = "Open Ryagram (fill missing words).bat"
FORGE_EXTRA = "--song --song-forge"           # the second start file; the first one never passes --song-forge


def write_start_files(out: Path, has_model: bool, maker_extra: str = "", forge_bat: bool = False, word_builder: bool = False, face_model: bool = False, signin: str = "") -> None:
    # The file is called "Open Ryagram.bat" and not "Start ...": from a command line, cmd /c "Start X.bat" runs cmd's own START command instead of the file.
    def bat_text(extra: str) -> str:
      return "\r\n".join([
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
        *(['if not defined MAKER_EXTRA set "MAKER_EXTRA=' + extra + '"'] if extra else []),
        'set "OPEN=--open"',
        'if defined MAKER_NO_OPEN set "OPEN="',
        '"%~dp0python\\python.exe" -I "%~dp0tools\\desktop_maker.py" --work-dir "%~dp0work" --out-dir "%~dp0films" ' + (signin + " " if signin else "") + '%OPEN% %MAKER_EXTRA%',
        "if errorlevel 1 pause",
        "",
      ])

    (out / "Open Ryagram.bat").write_bytes(bat_text(maker_extra).encode("ascii"))
    if forge_bat:
        (out / FORGE_BAT).write_bytes(bat_text(FORGE_EXTRA).encode("ascii"))
    txt = ("RYAGRAM\r\n\r\n1. Double-click  Open Ryagram.bat  in this folder. It checks that every file is as it was built, then opens the app in your browser.\r\n"
           "2. If Windows says it protected your PC: press More info, and press Run anyway ONLY if the file name matches the one Ryan read to you. If anyone else ever asks you to press Run anyway, say no.\r\n"
           "3. Films are saved in the  films  folder here. Nothing outside this folder is changed, except the sign-in Windows keeps for you.\r\n"
           "   The licences of the software written by others that this folder contains are in docs\\THIRD-PARTY-NOTICES.txt.\r\n"
           + ("" if has_model else "4. The first time, press  Download the listening model  on the page (Balanced, about 464 MB, once). It is the only step that uses the internet, and every file is checked before it is kept.\r\n")
           + ("" if not face_model else "   Blur faces I haven't named  (a switch on the main page, off until you switch it on) uses one small file, models\\yunet.onnx, that only finds where faces are. It never says who anyone is. The Start check makes sure it is the exact file this folder was built with.\r\n")
           + ("" if not word_builder else "   Optional, to let Ryagram build a word nobody said from your own sounds: open  Get word builder.bat  once. It says the size (about 378 MB), and downloads only after you type YES; every file is checked before it is kept. Then use  " + FORGE_BAT + "  (if this folder has it).\r\n"))
    (out / "START-HERE.txt").write_bytes(txt.encode("ascii"))


def ffmpeg_version_text(ffd: Path) -> str:
    """'ffmpeg -version' of the build being packed (a program already on this PC, run once; nothing is fetched). Empty when it cannot be run."""
    try:
        r = subprocess.run([str(ffd / "ffmpeg.exe"), "-version"], capture_output=True, text=True, timeout=30)
        return r.stdout if r.returncode == 0 else ""
    except (OSError, subprocess.SubprocessError):
        return ""


def check_face_model(path: Path) -> None:
    """Refuses anything but the pinned YuNet file (name, size and SHA-256)."""
    if not path.is_file():
        raise Refused(f"--face-model {path} is not a file.")
    low = path.name.lower()
    if any(w in low for w in FORBIDDEN_MODEL_WORDS):
        raise Refused(f"{path.name} is a face recognition or landmark model. Only the YuNet detection file ships; nothing that says who a face is.")
    if path.stat().st_size != YUNET_BYTES or sha256_file(path) != YUNET_SHA256:
        raise Refused(f"{path.name} is not the YuNet file this build is pinned to (expected {YUNET_BYTES} bytes, SHA-256 {YUNET_SHA256}).")


def write_notices(a, out: Path, ffd: Path) -> dict:
    """docs/THIRD-PARTY-NOTICES.txt inside the folder (NEXT-CONNECT 133; CC1 20:01). With --public the build is REFUSED when something a public download needs is missing."""
    import third_party_notices as tpn
    supp = getattr(a, "licence_supplements", "") or ""
    libs = tpn.libraries(out / "python" / "Lib" / "site-packages", Path(supp) if supp else None)
    py_lic = out / "python" / "LICENSE.txt"
    python_licence = py_lic.read_text(encoding="utf-8", errors="replace") if py_lic.is_file() else ""
    vt = ffmpeg_version_text(ffd)
    ff = tpn.ffmpeg_facts(vt) if vt else None
    lic_file = Path(getattr(a, "ffmpeg_license", "") or ffd.parent / "LICENSE")
    readme_file = Path(getattr(a, "ffmpeg_readme", "") or ffd.parent / "README.txt")
    ff_lic = lic_file.read_text(encoding="utf-8", errors="replace").replace("\r\n", "\n") if lic_file.is_file() else ""
    ff_readme = readme_file.read_text(encoding="utf-8", errors="replace").replace("\r\n", "\n") if readme_file.is_file() else ""
    contact = getattr(a, "notices_contact", "") or ""
    models = []
    if getattr(a, "face_model", ""):
        mdir = Path(getattr(a, "model_licences", "") or Path(a.app_repo) / "tools" / "model-licences")
        models = tpn.model_rows(mdir, ["yunet"])
        for mo in models:
            if mo.get("sha256") != YUNET_SHA256:
                mo["text"], mo["problem"] = "", "its record does not carry the pinned SHA-256"
    problems = tpn.public_problems(libs, ff, ff_lic, ff_readme, contact, models)
    if ff is None:
        problems.insert(0, "ffmpeg -version could not be read, so its licence cannot be stated.")
    if getattr(a, "public", False) and problems:
        raise Refused("A PUBLIC build needs more before it can be made:\n  " + "\n  ".join(problems))
    (out / "docs").mkdir(exist_ok=True)
    (out / "docs" / "THIRD-PARTY-NOTICES.txt").write_text(tpn.render(libs, python_licence, ff, ff_lic, ff_readme, contact, models), encoding="utf-8", newline="\n")
    return {"libraries": len(libs), "public": bool(getattr(a, "public", False)), "problems": problems}


def build(a) -> dict:
    out, kit, ffd = Path(a.out), Path(a.kit), Path(a.ffmpeg_dir)
    app_repo = Path(a.app_repo)
    pyhome = Path(a.python_home)
    model = Path(a.model_dir) if a.model_dir else None
    face_model = Path(a.face_model) if getattr(a, "face_model", "") else None
    if face_model:
        check_face_model(face_model)
    maker_extra = check_maker_extra(getattr(a, "maker_extra", "") or "")
    signin = check_signin(getattr(a, "signin_site", "") or "", getattr(a, "signin_approval_host", None) or [])
    node_kit = Path(a.node_job_kit) if getattr(a, "node_job_kit", "") else None
    node_add = check_node_job_kit(node_kit, kit) if node_kit else []
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
        for rel in node_add:
            (out / rel).parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(node_kit / rel, out / rel)
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
        if face_model:
            shutil.copy2(face_model, out / YUNET_FILE)
        (out / "work").mkdir()
        (out / "films").mkdir()
        word_builder = bool(getattr(a, "word_builder", False))
        write_start_files(out, has_model=bool(model), maker_extra=maker_extra, forge_bat=bool(getattr(a, "forge_bat", False)), word_builder=word_builder, face_model=bool(face_model), signin=signin)
        if word_builder:
            write_word_builder(out, app_repo)
        notices = write_notices(a, out, ffd)
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
            "model": model.name if model else None, "face_model": ({"file": YUNET_FILE, "bytes": YUNET_BYTES, "sha256": YUNET_SHA256, "what": "YuNet face DETECTOR (MIT); finds faces, never says who"} if face_model else None), "large_files": large, "large_file_count": len(large), "app_file_count": len(sums),
            "downloads_made": 0, "note": "Nothing was downloaded to build this folder; every part was copied from this PC. verify_bundle.py checks it at every start.",
        }
        (out / "BUNDLE-MANIFEST.json").write_text(json.dumps(manifest, indent=1, sort_keys=True), encoding="utf-8")
        sums["BUNDLE-MANIFEST.json"] = sha256_file(out / "BUNDLE-MANIFEST.json")
        (out / "SHA256SUMS.txt").write_text("".join(f"{h}  {rel}\n" for rel, h in sorted(sums.items())), encoding="utf-8", newline="\n")
    except Exception:
        shutil.rmtree(out, ignore_errors=True)                      # a half-built folder is never left lying about
        raise
    result = {"out": str(out), "seconds": round(time.time() - t0, 1), "files_copied_from_libraries": n_files, "large_files": len(large), "bytes": sum(f.stat().st_size for f in list_files(out)), "notices": notices}
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
    ap.add_argument("--face-model", default="", help="the YuNet face-finder file (pinned by name, size and SHA-256; any other file is refused)")
    ap.add_argument("--model-licences", default="", help="the folder with the licence record of bundled model files (default: tools/model-licences in the app repo)")
    ap.add_argument("--app-repo", default=str(HERE.parent))
    ap.add_argument("--libraries", nargs="*", default=["faster-whisper"], help="the libraries to copy, with everything they need (default: faster-whisper)")
    ap.add_argument("--zip", action="store_true")
    ap.add_argument("--public", action="store_true", help="a build that will be offered for download by anyone: refused unless ffmpeg's licence and README are present, a source-request contact is given (--notices-contact) and every library carries a licence text")
    ap.add_argument("--licence-supplements", default="", help="a folder of licence texts (<package name>.txt) for packages that ship none; a person puts each project's own text there")
    ap.add_argument("--notices-contact", default="", help="where a person can ask for the source of the GPL parts (wording is Ryan's and the attorney's)")
    ap.add_argument("--ffmpeg-license", default="", help="the ffmpeg build's licence text (default: LICENSE next to its bin folder)")
    ap.add_argument("--ffmpeg-readme", default="", help="the ffmpeg build's README (default: README.txt next to its bin folder)")
    ap.add_argument("--forge-bat", action="store_true", help="also write the second start file, which starts the song page WITH --song-forge (words built from the person's own sounds); the normal start file never passes it")
    ap.add_argument("--word-builder", action="store_true", help="put the word-builder add-on INSIDE the folder (one zip): Get word builder.bat at the root, tools\\get_word_builder.py; the 378 MB model is still fetched later, on a YES, by that file")
    ap.add_argument("--maker-extra", default="", help="page switches the start file turns on unless the tester sets MAKER_EXTRA himself; only --song --song-forge --edit are allowed (for example \"--song --song-forge\")")
    ap.add_argument("--signin-site", default="", help="tester builds: the Ryagram node address (https://<project>.supabase.co/functions/v1/node) the start file passes as --site, so the app shows its Sign in card; off unless given")
    ap.add_argument("--signin-approval-host", action="append", default=[], help="with --signin-site: the host the site sends the person to for approving this computer (repeat for more), for example uselai.com")
    ap.add_argument("--node-job-kit", default="", help="the engine's node-job closure folder (python tools/export_render_kit.py --node-job --out <folder>): its ryagram/worker modules are merged into the bundle; anything else in it is refused")
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
