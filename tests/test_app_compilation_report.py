"""The desktop app runs a compilation request and reports how far it got (FACES 11-27, gap G1). Plain Python, no network, no engine, no speech model: a stand-in sign-in records every call the app
would make to /node/compilation-report, and a stand-in engine process writes what the real `draft-request --report-file` and `build-edit` write. The request, the names and the paths below are invented.

    py tests/test_app_compilation_report.py          (exit 0 = every check passed)
"""
from __future__ import annotations

import io
import json
import re
import sys
import tempfile
import threading
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "tools"))
import ryagram_requests as RR  # noqa: E402

NAPS = []
RR._nap = NAPS.append                                   # the wait between tries is only noted here: nothing in this file sleeps for real between tries

FAILS = []


def check(name, ok, detail=""):
    print(("PASS  " if ok else "FAIL  ") + name + ("" if ok else "  <- " + str(detail)[:300]))
    if not ok:
        FAILS.append(name)


PID = "11111111-2222-3333-4444-555555555555"
SITE_SHA = "ab" * 32                                    # the SITE's fingerprint of the request (differs on purpose from anything the engine would hash)
PHRASE = "purple elephant"
NAMES = ["Holiday Clips", "Birthday Tapes"]
REQUEST = {"schema": "ryagram.compilation-request/0", "phrase": PHRASE, "search": "every", "folders": NAMES, "song": False, "clean_cuts": False, "rules": [], "texts": [], "note": ""}


class SignIn:
    """Stand-in for the app's SignIn: status() and api(); records each call; `fail` makes every report raise (offline / signed out)."""

    def __init__(self, fail=False, delay=0.0):
        self.calls, self.fail, self._n, self.delay, self.request = [], fail, 0, delay, REQUEST
        self.sha = SITE_SHA                     # the fingerprint the site's list shows now (a test changes it: the AI wrote the request again)
        self.gone = False                       # the site's list holds no request any more
        self.list_fail = False                  # reading the list fails (offline)
        self.list_reads = 0
        self.respond = None                     # callable(route, body) -> (status, obj) to answer a report, or None to take it; may raise

    def status(self):
        return {"state": "signed_in"}

    def api(self, method, route, body):
        if route == RR.ROUTE:
            self.list_reads += 1
            if self.list_fail:
                raise OSError("no internet")
            if self.gone:
                return 200, {"requests": []}
            return 200, {"requests": [{"project_id": PID, "title": "Family", "request": self.request, "sha256": self.sha, "updated_at": "2026-11-27T10:00:00Z"}]}
        self.calls.append((method, route, json.loads(json.dumps(body))))
        if self.delay:
            time.sleep(self.delay)
        if self.respond is not None:
            got = self.respond(route, body)
            if got is not None:
                return got
        if self.fail:
            raise OSError("no internet")
        self._n += 1
        return 200, {"run_id": self._n}

    def reports(self):
        return [b for (_m, r, b) in self.calls if r == RR.REPORT_ROUTE]


class FakeProc:
    def __init__(self, rc, hold=False):
        self._rc, self.hold, self.returncode = rc, hold, None
        self.stdout, self.stderr = io.StringIO(""), io.StringIO("")
        if not hold:
            self.returncode = rc

    def poll(self):
        return self.returncode

    def kill(self):
        self.returncode = -9


def arg(cmd, flag):
    """The value of an option written `--flag=value` (v3: no value is ever a separate argument)."""
    return next(c[len(flag) + 1:] for c in cmd if c.startswith(flag + "="))


def has_flag(cmd, flag):
    return flag in cmd or any(c.startswith(flag + "=") for c in cmd)


def folder_args(cmd):
    return sorted(c[len("--folder="):] for c in cmd if c.startswith("--folder="))


def make_popen(plan="ok", build="ok", seen=None):
    """plan: ok | not_said | hang ; build: ok | fail. Writes what the real engine commands write."""
    def popen(cmd, **kw):
        if seen is not None:
            seen.append(list(cmd))
        if "draft-request" in cmd:
            rf = Path(arg(cmd, "--report-file"))
            pj = arg(cmd, "--project")
            lines = [{"project_id": pj, "request_sha256": "cd" * 32, "state": "planning", "matches": None, "clips": None, "film_seconds": None, "error_code": None}]
            if plan == "hang":
                rf.write_text("\n".join(json.dumps(x) for x in lines) + "\n", encoding="utf-8")
                return FakeProc(0, hold=True)
            if plan == "not_said":
                lines.append({**lines[0], "state": "failed", "error_code": "not_said"})
                rf.write_text("\n".join(json.dumps(x) for x in lines) + "\n", encoding="utf-8")
                return FakeProc(2)
            lines += [{**lines[0], "state": "matching", "matches": 7, "clips": 7}, {**lines[0], "state": "done", "matches": 7, "clips": 7, "film_seconds": 12.5}]
            rf.write_text("\n".join(json.dumps(x) for x in lines) + "\n", encoding="utf-8")
            Path(arg(cmd, "--out")).write_text(json.dumps({"schema": "ryagram.request-draft/0", "found": 7, "edit": {"clips": []}}), encoding="utf-8")
            return FakeProc(0)
        if "build-edit" in cmd:
            if build == "hang":
                return FakeProc(0, hold=True)
            if build == "fail":
                return FakeProc(1)
            Path(arg(cmd, "--out")).write_bytes(b"film")
            p = FakeProc(0)
            p.stdout = io.StringIO("built compilation.mp4 (12.5 s) from 7 clip(s); receipt beside it\n")
            return p
        raise AssertionError("unexpected command " + " ".join(cmd[:4]))
    return popen


HELP_NEW = "usage: ryagram.local draft-request [--report-file REPORT_FILE] [--project PROJECT] [--preview] [--request-sha256 HEX] request"
HELP_NO_SHA = "usage: ryagram.local draft-request [--report-file REPORT_FILE] [--project PROJECT] [--preview] request"      # v3's engine help check was satisfied by this one
HELP_OLD = "usage: ryagram.local draft-request [--folder FOLDER] [--out OUT] request"


def setup(tmp, *, fail=False, choose=True, rk=None, request=None, **kw):
    si = SignIn(fail=fail)
    if request is not None:
        si.request = request
    airq = RR.AiRequests(si, clock=lambda: 1e9)
    airq.status(force=True)
    fm = RR.FolderMap(Path(tmp) / "request-folders.json")
    dirs = {}
    for n in NAMES:
        d = Path(tmp) / "Users" / "Ana" / ("Private_" + n.replace(" ", "_"))
        d.mkdir(parents=True, exist_ok=True)
        dirs[n] = d
        if choose:
            fm.set(PID, n, d)
    seen = []
    run = RR.RequestRunner(airq, si, fm, engine_dir=tmp, work_dir=Path(tmp) / "work", out_dir=Path(tmp) / "films", popen=make_popen(seen=seen, **kw), kill=lambda p: p.kill(), poll_s=0.01,
                           **{**dict(probe=lambda: (0, HELP_NEW), state_file=Path(tmp) / "request-open-run.json", page_grace_s=1e6, reap_s=0.02), **(rk or {})})
    return si, run, dirs, seen


def wait(run):
    run.join(10)


def api_calls_ok(src):
    """Every `.api(` call in the module, as written: the list read sends {} and the report sends `body` (the dict report_run built from checked keys). Anything else fails."""
    calls = re.findall(r"\.api\((.*)\)\s*(?:#.*)?$", src, re.MULTILINE)
    return len(calls) == 2 and sorted(c.strip() for c in calls) == ['"POST", REPORT_ROUTE, body', '"POST", ROUTE, {}']


def no_leak(si, dirs):
    blob = json.dumps(si.reports())
    secrets = [PHRASE, "Private_", "Ana", "Users", "\\\\", "C:", "/tmp", *NAMES, *[str(d) for d in dirs.values()]]
    return [x for x in secrets if x in blob]


with tempfile.TemporaryDirectory() as tmp:
    # ---- the list keeps folder NAMES and the site's fingerprint; the page-facing item has no path
    si, run, dirs, seen = setup(tmp)
    item = run.airq.status()["requests"][0]
    check("the listed request carries the folder names and the site's fingerprint", item["folders"] == NAMES and item["sha256"] == SITE_SHA, item)

    # ---- a full Plan then Build: states, counts, key name, fingerprint
    r = run.plan(PID)
    wait(run)
    st = run.status()
    check("plan: the draft is made and the person is told in words", r == {"started": True} and st["state"] == "drafted" and "Ready to build" in st["words"], st)
    cmd = seen[0]
    check("plan runs draft-request with --preview and the report file for this project", "--preview" in cmd and arg(cmd, "--project") == PID and has_flag(cmd, "--report-file"), cmd)
    check("plan hands the engine NAME=folder for each name, on its command line only", folder_args(cmd) == sorted(f"{n}={dirs[n]}" for n in NAMES), cmd)
    check("the engine's `done` of a PLAN is not sent (no film yet)", [b["state"] for b in si.reports()] == ["planning", "matching"], si.reports())
    run.build(PID)
    wait(run)
    st = run.status()
    check("build: the film is built and says it never left", st["state"] == "built" and st["film"].endswith(".mp4") and "never sent" in st["next"], st)
    check("reports go planning, matching, building, done", [b["state"] for b in si.reports()] == ["planning", "matching", "building", "done"], [b["state"] for b in si.reports()])
    check("the route key is project_id and the site's fingerprint replaces the engine's", all(b["project_id"] == PID and b["request_sha256"] == SITE_SHA and "project" not in b for b in si.reports()), si.reports()[0])
    check("only the keys the route takes are sent", all(set(b) <= set(RR.REPORT_KEYS) for b in si.reports()), si.reports())
    check("done carries counts and seconds", si.reports()[-1].get("matches") == 7 and si.reports()[-1].get("film_seconds") == 12.5, si.reports()[-1])

    # ---- PIN 1: reports never carry a path (or a folder name, the phrase, or a word)
    check("PIN reports never carry a path, a folder name or the phrase", no_leak(si, dirs) == [], no_leak(si, dirs))
    sent_before = len(si.calls)
    bad = [{"project_id": PID, "request_sha256": SITE_SHA, "state": "matching", "matches": "C:\\Users\\Ana\\Videos"},
           {"project_id": PID, "request_sha256": SITE_SHA, "state": "failed", "error_code": "C:\\Users\\Ana\\x"},
           {"project_id": PID, "request_sha256": SITE_SHA, "state": "matching", "path": "C:\\x"},
           {"project_id": PID, "request_sha256": SITE_SHA, "state": "matching", "folder": "Holiday Clips"},
           {"project_id": PID, "request_sha256": SITE_SHA, "state": "failed", "error_code": "Your videos say purple elephant"},
           {"project_id": PID, "request_sha256": "http://x.example/a", "state": "matching"}]
    check("PIN report_run refuses a path, an extra key, a sentence or an address and sends nothing", all(RR.report_run(si, b) == "app_refused" for b in bad) and len(si.calls) == sent_before, len(si.calls) - sent_before)
    good = {"project_id": PID, "request_sha256": SITE_SHA, "state": "matching", "matches": 3, "clips": 3}
    n0 = len(si.calls)
    check("v2 report_run sends project_id exactly as given (no translation) and refuses the old key `project`", RR.report_run(si, good) == "ok" and si.calls[-1][2]["project_id"] == PID
          and RR.report_run(si, {**good, "project": PID}) == "app_refused" and RR.report_run(si, {**{k: v for k, v in good.items() if k != "project_id"}, "project": PID}) == "app_refused" and len(si.calls) == n0 + 1, si.calls[-1:])
    check("PIN report_run answers `offline` (never raises) when the site cannot be reached, `ok` when it takes the report", RR.report_run(SignIn(fail=True), good) == "offline" and RR.report_run(SignIn(), good) == "ok")
check("report_run never raises on junk (a report it will not send is `app_refused`; no sign-in at all is `offline`)", RR.report_run(si, None) == "app_refused" and RR.report_run(None, bad[0]) == "app_refused" and RR.report_run(si, {"state": object()}) == "app_refused" and RR.report_run(None, good) == "offline")

with tempfile.TemporaryDirectory() as tmp:
    # ---- PIN 2: a failing report never stops a build
    si, run, dirs, seen = setup(tmp, fail=True)
    run.plan(PID)
    wait(run)
    run.build(PID)
    wait(run)
    st = run.status()
    check("PIN every report fails (offline) and the plan and the build still finish", st["state"] == "built" and Path(run.job["film"]).is_file(), st)
    check("the failures are counted, not raised", st["reports_not_sent"] >= 4, st)
    boom = RR.RunReporter(si, PID, SITE_SHA, send=lambda p: 1 / 0)
    boom.step("planning")
    check("a sender that raises is swallowed by the reporter", boom.failures == 1 and boom.started)

with tempfile.TemporaryDirectory() as tmp:
    # ---- PIN 3: a cancelled run reports cancelled
    si, run, dirs, seen = setup(tmp, plan="hang")
    run.plan(PID)
    time.sleep(0.15)
    t0 = time.time()
    st = run.cancel()
    check("cancel answers at once (the report goes out from a background thread)", time.time() - t0 < 1.0, time.time() - t0)
    wait(run)
    check("PIN a cancelled plan says so in words", st["state"] == "cancelled" and "Stopped" in st["words"], st)
    check("PIN a cancelled run reports cancelled to the site, last", [b["state"] for b in si.reports()][-1] == "cancelled" and si.reports()[-1].get("error_code") is None, si.reports())
    n_sent = len(si.reports())
    check("nothing is sent after a final report", run.last_rep.step("matching") is False and len(si.reports()) == n_sent)

with tempfile.TemporaryDirectory() as tmp:
    # a planned-but-never-built run is closed as cancelled when the next Plan starts (the site holds one active run per account)
    si, run, dirs, seen = setup(tmp)
    run.plan(PID)
    wait(run)
    run.plan(PID)
    wait(run)
    states = [b["state"] for b in si.reports()]
    check("a new Plan closes the earlier unbuilt run as cancelled first", states[:4] == ["planning", "matching", "cancelled", "planning"], states)

with tempfile.TemporaryDirectory() as tmp:
    # ---- PIN 4: a folder not chosen reports folder_not_chosen
    si, run, dirs, seen = setup(tmp, choose=False)
    r = run.plan(PID)
    st = run.status()
    wait(run)
    check("PIN folder not chosen: nothing is run", r["started"] is False and seen == [], (r, seen))
    check("PIN folder not chosen: the site hears planning then failed folder_not_chosen", [(b["state"], b.get("error_code")) for b in si.reports()] == [("planning", None), ("failed", "folder_not_chosen")], si.reports())
    check("PIN folder not chosen: the person gets the words and the next step", st["words"] == RR.ERROR_WORDS["folder_not_chosen"][0] and "choose where that folder is" in st["next"], st)
    check("folder not chosen: no name or path in what was sent", no_leak(si, dirs) == [], no_leak(si, dirs))
    # one of two chosen is still not chosen; a chosen folder that is gone is folder_missing
    run.folders.set(PID, NAMES[0], dirs[NAMES[0]])
    run.plan(PID)
    wait(run)
    check("one name still missing is folder_not_chosen", run.status()["error_code"] == "folder_not_chosen", run.status())
    run.folders.set(PID, NAMES[1], Path(tmp) / "gone")
    run.plan(PID)
    wait(run)
    check("a chosen folder that is gone is folder_missing", run.status()["error_code"] == "folder_missing", run.status())

with tempfile.TemporaryDirectory() as tmp:
    # ---- an engine refusal is reported with its closed code and the person's words; the engine's sentence is not what the site sees
    si, run, dirs, seen = setup(tmp, plan="not_said")
    run.plan(PID)
    wait(run)
    st = run.status()
    check("an engine refusal: failed with the closed code, in words", st["state"] == "failed" and st["error_code"] == "not_said" and st["words"] == RR.ERROR_WORDS["not_said"][0], st)
    check("an engine refusal reaches the site once, as failed/not_said", [(b["state"], b.get("error_code")) for b in si.reports()] == [("planning", None), ("failed", "not_said")], si.reports())
    # a build that fails
    si, run, dirs, seen = setup(tmp, build="fail")
    run.plan(PID)
    wait(run)
    run.build(PID)
    wait(run)
    check("a failed build reports failed/build_failed", run.status()["error_code"] == "build_failed" and si.reports()[-1]["error_code"] == "build_failed", si.reports()[-1])

# ---- the eleven codes: words for each, one closed list
check("all eleven codes have words and a next step", len(RR.ERROR_CODES) == 11 and all(len(RR.ERROR_WORDS[c]) == 2 and all(RR.ERROR_WORDS[c]) for c in RR.ERROR_CODES))
check("an unknown code is the crash words, never itself", RR.words_for("some_new_code") == RR.ERROR_WORDS["crash"])
si = SignIn()
rp = RR.RunReporter(si, PID, SITE_SHA)
rp.forward({"state": "planning"})
rp.forward({"state": "failed", "error_code": "Your videos say purple elephant"})
check("a failed line with a code off the list is sent as crash", si.reports()[-1]["error_code"] == "crash", si.reports())
si = SignIn()
codes_ok = []
for c in RR.ERROR_CODES:
    rp = RR.RunReporter(si, PID, SITE_SHA)
    rp.forward({"state": "planning"})
    rp.forward({"state": "failed", "error_code": c})
    codes_ok.append(si.reports()[-1]["error_code"] == c)
check("each of the eleven codes is forwarded as itself", all(codes_ok), codes_ok)

# ---- the folder map stays on this computer
with tempfile.TemporaryDirectory() as tmp:
    fm = RR.FolderMap(Path(tmp) / "m.json")
    fm.set(PID, "Holiday Clips", Path(tmp) / "x")
    check("the folder map is a local file and is remembered", RR.FolderMap(Path(tmp) / "m.json").get(PID) == {"Holiday Clips": str(Path(tmp) / "x")})
    src = Path(RR.__file__).read_text(encoding="utf-8")
    check("the only calls to the site are the list read (an empty body) and the report (the checked body)", api_calls_ok(src), re.findall(r"[.]api[(](.*)[)]", src))
    planted = src.replace('signin.api("POST", REPORT_ROUTE, body)', 'signin.api("POST", REPORT_ROUTE, have)')
    check("must-fail: the same check CATCHES a call that hands the folder map (or any other value) to the site", planted != src and not api_calls_ok(planted)
          and not api_calls_ok(src + "        signin.api(" + chr(34) + "POST" + chr(34) + ", x, self.folders._map)" + chr(10)))

# ====================================================================================================== v2: the folds of CC1's review (11-27 09:34)
def states(si):
    return [b["state"] for b in si.reports()]


def until(fn, secs=3.0):
    end = time.time() + secs
    while time.time() < end:
        if fn():
            return True
        time.sleep(0.02)
    return fn()


# ---- MEDIUM 1: a plan waiting for Build is held open on the site only while the page is open; a restart closes what it left open
with tempfile.TemporaryDirectory() as tmp:
    clk = [1000.0]
    si, run, dirs, seen = setup(tmp, rk={"clock": lambda: clk[0], "page_grace_s": 60, "draft_max_s": 6000})
    run.plan(PID)
    wait(run)
    openf = Path(tmp) / "request-open-run.json"
    check("v2 M1 a plan waiting for Build writes the open run to a small local file: project, the site's fingerprint, a time, nothing else",
          openf.is_file() and set(json.loads(openf.read_text(encoding="utf-8"))) == {"project_id", "request_sha256", "at"}, openf.read_text(encoding="utf-8") if openf.is_file() else "no file")
    blob = openf.read_text(encoding="utf-8")
    check("v2 M1 that file holds no path, folder name or phrase", not any(x in blob for x in [PHRASE, "Private_", "Ana", *NAMES, *[str(d) for d in dirs.values()]]), blob)
    for _ in range(5):                                  # the page keeps asking every 10 s: the run stays open well past the 60 s grace
        clk[0] += 30
        run.touch()
        time.sleep(0.06)
    check("v2 M1 while the page keeps asking, the plan stays open on the site (no cancelled report)", run.status()["state"] == "drafted" and "cancelled" not in states(si), (run.status(), states(si)))
    clk[0] += 120                                       # the page is gone: 120 s of silence
    check("v2 M1 with the page gone the plan is closed as cancelled", until(lambda: run.status()["state"] == "cancelled"), run.status())
    wait(run)
    st = run.status()
    check("v2 M1 ... in words, cancelled is the last report, and the file is removed", "page was closed" in st["words"] and states(si)[-1] == "cancelled" and not openf.exists(), (st, states(si)))
    try:
        run.build(PID)
        refused = False
    except RR.RunRefused:
        refused = True
    check("v2 M1 ... and Build is refused for the closed plan (press Plan again)", refused)

with tempfile.TemporaryDirectory() as tmp:
    clk = [1000.0]
    si, run, dirs, seen = setup(tmp, rk={"clock": lambda: clk[0], "page_grace_s": 60, "draft_max_s": 6000})
    run.plan(PID)
    wait(run)
    clk[0] += 7000
    run.touch()                                         # the page is open, but 100 minutes have passed: closed before the site's 2 hours make it stale
    check("v2 M1 a plan that waited over 100 minutes is closed as cancelled even with the page open", until(lambda: run.status()["state"] == "cancelled"), run.status())
    wait(run)
    check("v2 M1 ... with the 'waited too long' words", "waited too long" in run.status()["words"] and states(si)[-1] == "cancelled", (run.status(), states(si)))

with tempfile.TemporaryDirectory() as tmp:
    clk = [5000.0]
    si, run, dirs, seen = setup(tmp, rk={"clock": lambda: clk[0]})
    run.plan(PID)
    wait(run)
    openf = Path(tmp) / "request-open-run.json"
    # the app is closed and started again: a new runner on the same work folder reads the file and closes the run the old one left open
    si2, run2, _d, seen2 = setup(tmp, rk={"clock": lambda: clk[0]})
    check("v2 M1 on start the app closes the run it left open: it reports cancelled for that project and fingerprint, then forgets it", run2.recover() is True, openf.exists())
    run2.join(10)
    check("v2 M1 ... exactly one report, cancelled, with the site's fingerprint and project_id", si2.reports() == [{"project_id": PID, "request_sha256": SITE_SHA, "state": "cancelled"}] and not openf.exists(), (si2.reports(), openf.exists()))
    check("v2 M1 ... and a start with nothing open reports nothing", run2.recover() is False and len(si2.reports()) == 1)
    # offline at that moment: the file is kept for the next START (v3: the page's questions never retry it; that closed the live plan)
    run.plan(PID)
    wait(run)
    si3, run3, _d, _s = setup(tmp, fail=True, rk={"clock": lambda: clk[0]})
    run3.recover()
    run3.join(10)
    check("v2 M1 offline at start: the file is kept for the next start", openf.is_file() and len(si3.reports()) == RR.RETRY_TRIES, (openf.exists(), si3.reports()))
    check("v3 H1 ... recover works once per process: a second call (or the page asking) tries nothing", run3.recover() is False and (clk.__setitem__(0, clk[0] + 61), run3.listing(PID), run3.join(10))[0] is None and len(si3.reports()) == RR.RETRY_TRIES)
    si5, run5, _d, _s = setup(tmp, rk={"clock": lambda: clk[0]})
    run5.recover()
    run5.join(10)
    check("v2 M1 ... and closed at the next start once online", not openf.exists() and len(si5.reports()) == 1 and si5.reports()[-1]["state"] == "cancelled", (openf.exists(), si5.reports()))
    run.plan(PID)
    wait(run)
    # a file older than 3 days, or unreadable, is dropped without a report
    openf.write_text(json.dumps({"project_id": PID, "request_sha256": SITE_SHA, "at": int(clk[0]) - 4 * 86400}), encoding="utf-8")
    si4, run4, _d, _s = setup(tmp, rk={"clock": lambda: clk[0]})
    check("v2 M1 a file older than 3 days is dropped without a report", run4.recover() is False and not openf.exists() and si4.reports() == [])
    si4, run4, _d, _s = setup(tmp, rk={"clock": lambda: clk[0]})
    openf.write_text("not json", encoding="utf-8")
    check("v2 M1 an unreadable file is dropped without a report", run4.recover() is False and not openf.exists() and si4.reports() == [])

with tempfile.TemporaryDirectory() as tmp:
    si, run, dirs, seen = setup(tmp, fail=True)
    run.plan(PID)
    wait(run)
    check("v2 M1 no file is written when the site never took the planning report (nothing is open there)", not (Path(tmp) / "request-open-run.json").exists())

with tempfile.TemporaryDirectory() as tmp:
    si, run, dirs, seen = setup(tmp)
    run.plan(PID)
    wait(run)
    run.build(PID)
    wait(run)
    check("v2 M1 a finished build leaves no open-run file", not (Path(tmp) / "request-open-run.json").exists())

# ---- LOW: a planned run waiting for Build can be cancelled
with tempfile.TemporaryDirectory() as tmp:
    si, run, dirs, seen = setup(tmp)
    run.plan(PID)
    wait(run)
    n_cmds = len(seen)
    st = run.cancel()
    check("v2 a plan waiting for Build can be cancelled: answered at once, in words", st["state"] == "cancelled" and "Stopped" in st["words"], st)
    wait(run)
    check("v2 ... the site hears cancelled, last, and nothing is run", states(si)[-1] == "cancelled" and len(seen) == n_cmds, (states(si), len(seen) - n_cmds))
    try:
        run.build(PID)
        refused = False
    except RR.RunRefused:
        refused = True
    check("v2 ... and Build is then refused", refused)

# ---- LOW: planning and cancel reports go out off the page's thread, so an offline Plan cannot hang
with tempfile.TemporaryDirectory() as tmp:
    si, run, dirs, seen = setup(tmp)
    si.delay = 1.2                                      # every report takes 1.2 s to give up (the real one can take ~20 s)
    t0 = time.time()
    r = run.plan(PID)
    t_plan = time.time() - t0
    t1 = time.time()
    st = run.cancel()
    t_cancel = time.time() - t1
    check("v2 Plan answers at once even when every report is slow", r == {"started": True} and t_plan < 0.6, t_plan)
    check("v2 Cancel answers at once even when every report is slow", st["state"] == "cancelled" and t_cancel < 0.6, t_cancel)
    wait(run)
    check("v2 a Cancel pressed while the first report is going out: the engine never starts, the site hears planning then cancelled", seen == [] and states(si) == ["planning", "cancelled"], (seen, states(si)))
    si.delay = 0
    t0 = time.time()
    run.plan(PID)
    wait(run)
    run.build(PID)
    wait(run)
    check("v2 slow reports do not stop a plan and a build", run.status()["state"] == "built", run.status())

with tempfile.TemporaryDirectory() as tmp:
    si, run, dirs, seen = setup(tmp, choose=False)
    si.delay = 1.2
    t0 = time.time()
    r = run.plan(PID)
    check("v2 a refused Plan (folder not chosen) also answers at once when the reports are slow", r["started"] is False and time.time() - t0 < 0.6 and run.status()["words"] == RR.ERROR_WORDS["folder_not_chosen"][0], time.time() - t0)
    wait(run)

# ---- MEDIUM 3: an engine too old for --report-file / --project / --preview is refused in words, before anything runs or is reported
with tempfile.TemporaryDirectory() as tmp:
    for label, probe in (("help without the flags", lambda: (0, HELP_OLD)), ("a command it does not know", lambda: (2, "error: argument command: invalid choice: 'draft-request'"))):
        si, run, dirs, seen = setup(tmp, rk={"probe": probe})
        try:
            run.plan(PID)
            got = None
        except RR.RunRefused as e:
            got = str(e)
        check("v2 M3 an engine too old (" + label + ") is refused in plain words", got == "This version of the Ryagram engine is too old to make compilations. Update the engine.", got)
        check("v2 M3 ... nothing was run, nothing was reported, no run was opened", seen == [] and si.calls == [] and run.job is None and not (Path(tmp) / "request-open-run.json").exists(), (seen, si.calls))
    n = []
    si, run, dirs, seen = setup(tmp, rk={"probe": lambda: (n.append(1), (0, HELP_NEW))[1]})
    run.plan(PID)
    wait(run)
    run.cancel()
    run.plan(PID)
    wait(run)
    check("v2 M3 a good engine is looked at once, then remembered", len(n) == 1, n)
    si, run, dirs, seen = setup(tmp, rk={"probe": lambda: (_ for _ in ()).throw(OSError("no python"))})
    check("v2 M3 a help that cannot be read at all claims nothing: the run goes ahead and says what happens", run.plan(PID) == {"started": True})
    wait(run)

with tempfile.TemporaryDirectory() as tmp:
    # the real probe: a real subprocess against stand-in engines (a package that prints a help text), not the injected one
    def stub_engine(name, helptext, rc=0):
        d = Path(tmp) / name / "ryagram" / "local"
        d.mkdir(parents=True)
        (d.parent / "__init__.py").write_text("", encoding="utf-8")
        (d / "__init__.py").write_text("", encoding="utf-8")
        (d / "__main__.py").write_text("import sys\nprint(" + repr(helptext) + ")\nsys.exit(" + str(rc) + ")\n", encoding="utf-8")
        return Path(tmp) / name
    si, base, dirs, seen = setup(tmp)
    got = {}
    for name, txt in (("eng_old", HELP_OLD), ("eng_new", HELP_NEW)):
        r2 = RR.RequestRunner(base.airq, si, base.folders, engine_dir=stub_engine(name, txt), work_dir=Path(tmp) / "w2", out_dir=Path(tmp) / "f2", popen=make_popen(), probe=None)
        got[name] = r2.engine_problem()
    check("v2 M3 the real probe (the engine's own --help, run for real) refuses a help without the flags and accepts one with them", got == {"eng_old": RR.OLD_ENGINE_WORDS, "eng_new": None}, got)

# ---- LOW: the runner uses the CLEANED folder names, so the name rule and the 8-folder cap apply
with tempfile.TemporaryDirectory() as tmp:
    padded = {**REQUEST, "folders": ["  " + NAMES[0], NAMES[1] + " "]}
    si, run, dirs, seen = setup(tmp, request=padded)
    run.plan(PID)
    wait(run)
    cmd = seen[0]
    sent_req = json.loads((Path(arg(cmd, "--out")).parent / "request.json").read_text(encoding="utf-8"))
    check("v2 the engine is handed the cleaned names (trimmed), in the request file and on the command line", sent_req["folders"] == NAMES and folder_args(cmd) == sorted(f"{n}={dirs[n]}" for n in NAMES), (sent_req["folders"], cmd))

with tempfile.TemporaryDirectory() as tmp:
    many = {**REQUEST, "folders": [f"Reel {i}" for i in range(1, 10)]}            # 9 names: over the engine's cap of 8
    si, run, dirs, seen = setup(tmp, request=many)
    item = run.airq.status()["requests"][0]
    r = run.plan(PID)
    wait(run)
    check("v2 the 8-folder cap applies: the page lists 8 and a request with 9 is not run (request_invalid), nothing is started", len(item["folders"]) == 8 and r["started"] is False and r["error_code"] == "request_invalid" and seen == [], (len(item["folders"]), r, seen))
    check("v2 ... the site hears planning then failed/request_invalid", [(b["state"], b.get("error_code")) for b in si.reports()] == [("planning", None), ("failed", "request_invalid")], si.reports())
    bad_name = {**REQUEST, "folders": [NAMES[0], "Reel/two"]}                       # a name the name rule refuses
    si, run, dirs, seen = setup(tmp, request=bad_name)
    r = run.plan(PID)
    wait(run)
    check("v2 the name rule applies: a request with a name the rule refuses is not run", r["started"] is False and r["error_code"] == "request_invalid" and seen == [], (r, seen))

# ---- the desktop maker's own doors: Build has the busy check and the room check Plan has, and the default model is prechecked
try:
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "tools"))
    import desktop_maker as D
except Exception as e:  # noqa: BLE001
    D = None
    check("v2 desktop_maker imports for the door checks", False, repr(e))
if D is not None:
    import os

    class FakeRunner:
        def __init__(self):
            self.is_busy, self.calls = False, []

        def busy(self):
            return self.is_busy

        def plan(self, pid, model):
            self.calls.append(("plan", pid, model))
            return {"started": True}

        def build(self, pid):
            self.calls.append(("build", pid))
            return {"started": True}

    def problem_of(fn, body):
        try:
            fn(body)
            return None
        except D.Problem as e:
            return str(e)

    body = {"project_id": PID}
    fr = FakeRunner()
    saved = (D.STATE.get("runner"), D.STATE.get("job"), D.clip_room_problem, D.faster_whisper_missing, os.environ.get("RYAGRAM_MODEL_DIR"))
    try:
        D.STATE["runner"], D.STATE["job"] = fr, None
        os.environ.pop("RYAGRAM_MODEL_DIR", None)
        D.clip_room_problem = lambda: None
        D.faster_whisper_missing = lambda: False
        check("v2 M2 with nothing in the way, Plan and Build both start", problem_of(D.request_plan, body) is None and problem_of(D.request_build, body) is None and [c[0] for c in fr.calls] == ["plan", "build"], fr.calls)
        D.STATE["job"] = {"proc": FakeProc(0, hold=True)}
        a, b = problem_of(D.request_plan, body), problem_of(D.request_build, body)
        check("v2 M2 Build has the same 'something is already running' check Plan has", a and a == b and "already running" in a, (a, b))
        D.STATE["job"] = None
        fr.is_busy = True
        a, b = problem_of(D.request_plan, body), problem_of(D.request_build, body)
        check("v2 M2 Build has the same 'a request is being worked on' check Plan has", a and a == b and "being worked on" in a, (a, b))
        fr.is_busy = False
        D.clip_room_problem = lambda: "A site film is being made and there is too little room on the graphics card."
        a, b = problem_of(D.request_plan, body), problem_of(D.request_build, body)
        check("v2 M2 both run clip_room_problem and show its sentence", a and a == b and "graphics card" in a, (a, b))
        D.clip_room_problem = lambda: None
        fr.calls.clear()
        problem_of(D.request_plan, body)
        check("v2 the default model is Balanced (small) when the page names none", fr.calls == [("plan", PID, D.default_model())] and D.default_model() == "small", fr.calls)
        with tempfile.TemporaryDirectory() as mroot:
            os.environ["RYAGRAM_MODEL_DIR"] = mroot
            fr.calls.clear()
            a = problem_of(D.request_plan, body)
            check("v2 the default model gets the maker's own precheck: not on this computer -> its sentence, and Plan is not run", a == D.missing_model_sentence("small") and fr.calls == [], (a, fr.calls))
            snap = Path(mroot) / "models--Systran--faster-whisper-small" / "snapshots" / "x"
            snap.mkdir(parents=True)
            (snap / "model.bin").write_bytes(b"w")
            check("v2 ... and once the model is there Plan runs", problem_of(D.request_plan, body) is None and fr.calls and fr.calls[-1][2] == "small", fr.calls)
        os.environ.pop("RYAGRAM_MODEL_DIR", None)
        D.faster_whisper_missing = lambda: True
        a = problem_of(D.request_plan, body)
        check("v2 ... a missing speech add-on is refused in the maker's words", a and "speech add-on" in a, a)
        D.faster_whisper_missing = lambda: False
        fr.calls.clear()
        a = problem_of(D.request_plan, {**body, "model": "huge"})
        check("v2 ... a model the engine does not offer is refused", a and "Pick one" in a and fr.calls == [], (a, fr.calls))
    finally:
        D.STATE["runner"], D.STATE["job"], D.clip_room_problem, D.faster_whisper_missing = saved[:4]
        if saved[4] is None:
            os.environ.pop("RYAGRAM_MODEL_DIR", None)
        else:
            os.environ["RYAGRAM_MODEL_DIR"] = saved[4]
    page = Path(D.__file__).read_text(encoding="utf-8")
    check("v2 the page shows reports_not_sent in words, lets a waiting plan be cancelled, and asks every 10 s while a plan waits",
          "run.reports_not_sent > 0" in page and "!(busy || waiting)" in page and "setTimeout(draw, 10000)" in page and "box.isConnected" in page)
    check("v2 the page's question about the run is what tells the app it is open (touch) and make_server hands the runner its state file and recovers",
          "r.touch()" in page and "state_file=Path(STATE[\"work\"]) / _rq.OPEN_NAME" in page and "STATE[\"runner\"].recover()" in page)

# ====================================================================================================== v3: the fresh review of v2 (11-27)
# ---- HIGH: the page's own 10-second question must not close the plan the app is holding
with tempfile.TemporaryDirectory() as tmp:
    si, run, dirs, seen = setup(tmp)                    # a state file, the page open (grace huge), the real clock
    run.plan(PID)
    wait(run)
    openf = Path(tmp) / "request-open-run.json"
    for _ in range(2):                                  # the page's poll: request_run_status -> touch() + listing()
        run.touch()
        run.listing(PID)
        run.join(10)
    check("v3 H1 polling the list while a plan waits for Build does not cancel the plan", run.status()["state"] == "drafted" and "cancelled" not in states(si) and openf.is_file(), (run.status(), states(si)))
    try:
        run.build(PID)
        got = None
    except RR.RunRefused as e:
        got = str(e)
    wait(run)
    check("v3 H1 ... Build then runs and the site hears planning, matching, building, done (no cancelled)", got is None and states(si) == ["planning", "matching", "building", "done"], (got, states(si)))

with tempfile.TemporaryDirectory() as tmp:
    # an open-run file that belongs to a run THIS process holds is never closed by recover(), even on its first call
    si, run, dirs, seen = setup(tmp)
    run.plan(PID)
    wait(run)
    n0 = len(si.reports())
    check("v3 H1 recover() leaves the open-run file of a run this process holds alone (no report, file kept)", run.recover() is False and len(si.reports()) == n0 and (Path(tmp) / "request-open-run.json").is_file(), si.reports())
    import inspect
    check("v3 H1 the page's question (listing) does not call recover",
          "recover" not in inspect.getsource(RR.RequestRunner.listing) and (D is None or "recover" not in inspect.getsource(D.request_run_status)))

# ---- MEDIUM: a folder name that starts with '-' is refused; no value can be read as an option
with tempfile.TemporaryDirectory() as tmp:
    dash = {**REQUEST, "folders": ["--out", NAMES[1]]}
    si, run, dirs, seen = setup(tmp, request=dash)
    r = run.plan(PID)
    wait(run)
    check("v3 M1 a request with a folder name that starts with '-' is not run (request_invalid) and the page does not list it",
          r["started"] is False and r["error_code"] == "request_invalid" and seen == [] and run.airq.status()["requests"][0]["folders"] == [NAMES[1]], (r, seen))
    check("v3 M1 ... the runner's own check also refuses such a name (a name that got past the cleaning)", run._folder_problem(["-x", NAMES[1]], {"-x": str(dirs[NAMES[0]]), NAMES[1]: str(dirs[NAMES[1]])}) == "request_invalid")

import argparse
import contextlib


def engine_parser():
    """The shape of the engine's two commands, in real argparse."""
    ap = argparse.ArgumentParser(prog="ryagram.local", exit_on_error=False)
    sub = ap.add_subparsers(dest="cmd")
    d = sub.add_parser("draft-request")
    d.add_argument("request")
    for f in ("--work-dir", "--out", "--model", "--report-file", "--project", "--request-sha256"):
        d.add_argument(f)
    d.add_argument("--preview", action="store_true")
    d.add_argument("--folder", action="append", default=[])
    b = sub.add_parser("build-edit")
    b.add_argument("edit")
    for f in ("--work-dir", "--out"):
        b.add_argument(f)
    b.add_argument("--media", action="append", default=[])
    return ap


with tempfile.TemporaryDirectory() as tmp:
    wd, out, rf = Path(tmp) / "wd", Path(tmp) / "draft.json", Path(tmp) / "report.jsonl"
    odd = [("--out", "C:/Videos"), ("-v", "-x"), ("Plain", "--out=C:/Videos")]       # a name or a path that would read as an option
    cmd = RR.plan_command("py", Path(tmp) / "request.json", wd, out, "small", rf, PID, odd, SITE_SHA)
    ns = engine_parser().parse_args(cmd[3:])
    check("v3 M1 every value reaches the engine as a value: an option-looking folder name or path changes no option", ns.out == str(out) and ns.work_dir == str(wd) and ns.report_file == str(rf) and ns.project == PID and ns.request_sha256 == SITE_SHA
          and ns.folder == [f"{n}={p}" for n, p in odd] and ns.request == str(Path(tmp) / "request.json") and ns.model == "small" and ns.preview is True, vars(ns))
    film = Path(tmp) / "film.mp4"
    cmd = RR.build_command("py", Path(tmp) / "-edit.json", Path(tmp) / "cut", film, ["--out=C:/Videos", "-x"])
    ns = engine_parser().parse_args(cmd[3:])
    check("v3 M1 ... Build too: media paths and the edit file never read as options", ns.out == str(film) and ns.media == ["--out=C:/Videos", "-x"] and ns.edit == str(Path(tmp) / "-edit.json"), vars(ns))
    old_style = ["build-edit", "--out", str(film), "--media", "--out=C:/Videos", str(Path(tmp) / "e.json")]
    try:
        with contextlib.redirect_stderr(io.StringIO()):
            bad_ns = engine_parser().parse_args(old_style)
        broke = bad_ns.out != str(film) or bad_ns.media != ["--out=C:/Videos"]
    except (argparse.ArgumentError, SystemExit):
        broke = True
    check("v3 M1 must-fail: the same parser DOES read an option-looking value as an option when it is passed as a separate argument", broke)
with tempfile.TemporaryDirectory() as tmp:
    si, run, dirs, seen = setup(tmp)
    run.plan(PID)
    wait(run)
    run.build(PID)
    wait(run)
    OPTS = ("--out", "--work-dir", "--media", "--folder", "--model", "--project", "--report-file", "--request-sha256")
    parsed = [engine_parser().parse_args(c[3:]) for c in seen]
    check("v3 M1 the real Plan and Build command lines parse, with every path after `--` or as --flag=value", len(seen) == 2 and all("--" in c for c in seen) and not any(c in OPTS for cmd2 in seen for c in cmd2) and parsed[0].request.endswith("request.json") and parsed[1].edit.endswith("edit.json"), seen)

# ---- LOW: the engine's last output line never reaches the page
with tempfile.TemporaryDirectory() as tmp:
    base_popen = make_popen()
    leak = "wrote C:\\Users\\Ana\\Private_Holiday_Clips\\draft.json for purple elephant"

    def popen_leaky(cmd, **kw):
        p = base_popen(cmd, **kw)
        if "draft-request" in cmd:
            p.stdout = io.StringIO(leak + "\n")
        return p
    si, run, dirs, seen = setup(tmp)
    run.popen = popen_leaky
    run.plan(PID)
    wait(run)
    blob = json.dumps(run.status())
    check("v3 L1 the engine's last output line (it may hold a path) is not in what the page is given", run.status()["state"] == "drafted" and "says" not in run.status() and "Ana" not in blob and "Private_" not in blob and "elephant" not in blob, blob)
    check("v3 L1 ... the page script does not read run.says either", D is None or "run.says" not in Path(D.__file__).read_text(encoding="utf-8"))
    run.build(PID)
    wait(run)
    blob = json.dumps(run.status())
    check("v3 L1 ... nor after Build (only fixed sentences, counts and the closed code)", run.status()["state"] == "built" and "Ana" not in blob and "Private_" not in blob, blob)

# ---- LOW: the thread list is pruned when threads finish
with tempfile.TemporaryDirectory() as tmp:
    si, run, dirs, seen = setup(tmp)
    peak = 0
    for _ in range(8):
        run.plan(PID)
        wait(run)
        run.cancel()
        wait(run)
        peak = max(peak, len(run._threads))
    run.plan(PID)
    wait(run)
    run.join(10)
    time.sleep(0.1)
    check("v3 L2 finished threads are forgotten: after eight Plan and Cancel rounds the list holds only live threads", all(t.is_alive() for t in run._threads) and len(run._threads) <= 3 and peak <= 3, (len(run._threads), peak))

with tempfile.TemporaryDirectory() as tmp:
    si, run, dirs, seen = setup(tmp)
    for _ in range(20):
        run._bg(lambda: None)
        time.sleep(0.01)
    time.sleep(0.1)
    run._bg(lambda: None)
    check("v3 L2 starting threads forgets the ones that finished (without anyone calling join)", len(run._threads) <= 2, len(run._threads))

# ---- LOW: a Cancel followed by a new Plan gets a fresh work folder
with tempfile.TemporaryDirectory() as tmp:
    si, run, dirs, seen = setup(tmp, plan="hang")
    run.plan(PID)
    time.sleep(0.15)
    run.cancel()
    wait(run)
    run.plan(PID)
    time.sleep(0.15)
    first, second = seen[0], seen[1]
    check("v3 L2 a Plan after a cancel gets its own work folder and report file (the killed engine may still hold the old ones)",
          arg(first, "--work-dir") != arg(second, "--work-dir") and arg(first, "--report-file") != arg(second, "--report-file") and Path(arg(second, "--work-dir")).is_dir(), (first, second))
    run.cancel()
    wait(run)
with tempfile.TemporaryDirectory() as tmp:
    si, run, dirs, seen = setup(tmp)
    run.plan(PID)
    wait(run)
    run.plan(PID)
    wait(run)
    check("v3 L2 ... a Plan after an UNcancelled plan keeps the same folder (nothing to avoid)", arg(seen[0], "--work-dir") == arg(seen[1], "--work-dir"), seen)

# ---- LOW: two names that mean the same chosen folder are refused in words
with tempfile.TemporaryDirectory() as tmp:
    si, run, dirs, seen = setup(tmp)
    run.folders.set(PID, NAMES[1], dirs[NAMES[0]])
    r = run.plan(PID)
    wait(run)
    st = run.status()
    check("v3 L5 two names chosen as the same folder: nothing is run, the site hears planning then failed/folders_overlap, in words",
          r == {"started": False, "error_code": "folders_overlap"} and seen == [] and [(b["state"], b.get("error_code")) for b in si.reports()] == [("planning", None), ("failed", "folders_overlap")]
          and st["words"] == RR.ERROR_WORDS["folders_overlap"][0], (r, st, si.reports()))
    inner = dirs[NAMES[0]] / "inside"
    inner.mkdir()
    run.folders.set(PID, NAMES[1], inner)
    r = run.plan(PID)
    wait(run)
    check("v3 L5 ... and one chosen folder inside the other is the same", r.get("error_code") == "folders_overlap" and seen == [], (r, seen))
    run.folders.set(PID, NAMES[1], dirs[NAMES[1]])
    check("v3 L5 ... two different folders are fine", run.plan(PID) == {"started": True})
    wait(run)

# ====================================================================================================== v4: WORKER's review of v3 (11-27 11:48) and ENGINE's (11:47)
import os
import subprocess

ENGINE_DIR = os.environ.get("RYAGRAM_ENGINE_DIR", "")          # an export of the engine train (faces-compilations-harden-restack-1127); the checks that need it say SKIPPED when it is not set
ENV = dict(os.environ, NO_PROXY="127.0.0.1,localhost", PYTHONDONTWRITEBYTECODE="1", PYTHONIOENCODING="utf-8")


def refused_words(fn):
    """The plain sentence a RunRefused carries, or None when the call did not refuse."""
    try:
        fn()
    except RR.RunRefused as e:
        return str(e)
    return None


# ---- HIGH: the app passes the site's own fingerprint, and its help check looks for the flag
with tempfile.TemporaryDirectory() as tmp:
    si, run, dirs, seen = setup(tmp)
    run.plan(PID)
    wait(run)
    check("v4 H1 Plan hands the engine --request-sha256=<the site's fingerprint> (not one computed here)", has_flag(seen[0], "--request-sha256") and arg(seen[0], "--request-sha256") == SITE_SHA and "cd" * 32 not in " ".join(seen[0]), seen[0])
    check("v4 H1 ... the flag is one of the engine flags the help check looks for", "--request-sha256" in RR.ENGINE_FLAGS)
    si, run, dirs, seen = setup(tmp, rk={"probe": lambda: (0, HELP_NO_SHA)})
    check("v4 H1 an engine whose help lacks --request-sha256 is 'too old' (it would refuse every Plan): said before anything runs, nothing reported",
          refused_words(lambda: run.plan(PID)) == RR.OLD_ENGINE_WORDS and seen == [] and si.reports() == [], (seen, si.reports()))

# ---- HIGH, against the REAL engine: the flag set the app builds is the flag set the engine takes
if not ENGINE_DIR or not (Path(ENGINE_DIR) / "ryagram" / "local" / "__main__.py").is_file():
    print("SKIPPED  v4 H1 the real-engine checks (set RYAGRAM_ENGINE_DIR to an export of the engine train, faces-compilations-harden-restack-1127): NOT RUN, not a pass")
else:
    eenv = dict(ENV, PYTHONPATH=ENGINE_DIR)

    def engine(args, cwd):
        r = subprocess.run([sys.executable, "-B", "-m", "ryagram.local", *args], cwd=cwd, env=eenv, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=120)
        return r.returncode, r.stdout, r.stderr

    with tempfile.TemporaryDirectory() as tmp:
        rc, out, err = engine(["draft-request", "--help"], tmp)
        helptext = out + err
        check("v4 H1 real engine: `draft-request --help` runs and every flag the app looks for is in it", rc == 0 and all(f in helptext for f in RR.ENGINE_FLAGS), (rc, [f for f in RR.ENGINE_FLAGS if f not in helptext]))
        wd, out_f, rf = Path(tmp) / "wd", Path(tmp) / "draft.json", Path(tmp) / "report.jsonl"
        reqf = Path(tmp) / "request.json"
        reqf.write_text(json.dumps(REQUEST), encoding="utf-8")
        empty = [(n, str(Path(tmp) / ("Empty " + str(i)))) for i, n in enumerate(NAMES)]
        for _n, pth in empty:
            Path(pth).mkdir()
        cmd = RR.plan_command(sys.executable, reqf, wd, out_f, "base", rf, PID, empty, SITE_SHA)
        flags = sorted({c.split("=", 1)[0] for c in cmd[3:] if c.startswith("--") and c != "--"})
        check("v4 H1 real engine: every option the app's Plan command uses is in the engine's own help", all(f in helptext for f in flags), [f for f in flags if f not in helptext])
        rc, out, err = engine(cmd[3:], tmp)
        lines = [json.loads(x) for x in rf.read_text(encoding="utf-8").splitlines()] if rf.is_file() else []
        check("v4 H1 real engine: the app's own Plan command PARSES: it ends in a closed refusal (exit 2, `refused:`, the report's last line failed with a code), not a usage error or an unrecognised argument",
              rc == 2 and "unrecognized" not in err and "usage:" not in err and err.lstrip().startswith("refused:") and bool(lines) and lines[-1]["state"] == "failed" and lines[-1]["error_code"] in RR.ERROR_CODES
              and lines[-1]["error_code"] != "request_invalid", (rc, err[-300:], lines[-1:]))
        check("v4 H1 real engine: its reports carry the site's own fingerprint, the keys the route takes, and the project", bool(lines) and all(x["request_sha256"] == SITE_SHA and x["project_id"] == PID and set(x) <= set(RR.REPORT_KEYS) for x in lines), lines[:1])
        # the control: the v3 command (no --request-sha256) is REFUSED by this engine: the test would have caught the v3 bug
        v3cmd = [c for c in cmd if not c.startswith("--request-sha256=")]
        rf.unlink()
        rc3, out3, err3 = engine(v3cmd[3:], tmp)
        check("v4 H1 real engine, control: the same command WITHOUT --request-sha256 is refused ('--report-file needs --request-sha256') and writes no report: the v3 bug, caught",
              rc3 == 2 and "--report-file needs --request-sha256" in err3 and not rf.is_file(), (rc3, err3[-200:]))
        # a misspelt flag is a usage error (rc 2 with 'unrecognized arguments'): what 'parses' must tell apart from a refusal
        rcx, outx, errx = engine([*cmd[3:-2], "--no-such-flag=1", *cmd[-2:]], tmp)
        check("v4 H1 real engine, control: an unknown flag IS a usage error here (so the check above does tell a usage error from a refusal)", rcx == 2 and "unrecognized arguments" in errx, errx[-200:])
        # the whole runner, real popen, real engine: the empty folders are said by the ENGINE in a closed code, and the site hears it
        si = SignIn()
        airq = RR.AiRequests(si, clock=lambda: 1e9)
        airq.status(force=True)
        fm = RR.FolderMap(Path(tmp) / "request-folders.json")
        for n, pth in empty:
            fm.set(PID, n, pth)
        real = RR.RequestRunner(airq, si, fm, engine_dir=ENGINE_DIR, work_dir=Path(tmp) / "work", out_dir=Path(tmp) / "films", python=sys.executable, state_file=Path(tmp) / "open.json", page_grace_s=1e6, reap_s=0.05)
        check("v4 H1 real engine: the runner's own help check (the real probe) accepts this engine", real.engine_problem() is None, real.engine_problem())
        res = real.plan(PID)
        real.join(120)
        st = real.status()
        check("v4 H1 real engine: Plan through the runner ends as the engine's own closed code (folder_empty), NOT request_invalid, and the site heard planning then failed/folder_empty",
              res == {"started": True} and st["state"] == "failed" and st["error_code"] == "folder_empty" and [(b["state"], b.get("error_code")) for b in si.reports()] == [("planning", None), ("failed", "folder_empty")]
              and all(b["request_sha256"] == SITE_SHA for b in si.reports()), (res, st, si.reports()))
        # the folder cap: the app and the engine say the same number
        src_fr = (Path(ENGINE_DIR) / "ryagram" / "local" / "from_request.py").read_text(encoding="utf-8")
        cap = re.search(r"^MAX_FOLDERS\s*=\s*(\d+)", src_fr, re.MULTILINE)
        check("v4 M2 the app's folder cap is the engine's folder cap (from_request.MAX_FOLDERS)", bool(cap) and int(cap.group(1)) == RR.MAX_FOLDERS, (cap and cap.group(0), RR.MAX_FOLDERS))

# ---- MEDIUM: report_run tells a server refusal from being offline, in a closed list
class Reply:
    def __init__(self, status, obj=None, boom=None):
        self.status, self.obj, self.boom = status, obj, boom

    def api(self, method, route, body):
        if self.boom:
            raise self.boom
        return self.status, self.obj


GOOD = {"project_id": PID, "request_sha256": SITE_SHA, "state": "matching", "matches": 1, "clips": 1}
SECRET = "Your videos are in C:\\Users\\Ana\\Private and say purple elephant"
CASES = [((200, {"run_id": 4}), "ok"), ((404, {"error": "not_current", "message": SECRET}), "not_current"), ((409, {"error": "busy", "message": SECRET}), "busy"),
         ((403, {"error": "not_open", "message": SECRET}), "not_open"), ((400, {"error": "invalid_request"}), "refused"), ((429, {"error": "too_many"}), "too_many"),
         ((403, {"error": "something_new"}), "refused"), ((200, {"no_run_id": 1}), "refused"), ((500, {"error": "oops"}), "offline"), ((502, None), "offline"), ((0, None), "offline")]
got = [RR.report_run(Reply(*c), GOOD) for c, _w in CASES]
check("v4 M1 report_run answers one word of the closed list for each reply: ok / not_current / busy / not_open / refused / offline", got == [w for _c, w in CASES] and set(got) <= set(RR.REPORT_RESULTS), got)
check("v4 M1 ... a connection that fails or a computer that was removed is `offline`; a report the module will not send is `app_refused`",
      RR.report_run(Reply(0, boom=OSError("no internet")), GOOD) == "offline" and RR.report_run(Reply(0, boom=ValueError("removed")), GOOD) == "offline" and RR.report_run(Reply(200, {"run_id": 1}), {**GOOD, "path": "x"}) == "app_refused")

with tempfile.TemporaryDirectory() as tmp:
    # the runner keeps what the site said as a closed word and shows OUR sentence, never the site's text; offline stays the plain 'not sent'
    for err, word in (("not_current", "not_current"), ("busy", "busy"), ("not_open", "not_open")):
        si, run, dirs, seen = setup(tmp)
        si.respond = lambda route, body, err=err: None if body["state"] == "planning" else (404 if err == "not_current" else 409 if err == "busy" else 403, {"error": err, "message": SECRET})        # (v6: a refused OPENING stops the run; here the site takes `planning` and refuses the rest)
        run.plan(PID)
        wait(run)
        st = run.status()
        check(f"v4 M1 a server refusal ({word}) is told apart from offline: the status carries the closed word and our own sentence, still drafted, nothing of the site's text",
              st["state"] == "drafted" and st["site_said"] == word and st["site_words"] == RR.SITE_WORDS[word] and "Ana" not in json.dumps(st) and "elephant" not in json.dumps(st), st)
    si, run, dirs, seen = setup(tmp, fail=True)
    run.plan(PID)
    wait(run)
    check("v4 M1 offline is not a refusal: no site_said, the plain 'not sent' count", "site_said" not in run.status() and run.status()["reports_not_sent"] >= 1, run.status())
    page = Path(D.__file__).read_text(encoding="utf-8") if D is not None else ""
    check("v4 M1 the page shows run.site_words (our sentence) in place of the 'not sent' line", D is None or "run.site_words" in page)

with tempfile.TemporaryDirectory() as tmp:
    # an open-run file: a server answer (even a refusal) clears it, only offline keeps it for the next start
    def open_file(t):
        f = Path(t) / "request-open-run.json"
        f.write_text(json.dumps({"project_id": PID, "request_sha256": SITE_SHA, "at": int(time.time())}), encoding="utf-8")
        return f
    out = {}
    for name, rsp in (("refused", lambda r, b: (404, {"error": "not_current"})), ("ok", None), ("offline", lambda r, b: (_ for _ in ()).throw(OSError("no internet")))):
        sub = Path(tmp) / name
        sub.mkdir()
        f = open_file(sub)
        si, run, dirs, seen = setup(sub)
        si.respond = rsp
        run.recover()
        wait(run)
        out[name] = f.exists()
    check("v4 M1 recover(): a refusal from the site clears the open-run file (no retry for 3 days); a report that went through clears it; offline keeps it for the next start", out == {"refused": False, "ok": False, "offline": True}, out)

with tempfile.TemporaryDirectory() as tmp:
    # the FINAL report of a run (here: cancelled) that the site refuses is an answer: the open-run file goes; offline keeps it for the next start
    left = {}
    for name, rsp in (("refused", lambda r, b: (404, {"error": "not_current"}) if b["state"] == "cancelled" else None), ("offline", lambda r, b: (_ for _ in ()).throw(OSError("no internet")) if b["state"] == "cancelled" else None)):
        sub = Path(tmp) / ("fin_" + name)
        sub.mkdir()
        si, run, dirs, seen = setup(sub, plan="hang")
        si.respond = rsp
        run.plan(PID)
        time.sleep(0.2)
        was = (sub / "request-open-run.json").exists()
        run.cancel()
        wait(run)
        left[name] = (was, (sub / "request-open-run.json").exists())
    check("v4 M1 a final report the site refuses clears the open-run file; one that fails offline keeps it (it was written when the run opened)", left == {"refused": (True, False), "offline": (True, True)}, left)

# ---- MEDIUM: Plan asks the site again and never runs a request it no longer holds
with tempfile.TemporaryDirectory() as tmp:
    si, run, dirs, seen = setup(tmp)
    reads0 = si.list_reads
    run.plan(PID)
    wait(run)
    check("v4 M1 Plan asks the site once more (a request that is current just runs)", si.list_reads == reads0 + 1 and len(seen) == 1, (si.list_reads - reads0, seen))
    si, run, dirs, seen = setup(tmp)
    si.sha = "cd" * 32                                      # the AI wrote the request again after the list was read
    words = refused_words(lambda: run.plan(PID))
    check("v4 M1 the AI changed the request after the list was read: Plan is refused in words, nothing is run, nothing is reported", words is not None and "changed" in words and seen == [] and si.reports() == [], (words, seen, si.reports()))
    check("v4 M1 ... and the list now holds the new one, so the next Plan runs THAT request, with its fingerprint on the command and in every report",
          run.airq.request_for(PID)[1] == "cd" * 32 and run.plan(PID) == {"started": True} and (wait(run), arg(seen[0], "--request-sha256") == "cd" * 32 and all(b["request_sha256"] == "cd" * 32 for b in si.reports()))[1], (seen, si.reports()))
    si, run, dirs, seen = setup(tmp)
    si.gone = True                                          # the site holds no request for this project any more
    check("v4 M1 the request was removed on the site: Plan is refused, nothing is run", refused_words(lambda: run.plan(PID)) is not None and seen == [] and si.reports() == [], (seen, si.reports()))
    si, run, dirs, seen = setup(tmp)
    si.list_fail = True                                     # the site cannot be reached: the cached request is all there is, and the run goes ahead (its reports then fail quietly)
    check("v4 M1 offline: the site cannot be asked, so the cached request runs (as before)", run.plan(PID) == {"started": True} and (wait(run), len(seen) == 1)[1], seen)
    si, run, dirs, seen = setup(tmp, plan="hang")
    run.plan(PID)
    time.sleep(0.1)
    n = si.list_reads
    check("v4 M1 a Plan refused as busy does not ask the site", refused_words(lambda: run.plan(PID)) is not None and si.list_reads == n, (si.list_reads, n))
    run.cancel()
    wait(run)

# ---- MEDIUM: a heartbeat keeps a long run from being marked stale
class Clock:
    def __init__(self):
        self.t = 1000.0

    def __call__(self):
        return self.t


check("v4 M3 the heartbeat is every 10 minutes, well inside the site's 2 hours", RR.HEARTBEAT_S == 600 and RR.HEARTBEAT_S * 3 < 7200)
clk = Clock()
si = SignIn()
rp = RR.RunReporter(si, PID, SITE_SHA, clock=clk)
rp.step("planning")
rp.forward({"state": "matching", "matches": 3, "clips": 3})
n0 = len(si.reports())
clk.t += 599
a = rp.heartbeat(RR.HEARTBEAT_S)
clk.t += 2
b = rp.heartbeat(RR.HEARTBEAT_S)
c = rp.heartbeat(RR.HEARTBEAT_S)
beat = si.reports()[-1]
check("v4 M3 nothing is sent before the 10 minutes; then the same state goes again with the counts so far, and only once per interval",
      a is False and b is True and c is False and len(si.reports()) == n0 + 1 and beat["state"] == "matching" and beat["matches"] == 3 and beat["request_sha256"] == SITE_SHA and set(beat) <= set(RR.REPORT_KEYS), (a, b, c, beat))
check("v4 M3 a heartbeat is not a step: it is kept apart (`beats`), adds no failure and no line to `sent`", rp.beats == ["ok"] and rp.failures == 0 and len(rp.sent) == 2, (rp.beats, rp.failures, rp.sent))
rp.step("done")
clk.t += 5000
check("v4 M3 after a final report no heartbeat is ever sent", rp.heartbeat(RR.HEARTBEAT_S) is False and si.reports()[-1]["state"] == "done")
# a refused heartbeat (a later server may refuse an equal-state repeat) stops them, silently
clk = Clock()
si = SignIn()
rp = RR.RunReporter(si, PID, SITE_SHA, clock=clk)
rp.step("building")
si.respond = lambda route, body: (400, {"error": "invalid_request"})
clk.t += 700
first = rp.heartbeat(600)
clk.t += 700
second = rp.heartbeat(600)
check("v4 M3 the site refuses a repeat: that heartbeat is the last (silently: no failure counted, nothing shown, no refusal recorded)", first is True and second is False and rp.beats == ["refused"] and rp.failures == 0 and rp.last_refusal is None, (first, second, rp.beats))
# offline heartbeat: tried again next interval
clk = Clock()
si = SignIn(fail=True)
rp = RR.RunReporter(si, PID, SITE_SHA, clock=clk)
rp.step("building")
clk.t += 700
rp.heartbeat(600)
clk.t += 700
again = rp.heartbeat(600)
check("v4 M3 an offline heartbeat is simply tried again after the next interval, uncounted", again is True and rp.beats == ["offline", "offline"] and rp.failures == 2, (rp.beats, rp.failures))   # failures 2 = the `building` step itself and the `planning` that opened the run first (the site never heard anything)

with tempfile.TemporaryDirectory() as tmp:
    # in a real run: a hung build says `building` again and again; the cancel ends it
    si, run, dirs, seen = setup(tmp, build="hang", rk={"heartbeat_s": 0.05})
    run.plan(PID)
    wait(run)
    run.build(PID)
    time.sleep(0.6)
    nb = [b["state"] for b in si.reports()].count("building")
    run.cancel()
    wait(run)
    states = [b["state"] for b in si.reports()]
    check("v4 M3 a long build reports `building` again every interval (the site's 2 hour rule never trips) and the status shows no failure for it", nb >= 4 and states[-1] == "cancelled" and run.status()["reports_not_sent"] == 0 and "site_said" not in run.status(), (nb, states))
    after = len(si.reports())
    time.sleep(0.2)
    check("v4 M3 ... and none after the cancel", len(si.reports()) == after, (after, len(si.reports())))
    si, run, dirs, seen = setup(tmp, plan="hang", rk={"heartbeat_s": 0.05})
    run.plan(PID)
    time.sleep(0.5)
    npn = [b["state"] for b in si.reports()].count("planning")
    run.cancel()
    wait(run)
    check("v4 M3 a long listen (Plan) says `planning` again too", npn >= 4, [b["state"] for b in si.reports()])
    # the server refuses the repeat: one try, then quiet
    si, run, dirs, seen = setup(tmp, build="hang", rk={"heartbeat_s": 0.05})
    state = {"n": 0}

    def refuse_repeats(route, body):
        if body["state"] == "building":
            state["n"] += 1
            if state["n"] >= 2:
                return 400, {"error": "invalid_request"}
        return None
    si.respond = refuse_repeats
    run.plan(PID)
    wait(run)
    run.build(PID)
    time.sleep(0.6)
    run.cancel()
    wait(run)
    nb = [b["state"] for b in si.reports()].count("building")
    check("v4 M3 if the site refuses a repeat the heartbeats stop for good (the opening report and ONE refused repeat), silently", nb == 2 and run.status()["reports_not_sent"] == 0 and "site_said" not in run.status(), (nb, run.status()))

# ---- MEDIUM: the folder cap is the engine's 8, in the name rule and in words
with tempfile.TemporaryDirectory() as tmp:
    check("v4 M2 the app's folder cap is 8", RR.MAX_FOLDERS == 8 and "8" in RR.CAP_WORDS[0] and "10" not in RR.CAP_WORDS[0])
    nine = {**REQUEST, "folders": [f"Reel {i}" for i in range(1, 10)]}
    si, run, dirs, seen = setup(tmp, request=nine)
    r = run.plan(PID)
    wait(run)
    st = run.status()
    check("v4 M2 nine folders: nothing is run; the person is told the cap in words (not 'could not be read'); the site hears the closed code request_invalid",
          r == {"started": False, "error_code": "request_invalid"} and seen == [] and st["words"] == RR.CAP_WORDS[0] and st["next"] == RR.CAP_WORDS[1] and st["words"] != RR.ERROR_WORDS["request_invalid"][0]
          and [(b["state"], b.get("error_code")) for b in si.reports()] == [("planning", None), ("failed", "request_invalid")], (r, st, si.reports()))
    eight = {**REQUEST, "folders": [f"Reel {i}" for i in range(1, 9)]}
    si, run, dirs, seen = setup(tmp, request=eight, choose=False)
    for i in range(1, 9):
        d = Path(tmp) / "eight" / f"r{i}"
        d.mkdir(parents=True)
        run.folders.set(PID, f"Reel {i}", d)
    r = run.plan(PID)
    wait(run)
    check("v4 M2 eight folders run: the engine takes up to 8", r == {"started": True} and len(folder_args(seen[0])) == 8, (r, seen))
    other = {**REQUEST, "folders": [NAMES[0], "Reel/two"]}
    si, run, dirs, seen = setup(tmp, request=other)
    r = run.plan(PID)
    wait(run)
    check("v4 M2 a bad name is still request_invalid with the ordinary words, not the cap words", r["error_code"] == "request_invalid" and run.status()["words"] == RR.ERROR_WORDS["request_invalid"][0], run.status())

# ---- LOW: a stored request with mode 'song' is not run (the engine only refuses song:true)
with tempfile.TemporaryDirectory() as tmp:
    for label, req in (("mode song", {**REQUEST, "mode": "song"}), ("song true", {**REQUEST, "song": True})):
        si, run, dirs, seen = setup(tmp, request=req)
        r = run.plan(PID)
        wait(run)
        check(f"v4 L3 a request with {label} is not run: song_request, in words", r == {"started": False, "error_code": "song_request"} and seen == [] and run.status()["words"] == RR.ERROR_WORDS["song_request"][0], (r, seen))

# ---- LOW: the checklist id is kept when it is the site's own kind (^[a-z0-9_-]{1,20}$)
ITEM = {"what": "a clip of a dog", "from": "my phone", "must_contain": "", "folder": NAMES[0], "count": 1}
row = lambda ids: {"project_id": PID, "sha256": SITE_SHA, "title": "t", "updated_at": "x", "request": {**REQUEST, "checklist": [{**ITEM, "id": i} for i in ids]}}
cleaned = RR._clean(row(["c1", "my-item_2", "Bad Id", "x" * 21, "x" * 20, "", "A1", "c10"]))
ids = [c["id"] for c in cleaned["checklist"]]
check("v4 L2 the checklist id pattern is the site's ^[a-z0-9_-]{1,20}$: ids of that kind are kept, others get c<position>",
      RR._ITEM_ID.pattern == "^[a-z0-9_-]{1,20}$" and ids == ["c1", "my-item_2", "c3", "c4", "x" * 20, "c6", "c7", "c10"], ids)

# ---- LOW: one failed page poll does not stop the polling (the page script, run in node with a failing api)
page_src = Path(D.__file__).read_text(encoding="utf-8") if D is not None else ""
start = page_src.find("function runBlock(x) {")
depth, i = 0, start
while start >= 0 and i < len(page_src):
    depth += (page_src[i] == "{") - (page_src[i] == "}")
    i += 1
    if depth == 0 and i > start + 30:
        break
func = page_src[start:i] if start >= 0 else ""
_pv0, _d, _i = page_src.find("function progressView() {"), 0, 0
_i = _pv0
while _pv0 >= 0 and _i < len(page_src):
    _d += (page_src[_i] == "{") - (page_src[_i] == "}")
    _i += 1
    if _d == 0 and _i > _pv0 + 30:
        break
func = (page_src[_pv0:_i] + chr(10) if _pv0 >= 0 else "") + func           # v9: runBlock builds its progress block with progressView
JS_TEST = r"""
const pending = []; const delays = [];
global.setTimeout = (fn, ms) => { delays.push(ms); pending.push(fn); return pending.length; };
global.clearTimeout = () => {};
const el = (tag, attrs, ...kids) => ({ tag, attrs, kids, textContent: '', isConnected: true, replaceChildren(...k) { this.kids = k; } });
let attempt = 0; const FAILS = %d;
async function api(path, body) { attempt += 1; if (attempt <= FAILS) throw new Error('The server did not answer.'); return { run: {}, folders: [] }; }
%s
(async () => {
  const box = runBlock({ project_id: 'p' });
  for (let k = 0; k < 12; k++) { await new Promise(r => setImmediate(r)); const f = pending.shift(); if (!f) break; await f(); }
  await new Promise(r => setImmediate(r));
  console.log(JSON.stringify({ attempt, delays }));
})();
"""
import shutil
if not func or not shutil.which("node"):
    print("SKIPPED  v4 L1 the page-poll check (no node on PATH, or runBlock not found): NOT RUN, not a pass")
else:
    with tempfile.TemporaryDirectory() as tmp:
        jf = Path(tmp) / "poll.js"
        res = {}
        for fails in (3, 40):
            jf.write_text(JS_TEST % (fails, func), encoding="utf-8")
            r = subprocess.run(["node", str(jf)], capture_output=True, text=True, timeout=60)
            try:
                res[fails] = json.loads(r.stdout.strip().splitlines()[-1])
            except Exception:  # noqa: BLE001
                res[fails] = {"error": (r.stdout + r.stderr)[-300:]}
        check("v4 L1 three failed polls in a row do not stop the page asking: it tries again after 4, 8 and 16 s and then goes quiet once an answer comes", res[3] == {"attempt": 4, "delays": [4000, 8000, 16000]}, res[3])
        check("v4 L1 ... a poll that keeps failing is tried at most once a minute (the wait stops growing at 60 s) and never stops", res[40].get("attempt", 0) >= 10 and max(res[40].get("delays", [0])) <= 60000 and res[40].get("delays", [0])[-1] == 60000, res[40])

# ================= v5: BUILDER's 12:21 re-check of v4 =================
def off(_b=None):
    raise OSError("no internet")


def scripted(si, fn):
    """Answer each report with fn(body): None = the site takes it, (status, obj) = it answers so, or it raises (no internet). Returns the list of states the site TOOK, in order."""
    took = []

    def respond(route, body):
        r = fn(body)
        if r is None:
            took.append(body["state"])
        return r
    si.respond = respond
    return took


def new_reporter(si, **kw):
    clk = Clock()
    return clk, RR.RunReporter(si, PID, SITE_SHA, clock=clk, sleep=lambda s: None, **kw)


# ---- (1) the 100-minute window and the heartbeat count from the last report the site TOOK
si = SignIn()
clk, rp = new_reporter(si)
rp.step("planning")
check("v5 1 a report the site takes sets the time the run was last heard (and the run is open there)", rp.last_at == clk.t == 1000.0 and rp.opened is True)
clk.t = 2000.0
scripted(si, off)
rp.forward({"state": "matching", "matches": 1, "clips": 1})
check("v5 1 a send that gets no answer does NOT move that time", rp.last_at == 1000.0 and rp.last_result == "offline", (rp.last_at, rp.last_result))
clk.t = 3000.0
scripted(si, lambda b: (409, {"error": "busy"}))
rp.forward({"state": "matching", "matches": 2, "clips": 2})
check("v5 1 a send the site refuses does NOT move it either", rp.last_at == 1000.0 and rp.last_result == "busy", (rp.last_at, rp.last_result))
clk.t = 4000.0
scripted(si, lambda b: None)
rp.forward({"state": "matching", "matches": 3, "clips": 3})
check("v5 1 the next report the site takes moves it", rp.last_at == 4000.0)

si = SignIn()
clk, rp = new_reporter(si)
rp.step("planning")
scripted(si, off)
clk.t += 650                                            # a quiet 10 minutes in which nothing the app sent was taken (the 1000 s mark has long passed for the site)
beat_a = rp.heartbeat(600)
check("v5 1 the heartbeat counts its 10 minutes from the last report the site TOOK, not from the last try", beat_a is True and rp.beats == ["offline"] and rp.last_at == 1000.0, (beat_a, rp.beats, rp.last_at))

with tempfile.TemporaryDirectory() as tmp:
    # a long listen the site hears nothing of: the draft is made 98 minutes in; 100 minutes after the last report the site TOOK it is closed, though the draft is only minutes old
    clk = [1000.0]
    si, run, dirs, seen = setup(tmp, plan="hang", rk={"clock": lambda: clk[0], "draft_max_s": 6000, "heartbeat_s": 1e9, "sleep": lambda s: None})
    procs, orig = [], run.popen
    run.popen = lambda cmd, **kw: (procs.append((cmd, orig(cmd, **kw))), procs[-1][1])[1]
    run.plan(PID)
    until(lambda: procs and "planning" in [b["state"] for b in si.reports()])
    si.respond = lambda route, body: off()
    clk[0] = 6900.0
    cmd, pr = procs[0]
    Path(arg(cmd, "--out")).write_text(json.dumps({"schema": "ryagram.request-draft/0", "found": 7, "edit": {"clips": []}}), encoding="utf-8")
    pr.returncode = 0
    check("v5 1 (setup) the draft was made after the engine ran 98 minutes, with no report taken since the first", until(lambda: run.status()["state"] == "drafted" or run.status()["state"] == "cancelled"), run.status())
    clk[0] = 7100.0                                     # 200 s after the draft, 6100 s after the last report the site took
    check("v5 1 the plan is closed as cancelled 100 minutes after the last report the site TOOK (not 100 minutes after the draft was made), in words",
          until(lambda: run.status()["state"] == "cancelled") and "waited too long" in run.status()["words"], run.status())
    wait(run)

# ---- (2) retries: each report is tried 3 times when there is no answer
si, calls, naps = SignIn(), {"n": 0}, []


def two_lost(b):
    calls["n"] += 1
    return off() if calls["n"] <= 2 else None


scripted(si, two_lost)
res = RR.report_with_retry(si, GOOD, sleep=naps.append)
check("v5 2 a report that gets no answer is tried again, with a short wait, and goes through on the third try", res == "ok" and calls["n"] == 3 and naps == [2.0, 6.0] and RR.RETRY_TRIES == 3, (res, calls, naps))
calls["n"], naps = 0, []
scripted(si, lambda b: (calls.__setitem__("n", calls["n"] + 1), off())[1])
res = RR.report_with_retry(si, GOOD, sleep=naps.append)
check("v5 2 ... and after three tries with no answer it gives up (offline), having waited twice and no more", res == "offline" and calls["n"] == 3 and len(naps) == 2 and max(naps) <= 10, (res, calls, naps))
calls["n"], naps = 0, []
scripted(si, lambda b: (calls.__setitem__("n", calls["n"] + 1), (409, {"error": "busy"}))[1])
res = RR.report_with_retry(si, GOOD, sleep=naps.append)
check("v5 2 ... an answer, even a refusal, is not tried again", res == "busy" and calls["n"] == 1 and naps == [], (res, calls, naps))
check("v5 2 the default wait is short (seconds, not minutes) and nothing in the tests really slept", max(RR.RETRY_WAITS) <= 10 and sum(RR.RETRY_WAITS) < 30 and RR._nap == NAPS.append)

# a lost `planning` must not leave the run dead
si = SignIn()
clk, rp = new_reporter(si)
up = {"on": False}
took = scripted(si, lambda b: None if up["on"] else off())
lost = rp.step("planning")
up["on"] = True
rp.forward({"state": "matching", "matches": 2, "clips": 2})
check("v5 2 the opening `planning` got no answer: the next report opens the run first, so the site hears planning then matching (it never answers not_running to a run it never heard of)",
      lost is False and took == ["planning", "matching"] and rp.opened, (lost, took))
si = SignIn()
clk, rp = new_reporter(si)
took = scripted(si, lambda b: None if up["on"] else off())
up["on"] = False
rp.step("planning")
up["on"] = True
rp.fail("folder_empty")
check("v5 2 ... the same for a run that fails right after: planning, then failed", took == ["planning", "failed"], took)
si = SignIn()
clk, rp = new_reporter(si)
took = scripted(si, lambda b: None if up["on"] else off())
up["on"] = False
rp.step("planning")
rp.forward({"state": "matching", "matches": 2, "clips": 2})
up["on"] = True
clk.t += 700
rp.heartbeat(600)
check("v5 2 ... and a heartbeat for a run the site never heard of opens it (planning), not repeats `matching`", took == ["planning"] and rp.opened, took)
si = SignIn()
clk, rp = new_reporter(si)
took = scripted(si, lambda b: None if b["state"] == "planning" else (409, {"error": "busy"}))
rp.step("planning")
rp.forward({"state": "matching", "matches": 2, "clips": 2})
check("v5 2 ... but a refusal is an answer, not a lost report: nothing is sent twice to a site that said no", len(si.reports()) == 2 and rp.last_result == "busy", len(si.reports()))
si = SignIn()
clk, rp = new_reporter(si)
took = scripted(si, lambda b: (409, {"error": "busy"}))
rp.step("planning")
rp.forward({"state": "matching", "matches": 2, "clips": 2})
check("v6 2 ... and when the OPENING is the refused one, nothing is sent after it (one report), and the first refusal stays", len(si.reports()) == 1 and rp.last_result == "busy" and rp.open_refused == "busy" and rp.final, len(si.reports()))

with tempfile.TemporaryDirectory() as tmp:
    # in a real run: the first three tries of `planning` are lost, then the internet is back
    si, run, dirs, seen = setup(tmp, rk={"sleep": lambda s: None})
    n = {"n": 0}

    def lose_three(b):
        n["n"] += 1
        return off() if n["n"] <= 3 else None
    took = scripted(si, lose_three)
    run.plan(PID)
    wait(run)
    openf = Path(tmp) / "request-open-run.json"
    check("v5 2 a Plan whose `planning` was lost still runs to a draft, and the site hears planning first, then the rest (the run is not dead)", run.status()["state"] == "drafted" and took[:2] == ["planning", "matching"], (run.status(), took))
    check("v5 2 ... and the open-run file is written when the site finally took planning (a restart still closes it)", openf.is_file(), took)

# a FINAL report whose answer was lost, then the retry meets not_running: it was delivered
for first, second, final, want_ok in (("lost", "not_running", "done", True), ("lost", "not_running", "cancelled", True), ("lost", "not_running", "failed", True), ("answer", "none", "done", False), ("lost", "not_running", "matching", False)):
    si, tries = SignIn(), {"n": 0}
    fired = []
    clk, rp = new_reporter(si, on_final=fired.append)
    scripted(si, lambda b: None)
    rp.step("planning")

    def answer(b, first=first, second=second):
        tries["n"] += 1
        if first == "lost":
            return off() if tries["n"] == 1 else (409, {"error": second})
        return (409, {"error": "not_running"})
    scripted(si, answer)
    ok = rp.step(final)
    if want_ok:
        check(f"v5 2 a {final} report whose answer was lost, then 409 not_running on the retry, counts as delivered (ok, no failure, no refusal shown)", ok is True and rp.last_result == "ok" and rp.last_refusal is None and fired == [True] and rp.failures == 0, (ok, rp.last_result, rp.failures, fired))
    elif final == "done":
        check("v5 2 ... but a `not_running` on the FIRST try of a final report is a refusal like any other", ok is False and rp.last_result == "not_running" and rp.last_refusal == "not_running", (ok, rp.last_result))
    else:
        check("v5 2 ... and a retried report that is not final is not treated as delivered", ok is False and rp.last_result == "not_running", (ok, rp.last_result))

with tempfile.TemporaryDirectory() as tmp:
    # recover() retries too
    openf = Path(tmp) / "request-open-run.json"
    openf.write_text(json.dumps({"project_id": PID, "request_sha256": SITE_SHA, "at": int(time.time())}), encoding="utf-8")
    si, run, dirs, seen = setup(tmp, rk={"sleep": lambda s: None})
    n = {"n": 0}
    took = scripted(si, lambda b: (n.__setitem__("n", n["n"] + 1), off() if n["n"] == 1 else None)[1])
    run.recover()
    wait(run)
    check("v5 2 recover() at start tries again after a lost first try, and then forgets the run", took == ["cancelled"] and not openf.exists(), (took, openf.exists()))

# 409 moved_past: the person presses Plan on a request whose earlier run is still at `building` there
with tempfile.TemporaryDirectory() as tmp:
    openf = Path(tmp) / "request-open-run.json"
    openf.write_text(json.dumps({"project_id": PID, "request_sha256": SITE_SHA, "at": int(time.time())}), encoding="utf-8")
    si, run, dirs, seen = setup(tmp, rk={"sleep": lambda s: None})
    run._recovered = True                               # (the start-up close is not what is tried here)
    si.respond = lambda route, body: (409, {"error": "moved_past", "message": SECRET})
    run.plan(PID)
    wait(run)
    st = run.status()
    check("v5 3 moved_past on Plan: nothing is run, the person is told to start again with Plan, and it says so in the status", seen == [] and st["state"] == "failed" and "Start again with Plan" in st["site_words"] and st["site_said"] == "moved_past", (seen, st))
    check("v6 the earlier session's open-run file is KEPT (the next start closes that run), the refused run is not held, and nothing is busy", openf.exists() and run.last_rep is None and not run.busy(), (openf.exists(), run.last_rep))
    check("v5 3 ... and nothing of the site's own text reaches the status", "Ana" not in json.dumps(st) and "elephant" not in json.dumps(st), st)
    si.respond = None
    check("v5 3 ... so the next Plan works: it runs and reaches a draft", run.plan(PID) == {"started": True} and (wait(run), run.status()["state"] == "drafted" and len(seen) == 1)[1], (run.status(), seen))

# ---- (3) words
NEW = [(409, "not_running"), (409, "moved_past"), (429, "too_many"), (429, "too_many_tries"), (429, "too_many_runs"), (429, "slow_down")]
check("v5 3 report_run tells each new site answer apart, by its closed word", [RR.report_run(Reply(s, {"error": c, "message": SECRET}), GOOD) for s, c in NEW] == [c for _s, c in NEW], [RR.report_run(Reply(s, {"error": c}), GOOD) for s, c in NEW])
check("v5 3 ... a 429 with a word this app does not know, or none, still means wait (slow_down); a 409 or 400 it does not know stays `refused`",
      RR.report_run(Reply(429, {"error": "brand_new"}), GOOD) == "slow_down" and RR.report_run(Reply(429, None), GOOD) == "slow_down" and RR.report_run(Reply(409, {"error": "brand_new"}), GOOD) == "refused" and RR.report_run(Reply(400, {"error": "x"}), GOOD) == "refused")
check("v5 3 every new word is a server refusal, in the closed list", all(c in RR.SERVER_REFUSALS and c in RR.REPORT_RESULTS and c in RR.SITE_WORDS for _s, c in NEW) and "app_refused" in RR.REPORT_RESULTS and "app_refused" not in RR.SERVER_REFUSALS)
for _s, c in NEW:
    w = RR.SITE_WORDS[c]
    if c in ("too_many", "too_many_tries", "too_many_runs", "moved_past"):
        continue                                        # v6: these four have their own exact sentences, checked below
    tail = "Start again with Plan." if c in ("not_running", "moved_past") else "Wait a little and try again later."
    check(f"v5 3 the words for {c} are plain: it says the site was not told, the film is fine, and what to do ({tail})", w.endswith(tail) and "Your film is not affected." in w and "not told how far this got" in w and "did not take" not in w and not re.search(r"[{}_<>/\\]|[0-9]{3}", w), w)
check("v5 3 the six new sentences are all different from each other and from the old ones", len(set(RR.SITE_WORDS.values())) == len(RR.SITE_WORDS) == 10, sorted(RR.SITE_WORDS))
with tempfile.TemporaryDirectory() as tmp:
    for status_, code in [x for x in NEW if x[1] != "moved_past"]:
        si, run, dirs, seen = setup(tmp, rk={"sleep": lambda s: None})
        si.respond = lambda route, body, status_=status_, code=code: None if body["state"] == "planning" else (status_, {"error": code, "message": SECRET})        # (v6: a refused OPENING stops the run, so here the site takes `planning` and refuses what follows)
        run.plan(PID)
        wait(run)
        st = run.status()
        check(f"v5 3 a {status_} {code} on a report shows our sentence for it (and not the site's text) in the status", st["state"] == "drafted" and st["site_said"] == code and st["site_words"] == RR.SITE_WORDS[code] and "Ana" not in json.dumps(st), st)

# heartbeats: a 429 says wait, it does not end them; any other refusal does
for code, status_, beats_stop in (("slow_down", 429, False), ("too_many_runs", 429, False), ("not_running", 409, True)):
    si = SignIn()
    clk, rp = new_reporter(si)
    rp.step("planning")
    scripted(si, lambda b, code=code, status_=status_: (status_, {"error": code}))
    clk.t += 700
    rp.heartbeat(600)
    clk.t += 700
    again = rp.heartbeat(600)
    check(f"v5 3 a {status_} {code} on a heartbeat {'ends them' if beats_stop else 'does not end them (the site said wait: the next is tried)'}", again is (not beats_stop) and rp.beats[0] == code and rp.last_refusal is None and rp.failures == 0, (again, rp.beats))
# a heartbeat is ONE try, and one the site did not take is not tried again at once
si = SignIn()
clk, rp = new_reporter(si)
rp.step("planning")
scripted(si, off)
n0 = len(si.calls)
clk.t += 700
rp.heartbeat(600)
n1 = len(si.calls)
clk.t += 1
second = rp.heartbeat(600)
clk.t += RR.HEARTBEAT_RETRY_S + 1
third = rp.heartbeat(600)
check("v5 3 a heartbeat is one try (the next heartbeat is its retry), not repeated at once after no answer, and tried again about a minute later", n1 - n0 == 1 and second is False and third is True and len(si.calls) - n1 == 1, (n1 - n0, second, third))

# ---- (4) counts: whole numbers within the caps; one odd number never drops the report
si = SignIn()
clk, rp = new_reporter(si)
rp.step("planning")
rp.forward({"state": "matching", "matches": 7.0, "clips": 250000, "film_seconds": 99999.5})
b = si.reports()[-1]
check("v5 4 a float count is sent as a whole number, a count over 100000 as 100000, and seconds are capped at 86400; the report is sent", b["state"] == "matching" and b["matches"] == 7 and type(b["matches"]) is int and b["clips"] == 100000 and type(b["clips"]) is int and b["film_seconds"] == 86400 and rp.last_result == "ok", b)
rp.forward({"state": "matching", "matches": 7.9, "clips": float("nan"), "film_seconds": float("inf")})
b = si.reports()[-1]
check("v5 4 ... a number that is not a number (nan, infinity) is left out; the report still goes, with the counts it had", rp.last_result == "ok" and b["matches"] == 7 and b["clips"] == 100000, b)
rp.forward({"state": "matching", "matches": -3, "clips": True})
b = si.reports()[-1]
check("v5 4 ... and a negative count or a true/false is left out too", rp.last_result == "ok" and b["matches"] == 7 and b["clips"] == 100000, b)
clk.t += 700
beat = rp.heartbeat(600)
b = si.reports()[-1]
check("v5 4 the heartbeats go on after a float count (and carry whole numbers)", beat is True and rp.beats == ["ok"] and type(b["matches"]) is int and type(b["clips"]) is int, (rp.beats, b))
rp.forward({"state": "done", "matches": 12.0, "clips": 2.5e9, "film_seconds": 9e9})
rp.step("done")
b = si.reports()[-1]
check("v5 4 the held `done` of a plan, and the final report, carry the cleaned counts too", b["state"] == "done" and b["matches"] == 12 and b["clips"] == 100000 and b["film_seconds"] == 86400 and rp.last_result == "ok", b)
si = SignIn()
clk, rp = new_reporter(si)
rp.step("matching", matches=7.6, clips=250000.0, film_seconds=99999.5)
b = si.reports()[-1]
check("v5 4 the same holds for counts handed straight to a step (the opening report of a Build, the final `done`): whole numbers within the caps", b["state"] == "matching" and type(b["matches"]) is int and b["matches"] == 7 and b["clips"] == 100000 and type(b["clips"]) is int and b["film_seconds"] == 86400 and rp.last_result == "ok", b)
check("v5 4 report_run itself still refuses a float or an over-cap count it is handed (the caps are the app's own check)",
      RR.report_run(SignIn(), {**GOOD, "matches": 7.0}) == "app_refused" and RR.report_run(SignIn(), {**GOOD, "clips": 100001}) == "app_refused" and RR.report_run(SignIn(), {**GOOD, "film_seconds": 86401}) == "app_refused" and RR.report_run(SignIn(), {**GOOD, "clips": 100000, "film_seconds": 86400}) == "ok")

with tempfile.TemporaryDirectory() as tmp:
    # a real run whose engine writes floats and huge numbers into its report file
    base = make_popen(seen=[])

    def floaty(cmd, **kw):
        pr = base(cmd, **kw)
        if "draft-request" in cmd:
            rf = Path(arg(cmd, "--report-file"))
            rf.write_text(rf.read_text(encoding="utf-8").replace('"matches": 7, "clips": 7', '"matches": 7.6, "clips": 250000.0').replace('"film_seconds": 12.5', '"film_seconds": 99999.5'), encoding="utf-8")
        return pr
    si, run, dirs, seen = setup(tmp, rk={"sleep": lambda s: None})
    run.popen = floaty
    run.plan(PID)
    wait(run)
    st = run.status()
    mid = [b for b in si.reports() if b["state"] == "matching"]
    check("v5 4 an engine report with a float and a huge count is still reported (matching goes out, whole numbers within the caps) and the page's counts are whole numbers",
          st["state"] == "drafted" and mid and mid[0]["matches"] == 7 and mid[0]["clips"] == 100000 and all(type(b.get("matches", 0)) is int for b in si.reports()) and st["matches"] == 7 and type(st["matches"]) is int and st["clips"] == 100000 and st["film_seconds"] == 86400 and st["reports_not_sent"] == 0, (st, mid))
    run.build(PID)
    wait(run)
    done = [b for b in si.reports() if b["state"] == "done"]
    check("v5 4 ... and so is the final `done` after the build", run.status()["state"] == "built" and done and type(done[-1]["matches"]) is int and done[-1]["clips"] == 100000 and done[-1]["film_seconds"] <= 86400, (run.status(), done))

# ---- LOW: a report the app refuses itself is not 'Ryagram did not take the update'
with tempfile.TemporaryDirectory() as tmp:
    si, run, dirs, seen = setup(tmp, rk={"sleep": lambda s: None})
    real_report = RR.report_run
    RR.report_run = lambda signin, payload, sha256=None: "app_refused" if payload.get("state") == "matching" else real_report(signin, payload, sha256=sha256)
    try:
        run.plan(PID)
        wait(run)
    finally:
        RR.report_run = real_report
    st = run.status()
    page_src = Path(D.__file__).read_text(encoding="utf-8") if D is not None else ""
    check("v5 LOW a report the app refused by its own check is shown as 'The app could not send the update.', not as the site's refusal (the site never saw it)",
          st.get("app_said") == "app_refused" and st.get("app_words") == RR.APP_WORDS == "The app could not send the update. Your film is not affected." and "site_said" not in st and "site_words" not in st and "did not take" not in json.dumps(st), st)
    check("v5 LOW ... it counts as an update not sent, and the page shows it", st["reports_not_sent"] >= 1 and (D is None or "run.app_words" in page_src), st)
check("v5 LOW the site's own plain refusal still reads 'Ryagram did not take the update'", "did not take the update" in RR.SITE_WORDS["refused"] and RR.report_run(Reply(400, {"error": "invalid_request"}), GOOD) == "refused")

# ================= v6: BUILDER's 13:12 re-check of v5 =================
def states_of(si):
    return [b["state"] for b in si.reports()]


# ---- MEDIUM 1: a final report that got no answer is sent again before the next run begins
for final in ("done", "cancelled"):
    with tempfile.TemporaryDirectory() as tmp:
        openf = Path(tmp) / "request-open-run.json"
        si, run, dirs, seen = setup(tmp, rk={"sleep": lambda s: None})
        lose = {"on": True}
        took = scripted(si, lambda b: off() if (lose["on"] and b["state"] == final) else None)
        run.plan(PID)
        wait(run)
        if final == "done":
            run.build(PID)
            wait(run)
            ok0 = run.status()["state"] == "built"
        else:
            run.cancel()
            wait(run)
            ok0 = run.status()["state"] == "cancelled"
        check(f"v6 1 a final `{final}` that got no answer (3 tries) is not on the site, and the run is closed here", ok0 and final not in took and states_of(si).count(final) == RR.RETRY_TRIES and run.last_rep.final and getattr(run.last_rep, "final_lost", None), (took, states_of(si)))
        lose["on"] = False
        n_before = len(took)
        run.plan(PID)
        wait(run)
        check(f"v6 1 Plan pressed again sends the old `{final}` first, and only then the new `planning`", took[n_before:n_before + 2] == [final, "planning"] and took.count(final) == 1, took[n_before:])
        check("v6 1 ... the new run goes on to a draft, and the open-run file is the new run's", run.status()["state"] == "drafted" and openf.exists() and not getattr(run.last_rep, "final_lost", True), (run.status(), openf.exists()))

# a final still lost on the second try: the file is kept, the new run still starts (nothing was refused)
with tempfile.TemporaryDirectory() as tmp:
    openf = Path(tmp) / "request-open-run.json"
    si, run, dirs, seen = setup(tmp, rk={"sleep": lambda s: None})
    took = scripted(si, lambda b: off() if b["state"] == "done" else None)
    run.plan(PID)
    wait(run)
    run.build(PID)
    wait(run)
    run.plan(PID)
    wait(run)
    check("v6 1 ... the old final is tried 3 more times when Plan is pressed again; still no answer: the open-run file is kept, and the new run is not held up", states_of(si).count("done") == 2 * RR.RETRY_TRIES and openf.exists() and run.status()["state"] == "drafted", (states_of(si), openf.exists(), run.status()))

# the site still answers moved_past to the new planning: the old final is kept to be sent again by the next Plan, and the file is kept
with tempfile.TemporaryDirectory() as tmp:
    openf = Path(tmp) / "request-open-run.json"
    si, run, dirs, seen = setup(tmp, rk={"sleep": lambda s: None})
    mode = {"m": "lost"}


    def answer(b):
        if mode["m"] == "lost":
            return off() if b["state"] == "done" else None
        if mode["m"] == "refuse":
            return (409, {"error": "moved_past"}) if b["state"] == "planning" else (off() if b["state"] == "done" else None)
        return None
    took = scripted(si, answer)
    run.plan(PID)
    wait(run)
    run.build(PID)
    wait(run)
    mode["m"] = "refuse"
    n_seen = len(seen)
    run.plan(PID)
    wait(run)
    st = run.status()
    check("v6 1 old final still lost and the new planning refused moved_past: no engine, the file is kept, the first refusal's words are shown", len(seen) == n_seen and st["state"] == "failed" and st["site_said"] == "moved_past" and openf.exists() and run.last_rep is not None and getattr(run.last_rep, "final_lost", None), (st, openf.exists()))
    mode["m"] = "ok"
    n_before = len(took)
    run.plan(PID)
    wait(run)
    check("v6 1 ... and the next Plan sends that old final, then plans (the run is not stuck for 2 hours)", took[n_before:n_before + 2] == ["done", "planning"] and run.status()["state"] == "drafted", (took[n_before:], run.status()))

# a Plan that fails at once (a chosen folder is gone) also sends the old lost final first
with tempfile.TemporaryDirectory() as tmp:
    si, run, dirs, seen = setup(tmp, rk={"sleep": lambda s: None})
    lose = {"on": True}
    took = scripted(si, lambda b: off() if (lose["on"] and b["state"] == "done") else None)
    run.plan(PID)
    wait(run)
    run.build(PID)
    wait(run)
    lose["on"] = False
    import shutil
    shutil.rmtree(dirs[NAMES[0]])
    n_before = len(took)
    run.plan(PID)
    wait(run)
    check("v6 1 ... a Plan that fails at once (a folder is gone) sends the old `done` first as well, then planning and failed", took[n_before:] == ["done", "planning", "failed"] and run.status()["error_code"] == "folder_missing", (took[n_before:], run.status()))

# ---- MEDIUM 2: a refused OPENING `planning` does not start the engine, stops the reports, and keeps the first refusal's words
REFUSALS = [(403, "not_open"), (409, "busy"), (429, "too_many"), (429, "too_many_runs"), (409, "moved_past")]
for status_, code in REFUSALS:
    with tempfile.TemporaryDirectory() as tmp:
        openf = Path(tmp) / "request-open-run.json"
        si, run, dirs, seen = setup(tmp, rk={"sleep": lambda s: None})
        si.respond = lambda route, body, status_=status_, code=code: (status_, {"error": code, "message": SECRET}) if body["state"] == "planning" else (409, {"error": "not_running"})
        run.plan(PID)
        wait(run)
        time.sleep(0.1)
        st = run.status()
        check(f"v6 2 a {status_} {code} on the opening `planning`: the engine is not started, only that one report is sent, and nothing is busy", seen == [] and states_of(si) == ["planning"] and not run.busy() and st["state"] == "failed", (seen, states_of(si), st))
        check(f"v6 2 ... the words are the FIRST refusal's own sentence, not 'start again with Plan' from a later not_running", st["site_said"] == code and st["site_words"] == RR.SITE_WORDS[code] and "no longer open" not in json.dumps(st) and st["words"] == getattr(RR, "NOT_STARTED_WORDS", None) and "Ana" not in json.dumps(st), st)
        j = run.job
        check(f"v6 2 ... a report asked for after it is not sent, a heartbeat is not sent, Cancel has nothing to cancel, and the words stay", j["rep"].step("matching") is False and j["rep"].heartbeat(0) is False and run.cancel() == {"state": "none"} and states_of(si) == ["planning"] and run.status()["site_said"] == code and not openf.exists(), (states_of(si), run.status()))
        si.respond = None
        check(f"v6 2 ... Plan pressed again after the refusal works", run.plan(PID) == {"started": True} and (wait(run), run.status()["state"] == "drafted")[1], run.status())

# the exact sentences
check("v6 LOW the 429 sentences are exact: 30 builds in 24 hours, 200 runs in 24 hours, a general rate limit",
      RR.SITE_WORDS["too_many"] == "You have reached the limit of 30 builds in 24 hours. Try again later." and RR.SITE_WORDS["too_many_runs"] == "Too many runs in 24 hours. Try again later." and RR.SITE_WORDS["too_many_tries"] == "Too many tries in a short time. Wait, then try again.", (RR.SITE_WORDS["too_many"], RR.SITE_WORDS["too_many_runs"], RR.SITE_WORDS["too_many_tries"]))
check("v7 no site sentence says today or tomorrow (the limit is a rolling 24 hours), and the 600-an-hour limit is not promised a short wait", all(not re.search(r"today|tomorrow|a little", RR.SITE_WORDS[k], re.I) for k in ("too_many", "too_many_runs", "too_many_tries")), RR.SITE_WORDS)
check("v6 LOW the moved_past sentence says an earlier run is still open (not 'building': it may be at matching) and what to do",
      RR.SITE_WORDS["moved_past"] == "An earlier run for this request is still open. Start again with Plan." and "building" not in RR.SITE_WORDS["moved_past"].lower(), RR.SITE_WORDS["moved_past"])
check("v6 LOW no sentence of the app says 'building' for a run the site may hold at matching, and every sentence stays different", all("building" not in w.lower() for w in RR.SITE_WORDS.values()) and len(set(RR.SITE_WORDS.values())) == len(RR.SITE_WORDS))

# v6b: a start-up close that is still retrying must never close a NEWER run (the report names the project and the fingerprint, never a run: the site closes whichever run is open for them)
with tempfile.TemporaryDirectory() as tmp:
    openf = Path(tmp) / "request-open-run.json"
    openf.write_text(json.dumps({"project_id": PID, "request_sha256": SITE_SHA, "at": int(time.time())}), encoding="utf-8")
    slept, go = threading.Event(), threading.Event()

    def nap(_s):
        slept.set()
        go.wait(5)
    si, run, dirs, seen = setup(tmp, rk={"sleep": nap})
    site = {"open": None, "closed_by_old": [], "n": 0}                                   # the site's one open run, as the server keeps it: no run id in a report

    def server(route, body):
        site["n"] += 1
        if site["n"] == 1:
            return off()                                                                 # the start-up close's first try: no answer
        if body["state"] == "planning" and site["open"] is None:
            site["open"] = (body["project_id"], body["request_sha256"])
        elif body["state"] == "cancelled":
            if site["open"] == (body["project_id"], body["request_sha256"]):
                site["open"] = None
                site["closed_by_old"].append(threading.current_thread().name)
            else:
                return 409, {"error": "not_running"}
        return None
    si.respond = server
    run.recover()
    slept.wait(5)                                                                         # the first try got no answer; the app waits before the second
    check("v6b setup: the start-up close is waiting to try again and its file is still there", openf.exists() and site["open"] is None)
    run.plan(PID)                                                                         # the person presses Plan meanwhile: the site takes the NEW run's planning
    until(lambda: site["open"] is not None)
    go.set()
    wait(run)
    check("v6b the retry of the start-up close does not close the newer run (the site still holds it open)", site["open"] == (PID, SITE_SHA) and site["closed_by_old"] == [], (site, [b["state"] for b in si.reports()]))
    check("v6b ... and the file now names the newer run (a restart would close it, as it should)", openf.exists() or run.busy() or run.last_rep is not None, (openf.exists(),))

# ================= v7: BUILDER's 14:01 re-check of v6 =================
# The site as the server keeps it: ONE open run per (project, fingerprint), no run id in a report. `down` = fingerprints whose reports get no answer at all (None in the set = every report).
def site_model(si, down):
    site = {"open": None, "state": None, "took": []}

    def server(route, body):
        key = (body["project_id"], body["request_sha256"])
        if None in down or body["request_sha256"] in down:
            return off()
        if body["state"] == "planning":
            if site["open"] is not None and site["open"] != key:
                return 409, {"error": "busy"}                                       # a DIFFERENT run is open (the server's migration: 409 busy)
            if site["open"] == key and site["state"] != "planning":
                return 409, {"error": "moved_past"}                                 # the SAME run going back to planning
            site["open"] = key
        elif site["open"] != key:
            return 409, {"error": "not_running"}
        site["took"].append((body["state"], body["request_sha256"][:2]))
        site["state"] = body["state"]
        if body["state"] in ("done", "failed", "cancelled"):
            site["open"] = None
        return None
    si.respond = server
    return site


SHA2 = "cd" * 32
OLD2, NEW2 = SITE_SHA[:2], SHA2[:2]


def old_done_lost(tmp):
    """A run of the request (fingerprint SITE_SHA) is planned and built, its final `done` never answered; the AI then wrote the request again (SHA2) and a chosen folder is gone, so the next Plan fails at once."""
    import shutil
    si, run, dirs, seen = setup(tmp, rk={"sleep": lambda s: None})
    down = set()
    site = site_model(si, down)
    run.plan(PID)
    wait(run)
    down.add(SITE_SHA)
    run.build(PID)
    wait(run)
    lost = bool(run.last_rep.final and run.last_rep.final_lost)
    si.sha = SHA2
    run.airq.status(force=True)
    shutil.rmtree(dirs[NAMES[0]])
    return si, run, dirs, down, site, lost


# (a) the resend of the old final is still lost in the Plan that fails at once: the new run's planning is refused moved_past; the old final must still be owed to the next Plan
with tempfile.TemporaryDirectory() as tmp:
    si, run, dirs, down, site, lost = old_done_lost(tmp)
    run.plan(PID)
    wait(run)
    check("v7 a an old `done` still lost in a Plan that fails at once (folder gone): the site still holds the old run, the new run is refused in words", lost and site["open"] == (PID, SITE_SHA) and run.status()["error_code"] == "folder_missing", (site, run.status()))
    down.clear()                                                                     # the site can be reached again
    dirs[NAMES[0]].mkdir()
    n = len(site["took"])
    run.plan(PID)
    wait(run)
    got = site["took"][n:]
    check("v7 a ... the next Plan sends that old `done` first (it was kept until answered), then the new `planning`; the run goes on", got[:2] == [("done", OLD2), ("planning", NEW2)] and run.status()["state"] == "drafted", (got, run.status()))

# (b) the new run's own `failed` is lost too: the old final is kept; an answer to the NEW run never clears the file that holds the OLD one; a restart still closes the old run
with tempfile.TemporaryDirectory() as tmp:
    openf = Path(tmp) / "request-open-run.json"
    si, run, dirs, down, site, lost = old_done_lost(tmp)
    down.add(None)                                                                   # the whole site is out of reach for the Plan that fails at once
    run.plan(PID)
    wait(run)
    check("v7 b both finals lost: the file still names the OLD run", lost and json.loads(openf.read_text(encoding="utf-8"))["request_sha256"] == SITE_SHA and run.last_rep.final_lost, (openf.exists(),))
    down.discard(None)                                                               # the new fingerprint is answered again, the old one is still out of reach
    run.plan(PID)
    wait(run)
    check("v7 b the new run's lost `failed` is sent again and the site ANSWERS it (not_running): the file that holds the OLD run is not deleted", openf.exists() and json.loads(openf.read_text(encoding="utf-8"))["request_sha256"] == SITE_SHA, (openf.exists(), site))
    down.clear()
    run2 = RR.RequestRunner(run.airq, si, run.folders, engine_dir=tmp, work_dir=Path(tmp) / "work2", out_dir=Path(tmp) / "films2", popen=make_popen(), kill=lambda p: p.kill(), poll_s=0.01,
                            probe=lambda: (0, HELP_NEW), state_file=openf, page_grace_s=1e6, reap_s=0.02, sleep=lambda s: None)
    run2.recover()
    wait(run2)
    check("v7 b ... and the restart's recover closes the OLD run on the site (the file was there for it)", site["open"] is None and ("cancelled", OLD2) in site["took"] and not openf.exists(), (site, openf.exists()))

# (c) a delivered final (answered) is dropped: no old final is resent without need
with tempfile.TemporaryDirectory() as tmp:
    si, run, dirs, seen = setup(tmp, rk={"sleep": lambda s: None})
    took = scripted(si, lambda b: None)
    run.plan(PID)
    wait(run)
    run.build(PID)
    wait(run)
    run.plan(PID)
    wait(run)
    check("v7 c an answered final is never sent again (one `done` on the site)", took.count("done") == 1, took)

# (d) THREE finals are owed (none answered): they are sent OLDEST first, each once the one before it is answered, and a new Plan that also fails keeps all of them owed
SHA3, SHA4, SHA5 = "ef" * 32, "12" * 32, "34" * 32
with tempfile.TemporaryDirectory() as tmp:
    si, run, dirs, down, site, lost = old_done_lost(tmp)
    down.add(None)
    run.plan(PID)
    wait(run)
    for sha_n in (SHA3, SHA4):
        si.sha = sha_n
        run.airq.status(force=True)
        run.plan(PID)
        wait(run)
    down.clear()
    dirs[NAMES[0]].mkdir()
    si.sha = SHA5
    run.airq.status(force=True)
    n = len(si.reports())
    run.plan(PID)
    wait(run)
    order = []
    for b in si.reports()[n:]:
        if not order or order[-1] != b["request_sha256"][:2]:
            order.append(b["request_sha256"][:2])
    want = [OLD2, SHA2[:2], SHA3[:2], SHA4[:2], SHA5[:2]]
    check("v7 d the next Plan sends every owed final, OLDEST run first (not the newest, not only the latest), and only then the new `planning`", order == want, (order, want))
    took = [t for t in site["took"] if t[0] in ("done", "failed", "cancelled")]
    check("v7 d ... and the site closed the old run once (`done` of the first run)", took.count(("done", OLD2)) == 1, took)

# (e) a final the site never answered, but the NEW run's opening was taken: the site has moved on, so the older final is not owed to the Plan after that
with tempfile.TemporaryDirectory() as tmp:
    si, run, dirs, down, site, lost = old_done_lost(tmp)
    dirs[NAMES[0]].mkdir()
    site["open"] = None                                                               # the site had taken the `done`; only its answer was lost
    run.plan(PID)
    wait(run)
    after_open = sum(1 for b in si.reports() if b["request_sha256"][:2] == OLD2)
    down.clear()
    run.cancel()
    wait(run)
    run.plan(PID)
    wait(run)
    check("v7 e the old final is not sent again once the next run's opening was taken", sum(1 for b in si.reports() if b["request_sha256"][:2] == OLD2) == after_open and lost, (after_open, [(b["state"], b["request_sha256"][:2]) for b in si.reports()]))

# (f) the same when the new Plan fails at once but the site takes the report of that run: the site has moved on, the older final is not owed to the Plan after that
with tempfile.TemporaryDirectory() as tmp:
    si, run, dirs, down, site, lost = old_done_lost(tmp)
    site["open"], site["state"] = (PID, SHA2), "planning"                              # the site had taken the `done`; only its answer was lost; this run's own report is taken
    run.plan(PID)
    wait(run)
    after_fail = sum(1 for b in si.reports() if b["request_sha256"][:2] == OLD2)
    took_new = [t for t in site["took"] if t[1] == SHA2[:2]]
    down.clear()
    dirs[NAMES[0]].mkdir()
    run.plan(PID)
    wait(run)
    check("v7 f the old final is not sent again once the site took a report of the next run (even a Plan that failed at once)", lost and bool(took_new) and sum(1 for b in si.reports() if b["request_sha256"][:2] == OLD2) == after_fail, (after_fail, took_new, [(b["state"], b["request_sha256"][:2]) for b in si.reports()]))

# ================= v8: BUILDER's 14:19 re-check of v7 =================
# (g) every Plan report went offline (the Plan's run never opened and still owes the old final); Build then finds the site again: the old final is sent first, so the site accepts Build's first report
with tempfile.TemporaryDirectory() as tmp:
    si, run, dirs, down, site, lost = old_done_lost(tmp)
    dirs[NAMES[0]].mkdir()
    down.add(None)
    run.plan(PID)
    wait(run)
    st = run.status()
    check("v8 g every Plan report went offline: the plan is drafted, its run never opened, and it still owes the old final", lost and st["state"] == "drafted" and not run.job["rep"].opened and run.job["rep"].older is not None, (st, site))
    down.clear()
    n = len(site["took"])
    run.build(PID)
    wait(run)
    got = site["took"][n:]
    st = run.status()
    check("v8 g ... Build sends the old `done` FIRST, then its own first report: not refused busy, the film is made", got[:2] == [("done", OLD2), ("planning", NEW2)] and st["state"] == "built" and not st.get("site_said"), (got, st))
    n = len(site["took"])
    run.plan(PID)
    wait(run)
    check("v8 g ... and the Plan after it sends no old final again (it was answered)", [t for t in site["took"][n:] if t[1] == OLD2] == [] and run.status()["state"] == "drafted", (site["took"][n:], run.status()))

# (h) the same, but the old run's reports are still out of reach at Build: the site refuses Build's first report 409 busy (a DIFFERENT run is open), the old final stays owed, and the next Plan sends it first
with tempfile.TemporaryDirectory() as tmp:
    si, run, dirs, down, site, lost = old_done_lost(tmp)
    dirs[NAMES[0]].mkdir()
    down.add(None)
    run.plan(PID)
    wait(run)
    down.discard(None)                                                               # the new request's reports are answered again, the old run's are not
    run.build(PID)
    wait(run)
    st = run.status()
    check("v8 h Build refused busy (the old run is still open on the site): no engine, the site's own words, and the old final is STILL owed (not lost for the session)",
          lost and st["state"] == "failed" and st["site_said"] == "busy" and site["open"] == (PID, SITE_SHA) and run.last_rep is not None and run.last_rep.final_lost and run.last_rep.sha == SITE_SHA, (st, site, run.last_rep))
    down.clear()
    n = len(site["took"])
    run.plan(PID)
    wait(run)
    got = site["took"][n:]
    check("v8 h ... Plan again settles the old final first, then plans (not refused busy for the rest of the session)", got[:2] == [("done", OLD2), ("planning", NEW2)] and run.status()["state"] == "drafted", (got, run.status()))

# (i) the server answers 409 busy for a DIFFERENT open run and moved_past for the SAME run going back; the app reacts to each in its own words, runs nothing, and is not stuck
with tempfile.TemporaryDirectory() as tmp:
    si, run, dirs, down, site, lost = old_done_lost(tmp)
    dirs[NAMES[0]].mkdir()
    run.plan(PID)
    wait(run)
    st = run.status()
    check("v8 i a DIFFERENT run is open on the site: 409 busy on the opening, nothing is run, busy words (never the moved_past words)", lost and st["state"] == "failed" and st["site_said"] == "busy" and st["site_words"] == RR.SITE_WORDS["busy"] and "Start again with Plan" not in st["site_words"], st)
    down.clear()
    run.plan(PID)
    wait(run)
    check("v8 i ... the next Plan (old final sent first) works", run.status()["state"] == "drafted", run.status())
with tempfile.TemporaryDirectory() as tmp:
    si, run, dirs, seen = setup(tmp, rk={"sleep": lambda s: None})
    run._recovered = True
    site = site_model(si, set())
    site["open"], site["state"] = (PID, SITE_SHA), "building"                          # the SAME request's run is already past planning on the site
    run.plan(PID)
    wait(run)
    st = run.status()
    check("v8 i the SAME run is open and past planning: 409 moved_past, nothing is run, and the words say to start again with Plan", seen == [] and st["state"] == "failed" and st["site_said"] == "moved_past" and st["site_words"] == RR.SITE_WORDS["moved_past"] and "Start again with Plan" in st["site_words"], (seen, st))

# (j) Build's own reports also go offline: the old final is still owed through it (Build's reporter keeps the chain until the site takes a report of the run), so the next Plan still sends it first
with tempfile.TemporaryDirectory() as tmp:
    si, run, dirs, down, site, lost = old_done_lost(tmp)
    dirs[NAMES[0]].mkdir()
    down.add(None)
    run.plan(PID)
    wait(run)
    run.build(PID)
    wait(run)
    check("v8 j Plan and Build both fully offline: the film is made, and the run still owes the old final", lost and run.status()["state"] == "built" and not run.last_rep.opened and run.last_rep.older is not None, (run.status(), site))
    down.clear()
    n = len(site["took"])
    run.plan(PID)
    wait(run)
    got = site["took"][n:]
    check("v8 j ... the next Plan sends the old `done` first, then plans (not refused busy)", got[:2] == [("done", OLD2), ("planning", NEW2)] and run.status()["state"] == "drafted", (got, run.status()))


# ================= v9: Ryan's 23:06 and 23:11 findings (progress in the request card, the manual maker collapsed, the house style) =================
HELP_PROGRESS = HELP_NEW + "  [--progress-file FILE]"
SECRET_NAME = "Secret_Wedding_Day2.mp4"
# the REAL engine line shape (Ryagram faces-compilations-progress-1127 ebd9dc51, compilation_progress.py Tracker._compute): phase, file_index, file_count, file_name, file_percent, percent, seconds_left_estimate
PLAN_LINES = [{"phase": "listening", "file_index": 1, "file_count": 3, "file_name": "Intro_Clip.mp4", "file_percent": 100, "percent": 33, "seconds_left_estimate": 400},
              {"phase": "listening", "file_index": 2, "file_count": 3, "file_name": SECRET_NAME, "file_percent": 40, "percent": 45, "seconds_left_estimate": 200}]
# the engine's building line carries the LAST VIDEO's index and count (the Tracker's record has no clip numbers), so nothing in it is a clip count
BUILD_LINES = [{"phase": "building", "file_index": 3, "file_count": 3, "file_name": SECRET_NAME, "file_percent": 100, "percent": 97, "seconds_left_estimate": None}]
MATCH_LINE = {"phase": "matching", "file_index": 3, "file_count": 3, "file_name": SECRET_NAME, "file_percent": 100, "percent": 95, "seconds_left_estimate": None}
DONE_LINE = {"phase": "done", "file_index": 0, "file_count": 3, "file_name": SECRET_NAME, "file_percent": 100, "percent": 100, "seconds_left_estimate": None}


def make_popen_p(seen=None, plan="ok", build="ok", plan_lines=(), build_lines=()):
    """make_popen, and the engine also writes what the real --progress-file gets, when it was given the option."""
    base = make_popen(seen=seen, plan=plan, build=build)

    def popen(cmd, **kw):
        if has_flag(cmd, "--progress-file"):
            Path(arg(cmd, "--progress-file")).write_text("".join(json.dumps(x) + "\n" for x in (plan_lines if "draft-request" in cmd else build_lines)), encoding="utf-8")
        return base(cmd, **kw)
    return popen


# ---- (1) reading the engine's progress lines: tolerant of anything, and the file NAME is only a name
pl = RR.parse_progress_line
got = pl(PLAN_LINES[1])
check("v9 1 a full progress line is read; the file name is cut to the name (no folder, no drive)", got == {"phase": "listening", "file_index": 2, "file_count": 3, "file_name": SECRET_NAME, "file_percent": 40, "percent": 45, "seconds_left_estimate": 200}, got)
check("v9 1 missing keys are fine: a line with only percent is read", pl({"percent": 45}) == {"percent": 45, "phase": ""}, pl({"percent": 45}))
check("v9 1 a line that is not JSON, not an object, empty or full of wrong types holds nothing", [pl("not json"), pl("[1,2]"), pl("{}"), pl({"file_index": "2", "percent": "45", "file_name": 5}), pl(None)] == [None] * 5, [pl("not json"), pl({"file_index": "2"})])
check("v9 1 true/false, nan and infinity are not numbers", pl({"percent": True, "file_index": float("nan"), "file_count": float("inf"), "file_percent": False, "seconds_left_estimate": True}) is None, pl({"percent": True}))
check("v9 1 a percent past 100 or under 0 is made right; a float becomes a whole number; a huge count is capped at 1000",
      pl({"percent": 140, "file_percent": -5, "file_count": 99999, "file_index": 44.6}) == {"percent": 100, "file_percent": 0, "file_count": 1000, "file_index": 45, "phase": ""}, pl({"percent": 140, "file_percent": -5, "file_count": 99999, "file_index": 44.6}))
check("v9 1 an unknown phase is empty, never the engine's own text", pl({"phase": "<b>evil</b>", "percent": 1})["phase"] == "", pl({"phase": "<b>evil</b>", "percent": 1}))
check("v9 1 every phase the real engine writes is known (planning, listening, matching, building, done, failed, cancelled); the old guessed word (cutting) is not", [pl({"phase": x, "percent": 1})["phase"] for x in ("planning", "listening", "matching", "building", "done", "failed", "cancelled", "cutting")] == ["planning", "listening", "matching", "building", "done", "failed", "cancelled", ""], None)
check("v9 1 the guessed key names of the first draft (file_pct, overall_pct, eta_s, clip_index, clip_count) are not read at all", pl({"file_pct": 5, "overall_pct": 5, "eta_s": 5, "clip_index": 1, "clip_count": 2}) is None, pl({"overall_pct": 5}))
nm = pl({"file_name": "x/<script>" + "a" * 300 + "\x00.mp4", "percent": 1}).get("file_name", "")
check("v9 1 a file name is plain text of at most 120 characters: no angle brackets, no control characters", 0 < len(nm) <= 120 and "<" not in nm and ">" not in nm and "\x00" not in nm, nm)

# ---- (2) what the SITE is told: three integers, by BUILDER's rule 1 (a video in a plan, a clip in a build)
v = pl(PLAN_LINES[1])
check("v9 2 a plan tells the site video 2 of 3 and 45 percent: step_done, step_total, percent, nothing else", RR.site_progress(v, "plan") == {"step_done": 2, "step_total": 3, "percent": 45}, RR.site_progress(v, "plan"))
check("v9 2 a build line has no clip numbers (its file_index/file_count are the VIDEOS): the site gets the percent only, never a video count as a clip count", RR.site_progress(pl(BUILD_LINES[0]), "build") == {"percent": 97}, RR.site_progress(pl(BUILD_LINES[0]), "build"))
check("v9 2 matching: the step is all the videos (as the engine's own report numbers say), the percent 95", RR.site_progress(pl(MATCH_LINE), "plan") == {"step_done": 3, "step_total": 3, "percent": 95}, RR.site_progress(pl(MATCH_LINE), "plan"))
check("v9 2 done, failed and cancelled lines give the site nothing (rule 2: no numbers on an end state)", [RR.site_progress(pl(dict(DONE_LINE, phase=x)), "plan") for x in ("done", "failed", "cancelled")] == [{}, {}, {}], None)
check("v9 2 a build never reads video counts", RR.site_progress(pl({"file_index": 1, "file_count": 2}), "build") == {} and RR.site_progress(pl({"phase": "building", "file_index": 1, "file_count": 2, "percent": 96}), "build") == {"percent": 96}, RR.site_progress(pl({"file_index": 1, "file_count": 2}), "build"))
check("v9 2 only percent is sent when the counts are missing; step_done is never sent alone", RR.site_progress(pl({"percent": 45}), "plan") == {"percent": 45} and "step_done" not in RR.site_progress(pl({"file_index": 2, "percent": 45}), "plan"), RR.site_progress(pl({"file_index": 2, "percent": 45}), "plan"))
check("v9 2 step_done never passes step_total", RR.site_progress(pl({"phase": "listening", "file_index": 9, "file_count": 3}), "plan") == {"step_done": 3, "step_total": 3}, RR.site_progress(pl({"file_index": 9, "file_count": 3}), "plan"))
check("v9 2 planning (the engine knows the count, no video has started): step 0 of 3 is a legal pair", RR.site_progress(pl({"phase": "planning", "file_index": 0, "file_count": 3, "percent": 0}), "plan") == {"step_done": 0, "step_total": 3, "percent": 0}, RR.site_progress(pl({"phase": "planning", "file_index": 0, "file_count": 3, "percent": 0}), "plan"))
check("v9 2 whatever the engine writes, the site numbers are exactly the three keys and all whole numbers", all(set(RR.site_progress(pl(x), k)) <= set(RR.PROGRESS_KEYS) and all(type(n) is int for n in RR.site_progress(pl(x), k).values()) for x in PLAN_LINES + BUILD_LINES for k in ("plan", "build")), None)

# ---- (3) the words on this computer's page (the file name is shown here, and only here)
w = RR.progress_view(v, "plan")
check("v9 3 the plan words: 'Listening to video 2 of 3: <file name>'", w["headline"] == "Listening to video 2 of 3: " + SECRET_NAME, w)
check("v9 3 ... that video's percent, the overall percent, and a rough time left labelled as an estimate", w["detail"] == "This video: 40% \u00b7 Overall: 45% \u00b7 about 3 minutes left (an estimate)" and w["overall"] == 45, w)
check("v9 3 the build words from a REAL building line: the engine gives no clip number, so no 'clip N of M' is made up from the video counts; the fallback words and the overall percent", RR.progress_view(pl(BUILD_LINES[0]), "build") == {"headline": "Building your film on this computer", "detail": "Overall: 97%", "overall": 97, "file_pct": None}, RR.progress_view(pl(BUILD_LINES[0]), "build"))
check("v9 3 matching (real line: still file_index 3 of 3) says 'Finding your words', not 'Listening to video 3 of 3'", RR.progress_view(pl(MATCH_LINE), "plan")["headline"] == "Finding your words in what it heard" and RR.progress_view(pl(MATCH_LINE), "plan")["overall"] == 95, RR.progress_view(pl(MATCH_LINE), "plan"))
check("v9 3 planning (before any video starts) says 'Listening to your videos'", RR.progress_view(pl({"phase": "planning", "file_index": 0, "file_count": 3, "percent": 0}), "plan")["headline"] == "Listening to your videos", RR.progress_view(pl({"phase": "planning", "file_index": 0, "file_count": 3, "percent": 0}), "plan"))
check("v9 3 done, failed and cancelled lines show no progress (the card shows the result, not a bar)", [RR.progress_view(pl(dict(DONE_LINE, phase=x)), "plan") for x in ("done", "failed", "cancelled")] == [None, None, None], None)
check("v9 3 a real listening line with seconds_left_estimate 0 says less than a minute; None says nothing", "less than a minute" in RR.progress_view(pl(dict(PLAN_LINES[0], seconds_left_estimate=0)), "plan")["detail"] and "left" not in RR.progress_view(pl(dict(PLAN_LINES[1], seconds_left_estimate=None)), "plan")["detail"], None)
check("v9 3 no file name given: no colon and no name; a short time left says less than a minute; no eta: no time words",
      RR.progress_view(pl({"file_index": 1, "file_count": 2, "percent": 5, "seconds_left_estimate": 30}), "plan") == {"headline": "Listening to video 1 of 2", "detail": "Overall: 5% \u00b7 less than a minute left (an estimate)", "overall": 5, "file_pct": None}
      and "left" not in RR.progress_view(pl({"file_index": 1, "file_count": 2, "percent": 5}), "plan")["detail"], RR.progress_view(pl({"file_index": 1, "file_count": 2, "percent": 5, "seconds_left_estimate": 30}), "plan"))
check("v9 3 nothing from the engine yet: no progress view (the page shows its own 'looking through' words and the ring)", RR.progress_view(None, "plan") is None and RR.progress_view({}, "plan") is None, None)

# ---- (4) report_run takes the three numbers only as BUILDER's four rules allow
sh = SignIn()
base_p = {"project_id": PID, "request_sha256": SITE_SHA, "state": "matching"}
res = lambda extra, state="matching": RR.report_run(sh, {**base_p, "state": state, **extra}, sha256=SITE_SHA)
check("v9 4 the three numbers go to the route as whole numbers, with a running state", res({"step_done": 2, "step_total": 3, "percent": 45}) == "ok" and bool(sh.calls) and sh.calls[-1][2].get("step_done") == 2 and sh.calls[-1][2].get("percent") == 45, sh.calls[-1:])
n0 = len(sh.calls)
bad = [dict(step_done=2), dict(step_done=4, step_total=3), dict(step_total=1001), dict(percent=101), dict(percent=-1), dict(step_total=3.5), dict(percent=45.5), dict(percent="45"), dict(step_total=True), dict(step_done=-1, step_total=3)]
check("v9 4 a lone step_done, step_done past step_total, step_total over 1000, a percent out of 0-100, a float, a string, a bool: all refused by the app itself, nothing sent",
      [res(b) for b in bad] == ["app_refused"] * len(bad) and len(sh.calls) == n0, [res(b) for b in bad])
check("v9 4 rule 2: no report with an END state carries the numbers (done, failed, cancelled): the app refuses it itself", [res({"percent": 50}, s) for s in ("done", "failed", "cancelled")] == ["app_refused"] * 3 and len(sh.calls) == n0, [res({"percent": 50}, s) for s in ("done", "failed", "cancelled")])
check("v9 4 rule 4: all three absent is today's report, unchanged", res({}) == "ok" and bool(sh.calls) and not set(sh.calls[-1][2]) & set(RR.PROGRESS_KEYS), sh.calls[-1:])
check("v9 4 the route's keys are the old ones and exactly BUILDER's three new names", set(RR.REPORT_KEYS) - {"project_id", "request_sha256", "state", "matches", "clips", "film_seconds", "error_code"} == {"step_done", "step_total", "percent"}, RR.REPORT_KEYS)

# ---- (5) the reporter: the numbers go only with a running state, are cleared for the end, and never go faster than one report in 10 s
si = SignIn()
clk, rp = new_reporter(si)
rp.step("planning")
rp.set_progress({"step_done": 2, "step_total": 3, "percent": 45})
rp.step("matching", matches=1, clips=1)
rp.step("building")
rp.step("done", matches=1, clips=1, film_seconds=3.5)
rs = si.reports()
check("v9 5 the numbers ride the running reports and not the opening one or the final one", [bool(set(b) & set(RR.PROGRESS_KEYS)) for b in rs] == [False, True, True, False] and rs[1]["step_total"] == 3 and rs[1]["percent"] == 45, rs)
si = SignIn()
clk, rp = new_reporter(si)
rp.step("planning")
rp.set_progress({"step_done": 1, "step_total": 3, "percent": 10})
clk.t += 5
check("v9 5 rule 3: nothing is sent 5 s after the last report, even with new numbers", rp.progress_due() is True and rp.heartbeat(RR.PROGRESS_GAP_S) is False and len(si.reports()) == 1, len(si.reports()))
clk.t += 5
check("v9 5 ... and 10 s after it the numbers go as the same-state report", rp.heartbeat(RR.PROGRESS_GAP_S) is True and si.reports()[-1]["state"] == "planning" and si.reports()[-1]["step_total"] == 3 and si.reports()[-1]["percent"] == 10, si.reports()[-1])
check("v9 5 ... and once the site has them, nothing is due until the numbers change", rp.progress_due() is False, rp.progress_due())
si = SignIn()
clk, rp = new_reporter(si)
rp.step("planning")
for k in range(1, 61):                      # a minute of new numbers every second, the page polling as the runner does
    clk.t += 1
    rp.set_progress({"step_done": 1, "step_total": 3, "percent": k})
    if rp.progress_due():
        rp.heartbeat(RR.PROGRESS_GAP_S)
check("v9 5 rule 3: 60 s of changing numbers is at most 6 progress reports (one per 10 s)", 1 <= len(si.reports()) - 1 <= 6, len(si.reports()))
si = SignIn()
clk, rp = new_reporter(si)
rp.step("planning")
rp.set_progress({"step_done": 2, "step_total": 3, "percent": 45})
rp.step("matching")
rp.clear_progress()
clk.t += 1
check("v9 5 clear_progress: the next report has no numbers (the site then holds none)", rp.heartbeat(0) and not set(si.reports()[-1]) & set(RR.PROGRESS_KEYS), si.reports()[-1])

# ---- (6) rule 4: an older server answers 400 to the new keys; the app sends the same report without them, once, and goes on without them for the run
OLDSRV = lambda route, body: (400, {"error": "invalid_request"}) if set(body) & set(RR.PROGRESS_KEYS) else None
si = SignIn()
si.respond = OLDSRV
clk, rp = new_reporter(si)
rp.step("planning")
rp.set_progress({"step_done": 2, "step_total": 3, "percent": 45})
ok = rp.step("matching", matches=1, clips=1)
rs = si.reports()
check("v9 6 an older route (400 to the new keys): the report is sent again without them and the site takes it", ok and len(rs) == 3 and set(rs[1]) & set(RR.PROGRESS_KEYS) and not set(rs[2]) & set(RR.PROGRESS_KEYS) and rp.last_result == "ok", rs)
check("v9 6 ... that is not a refusal: no refusal words, no failure counted, and the numbers stay off for this run", rp.last_refusal is None and rp.failures == 0 and rp.progress_off is True and rp.sent[-1].get("state") == "matching", (rp.last_refusal, rp.failures))
n = len(si.reports())
rp.set_progress({"step_done": 3, "step_total": 3, "percent": 60})
rp.step("building")
check("v9 6 ... later reports of the run carry none, so there are no more 400s", len(si.reports()) == n + 1 and not set(si.reports()[-1]) & set(RR.PROGRESS_KEYS), si.reports()[n:])
si = SignIn()
si.respond = OLDSRV
clk, rp = new_reporter(si)
rp.step("planning")
rp.set_progress({"step_done": 1, "step_total": 3, "percent": 10})
clk.t += 20
sent = rp.heartbeat(RR.PROGRESS_GAP_S)
check("v9 6 the same for a progress heartbeat: retried without the keys, the run's heartbeats are not switched off", sent and rp.beats == ["ok"] and rp.beats_off is False and rp.progress_off is True, (rp.beats, rp.beats_off))
si = SignIn()
si.respond = lambda route, body: (409, {"error": "busy"}) if set(body) & set(RR.PROGRESS_KEYS) else None
clk, rp = new_reporter(si)
rp.step("planning")
rp.set_progress({"step_done": 1, "step_total": 3, "percent": 10})
rp.step("matching")
check("v9 6 only a 400 triggers the retry: a 409 busy is still the refusal it was", rp.last_result == "busy" and rp.progress_off is False and len(si.reports()) == 2, (rp.last_result, len(si.reports())))

# ---- (7) the command lines: --progress-file only when the engine's own help lists it, written into the run's work folder
with tempfile.TemporaryDirectory() as tmp:
    si, run, dirs, seen = setup(tmp)
    run.plan(PID)
    wait(run)
    check("v9 7 an engine whose help does not list --progress-file is not given it (an older engine would refuse the whole command)", not has_flag(seen[0], "--progress-file"), seen[0])
    run.build(PID)
    wait(run)
    check("v9 7 ... nor is its build", not has_flag(seen[1], "--progress-file") and run.status()["state"] == "built", seen[1])
with tempfile.TemporaryDirectory() as tmp:
    si, run, dirs, seen = setup(tmp, rk={"probe": lambda: (0, HELP_PROGRESS)})
    run.plan(PID)
    wait(run)
    pf = Path(arg(seen[0], "--progress-file")) if has_flag(seen[0], "--progress-file") else Path("none")
    check("v9 7 an engine that lists it is given --progress-file=<work folder>/progress.jsonl for a plan", has_flag(seen[0], "--progress-file") and pf.name == "progress.jsonl" and pf.parent == Path(arg(seen[0], "--work-dir")), (pf, seen[0]))
    run.build(PID)
    wait(run)
    pb = Path(arg(seen[1], "--progress-file")) if has_flag(seen[1], "--progress-file") else Path("none")
    check("v9 7 ... and for the build, in the same work folder", pb.name == "progress.jsonl" and pb.parent == pf.parent and has_flag(seen[1], "--progress-file"), seen[1])
    check("v9 7 the option is written --flag=value like every other (no value is ever a separate argument)", "--progress-file" not in seen[0] and "--progress-file" not in seen[1], seen[0])

# ---- (7b) the REAL engine's help (Ryagram faces-compilations-progress-1127 ebd9dc51, captured from `python -m ryagram.local <sub> --help`): draft-request lists --progress-file, build-edit does NOT
REAL_HELP_DRAFT = """usage: ryagram-local draft-request [-h] [--folder NAME=FOLDER] --work-dir
                                   WORK_DIR --out OUT
                                   [--model {tiny,base,small}]
                                   [--report-file FILE] [--project UUID]
                                   [--progress-file FILE] [--preview]
                                   [--preview-clips N] [--preview-seconds S]
                                   [--request-sha256 HEX]
                                   request

options:
  --report-file FILE    also write the run's progress for the site here, one
                        JSON line per state (planning, matching, done or
                        failed): counts and a closed error code only
  --progress-file FILE  LOCAL ONLY, for the app's own page: append one JSON
                        line of progress (phase, which video N of M and its
                        file name, that video's percent, the overall percent,
                        a rough time left) at most twice a second; with
                        --report-file the report lines also carry counts only
                        (step_done, step_total, percent). Nothing is written
                        without it
"""
REAL_HELP_BUILD = """usage: ryagram-local build-edit [-h] [--media FILE_OR_FOLDER]
                                [--image ID=FILE] [--slide-pieces FILE]
                                [--slides-at {start,end}] --work-dir WORK_DIR
                                --out OUT [--proxy]
                                [--export {youtube,shorts,square}]
                                [--previous PREVIOUS]
                                [--options-file OPTIONS_FILE] [--preview]
                                edit
"""
with tempfile.TemporaryDirectory() as tmp:
    si, run, dirs, seen = setup(tmp, rk={"probe": None})
    run._run_help = lambda sub="draft-request": (0, {"draft-request": REAL_HELP_DRAFT, "build-edit": REAL_HELP_BUILD}[sub])
    check("v9 7b the real draft-request help lists --progress-file: the app passes it for a plan", run._can_progress("draft-request") is True, None)
    check("v9 7b the real build-edit help does not: the app does not pass it to a build (and the page shows no made-up build progress)", run._can_progress("build-edit") is False, None)
    check("v9 7b the option NAME the app looks for is the real one", RR.PROGRESS_FLAG == "--progress-file" and "[--progress-file FILE]" in REAL_HELP_DRAFT, RR.PROGRESS_FLAG)
    check("v9 7b a help that only mentions the flag in another option's words does not count as listing it", RR.help_lists_flag("  --other FILE  like --progress-file but not it\n", "--progress-file") is False and RR.help_lists_flag(REAL_HELP_DRAFT, "--progress-file") is True and RR.help_lists_flag(REAL_HELP_BUILD, "--progress-file") is False, None)
with tempfile.TemporaryDirectory() as tmp:
    si, run, dirs, seen = setup(tmp, rk={"probe": None})
    run._run_help = lambda sub="draft-request": (0, {"draft-request": REAL_HELP_DRAFT, "build-edit": REAL_HELP_BUILD}[sub])
    run.plan(PID)
    wait(run)
    run.build(PID)
    wait(run)
    check("v9 7b a whole plan and build against the real helps: the plan is given --progress-file, the build is not, and both finish", has_flag(seen[0], "--progress-file") and not has_flag(seen[1], "--progress-file") and run.status()["state"] == "built", (seen, run.status()))

# ---- (8) a plan and a build with progress: the page sees the file name, the site sees three integers and never a name
with tempfile.TemporaryDirectory() as tmp:
    clk = [1e9]
    si, run, dirs, seen = setup(tmp, plan="hang", rk={"probe": lambda: (0, HELP_PROGRESS), "clock": lambda: clk[0]})
    run.popen = make_popen_p(seen=seen, plan="hang", plan_lines=PLAN_LINES)
    run.plan(PID)
    up = until(lambda: run.status().get("progress") is not None)
    st = run.status()
    check("v9 8 while Plan runs the status carries the progress words with the local file name", up and st["progress"]["headline"] == "Listening to video 2 of 3: " + SECRET_NAME and st["progress"]["overall"] == 45, st.get("progress"))
    time.sleep(0.2)
    check("v9 8 rule 3: the site is not told the numbers in the first 10 s", not any("step_total" in b for b in si.reports()), si.reports())
    clk[0] += 11
    got = until(lambda: any("step_total" in b for b in si.reports()))
    sent_p = [b for b in si.reports() if "step_total" in b]
    check("v9 8 after 10 s the site is told video 2 of 3 and 45 percent as three integers", got and {k: sent_p[-1][k] for k in RR.PROGRESS_KEYS} == {"step_done": 2, "step_total": 3, "percent": 45} and sent_p[-1]["state"] == "planning", si.reports())
    blob = json.dumps(si.calls)
    check("v9 8 NO file name, folder or word of the video goes in any report (the secret name, the intro clip's name, the folder names)", SECRET_NAME not in blob and "Intro_Clip" not in blob and "Secret" not in blob and not no_leak(si, dirs), (no_leak(si, dirs), [x for x in ("Secret", "Intro_Clip") if x in blob]))
    check("v9 8 every progress value in a report is a plain int", all(type(b[k]) is int for b in si.reports() for k in RR.PROGRESS_KEYS if k in b), si.reports())
    n = len(si.reports())
    time.sleep(0.2)
    check("v9 8 the same numbers are not sent again (and not faster than one report in 10 s)", len(si.reports()) == n, (n, len(si.reports())))
    run.cancel()
    wait(run)
    last = si.reports()[-1]
    check("v9 8 Cancel: the final report carries no numbers (rule 2), and the page's progress is gone", last["state"] == "cancelled" and not set(last) & set(RR.PROGRESS_KEYS) and "progress" not in run.status(), (last, run.status()))
with tempfile.TemporaryDirectory() as tmp:
    si, run, dirs, seen = setup(tmp, rk={"probe": lambda: (0, HELP_PROGRESS)})
    run.popen = make_popen_p(seen=seen, plan_lines=PLAN_LINES, build_lines=BUILD_LINES)
    run.plan(PID)
    wait(run)
    rs = si.reports()
    check("v9 8 a finished plan: matching carried the video numbers, then one report with none, so the site is not left showing 'video 2 of 3' while it waits for Build",
          [bool(set(b) & set(RR.PROGRESS_KEYS)) for b in rs] == [False, True, False] and [b["state"] for b in rs] == ["planning", "matching", "matching"], rs)
    run.build(PID)
    wait(run)
    rs = si.reports()
    check("v9 8 the build's own reports (building, done) carry no video numbers and no stale ones", [b["state"] for b in rs[3:]] == ["building", "done"] and not any(set(b) & set(RR.PROGRESS_KEYS) for b in rs[3:]), rs[3:])
with tempfile.TemporaryDirectory() as tmp:
    si, run, dirs, seen = setup(tmp, build="hang", rk={"probe": lambda: (0, HELP_PROGRESS)})
    run.popen = make_popen_p(seen=seen, build="hang", plan_lines=PLAN_LINES, build_lines=BUILD_LINES)
    run.plan(PID)
    wait(run)
    run.build(PID)
    up = until(lambda: run.status().get("progress") is not None)
    check("v9 8 while a Build runs that does write a building line the page says the fallback words with the overall percent (no clip count is made up)", up and run.status()["progress"]["headline"] == "Building your film on this computer" and run.status()["progress"]["overall"] == 97, run.status().get("progress"))
    check("v9 8 the build's site numbers are the percent only (the line has video counts, not clips)", run.last_rep.progress == {"percent": 97}, run.last_rep.progress)
    run.cancel()
    wait(run)
with tempfile.TemporaryDirectory() as tmp:
    si, run, dirs, seen = setup(tmp, plan="hang", rk={"probe": lambda: (0, HELP_PROGRESS)})
    pf_lines = PLAN_LINES[:1]
    base_popen = make_popen_p(seen=seen, plan="hang", plan_lines=pf_lines)
    run.popen = base_popen
    run.plan(PID)
    until(lambda: run.status().get("progress") is not None)
    wd = Path(arg(seen[0], "--progress-file")).parent
    with open(wd / "progress.jsonl", "a", encoding="utf-8") as f:
        f.write("this is not json\n" + json.dumps({"overall_pct": "x"}) + "\n" + json.dumps(PLAN_LINES[1])[:30])       # junk lines, and a half-written last line
    time.sleep(0.2)
    check("v9 8 junk lines and a half-written line are skipped: the page keeps the last good line", run.status()["progress"]["headline"].startswith("Listening to video 1 of 3"), run.status().get("progress"))
    run.cancel()
    wait(run)
with tempfile.TemporaryDirectory() as tmp:
    si, run, dirs, seen = setup(tmp, plan="hang")                       # an engine with no --progress-file: no progress, the run still goes, and the page still has its ring
    run.plan(PID)
    time.sleep(0.2)
    check("v9 8 no --progress-file in the engine: no progress block is made up (the page falls back to its own words and the ring)", "progress" not in run.status() and run.status()["state"] == "planning", run.status())
    run.cancel()
    wait(run)

# ---- (9) the page: the hand-made section is ONE closed section, the model download is reachable from the request card, the old look is gone, the house look is in
if D is not None:
    page, css, js = D.PAGE, D.CSS, D.JS
    d0 = page.find('<details class="advanced" id="manual">')
    d1 = page.find("</details>\n<!--V2-->")
    check("v9 9 the manual maker is under one <details id=manual>, closed by default (no open attribute), titled 'Make a film by hand (advanced)'", d0 >= 0 and d1 > d0 and "<summary>Make a film by hand (advanced)</summary>" in page[d0:d0 + 120] and " open" not in page[d0:d0 + 40], page[d0:d0 + 120])
    inside = page[d0:d1]
    check("v9 9 everything from '1. Recipe' down is inside it: recipe, words, files, listening model, Plan, Build", all(x in inside for x in ('id="h-recipe"', 'id="words"', 'id="slots"', 'id="model"', 'id="plan"', 'id="build"')), [x for x in ('id="h-recipe"', 'id="words"', 'id="slots"', 'id="model"', 'id="plan"', 'id="build"') if x not in inside])
    ai0, ai1 = page.find('<section class="logbox" id="airq"'), page.find('<section class="logbox" id="links"')
    check("v9 9 the request card itself is NOT inside the collapsed section", 0 <= ai0 < ai1 < d0, (ai0, ai1, d0))
    card = page[ai0:ai1]
    check("v9 9 the listening-model download is reachable from the request card: a Download button, a Cancel, a progress bar and a way to choose another model", all(x in card for x in ('id="airq-model-go"', 'id="airq-model-stop"', 'id="airq-model-bar"', 'id="airq-model-status"', 'id="airq-model-pick"')), [x for x in ('id="airq-model-go"', 'id="airq-model-stop"', 'id="airq-model-bar"', 'id="airq-model-pick"') if x not in card])
    check("v9 9 ... the card's Download and the manual section's Download run the same function, and the card shows when the model is missing", js.count("startModelDl") >= 3 and "$('airq-model-go').addEventListener('click', startModelDl)" in js and "$('model-dl-go').addEventListener('click', startModelDl)" in js and "$('airq-model').hidden = !show" in js, js.count("startModelDl"))
    check("v9 9 ... 'choose another' opens the section and focuses the model list", "$('manual').open = true; $('model').scrollIntoView" in js and "$('model').focus()" in js, None)
    check("v9 9 ?advanced=1 and #manual open the section", "$('manual').open = true; }" in js and "location.hash === '#manual'" in js, None)
    check("v9 9 the request path still reads the model from the same list the hand-made section holds (the list is in the page, only folded)", "model: $('model').value" in js or "$('model').value" in js, None)
    old = ("#175c52", "#6fd1bd", "var(--brand)", "#1f2a2a", "#fff3cd", "border-radius:999px;border:1px solid var(--brand)")
    check("v9 9 the old look is gone: no teal or green brand colour, no outlined green pill, no yellow banner, in the page's CSS", not [x for x in old if x in css], [x for x in old if x in css])
    check("v9 9 the house primary button rule is there: orange gradient, the soft low glow, no hard-edged shadow", ".button.primary{background-color:#ff8a3c;background-image:linear-gradient(180deg,#ffa05c,#ff7a26)" in css and "0 10px 30px var(--glow)" in css and "--glow:rgba(255,138,61,.28)" in css and "0 0 0 " not in css.split(".button.primary{")[1].split("}")[0], css.split(".button.primary{")[1][:300] if ".button.primary{" in css else "no rule")
    check("v9 9 dark theme like the site: --bg #0b0c11, --ink #f4f3ef, the site's sans stack, system fonts only", "--bg:#0b0c11" in css and "--ink:#f4f3ef" in css and "ui-sans-serif,system-ui" in css and "color-scheme:dark" in css, None)
    check("v9 9 self-contained: no @import, no url(), no web address, no font file in the CSS", not re.search(r"@import|url\(|https?://|\.woff|@font-face", css), re.findall(r"@import|url\(|https?://|\.woff|@font-face", css))
    check("v9 9 the focus ring is visible (3 px orange) and the buttons are at least 44 px high", "\n:focus-visible{outline:3px solid var(--accent);outline-offset:3px" in css and "min-height:48px" in css.split(".button{")[1].split("}")[0] and "min-height:44px" in css.split(".button.small{")[1].split("}")[0], None)
    check("v9 9 the spinner stops under prefers-reduced-motion (a still ring), and the bar stops animating", "@media (prefers-reduced-motion:reduce)" in css and ".spinner{animation:none" in css.split("prefers-reduced-motion")[1], None)

    def lum(h):
        c = [int(h[i:i + 2], 16) / 255 for i in (1, 3, 5)]
        c = [x / 12.92 if x <= 0.03928 else ((x + 0.055) / 1.055) ** 2.4 for x in c]
        return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]

    def ratio(a, b):
        la, lb = sorted((lum(a), lum(b)), reverse=True)
        return (la + 0.05) / (lb + 0.05)
    pairs = {"ink on bg": ("#f4f3ef", "#0b0c11"), "ink-2 on paper": ("#c9c8c2", "#12141c"), "muted on bg": ("#9a99a3", "#0b0c11"), "muted on soft": ("#9a99a3", "#1a1c26"), "primary button text on its light end": ("#1a1008", "#ffa05c"),
             "primary button text on its dark end": ("#1a1008", "#ff7a26"), "link on bg": ("#9cc0f2", "#0b0c11"), "accent-2 on bg": ("#ffb27a", "#0b0c11"), "bad on bg": ("#ffb4a8", "#0b0c11"), "ok on bg": ("#8fe3cf", "#0b0c11")}
    low = {k: round(ratio(*v), 2) for k, v in pairs.items() if ratio(*v) < 4.5}
    check("v9 9 every text colour the page uses reads at 4.5:1 or better on its ground", not low, low)
    check("v9 9 the page's script draws nothing the page's own security policy (style-src 'self') would block: no inline style attribute, no innerHTML", "setAttribute('style'" not in js and ".innerHTML" not in js and ".style.cssText" not in js, None)
    check("v9 9 the request card's buttons carry the house classes (Plan and Build are .button, one of them primary)", "class: 'button ' + (waiting ? 'secondary' : 'primary')" in js and "class: 'button ' + (waiting ? 'primary' : 'secondary')" in js, None)

    # the page script, run in node: the progress block and the request block that holds it
    import shutil as _sh
    def grab(src, marker):
        s0 = src.find(marker)
        depth, i = 0, s0
        while s0 >= 0 and i < len(src):
            depth += (src[i] == "{") - (src[i] == "}")
            i += 1
            if depth == 0 and i > s0 + 30:
                break
        return src[s0:i] if s0 >= 0 else ""
    pv_src, rb_src = grab(js, "function progressView() {"), grab(js, "function runBlock(x) {")
    JS_PROG = r"""
const pend = []; global.setTimeout = (fn, ms) => { pend.push(fn); return 1; }; global.clearTimeout = () => {};
const el = (tag, attrs, ...kids) => ({ tag, attrs, kids: kids.flat(), textContent: '', hidden: false, value: 0, isConnected: true, replaceChildren(...k) { this.kids = k.flat(); } });
const RUN = %s;
async function api(path, body) { return { run: RUN, folders: [] }; }
%s
%s
(async () => {
  const box = runBlock({ project_id: 'p' });
  await new Promise(r => setImmediate(r)); await new Promise(r => setImmediate(r));
  const pvn = box.kids[1], top0 = box.kids[0], head = pvn.kids[0].kids[1], bar = pvn.kids[1], detail = pvn.kids[2], spin = pvn.kids[0].kids[0];
  const f = pend.shift(); if (f) { await f(); await new Promise(r => setImmediate(r)); }
  console.log(JSON.stringify({ same: box.kids[1] === pvn && box.kids[0] === top0 && pvn.kids[0].kids[0] === spin, hidden: pvn.hidden, head: head.textContent, detail: detail.textContent, barHidden: bar.hidden, barValue: bar.value, spin: spin.attrs.class, spinAria: spin.attrs['aria-hidden'], label: pvn.attrs['aria-label'] }));
})();
"""
    if not (pv_src and rb_src) or not _sh.which("node"):
        print("SKIPPED  v9 9 the progress block run in node (no node on PATH, or the functions were not found): NOT RUN, not a pass")
    else:
        with tempfile.TemporaryDirectory() as tmp:
            jf = Path(tmp) / "prog.js"
            outs = {}
            runs = {"planning": {"project_id": "p", "state": "planning", "progress": {"headline": "Listening to video 2 of 3: " + SECRET_NAME, "detail": "This video: 40% \u00b7 Overall: 45%", "overall": 45, "file_pct": 40}},
                    "nodata": {"project_id": "p", "state": "planning"},
                    "building": {"project_id": "p", "state": "building", "progress": {"headline": "Cutting clip 3 of 4", "detail": "Overall: 72%", "overall": 72, "file_pct": None}},
                    "nopercent": {"project_id": "p", "state": "planning", "progress": {"headline": "Listening to your videos", "detail": "", "overall": None, "file_pct": None}},
                    "idle": {"project_id": "p", "state": "drafted"},
                    "other": {"project_id": "other", "state": "planning", "progress": {"headline": "x", "detail": "", "overall": 1}}}
            for k, runv in runs.items():
                jf.write_text(JS_PROG % (json.dumps(runv), pv_src, rb_src), encoding="utf-8")
                r = subprocess.run(["node", str(jf)], capture_output=True, text=True, encoding="utf-8", timeout=60)
                try:
                    outs[k] = json.loads(r.stdout.strip().splitlines()[-1])
                except Exception:  # noqa: BLE001
                    outs[k] = {"error": (r.stdout + r.stderr)[-300:]}
            check("v9 9 while planning the card shows the ring, 'Listening to video 2 of 3: <file name>', the percents and a bar at 45", outs["planning"].get("hidden") is False and outs["planning"].get("head") == "Listening to video 2 of 3: " + SECRET_NAME and outs["planning"].get("detail") == "This video: 40% \u00b7 Overall: 45%" and outs["planning"].get("barHidden") is False and outs["planning"].get("barValue") == 45 and outs["planning"].get("spin") == "spinner" and outs["planning"].get("spinAria") == "true", outs["planning"])
            check("v9 9 the progress block is built once and updated in place: the ring is the same element after the next poll, so it keeps turning", outs["planning"].get("same") is True and outs["planning"].get("hidden") is False and outs["planning"].get("head") == "Listening to video 2 of 3: " + SECRET_NAME, outs["planning"])
            check("v9 9 before the engine has said anything the ring is still there, with the page's own words and no bar", outs["nodata"].get("hidden") is False and outs["nodata"].get("head") == "Looking through your videos on this computer..." and outs["nodata"].get("barHidden") is True, outs["nodata"])
            check("v9 9 while building: the clip words and the bar", outs["building"].get("head") == "Cutting clip 3 of 4" and outs["building"].get("barValue") == 72 and outs["building"].get("hidden") is False, outs["building"])
            check("v9 9 no percent known: no bar (never a made-up 0)", outs["nopercent"].get("barHidden") is True and outs["nopercent"].get("hidden") is False, outs["nopercent"])
            check("v9 9 a plan waiting for Build, or another request's run, shows no ring", outs["idle"].get("hidden") is True and outs["other"].get("hidden") is True, (outs["idle"], outs["other"]))

print()
print("FAILED: " + ", ".join(FAILS) if FAILS else "all checks passed")
sys.exit(1 if FAILS else 0)
