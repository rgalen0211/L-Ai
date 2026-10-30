"""What your AI asked for (NEXT-CONNECT 131b): tools/ryagram_requests.py and its card in the desktop maker, against a stand-in for the site (no network, no browser, no real file). Every refusal has a
case that FAILS if the check is removed.

    python tools/check-ai-requests.py <the Ryagram folder that has ryagram/local: a kit folder or a checkout> [<scratch base folder on D:>]
"""
import importlib.util
import json
import re
import shutil
import sys
import tempfile
import threading
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
if len(sys.argv) < 2:
    sys.exit("Give the Ryagram folder (the one that holds ryagram/local).")
ENGINE = Path(sys.argv[1])
BASE = Path(sys.argv[2]) if len(sys.argv) > 2 else None
import ryagram_requests as RQ  # noqa: E402
import fake_ryagram_site as fake  # noqa: E402
import ryagram_signin as si  # noqa: E402

FAILED = []


def check(c, what):
    print(("  ok   " if c else "  FAIL ") + what)
    if not c:
        FAILED.append(what)


class FakeSignin:
    def __init__(self, signed_in=True):
        self.state = "signed_in" if signed_in else "signed_out"
        self.calls = []
        self.reply = (200, {"requests": []})
        self.raises = None

    def status(self):
        return {"state": self.state}

    def api(self, method, path, body=None):
        self.calls.append((method, path, body))
        if self.raises:
            raise self.raises
        return self.reply


class Clock:
    def __init__(self):
        self.t = 1_800_000_000.0

    def __call__(self):
        return self.t


ROW = lambda phrase="great news", **kw: {"project_id": "p1", "title": "My film", "request": {"schema": "ryagram.compilation-request/0", "phrase": phrase, "search": "every", "mode": "phrase", "note": "short ones first", **kw},
                                         "sha256": "a" * 64, "updated_at": "2026-10-26T10:00:00Z"}

print("A. the module on its own")
s, clock = FakeSignin(), Clock()
rq = RQ.AiRequests(s, clock=clock)
s.reply = (200, {"requests": [ROW(), ROW("good news", mode="song")]})
st = rq.status()
check(st["on"] and [r["phrase"] for r in st["requests"]] == ["great news", "good news"] and st["requests"][1]["mode"] == "song" and st["message"] == "", "it shows the requests the site returned")
check(s.calls == [("POST", "/node/compilation-requests", {})], "the ONE call it makes is the read: POST /node/compilation-requests, an empty body")
rq.status(); rq.status()
check(len(s.calls) == 1, "the site is asked at most every 30 seconds however often the page asks")
clock.t += 31
rq.status()
check(len(s.calls) == 2, "and again after 30 seconds")
rq.status(force=True)
check(len(s.calls) == 3, "or when forced")

so = FakeSignin(signed_in=False)
rq2 = RQ.AiRequests(so, clock=clock)
check(rq2.status() == {"on": False} and so.calls == [], "signed out: no card and the site is never asked")
check(RQ.AiRequests(FakeSignin(), clock=clock).status(force=True)["on"] is True, "control: signed in, it is on")

print("B. hostile or odd content is cut down to plain text")
s.reply = (200, {"requests": [ROW("<img src=x onerror=alert(1)>hello"), ROW("a" * 900), ROW("ok", note="see C:\\Users\\Sam\\Videos\\x.mp4"), ROW("ok2", note="https://evil.example/x"), ROW("ok3", mode="weird", search="weird"),
                              ROW("  "), "not a row", {"request": "nope"}, {"title": "no request"}, ROW("x" * 10, note="line\x00one\x1ftwo")]})
rq3 = RQ.AiRequests(s, clock=clock)
got = rq3.status(force=True)["requests"]
check(all("<" not in r["phrase"] and ">" not in r["phrase"] for r in got), "angle brackets are removed (nothing a page could treat as markup)")
check(any(len(r["phrase"]) == 300 for r in got) and all(len(r["phrase"]) <= 300 and len(r["note"]) <= 500 for r in got), "a long phrase is cut to 300 letters")
check([r["note"] for r in got if r["phrase"] in ("ok", "ok2")] == ["", ""], "MUST-FAIL guard: a note that carries a path or an address is dropped (no place on a computer or the internet reaches the page)")
check([ (r["mode"], r["search"]) for r in got if r["phrase"] == "ok3"] == [("phrase", "every")], "an unknown mode or search falls back to the plain one")
check(len(got) == 6 and all(set(r) == {"title", "phrase", "mode", "search", "note", "updated_at", "project_id"} for r in got), "rows that are not objects, have no phrase, or are blank are dropped; each row has only seven plain fields (the project id only if it is an id)")
check(not any("\x00" in r["note"] or "\x1f" in r["note"] for r in got), "control characters become spaces")
s.reply = (200, {"requests": [ROW(f"p{i}") for i in range(40)]})
check(len(RQ.AiRequests(s, clock=clock).status(force=True)["requests"]) == 20, "at most 20")

print("C. failures say so in words and keep what the card had")
s.reply = (200, {"requests": [ROW("kept")]})
rq4 = RQ.AiRequests(s, clock=clock)
rq4.status(force=True)
s.raises = si.SignInError("This computer was removed from your account, so it is signed out here.", "removed")
st = rq4.status(force=True)
check(st["on"] and [r["phrase"] for r in st["requests"]] == ["kept"] and "removed from your account" in st["message"], "a removed computer: the message is shown, the earlier list is kept, nothing crashes")
s.raises = None
for bad in ((500, {}), (200, {}), (200, {"requests": "x"}), (404, {"error": "not_found"})):
    s.reply = bad
    st = rq4.status(force=True)
    check(st["on"] and "Could not read" in st["message"], f"a bad answer {bad[0]} {list(bad[1])[:1]}: a plain sentence, not a crash")

print("D. it starts nothing and uploads nothing (Ryan: finished compilations stay on the person's own PC)")
src = (ROOT / "tools" / "ryagram_requests.py").read_text(encoding="utf-8")
code = "\n".join(l for l in src.splitlines() if l.lstrip().startswith(("import ", "from ")))
check(set(re.findall(r"^(?:import|from) (\w+)", code, flags=re.M)) <= {"__future__", "re", "threading", "time", "maker_checklist"}, "it imports only re, threading, time and the local-only checklist helper (no network module, no file or process module)")
body_lines = re.sub(r"#.*", "", src.split('"""', 2)[2]).splitlines()          # the code, without the docstring and the comments
check(len(re.findall(r"\.api\(", src)) == 1 and src.count('ROUTE = "/node/compilation-requests"') == 1, "exactly one call to the site, to the one read route")
check(not re.search(r"\b(open|write_text|write_bytes|put_file|upload|signUpload|subprocess|os\.)\b", "\n".join(body_lines)), "it opens no file, writes none, and names no upload or process")

print("E. the card in the desktop maker")
spec = importlib.util.spec_from_file_location("desktop_maker", ROOT / "tools" / "desktop_maker.py")
dm = importlib.util.module_from_spec(spec)
sys.modules["desktop_maker"] = dm
spec.loader.exec_module(dm)
tmp = Path(tempfile.mkdtemp(prefix="airq-", dir=str(BASE) if BASE else None))
site = fake.FakeSite()
try:
    shutil.copytree(ENGINE / "ryagram", tmp / "engine" / "ryagram", ignore=shutil.ignore_patterns("__pycache__"))
    (tmp / "recipes").mkdir()
    (tmp / "recipes" / "any-words.json").write_text(json.dumps({"schema": "ryagram.recipe/0", "name": "any words", "slots": [{"id": "source-1", "label": "Your footage", "accepts": "video", "multiple": True}],
                                                              "find": {"op": "words", "text": "the baby", "unit": "words", "slots": ["source-1"]}, "select": {"min_length": 1, "max_length": 8, "min_seconds": 0.05, "max_seconds": 4.0},
                                                              "arrange": {"order": "text", "join": "cut", "crossfade_ms": 0}, "effects": {"padding": {"lead_ms": 60, "trail_ms": 60}}, "render": {"preset": "720p30", "crf": 28}}), encoding="utf8")
    base = site.start()
    srv = dm.make_server(tmp / "engine", tmp / "recipes", tmp / "work", tmp / "films", port=0, token="tok", activity=True, site=base, signin_store=si.MemoryStore(), approval_hosts=())
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    url = f"http://127.0.0.1:{dm.STATE['port']}"

    def get(path, token="tok"):
        req = urllib.request.Request(url + path, headers={"X-Maker-Token": token} if token else {})
        try:
            with urllib.request.urlopen(req, timeout=10) as r:
                return r.status, json.loads(r.read() or b"{}"), r.read()
        except urllib.error.HTTPError as e:
            return e.code, {}, b""
    check(get("/api/ai-requests", None)[0] in (401, 403), "the page's call needs the maker's own token")
    st, obj, _ = get("/api/ai-requests")
    check(st == 200 and obj == {"on": False}, "signed out: the card is off")
    check("ai-requests" in dm.ENDPOINTS, "the endpoint is a known one for the activity log's fixed vocabulary")
    page = urllib.request.urlopen(urllib.request.Request(url + "/?t=tok"), timeout=10).read().decode("utf-8")
    check('id="airq"' in page and re.search(r'id="airq"[^>]*hidden', page) is not None, "the page has the card, hidden until there is something to show")
    check("What your AI asked for" in page and "nothing was started and nothing was sent" in page, "its words say what it is: notes only, nothing started or sent")
    js = urllib.request.urlopen(urllib.request.Request(url + "/maker.js", headers={"X-Maker-Token": "tok"}), timeout=10).read().decode("utf-8")
    drawn = js[js.index("function drawRequests"):js.index("async function refreshRequests")]
    check("replaceChildren" in drawn and "airq-list" in drawn and "innerHTML" not in drawn and "textContent" in drawn, "the card is drawn with text (replaceChildren, textContent), never as markup")
finally:
    try:
        srv.shutdown()
    except Exception:  # noqa: BLE001
        pass
    site.stop()
    shutil.rmtree(tmp, ignore_errors=True)

print()
if FAILED:
    print(f"FAILED: {len(FAILED)}")
    for f in FAILED:
        print("  -", f)
    sys.exit(1)
print("all passed")
