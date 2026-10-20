"""Desktop maker (INTERNAL prototype, for Sam): a one-page screen on THIS computer for ENGINE's local build. Pick a recipe, see its slots, pick a local video file for each slot (or paste the
`--bind slot=FILE` lines WORKER's `library find --emit-binds` prints), press Plan to see exactly what Build would do, then Build, which runs ENGINE's CLI (`python -m ryagram.local build`).

    py tools/desktop_maker.py [--open] [--engine <the Ryagram folder>] [--recipes <a folder of recipe .json files>] [--work-dir <folder>] [--out-dir <folder>] [--port 8765]

For a person who does not use a terminal: double-click tools/start-maker.bat (it runs this with --open).

What it is not: no upload (the page has no file input and the server never sends or receives file bytes, only paths on this computer), no Supabase, no account, no network call of its own. The server
listens on 127.0.0.1 only; every request must carry a random token that is printed once at start-up and must name the local host (a web page on another site cannot drive it). The page and its script and style
are served by this server under a strict policy (no inline script or style, no outside connections). Plan writes no film; Build writes the MP4 and its receipt to the out folder and everything else to the work folder. A file may be a span of a video: slot=FILE#START_MS-END_MS.
Plan runs ENGINE's own `plan` command (it listens to the files, writes NO film and no receipt, and keeps the words it heard in the work folder so Build does not listen again); before it, this tool runs the door checks (ENGINE's recipe and bind checks, every slot filled, ffmpeg, disk room). Build is allowed only for exactly the files a Plan said were ready.
Stdlib only. The file picker is the operating system's own dialog (tkinter), opened by the server on this computer."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import re
import secrets
import shutil
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

HERE = Path(__file__).resolve().parent
MODELS = ("tiny", "base", "small")
EXIT_HELP = {
    0: ("Done.", "Nothing more to do."),
    1: ("Something unexpected went wrong.", "Press Plan again. If it happens again, send the lines below to Ryan; nothing was kept as a film."),
    2: ("Refused: the recipe or one of the files is not right, so nothing was run.", "Read the lines below: they name the file or slot. Fix it, then press Plan again."),
    3: ("The files you chose do not say every word the recipe needs. Nothing was written.", "Add a file that says the missing words, or pick a recipe whose words your files do say, then press Plan again."),
    4: ("Blocked: the build tried to use the network, which it must not. Nothing was kept.", "Do not use this film. Tell Ryan exactly what you chose, and send him the lines below."),
    5: ("Cancelled.", "Anything half-made is in the work folder; no film was kept. Press Plan to start again."),
}
STATE = {"engine": None, "recipes": None, "work": None, "out": None, "token": "", "port": 0, "job": None, "planned": None, "R": None, "E": None}
LOCK = threading.RLock()


# ---------------------------------------------------------------------------------------------------- engine

def load_engine(engine_dir: Path):
    """Import ENGINE's recipe and local-build modules from the checkout (read-only; nothing in it is run except these imports)."""
    if not (engine_dir / "ryagram" / "local" / "engine.py").is_file():
        raise SystemExit(f"{engine_dir} has no ryagram/local/engine.py: point --engine at a Ryagram checkout that has the local build (branch local-mvp).")
    sys.path.insert(0, str(engine_dir))
    from ryagram import recipe as R  # noqa: PLC0415
    from ryagram.local import engine as E  # noqa: PLC0415
    return R, E


def list_recipes(folder: Path) -> list[dict]:
    R = STATE["R"]
    out = []
    for p in sorted(folder.glob("*.json")):
        try:
            rec = R.parse_recipe(p.read_bytes())
        except Exception as e:  # noqa: BLE001
            out.append({"file": p.name, "ok": False, "problem": str(e)[:200]})
            continue
        out.append({"file": p.name, "ok": True, "name": rec["name"], "slots": [{"id": s["id"], "label": s["label"], "multiple": bool(s["multiple"]), "accepts": s["accepts"]} for s in rec["slots"]],
                    "find": (rec.get("find") or {}).get("text", ""), "has_find": isinstance(rec.get("find"), dict)})
    return out


def _phrase(body: dict) -> str:
    """The words the person typed on the page (one line, at most 200 letters), or "" to keep the words in the recipe file."""
    return " ".join(str(body.get("phrase") or "").split())[:200]


def recipe_bytes(body: dict) -> bytes:
    """The recipe as it will be run: the file as it is, or (when words were typed on the page) a copy whose find text is those words. The recipe file itself is never changed."""
    raw = recipe_path(body.get("recipe")).read_bytes()
    typed = _phrase(body)
    if not typed:
        return raw
    d = json.loads(raw.decode("utf-8-sig"))
    if not isinstance(d, dict) or not isinstance(d.get("find"), dict) or d["find"].get("text") == typed:
        return raw
    d["find"]["text"] = typed
    return json.dumps(d, indent=1, ensure_ascii=False).encode("utf-8")


def recipe_file_for(body: dict) -> Path:
    """The recipe file to hand to the engine: the original, or the copy with the typed words, saved in this choice's own work folder."""
    orig = recipe_path(body.get("recipe"))
    data = recipe_bytes(body)
    if data == orig.read_bytes():
        return orig
    copy = _work_for(body) / "recipe-with-typed-words.json"
    copy.parent.mkdir(parents=True, exist_ok=True)
    copy.write_bytes(data)
    return copy


def recipe_path(name: str) -> Path:
    p = (STATE["recipes"] / Path(str(name)).name)           # the file NAME only: no folder tricks
    if p.suffix.lower() != ".json" or not p.is_file() or p.parent.resolve() != STATE["recipes"].resolve():
        raise Problem("That recipe is not in the recipes folder.")
    return p


class Problem(ValueError):
    """A sentence for the person."""


# ---------------------------------------------------------------------------------------------------- binds

BIND_RE = re.compile(r"^(?:--bind\s+)?(?P<slot>[a-z][a-z0-9-]{0,23})=(?P<file>.+)$")


def parse_pasted(text: str) -> tuple[dict, list[str]]:
    """Lines like `--bind source-1=C:\\clips\\a.mp4` or `source-1=C:\\clips\\a.mp4` (quotes allowed) to {slot: [paths]}; lines that do not fit are returned in words, never guessed."""
    binds: dict[str, list[str]] = {}
    bad: list[str] = []
    for n, line in enumerate(str(text or "").splitlines(), 1):
        t = line.strip()
        if not t or t.startswith("#"):
            continue
        m = BIND_RE.match(t)
        if not m:
            bad.append(f"line {n}: not a slot=file line")
            continue
        f = m.group("file").strip()
        if len(f) >= 2 and f[0] == f[-1] and f[0] in "\"'":
            f = f[1:-1]
        binds.setdefault(m.group("slot"), []).append(f)
    return binds, bad


def _listen_seconds(b):
    """What the engine will listen to for this file: the span when one is given, else the whole file."""
    if b.start_ms is not None:
        return (b.end_ms - b.start_ms) / 1000
    return media_seconds(b.path)


def _bind_args(raw) -> list[str]:
    return [f"{slot}={f}" for slot, files in (raw.items() if isinstance(raw, dict) else []) for f in (files if isinstance(files, list) else [])]


def _span(b) -> str:
    return "" if b.start_ms is None else f", only {b.start_ms / 1000:.2f} to {b.end_ms / 1000:.2f} s"


ADDON_STEP = 'Type this in a PowerShell window, then double-click this file again:  python -m pip install faster-whisper "av<19"'


def faster_whisper_missing() -> bool:
    """Is the speech add-on (faster-whisper) missing from the Python that runs the maker? Found without importing it (it is big)."""
    import importlib.util
    return importlib.util.find_spec("faster_whisper") is None


def models_present(root) -> list[str]:
    """Which listening models have their weights in this folder (the layout the engine's model download writes: models--Systran--faster-whisper-<size>/snapshots/<id>/model.bin)."""
    root = Path(root)
    return [m for m in MODELS if any(root.glob(f"models--Systran--faster-whisper-{m}/snapshots/*/model.bin"))]


GET_MODEL = r"tools\get-model.bat"


def missing_model_sentence(model: str) -> str:
    return f"The listening model ({model}) is not on this computer yet. Double-click {GET_MODEL} once (it needs the internet for a few minutes), then press Plan again."


def precheck(body: dict) -> dict:
    """The door checks, before ENGINE's plan is run (fast, writes nothing): ENGINE's own recipe check and bind check, every slot filled, ffmpeg, disk room."""
    R, E = STATE["R"], STATE["E"]
    problems: list[str] = []
    rec = None
    try:
        rec = R.parse_recipe(recipe_bytes(body))
    except Problem as e:
        problems.append(str(e))
    except Exception as e:  # noqa: BLE001
        problems.append(f"The recipe is refused: {str(e)[:200]}")
    model = body.get("model") or "base"
    if model not in MODELS:
        problems.append(f"The model must be one of {', '.join(MODELS)}.")
    mroot = os.environ.get("RYAGRAM_MODEL_DIR")
    if model in MODELS and mroot and model not in models_present(mroot):
        problems.append(missing_model_sentence(model))
    if faster_whisper_missing():
        problems.append('The speech add-on is not installed on this PC. Type this in a PowerShell window, then press Plan again:  python -m pip install faster-whisper "av<19"')
    args = _bind_args(body.get("binds") or {})
    binds: dict = {}
    for pair in args:
        try:
            for slot, items in E.parse_binds([pair]).items():
                binds.setdefault(slot, []).extend(items)
        except E.Refused as e:
            problems.append(str(e))
    remember_dirs([b.path for items in binds.values() for b in items])
    lines: list[dict] = []
    if rec:
        extra = sorted(set(binds) - {s["id"] for s in rec["slots"]})
        if extra:
            problems.append("Not a slot of this recipe: " + ", ".join(extra))
        for s in rec["slots"]:
            items = binds.get(s["id"], [])
            if not items:
                problems.append(f"The slot \u201c{s['label']}\u201d has no file yet.")
            if len(items) > 1 and not s["multiple"]:
                problems.append(f"The slot \u201c{s['label']}\u201d takes one file; it has {len(items)}.")
            lines.append({"slot": s["id"], "label": s["label"], "files": [{"name": b.path.name + _span(b), "mb": round(b.path.stat().st_size / 1e6, 1), "seconds": _listen_seconds(b), "key": f"{b.path}|{b.start_ms}|{b.end_ms}"} for b in items]})
    work = STATE["work"]
    anchor = work if work.exists() else work.parent if work.parent.exists() else Path(work.anchor)
    free_gb = round(shutil.disk_usage(anchor).free / 1e9, 1)
    if shutil.which("ffmpeg") is None:
        problems.append("ffmpeg is not on this computer's PATH, and the build cuts the files with it.")
    total_mb = sum(f["mb"] for ln in lines for f in ln["files"])
    if free_gb < max(2.0, total_mb / 1000 * 1.5):
        problems.append(f"Only {free_gb} GB free where the work folder is; choose a drive with more room.")
    film = (re.sub(r"[^A-Za-z0-9._-]+", "-", rec["name"]).strip("-")[:60] or "film") if rec else None
    secs = [f["seconds"] for ln in lines for f in ln["files"]]
    distinct = {f["key"]: f["seconds"] for ln in lines for f in ln["files"]}           # a file (or span) bound to several slots is listened to ONCE: the engine reuses the words it already heard
    total_s = None if (not secs or any(x is None for x in distinct.values())) else sum(distinct.values())
    return {"ok": not problems, "listen_words": wait_words(total_s, model), "listen_seconds": total_s, "bind_count": len(secs),
            "film_stamped": f"{film}-<date and time>.mp4" if film else None, "problems": problems, "recipe": rec["name"] if rec else None, "find": (rec.get("find") or {}).get("text", "") if rec else "", "slots": lines, "model": model,
            "film": f"{film}.mp4" if film else None, "out_dir": str(STATE["out"]), "free_gb": free_gb, "args": args, "network": "none (the build has a guard that stops any network attempt)"}


def _work_for(body: dict) -> Path:
    """One work folder for one choice of recipe, files and model, so Build reuses the words Plan already heard instead of listening again."""
    key = hashlib.sha1(json.dumps([body.get("recipe"), sorted(_bind_args(body.get("binds") or {})), body.get("model"), _phrase(body)]).encode("utf-8")).hexdigest()[:10]
    return STATE["work"] / key


def start_job(kind: str, body: dict) -> dict:
    with LOCK:                                      # held from "is something running" to "the job is stored": two quick presses cannot start two jobs
        return _start_job_locked(kind, body)


def _start_job_locked(kind: str, body: dict) -> dict:
    job = STATE["job"]
    if job and job["proc"].poll() is None:
        raise Problem("Something is already running here. Cancel it or wait for it to finish.")
    pc = precheck(body)
    if not pc["ok"]:
        raise Problem("Fix what is listed first: " + " ".join(pc["problems"][:3]))
    if kind == "build":
        last = STATE.get("planned")
        if not last or last != _plan_key(body):
            raise Problem("Press Plan first for exactly these files, and wait for it to say it is ready.")
    out_dir = STATE["out"]
    stamp = time.strftime("%Y%m%d-%H%M%S")
    out = out_dir / (pc["film"] if kind == "plan" else f"{Path(pc['film']).stem}-{stamp}.mp4")
    cmd = [sys.executable, "-m", "ryagram.local", kind, str(recipe_file_for(body)), "--work-dir", str(_work_for(body)), "--model", pc["model"], "--out", str(out)]
    if kind == "plan":
        cmd.append("--json")
    for a in pc["args"]:
        cmd += ["--bind", a]
    if kind == "build":
        out_dir.mkdir(parents=True, exist_ok=True)
    env = dict(os.environ, PYTHONPATH=str(STATE["engine"]), PYTHONIOENCODING="utf-8", NO_PROXY="127.0.0.1,localhost")
    proc = subprocess.Popen(cmd, cwd=str(STATE["engine"]), env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding="utf-8", errors="replace")
    job = {"proc": proc, "kind": kind, "out": out, "lines": [], "stdout": [], "started": time.time(), "cancelled": False, "id": stamp, "key": _plan_key(body),
           "of": pc["bind_count"], "done": 0, "current": "", "expect_s": listen_expect_s(pc["listen_seconds"], pc["model"])}
    threading.Thread(target=_pump, args=(job, proc.stderr, "lines"), daemon=True).start()
    threading.Thread(target=_pump, args=(job, proc.stdout, "stdout"), daemon=True).start()
    STATE["job"] = job
    if kind == "plan":
        STATE["planned"] = None
        STATE["sound"] = None
    STATE["attempts"][kind] = STATE["attempts"].get(kind, 0) + 1
    ls = pc["listen_seconds"]
    act("job_start", kind=kind, attempt=STATE["attempts"][kind], recipe=recipe_stem(body), model=pc["model"], files=pc["bind_count"],
        video_minutes=-1 if ls is None else int(round(ls / 60)), phrase_chars=len(_phrase(body)), words_changed=bool(_phrase(body)))
    return {"id": stamp, "kind": kind, "film": out.name}


def _plan_key(body: dict) -> str:
    return json.dumps([body.get("recipe"), sorted(_bind_args(body.get("binds") or {})), body.get("model"), _phrase(body)])


def _pump(job, stream, field):
    for line in stream:
        job[field].append(line.rstrip("\n")[:2000] if field == "stdout" else line.rstrip()[:300])
        if field == "lines":
            del job["lines"][:-60]
            t = line.strip()
            m = re.match(r"^listening to (.+?) \.\.\.$", t)
            if m:
                job["current"] = m.group(1)
            elif re.search(r": [0-9]+ words in [0-9.]+ s of audio$", t) or t.endswith("heard before, using the saved words"):
                job["done"] += 1


def _progress_words(lines) -> str:
    for ln in reversed(lines):
        m = re.search(r'"stage":\s*"(listening|planning|cutting)"', ln)
        if m:
            return m.group(1)
    return ""


def _discard_outputs(job) -> None:
    """A build that stopped or was cancelled keeps nothing: ENGINE may leave a film with missing words or a part-written MP4 at --out, so delete it and its receipt here."""
    if job["kind"] == "build":
        for f in (job["out"], job["out"].with_suffix(".receipt.json")):
            f.unlink(missing_ok=True)


def job_status() -> dict:
    out = _job_status()
    job = STATE["job"]
    if job and not job.get("logged") and out.get("state") in JOB_STATES:
        job["logged"] = True
        try:
            plan = out.get("plan") or {}
            rc = out.get("receipt") or {}
            act("job_end", kind=job["kind"], state=out["state"], code=int(out.get("code", 0)), seconds=int(out.get("seconds", 0)),
                clips=len(plan.get("clips", [])) if plan else len(rc.get("clips", [])), gaps=len(plan.get("gaps", [])) if plan else 0,
                film_seconds=int(round(rc.get("seconds", 0))), network_attempts=int(rc.get("network_attempts", 0)))
        except Exception:  # noqa: BLE001
            pass
    return out


def _job_status() -> dict:
    job = STATE["job"]
    if not job:
        return {"state": "none"}
    code = job["proc"].poll()
    base = {"id": job["id"], "kind": job["kind"], "seconds": round(time.time() - job["started"]), "lines": job["lines"][-12:], "film": job["out"].name}
    if code is None:
        run = {**base, "state": "running"}
        if job["kind"] == "plan":
            run["progress"] = {"done": job["done"], "of": job["of"], "current": job["current"], "expect_s": job["expect_s"]}
        return run
    if code is not None:
        time.sleep(0.15)                                       # let the readers drain the last lines
    if job["cancelled"]:
        _discard_outputs(job)
        what, nxt = EXIT_HELP[5]
        return {**base, "state": "cancelled", "words": what, "next": nxt}
    what, nxt = EXIT_HELP.get(code, EXIT_HELP[1])
    if code != 0:
        _discard_outputs(job)
    out = {**base, "state": "stopped", "code": code, "words": what, "next": nxt}
    if job["kind"] == "plan" and code in (0, 3):
        try:
            ans = json.loads("\n".join(job["stdout"]))
        except Exception:  # noqa: BLE001
            ans = None
        if ans is not None:
            out.update(state="planned" if ans.get("ok") else "gaps", plan=ans)
            if ans.get("ok"):
                with LOCK:
                    STATE["planned"] = job["key"]
                out["words"], out["next"] = "Ready to build. No film has been written yet.", "Press Build. It reuses the words Plan already heard."
    if job["kind"] == "build" and code == 0:
        rp = job["out"].with_suffix(".receipt.json")
        try:
            out["receipt"] = json.loads(rp.read_text(encoding="utf-8")) if rp.is_file() else None
        except Exception:  # noqa: BLE001
            out["receipt"] = None
        out.update(state="built", path=str(job["out"]), film_url="/film")
        STATE["last_film"] = str(job["out"])
    return out


def cancel_job() -> dict:
    job = STATE["job"]
    if not job or job["proc"].poll() is not None:
        return {"state": "none"}
    job["cancelled"] = True
    pid = job["proc"].pid
    if os.name == "nt":
        subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"], capture_output=True)    # my own job, by its PID and its children, never by name
    else:
        job["proc"].kill()
    job["proc"].wait(timeout=10)
    return job_status()


def pick_files(multiple: bool) -> list[str]:
    """The operating system's own file dialog, opened in its own process (tkinter must own its thread). Returns paths on this computer."""
    code = ("import tkinter as tk\nfrom tkinter import filedialog\nr = tk.Tk(); r.withdraw(); r.attributes('-topmost', True)\n"
            "ft = [('Video files', '*.mp4 *.mkv *.mov *.avi *.webm *.m4v')]\n"
            + ("res = filedialog.askopenfilenames(title='Choose video files', filetypes=ft)\n" if multiple else "res = filedialog.askopenfilename(title='Choose a video file', filetypes=ft)\nres = [res] if res else []\n")
            + "import json; print(json.dumps(list(res)))")
    r = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, encoding="utf-8", timeout=600)
    try:
        return json.loads(r.stdout.strip().splitlines()[-1])
    except Exception:  # noqa: BLE001
        return []


# ---------------------------------------------------------------------------------------------------- activity log (kit r8)
# A LOCAL activity log, so Ryan can see where a first-time person got stuck. It is one text file (one JSON object a line) in the OUT folder, next to
# the films and my-answers.txt, and it NEVER leaves this computer: this program has no network code, and the log code imports none and opens no socket.
# What can be written is fixed HERE, in ACTIVITY_EVENTS: each event, the only fields it may carry, and for every field a rule that a value must satisfy
# (a number, a yes/no, or a word from a short fixed list). Anything else is written as "?". So a file name, a folder, the words the person typed, an answer, a
# user name or a computer name CANNOT reach the file whatever the page sends. It stops growing at ACTIVITY_MAX_BYTES. A failure to write is ignored (the log
# never breaks the maker), and deleting the file or the folder is fine: the next line makes them again. Off: the page switch writes one last line and then
# no line at all; the choice is remembered by an empty marker file in the same folder; --no-activity-log starts it off.
ACTIVITY_NAME = "maker-activity-log.jsonl"
ACTIVITY_OFF_NAME = "maker-activity-log.off"
ACTIVITY_MAX_BYTES = 2_000_000
MAKER_REVISION = "r8"
PROBLEM_KINDS = ("model", "addon", "ffmpeg", "disk", "slot_empty", "slot_many", "recipe", "file", "other")
ENDPOINTS = ("check", "plan", "build", "cancel", "sound", "open-folder", "answers", "pick", "locate", "paste", "event", "log")
JOB_STATES = ("cancelled", "stopped", "planned", "gaps", "built")


def _is_int(v):
    return isinstance(v, int) and not isinstance(v, bool)


def _one_of(*words):
    return lambda v: isinstance(v, str) and v in words


def _kinds(v):
    return isinstance(v, str) and all(w in PROBLEM_KINDS for w in v.split()) and len(v) <= 80


def _numbers(v):
    return isinstance(v, str) and re.fullmatch(r"[0-9]{1,2}( [0-9]{1,2}){0,29}", v) is not None


FIELD_RULES = {
    "maker": _one_of(MAKER_REVISION), "python": lambda v: isinstance(v, str) and re.fullmatch(r"[0-9]{1,2}\.[0-9]{1,2}", v) is not None,
    "os": _one_of("Windows", "Darwin", "Linux"), "ok": lambda v: isinstance(v, bool), "problems": _kinds,
    "files": _is_int, "kind": _one_of("plan", "build"), "state": _one_of(*JOB_STATES), "code": _is_int, "seconds": _is_int, "clips": _is_int, "gaps": _is_int,
    "film_seconds": _is_int, "network_attempts": _is_int, "attempt": _is_int, "video_minutes": _is_int, "phrase_chars": _is_int, "words_changed": lambda v: isinstance(v, bool),
    "model": _one_of(*MODELS), "recipe": lambda v: isinstance(v, str) and re.fullmatch(r"[a-z0-9][a-z0-9-]{0,30}", v) is not None, "multiple": lambda v: isinstance(v, bool),
    "result": _one_of("found", "none", "many", "error"), "timed_out": lambda v: isinstance(v, bool), "lines": _is_int, "not_used": _is_int, "warnings": _is_int,
    "checked": _is_int, "answered": _numbers, "count": _is_int, "endpoint": _one_of(*ENDPOINTS), "exception": _one_of("ValueError", "KeyError", "TypeError", "IndexError", "AttributeError", "OSError", "FileNotFoundError", "PermissionError", "RuntimeError", "UnicodeError", "JSONDecodeError", "TimeoutExpired", "ModuleNotFoundError", "ImportError"),
    "chars": _is_int,
}
ACTIVITY_EVENTS = {
    "session_start": ("maker", "python", "os"), "session_end": (), "page_opened": (),
    "check": ("ok", "problems", "files"), "job_start": ("kind", "attempt", "recipe", "model", "files", "video_minutes", "phrase_chars", "words_changed"),
    "job_end": ("kind", "state", "code", "seconds", "clips", "gaps", "film_seconds", "network_attempts"), "cancel_pressed": (),
    "files_picked": ("multiple", "count"), "file_dropped": ("result", "timed_out"), "paste_used": ("lines", "not_used"), "sound_started": ("files",),
    "sound_done": ("checked", "warnings"), "folder_opened": (), "answers_saved": ("answered", "count"),
    "ui_recipe_changed": ("recipe",), "ui_model_changed": ("model",), "ui_words_edited": ("chars",), "ui_slot_cleared": (),
    "problem_shown": ("endpoint",), "error_shown": ("endpoint", "exception"), "log_off": (), "log_on": (), "log_full": (),
}
CLIENT_EVENTS = {"recipe_changed": "ui_recipe_changed", "model_changed": "ui_model_changed", "words_edited": "ui_words_edited", "slot_cleared": "ui_slot_cleared"}


class ActivityLog:
    def __init__(self, folder, enabled: bool = True):
        self.folder = Path(folder)
        self.enabled = bool(enabled)
        self.session = secrets.token_hex(3)
        self.n = 0
        self.lock = threading.Lock()

    @property
    def path(self) -> Path:
        return self.folder / ACTIVITY_NAME

    def log(self, ev: str, **fields) -> bool:
        """One line, or nothing. Never raises."""
        if not self.enabled or ev not in ACTIVITY_EVENTS:
            return False
        try:
            rec = {"t": time.strftime("%Y-%m-%d %H:%M:%S"), "s": self.session, "ev": ev}
            for k in ACTIVITY_EVENTS[ev]:
                if k in fields:
                    v = fields[k]
                    rec[k] = v if FIELD_RULES[k](v) else "?"
            with self.lock:
                self.folder.mkdir(parents=True, exist_ok=True)
                if self.path.exists() and self.path.stat().st_size > ACTIVITY_MAX_BYTES:
                    return False
                self.n += 1
                rec["n"] = self.n
                with open(self.path, "a", encoding="utf-8") as fh:
                    fh.write(json.dumps(rec, ensure_ascii=True, separators=(",", ":")) + "\n")
            return True
        except Exception:  # noqa: BLE001
            return False

    def set_enabled(self, on: bool) -> None:
        """The page switch. Turning off writes one last line first; the choice is remembered by an empty marker file."""
        marker = self.folder / ACTIVITY_OFF_NAME
        if on:
            try:
                marker.unlink(missing_ok=True)
            except OSError:
                pass
            if not self.enabled:
                self.enabled = True
                self.log("log_on")
        else:
            self.log("log_off")
            self.enabled = False
            try:
                self.folder.mkdir(parents=True, exist_ok=True)
                marker.write_bytes(b"")
            except OSError:
                pass


def act(ev: str, **fields) -> None:
    a = STATE.get("activity")
    if a is not None:
        a.log(ev, **fields)


def problem_kinds(problems) -> str:
    kinds: list[str] = []
    for p in problems:
        t = str(p).lower()
        k = ("model" if "listening model" in t else "addon" if "speech add-on" in t else "ffmpeg" if "ffmpeg" in t else "disk" if "gb free" in t
             else "slot_empty" if "has no file yet" in t else "slot_many" if "takes one file" in t else "recipe" if "recipe" in t
             else "file" if ("not found" in t or "bind" in t or "file" in t) else "other")
        if k not in kinds:
            kinds.append(k)
    return " ".join(kinds)


def recipe_stem(body: dict) -> str:
    try:
        return recipe_path(body.get("recipe")).stem[:31]
    except Exception:  # noqa: BLE001
        return "?"


# ---------------------------------------------------------------------------------------------------- the page

PAGE = """<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Desktop maker</title><link rel="stylesheet" href="/maker.css"></head>
<body><main>
<p class="banner" role="note"><strong>INTERNAL PROTOTYPE.</strong> Runs on this computer only. Nothing is uploaded; there is no account.</p>
<h1>Desktop maker</h1>
<section class="logbox" aria-labelledby="h-log"><h2 id="h-log">A note about a small log</h2>
<p id="log-notice">This kit keeps a short activity log on this computer, in <code id="log-path">(loading)</code>, to help Ryan make it better. It records which buttons you press and when, how long things took, and counts. It never records file names, the words you type, your answers, or anything from your videos. Nothing is sent anywhere. You can delete the file at any time.</p>
<label class="logswitch" for="log-on"><input id="log-on" type="checkbox" checked> Keep this log</label><p id="log-state" class="note" role="status"></p></section>
<p class="intro">Make a film from a recipe and your own video files, on this computer. Choose a recipe, give each slot a file, press Plan to hear the files and see what would be built, then Build.</p>
<section aria-labelledby="h-recipe"><h2 id="h-recipe">1. Recipe</h2>
<label for="recipe">Recipe</label><select id="recipe"></select>
<p id="recipe-note" class="note" role="status"></p>
<label for="words">The words to find in your videos</label><input id="words" type="text" maxlength="200" autocomplete="off" spellcheck="false" aria-describedby="words-note">
<p id="words-note" class="note">The film is cut from these words, in this order. Change them here if you like; the recipe file stays as it is.</p></section>
<section aria-labelledby="h-files"><h2 id="h-files">2. Your files</h2>
<div id="slots"></div>
<details class="paste" hidden><summary>Paste bind lines instead</summary>
<label for="paste">One line for each file, like <code>--bind source-1=C:\\clips\\a.mp4</code> (what <code>library find --emit-binds</code> prints; a span of a file is <code>slot=FILE#START_MS-END_MS</code>)</label>
<textarea id="paste" rows="4" spellcheck="false"></textarea><button id="use-paste" type="button" class="button secondary">Use these lines</button>
<p id="paste-note" class="note" role="status"></p></details>
<label for="model">Speech model on this computer</label><select id="model"><option>tiny</option><option selected>base</option><option>small</option></select>
<p class="note">A larger model hears more words and is slower. Pick the same one you used before, or leave it as it is.</p></section>
<section aria-labelledby="h-plan"><h2 id="h-plan">3. Plan, then Build</h2>
<div class="actions"><button id="plan" type="button" class="button secondary" aria-describedby="why">Plan</button><button id="build" type="button" class="button primary" aria-describedby="why" disabled>Build</button><button id="cancel" type="button" class="button secondary" hidden>Cancel</button></div>
<p id="why" class="note">Build turns on after a Plan says the files are ready.</p>
<p id="job-status" class="sr-only" role="status"></p>
<div id="plan-out"></div>
<div id="job-out"></div>
<div id="sound-out"></div>
<div id="results"></div></section>
</main><script src="/maker.js"></script></body></html>
"""

CSS = """:root{--ink:#1f2a2a;--muted:#4a5656;--line:#cfd6d3;--brand:#175c52;--paper:#fff;--bg:#fbfaf7;--bad:#9b2c2c;--soft:#f1f4f2}
@media(prefers-color-scheme:dark){:root{--ink:#e8eeec;--muted:#b4c0bc;--line:#3b4744;--brand:#6fd1bd;--paper:#1b2321;--bg:#121817;--bad:#ff9b9b;--soft:#222c2a}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 system-ui,Segoe UI,Arial,sans-serif}
main{max-width:860px;margin:0 auto;padding:16px 20px 60px}h1{margin:.4em 0 .2em}h2{margin:1.4em 0 .4em;font-size:1.15rem}
.banner{background:#fff3cd;color:#5a4500;border:1px solid #e3c766;border-radius:8px;padding:8px 12px;margin:0}.intro,.note{color:var(--muted)}.note{margin:.3em 0;font-size:.92rem}
label{display:block;font-weight:700;margin:.8em 0 .25em}select,textarea,input{width:100%;max-width:100%;font:inherit;padding:10px 12px;border:1px solid var(--line);border-radius:10px;background:var(--paper);color:var(--ink);min-height:44px}
textarea{font-family:ui-monospace,Consolas,monospace;font-size:.9rem}
.button{font:inherit;font-weight:700;min-height:44px;padding:8px 22px;border-radius:999px;border:1px solid var(--brand);background:transparent;color:var(--brand);cursor:pointer}
.button.primary{background:var(--brand);color:var(--paper)}.button:disabled{opacity:.5;cursor:not-allowed}.button:focus-visible,select:focus-visible,textarea:focus-visible,input:focus-visible,summary:focus-visible{outline:3px solid var(--brand);outline-offset:2px}
.slot{border:1px solid var(--line);border-radius:12px;padding:12px 16px;margin:12px 0;background:var(--paper)}.slot h3{margin:0 0 4px;font-size:1rem}.slot ul{margin:6px 0;padding-left:20px}.slot li{margin:2px 0;word-break:break-all}
.row{display:flex;gap:10px;flex-wrap:wrap;align-items:center}.actions{display:flex;gap:12px;flex-wrap:wrap;margin:10px 0}
video{width:100%;max-height:60vh;background:#000;border-radius:10px}.results h3{margin:1.2em 0 .3em;font-size:1.05rem}.question textarea{min-height:76px}.warn{border:1px solid #d4a017;background:rgba(212,160,23,.12);border-radius:10px;padding:10px 14px;margin:10px 0}.slot.drop-over{outline:3px dashed var(--brand);outline-offset:3px;background:var(--soft)}.drop-note{margin:6px 0}.drop-note ul{list-style:none;padding:0}.sr-only{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}.problems{color:var(--bad);padding-left:20px}.ok{color:var(--brand);font-weight:700}.panel{border:1px solid var(--line);border-radius:12px;padding:12px 16px;margin:12px 0;background:var(--paper)}
.panel dt{font-weight:700}.panel dd{margin:0 0 6px}.log{font-family:ui-monospace,Consolas,monospace;font-size:.85rem;white-space:pre-wrap;background:var(--soft);border-radius:8px;padding:8px 10px;max-height:240px;overflow:auto}
.logbox{border:1px solid var(--line);border-radius:12px;padding:4px 16px 10px;margin:12px 0;background:var(--paper)}.logbox h2{margin:.6em 0 .2em}.logswitch{display:flex;align-items:center;gap:10px;font-weight:400;min-height:44px}.logswitch input{width:auto;min-height:0;margin:0}
.paste{margin:14px 0}.paste summary{cursor:pointer;min-height:44px;display:flex;align-items:center;font-weight:700}code{background:var(--soft);padding:1px 5px;border-radius:5px}
@media(max-width:600px){main{padding:12px}}
"""

JS = r"""(function () {
  'use strict';
  const T = new URLSearchParams(location.search).get('t') || sessionStorage.getItem('maker-token') || '';
  try { sessionStorage.setItem('maker-token', T); } catch (e) { /* the page still works without it */ }
  const $ = id => document.getElementById(id);
  if (new URLSearchParams(location.search).get('advanced') === '1') document.querySelector('details.paste').hidden = false;      // Ryan's box; Sam never needs it
  const el = (tag, attrs, ...kids) => { const n = document.createElement(tag); for (const [k, v] of Object.entries(attrs || {})) { if (k === 'class') n.className = v; else if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else if (v !== false && v != null) n.setAttribute(k, v === true ? '' : v); } for (const c of kids.flat()) if (c != null) n.append(c); return n; };
  async function api(path, body) {
    const r = await fetch(path, { method: body ? 'POST' : 'GET', headers: { 'X-Maker-Token': T, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({ error: 'The server did not answer.' }));
    if (!r.ok) throw new Error(j.error || 'That did not work.');
    return j;
  }
  const ev = (name, extra) => { api('/api/event', Object.assign({ name }, extra || {})).catch(() => {}); };
  api('/api/log').then(r => { $('log-path').textContent = r.path; $('log-on').checked = r.on; $('log-state').textContent = r.on ? '' : 'The log is off. Nothing is being written.'; }).catch(() => { $('log-path').textContent = '(unavailable)'; });
  $('log-on').addEventListener('change', async ev2 => {
    const box = ev2.currentTarget; box.disabled = true;
    try { const r = await api('/api/log', { on: box.checked }); box.checked = r.on; $('log-state').textContent = r.on ? 'The log is on.' : 'The log is off. Nothing is being written.'; }
    catch (e) { $('log-state').textContent = e.message; box.checked = !box.checked; } finally { box.disabled = false; }
  });
  let recipes = [], current = null, binds = {}, planned = false, poll = null, lastState = '', lastWait = '', builtWords = '';
  const say = text => { $('job-status').textContent = ''; setTimeout(() => { $('job-status').textContent = text; }, 50); };      // the quiet status line a screen reader announces once
  const why = text => { $('why').textContent = text; };
  const fresh = () => { planned = false; soundFor = ''; $('sound-out').replaceChildren(); $('build').disabled = true; why('Build turns on after a Plan says the files are ready.'); $('plan-out').replaceChildren(); };
  function drawSlots() {
    const box = $('slots'); box.replaceChildren();
    if (!current) return;
    for (const s of current.slots) {
      const files = binds[s.id] || [];
      const dropNote = el('p', { class: 'note drop-note' });
      const zone = el('div', { class: 'slot', role: 'group', 'aria-label': `${s.label}: you can drop a video file here` }, el('h3', {}, s.label), el('p', { class: 'note' }, (s.multiple ? 'One or more video files.' : 'One video file.') + ' Drag a video file here from a folder window, or press Choose a file.'), dropNote,
        files.length ? el('ul', {}, files.map(f => el('li', {}, f))) : el('p', { class: 'note' }, 'No file chosen yet.'),
        el('div', { class: 'row' }, el('button', { type: 'button', class: 'button secondary', 'aria-label': `Choose a file for ${s.label}`, onclick: async ev => {
          const btn = ev.currentTarget; btn.disabled = true;      // (currentTarget is gone after an await, so keep the button)
          try { const r = await api('/api/pick', { multiple: s.multiple }); if (r.files.length) { binds[s.id] = s.multiple ? (binds[s.id] || []).concat(r.files) : r.files.slice(0, 1); fresh(); drawSlots(); } }
          catch (e) { $('recipe-note').textContent = e.message; } finally { btn.disabled = false; }
        } }, files.length ? 'Add or change' : 'Choose a file\u2026'),
        files.length ? el('button', { type: 'button', class: 'button secondary', 'aria-label': `Clear the files for ${s.label}`, onclick: () => { binds[s.id] = []; fresh(); drawSlots(); ev('slot_cleared'); } }, 'Clear') : null));
      zone.append();
      wireDrop(zone, s, dropNote);
      box.append(zone);
    }
  }
  // A page is not told where a dropped file lives, only its name, size and time, so the server finds it on this computer (it reads folder listings only; nothing is opened or sent).
  function wireDrop(zone, s, note) {
    const stop = ev => { ev.preventDefault(); ev.stopPropagation(); };
    zone.addEventListener('dragenter', ev => { stop(ev); zone.classList.add('drop-over'); });
    zone.addEventListener('dragover', ev => { stop(ev); zone.classList.add('drop-over'); });
    zone.addEventListener('dragleave', ev => { stop(ev); zone.classList.remove('drop-over'); });
    zone.addEventListener('drop', async ev => {
      stop(ev); zone.classList.remove('drop-over');
      const dropped = [...(ev.dataTransfer && ev.dataTransfer.files ? ev.dataTransfer.files : [])];
      if (!dropped.length) { note.textContent = 'I did not receive a file. Drag a video file from a folder window.'; return; }
      note.textContent = 'Looking for the file on this computer\u2026';
      const got = [], problems = [], before = JSON.stringify(binds[s.id] || []), recipeThen = current;
      for (const f of (s.multiple ? dropped : dropped.slice(0, 1))) {
        try {
          const r = await api('/api/locate', { name: f.name, size: f.size, mtime_ms: f.lastModified });
          if (r.matches.length === 1) got.push(r.matches[0]);
          else if (r.matches.length > 1) { problems.push({ name: f.name, choices: r.matches }); }
          else problems.push({ name: f.name, none: true, timed_out: r.timed_out });
        } catch (e) { problems.push({ name: f.name, error: e.message }); }
      }
      const changed = recipeThen !== current || JSON.stringify(binds[s.id] || []) !== before;      // the person gave this slot a file another way while the search ran: a 'not found' answer is old news now
      if (changed) problems.length = 0;
      if (got.length) { binds[s.id] = s.multiple ? (binds[s.id] || []).concat(got) : got.slice(0, 1); fresh(); drawSlots(); say(`Added ${got.length} file${got.length === 1 ? '' : 's'} to ${s.label}.`); }
      const again = [...document.querySelectorAll('.slot')].find(z => z.getAttribute('aria-label').startsWith(s.label + ':'));
      const out = again ? again.querySelector('.drop-note') : note;
      const lines = [];
      for (const pr of problems) {
        if (pr.error) lines.push(el('p', {}, `${pr.name}: ${pr.error}`));
        else if (pr.none) lines.push(el('p', {}, `I could not find where ${pr.name} is on this computer${pr.timed_out ? ' in the time I had' : ''}. Press Choose a file instead.`));
        else lines.push(el('div', {}, el('p', {}, `More than one file looks like ${pr.name}. Which one?`), el('ul', {}, pr.choices.map(c => el('li', {}, el('button', { type: 'button', class: 'button secondary', onclick: () => { binds[s.id] = s.multiple ? (binds[s.id] || []).concat([c]) : [c]; fresh(); drawSlots(); } }, c))))));
      }
      out.replaceChildren(...lines);
      if (!lines.length) out.textContent = '';
    });
  }
  window.addEventListener('dragover', ev => ev.preventDefault());      // a file dropped outside a slot must not make the browser open it
  window.addEventListener('drop', ev => ev.preventDefault());
  function drawRecipe() {
    const r = recipes.find(x => x.file === $('recipe').value);
    current = r && r.ok ? r : null; binds = {}; fresh();
    $('recipe-note').textContent = !r ? '' : !r.ok ? `This recipe is refused: ${r.problem}` : '';
    $('words').value = ''; $('words').placeholder = current ? current.find : ''; $('words').disabled = !current || !current.has_find;
    drawSlots();
  }
  $('recipe').addEventListener('change', () => { drawRecipe(); ev('recipe_changed', { recipe: $('recipe').value.replace(/\.json$/i, '') }); });
  $('model').addEventListener('change', () => { fresh(); ev('model_changed', { model: $('model').value }); });
  $('words').addEventListener('input', fresh);
  $('words').addEventListener('change', () => ev('words_edited', { chars: $('words').value.length }));
  // what the engine is asked: the words go along only when they differ from the recipe file's own
  const reqBody = () => { const w = $('words').value.replace(/\s+/g, ' ').trim(); const b = { recipe: current.file, binds, model: $('model').value }; if (w && w !== current.find) b.phrase = w; return b; };
  $('use-paste').addEventListener('click', async () => {
    try {
      const r = await api('/api/paste', { text: $('paste').value });
      const unknown = Object.keys(r.binds).filter(k => !current || !current.slots.some(s => s.id === k));
      for (const [k, v] of Object.entries(r.binds)) if (current && current.slots.some(s => s.id === k)) binds[k] = v;
      fresh(); drawSlots();
      const notes = r.bad.concat(unknown.map(k => `${k} is not a slot of this recipe`));
      $('paste-note').textContent = notes.length ? 'Not used: ' + notes.join('; ') + '.' : 'Used. Check the slots above, then press Plan.';
    } catch (e) { $('paste-note').textContent = e.message; }
  });
  function summary(p) {
    return el('div', { class: 'panel' }, el('p', { class: 'ok' }, 'Your files are ready to use.'),
      el('dl', {}, el('dt', {}, 'Film it would write'), el('dd', {}, `${p.film_stamped} (in ${p.out_dir}; the date and time are added so an earlier film is never replaced)`), el('dt', {}, 'Words it will find'), el('dd', {}, p.find), el('dt', {}, 'Files'),
        el('dd', {}, p.slots.map(s => el('div', {}, `${s.label}: `, s.files.map(f => `${f.name} (${f.mb < 1 ? 'under 1 MB' : f.mb + ' MB'})`).join('; ')))), el('dt', {}, 'Speech model'), el('dd', {}, p.model), el('dt', {}, 'How long the listening takes'), el('dd', {}, p.listen_words),
        el('dt', {}, 'Network'), el('dd', {}, p.network), el('dt', {}, 'Room on the work drive'), el('dd', {}, `${p.free_gb} GB free`)));
  }
  $('plan').addEventListener('click', async ev => {
    if (!current) { $('plan-out').replaceChildren(el('p', { class: 'problems', role: 'alert' }, 'Choose a recipe first.')); return; }
    if (current.has_find && !$('words').value.replace(/\s+/g, ' ').trim()) { $('plan-out').replaceChildren(el('p', { class: 'problems', role: 'alert' }, 'Type a short phrase one of your videos really says.')); return; }
    const btn = ev.currentTarget; btn.disabled = true;
    try {
      const body = reqBody();
      const c = await api('/api/check', body);
      if (!c.ok) { fresh(); $('plan-out').replaceChildren(el('div', { class: 'panel' }, el('p', { role: 'alert' }, 'Not ready yet:'), el('ul', { class: 'problems' }, c.problems.map(x => el('li', {}, x))))); return; }
      fresh(); $('job-out').replaceChildren(); lastWait = c.listen_words || '';
      $('plan-out').replaceChildren(summary(c), el('p', { class: 'note' }, 'Now the plan listens to your files and says what it would build. It writes no film. It keeps the words it hears, so Build does not listen again.'));
      await api('/api/plan', body); poll = setInterval(watch, 1200); watch();
    } catch (e) { $('plan-out').replaceChildren(el('p', { class: 'problems', role: 'alert' }, e.message)); }
    finally { if (!poll) btn.disabled = false; }
  });
  function drawSound(j) {
    const box = $('sound-out');
    if (!j || j.state === 'none') { box.replaceChildren(); return; }
    const parts = [];
    if (j.state === 'running') parts.push(el('p', { class: 'note' }, `Checking the sound of your files\u2026 ${j.checked || 0} of ${j.of || ''}`));
    if (j.warnings && j.warnings.length) parts.push(el('div', { class: 'warn', role: 'group', 'aria-label': 'Warnings about the sound of your files' }, el('strong', {}, 'Check this before you rely on the film:'), el('ul', {}, j.warnings.map(w => el('li', {}, w)))));
    else if (j.state === 'done') parts.push(el('p', { class: 'note' }, 'The sound of your files has no gaps that matter.'));
    box.replaceChildren(...parts);
  }
  let soundFor = '', soundPoll = null;
  async function checkSound(body) {
    const key = JSON.stringify(body);
    if (soundFor === key) return;
    soundFor = key;
    try {
      let j = await api('/api/sound', body); drawSound(j);
      if (j.state === 'running') {
        soundPoll = setInterval(async () => {
          try { j = await api('/api/sound'); drawSound(j); if (j.state !== 'running') { clearInterval(soundPoll); soundPoll = null; if (j.warnings.length) say(j.warnings.join(' ')); } } catch (e) { clearInterval(soundPoll); soundPoll = null; }
        }, 1500);
      } else if (j.warnings && j.warnings.length) say(j.warnings.join(' '));
    } catch (e) { $('sound-out').replaceChildren(el('p', { class: 'note' }, e.message)); }
  }
  let resultsFor = '';
  async function drawResults(j) {
    const box = $('results');
    if (!j || j.state !== 'built') { if (j && j.state === 'running') { resultsFor = ''; box.replaceChildren(); } return; }
    if (resultsFor === j.id) return;
    resultsFor = j.id;
    const qs = (await api('/api/questions')).questions;
    const note = el('p', { class: 'note', id: 'answers-note' });
    const areas = qs.map((q, i) => el('div', { class: 'question' }, el('label', { for: `q${i + 1}` }, `${i + 1}. ${q}`), el('textarea', { id: `q${i + 1}`, rows: '2' })));
    box.replaceChildren(el('div', { class: 'results' }, el('h2', { id: 'h-results' }, 'Your film'),
      el('video', { controls: true, preload: 'metadata', src: `${j.film_url}?t=${encodeURIComponent(T)}#t=0.1`, 'aria-label': 'The film that was just built' }),
      el('p', { class: 'note' }, 'It plays from the file on this computer. Nothing is uploaded.'),
      el('div', { class: 'row' }, el('button', { type: 'button', class: 'button secondary', 'aria-label': 'Open the folder that holds the film', onclick: async ev => {
        const btn = ev.currentTarget; btn.disabled = true;
        try { const r = await api('/api/open-folder', {}); note.textContent = `Opened ${r.folder}`; } catch (e) { note.textContent = e.message; } finally { btn.disabled = false; }
      } }, 'Open folder')),
      el('h3', {}, 'A few questions about your first run'),
      el('p', { class: 'note' }, 'A few words each is fine. Your answers are saved in a text file next to the film, on this computer. Nothing is sent.'),
      el('form', { id: 'answers-form', onsubmit: async ev => {
        ev.preventDefault();
        const btn = $('save-answers'); btn.disabled = true;
        try { const r = await api('/api/answers', { answers: areas.map(a => a.querySelector('textarea').value) }); note.textContent = `Saved in ${r.path}`; say(`Your answers are saved in ${r.path}`); } catch (e) { note.textContent = e.message; } finally { btn.disabled = false; }
      } }, areas, el('button', { id: 'save-answers', type: 'submit', class: 'button primary' }, 'Save my answers')), note));
  }
  function drawJob(j) {
    const running = j.state === 'running';
    const what = j.kind === 'plan' ? 'Listening to your files' : 'Building';
    const parts = [];
    const clock = n => `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;
    if (running && j.kind === 'plan' && j.progress && j.progress.of) {
      const g = j.progress;
      parts.push(el('p', {}, `Listening to file ${Math.min(g.done + 1, g.of)} of ${g.of}${g.current ? ': ' + g.current : ''}\u2026 ${clock(j.seconds || 0)} so far` + (g.expect_s ? `, expected about ${Math.max(1, Math.round(g.expect_s / 60))} minute${Math.round(g.expect_s / 60) <= 1 ? '' : 's'} in all` : '') + '.'));
    }
    else if (running) parts.push(el('p', {}, `${what}\u2026 ${j.seconds || 0} s`));
    else if (j.words) parts.push(el('p', { class: ['built', 'planned'].includes(j.state) ? 'ok' : 'problems', role: ['built', 'planned'].includes(j.state) ? null : 'alert' }, j.words));
    if (j.state === 'planned' || j.state === 'gaps') {
      const a = j.plan;
      if (a.clips.length) parts.push(el('p', {}, `It would cut ${a.clips.length} clip${a.clips.length === 1 ? '' : 's'}, about ${a.seconds_estimate} s:`),
        el('ol', {}, a.clips.map(c => el('li', {}, `\u201c${c.words}\u201d from ${c.file_name}, ${(c.start_ms / 1000).toFixed(2)} to ${(c.end_ms / 1000).toFixed(2)} s`))));
      if (a.gaps.length) parts.push(el('p', { class: 'problems', role: 'alert' }, `Not said anywhere in the files you chose: ${a.gaps.join(', ')}.`));
    }
    if (j.state === 'built' && j.receipt && j.receipt.seconds < 5 && current) parts.push(el('p', { class: 'note', id: 'short-film' }, `The film looks for the words \u201c${builtWords || current.find}\u201d and uses them once, so it is short (${j.receipt.seconds.toFixed(1)} s). For a longer film, type a longer sentence in the box above (or put it in the recipe).`));
    if (j.state === 'built') parts.push(el('p', {}, `Your film: ${j.path}`), j.receipt ? el('p', { class: 'note' }, `${j.receipt.clips.length} clip(s), ${j.receipt.seconds.toFixed(1)} s. Nothing went online (${j.receipt.network_attempts} connections). A list of where each word came from is saved beside the film.`) : null);
    if (j.next && !running) parts.push(el('p', {}, el('strong', {}, 'Next: '), j.next));
    if (j.state === 'stopped' || j.state === 'gaps') parts.push(el('p', { class: 'note' }, `Exit code ${j.code}.`));
    if (j.lines && j.lines.length && (running || j.state === 'stopped')) parts.push(el('div', { class: 'log', 'aria-label': 'What it printed' }, j.lines.join('\n')));
    $('job-out').replaceChildren(...parts);
    planned = j.state === 'planned' || (j.state === 'built' && planned);
    $('cancel').hidden = !running; $('plan').disabled = running; $('build').disabled = running || !planned;
    why(running ? 'A job is running, so Plan and Build are off until it ends. You can cancel it.' : planned ? 'The plan is ready. Press Build.' : 'Build turns on after a Plan says the files are ready.');
    if (j.state === 'planned') checkSound(reqBody());
    drawResults(j);
    if (j.state !== lastState) {                                  // announce a change once, not every poll
      lastState = j.state;
      if (running) say(j.kind === 'plan' ? ('Listening to your files. ' + lastWait).trim() : 'Building the film.');
      else if (j.state === 'planned') say(`Plan ready: ${j.plan.clips.length} clip${j.plan.clips.length === 1 ? '' : 's'}, about ${j.plan.seconds_estimate} seconds. Build is now on.`);
      else if (j.state === 'gaps') say(`Cannot build yet. Not said anywhere in your files: ${j.plan.gaps.join(', ')}.`);
      else if (j.state === 'built') say(`The film is built: ${j.path}`);
      else if (j.words) say(j.words + (j.next ? ' ' + j.next : ''));
    }
    if (!running && poll) { clearInterval(poll); poll = null; }
  }
  async function watch() { try { drawJob(await api('/api/job')); } catch (e) { $('job-out').textContent = e.message; } }
  $('build').addEventListener('click', async () => {
    if (!planned || !current) return;
    try { const rb = reqBody(); builtWords = rb.phrase || current.find; await api('/api/build', rb); poll = setInterval(watch, 1200); watch(); }
    catch (e) { $('job-out').replaceChildren(el('p', { class: 'problems', role: 'alert' }, e.message)); }
  });
  $('cancel').addEventListener('click', async () => { try { drawJob(await api('/api/cancel', {})); } catch (e) { $('job-out').textContent = e.message; } });
  (async () => {
    try {
      recipes = (await api('/api/recipes')).recipes.sort((a, b) => Number(b.ok) - Number(a.ok));      // the ones that work first, so the first choice is a usable one
      $('recipe').replaceChildren(...recipes.map(r => el('option', { value: r.file }, r.ok ? r.name : `${r.file} (refused)`)));
      if (!recipes.length) $('recipe-note').textContent = 'No recipe files (.json) were found in the recipes folder.';
      drawRecipe(); const j = await api('/api/job'); if (j.state === 'running') { poll = setInterval(watch, 1200); drawJob(j); }
    } catch (e) { $('recipe-note').textContent = e.message; }
  })();
})();
"""

CSP = "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; media-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"


class Handler(BaseHTTPRequestHandler):
    server_version = "DesktopMaker"

    def log_message(self, *a):
        pass

    def _host_ok(self) -> bool:
        host = (self.headers.get("Host") or "").lower()
        return host in (f"127.0.0.1:{STATE['port']}", f"localhost:{STATE['port']}")

    def _send(self, code: int, body: bytes, ctype: str):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Security-Policy", CSP)
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.end_headers()
        self.wfile.write(body)

    def _json(self, code: int, obj):
        self._send(code, json.dumps(obj).encode("utf-8"), "application/json; charset=utf-8")

    def _auth(self, *, query_ok=False) -> bool:
        if not self._host_ok():
            self._json(403, {"error": "This server answers only on 127.0.0.1."})
            return False
        tok = self.headers.get("X-Maker-Token") or ""
        if query_ok and not tok:
            tok = (parse_qs(urlparse(self.path).query).get("t") or [""])[0]
        if not secrets.compare_digest(tok, STATE["token"]):
            self._json(403, {"error": "Open the address the server printed when it started (it has the token in it)."})
            return False
        return True

    def do_GET(self):  # noqa: N802
        path = urlparse(self.path).path
        if path == "/":
            if self._auth(query_ok=True):
                act("page_opened")
                self._send(200, PAGE.encode("utf-8"), "text/html; charset=utf-8")
        elif path == "/api/log":
            if self._auth():
                a = STATE["activity"]
                self._json(200, {"on": a.enabled, "path": str(a.path)})
        elif path == "/maker.js":
            self._send(200, JS.encode("utf-8"), "text/javascript; charset=utf-8") if self._host_ok() else self._json(403, {"error": "no"})
        elif path == "/maker.css":
            self._send(200, CSS.encode("utf-8"), "text/css; charset=utf-8") if self._host_ok() else self._json(403, {"error": "no"})
        elif path == "/favicon.ico":
            self.send_response(204)
            self.end_headers()
        elif path == "/api/recipes":
            if self._auth():
                self._json(200, {"recipes": list_recipes(STATE["recipes"])})
        elif path == "/api/job":
            if self._auth():
                self._json(200, job_status())
        elif path == "/api/sound":
            if self._auth():
                self._json(200, STATE.get("sound") or {"state": "none"})
        elif path == "/api/questions":
            if self._auth():
                self._json(200, {"questions": STATE["questions"]})
        elif path == "/film":
            self._film()
        else:
            self._json(404, {"error": "Not found."})

    def _film(self):
        """Play the last built film in the page: only that one file, with Range so the player can seek. The token is in the address because a video element cannot send a header."""
        if not self._auth(query_ok=True):
            return
        f = last_film()
        if not f:
            self._json(404, {"error": "No film has been built yet."})
            return
        size = f.stat().st_size
        start, end, code = 0, size - 1, 200
        m = re.match(r"bytes=([0-9]*)-([0-9]*)$", (self.headers.get("Range") or "").strip())
        if m and (m.group(1) or m.group(2)):
            if m.group(1):
                start = int(m.group(1))
                end = int(m.group(2)) if m.group(2) else size - 1
            else:
                start = max(0, size - int(m.group(2)))
            end = min(end, size - 1)
            if start > end:
                self.send_response(416)
                self.send_header("Content-Range", f"bytes */{size}")
                self.end_headers()
                return
            code = 206
        self.send_response(code)
        self.send_header("Content-Type", "video/mp4")
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Length", str(end - start + 1))
        if code == 206:
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Security-Policy", CSP)
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        with open(f, "rb") as fh:
            fh.seek(start)
            left = end - start + 1
            while left > 0:
                chunk = fh.read(min(65536, left))
                if not chunk:
                    break
                self.wfile.write(chunk)
                left -= len(chunk)

    def do_POST(self):  # noqa: N802
        if not self._auth():
            return
        try:
            n = int(self.headers.get("Content-Length") or 0)
            if n > 200_000:
                raise Problem("That request is too large.")
            body = json.loads(self.rfile.read(n) or b"{}")
            if not isinstance(body, dict):
                raise Problem("Bad request.")
            path = urlparse(self.path).path
            if path == "/api/check":
                pc = precheck(body)
                pc.pop("args", None)
                act("check", ok=bool(pc["ok"]), problems=problem_kinds(pc["problems"]), files=int(pc["bind_count"]))
                self._json(200, pc)
            elif path == "/api/plan":
                self._json(200, start_job("plan", body))
            elif path == "/api/build":
                self._json(200, start_job("build", body))
            elif path == "/api/cancel":
                act("cancel_pressed")
                self._json(200, cancel_job())
            elif path == "/api/sound":
                self._json(200, start_soundcheck(body))
            elif path == "/api/open-folder":
                f = last_film()
                if not f:
                    raise Problem("Build a film first.")
                open_in_folder(f)
                act("folder_opened")
                self._json(200, {"folder": str(f.parent)})
            elif path == "/api/answers":
                saved = save_answers(body.get("answers"))
                given = [str(i) for i, x in enumerate(body.get("answers") or [], 1) if i <= 30 and str(x).strip()]
                act("answers_saved", answered=" ".join(given), count=len(given))
                self._json(200, {"path": saved})
            elif path == "/api/pick":
                got = pick_files(bool(body.get("multiple")))
                remember_dirs(got)
                act("files_picked", multiple=bool(body.get("multiple")), count=len(got))
                self._json(200, {"files": got})
            elif path == "/api/locate":
                found = locate(body.get("name"), body.get("size"), body.get("mtime_ms"))
                act("file_dropped", result="many" if len(found["matches"]) > 1 else "found" if found["matches"] else "none", timed_out=bool(found["timed_out"]))
                self._json(200, found)
            elif path == "/api/paste":
                binds, bad = parse_pasted(body.get("text"))
                act("paste_used", lines=sum(len(v) for v in binds.values()), not_used=len(bad))
                self._json(200, {"binds": binds, "bad": bad})
            elif path == "/api/log":
                STATE["activity"].set_enabled(bool(body.get("on")))
                self._json(200, {"on": STATE["activity"].enabled, "path": str(STATE["activity"].path)})
            elif path == "/api/event":
                name = CLIENT_EVENTS.get(str(body.get("name")))
                if not name:
                    raise Problem("Bad request.")
                extra = {}
                if name == "ui_recipe_changed":
                    extra["recipe"] = recipe_stem({"recipe": str(body.get("recipe", "")) + ".json"})
                elif name == "ui_model_changed":
                    extra["model"] = body.get("model")
                elif name == "ui_words_edited":
                    extra["chars"] = min(200, max(0, int(body.get("chars") or 0)))
                act(name, **extra)
                self._json(200, {"ok": True})
            else:
                self._json(404, {"error": "Not found."})
        except Problem as e:
            act("problem_shown", endpoint=urlparse(self.path).path.rpartition("/")[2])
            self._json(400, {"error": str(e)})
        except Exception as e:  # noqa: BLE001
            act("error_shown", endpoint=urlparse(self.path).path.rpartition("/")[2], exception=type(e).__name__)
            self._json(500, {"error": f"Unexpected: {type(e).__name__}: {str(e)[:200]}"})


QUESTIONS = [
    "Did the start program open the page without help? If not, what did the black window say?",
    "Which step was most confusing, and what did you expect to see instead?",
    "Did every sentence on the page make sense? Write down any word you did not understand.",
    "Did the model download work? How long did it take?",
    "Did the plan show what you expected it to find? What was missing or wrong?",
    "Did you trust the Plan before pressing Build? What would have made you trust it more?",
    "How long did Plan and Build take, and did that feel too slow, fine, or fast?",
    "Is the film what you wanted? What would you change first?",
    "Did anything make you worry about your videos or privacy? What?",
    "Would you use this again next week? What would stop you?",
]
NL = chr(10)
SEARCH_SECONDS = 12.0
SKIP_DIRS = {"$recycle.bin", "system volume information", "windows", "program files", "program files (x86)", "programdata", "appdata", "node_modules", "__pycache__"}


def _default_search_roots() -> list:
    home = Path.home()
    return [home / n for n in ("Videos", "Downloads", "Desktop", "Documents", "Movies") if (home / n).is_dir()]


def remember_dirs(paths) -> None:
    """The folders the person's files came from, newest first: a file dropped later is looked for there before anywhere else."""
    for pth in paths:
        d = str(Path(pth).parent)
        recent = STATE.setdefault("recent_dirs", [])
        if d in recent:
            recent.remove(d)
        recent.insert(0, d)
        del recent[20:]


def locate(name, size, mtime_ms, limit_s=None) -> dict:
    """A browser page is never told where a dropped file lives (only its name, size and modified time), so find it: the folders the person's files came from first, then the usual places
    (Videos, Downloads, Desktop, Documents, or the --search folders). A match needs the same name, the same size in bytes and the same modified time (to 2 s). Only listings are read; no file is
    opened, copied or sent anywhere. Stops after SEARCH_SECONDS and says so."""
    base = Path(str(name or "")).name
    if Path(base).suffix.lower() not in STATE["E"].VIDEO_EXTS:
        raise Problem(f"{base or 'That'} is not a video file this tool reads ({', '.join(STATE['E'].VIDEO_EXTS)}).")
    try:
        size = int(size)
        mtime = float(mtime_ms) / 1000 if mtime_ms else None
    except (TypeError, ValueError):
        raise Problem("Bad request.") from None
    deadline = time.time() + (limit_s if limit_s is not None else SEARCH_SECONDS)
    found: list[str] = []
    timed_out = False

    def walk(root):
        nonlocal timed_out
        stack = [Path(root)]
        while stack:
            if time.time() >= deadline:
                timed_out = True
                return
            d = stack.pop()
            try:
                it = os.scandir(d)
            except OSError:
                continue
            with it:
                for e in it:
                    try:
                        if e.is_symlink() or (hasattr(e, "is_junction") and e.is_junction()):
                            continue                  # a link or a Windows junction can point to another drive or loop back: never followed
                        if e.is_dir(follow_symlinks=False):
                            if e.name.lower() not in SKIP_DIRS and not e.name.startswith("."):
                                stack.append(Path(e.path))
                        elif e.name.lower() == base.lower():
                            st = e.stat()
                            if st.st_size == size and (mtime is None or abs(st.st_mtime - mtime) <= 2):
                                full = str(Path(e.path).resolve())
                                if full not in found:
                                    found.append(full)
                    except OSError:
                        continue

    for group in (list(STATE.get("recent_dirs", [])), [str(r) for r in STATE.get("search_roots", [])]):
        for root in group:
            walk(root)
            if timed_out or len(found) >= 6:
                break
        if found or timed_out:
            break
    return {"matches": found[:6], "timed_out": timed_out}


GAP_WARN_MS = 500
# Measured on one PC with the base model, the v9-lean kit: 24 minutes of video took 145 s, and 67 minutes took 234 s (CONNECT's dress rehearsal). Those two points give about 90 s to start plus 2 s for each minute of video.
# (The first estimate, 6 s a minute from one earlier run of 66 minutes in 383 s, showed about 7 minutes for a plan that took under 4.) The other models are not measured.
LISTEN_START_SECONDS = {"base": 90}
LISTEN_SECONDS_PER_MINUTE = {"base": 2}
SHORT_FILM_SECONDS = 5.0


def media_seconds(path: Path):
    """How long a video file is, in seconds (ffprobe, which comes with ffmpeg), or None when it cannot be read."""
    exe = shutil.which("ffprobe")
    if not exe:
        return None
    try:
        r = subprocess.run([exe, "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)], capture_output=True, text=True, timeout=60)
        return float(r.stdout.strip().split()[0])
    except Exception:  # noqa: BLE001
        return None


def listen_expect_s(total_s, model: str):
    """Expected seconds to listen to total_s seconds of video, or None when the length or the model is not known."""
    per = LISTEN_SECONDS_PER_MINUTE.get(model)
    if total_s is None or per is None:
        return None
    return LISTEN_START_SECONDS[model] + total_s / 60 * per


def wait_words(total_s, model: str) -> str:
    """The expected wait to listen, in plain words, for a total length of video (None = a length could not be read)."""
    if total_s is None:
        return "I could not read how long the files are, so I cannot say how long the listening will take."
    per = LISTEN_SECONDS_PER_MINUTE.get(model)
    minutes = total_s / 60
    length = f"{minutes:.0f} minute{'' if round(minutes) == 1 else 's'}" if minutes >= 1 else "under a minute"
    if per is None:
        return f"{length} of video to listen to. How long that takes has not been measured for the {model} model; the base model takes about {LISTEN_START_SECONDS['base']} seconds to start and then about {LISTEN_SECONDS_PER_MINUTE['base']} seconds for each minute of video."
    secs = listen_expect_s(total_s, model)
    wait = "under a minute" if secs < 60 else f"about {round(secs / 60)} minute{'' if round(secs / 60) == 1 else 's'}"
    if total_s < 300:
        wait += ", often much less"
    return f"{length} of video to listen to: expect {wait} (about {LISTEN_START_SECONDS[model]} seconds to start, then about {per} seconds for each minute of video with the {model} model, measured on one computer; less if you have planned these files before)."


def load_questions(path) -> list[str]:
    """The questions the page asks after a build: FACES' ten by default, or one per line from a file (Ryan edits that list)."""
    if not path:
        return list(QUESTIONS)
    lines = [ln.strip() for ln in Path(path).read_text(encoding="utf-8").splitlines()]
    qs = [re.sub(r"^[0-9]+[.)]\s*", "", ln) for ln in lines if ln and not ln.startswith("#")]
    return qs[:30] or list(QUESTIONS)


def last_film():
    f = STATE.get("last_film")
    return Path(f) if f and Path(f).is_file() else None


def open_in_folder(path) -> None:
    """Show the film in the computer's own file window (only ever the last built film; the page sends no path)."""
    path = str(path)
    if os.name == "nt":
        subprocess.Popen(["explorer", "/select," + path])
    elif sys.platform == "darwin":
        subprocess.Popen(["open", "-R", path])
    else:
        subprocess.Popen(["xdg-open", str(Path(path).parent)])


def save_answers(answers) -> str:
    """The answers go in a plain text file NEXT TO THE FILM, on this computer; nothing is sent anywhere. An earlier file is never overwritten."""
    film = last_film()
    if not film:
        raise Problem("Build a film first; the answers are saved next to it.")
    qs = STATE["questions"]
    if not isinstance(answers, list):
        raise Problem("Bad request.")
    target = film.parent / "my-answers.txt"
    if target.exists():
        target = film.parent / f"my-answers-{time.strftime('%Y%m%d-%H%M%S')}.txt"
    out = ["Desktop maker: my answers", f"Film: {film.name}", f"Written: {time.strftime('%Y-%m-%d %H:%M')}", ""]
    for i, q in enumerate(qs, 1):
        a = str(answers[i - 1] if i - 1 < len(answers) else "").strip()[:3000]
        out += [f"{i}. {q}", a or "(no answer)", ""]
    target.write_text(NL.join(out), encoding="utf-8")
    return str(target)


def _gap_fn():
    """WORKER's sound check (drift-fix): decode_gap_ms(path) -> milliseconds of sound a plain read would lose, or None. Absent in an older engine copy."""
    try:
        from ryagram.library import transcribe as tr  # noqa: PLC0415
        STATE["gap_warn_ms"] = int(getattr(tr, "GAP_WARN_MS", GAP_WARN_MS))      # the library's own threshold, so the maker and `library index` cannot drift apart
        return tr.decode_gap_ms
    except Exception:  # noqa: BLE001
        return None


def start_soundcheck(body: dict) -> dict:
    """After a READY plan: check the sound of each distinct chosen file in the background, so Plan is not slowed. Only files of the plan that was just made are checked."""
    with LOCK:
        if STATE.get("planned") != _plan_key(body):
            raise Problem("Press Plan for exactly these files first.")
        pc = precheck(body)
        if not pc["ok"]:
            raise Problem("Fix what is listed first: " + " ".join(pc["problems"][:3]))
        fn = STATE.get("gap_fn")
        if fn is None:
            STATE["sound"] = {"state": "unavailable", "warnings": ["This copy of the maker cannot check the sound of your files."], "checked": 0}
            return STATE["sound"]
        paths = []
        for items in STATE["E"].parse_binds(pc["args"]).values():
            for b in items:
                if b.path not in paths:
                    paths.append(b.path)
        job = {"state": "running", "warnings": [], "checked": 0, "of": len(paths)}
        STATE["sound"] = job
    act("sound_started", files=len(paths))
    threading.Thread(target=_soundcheck, args=(job, fn, paths), daemon=True).start()
    return job


def _soundcheck(job, fn, paths):
    for path in paths:
        try:
            ms = fn(path)
        except Exception:  # noqa: BLE001
            ms = None
        if ms is None:
            job["warnings"].append(f"Could not check the sound in {path.name}, so any missing parts would not be noticed.")
        elif ms >= STATE.get("gap_warn_ms", GAP_WARN_MS):
            # the same sentence `library index` prints (WORKER, phrasefind f06b907): with the fix in the engine, words ARE timed on the file's own clock, so they are right; what is missing cannot be found
            job["warnings"].append(f"{path.name} has about {ms / 1000:.1f} s of silence where its sound has gaps or starts late (the file is damaged or oddly made); its words are timed correctly, but nothing said in a gap can be found.")
        job["checked"] += 1
    job["state"] = "done"
    act("sound_done", checked=job["checked"], warnings=len(job["warnings"]))


class LocalServer(ThreadingHTTPServer):
    allow_reuse_address = False         # on Windows SO_REUSEADDR lets a second server share a port that is already in use; here a busy port must be an error so the next free one is taken


def make_server(engine: Path, recipes: Path, work: Path, out: Path, port: int = 8765, token: str | None = None, questions: Path | None = None, search: list | None = None, activity: bool = True):
    STATE.update(engine=engine.resolve(), recipes=recipes.resolve(), work=work.resolve(), out=out.resolve(), token=token or secrets.token_urlsafe(24), port=port, job=None, planned=None)
    STATE["questions"] = load_questions(questions)
    STATE["search_roots"] = [Path(x) for x in search] if search else _default_search_roots()
    STATE["R"], STATE["E"] = load_engine(STATE["engine"])
    STATE["gap_warn_ms"] = GAP_WARN_MS
    STATE["recent_dirs"] = []
    STATE["gap_fn"] = _gap_fn()
    STATE["sound"] = None
    STATE["last_film"] = None
    STATE["attempts"] = {"plan": 0, "build": 0}
    STATE["activity"] = ActivityLog(STATE["out"], enabled=activity and not (STATE["out"] / ACTIVITY_OFF_NAME).exists())
    srv = LocalServer(("127.0.0.1", port), Handler)
    STATE["port"] = srv.server_address[1]
    act("session_start", maker=MAKER_REVISION, python=f"{sys.version_info.major}.{sys.version_info.minor}", os=platform.system())
    return srv


def find_engine() -> Path | None:
    """The Ryagram folder this script sits in: tools/ inside it, or the script next to ryagram/ itself."""
    for d in (HERE.parent, HERE, HERE.parent.parent):
        if (d / "ryagram" / "local" / "engine.py").is_file():
            return d
    return None


def bind_free_port(engine, recipes, work, out, first: int, questions=None, search=None, activity: bool = True):
    """Start on the asked port, or the next free one (up to 10 more), so a second start does not fail with an error screen."""
    last = None
    for port in range(first, first + 11) if first else (0,):
        try:
            return make_server(engine, recipes, work, out, port, questions=questions, search=search, activity=activity)
        except OSError as e:
            last = e
    raise SystemExit(f"Could not open a local port ({last}). Close any other Desktop maker window and try again.")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Desktop maker (internal prototype): ENGINE's local film build behind a one-page screen. Local only.")
    ap.add_argument("--engine", help="the Ryagram folder that has ryagram/local (default: the one this script sits in)")
    ap.add_argument("--recipes", help="a folder of recipe .json files (default: the recipes folder inside the Ryagram folder)")
    ap.add_argument("--work-dir", default=str(Path.home() / "Desktop maker" / "work"), help="where the index, cut clips and TEMP go (choose the drive with room)")
    ap.add_argument("--out-dir", default=str(Path.home() / "Desktop maker" / "films"), help="where the MP4 and its receipt go")
    ap.add_argument("--port", type=int, default=8765, help="0 picks any free port")
    ap.add_argument("--search", action="append", default=[], help="a folder to look in for a file you drop onto a slot (repeat for more; default: Videos, Downloads, Desktop and Documents)")
    ap.add_argument("--questions", help="a text file with one question for each line, asked after a build (default: the ten first-run questions)")
    ap.add_argument("--no-activity-log", action="store_true", help="start with the local activity log turned off (the page also has a switch)")
    ap.add_argument("--open", action="store_true", help="open the page in this computer's browser once the server is ready")
    a = ap.parse_args(argv)
    engine = Path(a.engine) if a.engine else find_engine()
    if not engine:
        raise SystemExit("I cannot find the Ryagram folder (it has a folder named ryagram, with a folder named local inside it). Keep this tool inside it, or start with --engine <that folder>.")
    recipes = Path(a.recipes) if a.recipes else engine / "recipes"
    if not recipes.is_dir() or not list(recipes.glob("*.json")):
        raise SystemExit(f"There are no recipe files (.json) in {recipes}. Put a recipe there, or start with --recipes <a folder that has one>.")
    try:
        srv = bind_free_port(engine, recipes, Path(a.work_dir), Path(a.out_dir), a.port, Path(a.questions) if a.questions else None, a.search or None, activity=not a.no_activity_log)
    except ModuleNotFoundError as e:
        raise SystemExit(f"A part of Python that the maker needs is missing ({e.name}). Most likely the speech add-on is not installed. "
                         + ADDON_STEP)
    url = f"http://127.0.0.1:{STATE['port']}/?t={STATE['token']}"
    print("Desktop maker is running on this computer only.", flush=True)
    print(f"Open  {url}", flush=True)
    mroot = os.environ.get("RYAGRAM_MODEL_DIR")
    if mroot:
        have = models_present(mroot)
        print(f"Listening model folder: {mroot} ({'found: ' + ', '.join(have) if have else 'no model there yet: double-click ' + GET_MODEL + ' once'})", flush=True)
    print("Leave this window open while you use it. Close it, or press Ctrl+C, to stop.", flush=True)
    print("If the page does not look right or a button does nothing, copy the address above into Microsoft Edge or Google Chrome.", flush=True)
    if a.open:
        import webbrowser
        threading.Timer(0.4, webbrowser.open, args=(url,)).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        act("session_end")
    return 0


if __name__ == "__main__":
    sys.exit(main())
