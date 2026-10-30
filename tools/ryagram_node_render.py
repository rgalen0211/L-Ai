"""This computer makes my site films: the renderer the maker's node loop uses (NEXT-CONNECT 125, Ryan's go 2026-10-26 12:12). INTERNAL. Standard library only.

WHAT IT IS. tools/ryagram_node.py (the node loop) claims the signed-in person's own queued job and hands it to a `renderer(job, work, progress)`. Until now the maker passed
none, so it said "cannot make site films yet". This is that renderer. It reuses the HOUSE WORKER AS A LIBRARY, in a child process (tools/ryagram_node_job.py): the
engine's own `validate_job`, `argv_for`, Job Object limits and `classify`; no second runner is written here.

THE RULES IT KEEPS (each has a test in tools/check-node-render.py that breaks it on purpose)
  * OFF unless it is fully set up. `make()` returns a list of PLAIN-WORDS PROBLEMS when anything is missing (no settings file, no full Ryagram folder, no python,
    no Chrome or Edge, no ffmpeg, no data folder, no GPU lock tool, a work folder on C:, too little disk or memory). With any problem the maker wires NO renderer and
    says what is missing; it behaves exactly as before ("cannot make site films yet").
  * EVERY render runs inside tools/gpu_lock.py at the LOWEST priority, e (RULINGS 2026-10-20: films last on the GPU). The priority is not a setting. The job's wall
    clock starts only after the lock is granted (the child writes a marker then), so waiting behind another job never uses the film's time. If the lock tool is
    missing, nothing renders.
  * Only a job the site handed THIS signed-in computer (the site's claim returns only the account's own owner_local jobs); a job that says it is for the house, a final
    render, or anything that is not a contact sheet or a preview is refused before anything runs.
  * Nothing is written on C:. The job's folder is the node loop's (under the maker's work folder); a work folder on C: is refused, and so is a settings root on C:.
  * No network of its own: the child and the engine are started with the engine's own clean environment; the only outbound traffic is the node loop's calls to the site host.
  * Only files the house worker named (the primary file and its receipts) are returned, from inside the job's own folder; the node loop re-checks that before sending.
  * A crash, a refusal or a timeout is reported with a fixed sentence and a code, never an engine message (it can name a place from a story).

SETTINGS. A worker-shaped TOML (the same keys as the house worker's worker.toml, so `Config.from_toml` reads it) plus one table:

    [node]
    gpu_lock = 'C:\\path\\to\\gpu_lock.py'
    who = 'MAKER'               # optional; the name shown in the lock's queue

`root`, `worker_id`, `[engine]`, `[datasets]` and `[limits.*]` as the worker has them; `root` must not be on C:. The engine folder is the one the house renders with (the same
commit), so a film made here matches a film made by the house.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import time
import tomllib
from dataclasses import dataclass, field
from pathlib import Path

HERE = Path(__file__).resolve().parent
CHILD = HERE / "ryagram_node_job.py"
GPU_PRIORITY = "e"                       # RULINGS 2026-10-20: film renders are the LAST thing on the GPU. Not a setting.
POLL_S = 2.0
HOUSE_POLL_S = 10.0
HOUSE_WAIT_MAX_S = 6 * 3600           # a tester film that waited this long behind paid films is given back to the site (retried)
LOCK_WAIT_MAX_S = 12 * 3600              # a render that waited this long for the GPU is given up (reported, retried by the site)
MIN_FREE_GB = 10.0
MIN_RAM_BYTES = 8 << 30
ALLOWED_TYPES = ("contact_sheet", "preview")
UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", re.I)
MAX_JOB_BYTES = 300_000
RESULT_KINDS = ("contact_sheet", "preview", "final_video", "receipt", "receipt_text")


def _job_mod():
    if str(HERE) not in sys.path:
        sys.path.insert(0, str(HERE))
    import ryagram_node_job
    return ryagram_node_job


def _node_mod():
    if str(HERE) not in sys.path:
        sys.path.insert(0, str(HERE))
    import ryagram_node
    return ryagram_node


def on_c(path) -> bool:
    """True when `path` is on the C: drive (Ryan's rule: nothing heavy or temporary on C:)."""
    try:
        drive = os.path.splitdrive(os.path.abspath(str(path)))[0]
    except (OSError, ValueError):
        return True
    return drive.upper() in ("C:", "")


@dataclass
class Settings:
    path: Path
    raw: dict
    root: Path
    engine_dir: Path
    python: Path
    chrome: str | None
    path_dirs: tuple
    cache_dir: Path | None
    datasets: tuple
    gpu_lock: Path | None
    house_jobs: Path | None
    gpu_lock_dir: Path | None
    no_house_worker: bool
    who: str
    memory_bytes: int
    problems: list = field(default_factory=list)
    allow_c_inside_app: bool = False          # NEXT-CONNECT 171: off unless the settings say so (a tester build made with Ryan's word): the app's OWN folder may then be on C:


def read_settings(path) -> Settings:
    p = Path(path)
    try:
        raw = tomllib.loads(p.read_text(encoding="utf-8-sig"))
    except (OSError, ValueError, UnicodeDecodeError):
        raise ValueError("The settings file for making site films on this computer is missing or cannot be read.") from None
    try:
        eng = raw["engine"]
        node = raw.get("node") or {}
        argv = list(eng["sequence_argv"])
        return Settings(
            path=p, raw=raw, root=Path(raw["root"]), engine_dir=Path(eng["engine_dir"]), python=Path(argv[0]),
            chrome=eng.get("chrome"), path_dirs=tuple(eng.get("path_dirs", ())),
            cache_dir=Path(eng["env"]["RYAGRAM_CACHE_DIR"]) if (eng.get("env") or {}).get("RYAGRAM_CACHE_DIR") else None,
            datasets=tuple(raw["datasets"]["allow"]), gpu_lock=Path(node["gpu_lock"]) if node.get("gpu_lock") else None,
            house_jobs=Path(node["house_jobs"]) if node.get("house_jobs") else None,
            gpu_lock_dir=Path(node["gpu_lock_dir"]) if node.get("gpu_lock_dir") else None, no_house_worker=node.get("no_house_worker") is True, allow_c_inside_app=(node.get("allow_c_inside_app") is True), who=str(node.get("who") or "MAKER")[:40], memory_bytes=int(raw.get("memory_bytes", 8 << 30)))
    except (KeyError, TypeError, ValueError, IndexError):
        raise ValueError("The settings file for making site films on this computer is incomplete.") from None


def _ram_bytes() -> int | None:
    try:
        import ctypes

        class MS(ctypes.Structure):
            _fields_ = [("dwLength", ctypes.c_ulong), ("dwMemoryLoad", ctypes.c_ulong), ("ullTotalPhys", ctypes.c_ulonglong), ("ullAvailPhys", ctypes.c_ulonglong),
                        ("ullTotalPageFile", ctypes.c_ulonglong), ("ullAvailPageFile", ctypes.c_ulonglong), ("ullTotalVirtual", ctypes.c_ulonglong),
                        ("ullAvailVirtual", ctypes.c_ulonglong), ("ullAvailExtendedVirtual", ctypes.c_ulonglong)]
        ms = MS()
        ms.dwLength = ctypes.sizeof(MS)
        return int(ms.ullTotalPhys) if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(ms)) else None
    except (AttributeError, OSError):
        return None


NO_HOUSE_FOLDER = "house-jobs-none"


def _inside(path, base) -> bool:
    try:
        Path(os.path.abspath(str(path))).relative_to(Path(os.path.abspath(str(base))))
        return True
    except ValueError:
        return False


def c_blocked(path, s: Settings) -> bool:
    """Ryan's rule (nothing heavy or temporary on C:) as it applies to `path`. With allow_c_inside_app (OFF unless the settings say so, which only a tester build made with his word does) a path on C: is
    allowed when it is inside the app's OWN folder, so a tester who has only C: can run the app they unzipped; anything else on C: is still refused."""
    return on_c(path) and not (s.allow_c_inside_app and _inside(path, s.engine_dir))


def effective_house_jobs(s: Settings, work_root) -> Path | None:
    """The folder the house-worker busy check reads. A computer that has no house worker (a tester's own PC) says so in its settings (`no_house_worker = true`) and gets an EMPTY folder inside
    its own work folder, which reads as 'idle'. An explicit `house_jobs` always wins; without either there is NO folder and the renderer stays off (a paid film could be made at the same time)."""
    if s.house_jobs is not None:
        return s.house_jobs
    if s.no_house_worker:
        return Path(work_root) / NO_HOUSE_FOLDER
    return None


def find_problems(s: Settings, work_root, *, ram=_ram_bytes, free_gb=None) -> list[str]:
    """Plain-words reasons this computer cannot make site films yet. Empty = ready."""
    out = []
    if c_blocked(s.root, s):
        out.append("The settings put the worker's folder on C:. Site films are made on another drive.")
    if c_blocked(work_root, s):
        out.append("The maker's work folder is on C:. Start it with a work folder on another drive.")
    if not (s.engine_dir / "ryagram" / "worker" / "engine.py").is_file():
        out.append("The full Ryagram folder (the one the house renders with) was not found at the place the settings name.")
    if not s.python.is_file():
        out.append("The Python the Ryagram engine uses was not found.")
    if not (s.chrome and Path(s.chrome).is_file()):
        out.append("Google Chrome was not found where the settings say. Site films need Google Chrome installed (Microsoft Edge does not work with the film maker).")
    if not any((Path(d) / "ffmpeg.exe").is_file() for d in s.path_dirs):
        out.append("ffmpeg (the video tool) was not found where the settings say.")
    if s.cache_dir is None or not s.cache_dir.is_dir():
        out.append("The data folder the films read was not found on this computer.")
    if s.gpu_lock is None or not s.gpu_lock.is_file():
        out.append("The graphics-card lock tool was not found, and a film is never made without it.")
    if not CHILD.is_file():
        out.append("A part of this app (the film-maker step) is missing.")
    hj = effective_house_jobs(s, work_root)
    if hj is None:
        out.append("The settings do not say where the house worker's films are made, so a paid film could be made at the same moment as this one.")
    else:
        try:
            if s.house_jobs is None and not c_blocked(work_root, s):
                hj.mkdir(parents=True, exist_ok=True)             # the empty folder of a computer with no house worker: inside our own work folder only
            list(hj.iterdir())
        except OSError:
            out.append("The house worker's films folder could not be looked at, so a paid film could be made at the same moment as this one.")
    if s.gpu_lock_dir is not None and c_blocked(s.gpu_lock_dir, s):
        out.append("The settings put the graphics-card lock folder on C:. Site films are made on another drive.")
    if not s.datasets:
        out.append("The settings do not list which datasets a film may use.")
    total = ram()
    if total is not None and total < max(MIN_RAM_BYTES, s.memory_bytes):
        out.append(f"This computer has less memory than a film needs ({max(MIN_RAM_BYTES, s.memory_bytes) >> 30} GB).")
    try:
        free = free_gb() if callable(free_gb) else shutil.disk_usage(work_root if Path(work_root).exists() else Path(work_root).anchor).free / 1e9
        if free < MIN_FREE_GB:
            out.append(f"There is less than {int(MIN_FREE_GB)} GB free on the drive for the work folder.")
    except OSError:
        out.append("The drive for the work folder could not be checked.")
    return out


def lock_command(s: Settings, child_argv: list[str]) -> list[str]:
    """The ONLY way a film is started: inside the GPU lock, at priority e."""
    return [sys.executable, str(s.gpu_lock), "run", "--who", s.who, "--priority", GPU_PRIORITY, "--", *child_argv]


class NodeRenderer:
    """Everything the maker needs from this module: the renderer, the validator, the dataset allowlist and the engine commit."""

    def __init__(self, settings: Settings, work_root, *, spawn=subprocess.Popen, sleep=time.sleep, clock=time.monotonic, ram=_ram_bytes, free_gb=None, busy=None):
        self.s, self.work_root = settings, Path(work_root)
        self.spawn, self.sleep, self.clock = spawn, sleep, clock
        self.problems = find_problems(settings, work_root, ram=ram, free_gb=free_gb)
        self.datasets = list(settings.datasets)
        self._commit = None
        self._static_commit = None
        self.cache_changes = {"count": 0, "examples": [], "checked": False}      # what the last film changed in the shared data cache (it should be nothing)
        self.house_jobs = effective_house_jobs(settings, work_root)
        self.busy = busy if busy is not None else (lambda: _job_mod().house_busy(self.house_jobs))

    # ------------------------------------------------------------------------------------------------ what the node loop calls
    def validate(self, job):
        NodeError = _node_mod().NodeError
        if not isinstance(job, dict):
            raise NodeError("The site sent a job this computer could not read.", "job_invalid")
        if not UUID.match(str(job.get("id", ""))):
            raise NodeError("The site sent a job this computer could not read.", "job_invalid")
        if job.get("run_on", "owner_local") != "owner_local":
            raise NodeError("That job is not one for this computer, so it was not run.", "not_mine")
        if job.get("job_type") not in ALLOWED_TYPES:
            raise NodeError("This computer makes contact sheets and previews. That job is a different kind, so it was not run.", "job_invalid")
        if not isinstance(job.get("story"), dict):
            raise NodeError("The site sent a job without a film in it.", "job_invalid")
        if len(json.dumps(job, ensure_ascii=False)) > MAX_JOB_BYTES:
            raise NodeError("The job is larger than this computer will run.", "job_invalid")
        return job

    def engine_commit(self):
        return self._commit or self._static_commit

    def renderer(self, job, work, progress):
        RenderFailed = _node_mod().RenderFailed
        if self.problems:
            raise RenderFailed("not_ready")
        work = Path(work)
        if c_blocked(work, self.s):
            raise RenderFailed("work_on_c")
        work.mkdir(parents=True, exist_ok=True)
        tmp = work / "tmp-node"
        tmp.mkdir(exist_ok=True)
        job_file, result, started = work / "node-job.json", work / "node-result.json", work / "node-started.marker"
        for f in (result, started):
            f.unlink(missing_ok=True)
        job_file.write_text(json.dumps(job, ensure_ascii=False), encoding="utf-8")
        child = [str(self.s.python), "-I", str(CHILD), "--engine-dir", str(self.s.engine_dir), "--config", str(self.s.path), "--job", str(job_file),
                 "--jobs-dir", str(work.parent), "--out", str(result), "--started", str(started), "--house-jobs", str(self.house_jobs)]
        env = {"SYSTEMROOT": os.environ.get("SYSTEMROOT", r"C:\Windows"), "PATH": os.environ.get("SYSTEMROOT", r"C:\Windows") + r"\System32",
               "TEMP": str(tmp), "TMP": str(tmp), "TMPDIR": str(tmp), "PYTHONUTF8": "1"}
        if self.s.gpu_lock_dir is not None:                       # a tester's PC: the lock's state lives in the app's own folder, never the house's D:\Ryagram-scratch\gpu-lock
            self.s.gpu_lock_dir.mkdir(parents=True, exist_ok=True)
            env["RYAGRAM_GPU_LOCK_DIR"] = str(self.s.gpu_lock_dir)
        elif os.environ.get("RYAGRAM_GPU_LOCK_DIR"):
            env["RYAGRAM_GPU_LOCK_DIR"] = os.environ["RYAGRAM_GPU_LOCK_DIR"]
        t_house = self.clock()
        while True:                                               # a paid film made by the house goes first: wait until it is done (a read-only look, nothing written there)
            try:
                waiting = self.busy()
            except OSError:
                waiting = True                                    # cannot tell = do not risk it
            if not waiting:
                break
            progress("Waiting: a film ordered on Ryagram is being made on this computer first.")
            if self.clock() - t_house > HOUSE_WAIT_MAX_S:
                raise RenderFailed("house_busy", retry=True)
            self.sleep(HOUSE_POLL_S)
        proc = self.spawn(lock_command(self.s, child), cwd=str(work), env=env, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                          creationflags=0x08000000 if os.name == "nt" else 0)
        t0 = self.clock()
        try:
            while proc.poll() is None:
                progress("Making your film." if started.exists() else "Waiting for this computer's graphics card, which is shared.")
                if self.clock() - t0 > LOCK_WAIT_MAX_S + 6 * 3600:
                    raise RenderFailed("timeout")                 # the handler below kills the lock tool and its render
                self.sleep(POLL_S)
        except BaseException:
            self._kill(proc)                       # never leave a render or a lock ticket behind
            raise
        return self._read(result, work, RenderFailed, proc.returncode)

    # ------------------------------------------------------------------------------------------------ helpers
    def _kill(self, proc):
        try:
            if proc.poll() is None:
                subprocess.run(["taskkill", "/PID", str(proc.pid), "/T", "/F"], capture_output=True, timeout=30, check=False)
        except (OSError, subprocess.SubprocessError):
            pass

    def _read(self, result: Path, work: Path, RenderFailed, rc):
        try:
            doc = json.loads(result.read_text(encoding="utf-8"))
            assert isinstance(doc, dict)
        except (OSError, ValueError, AssertionError):
            raise RenderFailed("start_failed", retry=True) from None             # the lock tool refused or the child never wrote: the site decides about a retry
        cc = doc.get("cache_changes")
        if isinstance(cc, dict):
            self.cache_changes = {"count": int(cc.get("count") or 0), "examples": [str(x)[:120] for x in (cc.get("examples") or [])[:10]], "checked": bool(cc.get("checked"))}
        if doc.get("state") != "validating":
            code = str(doc.get("error_code") or "crash")[:80]
            raise RenderFailed(code, retry=bool(doc.get("retry")))
        root = work.resolve()
        out = {}
        for kind, p in (doc.get("files") or {}).items():
            if kind not in RESULT_KINDS:
                continue
            rp = Path(p).resolve()
            if root not in rp.parents:
                raise RenderFailed("outside_job")
            out[kind] = rp
        if not out:
            raise RenderFailed("no_output")
        self._commit = (doc.get("engine_commit") or None) and str(doc["engine_commit"])[:40]
        return out


def make(settings_path, work_root, **inject) -> tuple["NodeRenderer | None", list[str]]:
    """(renderer or None, problems). With any problem the renderer is None and the maker wires nothing."""
    try:
        s = read_settings(settings_path)
    except ValueError as e:
        return None, [str(e)]
    nr = NodeRenderer(s, work_root, **inject)
    if nr.problems:
        return None, nr.problems
    return nr, []
