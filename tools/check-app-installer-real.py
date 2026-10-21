"""The REAL compile-install-uninstall run of the setup exe (NEXT-CONNECT 108), with the real Inno Setup compiler. Needs Inno Setup 6 already installed (a Ryan-approved download; this script downloads nothing).
It builds a small fake bundle in a throwaway folder on D:, compiles it with make_app_installer.build (real ISCC.exe, real signature check), then installs and uninstalls it SILENTLY many times
in throwaway folders and checks what CC1 asked for (23:32 and 23:44): a folder that holds someone's files is refused, a kept folder is accepted only with Ryagram's marker, the uninstaller never
touches a folder without the marker, and nothing outside the install folder is left. It briefly puts a "Ryagram" shortcut in the current user's Start menu and an entry in Windows' Apps list (both are
removed by the uninstall; the script checks they are gone).

    python tools/check-app-installer-real.py <ISCC.exe> [<scratch base folder on D:>]
"""
import importlib.util
import json
import os
import shutil
import subprocess
import sys
import time
import winreg
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import make_app_installer as mai              # noqa: E402
import verify_bundle as vb                    # noqa: E402

spec = importlib.util.spec_from_file_location("cai", HERE / "check-app-installer.py")
ISCC = Path(sys.argv[1])
BASE = Path(sys.argv[2]) if len(sys.argv) > 2 else Path("D:/Ryagram-scratch/CONNECT/installer-real")
FAILS = []
APPDATA = Path(os.environ["APPDATA"])
LNK = APPDATA / "Microsoft" / "Windows" / "Start Menu" / "Programs" / "Ryagram.lnk"
UNKEY = r"Software\Microsoft\Windows\CurrentVersion\Uninstall\{" + mai.APP_ID + "}_is1"


def check(c, what):
    print(("  ok   " if c else "  FAIL ") + what, flush=True)
    if not c:
        FAILS.append(what)


def sha(p):
    import hashlib
    return hashlib.sha256(Path(p).read_bytes()).hexdigest()


def make_bundle(root):
    b = root / "bundle"
    (b / "tools").mkdir(parents=True)
    (b / "ryagram").mkdir()
    (b / "python").mkdir()
    shutil.copy2(HERE / "verify_bundle.py", b / "tools" / "verify_bundle.py")
    (b / "tools" / "desktop_maker.py").write_text("print('app')\n")
    (b / "ryagram" / "engine.py").write_text("print('engine')\n")
    (b / "python" / "python.exe").write_bytes(b"MZ" + b"0" * 5000)
    (b / "Open Ryagram.bat").write_bytes(b"@echo off\r\n")
    (b / "START-HERE.txt").write_bytes(b"hello\r\n")
    sums = {}
    for p in sorted(b.rglob("*")):
        rel = p.relative_to(b).as_posix()
        if p.is_file() and (rel.split("/")[0] in ("ryagram", "tools", "recipes", "docs") or rel in ("Open Ryagram.bat", "START-HERE.txt")):
            sums[rel] = sha(p)
    large = {"python/python.exe": {"bytes": 5002, "sha256": sha(b / "python" / "python.exe")}}
    (b / "BUNDLE-MANIFEST.json").write_text(json.dumps({"schema": "ryagram.app-bundle/0", "app_head": "a" * 40, "large_files": large, "downloads_made": 0}, indent=1), encoding="utf-8")
    sums["BUNDLE-MANIFEST.json"] = sha(b / "BUNDLE-MANIFEST.json")
    (b / "SHA256SUMS.txt").write_text("".join(f"{h}  {rel}\n" for rel, h in sorted(sums.items())), encoding="utf-8", newline="\n")
    assert vb.check(b) == []
    return b


def run(args, timeout=300):
    return subprocess.run([str(a) for a in args], capture_output=True, text=True, timeout=timeout, stdin=subprocess.DEVNULL).returncode


def install(setup, folder, log, extra=()):
    return run([setup, "/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART", f"/DIR={folder}", f"/LOG={log}", *extra])


def uninstall(folder, delete):
    u = Path(folder) / "unins000.exe"
    if not u.is_file():
        return None
    rc = run([u, "/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART", f"/DELETEFILES={'yes' if delete else 'no'}"])
    for _ in range(120):                                              # the uninstaller hands over to a temporary copy and exits first
        if not u.exists():
            break
        time.sleep(1)
    time.sleep(1)
    return rc


def listing(folder):
    f = Path(folder)
    return sorted(p.relative_to(f).as_posix() for p in f.rglob("*")) if f.exists() else None


def registered():
    try:
        winreg.CloseKey(winreg.OpenKey(winreg.HKEY_CURRENT_USER, UNKEY))
        return True
    except OSError:
        return False


def main():
    shutil.rmtree(BASE, ignore_errors=True)
    BASE.mkdir(parents=True)
    work = BASE / "w"
    work.mkdir()
    made = []
    try:
        print("compile with the real Inno Setup compiler")
        b = make_bundle(work)
        out = work / "setup-out"
        info = mai.build(b, ISCC, out, "7", allow_any_drive=False)
        setup = out / "Ryagram-Setup-7.exe"
        check(setup.is_file() and setup.stat().st_size > 100000 and info["sha256"] == sha(setup), f"the real compiler wrote the setup exe ({setup.stat().st_size:,} bytes) and the manifest hash matches it")
        check(not registered() and not LNK.exists(), "before the first install there is no Ryagram entry in the Apps list or the Start menu")

        print("\nT1 a fresh install")
        d1 = BASE / "inst1"
        made.append(d1)
        rc = install(setup, d1, BASE / "t1.log")
        check(rc == 0, f"silent install into a new folder: exit code {rc}")
        check(all((d1 / x).is_file() for x in ("Open Ryagram.bat", "START-HERE.txt", "BUNDLE-MANIFEST.json", "tools/desktop_maker.py", "unins000.exe")), "the files are there")
        check(vb.check(d1) == [], "the installed folder passes the app's own start-time self-check (every file as built)")
        check(all((d1 / x / "RYAGRAM-FOLDER.txt").is_file() for x in ("films", "work", "models")), "the marker is in films, work and models")
        check(registered() and LNK.exists(), "Windows' Apps list and the Start menu both have Ryagram now")

        print("\nT2 uninstall, KEEPING the person's files")
        (d1 / "films" / "my film.mp4").write_bytes(b"film")
        (d1 / "work" / "cache.bin").write_bytes(b"cache")
        (d1 / "tools" / "__pycache__").mkdir()
        (d1 / "tools" / "__pycache__" / "x.pyc").write_bytes(b"pyc")                  # what running the app leaves behind
        rc = uninstall(d1, delete=False)
        left = listing(d1)
        check(left is not None and (d1 / "films" / "my film.mp4").is_file() and (d1 / "work" / "cache.bin").is_file(), f"No: the film and the work file are still there ({left})")
        check(not any(x.startswith(("python", "tools", "ryagram", "ffmpeg", "recipes", "docs")) for x in left) and "Open Ryagram.bat" not in left and "unins000.exe" not in left,
              "and every program file and folder of Ryagram is gone, including the runtime leftovers")
        check({"films/RYAGRAM-FOLDER.txt", "work/RYAGRAM-FOLDER.txt", "models/RYAGRAM-FOLDER.txt"} <= set(left), "and the three markers survived the uninstall")
        check(not registered() and not LNK.exists(), "the Apps list entry and the Start menu shortcut are gone")

        print("\nT3 a reinstall into that kept folder is accepted (it carries the markers)")
        rc = install(setup, d1, BASE / "t3.log")
        check(rc == 0 and (d1 / "Open Ryagram.bat").is_file() and (d1 / "films" / "my film.mp4").is_file(), f"accepted, program back, the film untouched (exit {rc})")

        print("\nT4 uninstall, DELETING the person's files")
        rc = uninstall(d1, delete=True)
        check(listing(d1) in (None, []) or not d1.exists(), f"Yes: the whole folder is gone ({listing(d1)})")
        check(not registered() and not LNK.exists(), "and nothing is left in the Apps list or the Start menu")

        print("\nT5 MUST-FAIL: a folder that holds someone's own files is refused and untouched")
        d2 = BASE / "inst2"
        (d2 / "docs").mkdir(parents=True)
        (d2 / "docs" / "keep.txt").write_text("mine")
        made.append(d2)
        before = listing(d2)
        rc = install(setup, d2, BASE / "t5.log")
        check(rc != 0, f"the install is refused (exit code {rc})")
        check("already has files in it and is not a Ryagram folder" in (BASE / "t5.log").read_text(errors="replace"), "and the log says why, in the plain sentence")
        check(listing(d2) == before and (d2 / "docs" / "keep.txt").read_text() == "mine", f"and docs\\keep.txt and the folder are exactly as they were ({listing(d2)})")
        check(not registered() and not LNK.exists(), "and nothing was registered")

        print("\nT6 MUST-FAIL: a plain folder called work (no marker) does not make a folder Ryagram's")
        d3 = BASE / "inst3"
        (d3 / "work").mkdir(parents=True)
        (d3 / "work" / "sam.txt").write_text("sam")
        made.append(d3)
        before = listing(d3)
        rc = install(setup, d3, BASE / "t6.log")
        check(rc != 0 and listing(d3) == before, f"refused (exit {rc}) and untouched ({listing(d3)})")

        print("\nT7 control: the same folder WITH the marker inside work is accepted")
        (d3 / "work" / "RYAGRAM-FOLDER.txt").write_text("marker")
        rc = install(setup, d3, BASE / "t7.log")
        check(rc == 0 and (d3 / "Open Ryagram.bat").is_file() and (d3 / "work" / "sam.txt").read_text() == "sam", f"accepted (exit {rc}) and sam.txt is untouched")

        print("\nT8 MUST-FAIL: Yes at uninstall deletes only folders that carry the marker")
        (d3 / "films" / "f.mp4").write_bytes(b"f")
        (d3 / "work" / "RYAGRAM-FOLDER.txt").unlink()                             # work no longer carries the marker (someone else's folder now)
        uninstall(d3, delete=True)
        check((d3 / "work" / "sam.txt").is_file() and not (d3 / "films").exists(), f"Yes: films (marked) went, work (no marker) was left alone ({listing(d3)})")
        shutil.rmtree(d3, ignore_errors=True)

        print("\nT9 an upgrade over an earlier Ryagram folder (it holds BUNDLE-MANIFEST.json) is accepted")
        d4 = BASE / "inst4"
        made.append(d4)
        r1 = install(setup, d4, BASE / "t9a.log")
        r2 = install(setup, d4, BASE / "t9b.log")
        check(r1 == 0 and r2 == 0 and vb.check(d4) == [], f"installing twice into the same folder works and the folder still passes its self-check (exits {r1}, {r2})")
        uninstall(d4, delete=True)
        check(not registered() and not LNK.exists(), "clean again")
    finally:
        for d in made:
            if (d / "unins000.exe").is_file():
                uninstall(d, delete=True)
        shutil.rmtree(BASE, ignore_errors=True)
        check(not registered() and not LNK.exists(), "FINAL: nothing of the test is left in Windows' Apps list or the Start menu")
    print()
    if FAILS:
        print("FAILED: " + "; ".join(FAILS))
        return 1
    print("all passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
