"""Must-fail proof for tools/check-get-app.py (NEXT-CONNECT 162): each mutant breaks ONE rule of the page in a scratch copy and the check must then FAIL (a baseline on the unbroken copy passes first).

    py -I tools/check-get-app-mutants.py <scratch base folder on D:>
"""
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
BASE = Path(sys.argv[1])
NL = chr(10)
JS, HTML = "assets/get-app.js", "get-app/index.html"
M = [
    ("the page asks to redeem when it opens (a mail link checker would use the link up)", JS, "post('peek').then(function (r) {", "post('redeem').then(function (r) {"),
    ("the token stays in the address bar", JS, "try { history.replaceState(null, '', location.pathname); }", "try { 0; }"),
    ("any address from the function is followed", JS, "var url = r.status === 200 && r.body ? safeDownloadUrl(r.body.url) : null;", "var url = r.status === 200 && r.body ? String(r.body.url) : null;"),
    ("any host counts as the storage host", JS, r"var R2_HOST = /^[a-z0-9]+\.r2\.cloudflarestorage\.com$/;", "var R2_HOST = /.*/;"),
    ("capital letters are a good token", JS, "var TOKEN = /^#t=([0-9a-f]{64})$/;", "var TOKEN = /^#t=([0-9a-fA-F]{64})$/;"),
    ("the token is taken from the query string too", JS, "var token = tokenFrom(location.hash);", "var token = tokenFrom(location.hash) || (new URLSearchParams(location.search).get('t'));"),
    ("a used link still shows the button", JS, "go.hidden = true; say(String((r.body && r.body.error)", "say(String((r.body && r.body.error)"),
    ("the page does not say the link works once", JS, "The link works once.';", "';"),
    ("the sign-up page allows any server to be asked", HTML, "connect-src https://jxtkfishqfxuptwjzczz.supabase.co;", "connect-src *;"),
    ("the page leaks the address to the next site", HTML, '<meta name="referrer" content="no-referrer">', '<meta name="referrer" content="unsafe-url">'),
]


def run(root: Path):
    return subprocess.run([sys.executable, "-I", str(root / "tools" / "check-get-app.py"), str(BASE)], capture_output=True, text=True, timeout=900)


work = Path(tempfile.mkdtemp(prefix="ZZTgetapp-mut-", dir=str(BASE)))
bad = 0
try:
    for i, item in enumerate([("baseline", None, None, None)] + M):
        name, fname, a, b = item
        root = work / f"r{i}"
        (root / "tools").mkdir(parents=True)
        shutil.copy(HERE / "check-get-app.py", root / "tools" / "check-get-app.py")
        shutil.copytree(ROOT / "assets", root / "assets", ignore=shutil.ignore_patterns("*.mp4", "*.zip"))
        shutil.copytree(ROOT / "get-app", root / "get-app")
        if fname:
            f = root / fname
            t = f.read_bytes().decode("utf-8").replace(chr(13) + NL, NL)
            if t.count(a) != 1:
                print(f"  BROKEN MUTANT (anchor found {t.count(a)}x): {name}")
                bad += 1
                continue
            f.write_bytes(t.replace(a, b).encode("utf-8"))
        r = run(root)
        if fname is None:
            if r.returncode != 0:
                print("BASELINE FAILS:" + NL + r.stdout[-900:] + r.stderr[-300:])
                sys.exit(1)
            print("baseline passes")
            continue
        print(("caught  " if r.returncode != 0 else "MISSED  ") + name)
        bad += 0 if r.returncode != 0 else 1
finally:
    shutil.rmtree(work, ignore_errors=True)
print("all mutants caught" if not bad else f"{bad} PROBLEM(S)")
sys.exit(1 if bad else 0)
