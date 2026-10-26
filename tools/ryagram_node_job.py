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
import json
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
    "crash": "The film stopped before it was finished.",
}


def _write(out: Path, doc: dict) -> None:
    tmp = out.with_suffix(".tmp")
    tmp.write_text(json.dumps(doc), encoding="utf-8")
    tmp.replace(out)


def _fail(out: Path, code: str, *, retry: bool = False) -> int:
    _write(out, {"state": "failed", "error_code": code, "detail": SENTENCES.get(code, "The film could not be made on this computer."),
                 "retry": retry, "files": {}, "engine_commit": None})
    return 0


def run_job(lib, row, *, cfg, jobs_dir: Path, started: Path, out: Path, clock=time.time) -> int:
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
    lib.E.write_inputs(job, paths)
    tl = cfg.limits[job.job_type]
    limits = lib.R.Limits(wall_s=tl.wall_s, memory_bytes=cfg.memory_bytes, work_bytes=cfg.work_bytes, max_processes=cfg.max_processes)
    started.write_text(str(int(clock())), encoding="ascii")                 # the parent shows "making your film" from here
    m = lib.R.run(argv, cwd=paths.root,
                  env=lib.E.child_env(cfg.engine, paths, max_processes=limits.max_processes, memory_bytes=limits.memory_bytes),
                  limits=limits, stdout=paths.stdout, stderr=paths.stderr, work_dir=paths.root, tick_s=0.5)
    outcome = lib.E.classify(m, job, paths)
    if outcome.state != "validating":
        code = outcome.error_code or "crash"
        _write(out, {"state": outcome.state, "error_code": code, "detail": SENTENCES.get(code, "The film could not be made on this computer."),
                     "retry": bool(outcome.retry), "files": {}, "engine_commit": None})
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
    _write(out, {"state": "validating", "error_code": None, "detail": "", "retry": False, "files": files, "engine_commit": commit})
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
    a = ap.parse_args(argv)
    out = Path(a.out)
    try:
        lib = _load_lib(Path(a.engine_dir))
        cfg = lib.Config.from_toml(Path(a.config))
        row = json.loads(Path(a.job).read_text(encoding="utf-8"))
        return run_job(lib, row, cfg=cfg, jobs_dir=Path(a.jobs_dir), started=Path(a.started), out=out)
    except Exception as e:                                                          # noqa: BLE001  the type only: a message could hold a value
        _write(out, {"state": "failed", "error_code": "start_failed", "detail": SENTENCES["start_failed"], "retry": True, "files": {},
                     "engine_commit": None, "exception": type(e).__name__})
        return 0


if __name__ == "__main__":
    sys.exit(main())
