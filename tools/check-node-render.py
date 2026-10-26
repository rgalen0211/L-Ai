"""The Ryan-PC renderer for the maker's node loop (NEXT-CONNECT 125): tools/ryagram_node_render.py + tools/ryagram_node_job.py. NO real render, no network, no site, no GPU.

    python tools/check-node-render.py <a folder on a NON-C drive for scratch> [<a full Ryagram checkout, for the real-library rows>]

What it proves (each row has a control that passes and a fault that must be caught)
  A  the job check: a house job, a final render, a story that is not an object, a bad id, an oversized job and a non-object are refused; a contact sheet and a preview pass
  B  OFF unless fully set up: every missing piece gives its own plain sentence (and no path); a work folder or settings root on C: is refused; too little memory or disk is refused; a ready setup gives none
  C  EVERY render goes through the GPU lock at priority e (the priority is not a setting), the command is a list (no shell), the environment carries nothing from the maker, the temp folder is inside the job
  D  the renderer: waiting then making notes, the outputs from the result file only, the engine commit kept, a failure code with its retry flag, a missing result file is a retryable start failure, a file
     outside the job's folder is refused, an exception in the loop kills the render and the lock ticket, a render that never ends is killed and fails
  E  the child with a stand-in worker library: a bad job is refused and nothing runs; a final render is refused; an unsupported job type is refused; success lists only the primary file and its receipts;
     no story text, title or engine message reaches the result file
  F  the node loop: the reason there is no renderer is shown on the card; the renderer's note is shown while it works
  G  (needs the Ryagram checkout) the REAL worker library in the child with a fake engine command: a preview is made, classified and listed; a bad story is refused; a final render is refused
  H  (needs the Ryagram checkout) the REAL tools/gpu_lock.py: a higher-priority holder keeps the film waiting (the child's start marker does not appear) and the film runs after it; the lock is free afterwards
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import ryagram_node as rn                     # noqa: E402
import ryagram_node_render as rr              # noqa: E402
import ryagram_node_job as nj                 # noqa: E402

if len(sys.argv) < 2:
    sys.exit("Give a scratch folder on a drive that is not C:.")
BASE = Path(sys.argv[1]).resolve()
if rr.on_c(BASE):
    sys.exit("The scratch folder must not be on C:.")
RYAGRAM = Path(sys.argv[2]) if len(sys.argv) > 2 else None
BASE.mkdir(parents=True, exist_ok=True)
RUN = Path(tempfile.mkdtemp(prefix="node-render-", dir=str(BASE)))
FAILS = []
UUID = "00000000-0000-4000-8000-0000000000a1"


def check(c, what):
    print(("  ok   " if c else "  FAIL ") + what)
    if not c:
        FAILS.append(what)


def raises(fn, exc, *a, **k):
    try:
        fn(*a, **k)
    except exc as e:
        return e
    return None


# ------------------------------------------------------------------------------------------------ a ready setup (all stand-in files)
def make_env(name, **over):
    d = RUN / name
    for p in ("engine/ryagram/worker", "cache", "tools", "root", "house-jobs"):
        (d / p).mkdir(parents=True, exist_ok=True)
    (d / "engine/ryagram/worker/engine.py").write_text("", encoding="ascii")
    (d / "chrome.exe").write_text("", encoding="ascii")
    (d / "tools/ffmpeg.exe").write_text("", encoding="ascii")
    (d / "gpu_lock.py").write_text("", encoding="ascii")
    (d / "cache/x.csv").write_text("a", encoding="ascii")
    s = {"root": str(d / "root"), "engine_dir": str(d / "engine"), "python": sys.executable, "chrome": str(d / "chrome.exe"), "path_dirs": [str(d / "tools")],
         "cache": str(d / "cache"), "gpu_lock": str(d / "gpu_lock.py"), "house": str(d / "house-jobs"), "priority_line": ""}
    s.update(over)
    toml = (f"root = '{s['root']}'\nworker_id = 'TEST'\nmemory_bytes = 8589934592\n[engine]\nengine_dir = '{s['engine_dir']}'\nchrome = '{s['chrome']}'\n"
            f"sequence_argv = ['{s['python']}', '-m', 'ryagram.sequence']\npath_dirs = {json.dumps(s['path_dirs'])}\n[engine.env]\nRYAGRAM_CACHE_DIR = '{s['cache']}'\n"
            f"[datasets]\nallow = ['cbp_suppression']\n[node]\ngpu_lock = '{s['gpu_lock']}'\nhouse_jobs = '{s['house']}'\nwho = 'TESTMAKER'\n{s['priority_line']}")
    (d / "node.toml").write_text(toml.replace("\\", "/") if False else toml, encoding="utf-8")
    return d, s


def story():
    return {"schema": 1, "name": "probe", "engine": "sequence", "sequence": {"canvas": [1920, 1080], "fps": 30, "theme": "light", "hold_seconds": 1.0,
            "clips": [{"kind": "title", "id": "open", "seconds": 3.0, "headline": "SECRET-TITLE-XYZ", "subhead": "s"}]}}


def job(**over):
    j = {"id": UUID, "owner_id": "11111111-1111-4111-8111-111111111111", "project_id": "33333333-3333-4333-8333-333333333333",
         "version_id": "44444444-4444-4444-8444-444444444444", "job_type": "preview", "attempt": 1, "story": story(), "params": {"window_s": [0, 3]}, "run_on": "owner_local"}
    j.update(over)
    return j


GOOD_RAM, GOOD_DISK = (lambda: 32 << 30), (lambda: 500.0)
d0, s0 = make_env("ready")
settings = rr.read_settings(d0 / "node.toml")
nr = rr.NodeRenderer(settings, RUN / "work", ram=GOOD_RAM, free_gb=GOOD_DISK, busy=lambda: False)

print("A  the job check")
check(nr.validate(job()) is not None and nr.validate(job(job_type="contact_sheet")) is not None, "a preview and a contact sheet pass")
check(nr.validate(job(run_on=None) if False else {k: v for k, v in job().items() if k != "run_on"}) is not None, "a job with no run_on field passes (the site's claim only returns own owner_local jobs)")
for what, bad in {"a house job": job(run_on="house"), "a final render": job(job_type="final_render"), "a story that is not an object": job(story="x"),
                  "a bad id": job(id="not-an-id"), "an oversized job": job(story={"a": "x" * 400_000}), "a job that is not an object": "nope", "a missing story": {k: v for k, v in job().items() if k != "story"}}.items():
    check(raises(nr.validate, rn.NodeError, bad) is not None, f"MUST-FAIL: {what} is refused")

print("B  off unless fully set up")
check(rr.find_problems(settings, RUN / "work", ram=GOOD_RAM, free_gb=GOOD_DISK) == [], "a ready setup has no problems")
breaks = {
    "no full Ryagram folder": lambda d, s: (d / "engine/ryagram/worker/engine.py").unlink(),
    "no python": lambda d, s: None,
    "no Chrome or Edge": lambda d, s: (d / "chrome.exe").unlink(),
    "no ffmpeg": lambda d, s: (d / "tools/ffmpeg.exe").unlink(),
    "no data folder": lambda d, s: shutil.rmtree(d / "cache"),
    "no GPU lock tool": lambda d, s: (d / "gpu_lock.py").unlink(),
    "no house folder": lambda d, s: shutil.rmtree(d / "house-jobs"),
}
for what, brk in breaks.items():
    d, s = make_env("b-" + what.replace(" ", "-"), **({"python": str(RUN / "nopython.exe")} if what == "no python" else {}))
    brk(d, s)
    st = rr.read_settings(d / "node.toml")
    pr = rr.find_problems(st, RUN / "work", ram=GOOD_RAM, free_gb=GOOD_DISK)
    check(len(pr) == 1 and str(RUN) not in pr[0] and "\\" not in pr[0], f"MUST-FAIL: {what} gives exactly one plain sentence, no path ({pr[:1]})")
check(any("C:" in p for p in rr.find_problems(settings, "C:/Users/someone/work", ram=GOOD_RAM, free_gb=GOOD_DISK)), "MUST-FAIL: a work folder on C: is refused")
dc, sc = make_env("root-on-c", root="C:/Users/someone/ryagram-root")
check(any("C:" in p for p in rr.find_problems(rr.read_settings(dc / "node.toml"), RUN / "work", ram=GOOD_RAM, free_gb=GOOD_DISK)), "MUST-FAIL: a settings root on C: is refused")
check(any("memory" in p for p in rr.find_problems(settings, RUN / "work", ram=lambda: 2 << 30, free_gb=GOOD_DISK)), "MUST-FAIL: too little memory is refused")
check(any("free" in p for p in rr.find_problems(settings, RUN / "work", ram=GOOD_RAM, free_gb=lambda: 1.0)), "MUST-FAIL: too little disk is refused")
check(raises(rr.read_settings, ValueError, RUN / "missing.toml") is not None, "a missing settings file is a plain refusal")
bad_toml = RUN / "incomplete.toml"
bad_toml.write_text("root = 'D:/x'\n", encoding="utf-8")
check(raises(rr.read_settings, ValueError, bad_toml) is not None, "an incomplete settings file is a plain refusal")
none, probs = rr.make(RUN / "missing.toml", RUN / "work")
check(none is None and len(probs) == 1, "make() with no settings gives no renderer and one reason")
none, probs = rr.make(dc / "node.toml", RUN / "work")
check(none is None and probs, "make() with a problem gives no renderer")

print("C  the GPU lock, the command, the environment")
cmd = rr.lock_command(settings, ["PY", "-I", "child"])
check(cmd[1:] == [str(settings.gpu_lock), "run", "--who", "TESTMAKER", "--priority", "e", "--", "PY", "-I", "child"] and cmd[0] == sys.executable, "the command is: python gpu_lock.py run --who .. --priority e -- <child>")
dp, sp = make_env("prio", priority_line="priority = 'a'\n")
pc = rr.lock_command(rr.read_settings(dp / "node.toml"), ["x"])
check(pc[pc.index("--priority") + 1] == "e" and pc.count("--priority") == 1, "MUST-FAIL: a priority in the settings is ignored; it is always e")


class FakeProc:
    """A stand-in for the lock tool process: finishes after `polls` polls; `on_poll(n)` can write files."""
    def __init__(self, polls, on_poll=None, returncode=0):
        self.polls, self.n, self.on_poll, self.returncode, self.pid = polls, 0, on_poll, returncode, 4242

    def poll(self):
        self.n += 1
        if self.on_poll:
            self.on_poll(self.n)
        return None if self.n <= self.polls else self.returncode


def stand_in(work_files=None, polls=3, started_at=2, result=None, rc=0):
    seen = {}

    def spawn(cmd, **kw):
        seen.update(cmd=cmd, kw=kw)
        work = Path(kw["cwd"])

        def on_poll(n):
            if n == started_at:
                (work / "node-started.marker").write_text("1", encoding="ascii")
            if n == polls + 1 and result is not None:
                for rel, data in (work_files or {}).items():
                    (work / rel).parent.mkdir(parents=True, exist_ok=True)
                    (work / rel).write_bytes(data)
                (work / "node-result.json").write_text(json.dumps(result), encoding="utf-8")
        seen["proc"] = FakeProc(polls, on_poll, rc)
        return seen["proc"]
    return spawn, seen


def run_renderer(spawn, name, j=None, clock=None, **kw):
    n2 = rr.NodeRenderer(settings, RUN / "work", spawn=spawn, sleep=lambda s: None, ram=GOOD_RAM, free_gb=GOOD_DISK, busy=kw.get("busy", lambda: False), **({"clock": clock} if clock else {}))
    work = RUN / "work" / name
    notes = []
    killed = []
    n2._kill = lambda p: killed.append(p.pid)
    try:
        out = n2.renderer(j or job(), work, notes.append)
        return n2, out, notes, None, killed, work
    except BaseException as e:                                                       # noqa: BLE001
        return n2, None, notes, e, killed, work


ok_result = {"state": "validating", "error_code": None, "detail": "", "retry": False, "engine_commit": "abc123def",
             "files": {"preview": "preview.mp4", "receipt": "preview.sequence.json"}}
spawn, seen = stand_in({"out/preview.mp4": b"mp4", "out/preview.sequence.json": b"{}"}, result={**ok_result, "files": {}})
# make the result file hold absolute paths inside the job folder (the child writes absolute paths)
work_a = RUN / "work" / "ok"


def abs_result(work):
    return {**ok_result, "files": {"preview": str(work / "out/preview.mp4"), "receipt": str(work / "out/preview.sequence.json")}}


spawn, seen = stand_in({"out/preview.mp4": b"mp4", "out/preview.sequence.json": b"{}"}, result=abs_result(work_a))
n2, out, notes, err, killed, work = run_renderer(spawn, "ok")
check(err is None and set(out) == {"preview", "receipt"} and all(rr.on_c(p) is False and work.resolve() in p.parents for p in out.values()), "success: the outputs are exactly what the result file named, inside the job's folder")
check(n2.engine_commit() == "abc123def", "the engine commit from the result is kept for the site")
check(seen["cmd"][0] == sys.executable and "--priority" in seen["cmd"] and seen["cmd"][seen["cmd"].index("--priority") + 1] == "e" and isinstance(seen["cmd"], list), "the render is started through the lock, as a list")
env = seen["kw"]["env"]
check(set(env) <= {"SYSTEMROOT", "PATH", "TEMP", "TMP", "TMPDIR", "PYTHONUTF8", "RYAGRAM_GPU_LOCK_DIR"} and Path(env["TEMP"]).resolve().parent == work.resolve(), "the environment is a short fixed list and TEMP is inside the job folder")
check(seen["kw"]["stdin"] == subprocess.DEVNULL and "shell" not in seen["kw"], "no shell, no stdin")
check(notes[0].startswith("Waiting") and notes[-1] == "Making your film.", f"the notes go from waiting for the card to making the film ({notes})")
jf = json.loads((work / "node-job.json").read_text(encoding="utf-8"))
check(jf["id"] == UUID and (work / "node-job.json").parent == work, "the job is handed to the child as a file inside the job folder")

for code, retry in (("crash", True), ("timeout", False), ("schema_rejected", False)):
    spawn, seen = stand_in(result={"state": "failed", "error_code": code, "detail": "x", "retry": retry, "files": {}, "engine_commit": None})
    n2, out, notes, err, killed, work = run_renderer(spawn, "f-" + code)
    check(isinstance(err, rn.RenderFailed) and err.code == code and err.retry is retry, f"a '{code}' result is a failure with retry={retry}")
spawn, seen = stand_in(result=None, rc=2)
n2, out, notes, err, killed, work = run_renderer(spawn, "nores")
check(isinstance(err, rn.RenderFailed) and err.code == "start_failed" and err.retry is True, "MUST-FAIL: no result file (the lock tool refused or the child never wrote) is a retryable start failure, not a success")
outside = RUN / "elsewhere.mp4"
outside.write_bytes(b"x")
spawn, seen = stand_in(result={**ok_result, "files": {"preview": str(outside)}})
n2, out, notes, err, killed, work = run_renderer(spawn, "outside")
check(isinstance(err, rn.RenderFailed) and err.code == "outside_job", "MUST-FAIL: a file outside the job's folder is refused")
w_unk = RUN / "work" / "unk"
spawn, seen = stand_in({"a.txt": b"x"}, result={**ok_result, "files": {"secret": str(w_unk / "a.txt")}})
n2, out, notes, err, killed, work = run_renderer(spawn, "unk")
check(isinstance(err, rn.RenderFailed) and err.code == "no_output", "MUST-FAIL: a kind the node does not know is dropped (and with nothing left it is a failure)")

# an exception in the loop kills the render and the lock ticket
spawn, seen = stand_in(polls=10, result=None)
n3 = rr.NodeRenderer(settings, RUN / "work", spawn=spawn, sleep=lambda s: None, ram=GOOD_RAM, free_gb=GOOD_DISK, busy=lambda: False)
killed = []
n3._kill = lambda p: killed.append(p.pid)


def bomb(note):
    raise KeyboardInterrupt


err = raises(n3.renderer, KeyboardInterrupt, job(), RUN / "work" / "bomb", bomb)
check(err is not None and killed == [4242], "MUST-FAIL: an interrupt while waiting kills the lock tool and its render (never left behind)")
# a render that never ends is killed and fails
tick = [0.0]


def clock():
    tick[0] += 3600.0
    return tick[0]


spawn, seen = stand_in(polls=10 ** 6, result=None)
n2, out, notes, err, killed, work = run_renderer(spawn, "never", clock=clock)
check(isinstance(err, rn.RenderFailed) and err.code == "timeout" and killed == [4242], "MUST-FAIL: a render that never ends is killed and fails with 'timeout'")
n4 = rr.NodeRenderer(settings, RUN / "work", spawn=spawn, sleep=lambda s: None, ram=lambda: 1 << 30, free_gb=GOOD_DISK, busy=lambda: False)
err = raises(n4.renderer, rn.RenderFailed, job(), RUN / "work" / "np", lambda n: None)
check(err is not None and err.code == "not_ready", "MUST-FAIL: with a problem the renderer refuses to start anything")
err = raises(nr.renderer, rn.RenderFailed, job(), Path("C:/Users/someone/job"), lambda n: None)
check(err is not None and err.code == "work_on_c", "MUST-FAIL: a job folder on C: is refused")

print("E  the child, with a stand-in worker library")


class Rej(Exception):
    pass


class FakeUnsupported(Exception):
    pass


class Outc:
    def __init__(self, state, code=None, retry=False):
        self.state, self.error_code, self.retry = state, code, retry


def fake_lib(outcome=None, unsupported=False, rejects=False):
    ns = type("L", (), {})()
    ns.Rejected = Rej
    ns.C = type("C", (), {"MAX_ATTEMPTS": 2, "PRIMARY_KIND": {"contact_sheet": "contact_sheet", "preview": "preview", "final_render": "final_video"}})
    paths_cls = type("P", (), {})

    def for_job(jobs_dir, j):
        p = paths_cls()
        p.root = Path(jobs_dir) / j.id
        p.out = p.root / "out"
        p.stdout, p.stderr = p.root / "o.log", p.root / "e.log"
        return p
    ns.E = type("E", (), {"Unsupported": FakeUnsupported, "JobPaths": type("JP", (), {"for_job": staticmethod(for_job)}),
                          "PRIMARY": {"preview": "preview.mp4", "contact_sheet": "sheet.png", "final_render": "film.mp4"},
                          "argv_for": staticmethod(lambda j, p, c: (_ for _ in ()).throw(FakeUnsupported()) if unsupported else ["engine"]),
                          "write_inputs": staticmethod(lambda j, p: (p.root.mkdir(parents=True, exist_ok=True), p.out.mkdir(exist_ok=True))),
                          "child_env": staticmethod(lambda cfg, p, **k: {}), "classify": staticmethod(lambda m, j, p: outcome)})
    ns.R = type("R", (), {"Limits": staticmethod(lambda **k: type("Lim", (), k)()), "run": staticmethod(lambda *a, **k: "metering")})

    def validate_job(row, **k):
        if rejects:
            raise Rej()
        return type("J", (), {"id": row["id"], "job_type": row["job_type"]})()
    ns.validate_job = staticmethod(validate_job)
    return ns


cfg = type("Cfg", (), {"datasets": {"cbp_suppression"}, "views": {}, "engine": None, "limits": {"preview": type("T", (), {"wall_s": 5})(), "contact_sheet": type("T", (), {"wall_s": 5})()},
                       "memory_bytes": 1, "work_bytes": 1, "max_processes": 4})()


def child(name, **kw):
    d = RUN / "child" / name
    d.mkdir(parents=True, exist_ok=True)
    out, started = d / "result.json", d / "started"
    lib = fake_lib(**{k: v for k, v in kw.items() if k in ("outcome", "unsupported", "rejects")})
    nj.run_job(lib, kw.get("row", job()), cfg=cfg, jobs_dir=d / "jobs", started=started, out=out)
    return json.loads(out.read_text(encoding="utf-8")), started, d


r, started, _ = child("rej", rejects=True)
check(r["state"] == "failed" and r["error_code"] == "schema_rejected" and not started.exists(), "MUST-FAIL: a job the engine's own check refuses is refused and nothing starts")
r, started, _ = child("final", row=job(job_type="final_render"))
check(r["error_code"] == "final_not_here" and not started.exists(), "MUST-FAIL: a final render is refused here")
r, started, _ = child("unsup", unsupported=True)
check(r["error_code"] == "engine_unsupported" and not started.exists(), "MUST-FAIL: a job type the engine cannot run is refused")
r, started, d = child("okc", outcome=Outc("validating"))
prim = d / "jobs" / UUID / "out" / "preview.mp4"
check(r["state"] == "validating" and set(r["files"]) == {"preview"} and r["files"]["preview"] == str(prim) and started.exists(), "success: the primary file is listed and the start marker was written")
r, started, d = child("bad", outcome=Outc("failed", "crash", True))
check(r["state"] == "failed" and r["error_code"] == "crash" and r["retry"] is True and r["files"] == {}, "an engine failure is reported with its code and retry flag, with no files")
blob = "".join(p.read_text(encoding="utf-8", errors="replace") for p in (RUN / "child").rglob("result.json"))
check("SECRET-TITLE-XYZ" not in blob, "MUST-FAIL: the story text never reaches a result file")

print("D2 a paid film made by the house goes first (CC1 MED-1)")
import os as _os
hj = RUN / "house"
(hj / "job-a" / "out").mkdir(parents=True)
(hj / "job-b").mkdir()
reg = RUN / "reg"
reg.mkdir()
NOW = 1_000_000.0


def touch(path, age, data=b"x"):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    _os.utime(path, (NOW - age, NOW - age))


alive = lambda pid: pid == 4242                     # noqa: E731
check(nj.house_busy(hj, reg, now=NOW, pid_alive=alive) is False, "an idle house (no recent log, no registered render) is not busy")
touch(hj / "job-a" / "engine.stdout.log", 30)
check(nj.house_busy(hj, reg, now=NOW, pid_alive=alive) is True, "MUST-FAIL: a job log written 30 s ago means the house has a render in hand")
touch(hj / "job-a" / "engine.stdout.log", 3600)
check(nj.house_busy(hj, reg, now=NOW, pid_alive=alive) is False, "control: the same log an hour old does not")
touch(hj / "job-a" / "out" / "preview.mp4.progress.json", 20)
check(nj.house_busy(hj, reg, now=NOW, pid_alive=alive) is True, "MUST-FAIL: a progress file written 20 s ago means busy")
touch(hj / "job-a" / "out" / "preview.mp4.progress.json", 3600)
touch(reg / "run-1.json", 10, json.dumps({"pid": 4242, "progress": str(hj / "job-b" / "out" / "x.progress.json")}).encode())
check(nj.house_busy(hj, reg, now=NOW, pid_alive=alive) is True, "MUST-FAIL: a live registered render whose progress file is in the house's folder means busy")
touch(reg / "run-1.json", 10, json.dumps({"pid": 7, "progress": str(hj / "job-b" / "out" / "x.progress.json")}).encode())
check(nj.house_busy(hj, reg, now=NOW, pid_alive=alive) is False, "control: the same entry with a dead process does not")
touch(reg / "run-1.json", 10, json.dumps({"pid": 4242, "progress": str(RUN / "elsewhere" / "x.progress.json")}).encode())
check(nj.house_busy(hj, reg, now=NOW, pid_alive=alive) is False, "control: a render whose progress file is NOT in the house's folder (this maker's own, Ryan's) does not")
touch(reg / "run-1.json", 3600, json.dumps({"pid": 4242, "progress": str(hj / "job-b" / "x.progress.json")}).encode())
check(nj.house_busy(hj, reg, now=NOW, pid_alive=alive) is False, "control: an entry nobody has touched for an hour is stale, not busy")
touch(reg / "run-1.json", 5, b"{" + b"x" * 5000)
check(nj.house_busy(hj, reg, now=NOW, pid_alive=alive) is False, "a damaged or oversized entry is ignored, not trusted and not a crash")
check(raises(nj.house_busy, OSError, RUN / "no-such-house-folder", reg, now=NOW) is not None, "MUST-FAIL: a house folder that cannot be read raises (the caller treats that as 'cannot tell')")
before = sorted(str(q) for q in hj.rglob("*"))
nj.house_busy(hj, reg, now=NOW, pid_alive=alive)
check(sorted(str(q) for q in hj.rglob("*")) == before, "it writes nothing into the house worker's folder")

# the renderer waits for the house BEFORE it takes the lock
calls = {"n": 0}
seq = iter([True, True, False])
spawn, seen = stand_in(result=abs_result(RUN / "work" / "hb"), polls=1)
n2, out, notes, err, killed, work = run_renderer(spawn, "hb", busy=lambda: next(seq, False))
check(err is None and notes[0].startswith("Waiting: a film ordered on Ryagram") and "cmd" in seen, f"the film waits while a house film is made, then starts ({notes[:3]})")
started_early = []
spawn2, seen2 = stand_in(result=abs_result(RUN / "work" / "hb2"), polls=1)


def spawn_watch(cmd, **kw):
    started_early.append(1)
    return spawn2(cmd, **kw)


tick2 = [0.0]


def clock2():
    tick2[0] += 3600.0
    return tick2[0]


n2, out, notes, err, killed, work = run_renderer(spawn_watch, "hb2", busy=lambda: True, clock=clock2)
check(isinstance(err, rn.RenderFailed) and err.code == "house_busy" and err.retry is True and started_early == [], "MUST-FAIL: while the house is always busy nothing is started, and the order is given back as retryable after the cap")
n2, out, notes, err, killed, work = run_renderer(spawn_watch, "hb3", busy=lambda: (_ for _ in ()).throw(OSError("denied")), clock=clock2)
check(isinstance(err, rn.RenderFailed) and err.code == "house_busy" and started_early == [], "MUST-FAIL: when the house folder cannot be read the film does not start (cannot tell = wait)")
check("--house-jobs" in seen["cmd"] and seen["cmd"][seen["cmd"].index("--house-jobs") + 1] == str(settings.house_jobs), "the child is told which folder to watch")

# the child looks again right after the lock was granted
n_calls = [0]


def busy_twice():
    n_calls[0] += 1
    return n_calls[0] <= 2


d_ = RUN / "child" / "hbusy"
d_.mkdir(parents=True, exist_ok=True)
nj.run_job(fake_lib(outcome=Outc("validating")), job(), cfg=cfg, jobs_dir=d_ / "jobs", started=d_ / "started", out=d_ / "result.json", busy=busy_twice, sleep=lambda s: None)
check(json.loads((d_ / "result.json").read_text(encoding="utf-8"))["state"] == "validating" and n_calls[0] == 3 and (d_ / "started").exists(), "the child waits out a house render that started after the lock was granted, then runs")
tt = [0.0]


def clock3():
    tt[0] += 100.0
    return tt[0]


d_ = RUN / "child" / "hbusy2"
d_.mkdir(parents=True, exist_ok=True)
nj.run_job(fake_lib(outcome=Outc("validating")), job(), cfg=cfg, jobs_dir=d_ / "jobs", started=d_ / "started", out=d_ / "result.json", busy=lambda: True, sleep=lambda s: None, clock=clock3)
r = json.loads((d_ / "result.json").read_text(encoding="utf-8"))
check(r["error_code"] == "house_busy" and r["retry"] is True and not (d_ / "started").exists(), "MUST-FAIL: a house render that never ends makes the child give the order back (retryable) and start nothing")

print("F  the node loop shows the reason, and the renderer's note while it works")


class FakeSignin:
    host = "site.test"

    def __init__(self):
        self.calls = []

    def gate(self):
        return {"clip_films": True, "node": True, "paused": False, "note": ""}

    def api(self, method, path, body=None):
        self.calls.append((method, path, body))
        if path == "/node/claim":
            return 200, {"job": job()}
        if path == "/node/artifact":
            return 200, {"upload_url": "https://site.test/up"}
        return 200, {}


nl = rn.NodeLoop(FakeSignin(), RUN / "loop", renderer=None, cannot_render_reason="Google Chrome or Microsoft Edge was not found where the settings say.")
nl.set_switch(True)
st = nl.status()
check(st["phase"] == "cannot_render" and "Chrome" in st["message"] and st["can_render"] is False, "with no renderer the card says what is missing")
nl2 = rn.NodeLoop(FakeSignin(), RUN / "loop2", renderer=None)
nl2.set_switch(True)
check("This copy of the app cannot make site films yet" in nl2.status()["message"], "with no reason given the card says what it said before")
seen_notes = []
sig = FakeSignin()


def noting_renderer(j, work, progress):
    progress("Making your film.")
    seen_notes.append(nl3.status()["message"])
    p = Path(work) / "out.mp4"
    p.write_bytes(b"x")
    return {"preview": p}


nl3 = rn.NodeLoop(sig, RUN / "loop3", renderer=noting_renderer, validate=lambda j: j, uploader=lambda url, path, ctype, hosts: None, work_root=RUN / "loop3" / "jobs", engine_commit=lambda: "abc")
nl3.set_switch(True)
res = nl3.step()
check(seen_notes == ["Making your film."] and res == "worked", f"the renderer's note is on the card while it works ({seen_notes}, {res})")

# ------------------------------------------------------------------------------------------------ G and H need the real checkout
print("G  the REAL worker library in the child, with a fake engine command")
if RYAGRAM is None or not (RYAGRAM / "ryagram" / "worker" / "engine.py").is_file():
    print("  SKIP no Ryagram checkout given (rows G and H not run)")
else:
    d, s = make_env("real", engine_dir=str(RYAGRAM))
    fake_engine = d / "fake_engine.py"
    fake_engine.write_text(
        "import sys, json, pathlib\nout = pathlib.Path(sys.argv[sys.argv.index('--out') + 1])\nout.parent.mkdir(parents=True, exist_ok=True)\nout.write_bytes(b'FAKEMP4')\n"
        "out.with_suffix('.sequence.json').write_text(json.dumps({'inputs': {'code': {'commit': 'deadbeef1234', 'dirty': False}}}))\nout.with_suffix('.sequence.txt').write_text('receipt')\n", encoding="utf-8")
    toml = (d / "node.toml").read_text(encoding="utf-8").replace("'-m', 'ryagram.sequence'", f"'{fake_engine}'")
    toml += ("\n[limits.contact_sheet]\nwall_s = 60\noutput_bytes = 20971520\n[limits.preview]\nwall_s = 60\noutput_bytes = 62914560\n[limits.final_render]\nwall_s = 60\noutput_bytes = 524288000\n")
    (d / "node.toml").write_text(toml, encoding="utf-8")
    real_story = {"schema": 1, "name": "probe", "engine": "sequence", "sequence": {"canvas": [1920, 1080], "fps": 30, "theme": "light", "hold_seconds": 1.0,
                  "clips": [{"kind": "title", "id": "open", "seconds": 3.0, "headline": "SECRET-TITLE-XYZ", "subhead": "s"}]}}

    def run_child(name, j):
        w = RUN / "real-work" / name
        w.mkdir(parents=True, exist_ok=True)
        (w / "job.json").write_text(json.dumps(j), encoding="utf-8")
        p = subprocess.run([sys.executable, "-I", str(HERE / "ryagram_node_job.py"), "--engine-dir", str(RYAGRAM), "--config", str(d / "node.toml"), "--job", str(w / "job.json"),
                            "--jobs-dir", str(w.parent), "--out", str(w / "result.json"), "--started", str(w / "started.marker")], capture_output=True, text=True, timeout=180)
        return p, w
    rj = {"id": UUID, "owner_id": "11111111-1111-4111-8111-111111111111", "project_id": "33333333-3333-4333-8333-333333333333",
          "version_id": "44444444-4444-4444-8444-444444444444", "job_type": "preview", "attempt": 1, "story": real_story, "params": {"window_s": [0, 3]}}
    p, w = run_child(UUID, rj)
    res = json.loads((w / "result.json").read_text(encoding="utf-8")) if (w / "result.json").exists() else {}
    check(res.get("state") == "validating" and set(res.get("files", {})) >= {"preview", "receipt"} and res.get("engine_commit") == "deadbeef1234" and (w / "started.marker").exists(),
          f"a preview runs through the real runner and classifier and lists its files ({res.get('state')}/{res.get('error_code')}/{p.stderr[-200:] if p.stderr else ''})")
    check("SECRET-TITLE-XYZ" not in p.stdout + p.stderr and "SECRET-TITLE-XYZ" not in (w / "result.json").read_text(encoding="utf-8"), "the story text is in neither the output nor the result file")
    bad = dict(rj, id="00000000-0000-4000-8000-0000000000a2", story={"schema": 1, "name": "x", "engine": "sequence", "sequence": {"clips": [{"kind": "render", "dataset": "not_allowed", "view": "line", "start": "2000", "end": "2001"}]}})
    p, w = run_child("00000000-0000-4000-8000-0000000000a2", bad)
    res = json.loads((w / "result.json").read_text(encoding="utf-8"))
    check(res.get("error_code") == "schema_rejected" and not (w / "started.marker").exists(), "MUST-FAIL: a story naming a dataset that is not on the list is refused before anything runs")
    fin = dict(rj, id="00000000-0000-4000-8000-0000000000a3", job_type="final_render")
    p, w = run_child("00000000-0000-4000-8000-0000000000a3", fin)
    res = json.loads((w / "result.json").read_text(encoding="utf-8")) if (w / "result.json").exists() else {}
    check(res.get("error_code") in ("final_not_here", "schema_rejected") and not (w / "started.marker").exists(), f"MUST-FAIL: a final render is refused ({res.get('error_code')})")

    print("H  the REAL GPU lock")
    lock_py = Path(os.environ.get("RYAGRAM_GPU_LOCK_TOOL", r"C:\Users\Ryan\Ryagram-logs\tools\gpu_lock.py"))
    if not lock_py.is_file():
        print("  SKIP the real gpu_lock.py was not found (set RYAGRAM_GPU_LOCK_TOOL)")
    else:
        lock_dir = RUN / "lockdir"
        os.environ["RYAGRAM_GPU_LOCK_DIR"] = str(lock_dir)
        holder = subprocess.Popen([sys.executable, str(lock_py), "run", "--who", "HOLDER", "--priority", "a", "--", sys.executable, "-c", "import time; time.sleep(7)"],
                                  stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env=dict(os.environ))
        for _ in range(40):
            if (lock_dir / "held.json").exists():
                break
            time.sleep(0.25)
        check((lock_dir / "held.json").exists(), "(setup) a higher-priority job holds the lock")
        toml2 = (d / "node.toml").read_text(encoding="utf-8").replace(str(d / "gpu_lock.py"), str(lock_py))
        (d / "node2.toml").write_text(toml2, encoding="utf-8")
        st2 = rr.read_settings(d / "node2.toml")
        n5 = rr.NodeRenderer(st2, RUN / "real-work2", ram=GOOD_RAM, free_gb=GOOD_DISK)
        n5.sleep = lambda s: time.sleep(0.5)
        job2 = dict(rj, id="00000000-0000-4000-8000-0000000000a4")
        wk = RUN / "real-work2" / job2["id"]
        marks = []
        t_start = time.time()

        def prog(note):
            marks.append((round(time.time() - t_start, 1), note, (wk / "node-started.marker").exists()))
        out = n5.renderer(job2, wk, prog)
        waited = [m for m in marks if m[1].startswith("Waiting")]
        check(len(waited) >= 3 and all(not m[2] for m in waited), "MUST-FAIL: while a higher-priority job holds the lock, the film WAITS and has not started")
        check(set(out) >= {"preview", "receipt"} and marks[-1][1] == "Making your film.", "after the lock is released the film runs and is returned")
        check(holder.wait(timeout=30) == 0 and not (lock_dir / "held.json").exists(), "the lock is free afterwards")
        os.environ.pop("RYAGRAM_GPU_LOCK_DIR", None)

shutil.rmtree(RUN, ignore_errors=True)
print("\nFAILED: " + "; ".join(FAILS) if FAILS else "\nALL PASS")
sys.exit(1 if FAILS else 0)
