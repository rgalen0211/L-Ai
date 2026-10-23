"""The app side of PRIVATE LINKS for a finished film (NEXT-CONNECT 120): tools/ryagram_links.py against a stand-in for the site (no network, no browser, no real file leaves the temp folder).
Every refusal has a case that FAILS if the check is removed (broken-on-purpose runs: tools/check-private-links-mutants.py).

    python tools/check-private-links.py
"""
import hashlib
import json
import sys
import tempfile
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import ryagram_links as RL  # noqa: E402
import ryagram_node as RN  # noqa: E402

FAILS = []
MB = 1048576


def check(c, what):
    print(("  ok   " if c else "  FAIL ") + what, flush=True)
    if not c:
        FAILS.append(what)


class SignErr(Exception):
    def __init__(self, msg, kind):
        super().__init__(msg)
        self.kind = kind


class FakeSignin:
    """Stands in for ryagram_signin.SignIn: status(), api(), host. `routes` maps a path to (status, body) or a callable; `offline` makes every call fail like a dropped connection."""
    host = "site.test"

    def __init__(self):
        self.signed_in = True
        self.offline = False
        self.removed = False
        self.calls = []
        self.routes = {}

    def status(self):
        return {"state": "signed_in" if self.signed_in else "signed_out"}

    def api(self, method, path, body=None):
        self.calls.append((method, path, body))
        if self.removed:
            raise SignErr("This computer was removed from your account, so it is signed out here.", "removed")
        if self.offline:
            raise SignErr("I could not reach the Ryagram site.", "offline")
        r = self.routes.get(path)
        return r(body) if callable(r) else (r or (404, {}))


STATUS_OK = {"switch_on": True, "plan": "sub_creator", "active": True, "allowed": True, "max_film_bytes": 150 * MB, "max_kept_bytes": 600 * MB, "starts_per_hour": 5, "kept_bytes": 0, "secret_extra": "x"}


def world(on=True, now=None):
    tmp = Path(tempfile.mkdtemp(prefix="plinks_", dir="D:/Ryagram-scratch/CONNECT"))
    work, films = tmp / "work", tmp / "films"
    work.mkdir()
    films.mkdir()
    if on:
        (work / RL.SWITCH_NAME).write_text(json.dumps({"on": True}), encoding="utf-8")
    si = FakeSignin()
    si.routes["/node/compilation/status"] = (200, {"status": dict(STATUS_OK)})
    sent = []
    clock = [now or time.time()]
    links = RL.PrivateLinks(si, work, films_dir=films, uploader=lambda url, path, ctype, hosts: sent.append((url, path.name, ctype, hosts)), clock=lambda: clock[0], log=lambda ev: sent.append(("log", ev)))
    return tmp, work, films, si, links, sent, clock


def film(films, name="edit-1.mp4", size=2048):
    p = films / name
    p.write_bytes(b"\x00" * size)
    return p


def raises(fn, kind=None):
    try:
        fn()
    except RL.LinksError as e:
        return (kind is None or e.kind == kind) and str(e)
    return False


def good_routes(si, expires="2026-11-22"):
    si.routes["/node/compilation/start"] = lambda b: (200, {"id": "11111111-2222-4333-8444-555555555555", "path": "p", "upload_url": "https://site.test/storage/upload/x?token=t"})
    si.routes["/node/compilation/finish"] = lambda b: (200, {"id": b["id"], "expires_at": expires + "T00:00:00Z"})
    si.routes["/node/compilation/cancel"] = lambda b: (200, {"cancelled": True})


print("1. OFF by default: no flag file, no button, no call")
tmp, work, films, si, links, sent, clock = world(on=False)
film(films)
check(links.status() == {"on": False} and si.calls == [], "without the flag file the card is off and the site is never asked")
check(raises(lambda: links.upload("edit-1.mp4", "T", True), "off") and not sent and si.calls == [], "MUST-FAIL: an upload is refused when the flag is off (nothing asked, nothing sent)")
check(raises(lambda: links.start_upload("edit-1.mp4", "T", True), "off"), "and the page's call too")
(work / RL.SWITCH_NAME).write_text("{ not json", encoding="utf-8")
check(links.on is False, "a broken flag file is OFF, not on")
(work / RL.SWITCH_NAME).write_text(json.dumps({"on": "yes"}), encoding="utf-8")
check(links.on is False, 'only the value true turns it on ("yes" is not)')

print("\n2. the launch check")
tmp, work, films, si, links, sent, clock = world()
film(films)
si.signed_in = False
st = links.status("edit-1.mp4")
check(st["on"] and not st["allowed"] and "Sign in" in st["reason"] and si.calls == [], "signed out: the button is locked with one plain line, and the site is not asked")
si.signed_in = True
st = links.status("edit-1.mp4")
check(st["allowed"] and st["plan"] == "sub_creator" and st["max_film"] == "150 MB" and st["film"] == "edit-1.mp4", "signed in with an allowing plan: the button is available and shows the plan's film limit")
try:
    cache = json.loads((work / RL.CACHE_NAME).read_text(encoding="utf-8"))
except OSError:
    cache = {"status": {}}
check("secret_extra" not in json.dumps(cache) and set(cache["status"]) == {"switch_on", "plan", "active", "allowed", "max_film_bytes", "max_kept_bytes", "starts_per_hour", "kept_bytes"}, "the kept answer holds only the fields it knows (anything else the site sent is dropped)")
for patch, word in (({"switch_on": False, "allowed": False}, "not switched on"), ({"active": False, "plan": None, "allowed": False}, "part of a Ryagram plan"), ({"allowed": False}, "does not include")):
    si.routes["/node/compilation/status"] = (200, {"status": {**STATUS_OK, **patch}})
    st = links.status("edit-1.mp4")
    check(not st["allowed"] and word in st["reason"], f"the site says no ({word}): locked with that sentence")
    check(raises(lambda: links.upload("edit-1.mp4", "T", True), "not_allowed") and not sent and not any(c[1].endswith("/start") for c in si.calls), "  and an upload is refused before anything is sent or started")
si.routes["/node/compilation/status"] = (404, {})
check("not available" in links.status("edit-1.mp4")["reason"], "the routes do not exist yet (404): 'not available yet'")
si.routes["/node/compilation/status"] = (500, {})
check(not links.status("edit-1.mp4")["allowed"], "a server error locks it")
si.routes["/node/compilation/status"] = (200, {"status": {"allowed": "yes", "max_film_bytes": -5, "plan": "../../x"}})
s = links.check()
check(not s["allowed"] and s["status"]["max_film_bytes"] is None and s["status"]["plan"] is None, "MUST-FAIL: odd values from the site are not believed (allowed must be exactly true; a negative size and a path-like plan are dropped)")
si.removed = True
check("removed from your account" in links.status("edit-1.mp4")["reason"], "a computer removed on the website: its own sentence")
si.removed = False

print("\n3. offline: the last answer is good for 7 days, then the button locks")
tmp, work, films, si, links, sent, clock = world()
film(films)
links.status("edit-1.mp4")                                # a live check writes the answer
si.offline = True
clock[0] += 2 * 86400
st = links.status("edit-1.mp4")
check(st["allowed"] and st["offline"] and st["days_old"] == 2, "2 days offline: still shown, and it says the answer is 2 days old")
check(raises(lambda: links.upload("edit-1.mp4", "T", True), "offline") and not sent and not any(c[1].endswith("/start") for c in si.calls), "MUST-FAIL: but an UPLOAD needs the internet and a live check: refused before any start call, nothing sent")
clock[0] += 6 * 86400
st = links.status("edit-1.mp4")
check(not st["allowed"] and "7 days" in st["reason"], "8 days since the check: locked, with the 7-day sentence")
tmp, work, films, si, links, sent, clock = world()
si.offline = True
check(not links.status()["allowed"] and "7 days" in links.status()["reason"], "never checked and offline: locked")
cached_no = {"fetched_at": clock[0], "status": {**STATUS_OK, "allowed": False, "active": False, "plan": None}}
(work / RL.CACHE_NAME).write_text(json.dumps(cached_no), encoding="utf-8")
check(not links.status()["allowed"] and "part of a Ryagram plan" in links.status()["reason"], "an offline answer that said 'no plan' stays a no")
(work / RL.CACHE_NAME).write_text(json.dumps({"fetched_at": clock[0] + 99999, "status": STATUS_OK}), encoding="utf-8")
check(not links.status()["allowed"], "MUST-FAIL: a kept answer dated in the future is not believed")

print("\n4. the upload")
tmp, work, films, si, links, sent, clock = world()
f = film(films, "edit-1.mp4", 3000)
good_routes(si)
e = links.upload("edit-1.mp4", "  My   great news  ", True)
start = [c for c in si.calls if c[1] == "/node/compilation/start"][0]
check(start[2] == {"title": "My great news", "bytes": 3000, "sha256": hashlib.sha256(f.read_bytes()).hexdigest(), "rights": True}, "start gets exactly the title (spaces tidied), size, SHA-256 and rights = true, and nothing else (no path, no name)")
check(sent[0] == ("https://site.test/storage/upload/x?token=t", "edit-1.mp4", "video/mp4", {"site.test"}) and sent[0][3] == {"site.test"}, "the file is sent to the signed address, checked against the site's own host, as video/mp4")
check([c[1] for c in si.calls if "compilation" in c[1] and c[1] != "/node/compilation/status"] == ["/node/compilation/start", "/node/compilation/finish"], "start then finish, no cancel")
check(e["expires_at"] == "2026-11-22" and links.links() == [e] and tmp.name not in json.dumps(links.links()), "the local list holds the title, the name, the size and the date: no path")
check(links.status("edit-1.mp4")["upload"]["phase"] == "done" and "2026-11-22" in links.status("edit-1.mp4")["upload"]["message"], "the page is told it is done, and until when")
check(tmp.name not in json.dumps(links.status("edit-1.mp4")), "the page is never sent a place on this computer")

print("\n5. refused before anything is sent")
tmp, work, films, si, links, sent, clock = world()
film(films, "edit-1.mp4", 3000)
film(films, ".edit-2.mp4", 3000)
(films / "sub").mkdir()
film(films / "sub", "edit-3.mp4", 3000)
good_routes(si)
n_before = len(si.calls)
for what, args, kind in (("the rights tick missing", ("edit-1.mp4", "T", None), "rights"), ("the rights tick as text", ("edit-1.mp4", "T", "true"), "rights"), ("the rights tick as 1", ("edit-1.mp4", "T", 1), "rights"),
                         ("a blank title", ("edit-1.mp4", "   ", True), "title"), ("a title over 200", ("edit-1.mp4", "x" * 201, True), "title"),
                         ("a path as the film", ("../edit-1.mp4", "T", True), "film"), ("a drive path", ("C:\\x\\edit-1.mp4", "T", True), "film"), ("a film inside a sub-folder that exists", ("sub/edit-3.mp4", "T", True), "film"), ("a film inside a sub-folder, with backslashes", ("sub\\edit-3.mp4", "T", True), "film"),
                         ("not an mp4", ("edit-1.mov", "T", True), "film"), ("a hidden film that exists", (".edit-2.mp4", "T", True), "film"), ("a film that is not there", ("ghost.mp4", "T", True), "film")):
    check(raises(lambda: links.upload(*args), kind), f"MUST-FAIL: {what}")
(films / "empty.mp4").write_bytes(b"")
check(raises(lambda: links.upload("empty.mp4", "T", True), "film"), "MUST-FAIL: an empty film")
(films / "dir.mp4").mkdir()
check(raises(lambda: links.upload("dir.mp4", "T", True), "film"), "MUST-FAIL: a folder named like a film")
outside = tmp / "outside.mp4"
outside.write_bytes(b"x" * 100)
try:
    (films / "link.mp4").symlink_to(outside)
    check(raises(lambda: links.upload("link.mp4", "T", True), "film"), "MUST-FAIL: a link to a file outside the films folder")
except OSError:
    print("  (this account cannot make a real symbolic link here, so the link rule is tried by telling the program that one file IS a link)")
    import unittest.mock
    film(films, "link.mp4", 100)
    with unittest.mock.patch.object(Path, "is_symlink", lambda self: self.name == "link.mp4"):
        check(raises(lambda: links.upload("link.mp4", "T", True), "film"), "MUST-FAIL: a file that is a link is refused (simulated: the real call is_symlink() said yes)")
check(not sent and not any(c[1].endswith("/start") for c in si.calls[n_before:]), "none of these started an upload or sent a byte")
big = film(films, "big.mp4", 151 * 1024)                 # the plan stand-in allows 150 MB: shrink the limit instead of writing 150 MB
si.routes["/node/compilation/status"] = (200, {"status": {**STATUS_OK, "max_film_bytes": 100 * 1024}})
msg = raises(lambda: links.upload("big.mp4", "T", True), "too_large")
check(msg and "100 KB" not in msg and "allows" in msg and not sent, "MUST-FAIL: a film over the plan's limit is refused with the limit named, before the start call")

print("\n6. when it goes wrong after the start, the site is told and nothing is kept")
tmp, work, films, si, links, sent, clock = world()
film(films, "edit-1.mp4", 3000)
good_routes(si)
def boom(url, path, ctype, hosts):
    raise RN.NodeError("The site would not take the file.", "upload_refused")
links.uploader = boom
m = raises(lambda: links.upload("edit-1.mp4", "T", True))
cancels = [c for c in si.calls if c[1] == "/node/compilation/cancel"]
check(m and "would not take" in m and len(cancels) == 1 and cancels[0][2] == {"id": "11111111-2222-4333-8444-555555555555"} and links.links() == [], "an upload that fails is cancelled on the site, the person is told, and nothing is listed")
links.uploader = lambda *a: None
si.routes["/node/compilation/finish"] = (409, {"error": "size_mismatch", "message": "The upload did not arrive whole. Cancel it and start again."})
m = raises(lambda: links.upload("edit-1.mp4", "T", True))
check(m and "did not arrive whole" in m and len([c for c in si.calls if c[1] == "/node/compilation/cancel"]) == 2 and links.links() == [], "a finish the site refuses is cancelled too, and the site's own plain sentence is shown")
good_routes(si)
si.routes["/node/compilation/start"] = (403, {"error": "plan_required", "message": "Private links are part of a Ryagram plan. Choose a plan on the website, then try again."})
n = len([c for c in si.calls if c[1] == "/node/compilation/cancel"])
m = raises(lambda: links.upload("edit-1.mp4", "T", True))
check(m and "part of a Ryagram plan" in m and len([c for c in si.calls if c[1] == "/node/compilation/cancel"]) == n, "a start the site refuses shows its sentence and cancels nothing (nothing was started)")
good_routes(si)
si.routes["/node/compilation/start"] = lambda b: (200, {"id": "11111111-2222-4333-8444-555555555555", "path": "p", "upload_url": "https://evil.example/steal?x=1"})
links.uploader = RN.put_file                                     # the REAL uploader: it must refuse an address that is not the site's
m = raises(lambda: links.upload("edit-1.mp4", "T", True))
check(m and "do not trust" in m and links.links() == [] and any(c[1] == "/node/compilation/cancel" for c in si.calls), "MUST-FAIL: a signed address on another host is never used (the real uploader refuses it, in its own words), and the start is cancelled")

print("\n7. the page's call runs in the background, one at a time")
tmp, work, films, si, links, sent, clock = world()
film(films, "edit-1.mp4", 3000)
good_routes(si)
import threading
gate = threading.Event()
links.uploader = lambda url, path, ctype, hosts: gate.wait(5)
st = links.start_upload("edit-1.mp4", "T", True)
check(st["on"] and st["upload"]["phase"] in ("checking", "hashing", "sending", "finishing"), "start_upload returns at once and the card shows it is working")
check(raises(lambda: links.start_upload("edit-1.mp4", "T", True), "busy"), "MUST-FAIL: a second film while one is being sent is refused")
gate.set()
links._thread.join(10)
check(links.status("edit-1.mp4")["upload"]["phase"] == "done" and len(links.links()) == 1, "and it finishes in the background")
links.uploader = boom
links.start_upload("edit-1.mp4", "T", True)
links._thread.join(10)
check(links.status("edit-1.mp4")["upload"]["phase"] == "failed" and "would not take" in links.status("edit-1.mp4")["upload"]["message"], "a failure in the background is shown on the card in plain words")
check(raises(lambda: links.start_upload("edit-1.mp4", "T", False), "rights") and raises(lambda: links.start_upload("nope.mp4", "T", True), "film"), "and a mistake is refused at once, not in the background")

print()
if FAILS:
    print("FAILED:\n" + "\n".join("  - " + f for f in FAILS))
    sys.exit(1)
print("ALL PASS")
