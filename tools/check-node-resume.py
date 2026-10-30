"""A site film interrupted by a shutdown resumes cleanly on this computer (NEXT-WORKER 56; the node loop, tools/ryagram_node.py).

When the computer is shut down or crashes mid-render, the site requeues the job once its two-minute lease runs out
(node_claim reaps lost leases: supabase/tests/test_r9_node.py proves that half). This check proves the app's half:

  A  a fresh job renders in an empty folder and completes (control)
  B  a folder left by the dead attempt (a half-written film and a stale finished-looking one) is SET ASIDE before attempt 2
     renders: the renderer starts in an EMPTY folder, the file sent is attempt 2's own (by hash), and the old folder is kept
     as <job id>.attempt-before-<time>
  C  if the old folder cannot be set aside, the job is reported failed in plain words and NOTHING is deleted
  D  at start, set-aside folders older than 7 days are swept; younger ones, other names and links are left alone

No site, no network, no engine: the sign-in and the renderer are stand-ins.

    python tools/check-node-resume.py
"""
import hashlib
import os
import sys
import tempfile
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import ryagram_node as rn                     # noqa: E402

FAILED = []
JID = "6a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d"


def check(ok, what):
    print(("  ok   " if ok else "  FAIL ") + what)
    if not ok:
        FAILED.append(what)


class FakeSignIn:
    host = "site.invalid"

    def __init__(self):
        self.reports, self.handed = [], False

    def gate(self):
        return {"node": True, "note": ""}

    def api(self, method, route, body):
        if route == "/node/claim":
            if self.handed:
                return 200, {}
            self.handed = True
            return 200, {"job": {"id": JID, "job_type": "preview"}}
        if route == "/node/state":
            self.reports.append((body.get("state"), body.get("error_code")))
            return 200, {}
        if route == "/node/artifact":
            return 200, {"upload_url": "https://site.invalid/up"}
        return 200, {}


def renderer_factory(seen):
    def render(job, work, progress):
        seen["before"] = sorted(p.name for p in Path(work).iterdir())
        out = Path(work) / "film.mp4"
        out.write_bytes(b"ATTEMPT-2 FILM")
        return {"preview": out}
    return render


def run(base: Path, clock=time.time):
    si, seen, sent = FakeSignIn(), {}, []
    loop = rn.NodeLoop(si, base, renderer=renderer_factory(seen), validate=lambda j: j, clock=clock,
                       work_root=base / "jobs", engine_commit="abc1234",
                       uploader=lambda url, path, ctype, hosts: sent.append(hashlib.sha256(Path(path).read_bytes()).hexdigest()))
    loop.on = True
    return loop, loop.step(), si, seen, sent


def main() -> int:
    tmp = Path(tempfile.mkdtemp(prefix="node-resume-"))
    good = hashlib.sha256(b"ATTEMPT-2 FILM").hexdigest()

    print("A. a fresh job (control)")
    _, res, si, seen, sent = run(tmp / "a")
    check(res == "worked" and seen["before"] == [] and sent == [good], "renders in an empty folder, sends its own film, completes")
    check(("complete", None) in si.reports, "the site is told complete")

    print("B. a folder left by the dead attempt")
    b = tmp / "b"
    left = b / "jobs" / JID
    left.mkdir(parents=True)
    (left / "film.mp4").write_bytes(b"STALE FILM FROM ATTEMPT 1")
    (left / "partial.mp4.part").write_bytes(b"half")
    _, res, si, seen, sent = run(b, clock=lambda: 1700000000)
    check(res == "worked", "attempt 2 completes")
    check(seen.get("before") == [], "the renderer started in an EMPTY folder (nothing of attempt 1 in it)")
    check(sent == [good], "the film sent is attempt 2's own (by hash), never the stale one")
    aside = b / "jobs" / f"{JID}.attempt-before-1700000000"
    check(aside.is_dir() and (aside / "film.mp4").read_bytes() == b"STALE FILM FROM ATTEMPT 1", "the dead attempt's folder is kept aside as evidence")

    print("C. the old folder cannot be set aside")
    c = tmp / "c"
    (c / "jobs" / JID).mkdir(parents=True)
    (c / "jobs" / JID / "film.mp4").write_bytes(b"STALE")
    blocker = c / "jobs" / f"{JID}.attempt-before-1700000000"
    blocker.mkdir()
    (blocker / "keep.txt").write_bytes(b"x")                          # the name is taken, so the move fails
    _, res, si, seen, sent = run(c, clock=lambda: 1700000000)
    check(res == "failed" and ("failed", "node_leftover") in si.reports, "the job is reported failed (node_leftover), plainly")
    check(seen == {} and sent == [], "nothing was rendered or sent")
    check((c / "jobs" / JID / "film.mp4").read_bytes() == b"STALE" and (blocker / "keep.txt").exists(), "nothing was deleted")

    print("D. the start-up sweep")
    d = tmp / "d"
    jobs = d / "jobs"
    jobs.mkdir(parents=True)
    now = 1700000000 + 30 * 86400
    old = jobs / f"{JID}.attempt-before-1700000000"
    young = jobs / "7b2c3d4e-5f6a-4b7c-9d8e-1f2a3b4c5d6e.attempt-before-1700000001"
    other = jobs / "notes"
    for p in (old, young, other):
        p.mkdir()
        (p / "f").write_bytes(b"x")
    os.utime(old, (now - 8 * 86400, now - 8 * 86400))
    os.utime(young, (now - 1 * 86400, now - 1 * 86400))
    os.utime(other, (now - 30 * 86400, now - 30 * 86400))
    loop = rn.NodeLoop(FakeSignIn(), d, renderer=None, work_root=jobs, clock=lambda: now)
    n = loop.sweep_set_aside()
    check(n == 1 and not old.exists(), "a set-aside folder older than 7 days is swept")
    check(young.exists(), "a younger one is kept (evidence)")
    check(other.exists(), "a folder with another name is never touched, however old")

    print()
    if FAILED:
        print(f"{len(FAILED)} FAILED:")
        for f in FAILED:
            print("  " + f)
        return 1
    print("all node resume checks passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
