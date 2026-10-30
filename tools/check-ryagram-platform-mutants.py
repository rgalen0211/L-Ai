"""Must-fail proof for tools/ryagram_platform.py, tools/mac_launcher.py and their check (NEXT-CONNECT 166): each mutant breaks ONE rule in a scratch copy of tools/ and tools/check-ryagram-platform.py must then FAIL;
a baseline on the unbroken copy passes first.

    py -I tools/check-ryagram-platform-mutants.py <scratch base folder on D:>"""
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
BASE = Path(sys.argv[1])
NL = chr(10)
CHECK = "check-ryagram-platform.py"
P, L, B = "ryagram_platform.py", "mac_launcher.py", "make_app_bundle.py"
M = [
    ("a child that is not its own group leader is signalled by group anyway", P, "if getpgid is not None and killpg is not None and getpgid(proc.pid) == proc.pid:", "if getpgid is not None and killpg is not None:"),
    ("Windows kills the parent only (no /T)", P, '"/PID", str(proc.pid), "/T", "/F"]', '"/PID", str(proc.pid), "/F"]'),
    ("macOS and Linux children do not get their own group", P, '    return {"start_new_session": True}', "    return {}"),
    ("the console window is not hidden for the renderer on Windows", P, 'return {"creationflags": CREATE_NO_WINDOW} if hide_window else {}', "return {}"),
    ("macOS opens the file instead of showing it", P, 'return ["open", "-R", path]', 'return ["open", path]'),
    ("Linux opens the file path itself, not its folder", P, 'return ["xdg-open", str(PurePosixPath(path).parent)]', 'return ["xdg-open", path]'),
    ("Windows loses the Movies folder it always searched", P, 'old = ("Videos", "Downloads", "Desktop", "Documents", "Movies")', 'old = ("Videos", "Downloads", "Desktop", "Documents")'),
    ("macOS memory is page size only", P, "return pages * size if pages > 0 and size > 0 else None", "return size"),
    ("the start file goes on after a failed self-check", L, '        "  exit 1",', '        "  true",'),
    ("the baked switches override the tester's MAKER_EXTRA", L, 'if [ -z "${MAKER_EXTRA+x}" ]; then MAKER_EXTRA="', 'if true; then MAKER_EXTRA="'),
    ("the start file is written with CRLF endings", L, '    return "\\n".join(lines)', '    return "\\r\\n".join(lines)'),
    ("the app line loses the sign-in text", L, '(signin + " " if signin else "")', '""'),
    ("the Python programs are not executable in the zip", L, 'EXEC_DIRS = ("python/bin/",)', "EXEC_DIRS = ()"),
    ("every file in the zip is executable", L, "(0o755 if exe else 0o644)", "0o755"),
    ("the module does not travel in the app folder", B, 'RUNTIME_TOOLS = RUNTIME_TOOLS + ("ryagram_platform.py",)', "RUNTIME_TOOLS = RUNTIME_TOOLS"),
]


def run(tools: Path, scratch: Path):
    return subprocess.run([sys.executable, "-I", str(tools / CHECK), str(scratch)], capture_output=True, text=True, timeout=900)


work = Path(tempfile.mkdtemp(prefix="platform-mut-", dir=str(BASE)))
bad = 0
try:
    for i, item in enumerate([("baseline", None, None, None)] + M):
        name, fname, a, b = item
        tools = work / f"t{i}" / "tools"
        shutil.copytree(HERE, tools, ignore=shutil.ignore_patterns("__pycache__", "maker-live", "*.zip"))
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
        if fname is None:
            r = run(tools, scratch)
            if r.returncode != 0:
                print("BASELINE FAILS:" + NL + r.stdout[-900:] + r.stderr[-300:])
                sys.exit(1)
            print("baseline passes")
            continue
        try:
            rc = run(tools, scratch).returncode
        except subprocess.TimeoutExpired:
            rc = 1
        print(("caught  " if rc != 0 else "MISSED  ") + name)
        bad += 0 if rc != 0 else 1
finally:
    shutil.rmtree(work, ignore_errors=True)
print("all mutants caught" if not bad else f"{bad} PROBLEM(S)")
sys.exit(1 if bad else 0)
