"""Must-fail proof for the Mac step 2 changes (NEXT-CONNECT 185: tools/ryagram_platform.py on_system_drive, tools/ryagram_signin.py MacKeychainStore, tools/ryagram_node_render.py on_c) and tools/check-mac-step2.py: each mutant breaks ONE rule in a scratch copy of tools/ and tools/check-ryagram-platform.py must then FAIL;
a baseline on the unbroken copy passes first.

    py -I tools/check-mac-step2-mutants.py <scratch base folder on D:>"""
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
BASE = Path(sys.argv[1])
NL = chr(10)
CHECK = "check-mac-step2.py"
P, S, N = "ryagram_platform.py", "ryagram_signin.py", "ryagram_node_render.py"
M = [
    ("macOS and Linux are 'on C:' again (the old rule)", P, '    if current(system) != WINDOWS:\n        return False\n    try:\n        drive = splitdrive', '    try:\n        drive = splitdrive'),
    ('every Windows path is on the system drive', P, 'return drive.upper() in ("C:", "")\n\n\ndef free_bytes', 'return True\n\n\ndef free_bytes'),
    ('the node renderer keeps a private copy of the rule', N, '    return plat.on_system_drive(path)', '    return os.path.splitdrive(os.path.abspath(str(path)))[0].upper() in ("C:", "")'),
    ('a Keychain token may hold a space or a newline', S, 'SECRET_OK = re.compile(r"^[A-Za-z0-9._~+/=-]{1,%d}$" % MAX_BLOB)', 'SECRET_OK = re.compile(r"^.{1,%d}$" % MAX_BLOB, re.S)'),
    ('a Keychain target may be any text', S, 'TARGET_OK = re.compile(r"^[A-Za-z0-9._:-]{1,120}$")', 'TARGET_OK = re.compile(r"^.*$", re.S)'),
    ('the Keychain command goes on the command line', S, 'r = self._run(["security", "-i"], input=command', 'r = self._run(["security", "-i", command], input=command'),
    ("a missing Keychain item is an error, not 'signed out'", S, 'return "could not be found" in ((r.stderr or "") + (r.stdout or "")).lower()', 'return False'),
    ('a write adds a new item each time (no -U)', S, '-w {secret} -U")', '-w {secret}")'),
    ('an unreadable Keychain answer is guessed (first line taken)', S, 'if r.returncode or len(lines) != 1 or not self.SECRET_OK.match(lines[0]):', 'if r.returncode or not lines:'),
    ('Linux gets a store (a file fallback)', S, '    return None\n\n\ndef default_store', '    return MemoryStore\n\n\ndef default_store'),
    ('a failed Keychain write is silent', S, 'if r.returncode or "error" in (r.stderr or "").lower():', 'if False:'),
]


def run(tools: Path, scratch: Path):
    return subprocess.run([sys.executable, "-I", str(tools / CHECK), str(scratch)], capture_output=True, text=True, timeout=900)


work = Path(tempfile.mkdtemp(prefix="mac2-mut-", dir=str(BASE)))
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
