"""Must-fail proof for the Mac step 2 changes (NEXT-CONNECT 188: exe_name, child_env, runs_dir_default, find_browser and their callers) and tools/check-mac-step3.py: each mutant breaks ONE rule in a scratch copy of tools/ and tools/check-ryagram-platform.py must then FAIL;
a baseline on the unbroken copy passes first.

    py -I tools/check-mac-step3-mutants.py <scratch base folder on D:>"""
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
BASE = Path(sys.argv[1])
NL = chr(10)
CHECK = "check-mac-step3.py"
P, S, N, J = "ryagram_platform.py", "node_settings.py", "ryagram_node_render.py", "ryagram_node_job.py"
M = [
    ('ffmpeg is always ffmpeg.exe', P, 'return base + ".exe" if current(system) == WINDOWS else base', 'return base + ".exe"'),
    ('ffmpeg never has .exe (Windows breaks)', P, 'return base + ".exe" if current(system) == WINDOWS else base', 'return base'),
    ('the Windows child environment loses System32', P, 'return {"SYSTEMROOT": root, "PATH": root + chr(92) + "System32",', 'return {"SYSTEMROOT": root, "PATH": root,'),
    ('a Windows child with no SYSTEMROOT gets nothing', P, 'root = environ.get("SYSTEMROOT", "C:" + chr(92) + "Windows")', 'root = environ.get("SYSTEMROOT", "")'),
    ("a Mac child inherits the person's PATH", P, 'return {"PATH": "/usr/bin:/bin", "HOME": t,', 'return {"PATH": environ.get("PATH", "/usr/bin:/bin"), "HOME": t,'),
    ("a Mac child keeps the person's real home", P, '"HOME": t, "TEMP": t,', '"HOME": environ.get("HOME", t), "TEMP": t,'),
    ('a Mac child inherits the whole environment', P, '    return {"PATH": "/usr/bin:/bin", "HOME": t,', '    return {**environ, "PATH": "/usr/bin:/bin", "HOME": t,'),
    ('the runs list is under ProgramData on a Mac', P, '    if sysname == MAC:\n        return h / "Library" / "Application Support" / "Ryagram" / "runs"', '    if False:\n        return h / "Library" / "Application Support" / "Ryagram" / "runs"'),
    ('the Windows runs list loses the system drive fallback', P, 'environ.get("SystemDrive", "C:") + chr(92) + "ProgramData")', '"C:" + chr(92) + "ProgramData")'),
    ('the node job keeps its own ProgramData rule', J, '    return _platform().runs_dir_default()', '    return Path(os.environ.get("ProgramData") or "C:") / "Ryagram" / "runs"'),
    ('the renderer still hard-codes ffmpeg.exe', N, 'plat.exe_name("ffmpeg")', '"ffmpeg.exe"'),
    ('the renderer keeps its own environment dictionary', N, '        env = plat.child_env(tmp)', '        env = {"SYSTEMROOT": os.environ.get("SYSTEMROOT", "C:"), "PATH": "C:", "TEMP": str(tmp), "TMP": str(tmp), "TMPDIR": str(tmp), "PYTHONUTF8": "1"}'),
    ('a Mac with no Chrome takes Safari', S, '        return None\n    roots = [env.get("PROGRAMFILES(X86)")', '        return "/Applications/Safari.app/Contents/MacOS/Safari"\n    roots = [env.get("PROGRAMFILES(X86)")'),
    ("the user's own Mac Chrome is ignored", S, '+ ([home + "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"] if home else [])', '+ []'),
    ('Windows Chrome lookup is gone', S, '    roots = [env.get("PROGRAMFILES(X86)"), env.get("PROGRAMFILES"), env.get("LOCALAPPDATA")]', '    roots = []'),
]


def run(tools: Path, scratch: Path):
    return subprocess.run([sys.executable, "-I", str(tools / CHECK), str(scratch)], capture_output=True, text=True, timeout=900)


work = Path(tempfile.mkdtemp(prefix="mac3-mut-", dir=str(BASE)))
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
