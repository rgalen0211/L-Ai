"""On a tester's own PC, nothing else makes their site films wait (NEXT-WORKER 74; tools/ryagram_node_render.py, ryagram_node_job.py, node_settings.py).

A site film on a tester's PC can wait in only two places: the house-film check (a paid film made by the house goes first) and the
graphics-card lock. On Ryan's PC both are real. On a tester's PC there is no house worker, and the settings the app writes must keep
both queues to the tester's own films:

  A  the settings the app writes for a tester say no_house_worker and put the lock folder INSIDE the app (not the house lock folder)
  B  the house-film check reads an EMPTY folder inside the app: a running render of anything else on this PC (another program in the
     machine-wide runs list, the person's own clip film, even the tester's own running site film) never reads as 'house busy'
  C  the check is not asleep: a render registered INSIDE that folder, or a fresh log in it, does read as busy (so B is a real answer)
  D  the lock: site films run at priority e (RULINGS 2026-10-20) in the app's OWN lock folder, which only site films use, so on a
     tester's PC they are first by having that lock to themselves; the lock tool orders a queue by priority, then by arrival

No site, no network, no engine, nothing rendered.

    python tools/check-tester-first.py
"""
import importlib.util
import json
import os
import sys
import tempfile
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import node_settings as ns                    # noqa: E402
import ryagram_node_job as nj                 # noqa: E402
import ryagram_node_render as rr              # noqa: E402

FAILED = []


def check(ok, what):
    print(("  ok   " if ok else "  FAIL ") + what)
    if not ok:
        FAILED.append(what)


def register(rd: Path, name: str, progress: Path, pid: int):
    rd.mkdir(parents=True, exist_ok=True)
    (rd / f"run-{name}.json").write_text(json.dumps({"pid": pid, "progress": str(progress)}), encoding="utf-8")


def main() -> int:
    tmp = Path(tempfile.mkdtemp(prefix="tester-first-", dir=os.environ.get("TEMP")))
    app = tmp / "app-1031"
    (app / "tools").mkdir(parents=True)
    work = app / "work"

    print("A. the settings the app writes for a tester")
    text = ns.settings_text(app, python=Path(sys.executable), ffmpeg_dir=app / "ffmpeg", browser=None, computer="SAMS-PC")
    sp = app / ns.REL_SETTINGS
    sp.parent.mkdir(parents=True, exist_ok=True)
    sp.write_text(text, encoding="utf-8")
    s = rr.read_settings(sp)
    check(s.no_house_worker is True and s.house_jobs is None, "no_house_worker = true, and no house jobs folder is named")
    check(s.gpu_lock_dir is not None and rr._inside(s.gpu_lock_dir, app), f"the lock folder is inside the app ({s.gpu_lock_dir})")
    house_lock = Path(r"D:\Ryagram-scratch\gpu-lock")
    check(os.path.normcase(str(s.gpu_lock_dir)) != os.path.normcase(str(house_lock)), "  and is not the house lock folder")

    print("\nB. the house-film check on a tester's PC")
    hj = rr.effective_house_jobs(s, work)
    hj.mkdir(parents=True, exist_ok=True)
    check(hj is not None and rr._inside(hj, work) and not any(hj.iterdir()), f"it reads an empty folder inside the app ({hj.name})")
    me = os.getpid()                                                   # a live pid, so only the path decides
    rd = tmp / "runs"
    now = time.time()
    for name, progress in (("another-program", tmp / "elsewhere" / "job" / "out" / "x.progress.json"),
                           ("own-clip-film", work / "films-work" / "clip" / "x.progress.json"),
                           ("own-site-film", work / "node-jobs" / "6a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d" / "out" / "preview.progress.json"),
                           ("ryans-house-worker", Path(r"D:\RyagramWorker\work\jobs\abc\out\x.progress.json"))):
        register(rd, name, progress, me)
    check(nj.house_busy(hj, rd, now=now, pid_alive=lambda pid: True) is False,
          "four live renders elsewhere (another program, the person's own clip film, the tester's own site film, a house worker's folder): NOT busy")

    print("\nC. the check is not asleep")
    register(rd, "inside", hj / "job1" / "out" / "x.progress.json", me)
    check(nj.house_busy(hj, rd, now=now, pid_alive=lambda pid: True) is True, "a live render registered INSIDE that folder reads as busy")
    (rd / "run-inside.json").unlink()
    (hj / "job2").mkdir()
    (hj / "job2" / "engine.stdout.log").write_text("x", encoding="ascii")
    check(nj.house_busy(hj, rd, now=time.time(), pid_alive=lambda pid: True) is True, "a fresh engine log inside it reads as busy")

    print("\nD. the lock")
    check(rr.GPU_PRIORITY == "e", "site films run at priority e (RULINGS 2026-10-20), unchanged")
    cmd = rr.lock_command(s, ["child"])
    check(cmd[cmd.index("--priority") + 1] == "e" and str(s.gpu_lock) == cmd[1], "the render is started through the app's own lock tool at e")
    spec = importlib.util.spec_from_file_location("gpu_lock_for_check", HERE / "gpu_lock.py")
    gl = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(gl)
    check(list(gl.PRIORITIES)[-1] == "e", "e is the last of the lock's priorities (so on a SHARED lock a site film would go last: why the folder must stay the app's own)")

    print()
    if FAILED:
        print(f"{len(FAILED)} FAILED:")
        for f in FAILED:
            print("  " + f)
        return 1
    print("all tester-first checks passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
