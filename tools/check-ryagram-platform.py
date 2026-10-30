"""Mac-ready step 1 (NEXT-CONNECT 166): tools/ryagram_platform.py and tools/mac_launcher.py, with MUST-FAILs. Runs on Windows.

    py -I tools/check-ryagram-platform.py <scratch base folder on D:>

The macOS and Linux bodies run with stand-ins for the system calls; the Windows bodies run for real (a real process tree is ended by PID; the real memory call answers). The macOS start file is also RUN, with the
real bash that Git for Windows carries, against a stand-in folder whose name holds a space. No network; nothing outside the scratch folder is touched."""
import os
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import mac_launcher as ml                         # noqa: E402
import ryagram_platform as plat                   # noqa: E402

BASE = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(tempfile.mkdtemp(prefix="platform-check-"))
BASE.mkdir(parents=True, exist_ok=True)
FAILS = []
NL = chr(10)
BS = chr(92)


def check(c, what):
    print(("  ok   " if c else "  FAIL ") + what, flush=True)
    if not c:
        FAILS.append(what)


class Proc:
    def __init__(self, pid=4242):
        self.pid, self.killed = pid, False

    def kill(self):
        self.killed = True


print("A. which platform")
check([plat.current(x) for x in ("win32", "cygwin", "darwin", "linux", "linux2", "freebsd14")] == ["windows", "windows", "mac", "linux", "linux", "linux"], "win32 and cygwin are Windows, darwin is mac, everything else is Linux")
check(plat.current() == ("windows" if os.name == "nt" else plat.current()), "the real answer on this computer is consistent")

print("B. child processes: their own group (elsewhere), ended by PID with their children")
check(plat.popen_group_kwargs("windows") == {} and plat.popen_group_kwargs("windows", hide_window=True) == {"creationflags": 0x08000000}, "Windows: no extra arguments, or only 'no console window' when asked (what the site-film renderer always passed)")
check(plat.popen_group_kwargs("mac") == {"start_new_session": True} and plat.popen_group_kwargs("linux", hide_window=True) == {"start_new_session": True}, "macOS and Linux: the child leads its own process group")
calls = []
r = plat.kill_tree(Proc(77), system="windows", run=lambda *a, **k: calls.append((a, k)))
check(r == "taskkill" and calls and calls[0][0][0] == ["taskkill", "/PID", "77", "/T", "/F"], "Windows: taskkill /PID <pid> /T /F, by PID only (never by name)")
sent = []
p = Proc(500)
r = plat.kill_tree(p, system="mac", getpgid=lambda pid: pid, killpg=lambda g, s: sent.append((g, s)))
check(r == "group" and sent == [(500, signal.SIGKILL if hasattr(signal, "SIGKILL") else 9)] and not p.killed, "macOS: a child that leads its group is ended through the group (its children go with it)")
sent = []
p = Proc(501)
r = plat.kill_tree(p, system="mac", getpgid=lambda pid: 1, killpg=lambda g, s: sent.append((g, s)))
check(r == "single" and sent == [] and p.killed, "MUST-FAIL guard: a child that is NOT its own group leader is killed alone; the app never signals a group it is in")
p = Proc(502)


def gone(pid):
    raise ProcessLookupError


r = plat.kill_tree(p, system="linux", getpgid=gone, killpg=lambda g, s: None)
check(r == "single" and p.killed, "a child that has already gone is handled (killed alone, no error)")
PID_FORM = bool(calls) and calls[0][0][0][:2] == ["taskkill", "/PID"]
if os.name == "nt" and not PID_FORM:
    check(False, "the REAL tree kill was NOT run because kill_tree is not asking taskkill for a PID (it would not be safe to run: never stop processes by name)")
elif os.name == "nt":
    out = BASE / "tree"
    out.mkdir(exist_ok=True)
    marker = out / "child.pid"
    if marker.exists():
        marker.unlink()                                          # an earlier run's pid must never be read as this run's
    code = ("import subprocess,sys,time; c=subprocess.Popen([sys.executable,'-c','import time; time.sleep(120)']); open(sys.argv[1],'w').write(str(c.pid)); time.sleep(120)")
    parent = subprocess.Popen([sys.executable, "-c", code, str(marker)], **plat.popen_group_kwargs("windows"))
    for _ in range(100):
        if marker.exists() and marker.read_text().strip():
            break
        time.sleep(0.1)
    child = int(marker.read_text())

    def alive(pid):
        o = subprocess.run(["tasklist", "/FI", f"PID eq {pid}", "/NH"], capture_output=True, text=True).stdout
        return str(pid) in o
    before = alive(parent.pid) and alive(child)
    plat.kill_tree(parent)
    time.sleep(1.0)
    check(before and not alive(parent.pid) and not alive(child), "REAL: on this Windows PC a parent and its child are both ended by PID, and nothing else is touched")
else:
    check(True, "(real tree kill: Windows only)")

print("C. showing a file in the file window")
check(plat.reveal_argv(BS.join(["C:", "x", "film.mp4"]), "windows") == ["explorer", "/select," + BS.join(["C:", "x", "film.mp4"])], "Windows: explorer /select,<path> (as before)")
check(plat.reveal_argv("/Users/a b/film.mp4", "mac") == ["open", "-R", "/Users/a b/film.mp4"], "macOS: open -R <path> (a space in the path stays one argument)")
check(plat.reveal_argv("/home/a/film.mp4", "linux") == ["xdg-open", "/home/a"], "Linux: xdg-open on the folder")
got = []
plat.reveal("/Users/a/film.mp4", system="mac", popen=lambda argv: got.append(argv) or "p")
check(got == [["open", "-R", "/Users/a/film.mp4"]], "reveal() runs exactly that command")

print("D. where 'find my file' looks")
home = Path("/h")
have = {home / n for n in ("Movies", "Downloads", "Documents")}
check(plat.search_folders(home, "mac", is_dir=lambda q: q in have) == [home / "Movies", home / "Downloads", home / "Documents"], "macOS: Movies first, then the folders that exist")
have = {home / n for n in ("Videos", "Movies", "Desktop")}
check(plat.search_folders(home, "windows", is_dir=lambda q: q in have) == [home / "Videos", home / "Desktop", home / "Movies"], "Windows: exactly the list the app always used (Videos, Downloads, Desktop, Documents, Movies, those that exist)")
check(plat.search_folders(home, "linux", is_dir=lambda q: False) == [], "none exist: an empty list")

print("E. memory and disk")
check(isinstance(plat.total_memory_bytes("windows"), int) and plat.total_memory_bytes("windows") > (1 << 30) if os.name == "nt" else True, "REAL: Windows says how much memory this PC has")
check(plat.total_memory_bytes("windows", windows_total=lambda: None) is None, "Windows: when the call fails, None")
check(plat.total_memory_bytes("mac", sysconf=lambda k: {"SC_PHYS_PAGES": 2097152, "SC_PAGE_SIZE": 16384}[k]) == 2097152 * 16384, "macOS: pages times page size (an 32 GiB Mac)")
check(plat.total_memory_bytes("linux", sysconf=lambda k: (_ for _ in ()).throw(ValueError())) is None and plat.total_memory_bytes("linux", sysconf=lambda k: -1) is None, "an unreadable or nonsense answer is None, never a guess")
free = plat.free_bytes(BASE / "no" / "such" / "deeper")
check(isinstance(free, int) and free > 0, "free space is read from the nearest folder that exists")
check(plat.free_bytes(BASE, usage=lambda p: (_ for _ in ()).throw(OSError())) is None, "an unreadable volume is None")

print("F. the app uses the module and the old Windows-only lines are gone")
for f in ("desktop_maker.py", "ryagram_node_render.py"):
    src = (HERE / f).read_text(encoding="utf-8")
    check("taskkill" not in src and "explorer" not in src, f"MUST-FAIL guard: {f} has no taskkill or explorer of its own any more (they live in ryagram_platform.py)")
src = (HERE / "maker_song.py").read_text(encoding="utf-8")
check("popen_group_kwargs" in src and "popen_group_kwargs" in (HERE / "desktop_maker.py").read_text(encoding="utf-8"), "both places that start a build child put it in its own group where the system has groups")
import make_app_bundle as mab                                    # noqa: E402
check("ryagram_platform.py" in mab.RUNTIME_TOOLS, "MUST-FAIL guard: the module travels in the app folder (desktop_maker imports it)")

print("G. the macOS start file")
txt = ml.command_text("--song --edit", plat_signin := '--site "https://jxtkfishqfxuptwjzczz.supabase.co/functions/v1/node" --approval-host uselai.com')
lines = txt.split(NL)
check(txt.startswith("#!/bin/bash" + NL) and "\r" not in txt and txt.endswith(NL), "a bash script with LF endings only (CRLF would not run)")
check("/Users" not in txt and "C:" not in txt and txt.count('"$HERE/') >= 6, "it refers only to its own folder")
iv = next(i for i, l in enumerate(lines) if "verify_bundle.py" in l)
ia = next(i for i, l in enumerate(lines) if "desktop_maker.py" in l)
check(iv < ia and " -I " in lines[iv] and " -I " in lines[ia] and "exit 1" in txt[txt.index("verify_bundle.py"):txt.index("desktop_maker.py")], "the self-check runs BEFORE the app, both with the isolated flag, and a failed check stops the start")
check(lines[ia].endswith("$OPEN ${MAKER_EXTRA:-}") and '--work-dir "$HERE/work" --out-dir "$HERE/films" ' + plat_signin + " $OPEN" in lines[ia], "the app line: folders, then the sign-in text, then $OPEN and the tester's MAKER_EXTRA, as in the .bat")
check('if [ -z "${MAKER_EXTRA+x}" ]; then MAKER_EXTRA="--song --edit"; fi' in txt, "the baked switches are only a default: set only when the tester has not set MAKER_EXTRA himself")
plain = ml.command_text()
check("MAKER_EXTRA=" not in plain and "--site" not in plain, "with no options the file sets no switch and has no site (as the .bat)")
for bad in ("a" + NL + "rm -rf ~", "a`b`", "$(x)", "a" + BS + "b"):
    try:
        ml.command_text(bad)
        check(False, "MUST-FAIL: a newline, backtick, dollar sign or backslash cannot ride into the script: " + repr(bad))
    except ValueError:
        check(True, "MUST-FAIL: a newline, backtick, dollar sign or backslash cannot ride into the script: " + repr(bad))

print("H. the macOS start file, run for real with bash on a folder whose name has a space")
bash = shutil.which("bash")
if not bash:
    check(False, "bash was not found on this PC, so the start file could not be run (install Git for Windows)")
else:
    def world(name, verify_rc=0):
        root = BASE / name / "My Ryagram"
        for d in ("python/bin", "tools", "ffmpeg", "models", "work", "films"):
            (root / d).mkdir(parents=True, exist_ok=True)
        log = BASE / name / "calls.txt"
        if log.exists():
            log.unlink()
        # a stand-in python3: records its arguments and the environment the start file set, and fails the self-check when asked
        (root / "python" / "bin" / "python3").write_bytes((
            "#!/bin/bash" + NL + 'echo "ARGS: $*" >> "' + log.as_posix() + '"' + NL
            + 'echo "ENV: FFMPEG_PATH=$FFMPEG_PATH MODEL=$RYAGRAM_MODEL_DIR NOUSER=$PYTHONNOUSERSITE PATH0=${PATH%%:*}" >> "' + log.as_posix() + '"' + NL
            + 'case "$*" in *verify_bundle.py*) exit ' + str(verify_rc) + ";; esac" + NL + "exit 0" + NL).encode("ascii"))
        return root, log

    def run(root, extra_env=None, text=None, timeout=60):
        f = ml.write_command_file(root, "--song", plat_signin) if text is None else None
        env = {k: v for k, v in os.environ.items() if k not in ("MAKER_EXTRA", "MAKER_NO_OPEN")}
        env.update(extra_env or {})
        return subprocess.run([bash, f.as_posix()], capture_output=True, text=True, env=env, timeout=timeout, stdin=subprocess.DEVNULL)

    root, log = world("h1")
    r = run(root)
    calls = log.read_text(encoding="utf-8").splitlines() if log.exists() else []
    args = [c for c in calls if c.startswith("ARGS:")]
    check(r.returncode == 0 and len(args) == 2 and "verify_bundle.py" in args[0] and "desktop_maker.py" in args[1], f"it ran the self-check, then the app (rc {r.returncode}; {r.stderr.strip()[:120]})")
    check(' --work-dir ' in args[1] and "My Ryagram/work" in args[1] and "My Ryagram/films" in args[1] and "--open" in args[1] and plat_signin.replace('"', "") in args[1].replace('"', ""), "the app got the work and films folders inside the folder (a space in its name is fine), --open, the sign-in text")
    check(args[1].rstrip().endswith("--song"), "MAKER_EXTRA defaulted to the baked switches and came last: " + args[1][-40:])
    env_line = next(c for c in calls if c.startswith("ENV:"))
    check("My Ryagram/ffmpeg/ffmpeg" in env_line and "My Ryagram/models" in env_line and "NOUSER=1" in env_line and "PATH0=" in env_line and "My Ryagram/python/bin" in env_line, "FFMPEG_PATH, the model folder, PYTHONNOUSERSITE and PATH point inside the folder")
    root, log = world("h2")
    r = run(root, {"MAKER_EXTRA": "--edit --live", "MAKER_NO_OPEN": "1"})
    args = [c for c in log.read_text(encoding="utf-8").splitlines() if c.startswith("ARGS:")]
    check(len(args) == 2 and args[1].rstrip().endswith("--edit --live") and "--open" not in args[1] and "--song" not in args[1], "the tester's own MAKER_EXTRA replaces the baked one, and MAKER_NO_OPEN drops --open")
    root, log = world("h3", verify_rc=1)
    r = run(root)
    args = [c for c in log.read_text(encoding="utf-8").splitlines() if c.startswith("ARGS:")]
    check(r.returncode == 1 and len(args) == 1 and "verify_bundle.py" in args[0] and "Do not go on" in r.stdout, "MUST-FAIL: when the self-check fails the app is NOT started and the person is told in words")

print("I. the zip keeps what a Mac needs to start it")
check(ml.zip_mode("app/Open Ryagram.command") >> 16 & 0o777 == 0o755 and ml.zip_mode("app/python/bin/python3") >> 16 & 0o777 == 0o755 and ml.zip_mode("app/ffmpeg/ffmpeg") >> 16 & 0o777 == 0o755, "the start file, the Python and ffmpeg programs are executable")
check(ml.zip_mode("app/tools/desktop_maker.py") >> 16 & 0o777 == 0o644 and ml.zip_mode("app/models/yunet.onnx") >> 16 & 0o777 == 0o644 and ml.zip_mode("app/python/lib/python3.12/os.py") >> 16 & 0o777 == 0o644, "MUST-FAIL guard: everything else is NOT executable")
src = BASE / "zipsrc"
src.mkdir(exist_ok=True)
(src / "a.command").write_bytes(b"#!/bin/bash" + NL.encode())
(src / "b.py").write_bytes(b"x = 1" + NL.encode())
zp = BASE / "t.zip"
with zipfile.ZipFile(zp, "w") as z:
    ml.add_to_zip(z, src / "a.command", Path("app") / "Open Ryagram.command")
    ml.add_to_zip(z, src / "b.py", Path("app") / "tools" / "b.py")
with zipfile.ZipFile(zp) as z:
    modes = {i.filename: i.external_attr >> 16 & 0o777 for i in z.infolist()}
    ok_read = z.read("app/Open Ryagram.command") == b"#!/bin/bash" + NL.encode()
check(modes == {"app/Open Ryagram.command": 0o755, "app/tools/b.py": 0o644} and ok_read, f"a zip written here carries the bits and the exact bytes ({modes})")
plain_zip = BASE / "plain.zip"
with zipfile.ZipFile(plain_zip, "w") as z:
    z.write(src / "a.command", "app/Open Ryagram.command")
with zipfile.ZipFile(plain_zip) as z:
    check(z.infolist()[0].external_attr >> 16 & 0o777 != 0o755, "MUST-FAIL: a zip written the plain way (as the builder does today) has NO executable bit, which is why add_to_zip exists")

print()
if FAILS:
    print(f"FAILED: {len(FAILS)}")
    for f in FAILS:
        print("  -", f)
    sys.exit(1)
print("all passed")
