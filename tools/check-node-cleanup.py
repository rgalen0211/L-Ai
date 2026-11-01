"""A site film's temp files are deleted when it ends, and no film is claimed on a full drive (NEXT-WORKER 68; the node loop, tools/ryagram_node.py).

The same rules as the house worker (Ryagram worker.SCRATCH, NEXT-WORKER 66), on a tester's own computer:

  A  whatever the outcome (the render fails, the site refuses 'complete', the renderer raises), the job's SCRATCH goes: tmp-node/ (this loop's
     TEMP), tmp/ (the engine's TEMP: Chrome's profile) and output/ (the engine's frames); the evidence stays: out/, the engine's logs, node-job.json
  B  a film that was SENT: its whole folder goes (the site has the film)
  C  a junction planted AS the job's output/ is removed as a link; the folder it pointed at is untouched; a neighbouring job is untouched
  D  the disk floor is checked before EVERY claim: under MIN_FREE_GB (or unreadable) nothing is claimed, no request reaches the site, and the card
     says why in plain words; at the floor it claims; with no renderer, 'cannot make site films' is said first
  E  at start: a failed job's folder older than 7 days is swept; a younger one (and a set-aside attempt) loses only its SCRATCH; other names and
     links named like a job are never touched

No site, no network, no engine: the sign-in and the renderer are stand-ins.

    python tools/check-node-cleanup.py
"""
import os
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import ryagram_node as rn                     # noqa: E402

FAILED = []
JID = "6a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d"
OTHER = "7b2c3d4e-5f6a-4b7c-9d8e-1f2a3b4c5d6e"


def check(ok, what):
    print(("  ok   " if ok else "  FAIL ") + what)
    if not ok:
        FAILED.append(what)


class FakeSignIn:
    host = "site.invalid"

    def __init__(self, complete_status=200):
        self.claims, self.reports, self.handed, self.complete_status = 0, [], False, complete_status

    def gate(self):
        return {"node": True, "note": ""}

    def api(self, method, route, body):
        if route == "/node/claim":
            self.claims += 1
            if self.handed:
                return 200, {}
            self.handed = True
            return 200, {"job": {"id": JID, "job_type": "preview"}}
        if route == "/node/state":
            self.reports.append((body.get("state"), body.get("error_code")))
            return (self.complete_status if body.get("state") == "complete" else 200), {}
        if route == "/node/artifact":
            return 200, {"upload_url": "https://site.invalid/up"}
        return 200, {}


def lay_out(work: Path):
    """What a real render leaves in the job folder (tools/ryagram_node_render.py + Ryagram's JobPaths)."""
    for d in ("tmp-node", "tmp/chrome-profile", "output/frames", "out"):
        (work / d).mkdir(parents=True, exist_ok=True)
    (work / "tmp/chrome-profile/Cookies").write_bytes(b"x")
    (work / "output/frames/frame0000.png").write_bytes(b"x" * 64)
    (work / "tmp-node/scratch.bin").write_bytes(b"x")
    (work / "out/preview.mp4").write_bytes(b"FILM")
    (work / "engine.stdout.log").write_text("log", encoding="utf-8")
    (work / "engine.stderr.log").write_text("", encoding="utf-8")
    (work / "node-job.json").write_text("{}", encoding="utf-8")


def renderer(mode, before=None):
    def render(job, work, progress):
        work = Path(work)
        if before:
            before(work)
        lay_out(work)
        if mode == "fail":
            raise rn.RenderFailed("engine_crash")
        if mode == "raise":
            raise RuntimeError("a bug mid-render")
        return {"preview": work / "out/preview.mp4"}
    return render


def run(base: Path, mode, *, complete_status=200, before=None, free_gb=lambda: 500.0, rend=True):
    si = FakeSignIn(complete_status)
    loop = rn.NodeLoop(si, base, renderer=renderer(mode, before) if rend else None, validate=lambda j: j, work_root=base / "jobs",
                       engine_commit="abc1234", free_gb=free_gb, uploader=lambda url, path, ctype, hosts: None)
    loop.on = True
    return loop, loop.step(), si


def kept_evidence(work: Path):
    return ((work / "out/preview.mp4").exists(), (work / "engine.stdout.log").exists(), (work / "node-job.json").exists())


def scratch_gone(work: Path):
    return not any(os.path.lexists(work / d) for d in rn.SCRATCH)


def main() -> int:
    tmp = Path(tempfile.mkdtemp(prefix="node-cleanup-", dir=os.environ.get("TEMP")))

    print("A. whatever the outcome, the scratch goes and the evidence stays")
    for name, mode, status, want in (("the render fails", "fail", 200, "failed"),
                                     ("the site refuses 'complete'", "ok", 409, "failed"),
                                     ("the renderer raises", "raise", 200, "failed")):
        loop, res, si = run(tmp / mode / str(status), mode, complete_status=status)
        work = tmp / mode / str(status) / "jobs" / JID
        check(res == want, f"{name}: the job ended {want} ({res})")
        check(scratch_gone(work), f"{name}: tmp-node/, tmp/ and output/ are gone")
        check(kept_evidence(work) == (True, True, True), f"{name}: out/, the engine's log and node-job.json stay")
    check(rn.SCRATCH == ("tmp-node", "tmp", "output"), "SCRATCH is exactly tmp-node/, tmp/ and output/ (out/ is the film, never scratch)")

    print("\nB. a sent film")
    loop, res, si = run(tmp / "sent", "ok")
    check(res == "worked" and ("complete", None) in si.reports, "the film was made, sent and marked complete")
    check(not (tmp / "sent" / "jobs" / JID).exists(), "its whole folder is gone (the site has the film)")

    print("\nC. nothing outside the job's own scratch")
    base = tmp / "outside"
    target = base / "planted-target"
    (target / "frames").mkdir(parents=True)
    (target / "precious.txt").write_bytes(b"x")
    neighbour = base / "jobs" / OTHER
    for d in rn.SCRATCH:
        (neighbour / d).mkdir(parents=True)
        (neighbour / d / "theirs.bin").write_bytes(b"x")

    def plant(work):
        subprocess.run(["cmd", "/c", "mklink", "/J", str(work / "output"), str(target)], check=True, capture_output=True)
    loop, res, si = run(base, "fail", before=plant)
    work = base / "jobs" / JID
    check(not os.path.lexists(work / "output"), "the junction planted as output/ is gone")
    check((target / "precious.txt").exists() and (target / "frames").is_dir(), "  and the folder it pointed at is untouched")
    check(all((neighbour / d / "theirs.bin").exists() for d in rn.SCRATCH), "a neighbouring job's tmp-node/, tmp/ and output/ are untouched")

    print("\nD. the disk floor, before every claim")
    floor = rn.MIN_FREE_GB
    loop, res, si = run(tmp / "low", "ok", free_gb=lambda: floor - 0.1)
    st = loop.status()
    check(res == "disk_low" and si.claims == 0, f"under {floor:g} GB: nothing is claimed, no request reaches the site")
    check(st["phase"] == "disk_low" and "GB free" in st["message"] and "until space is freed" in st["message"],
          f"the card says why, plainly ({st['message'][:70]}...)")
    loop.free_gb = lambda: floor
    check(loop.step() == "worked" and si.claims == 1, f"at {floor:g} GB it claims and makes the film (the same loop, the next turn)")

    def unreadable():
        raise OSError("drive gone")
    loop, res, si = run(tmp / "unread", "ok", free_gb=unreadable)
    check(res == "disk_low" and si.claims == 0 and "could not read" in loop.status()["message"],
          "the free space cannot be read: nothing is claimed (fail closed)")
    loop, res, si = run(tmp / "norend", "ok", free_gb=lambda: 0.0, rend=False)
    check(res == "cannot_render" and si.claims == 0, "no renderer: 'cannot make site films' is said first, still nothing claimed")
    check(isinstance(rn.NodeLoop(FakeSignIn(), tmp / "default").disk_low(), str),
          "the default reads the real drive (no injected reading) without raising")

    print("\nE. the start-up sweep")
    d = tmp / "sweep"
    jobs = d / "jobs"
    jobs.mkdir(parents=True)
    now = 1700000000 + 30 * 86400
    old_failed = jobs / JID
    young_failed = jobs / OTHER
    young_aside = jobs / f"{OTHER}.attempt-before-1700000001"
    other = jobs / "notes"
    for p in (old_failed, young_failed, young_aside):
        lay_out(p)
    other.mkdir()
    (other / "tmp").mkdir()
    target2 = d / "outside2"
    (target2 / "tmp").mkdir(parents=True)
    (target2 / "keep.txt").write_bytes(b"x")
    link = jobs / "8c3d4e5f-6a7b-4c8d-ae9f-2a3b4c5d6e7f"
    subprocess.run(["cmd", "/c", "mklink", "/J", str(link), str(target2)], check=True, capture_output=True)
    for p, age in ((old_failed, 8), (young_failed, 1), (young_aside, 1), (other, 30), (link, 30), (target2, 30)):
        os.utime(p, (now - age * 86400, now - age * 86400))
    n = rn.NodeLoop(FakeSignIn(), d, renderer=None, work_root=jobs, clock=lambda: now).sweep_set_aside()
    check(not old_failed.exists() and n == 1, "a failed job's folder older than 7 days is swept (one folder)")
    check(scratch_gone(young_failed) and kept_evidence(young_failed) == (True, True, True),
          "a younger failed job keeps its evidence but loses its scratch (a crash's leftovers)")
    check(scratch_gone(young_aside) and (young_aside / "out/preview.mp4").exists(), "a younger set-aside attempt too")
    check(other.exists() and (other / "tmp").exists(), "a folder with another name is never touched, however old")
    check((target2 / "keep.txt").exists() and (target2 / "tmp").exists(), "a junction named like a job is not followed")
    os.rmdir(link)

    print()
    if FAILED:
        print(f"{len(FAILED)} FAILED:")
        for f in FAILED:
            print("  " + f)
        return 1
    print("all node cleanup checks passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
