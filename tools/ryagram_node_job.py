"""ONE site film, made by the house worker's own code (NEXT-CONNECT 125). INTERNAL. Run by tools/ryagram_node_render.py inside tools/gpu_lock.py; never by hand.

    <the engine's python> -I tools/ryagram_node_job.py --engine-dir <full Ryagram folder> --config <worker-shaped toml> --job <job.json>
                          --jobs-dir <the folder that holds the job's own folder> --out <result.json> --started <marker file>

WHY A SEPARATE PROCESS. The maker already imports ONE `ryagram` package (its own engine, for clip films). The worker library lives in the full engine
folder the render must use (the same commit the house worker renders with), and two different `ryagram` packages cannot share a process. So this
program does all of it in a child that sees only that engine folder: it checks the job as data with the engine's OWN `validate_job` (the same closed
schema and dataset allowlist the house worker uses; a bad job is refused and nothing runs), builds the command with the worker's `argv_for`, runs it in the
worker's Job Object (wall time, memory, disk and process limits, clean environment), asks the worker's `classify` what happened, and writes ONE small result file.

WHAT IT NEVER DOES. It never prints or logs a story, a title, a path inside a story or an engine message (the result carries a code and a fixed sentence).
It never reads the network (the engine's own confinement is unchanged). It writes only inside the job's folder. It never makes a final render here:
final films stay with the house until a ladder-evidence path is wired and reviewed.

Result file (JSON): {"state": "validating"|"failed"|..., "error_code": str|null, "detail": str, "retry": bool, "files": {kind: path}, "engine_commit": str|null}
"""
from __future__ import annotations

import argparse
import ctypes
import json
import os
import sys
import time
from pathlib import Path

#: The node's kinds (tools/ryagram_node.py OUTPUT_KINDS) for what the house worker produces.
RECEIPT_FILES = (("receipt", ".sequence.json"), ("receipt_text", ".sequence.txt"))
#: Fixed sentences for the person. The engine's own words can name a place from a story, so they never go into the result.
SENTENCES = {
    "schema_rejected": "This order is not one this computer will run, so nothing was made.",
    "engine_unsupported": "This computer cannot make that kind of film yet.",
    "final_not_here": "Final films are made by Ryagram for now, not on this computer.",
    "timeout": "The film took longer than this computer allows, so it was stopped.",
    "start_failed": "The film could not be started on this computer.",
    "house_busy": "A film ordered on Ryagram is being made on this computer, so this one waits its turn.",
    "crash": "The film stopped before it was finished.",
}


#: THE HOUSE WORKER'S BUSY CHECK (CC1 MED-1, 2026-10-26). The house worker takes no GPU-lock ticket, so a site order paid for by a customer could be rendering on this GPU at the
#: moment a tester's film starts. Two READ-ONLY signals say "a house render is in hand": (1) the machine-wide list of running renders (cpushare's ProgramData Ryagram runs folder: a live,
#: freshly touched entry whose progress file is inside the house worker's jobs folder), (2) any of that folder's job logs or progress files written in the last HOUSE_QUIET_S seconds.
#: This reads names and times and nothing else, and writes nothing there.
HOUSE_QUIET_S = 600.0
REGISTRATION_FRESH_S = 180.0
REGISTRATION_READ_CAP = 4096


def _pid_alive(pid: int) -> bool:
    if os.name != "nt":
        try:
            os.kill(pid, 0)
        except ProcessLookupError:
            return False
        except PermissionError:
            return True
        return True
    k32 = ctypes.windll.kernel32
    k32.OpenProcess.restype = ctypes.c_void_p
    h = k32.OpenProcess(0x1000, False, int(pid))
    if not h:
        return ctypes.GetLastError() == 5            # access denied = it exists, as another account
    try:
        code = ctypes.c_ulong()
        k32.GetExitCodeProcess(ctypes.c_void_p(h), ctypes.byref(code))
        return code.value == 259                     # STILL_ACTIVE
    finally:
        k32.CloseHandle(ctypes.c_void_p(h))


def runs_dir() -> Path:
    env = os.environ.get("RYAGRAM_RUNS_DIR")
    if env:
        return Path(env)
    base = os.environ.get("ProgramData") or (os.environ.get("SystemDrive", "C:") + "\\ProgramData")
    return Path(base) / "Ryagram" / "runs"


def house_busy(jobs_root, registry_dir=None, *, now=None, window_s: float = HOUSE_QUIET_S, pid_alive=_pid_alive) -> bool:
    """True when the house worker seems to have a render in hand. READ-ONLY. Raises OSError when the house folder cannot be read (the caller treats that as 'cannot tell')."""
    now = time.time() if now is None else now
    root = Path(jobs_root)
    prefix = os.path.normcase(os.path.abspath(str(root))) + os.sep
    rd = Path(registry_dir) if registry_dir else runs_dir()
    try:
        entries = sorted(rd.glob("run-*.json")) if rd.is_dir() else []
    except OSError:
        entries = []
    for f in entries:
        try:
            if now - f.stat().st_mtime > REGISTRATION_FRESH_S:
                continue
            with open(f, "rb") as fh:
                data = fh.read(REGISTRATION_READ_CAP + 1)
            if len(data) > REGISTRATION_READ_CAP:
                continue
            rec = json.loads(data.decode("utf-8"))
            progress, pid = str(rec.get("progress") or ""), int(rec["pid"])
        except (OSError, ValueError, KeyError, TypeError, AttributeError):
            continue
        if os.path.normcase(os.path.abspath(progress)).startswith(prefix) and pid_alive(pid):
            return True
    for job_dir in root.iterdir():                                      # OSError here = cannot tell
        if not job_dir.is_dir():
            continue
        for rel in ("engine.stdout.log", "engine.stderr.log"):
            try:
                if now - (job_dir / rel).stat().st_mtime <= window_s:
                    return True
            except OSError:
                pass
        try:
            for p in (job_dir / "out").glob("*.progress.json"):
                if now - p.stat().st_mtime <= window_s:
                    return True
        except OSError:
            pass
    return False


#: NO NETWORK FOR THE ENGINE (CC1 MED-3, 2026-10-26). The dataset clients fetch a missing file and write it in place (not through a temp file), so a tester film that missed a file would write into the
#: SHARED data cache while a paid house render might be reading it. The engine here runs with every proxy variable pointing at a closed local port and no exceptions: a miss FAILS with the engine's own
#: sentence and writes nothing; a hit needs no network. Added AFTER the settings' own environment, so a setting cannot switch it off.
NO_NETWORK_ENV = {"HTTP_PROXY": "http://127.0.0.1:9", "HTTPS_PROXY": "http://127.0.0.1:9", "ALL_PROXY": "http://127.0.0.1:9", "http_proxy": "http://127.0.0.1:9",
                  "https_proxy": "http://127.0.0.1:9", "all_proxy": "http://127.0.0.1:9", "NO_PROXY": "", "no_proxy": ""}
CACHE_SNAPSHOT_CAP = 400_000


def cache_snapshot(cache_dir):
    """{relative path: (size, mtime_ns)} of every file under the shared data cache; READ-ONLY. None when there is no cache folder to look at."""
    if not cache_dir:
        return None
    root = Path(cache_dir)
    if not root.is_dir():
        return None
    snap, stack = {}, [root]
    while stack and len(snap) < CACHE_SNAPSHOT_CAP:
        d = stack.pop()
        try:
            with os.scandir(d) as it:
                for e in it:
                    try:
                        if e.is_dir(follow_symlinks=False):
                            stack.append(Path(e.path))
                        else:
                            st = e.stat(follow_symlinks=False)
                            snap[os.path.relpath(e.path, root)] = (st.st_size, st.st_mtime_ns)
                    except OSError:
                        pass
        except OSError:
            pass
    return snap


def cache_changes(before, after) -> dict:
    """What a render changed in the shared cache (it should be nothing): the count and up to 10 names. Names of cache files, never a value."""
    if before is None or after is None:
        return {"count": 0, "examples": [], "checked": False}
    changed = sorted(k for k in set(before) | set(after) if before.get(k) != after.get(k))
    return {"count": len(changed), "examples": changed[:10], "checked": True}


def _write(out: Path, doc: dict) -> None:
    tmp = out.with_suffix(".tmp")
    tmp.write_text(json.dumps(doc), encoding="utf-8")
    tmp.replace(out)


def _fail(out: Path, code: str, *, retry: bool = False) -> int:
    _write(out, {"state": "failed", "error_code": code, "detail": SENTENCES.get(code, "The film could not be made on this computer."),
                 "retry": retry, "files": {}, "engine_commit": None})
    return 0


def run_job(lib, row, *, cfg, jobs_dir: Path, started: Path, out: Path, clock=time.time, busy=None, sleep=time.sleep, busy_wait_s: float = 120.0, cache_dir=None) -> int:
    """`lib` is a namespace with validate_job, Rejected, E (worker.engine), R (worker.runner), C (worker.contract); `cfg` a worker Config."""
    try:
        job = lib.validate_job(row, datasets=cfg.datasets, views=cfg.views, max_attempts=lib.C.MAX_ATTEMPTS)
    except lib.Rejected:
        return _fail(out, "schema_rejected")
    if job.job_type == "final_render":
        return _fail(out, "final_not_here")
    paths = lib.E.JobPaths.for_job(Path(jobs_dir), job)
    try:
        argv = lib.E.argv_for(job, paths, cfg.engine)
    except lib.E.Unsupported:
        return _fail(out, "engine_unsupported")
    if busy is not None:                                                   # right after the GPU lock was granted: a house render may have started meanwhile
        t_wait = clock()
        while busy():
            if clock() - t_wait > busy_wait_s:
                return _fail(out, "house_busy", retry=True)
            sleep(5)
    lib.E.write_inputs(job, paths)
    tl = cfg.limits[job.job_type]
    limits = lib.R.Limits(wall_s=tl.wall_s, memory_bytes=cfg.memory_bytes, work_bytes=cfg.work_bytes, max_processes=cfg.max_processes)
    started.write_text(str(int(clock())), encoding="ascii")                 # the parent shows "making your film" from here
    before = cache_snapshot(cache_dir)
    m = lib.R.run(argv, cwd=paths.root,
                  env={**lib.E.child_env(cfg.engine, paths, max_processes=limits.max_processes, memory_bytes=limits.memory_bytes), **NO_NETWORK_ENV},
                  limits=limits, stdout=paths.stdout, stderr=paths.stderr, work_dir=paths.root, tick_s=0.5)
    outcome = lib.E.classify(m, job, paths)
    changes = cache_changes(before, cache_snapshot(cache_dir))
    if outcome.state != "validating":
        code = outcome.error_code or "crash"
        _write(out, {"state": outcome.state, "error_code": code, "detail": SENTENCES.get(code, "The film could not be made on this computer."),
                     "retry": bool(outcome.retry), "files": {}, "engine_commit": None, "cache_changes": changes})
        return 0
    primary = paths.out / lib.E.PRIMARY[job.job_type]
    files = {lib.C.PRIMARY_KIND[job.job_type]: str(primary)}
    for kind, suffix in RECEIPT_FILES:
        side = primary.with_suffix(suffix)
        if side.exists():
            files[kind] = str(side)
    commit = None
    try:
        receipt = json.loads(primary.with_suffix(".sequence.json").read_text(encoding="utf-8"))
        commit = ((receipt.get("inputs") or {}).get("code") or {}).get("commit") or None
    except (OSError, ValueError, AttributeError):
        pass
    _write(out, {"state": "validating", "error_code": None, "detail": "", "retry": False, "files": files, "engine_commit": commit, "cache_changes": changes})
    return 0


def _load_lib(engine_dir: Path):
    sys.path.insert(0, str(engine_dir))
    from ryagram.worker import contract as C, engine as E, runner as R             # noqa: PLC0415
    from ryagram.worker.schema import Rejected, validate_job                       # noqa: PLC0415
    from ryagram.worker.worker import Config                                       # noqa: PLC0415

    class Lib:
        pass
    lib = Lib()
    lib.C, lib.E, lib.R, lib.Rejected, lib.validate_job, lib.Config = C, E, R, Rejected, validate_job, Config
    return lib


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Make one site film with the house worker's own code (internal).")
    for k in ("engine-dir", "config", "job", "jobs-dir", "out", "started"):
        ap.add_argument("--" + k, required=True)
    ap.add_argument("--house-jobs", default="", help="the house worker jobs folder, read-only, to step aside for a paid film")
    a = ap.parse_args(argv)
    out = Path(a.out)
    try:
        lib = _load_lib(Path(a.engine_dir))
        cfg = lib.Config.from_toml(Path(a.config))
        row = json.loads(Path(a.job).read_text(encoding="utf-8"))
        busy = (lambda: house_busy(a.house_jobs)) if a.house_jobs else None
        cache = dict(cfg.engine.extra_env).get("RYAGRAM_CACHE_DIR")
        return run_job(lib, row, cfg=cfg, jobs_dir=Path(a.jobs_dir), started=Path(a.started), out=out, busy=busy, cache_dir=cache)
    except Exception as e:                                                          # noqa: BLE001  the type only: a message could hold a value
        _write(out, {"state": "failed", "error_code": "start_failed", "detail": SENTENCES["start_failed"], "retry": True, "files": {},
                     "engine_commit": None, "exception": type(e).__name__})
        return 0


if __name__ == "__main__":
    sys.exit(main())
