"""Must-fail proof for tools/footage_sources.py and the video kind of tools/maker_fetch.py (NEXT-CONNECT 168): each mutant breaks ONE rule in a scratch copy of tools/ and tools/check-footage-sources.py must then FAIL;
a baseline on the unbroken copy passes first. No mutant touches a process, a network or anything outside its scratch copy.

    py -I tools/check-footage-sources-mutants.py <scratch base folder on D:>"""
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
BASE = Path(sys.argv[1])
NL = chr(10)
BS = chr(92)
CHECK = "check-footage-sources.py"
FS, MF = "footage_sources.py", "maker_fetch.py"
M = [
    ("an id of any shape is taken", FS, 'r"^[A-Za-z0-9][A-Za-z0-9_.~-]{2,99}$"', 'r".*"'),
    ("a plan with extra fields is taken", FS, "    if extra:", "    if False:"),
    ("an address in the reason is taken", FS, 'if re.search(r"https?://', 'if False and re.search(r"https?://'),
    ("a NASA record that names an owner is offered", FS, "    if THIRD_PARTY.search(blob):", "    if False:"),
    ("a NASA image is offered as footage", FS, 'if _text(record.get("media_type")).lower() != "video":', "if False:"),
    ("another item's NASA record is accepted", FS, 'if _text(record.get("nasa_id")) != item_id:', "if False:"),
    ("a restricted Archives record is offered", FS, 'elif status.lower() != "unrestricted":', "elif False:"),
    ("an Archives record with no status is offered", FS, "    if not status:", "    if False:"),
    ("a donor newsreel is offered", FS, "if THIRD_PARTY.search(blob) or DONOR_SERIES.search(blob):", "if False:"),
    ("a file on another host is chosen", FS, 'if host not in src["file_hosts"] or', "if False or"),
    ("a caption file is chosen", FS, "ext not in VIDEO_EXTS or", "False or"),
    ("an address with a user name or query is chosen", FS, " or u.username or u.password or u.query or u.fragment:", ":"),
    ("the file is fetched over plain http", FS, 'good.append((f"https://{host}{u.path}", host))', "good.append((h, host))"),
    ("the original (largest) file is preferred", FS, '_QUALITY = ("~medium.", "~small.", "~mobile.", "~large.", "~orig.")', '_QUALITY = ("~orig.", "~large.", "~medium.", "~small.", "~mobile.")'),
    ("anything is a video", FS, 'return "That is not a video file."', "return None"),
    ("a clip of any size is kept", FS, "    if size is not None and size > MAX_FOOTAGE_BYTES:", "    if False:"),
    ("the cloud receipt carries the file name", FS, '("source", "item_id", "rights_label_as_shown", "retrieved", "host", "bytes", "sha256")', '("source", "item_id", "rights_label_as_shown", "retrieved", "host", "bytes", "sha256", "name")'),
    ("a data download keeps a video", MF, '            if kind == "video" and not allow_video:', "            if False:"),
    ("a footage download keeps something that is not a video", MF, '            if allow_video and kind != "video":', "            if False:"),
    ("text with ftyp inside is called a video", MF, 'if (head[4:8] == b"ftyp" and head[:1] == b"' + BS + 'x00") or', 'if (head[4:8] == b"ftyp") or'),
    ("a video keeps whatever extension the address had", MF, 'want = ext if ext in VIDEO_KEEP_EXTS else "mp4"', "want = ext"),
]


def run(tools: Path, scratch: Path):
    return subprocess.run([sys.executable, "-I", str(tools / CHECK), str(scratch)], capture_output=True, text=True, timeout=600)


work = Path(tempfile.mkdtemp(prefix="footage-mut-", dir=str(BASE)))
bad = 0
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
print("all mutants caught" if not bad else f"{bad} PROBLEM(S)")
sys.exit(1 if bad else 0)
