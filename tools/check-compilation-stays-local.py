"""A compilation built in the desktop maker STAYS ON THIS COMPUTER (NEXT-CONNECT 131 part 3; Ryan 2026-10-26 ~18:09: "finished compilations stay on the user's own PC for now, no site hosting").
No browser, no network, no speech model: the maker really runs (the engine's recipe check is real, Plan and Build run a stand-in `ryagram.local`), signed in to a stand-in for the site, and the
stand-in records EVERY request it receives.

    python tools/check-compilation-stays-local.py <the Ryagram folder that has ryagram/local> [<scratch base folder on D:>]

What it proves
  * after a real sign-in, a plan and a build, the site was asked only for sign-in and account things (and, if the card is on, the read-only list of what the person's AI asked for), never for a
    compilation upload, an artifact, a claim, or anything with a file
  * the private-link card is OFF by default (no flag file), and its upload is refused while it is off
  * the finished film and its receipt are in the person's own films folder, and the receipt says network_attempts 0
  * in the code: only the node loop and the private-link module can send a file; the maker's plan, build, song and edit paths never name an uploader
"""
import importlib.util
import json
import re
import shutil
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
if len(sys.argv) < 2:
    sys.exit("Give the Ryagram folder (the one that holds ryagram/local).")
ENGINE = Path(sys.argv[1])
BASE = Path(sys.argv[2]) if len(sys.argv) > 2 else None
import fake_ryagram_site as fake  # noqa: E402
import ryagram_signin as si  # noqa: E402

spec = importlib.util.spec_from_file_location("desktop_maker", ROOT / "tools" / "desktop_maker.py")
dm = importlib.util.module_from_spec(spec)
sys.modules["desktop_maker"] = dm
spec.loader.exec_module(dm)

RECIPE = {"schema": "ryagram.recipe/0", "name": "any words", "slots": [{"id": "source-1", "label": "Your footage", "accepts": "video", "multiple": True}],
          "find": {"op": "words", "text": "the baby", "unit": "words", "slots": ["source-1"]}, "select": {"min_length": 1, "max_length": 8, "min_seconds": 0.05, "max_seconds": 4.0},
          "arrange": {"order": "text", "join": "cut", "crossfade_ms": 0}, "effects": {"padding": {"lead_ms": 60, "trail_ms": 60}}, "render": {"preset": "720p30", "crf": 28}}
STUB_MAIN = '''import sys, json
from pathlib import Path
a = sys.argv
cmd = a[1]
work = Path(a[a.index("--work-dir") + 1]); out = Path(a[a.index("--out") + 1])
clips = [{"n": 1, "words": "the baby", "file_name": "show.mp4", "slot": "source-1", "start_ms": 0, "end_ms": 600, "duration_ms": 600}]
if cmd == "plan":
    work.mkdir(parents=True, exist_ok=True)
    print(json.dumps({"ok": True, "gaps": [], "clips": clips, "seconds_estimate": 0.6, "would_write": out.name, "model": "base", "network_attempts": 0}))
    sys.exit(0)
out.parent.mkdir(parents=True, exist_ok=True)
out.write_bytes(b"\\x00\\x00\\x00\\x18ftypmp42" + bytes(range(256)) * 20)
out.with_suffix(".receipt.json").write_text(json.dumps({"schema": "ryagram.local-receipt/0", "film": out.name, "seconds": 0.6, "clips": clips, "network_attempts": 0}))
print("built", out.name)
'''
FAILED = []


def check(c, what):
    print(("  ok   " if c else "  FAIL ") + what)
    if not c:
        FAILED.append(what)


class Clock:
    def __init__(self):
        self.t = 1_800_000_000.0

    def __call__(self):
        return self.t


def call(base, path, body=None, tok="tok"):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(base + path, data=data, headers={"X-Maker-Token": tok, "Content-Type": "application/json"} if tok else {})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read() or b"{}")
        except ValueError:
            return e.code, {}


tmp = Path(tempfile.mkdtemp(prefix="stays-local-", dir=str(BASE) if BASE else None))
clock = Clock()
site = fake.FakeSite(clock=clock)
try:
    shutil.copytree(ENGINE / "ryagram", tmp / "engine" / "ryagram", ignore=shutil.ignore_patterns("__pycache__"))
    (tmp / "engine" / "ryagram" / "local" / "__main__.py").write_text(STUB_MAIN, encoding="utf8")
    (tmp / "recipes").mkdir()
    (tmp / "recipes" / "any-words.json").write_text(json.dumps(RECIPE), encoding="utf8")
    clips = tmp / "Sam Videos"
    clips.mkdir()
    (clips / "show.mp4").write_bytes(b"not really a video")
    dm.faster_whisper_missing = lambda: False

    print("A. a real sign-in, a plan and a build")
    root = site.start()
    srv = dm.make_server(tmp / "engine", tmp / "recipes", tmp / "work", tmp / "films", port=0, token="tok", activity=True, site=root, signin_store=si.MemoryStore(), signin_clock=clock, approval_hosts=())
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{dm.STATE['port']}"
    st, r = call(base, "/api/signin-start", {})
    code = r.get("user_code")
    check(st == 200 and code, "sign-in started on the stand-in site")
    site.approve(code, "sam@example.test")
    for _ in range(40):
        clock.t += 30
        st, r = call(base, "/api/signin-poll", {})
        if r.get("state") == "signed_in":
            break
        time.sleep(0.1)
    check(r.get("state") == "signed_in", "signed in as sam@example.test")
    sl = {"recipe": "any-words.json", "model": "base", "phrase": "the baby"}
    binds = {"source-1": [str(clips / "show.mp4")]}
    call(base, "/api/check", {**sl, "binds": binds})
    call(base, "/api/plan", {**sl, "binds": binds})
    for _ in range(100):
        j = call(base, "/api/job")[1]
        if j.get("state") in ("planned", "gaps", "stopped"):
            break
        time.sleep(0.15)
    check(j.get("state") == "planned", f"planned ({j.get('state')})")
    call(base, "/api/build", {**sl, "binds": binds})
    for _ in range(100):
        j = call(base, "/api/job")[1]
        if j.get("state") in ("built", "stopped"):
            break
        time.sleep(0.15)
    check(j.get("state") == "built", f"built ({j.get('state')})")
    call(base, "/api/ai-requests")                                                                  # the read-only card, if it is asked for

    print("B. the stand-in site saw nothing that could carry a film")
    paths = {p for _m, p, _b in site.seen}
    allowed = {"/node/device/code", "/node/device/token", "/node/account", "/node/node/compilation-requests"}          # (the stand-in's base address ends in /node, and the app's routes begin with /node as well)
    check(paths <= allowed, f"every path asked is a sign-in, account or read-only request: {sorted(paths)}")
    check(not any("/compilation/" in p or "/artifact" in p or "/claim" in p or "/state" in p or "/heartbeat" in p for _m, p, _b in site.seen), "no compilation start/finish, artifact, claim, state or heartbeat request")
    check([p for _m, p, _b in site.seen if "compilation" in p] == ["/node/node/compilation-requests"], "the only compilation-named route asked is the read-only list of what the person's AI asked for")

    print("C. the film is in the person's own folder, and the private link is off")
    films = sorted((tmp / "films").glob("*.mp4"))
    receipts = sorted((tmp / "films").glob("*.receipt.json"))
    check(len(films) == 1 and len(receipts) == 1 and json.loads(receipts[0].read_text())["network_attempts"] == 0, "one finished film and its receipt are in the films folder; the receipt says network_attempts 0")
    check(call(base, "/api/links")[1] == {"on": False}, "the private-link card is OFF by default (no flag file in the app folder)")
    st, r = call(base, "/api/links-upload", {"title": "x", "rights": True})
    check(st >= 400 and not any("/compilation/" in p for _m, p, _b in site.seen), f"MUST-FAIL guard: an upload is refused while it is off ({st}) and nothing was sent")
finally:
    try:
        srv.shutdown()
    except Exception:  # noqa: BLE001
        pass
    site.stop()
    shutil.rmtree(tmp, ignore_errors=True)

print("D. in the code, only two modules can send a file")
sending = {}
for p in sorted((ROOT / "tools").glob("*.py")):
    if p.name.startswith("check-") or p.name in ("fake_ryagram_site.py",):
        continue
    text = p.read_text(encoding="utf-8")
    code = re.sub(r"#.*", "", text)
    if re.search(r"\bput_file\(|\buploader\b|\bstart_upload\(|\bsignUpload\b", code):
        sending[p.name] = True
check(set(sending) <= {"ryagram_node.py", "ryagram_links.py", "desktop_maker.py"}, f"files that name an uploader: {sorted(sending)}")
dmsrc = (ROOT / "tools" / "desktop_maker.py").read_text(encoding="utf-8")
uses = [m.start() for m in re.finditer(r"start_upload\(|put_file\(|uploader\b", dmsrc)]
check(all("links_upload" in dmsrc[max(0, u - 700):u] or "def links_upload" in dmsrc[max(0, u - 700):u] or "NodeLoop" in dmsrc[max(0, u - 700):u] for u in uses), "in desktop_maker.py the only mentions of an upload are the private-link route and the node loop's wiring")
for name in ("maker_song.py", "maker_edit.py"):
    t = re.sub(r"#.*", "", (ROOT / "tools" / name).read_text(encoding="utf-8"))
    check(not re.search(r"put_file|start_upload|uploader|signUpload|signin\.api|urllib\.request|http\.client|socket", t), f"{name} (the song and edit paths) names no uploader and makes no web call of its own")
t = re.sub(r"#.*", "", (ROOT / "tools" / "ryagram_requests.py").read_text(encoding="utf-8"))
check(not re.search(r"put_file|start_upload|uploader|signUpload|urllib|http\.client|socket", t) and len(re.findall(r"signin\.api", t)) == 1, "ryagram_requests.py names no uploader and makes exactly one call, through the signed-in computer's own client (the read)")

print()
if FAILED:
    print(f"FAILED: {len(FAILED)}")
    for f in FAILED:
        print("  -", f)
    sys.exit(1)
print("all passed")
