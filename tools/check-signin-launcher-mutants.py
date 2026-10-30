"""Must-fail proof for the tester sign-in start file (NEXT-CONNECT 163) and the node-job closure merge (NEXT-CONNECT 164): each mutant breaks ONE rule in a scratch copy of tools/ and tools/check-app-bundle.py (section I) must then FAIL; a baseline on the unbroken copy passes first.

    py -I tools/check-signin-launcher-mutants.py <scratch base folder on D:>

The rules: the sign-in switches are OFF unless asked for; the site must be exactly a Ryagram node address and the approval host a plain lower-case host name (nothing a shell would act on), both checked before any file is
written; a site needs its approval host; both reach the app line (after the folders, before %OPEN% %MAKER_EXTRA%) and the command line options reach the builder."""
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
BASE = Path(sys.argv[1])
NL = chr(10)
BUNDLE = "check-app-bundle.py"
M = [
    ("the site address is not checked", "make_app_bundle.py", "    if not SIGNIN_SITE_SHAPE.fullmatch(site):", "    if False:"),
    ("the approval host is not checked", "make_app_bundle.py", "        if not SIGNIN_HOST_SHAPE.fullmatch(h):", "        if False:"),
    ("any host's functions address is taken as the site", "make_app_bundle.py", 'r"^https://[a-z0-9]{20}[.]supabase[.]co/functions/v1/node$"', 'r"^https://[^ ]+/functions/v1/node$"'),
    ("a site needs no approval host", "make_app_bundle.py", "    if not hosts:" + NL + '        raise Refused("--signin-site needs at least one', "    if False:" + NL + '        raise Refused("--signin-site needs at least one'),
    ("an approval host needs no site", "make_app_bundle.py", "    if not site:" + NL + '        raise Refused("--signin-approval-host needs', "    if False:" + NL + '        raise Refused("--signin-approval-host needs'),
    ("the site is left out of the app line", "make_app_bundle.py", "    return f'--site \"{site}\" ' + \" \".join(", "    return \"\" + \" \".join("),
    ("the build never hands the sign-in to the start file", "make_app_bundle.py", "face_model=bool(face_model), signin=signin)", "face_model=bool(face_model))"),
    ("the sign-in is put after %MAKER_EXTRA%", "make_app_bundle.py", "' + (signin + \" \" if signin else \"\") + '%OPEN% %MAKER_EXTRA%',", "'%OPEN% %MAKER_EXTRA% ' + (signin if signin else \"\") + '',"),
    ("every build signs in by default", "make_app_bundle.py", 'bool(getattr(a, "node_allow_c", False)))', 'bool(getattr(a, "node_allow_c", False))) or \'--site "https://jxtkfishqfxuptwjzczz.supabase.co/functions/v1/node" --approval-host uselai.com\''),
    ("the command line option for the approval host is not read", "make_app_bundle.py", 'ap.add_argument("--signin-approval-host", action="append", default=[]', 'ap.add_argument("--signin-approval-hostx", dest="unused", action="append", default=[]'),
    ("the command line option for the site is not read", "make_app_bundle.py", 'ap.add_argument("--signin-site", default=""', 'ap.add_argument("--signin-sitex", dest="unused2", default=""'),
    # NEXT-CONNECT 164: the node-job closure merged into the bundle (check-app-bundle.py section J)
    ("a node-job file that is not the one its manifest names is taken", "make_app_bundle.py", "        if sha256_file(node_kit / rel) != want:", "        if False:"),
    ("extra or missing node-job files are taken", "make_app_bundle.py", "    if on_disk != set(listed):", "    if False:"),
    ("any house-worker module is taken", "make_app_bundle.py", "            if len(parts) != 3 or parts[2] not in NODE_JOB_WORKER_FILES:", "            if False:"),
    ("a node-job file that differs from the kit's own is taken", "make_app_bundle.py", "            if sha256_file(twin) != want:", "            if False:"),
    ("a node-job file outside the ryagram folder is taken", "make_app_bundle.py", 'if parts[0] != "ryagram" or ".." in parts or rel.startswith("/") or ":" in rel:', "if False:"),
    ("a new file outside ryagram/worker and ryagram/sequence is taken", "make_app_bundle.py", '        elif parts[:2] == ["ryagram", "sequence"] and len(parts) == 3 and NODE_JOB_SEQUENCE_FILE.fullmatch(parts[2]):', "        elif True:"),
    ("a node-job kit with no config.py is taken", "make_app_bundle.py", '    if not any(r == "ryagram/worker/config.py" for r in listed):', "    if False:"),
    ("the node-job files are never copied into the bundle", "make_app_bundle.py", "            shutil.copy2(node_kit / rel, out / rel)", "            pass"),
    ("the build ignores --node-job-kit", "make_app_bundle.py", "node_add = check_node_job_kit(node_kit, kit) if node_kit else []", "node_add = []"),
]


def run(tools: Path, scratch: Path):
    return subprocess.run([sys.executable, "-I", str(tools / BUNDLE), str(scratch)], capture_output=True, text=True, timeout=900)


work = Path(tempfile.mkdtemp(prefix="signin-mut-", dir=str(BASE)))
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
