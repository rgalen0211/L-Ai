"""The app's node loop ("this computer renders my site films", NEXT-CONNECT 100, r9 M4) against the REAL `node` function logic (supabase/functions/node-core, run by Node
through tests/node-fake-server.mjs) and its in-memory database stand-in. No real site, no account, no Supabase, no network beyond 127.0.0.1, no engine render (the renderer is a stand-in).

    python tools/check-node-loop.py <engine folder, for the worker's validate_job> [<scratch base folder>]

What it proves (plan section 9 items 4 to 8, CC1 13:20 to 13:51)
  A  off by default and remembered; off = no request at all
  B  it polls only when it may: signed in, account flagged, state fresh (7 days), a renderer present; otherwise it says why and claims NOTHING
  C  the happy path: claim, render, validate, upload to the path the site derived, complete; the upload carries no account header
  D  isolation: another person's job and a house job are never touched; a removed computer is signed out on its next call
  E  a job is DATA: a job that fails validate_job is reported failed and never rendered; with no dataset list every job is refused
  F  only the renderer's own finished files are sent: nothing outside the job's folder, nothing of an unknown kind, nothing too large, nothing missing
  G  the upload address must be on the site's host
  H  failures: a render failure fails (or, if retryable, requeues) the job; ANY exception leaves the loop alive
  I  cadence (30 s, 60 s after 10 empty polls), heartbeat throttle, the background thread
  J  the network allowlist: every connection of the whole run goes to the one local site; no token in any file, status or log
"""
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))
import ryagram_node as rn                     # noqa: E402
import ryagram_signin as si                   # noqa: E402

if len(sys.argv) < 2:
    sys.exit("Give the engine folder (a Ryagram checkout or the kit folder): the worker's validate_job is used for the 'a job is data' rows.")
ENGINE = Path(sys.argv[1])
BASE = Path(sys.argv[2]) if len(sys.argv) > 2 else Path(tempfile.mkdtemp(prefix="node-loop-"))
BASE.mkdir(parents=True, exist_ok=True)
sys.path.insert(0, str(ENGINE))
FAILS = []
ALICE, BOB = "00000000-0000-4000-8000-00000000a11c", "00000000-0000-4000-8000-0000000000b0"
JID = lambda n: f"00000000-0000-4000-8000-{n:012d}"     # noqa: E731


def check(c, what):
    print(("  ok   " if c else "  FAIL ") + what)
    if not c:
        FAILS.append(what)


class Clock:
    def __init__(self):
        self.t = time.time()

    def __call__(self):
        return self.t

    def add(self, s):
        self.t += s


# ---- every connection the whole run makes (the network allowlist row)
CONNECTS = []
_real_cc = socket.create_connection


def _cc(address, *a, **k):
    CONNECTS.append(address[0] + ":" + str(address[1]))
    return _real_cc(address, *a, **k)


socket.create_connection = _cc


class Server:
    def __init__(self):
        env = dict(os.environ, NODE_NO_WARNINGS="1")
        self.p = subprocess.Popen(["node", "--no-warnings", str(ROOT / "tests" / "node-fake-server.mjs")], cwd=ROOT, stdout=subprocess.PIPE, text=True, env=env)
        line = self.p.stdout.readline().strip()
        if not line.startswith("READY"):
            raise SystemExit("the test server did not start: " + line)
        self.port = int(line.split()[1])
        self.host = f"127.0.0.1:{self.port}"
        self.url = f"http://{self.host}/node"

    def admin(self, what, body=None):
        req = urllib.request.Request(f"http://{self.host}/__admin/{what}", data=json.dumps(body or {}).encode(), headers={"Content-Type": "application/json"}, method="POST")
        with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(req, timeout=10) as r:
            return json.loads(r.read())

    def close(self):
        self.p.terminate()
        try:
            self.p.wait(timeout=10)
        except subprocess.TimeoutExpired:
            self.p.kill()


def world(name, flagged=True, renderer="ok", datasets=None, validate="accept", clock=None):
    d = BASE / name
    if d.exists():
        shutil.rmtree(d)
    d.mkdir(parents=True)
    srv = Server()
    clock = clock or Clock()
    srv.admin("user", {"id": ALICE, "email": "alice@example.test", "local_compute": flagged})
    srv.admin("user", {"id": BOB, "email": "bob@example.test", "local_compute": True})
    events = []
    app = si.SignIn(srv.url, si.MemoryStore(), d, clock=clock, computer_name="Alice-PC", log=events.append)
    rend = None
    if renderer == "ok":
        rend = lambda job, work, progress: good_render(job, work, progress)           # noqa: E731
    elif callable(renderer):
        rend = renderer
    loop = rn.NodeLoop(app, d, renderer=rend, validate=(lambda job: job) if validate == "accept" else validate, datasets=datasets, clock=clock, log=events.append, work_root=d / "jobs")
    return srv, app, loop, clock, d, events


def sync(srv, clock):
    srv.admin("clock", {"offset_ms": int(clock.t * 1000 - time.time() * 1000)})


def sign_in(srv, app, clock, who=ALICE):
    s = app.begin()
    sync(srv, clock)
    assert srv.admin("approve", {"user_code": s["user_code"], "owner": who})["ok"]
    clock.add(6)
    sync(srv, clock)
    st = app.poll()
    assert st["state"] == "signed_in", st
    return st


def good_render(job, work, progress):
    (work / "film.mp4").write_bytes(b"\x00\x00\x00\x18ftypmp42" + bytes(range(256)) * 8)
    (work / "receipt.json").write_text(json.dumps({"job": job["id"]}))
    return {"preview": work / "film.mp4", "receipt": work / "receipt.json"}


def queue(srv, jid, owner=ALICE, run_on="owner_local", job_type="preview"):
    srv.admin("addjob", {"id": jid, "owner_id": owner, "run_on": run_on, "job_type": job_type})


def states(srv):
    return {j["id"]: j["state"] for j in srv.admin("jobs")}


def uploads(srv):
    return srv.admin("uploads")


def calls(srv):
    return srv.admin("calls")


# =========================================================================================================== A
print("A. off by default, remembered, silent when off")
srv, app, loop, clock, d, events = world("a")
try:
    sign_in(srv, app, clock)
    check(loop.on is False and loop.status()["phase"] == "off", "a new loop is OFF")
    n = len(calls(srv))
    check(loop.step() == "off" and len(calls(srv)) == n, "MUST-FAIL: off = no request to the site at all")
    loop.set_switch(True)
    check(loop.on and json.loads((d / rn.SWITCH_NAME).read_text())["on"] is True, "switching it on is remembered on this computer")
    again = rn.NodeLoop(app, d, renderer=None)
    check(again.on is True, "a fresh start remembers the switch")
    loop.set_switch(False)
    check(rn.NodeLoop(app, d).on is False and events.count("node_on") == 1 and events.count("node_off") == 1, "and off is remembered too; the log events are fixed words")
    (d / rn.SWITCH_NAME).write_text("not json")
    check(rn.NodeLoop(app, d).on is False, "a damaged switch file means OFF")
finally:
    srv.close()

# =========================================================================================================== B
print("\nB. it polls only when it may")
srv, app, loop, clock, d, events = world("b")
try:
    queue(srv, JID(1))
    loop.set_switch(True)
    n = len(calls(srv))
    check(loop.step() == "paused" and loop.status()["phase"] == "paused" and len(calls(srv)) == n, "signed out: paused, and it claims NOTHING")
    sign_in(srv, app, clock)
    clock.add(8 * 86400)
    sync(srv, clock)
    n = len(calls(srv))
    r = loop.step()
    check(r == "paused" and "7 days" in loop.status()["message"] and len(calls(srv)) == n, "MUST-FAIL: 8 days without a check: the node is paused with the plain reason, and claims nothing")
    check(states(srv)[JID(1)] == "queued", "and the job is still queued")
    app.check()
    check(loop.status()["phase"] != "paused", "one successful check turns it back on")
finally:
    srv.close()
srv, app, loop, clock, d, events = world("b2", flagged=False)
try:
    queue(srv, JID(2))
    sign_in(srv, app, clock)
    loop.set_switch(True)
    n = len(calls(srv))
    check(loop.step() == "paused" and "does not render" in loop.status()["message"] and len(calls(srv)) == n, "an account without the tester flag: paused, claims nothing")
finally:
    srv.close()
srv, app, loop, clock, d, events = world("b3", renderer=None)
try:
    queue(srv, JID(3))
    sign_in(srv, app, clock)
    loop.set_switch(True)
    n = len(calls(srv))
    check(loop.step() == "cannot_render" and "cannot make site films yet" in loop.status()["message"] and len(calls(srv)) == n, "MUST-FAIL: no renderer in this app: it says so and claims NOTHING (no job is failed for it)")
    check(states(srv)[JID(3)] == "queued", "the job stays queued for a computer that can render it")
finally:
    srv.close()

# =========================================================================================================== C, D
print("\nC. the happy path")
srv, app, loop, clock, d, events = world("c")
try:
    queue(srv, JID(10)); queue(srv, JID(11), owner=BOB); queue(srv, JID(12), run_on="house")
    sign_in(srv, app, clock)
    loop.set_switch(True)
    r = loop.step()
    check(r == "worked", f"one step: claim, render, upload, complete ({r})")
    st = states(srv)
    check(st[JID(10)] == "complete", "the job is complete on the site")
    check(st[JID(11)] == "queued" and st[JID(12)] == "queued", "MUST-FAIL: another person's job and a house job are untouched")
    up = uploads(srv)
    base = "00000000-0000-4000-8000-0000000000a1"
    check(sorted(u["path"] for u in up) == sorted([f"{ALICE}/{base}/00000000-0000-4000-8000-0000000000b1/{JID(10)}/preview.mp4", f"{ALICE}/{base}/00000000-0000-4000-8000-0000000000b1/{JID(10)}/receipt.sequence.json"]),
          "the files went to the paths the SITE derived from the job")
    check(all(u["auth"] is None for u in up), "MUST-FAIL: the upload request carries no account header (the signed address is the only authority)")
    film = (d / "jobs" / JID(10) / "film.mp4").read_bytes()
    import hashlib
    check(any(u["sha256"] == hashlib.sha256(film).hexdigest() and u["bytes"] == len(film) for u in up), "and the bytes are the ones the renderer made")
    check(loop.status()["phase"] == "idle" and "Done" in loop.status()["message"] and loop.status()["last"] == "The last film was made and sent.", "the page says 'Done. Waiting for the next film.' and keeps 'The last film was made and sent.'")
    loop.step()
    check(loop.status()["last"] == "The last film was made and sent." and loop.status()["message"] == "Waiting for a film to make.", "and the next idle poll does not cover what happened to the last film")
    check(events.count("node_job_done") == 1, "one fixed log word for the job")
    check(loop.step() == "idle" and loop.empty_polls == 2, "the next step finds nothing (BOB's and the house job are not hers)")

    print("\nD. a removed computer")
    srv.admin("removeall")
    queue(srv, JID(13))
    r = loop.step()
    check(r == "error" and app.status()["state"] == "signed_out", "the very next call after Remove on the website: refused, and this computer is signed out")
    check(app._token() is None and not (d / si.CACHE_NAME).exists(), "token and cache are gone from this computer")
    check(loop.step() == "paused" and states(srv)[JID(13)] == "queued", "and the loop pauses; the queued job is not touched")
finally:
    srv.close()

# =========================================================================================================== E
print("\nE. a job is data")
rendered = []
srv, app, loop, clock, d, events = world("e", renderer=lambda job, work, progress: rendered.append(job) or good_render(job, work, progress),
                                          validate=lambda job: (_ for _ in ()).throw(rn.NodeError("job_invalid: story: not an object", "job_invalid")))
try:
    queue(srv, JID(20))
    sign_in(srv, app, clock)
    loop.set_switch(True)
    check(loop.step() == "rejected" and states(srv)[JID(20)] == "failed" and rendered == [], "a job that fails validation is reported failed and the renderer is NEVER called")
    check(uploads(srv) == [] and "did not pass the check" in loop.status()["message"], "nothing is uploaded; the page says so in plain words")
finally:
    srv.close()
rendered.clear()
srv, app, loop, clock, d, events = world("e2", renderer=lambda job, work, progress: rendered.append(job) or good_render(job, work, progress), datasets=None, validate=None)
try:
    queue(srv, JID(21))
    sign_in(srv, app, clock)
    loop.set_switch(True)
    check(loop.step() == "rejected" and rendered == [] and states(srv)[JID(21)] == "failed", "MUST-FAIL: with NO dataset list the default validator refuses every job (fail closed)")
finally:
    srv.close()
rendered.clear()
srv, app, loop, clock, d, events = world("e3", renderer=lambda job, work, progress: rendered.append(job) or good_render(job, work, progress), datasets={"state_obesity_fastfood"}, validate=None)
try:
    queue(srv, JID(22))
    sign_in(srv, app, clock)
    loop.set_switch(True)
    try:
        r = loop.step()
        real = True
    except ModuleNotFoundError:
        r, real = "skip", False
    if real:
        check(r == "rejected" and rendered == [] and states(srv)[JID(22)] == "failed", "the worker's REAL validate_job refuses a job row with no story, and nothing is rendered")
    else:
        print("  SKIPPED: this engine folder has no ryagram.worker.schema")
finally:
    srv.close()

# =========================================================================================================== F
print("\nF. only the renderer's own finished files are sent")
outside = BASE / "Sam Videos"
outside.mkdir(exist_ok=True)
(outside / "my-source.mp4").write_bytes(b"MY OWN VIDEO")


def bad_outside(job, work, progress):
    return {"preview": outside / "my-source.mp4"}


def bad_kind(job, work, progress):
    (work / "x.exe").write_bytes(b"MZ")
    return {"preview": work / "x.exe"}


def bad_missing(job, work, progress):
    return {"preview": work / "nothing.mp4"}


def empty(job, work, progress):
    return {}


def traverse(job, work, progress):
    (work / "ok.mp4").write_bytes(b"x")
    return {"preview": work / ".." / ".." / "Sam Videos" / "my-source.mp4"}


for label, rend, want in [("a source video outside the job folder (named as the film)", bad_outside, "outside_job"), ("a path that climbs out of the job folder with ..", traverse, "outside_job"),
                          ("an unknown file type", bad_kind, "bad_output"), ("a file that is not there", bad_missing, "missing_output"), ("no files at all", empty, "no_output")]:
    srv, app, loop, clock, d, events = world("f", renderer=rend)
    try:
        queue(srv, JID(30))
        sign_in(srv, app, clock)
        loop.set_switch(True)
        r = loop.step()
        check(r == "failed" and states(srv)[JID(30)] == "failed" and uploads(srv) == [] and "node_register_artifact" not in calls(srv), f"MUST-FAIL: {label}: the job fails, NOTHING is uploaded and nothing is even registered with the site")
    finally:
        srv.close()
old_cap = rn.MAX_UPLOAD_BYTES
rn.MAX_UPLOAD_BYTES = 100
srv, app, loop, clock, d, events = world("f2")
try:
    queue(srv, JID(31))
    sign_in(srv, app, clock)
    loop.set_switch(True)
    r = loop.step()
    check(r == "failed" and uploads(srv) == [] and "node_register_artifact" not in calls(srv), "MUST-FAIL: a file over the app's own size cap is not sent or registered")
finally:
    rn.MAX_UPLOAD_BYTES = old_cap
    srv.close()
srv, app, loop, clock, d, events = world("f3")
try:
    queue(srv, JID(32))
    sign_in(srv, app, clock)
    loop.set_switch(True)
    seen = {}
    real_collect = loop._collect

    def peek(outputs, work):
        files = real_collect(outputs, work)
        seen["list"] = [(k, p.name) for k, p in files]
        return files
    loop._collect = peek
    loop.step()
    check(seen["list"] == [("preview", "film.mp4"), ("receipt", "receipt.json")], "the list of what will be sent is exactly the finished files")
finally:
    srv.close()
srv, app, loop, clock, d, events = world("f4")
try:
    queue(srv, JID(33))
    sign_in(srv, app, clock)
    loop.set_switch(True)
    shown = []
    real_up = loop._upload

    def watch(jid, kind, path):
        shown.append(json.dumps(loop.status()))
        return real_up(jid, kind, path)
    loop._upload = watch
    loop.step()
    check(shown and '"film.mp4"' in shown[0] and "uploading" in shown[0], "the list is on the page BEFORE the first file is sent (phase uploading, names and sizes)")
    check(str(d) not in shown[0] and "story" not in shown[0], "and it shows file names and sizes only, no folder path and no story")
finally:
    srv.close()

# =========================================================================================================== G
print("\nG. the upload address")
tmpf = BASE / "g.mp4"
tmpf.write_bytes(b"x")
for url in ["https://evil.example/upload/x?token=1", "http://127.0.0.1:1/x?token=1", "http://evil.example/x", "https://a:b@127.0.0.1/x", "file:///c:/x", "http://127.0.0.1.evil.example:80/x"]:
    try:
        rn.put_file(url, tmpf, "video/mp4", {"127.0.0.1:2"})
        ok = False
    except rn.NodeError as e:
        ok = e.kind == "bad_upload_url"
    check(ok, f"MUST-FAIL: refused before any connection: {url[:44]}")
n0 = len(CONNECTS)
try:
    rn.put_file("https://evil.example/x", tmpf, "video/mp4", {"127.0.0.1:2"})
except rn.NodeError:
    pass
check(len(CONNECTS) == n0, "and refusing made no connection at all")

# =========================================================================================================== H
print("\nH. failures never end the loop")
srv, app, loop, clock, d, events = world("h", renderer=lambda job, work, progress: (_ for _ in ()).throw(rn.RenderFailed("engine_crash")))
try:
    queue(srv, JID(40)); queue(srv, JID(41))
    sign_in(srv, app, clock)
    loop.set_switch(True)
    check(loop.step() == "failed" and states(srv)[JID(40)] == "failed", "a render failure fails that job on the site")
    check(loop.step() == "failed" and states(srv)[JID(41)] == "failed", "and the loop goes on to the next one")
    check(events.count("node_job_failed") == 2, "(log: fixed words only)")
finally:
    srv.close()
srv, app, loop, clock, d, events = world("h2", renderer=lambda job, work, progress: (_ for _ in ()).throw(rn.RenderFailed("disk_busy", retry=True)))
try:
    queue(srv, JID(42))
    sign_in(srv, app, clock)
    loop.set_switch(True)
    loop.step()
    check(states(srv)[JID(42)] == "queued", "a retryable failure puts the job back in the queue (the site decides about attempts)")
finally:
    srv.close()
srv, app, loop, clock, d, events = world("h3", renderer=lambda job, work, progress: (_ for _ in ()).throw(RuntimeError("C:/Users/Sam/secret path")))
try:
    queue(srv, JID(43))
    sign_in(srv, app, clock)
    loop.set_switch(True)
    r = loop.step()
    check(r == "failed" and states(srv)[JID(43)] == "failed", "MUST-FAIL: ANY exception in the renderer fails the job and the loop survives")
    check("secret path" not in json.dumps(loop.status()) and "secret path" not in json.dumps(events), "and the exception's text (a path) reaches neither the page nor the log")
    check(loop.step() == "idle", "the loop is still alive")
finally:
    srv.close()
srv, app, loop, clock, d, events = world("h4")
try:
    sign_in(srv, app, clock)
    loop.set_switch(True)
    srv.close()
    r = loop.step()
    check(r == "error" and loop.status()["phase"] == "waiting", "the site unreachable: 'waiting', no crash")
finally:
    srv.close()

# =========================================================================================================== I
print("\nI. cadence, heartbeat, thread")
srv, app, loop, clock, d, events = world("i")
try:
    sign_in(srv, app, clock)
    loop.set_switch(True)
    check(loop.next_delay() == 30, "idle polls start at 30 seconds")
    for _ in range(rn.IDLE_AFTER):
        loop.step()
    check(loop.next_delay() == 60, "after 10 empty polls: 60 seconds")
    queue(srv, JID(50))
    loop.step()
    check(loop.next_delay() == 30, "a job brings it back to 30")
finally:
    srv.close()
beats = []


def beating(job, work, progress):
    progress("a"); progress("b")
    clock_.add(21)
    progress("c"); progress("d")
    return good_render(job, work, progress)


clock_ = Clock()
srv, app, loop, clock, d, events = world("i2", renderer=beating, clock=clock_)
try:
    queue(srv, JID(51))
    sign_in(srv, app, clock)
    loop.set_switch(True)
    loop.step()
    n = calls(srv).count("node_heartbeat")
    check(n == 1, f"heartbeats are throttled to one every 20 seconds ({n}: two calls close together make one; after 21 s one more would be the second, here the first beat comes after the first 20 s)")
finally:
    srv.close()
srv, app, loop, clock, d, events = world("i3")
try:
    sign_in(srv, app, clock)
    queue(srv, JID(52))
    rn.POLL_SECONDS = 0.05
    rn.IDLE_POLL_SECONDS = 0.05
    loop.set_switch(True)
    loop.start()
    for _ in range(100):
        time.sleep(0.1)
        if states(srv)[JID(52)] == "complete":
            break
    check(states(srv)[JID(52)] == "complete", "the background thread picks the job up and finishes it on its own")
    loop.set_switch(False)
    queue(srv, JID(53))
    time.sleep(1.2)
    check(states(srv)[JID(53)] == "queued", "MUST-FAIL: switched off, the thread claims nothing more")
    loop.stop()
finally:
    srv.close()

# =========================================================================================================== J
print("\nJ. the network allowlist and no secrets")
hosts = sorted(set(CONNECTS))
check(all(h.startswith("127.0.0.1:") for h in hosts) and bool(hosts), f"MUST-FAIL: every connection of this whole run went to 127.0.0.1 ({len(hosts)} local test-server ports, no other host)")
srv, app, loop, clock, d, events = world("j")
try:
    queue(srv, JID(60))
    sign_in(srv, app, clock)
    loop.set_switch(True)
    loop.step()
    tok = app._token()
    blob = json.dumps(loop.status()) + json.dumps(app.status()) + " ".join(events)
    for f in d.rglob("*"):
        if f.is_file() and f.suffix not in (".mp4",):
            blob += f.read_text(encoding="utf-8", errors="replace")
    check(tok and tok not in blob, "MUST-FAIL: the node token is in no file, no status and no log event")
    check(set(loop.status()) == {"phase", "message", "job", "uploads", "on", "allowed", "can_render", "empty_polls", "last"}, "the page-facing status has a fixed set of fields")
finally:
    srv.close()
print()
if FAILS:
    print(f"FAILED: {len(FAILS)}")
    for f in FAILS:
        print("  -", f)
    sys.exit(1)
print("all passed")
