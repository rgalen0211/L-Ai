"""The desktop app's sign-in CLIENT against a FAKE site (NEXT-CONNECT 98, r9 M1). No browser, no engine, no real site, no account, no network beyond 127.0.0.1.

    python tools/check-signin-client.py [<scratch base folder>]

What it proves (CC1 13:20 and 13:34 are the source of the must-fails)
  A  the happy path by device code: a code on screen, the person approves on the "website", the app is signed in; no password anywhere
  B  the token lives ONLY in the credential store: a scan of the account cache, the status the page sees, every URL the site saw and the events logged finds neither the token nor the device secret
  C  a hostile or broken site reply is refused with nothing stored: a bad user code (0 O 1 I L), a short device secret, an approval address on a host we were not told about, plain http to a real host,
     a short or odd token, no account; a redirect is not followed
  D  the clock: the client keeps to the polling interval itself, a slow_down grows it, an expired code is refused, a used code is refused, a denied code stores nothing
  E  removing this computer, with and without the internet; a computer removed on the website is signed out at the next check; the server wins over the cache
  F  the 7-day offline grace pauses ONLY the node and says so; local clip films are never blocked by the account (CC1 14:14); signed out is the r8 behaviour
  G  (only with RYAGRAM_TEST_REAL_STORE=1, because it writes one throwaway entry into the real vault of whoever runs it) the real Windows Credential Manager: a throwaway entry round-trips, is CRED_TYPE_GENERIC and persisted for THIS computer only (never the roaming kind), and is deleted afterwards; there is no file fallback
  H  the fake site itself keeps the server rules CC1 listed (alphabet, 10 minutes, single use, hashed secrets, rate limit, a node token is refused on the connector door), so WORKER and WEB can match it
"""
import ctypes
import json
import os
import secrets
import sys
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import fake_ryagram_site as fake                 # noqa: E402
import ryagram_signin as si                      # noqa: E402

BASE = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(tempfile.mkdtemp(prefix="signin-check-"))
BASE.mkdir(parents=True, exist_ok=True)
FAILS = []


def check(cond, msg):
    print(("  ok   " if cond else "  FAIL ") + msg)
    if not cond:
        FAILS.append(msg)


class Clock:
    def __init__(self, t=1_800_000_000.0):
        self.t = t

    def __call__(self):
        return self.t

    def add(self, s):
        self.t += s


def setup(name, **kw):
    clock = Clock()
    folder = BASE / name
    if folder.exists():
        import shutil
        shutil.rmtree(folder)
    folder.mkdir(parents=True)
    site = fake.FakeSite(clock=clock)
    url = site.start()
    store = si.MemoryStore()
    events = []
    app = si.SignIn(url, store, folder, clock=clock, computer_name=kw.pop("computer_name", "Sam-PC"), log=events.append, **kw)
    return clock, site, store, app, folder, events


def sign_in(clock, site, app, email="sam@example.test", local=False):
    s = app.begin()
    clock.add(1)
    app.poll()
    clock.add(6)
    assert site.approve(s["user_code"], email, local)
    return app.poll()


def raises(fn, kind=None):
    try:
        fn()
    except si.SignInError as e:
        return (kind is None or e.kind == kind), str(e)
    return False, ""


# ---------------------------------------------------------------------------------------------------------------- A, B
print("A. the happy path, by device code")
clock, site, store, app, folder, events = setup("a")
st = app.status()
check(st["state"] == "signed_out" and st["enabled"], "before anything, the app is signed out and says so")
s = app.begin()
check(s["state"] == "waiting" and si.USER_CODE_RE.match(s["user_code"]), f"Sign in shows a code of the right shape on screen ({s['user_code']})")
check(s["open_url"].startswith(site.root_url) and "/app/#/device" in s["open_url"], "and the address of the approval page, on the host we were told to trust")
check(s["seconds_left"] == 600, "the code is good for 10 minutes")
n0 = len(site.seen)
w = app.poll()
check(w["state"] == "waiting", "polled before the person approves: still waiting")
clock.add(6)
app.poll()
check(app.status()["state"] == "waiting", "after the interval it asks the site and the answer is 'not yet'")
user_code = s["user_code"]
check(site.approve(user_code, "sam@example.test", False), "the person approves the code on the website (the fake's Approve)")
clock.add(6)
done = app.poll()
check(done["state"] == "signed_in" and done["email"] == "sam@example.test" and done["computer_name"] == "Sam-PC", f"the next poll signs in: {done.get('email')}, computer {done.get('computer_name')}")
check(store.read(app.target) in site.issued_tokens and app.target == "Ryagram/node/" + app.host, "the token is in the credential store under Ryagram/node/<site>")
check(done["approved_until"] and done["clip_films"] is True and done["node_allowed"] is False, "approved-until date shown; clip films allowed; this account does not render site films here")
check(done["days_since_check"] == 0, "the page is told how many days since the last check (0 just now), so it can say 'today' instead of a computer date")
check(events == ["signin_started", "signin_done"], f"the log events are fixed words only {events}")

print("\nB. the token is kept in ONE place")
tok, dev = site.issued_tokens[0], site.issued_device_codes[0]
blob = json.dumps(app.status()) + json.dumps(done) + json.dumps(s) + " ".join(events) + " ".join(p for _m, p, _b in site.seen)
for f in folder.rglob("*"):
    if f.is_file():
        blob += f.read_text(encoding="utf-8", errors="replace")
check(tok not in blob, "MUST-FAIL: the node token is in no file, no status the page can read, no URL the site saw and no log event")
check(dev not in blob, "MUST-FAIL: the device secret is in none of them either (it lives in memory until approval, then is dropped)")
check(not any("code=" in p and dev in p for _m, p, _b in site.seen), "no secret travelled in a query string")
check(app._wait is None, "after approval the device secret is dropped from memory")
cache = json.loads((folder / si.CACHE_NAME).read_text(encoding="utf-8"))
check(set(cache) <= {"schema", "site_host", "email", "computer_name", "local_compute", "approved_until", "last_ok"}, f"the account cache holds non-secret fields only ({sorted(cache)})")
check(all(site.tokens[h].get("revoked") is False for h in site.tokens) and tok not in json.dumps(site.tokens) and dev not in json.dumps(site.codes),
      "the fake 'server' keeps only sha256 of the token and of the device secret")
ok, msg = raises(lambda: app.begin(), "state")
check(ok, "a second sign-in while signed in is refused in plain words")

# ---------------------------------------------------------------------------------------------------------------- C
print("\nC. a hostile or broken site reply is refused, nothing stored")


class Script:
    """A transport that answers from a list, so each bad reply is exact."""
    def __init__(self, *replies):
        self.replies, self.calls = list(replies), []

    def __call__(self, method, path, body=None, bearer=None):
        self.calls.append((method, path, body, bearer))
        r = self.replies.pop(0)
        if isinstance(r, Exception):
            raise r
        return r


def good_code(**over):
    d = {"device_code": secrets.token_urlsafe(32), "user_code": "ABCD-2345", "verification_uri": "https://uselai.com/app/#/device",
         "verification_uri_complete": "https://uselai.com/app/#/device?code=ABCD-2345", "expires_in": 600, "interval": 5}
    d.update(over)
    return (200, d)


def scripted(*replies, **kw):
    folder = BASE / "c"
    if folder.exists():
        import shutil
        shutil.rmtree(folder)
    folder.mkdir(parents=True)
    store = si.MemoryStore()
    t = Script(*replies)
    kw.setdefault("approval_hosts", ["uselai.com"])
    return si.SignIn("https://abc.supabase.co/functions/v1/node", store, folder, transport=t, clock=Clock(), computer_name="Sam-PC", **kw), store, t, folder


a, st_, t, f = scripted(good_code())
r = a.begin()
check(r["state"] == "waiting" and r["open_url"].startswith("https://uselai.com/"), "a good reply naming the approval host we were told about is accepted (control)")
for label, over in [("a user code with a zero", {"user_code": "ABC0-2345"}), ("a user code with an O", {"user_code": "ABCO-2345"}), ("a user code with a one", {"user_code": "ABC1-2345"}),
                    ("a user code with an I", {"user_code": "ABCI-2345"}), ("a user code with an L", {"user_code": "ABCL-2345"}), ("a user code of 4 characters", {"user_code": "ABCD"}),
                    ("a device secret under 32 characters", {"device_code": "short"}), ("a device secret with odd characters", {"device_code": "x" * 31 + " "}),
                    ("an approval address on a host we were not told about", {"verification_uri": "https://evil.example/app/#/device", "verification_uri_complete": "https://evil.example/x"}),
                    ("an approval address over plain http", {"verification_uri": "http://uselai.com/app/#/device", "verification_uri_complete": "http://uselai.com/x"}),
                    ("an approval address with a password in it", {"verification_uri": "https://a:b@uselai.com/x", "verification_uri_complete": "https://a:b@uselai.com/x"})]:
    a, st_, t, f = scripted(good_code(**over))
    ok, msg = raises(lambda: a.begin(), "bad_reply")
    check(ok and a.status()["state"] == "signed_out" and st_.items == {}, f"MUST-FAIL: {label}: refused, nothing stored")
a, st_, t, f = scripted(good_code(expires_in=10_000_000))
check(a.begin()["seconds_left"] <= si.MAX_CODE_SECONDS, "a code that claims to last for days is cut back to the normal 10 minutes")

for label, reply in [("a token that is too short", (200, {"node_token": "abc", "expires_in": 100000, "account": {"email": "a@b.test"}})),
                     ("a token with odd characters", (200, {"node_token": "x" * 40 + " !", "expires_in": 100000, "account": {"email": "a@b.test"}})),
                     ("no account in the reply", (200, {"node_token": secrets.token_urlsafe(32), "expires_in": 100000}))]:
    a, st_, t, f = scripted(good_code(), reply)
    a.begin()
    a.clock.add(6)
    ok, msg = raises(lambda: a.poll(), "bad_reply")
    check(ok and st_.items == {} and not (f / si.CACHE_NAME).exists(), f"MUST-FAIL: {label}: refused, nothing stored")

a, st_, t, f = scripted((500, {}))
ok, msg = raises(lambda: a.begin(), "refused")
check(ok, "a server error on starting says so in plain words")
a, st_, t, f = scripted((429, {"error": "slow_down"}))
ok, msg = raises(lambda: a.begin(), "rate")
check(ok and "Too many" in msg, "rate limited: 'Too many sign-in tries. Wait a minute and try again.'")
a, st_, t, f = scripted(si.SignInError("I could not reach the Ryagram site. Check this computer's internet connection and try again.", "offline"))
ok, msg = raises(lambda: a.begin(), "offline")
check(ok and "internet" in msg and a.status()["state"] == "signed_out", "offline: a plain sentence, still signed out")
ok, msg = raises(lambda: si.UrlTransport("http://127.0.0.1:1/node")("POST", "/device/code", {}), "offline")
check(ok and "You can still make films from your own videos" in msg, "the unreachable message says what still works")
ok, msg = raises(lambda: si.check_site("http://example.com/node"), "site")
check(ok, "MUST-FAIL: a site address over plain http to a real host is refused")
ok, _ = raises(lambda: si.check_site("https://user:pw@example.com/node"), "site")
check(ok, "MUST-FAIL: a site address with a password in it is refused")
ok, _ = raises(lambda: si.check_site("https://example.com/node?token=1"), "site")
check(ok, "MUST-FAIL: a site address with a query string is refused")
check(si.check_site("https://abc.supabase.co/functions/v1/node/")[0] == "https://abc.supabase.co/functions/v1/node", "a good https address is kept as is, without the trailing slash")
check(si.check_site("http://127.0.0.1:8123/node")[1] == "127.0.0.1:8123", "plain http is allowed for this computer itself (tests only)")


class Redirector(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_POST(self):  # noqa: N802
        self.rfile.read(int(self.headers.get("Content-Length") or 0))
        self.send_response(302)
        self.send_header("Location", "http://127.0.0.1:1/elsewhere")
        self.end_headers()


rsrv = ThreadingHTTPServer(("127.0.0.1", 0), Redirector)
threading.Thread(target=rsrv.serve_forever, daemon=True).start()
rt = si.UrlTransport(f"http://127.0.0.1:{rsrv.server_address[1]}/node")
status, _ = rt("POST", "/device/code", {})
check(status == 302, "MUST-FAIL: a redirect is not followed (the answer is the 302 itself)")
rsrv.shutdown()
rsrv.server_close()
ok, msg = raises(lambda: si.UrlTransport("http://127.0.0.1:1/node")("POST", "/device/code", {}), "offline")
check(ok, "nothing listening: a plain 'could not reach' sentence, not a traceback")

# ---------------------------------------------------------------------------------------------------------------- D
print("\nD. the clock: interval, expiry, single use, denial")
clock, site, store, app, folder, events = setup("d")
s = app.begin()
n_before = len(site.seen)
app.poll()
app.poll()
check(len(site.seen) == n_before + 1 or len(site.seen) == n_before, "the client keeps to the interval itself: two quick polls make at most one request")
clock.add(2)
app.poll()
check(len(site.seen) <= n_before + 1, "MUST-FAIL: polling faster than the interval sends nothing")
clock.add(5)
app.poll()
check(len(site.seen) == n_before + 2, "after the interval it asks again")
# the SITE refuses a faster client too (the fake is the spec for the server)
raw = site.codes[s["user_code"]]
status, r = site._poll({"device_code": site.issued_device_codes[-1]})
status2, r2 = site._poll({"device_code": site.issued_device_codes[-1]})
check(r2 == {"error": "slow_down"} and site.codes[s["user_code"]]["interval"] > 5, "MUST-FAIL (server rule): a client that polls faster than the interval gets slow_down and a longer interval")
before = app._wait["interval"]
clock.add(60)
app.transport = lambda m, p, b=None, bearer=None: (400, {"error": "slow_down"})
app.poll()
check(app._wait["interval"] == before + 5, "the app obeys slow_down: its own interval grows by 5")
app.transport = si.UrlTransport(app.base)

clock, site, store, app, folder, events = setup("d2")
s = app.begin()
clock.add(601)
check(site.approve(s["user_code"]) is False, "MUST-FAIL (server rule): an expired code cannot be approved")
seen_before = len(site.seen)
r = app.poll()
check(r["state"] == "expired" and "ended" in r["message"] and store.items == {}, "the app says the code ended, and stores nothing")
check(len(site.seen) == seen_before, "MUST-FAIL: an ended code is not even sent to the site again")
check(app.status()["state"] == "signed_out", "and is signed out")

clock, site, store, app, folder, events = setup("d3")
s = app.begin()
site.approve(s["user_code"])
clock.add(6)
app.poll()
check(app.status()["state"] == "signed_in", "approved and collected once")
status, r = site._poll({"device_code": site.issued_device_codes[0]})
check(status == 400 and r == {"error": "expired_token"}, "MUST-FAIL (server rule): a used code is refused when asked for again, and no second token is handed out")
check(site.approve(s["user_code"]) is False, "and a used code cannot be approved again")

clock, site, store, app, folder, events = setup("d4")
s = app.begin()
site.deny(s["user_code"])
clock.add(6)
r = app.poll()
check(r["state"] == "denied" and "no" in r["message"] and store.items == {}, "denied on the website: the app says so and stores nothing")

clock, site, store, app, folder, events = setup("d5")
for _ in range(6):
    app.begin()
    app.cancel()
ok, msg = raises(lambda: app.begin(), "rate")
check(ok, "MUST-FAIL (server rule): the seventh code in a minute is refused (429) and the app says 'too many tries'")
clock.add(61)
check(app.begin()["state"] == "waiting", "a minute later it works again")

# ---------------------------------------------------------------------------------------------------------------- E
print("\nE. removing this computer")
clock, site, store, app, folder, events = setup("e")
sign_in(clock, site, app)
tok = store.read(app.target)
r = app.remove()
check(app.status()["state"] == "signed_out" and store.read(app.target) is None and not (folder / si.CACHE_NAME).exists(), "Remove: the token and the cache are gone from this computer")
check(site.tokens[fake._h(tok)]["revoked"] is True, "and the site was told: that token no longer works")
check("Removed" in r["message"], "the page says 'Removed from this computer.'")

clock, site, store, app, folder, events = setup("e2")
sign_in(clock, site, app)
app.transport = lambda *a, **k: (_ for _ in ()).throw(si.SignInError("offline", "offline"))
r = app.remove()
check(store.read(app.target) is None and r["state"] == "signed_out" and "website" in r["message"], "MUST-FAIL: with no internet the token is STILL removed here, and the page says to remove the computer on the website too")

clock, site, store, app, folder, events = setup("e3")
sign_in(clock, site, app)
site.revoke_all()
r = app.check()
check(r["state"] == "signed_out" and "removed from your account" in r["message"] and store.read(app.target) is None, "a computer removed on the website is signed out at the next check (the server wins)")

clock, site, store, app, folder, events = setup("e4")
sign_in(clock, site, app)
clock.add(3 * 86400)
site.revoke_all()
check(app.gate()["clip_films"] is True, "(before the check) the cache alone would still allow clip films")
app.check()
check(app.gate()["clip_films"] is True and app.status()["state"] == "signed_out", "after the check it is signed out; signed out is the r8 behaviour (clip films work), never 'blocked by a stale cache'")

clock, site, store, app, folder, events = setup("e5")
sign_in(clock, site, app)
cache_before = (folder / si.CACHE_NAME).read_text(encoding="utf-8")
app.transport = lambda *a, **k: (_ for _ in ()).throw(si.SignInError("offline", "offline"))
ok, msg = raises(lambda: app.check(), "offline")
check(ok and (folder / si.CACHE_NAME).read_text(encoding="utf-8") == cache_before and app.status()["state"] == "signed_in", "a check with no internet changes nothing and stays signed in")
store.delete(app.target)
check(app.status()["state"] == "signed_out" and not (folder / si.CACHE_NAME).exists(), "if the credential entry is deleted behind the app's back, it is signed out and the cache goes too")

# ---------------------------------------------------------------------------------------------------------------- F
print("\nF. the 7-day grace pauses only the node")
clock, site, store, app, folder, events = setup("f")
check(app.gate() == {"clip_films": True, "node": False, "paused": False, "note": ""}, "signed out: nothing is gated (the r8 behaviour; whether r9 requires sign-in is Ryan's call)")
sign_in(clock, site, app, local=True)
g = app.gate()
check(g["clip_films"] and g["node"], "signed in on a flagged account, freshly checked: clip films on, the node switch allowed")
clock.add(6 * 86400 + 80000)
g = app.gate()
check(g["clip_films"] and g["node"], "just under 7 days offline: still allowed")
clock.add(10000)
g = app.gate()
check(g["clip_films"] is True and g["node"] is False and g["paused"] is True and "7 days" in g["note"] and "paused" in g["note"] and "clip films are not affected" in g["note"].lower(), f"MUST-FAIL: over 7 days without a check: the node is PAUSED and the note says so, but clip films are NOT blocked ({g['note'][:60]}...)")
st = app.status()
check(st["clip_films"] is True and st["paused"] is True and st["note"] == g["note"] and st["grace_days_left"] == 0, "the page sees the same sentence")
app.check()
g = app.gate()
check(g["clip_films"] and g["node"] and not g["paused"], "one successful check renews the 7 days: the node is back")
clock2, site2, store2, app2, folder2, ev2 = setup("f2")
sign_in(clock2, site2, app2, local=False)
check(app2.gate()["node"] is False and "does not render" in app2.gate()["note"], "an account without the tester flag: no node, a plain note, clip films still work")
c = json.loads((folder2 / si.CACHE_NAME).read_text(encoding="utf-8"))
c["last_ok"] = 0
(folder2 / si.CACHE_NAME).write_text(json.dumps(c), encoding="utf-8")
check(app2.gate()["paused"] is True and app2.gate()["clip_films"] is True, "a missing last-checked time counts as 'not checked' (it never counts as fresh) and still never blocks a clip film")
check("authoris" not in json.dumps(app.gate()).lower(), "the gate is local words only: it names no permission and no server action")

# ---------------------------------------------------------------------------------------------------------------- G
print("\nG. the real Windows Credential Manager")
if sys.platform == "win32" and os.environ.get("RYAGRAM_TEST_REAL_STORE") == "1":
    real = si.default_store()
    target = "Ryagram/test/" + secrets.token_hex(6)
    secret = secrets.token_urlsafe(40)
    try:
        real.write(target, secret)
        check(real.read(target) == secret, "a throwaway entry round-trips through the real Credential Manager")
        out = real._pcred()
        real._adv.CredReadW(target, si.CRED_TYPE_GENERIC, 0, ctypes.byref(out))
        try:
            typ, persist = out.contents.Type, out.contents.Persist
        finally:
            real._adv.CredFree(out)
        check(typ == 1 and persist == 2, f"it is CRED_TYPE_GENERIC and persisted for THIS computer only (type {typ}, persist {persist}); 3 would roam with the account")
        real.write(target, secret + "x")
        check(real.read(target) == secret + "x", "writing again replaces it")
        too_big = secrets.token_urlsafe(4000)
        ok, msg = raises(lambda: real.write(target, too_big), "store")
        check(ok and real.read(target) == secret + "x", "a token too large to store is refused and the old entry is untouched")
    finally:
        real.delete(target)
    check(real.read(target) is None, "deleted afterwards: the entry is gone")
    real.delete(target)
    check(True, "deleting something already gone is quiet")
else:
    print("  SKIPPED: the real-store rows write one throwaway entry into the real Windows vault of whoever runs this; set RYAGRAM_TEST_REAL_STORE=1 to run them")
saved = sys.platform
try:
    sys.platform = "linux"
    ok, msg = raises(lambda: si.default_store(), "store")
finally:
    sys.platform = saved
check(ok and "Nothing was stored" in msg, "MUST-FAIL: with no Credential Manager the app refuses to sign in at all (no file fallback)")
STORE_SRC = (HERE / "ryagram_signin.py").read_text(encoding="utf-8").split("class WindowsCredentialStore")[1].split("def default_store")[0]
check("open(" not in STORE_SRC and "write_text" not in STORE_SRC and "write_bytes" not in STORE_SRC, "and the store code opens and writes no file at all")

# ---------------------------------------------------------------------------------------------------------------- H
print("\nH. the fake site keeps the server rules (so WORKER and WEB can match them)")
clock, site, store, app, folder, events = setup("h")
codes = set()
for i in range(5):
    s = app.begin()
    codes.add(s["user_code"])
    check(len(s["user_code"]) == 9 and all(ch in si.USER_CODE_ALPHABET + "-" for ch in s["user_code"]), f"user code {s['user_code']}: 8 characters, none of 0 O 1 I L") if i == 0 else None
    bad_chars = [ch for ch in s["user_code"] if ch in "0O1IL"]
    check(not bad_chars, f"user code {s['user_code']} has none of 0 O 1 I L") if i > 0 else None
    app.cancel()
check(len(codes) == 5, "the codes differ")
check(all(len(d) >= 43 for d in site.issued_device_codes), "device secrets are 32+ random bytes (43+ characters)")
sign_in(clock, site, app)
tok = store.read(app.target)
status, r = si.UrlTransport(site.root_url)("GET", "/connect/ping", None, tok)
check(status == 401, "MUST-FAIL (server rule): the node token used on the connector's door is refused (audience separation, not just scope)")
status, r = si.UrlTransport(site.root_url + "/node")("GET", "/account", None, "not-a-token")
check(status == 401, "an unknown bearer is refused")
check(any(b for _m, _p, b in site.seen), "bearers travel in the Authorization header")
check(all("?" not in p or "code=" in p for _m, p, _b in site.seen), "the only query string is the approval page's own ?code=")

# ---------------------------------------------------------------------------------------------------------------- the computer name
print("\nthe computer name")
clock, site, store, app, folder, events = setup("n", computer_name="Sam's <b>PC</b>\r\n; DROP")
check(app.computer == "Sams bPCb DROP" or ("<" not in app.computer and ">" not in app.computer and ";" not in app.computer and "\n" not in app.computer), f"a hostile computer name is cleaned ({app.computer!r})")
check(not any(app.computer in e for e in events), "and no event carries it")

for s_ in (site,):
    s_.stop()
print()
if FAILS:
    print(f"FAILED: {len(FAILS)}")
    for f in FAILS:
        print("  -", f)
    sys.exit(1)
print("all passed")
