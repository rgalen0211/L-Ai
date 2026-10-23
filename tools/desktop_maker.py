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
#: What a person sees instead of a speech-model name (Ryan 12:22: Sam would not know which to pick). The Whisper names stay in the receipt and the activity log only.
#: The sizes are the real model folders on disk (tiny 75, base 142, small 464 MB). A choice is offered only if the ENGINE offers that model (engine.MODELS), so
#: "Most accurate" appears the day the engine adds the medium model; today the biggest offered is the Balanced one.
PLAIN_MODELS = (
    ("tiny", "Quickest test (very rough)", 75),
    ("base", "Fast (rough)", 142),
    ("small", "Balanced (recommended)", 464),
    ("medium", "Most accurate (slower)", 1530),
)
SHOW_ORDER = ("base", "small", "medium", "tiny")          # the quickest test goes last
DEFAULT_MODEL = "small"     # Balanced: Ryan chose it on 2026-10-20 17:18 ("almost not worth doing anything less")
EXIT_HELP = {
    0: ("Done.", "Nothing more to do."),
    1: ("Something unexpected went wrong.", "Press Plan again. If it happens again, send the lines below to Ryan; nothing was kept as a film."),
    2: ("Refused: the recipe or one of the files is not right, so nothing was run.", "Read the lines below: they name the file or slot. Fix it, then press Plan again."),
    3: ("Nobody says some of these words in your videos.", "Try different words, or add more videos."),
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
                    "find": (rec.get("find") or {}).get("text", ""), "has_find": isinstance(rec.get("find"), dict), "op": (rec.get("find") or {}).get("op", "words")})
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


def offered_models() -> tuple:
    """The models this engine will run, as far as the maker knows them."""
    known = {n for n, _l, _m in PLAIN_MODELS}
    got = tuple(m for m in tuple(getattr(STATE.get("E"), "MODELS", ()) or ()) if m in known)
    return got or MODELS


def model_label(name) -> str:
    return next((l for n, l, _m in PLAIN_MODELS if n == name), "this setting")


def model_mb(name) -> int:
    return next((m for n, _l, m in PLAIN_MODELS if n == name), 0)


def model_choices() -> list:
    """What the list on the page offers, in the order a person reads it: the name for a person, the size, and whether it is already on this computer (None = not known)."""
    root = os.environ.get("RYAGRAM_MODEL_DIR")
    have = models_present(root) if root else None
    off = offered_models()
    return [{"name": n, "label": model_label(n), "mb": model_mb(n), "ready": (n in have) if have is not None else None} for n in SHOW_ORDER if n in off]


def default_model(choices=None) -> str:
    """Balanced when it is ready (or when nothing is known); else the first choice that IS on this computer, so the first Plan never starts on a missing download."""
    choices = choices if choices is not None else model_choices()
    by = {c["name"]: c for c in choices}
    if DEFAULT_MODEL in by and by[DEFAULT_MODEL]["ready"] is not False:
        return DEFAULT_MODEL
    return next((c["name"] for c in choices if c["ready"]), DEFAULT_MODEL if DEFAULT_MODEL in by else (choices[0]["name"] if choices else DEFAULT_MODEL))


def model_hint() -> str:
    return "Balanced works for most videos. Pick Fast for a quick try" + (", Most accurate if words come out wrong" if "medium" in offered_models() else "") + "."


def models_present(root) -> list[str]:
    """Which listening models have their weights in this folder (the layout the engine's model download writes: models--Systran--faster-whisper-<size>/snapshots/<id>/model.bin)."""
    root = Path(root)
    return [m for m, _l, _s in PLAIN_MODELS if any(root.glob(f"models--Systran--faster-whisper-{m}/snapshots/*/model.bin"))]


def missing_model_sentence(model: str) -> str:
    label, mb = model_label(model), model_mb(model)
    return (f"The \u201c{label}\u201d listening model is not on this computer yet (about {mb} MB, downloaded once). "
            f"Press \u201cDownload the listening model\u201d on this page, wait for it to finish, then press Plan again.")


def _download_mod():
    """tools/model_download.py sits beside this file: the ONE place this app fetches a listening model (fixed host, pinned sizes and SHA-256)."""
    if str(HERE) not in sys.path:
        sys.path.insert(0, str(HERE))
    import model_download
    return model_download


DL = {"state": "idle", "model": "", "done": 0, "total": 0, "file": "", "message": "", "cancel": None}
DL_LOCK = threading.Lock()


def model_dl_status() -> dict:
    with DL_LOCK:
        d = {k: DL[k] for k in ("state", "model", "done", "total", "file", "message")}
    d["can"] = bool(os.environ.get("RYAGRAM_MODEL_DIR"))
    d["host"] = _download_mod().HOST
    return d


def _model_dl_run(model: str, root: str, cancel) -> None:
    md = _download_mod()

    def progress(done, total, name):
        with DL_LOCK:
            DL.update(done=done, total=total, file=name)

    try:
        md.download(model, root, progress=progress, cancel=cancel)
        end, msg, ev = "done", f"Done. The \u201c{model_label(model)}\u201d listening model is ready.", "model_download_done"
    except md.Cancelled:
        end, msg, ev = "cancelled", "Cancelled. Nothing was kept.", "model_download_cancelled"
    except md.ModelRefused as e:
        end, msg, ev = "failed", str(e), "model_download_failed"
    except Exception:  # noqa: BLE001
        end, msg, ev = "failed", "Something unexpected went wrong with the download. Nothing was kept. Try again; if it happens again, tell Ryan.", "model_download_failed"
    with DL_LOCK:
        DL.update(state=end, message=msg, cancel=None)
    act(ev, model=model)


def model_dl_start(model: str) -> dict:
    md = _download_mod()
    root = os.environ.get("RYAGRAM_MODEL_DIR")
    if not root:
        raise Problem("This copy does not know where to keep the listening model, so it cannot download one.")
    if model not in offered_models():
        raise Problem("Pick one of the choices in the listening list on the page.")
    try:
        info = md.model_info(model)
    except md.ModelRefused as e:
        raise Problem(str(e)) from None
    with DL_LOCK:
        if DL["state"] == "running":
            raise Problem("A download is already running.")
        cancel = threading.Event()
        DL.update(state="running", model=model, done=0, total=info["total_bytes"], file="", message="", cancel=cancel)
    act("model_download_started", model=model)
    threading.Thread(target=_model_dl_run, args=(model, root, cancel), daemon=True).start()
    return model_dl_status()


def model_dl_cancel() -> dict:
    with DL_LOCK:
        c = DL.get("cancel")
    if c is not None:
        c.set()
    return model_dl_status()


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
    model = body.get("model") or default_model()
    if model not in offered_models():
        problems.append("Pick one of the choices in the listening list on the page.")
    mroot = os.environ.get("RYAGRAM_MODEL_DIR")
    if model in offered_models() and mroot and model not in models_present(mroot):
        problems.append(missing_model_sentence(model))
    if faster_whisper_missing():
        problems.append('The speech add-on is not installed on this PC. Type this in a PowerShell window, then press Plan again:  python -m pip install faster-whisper "av<19"')
    args = _bind_args(body.get("binds") or {})
    binds: dict = {}
    groups = []                                         # (folder info, the files it gave, the slot): listed ONCE as a folder, not as hundreds of files
    for pair in args:
        try:
            got = E.parse_binds([pair])
            for slot, items in got.items():
                binds.setdefault(slot, []).extend(items)
            for info in getattr(got, "folders", []) or []:
                groups.append((info, list(got.get(info["slot"], []))))
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
            in_folder = {id(b) for g in groups for b in g[1]}
            entries = [{"name": b.path.name + _span(b), "mb": round(b.path.stat().st_size / 1e6, 1), "seconds": _listen_seconds(b), "key": f"{b.path}|{b.start_ms}|{b.end_ms}"} for b in items if id(b) not in in_folder]
            for info, fl in groups:
                if info["slot"] != s["id"]:
                    continue
                secs_f = [_listen_seconds(b) for b in fl]
                entries.append({"name": f"{info['folder']} (a folder: {info['used']} video{'s' if info['used'] != 1 else ''})", "mb": round(sum(b.path.stat().st_size for b in fl) / 1e6, 1),
                                "seconds": None if any(x is None for x in secs_f) else sum(secs_f), "key": "folder:" + "|".join(str(b.path) for b in fl), "count": len(fl), "message": info["message"]})
            lines.append({"slot": s["id"], "label": s["label"], "files": entries})
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
    return {"ok": not problems, "listen_words": wait_words(total_s, model), "listen_seconds": total_s, "bind_count": sum(f.get("count", 1) for ln in lines for f in ln["files"]),
            "folders": [g[0] for g in groups],
            "film_stamped": f"{film}-<date and time>.mp4" if film else None, "problems": problems, "recipe": rec["name"] if rec else None, "find": (rec.get("find") or {}).get("text", "") if rec else "", "slots": lines, "model": model,
            "film": f"{film}.mp4" if film else None, "model_label": model_label(model), "out_dir": str(STATE["out"]), "free_gb": free_gb, "args": args, "network": "none (the build has a guard that stops any network attempt)"}


def _work_for(body: dict) -> Path:
    """One work folder for one choice of recipe, files and model, so Build reuses the words Plan already heard instead of listening again."""
    key = hashlib.sha1(json.dumps([body.get("recipe"), sorted(_bind_args(body.get("binds") or {})), body.get("model"), _phrase(body)]).encode("utf-8")).hexdigest()[:10]
    return STATE["work"] / key


#: words whose absence turns a sentence into its opposite (CC1 13:31): leaving one out is not a harmless gap, so it is shown before Build, first, as a warning.
NEGATIONS = {"not", "no", "never", "none", "nobody", "nothing", "nowhere", "neither", "nor", "without", "cannot", "hardly", "barely", "refuse", "deny", "denied"}


def meaning_risk(words) -> list[str]:
    out = []
    for w in words or []:
        for t in _wordlist(w):
            if (t in NEGATIONS or t.endswith("n't")) and t not in out:
                out.append(t)
    return out


def _wordlist(text) -> list[str]:
    return re.findall(r"[a-z0-9']+", str(text or "").lower().replace("’", "'"))


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
    job = {"proc": proc, "kind": kind, "out": out, "lines": [], "stdout": [], "started": time.time(), "cancelled": False, "id": stamp, "key": _plan_key(body), "args": list(pc["args"]),
           "of": pc["bind_count"], "done": 0, "current": "", "expect_s": listen_expect_s(pc["listen_seconds"], pc["model"])}
    skipped = body.get("skipped") if isinstance(body.get("skipped"), list) else []
    skipped = _wordlist(" ".join(str(x) for x in skipped))[:20]
    job["find"] = _phrase(body) or pc["find"]
    job["note"] = {"typed": " ".join(str(body.get("typed") or "").split())[:200], "built_from_words": job["find"], "skipped": skipped} if skipped else None
    if skipped:
        act("words_skipped", count=len(skipped))
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
    if out.get("state") == "planned":
        STATE["last_plan"] = out.get("plan")
        if STATE.get("job"):
            STATE["last_plan_args"] = STATE["job"].get("args") or []
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
            risk = meaning_risk(list(ans.get("meaning_risk") or []) + list(ans.get("skipped") or []) + list((job.get("note") or {}).get("skipped") or []))
            if risk:
                out["meaning_risk"] = risk
            if ans.get("skipped") and not job.get("skip_logged"):
                job["skip_logged"] = True
                act("words_skipped", count=len(ans["skipped"]))
            if not ans.get("ok"):
                gone = {w for g in ans.get("gaps", []) for w in _wordlist(g)}
                kept = [w for w in _wordlist(job.get("find", "")) if w not in gone]
                if ans.get("clips") and kept and gone:
                    out["skip_phrase"] = " ".join(kept)                  # what is left to say once the missing words are left out
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
        eng = [str(x.get("word", "")) if isinstance(x, dict) else str(x) for x in ((out.get("receipt") or {}).get("skipped") or [])]
        left_out = _wordlist(" ".join(eng)) or list((job.get("note") or {}).get("skipped") or [])        # the engine's own list first; else the words the maker left out itself
        out.update(state="built", path=str(job["out"]), film_url="/film", skipped=left_out, meaning_risk=meaning_risk(left_out))
        if left_out and not job.get("noted"):
            job["noted"] = True
            find, note = job.get("find", ""), job.get("note") or {}
            doc = {"schema": "ryagram.maker-notes/0", "typed": note.get("typed") or find, "built_from_words": note.get("built_from_words") or " ".join(w for w in _wordlist(find) if w not in set(left_out)),
                   "skipped": left_out, "meaning_risk": meaning_risk(left_out), "written": time.strftime("%Y-%m-%d %H:%M")}
            try:
                job["out"].with_suffix(".maker-notes.json").write_text(json.dumps(doc, indent=1, ensure_ascii=False), encoding="utf-8")
            except OSError:
                pass
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


# ---------------------------------------------------------------------------------------------------- maker v2: pictures and rules (OFF unless started with --v2)
# CONNECT's share of CONNECT-MAKER-V2-DESIGN.md section 5: accept pictures like videos, check them, take the person's rights tick, build the rule "every time WORDS are said, show PICTURE for
# N seconds", list where the rule would fire in the built film, and save it all as overlays.json (docs/maker-v2-engine-contract.md). ENGINE's part (word times, the finishing pass that draws
# the pictures) is NOT here: until it exists the occurrences are APPROXIMATE (words spread evenly over each clip) and the page says plainly that nothing is drawn into the film yet.
IMAGE_EXTS = (".png", ".jpg", ".jpeg", ".webp")
MAX_IMAGE_BYTES = 20_000_000
MAX_IMAGE_PIXELS = 25_000_000
RULE_MODES = ("full", "centre", "corner", "lower_third")
RULE_LIMITS = {"seconds": (0.5, 10.0), "fade_s": (0.0, 1.0), "phrase_chars": 200, "rules": 20, "images": 20}
OVERLAYS_SCHEMA = "ryagram.maker-overlays/0"


def _sniff_image(head: bytes):
    """(kind, width, height, animated) from a picture file's own first bytes; kind None when it is not a png, jpeg or webp."""
    if head[:8] == b"\x89PNG\r\n\x1a\n":
        i, w, h, anim = 8, None, None, False
        while i + 8 <= len(head):
            ln, typ = int.from_bytes(head[i:i + 4], "big"), head[i + 4:i + 8]
            if typ == b"IHDR" and i + 16 <= len(head):
                w, h = int.from_bytes(head[i + 8:i + 12], "big"), int.from_bytes(head[i + 12:i + 16], "big")
            if typ == b"acTL":
                anim = True
            if typ in (b"IDAT", b"IEND"):
                break
            i += 12 + ln
        return ("png", w, h, anim) if w else (None, None, None, False)
    if head[:3] == b"\xff\xd8\xff":
        i = 2
        while i + 9 < len(head):
            if head[i] != 0xFF:
                i += 1
                continue
            m = head[i + 1]
            if 0xC0 <= m <= 0xCF and m not in (0xC4, 0xC8, 0xCC):
                return "jpeg", (head[i + 7] << 8) | head[i + 8], (head[i + 5] << 8) | head[i + 6], False
            i += 2 + ((head[i + 2] << 8) | head[i + 3])
        return "jpeg", None, None, False
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        tag = head[12:16]
        if tag == b"VP8X" and len(head) >= 30:
            return "webp", 1 + int.from_bytes(head[24:27], "little"), 1 + int.from_bytes(head[27:30], "little"), bool(head[20] & 0x02)
        if tag == b"VP8L" and len(head) >= 25 and head[20] == 0x2F:
            bits = int.from_bytes(head[21:25], "little")
            return "webp", (bits & 0x3FFF) + 1, ((bits >> 14) & 0x3FFF) + 1, False
        if tag == b"VP8 " and len(head) >= 30 and head[23:26] == b"\x9d\x01\x2a":
            return "webp", int.from_bytes(head[26:28], "little") & 0x3FFF, int.from_bytes(head[28:30], "little") & 0x3FFF, False
        return "webp", None, None, False
    return None, None, None, False


def inspect_image(path) -> dict:
    """Is this file a real, still, reasonably sized picture? Judged by its own bytes, never by its name. {ok, name, problem, kind, width, height, bytes, sha256, id}."""
    p = Path(path)
    out = {"ok": False, "name": p.name, "problem": ""}
    if p.suffix.lower() not in IMAGE_EXTS:
        out["problem"] = f"{p.name} is not a picture type this tool reads (png, jpg or webp)."
        return out
    try:
        size = p.stat().st_size
        with open(p, "rb") as fh:
            head = fh.read(1 << 20)
    except OSError:
        out["problem"] = f"{p.name} could not be read."
        return out
    if size > MAX_IMAGE_BYTES:
        out["problem"] = f"{p.name} is larger than {MAX_IMAGE_BYTES // 1_000_000} MB."
        return out
    kind, w, h, anim = _sniff_image(head)
    want = {".png": "png", ".jpg": "jpeg", ".jpeg": "jpeg", ".webp": "webp"}[p.suffix.lower()]
    if kind is None:
        out["problem"] = f"{p.name} does not look like a real picture (its first bytes are something else)."
    elif kind != want:
        out["problem"] = f"{p.name} is named like a {want.upper()} picture but is really a {kind.upper()} one; rename it or save it again."
    elif anim:
        out["problem"] = f"{p.name} is an animated picture; use a single still picture."
    elif not w or not h:
        out["problem"] = f"The size of {p.name} could not be read, so it cannot be used."
    elif w * h > MAX_IMAGE_PIXELS:
        out["problem"] = f"{p.name} has more than {MAX_IMAGE_PIXELS // 1_000_000} million pixels ({w} x {h}); use a smaller copy."
    if out["problem"]:
        return out
    hs = hashlib.sha256()
    with open(p, "rb") as fh:
        for blk in iter(lambda: fh.read(1 << 20), b""):
            hs.update(blk)
    out.update(ok=True, kind=kind, width=w, height=h, bytes=size, sha256=hs.hexdigest(), id="img-" + hs.hexdigest()[:8])
    return out


def pick_images() -> list[str]:
    """The operating system's own file window for pictures (own process, as for videos)."""
    code = ("import tkinter as tk\nfrom tkinter import filedialog\nr = tk.Tk(); r.withdraw(); r.attributes('-topmost', True)\n"
            "res = filedialog.askopenfilenames(title='Choose pictures', filetypes=[('Pictures', '*.png *.jpg *.jpeg *.webp')])\n"
            "import json; print(json.dumps(list(res)))")
    r = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, encoding="utf-8", timeout=600)
    try:
        return json.loads(r.stdout.strip().splitlines()[-1])
    except Exception:  # noqa: BLE001
        return []


def _words(text) -> list[str]:
    return re.findall(r"[a-z0-9']+", str(text or "").lower().replace("’", "'"))


def clean_rule(r, images: dict) -> dict:
    """One rule as the person typed it, or a sentence for the person. Needs a real picture the person has ticked the rights box for."""
    if not isinstance(r, dict):
        raise Problem("A rule is not in the right form.")
    phrase = " ".join(str(r.get("phrase") or "").split())[:RULE_LIMITS["phrase_chars"]]
    if not _words(phrase):
        raise Problem("Type the word or short phrase the rule listens for.")
    img = images.get(str(r.get("image_id")))
    if not img:
        raise Problem("Choose one of the pictures you added.")
    if not img.get("rights"):
        raise Problem(f"Tick “I have the right to use this picture” for {img['name']} first.")
    try:
        seconds, fade = float(r.get("seconds", 2.0)), float(r.get("fade_s", 0.2))
    except (TypeError, ValueError):
        raise Problem("The seconds and the fade must be numbers.") from None
    lo, hi = RULE_LIMITS["seconds"]
    if not lo <= seconds <= hi:
        raise Problem(f"Show a picture for between {lo:g} and {hi:g} seconds.")
    lo, hi = RULE_LIMITS["fade_s"]
    if not lo <= fade <= hi or fade * 2 > seconds:
        raise Problem(f"The fade must be between {lo:g} and {hi:g} seconds and at most half of the time the picture is shown.")
    mode = str(r.get("mode") or "full")
    if mode not in RULE_MODES:
        raise Problem("Choose where the picture goes from the list.")
    return {"phrase": phrase, "image_id": img["id"], "seconds": round(seconds, 2), "mode": mode, "fade_s": round(fade, 2)}


def find_occurrences(plan: dict | None, phrase: str, pad_ms: int = 0) -> list[dict]:
    """Where the phrase is said in the BUILT film, from the plan's clips (their words and lengths). APPROXIMATE until ENGINE reports word times: the words of a clip are spread evenly over
    its length. A phrase may run across two clips. Returns [{at_s, approximate}]."""
    want = _words(phrase)
    if not plan or not want:
        return []
    flat, t = [], 0.0                                           # (word, time the word starts in the film)
    for c in plan.get("clips", []):
        ws = _words(c.get("words"))
        dur = (c.get("duration_ms") or 0) / 1000.0
        for k, w in enumerate(ws):
            flat.append((w, t + pad_ms / 1000.0 + dur * k / max(1, len(ws))))
        t += dur + 2 * pad_ms / 1000.0
    seq = [w for w, _ in flat]
    return [{"at_s": round(flat[i][1], 2), "approximate": True} for i in range(len(seq) - len(want) + 1) if seq[i:i + len(want)] == want]


def images_view() -> list[dict]:
    return [{"id": i["id"], "name": i["name"], "width": i["width"], "height": i["height"], "bytes": i["bytes"], "rights": bool(i.get("rights"))} for i in STATE["images"].values()]


def overlays_view() -> dict:
    plan = STATE.get("last_plan")
    pad = 0
    occ, warn = [], []
    for k, r in enumerate(STATE["rules"]):
        hits = find_occurrences(plan, r["phrase"], pad)
        occ.append({"rule": k, "at_s": [h["at_s"] for h in hits], "approximate": all(h["approximate"] for h in hits)})
        if plan and not hits:
            warn.append(f"“{r['phrase']}” is not said in the film the plan found, so this rule would never show its picture.")
    if STATE["rules"] and not plan:
        warn.append("Press Plan to see where each rule would show its picture.")
    return {"images": images_view(), "rules": list(STATE["rules"]), "occurrences": occ, "warnings": warn}


def write_overlays() -> None:
    """The stub interface for ENGINE: overlays.json in the work folder (paths stay on this computer; a receipt names pictures by name and hash only)."""
    ov = overlays_view()
    doc = {"schema": OVERLAYS_SCHEMA, "saved": time.strftime("%Y-%m-%d %H:%M:%S"),
           "images": [{"id": i["id"], "file_name": i["name"], "path": i["path"], "sha256": i["sha256"], "width": i["width"], "height": i["height"], "bytes": i["bytes"], "rights_ticked": bool(i.get("rights"))}
                      for i in STATE["images"].values()],
           "rules": STATE["rules"], "occurrences": ov["occurrences"]}
    STATE["work"].mkdir(parents=True, exist_ok=True)
    (STATE["work"] / "overlays.json").write_text(json.dumps(doc, indent=1), encoding="utf-8")


def _add_images(paths) -> dict:
    added, refused = 0, []
    for pth in paths:
        if len(STATE["images"]) >= RULE_LIMITS["images"]:
            refused.append({"name": Path(pth).name, "problem": f"At most {RULE_LIMITS['images']} pictures at a time."})
            continue
        res = inspect_image(pth)
        if not res["ok"]:
            refused.append({"name": res["name"], "problem": res["problem"]})
            act("image_refused")
            continue
        if res["id"] not in STATE["images"]:
            STATE["images"][res["id"]] = {**res, "path": str(Path(pth).resolve()), "rights": False}
            added += 1
    if added:
        act("image_added", count=added)
        remember_dirs([i["path"] for i in STATE["images"].values()])
    return {**overlays_view(), "refused": refused}


def v2_post(path: str, body: dict) -> dict:
    if path == "/api/image/pick":
        return _add_images(pick_images())
    if path == "/api/image/locate":
        found = locate(body.get("name"), body.get("size"), body.get("mtime_ms"), exts=IMAGE_EXTS)
        if len(found["matches"]) == 1:
            return _add_images(found["matches"])
        why = "More than one file looks like that one; use Add a picture instead." if found["matches"] else "I could not find where that file is on this computer; use Add a picture instead."
        return {**overlays_view(), "refused": [{"name": Path(str(body.get("name") or "file")).name, "problem": why}]}
    if path == "/api/image/rights":
        img = STATE["images"].get(str(body.get("id")))
        if not img:
            raise Problem("That picture is not in the list.")
        img["rights"] = bool(body.get("ok"))
        act("image_rights", ok=img["rights"])
        if not img["rights"]:
            STATE["rules"] = [r for r in STATE["rules"] if r["image_id"] != img["id"]]
        write_overlays()
        return overlays_view()
    if path == "/api/image/remove":
        img = STATE["images"].pop(str(body.get("id")), None)
        if img:
            STATE["rules"] = [r for r in STATE["rules"] if r["image_id"] != img["id"]]
            act("image_removed")
            write_overlays()
        return overlays_view()
    if path == "/api/overlays":
        rules = body.get("rules")
        if not isinstance(rules, list) or len(rules) > RULE_LIMITS["rules"]:
            raise Problem(f"At most {RULE_LIMITS['rules']} rules.")
        STATE["rules"] = [clean_rule(r, STATE["images"]) for r in rules]
        ov = overlays_view()
        act("rule_saved", count=len(STATE["rules"]))
        act("occurrences_listed", count=sum(len(o["at_s"]) for o in ov["occurrences"]))
        write_overlays()
        return ov
    raise Problem("Not found.")


V2_HTML = """<section id="v2" aria-labelledby="h-v2"><h2 id="h-v2">4. Pictures to show when a word is said (test feature)</h2>
<p class="note" id="v2-note">Test feature: your pictures and rules are saved and checked here, but this test version does not draw them into the film yet.</p>
<div class="row"><button id="v2-add" type="button" class="button secondary">Add a picture&hellip;</button></div>
<p class="note" id="v2-dropnote">Or drag a picture file onto this box. Pictures: png, jpg or webp, one still picture each (not animated).</p>
<ul id="v2-images"></ul><p id="v2-refused" class="problems" role="alert"></p>
<h3>A rule</h3>
<label for="v2-phrase">Every time this is said</label><input id="v2-phrase" type="text" maxlength="200" autocomplete="off" spellcheck="false">
<label for="v2-image">show this picture</label><select id="v2-image"></select>
<label for="v2-seconds">for this many seconds</label><input id="v2-seconds" type="number" min="0.5" max="10" step="0.5" value="2">
<label for="v2-mode">placed</label><select id="v2-mode"><option value="full">Full frame</option><option value="centre">Centre</option><option value="corner">Corner</option><option value="lower_third">Lower third</option></select>
<label for="v2-fade">fading in and out over this many seconds</label><input id="v2-fade" type="number" min="0" max="1" step="0.1" value="0.2">
<div class="actions"><button id="v2-rule" type="button" class="button secondary">Add this rule</button></div>
<p id="v2-ruleerr" class="problems" role="alert"></p><ul id="v2-rules"></ul><div id="v2-occ" role="status"></div></section>
"""


SONG_LINK = '<p><a id="song-link" class="button secondary" href="/song">Sing a line to your music</a></p>'
EDIT_LINK = '<p><a id="edit-link" class="button secondary" href="/edit">Edit your film (after Plan)</a></p>'


def _edit_mod():
    """tools/maker_edit.py when the maker was started with --edit, else None (the routes then do not exist)."""
    if not STATE.get("edit_on"):
        return None
    import maker_edit  # noqa: PLC0415
    return maker_edit


def _song_mod():
    """tools/maker_song.py when the maker was started with --song, else None (the routes then do not exist)."""
    if not STATE.get("song_on"):
        return None
    import maker_song  # noqa: PLC0415
    return maker_song


def page_html() -> str:
    return PAGE.replace("<!--V2-->", V2_HTML if STATE.get("v2") else "").replace("<!--SONG-->", (SONG_LINK if STATE.get("song_on") else "") + (EDIT_LINK if STATE.get("edit_on") else ""))


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


def pick_folder_path() -> str | None:
    """The operating system's own dialog for ONE folder of videos (own process: tkinter must own its thread). Returns a path on this computer, or None. The check replaces only this function."""
    code = ("import tkinter as tk\nfrom tkinter import filedialog\nr = tk.Tk(); r.withdraw(); r.attributes('-topmost', True)\n"
            "res = filedialog.askdirectory(title='Choose a folder of videos', mustexist=True)\nimport json; print(json.dumps(res or ''))")
    r = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, encoding="utf-8", timeout=600)
    try:
        return json.loads(r.stdout.strip().splitlines()[-1]) or None
    except Exception:  # noqa: BLE001
        return None


def folder_answer(got: str) -> dict:
    """What the page is told about a chosen folder: the engine's own rules say which videos are used (any depth, a fixed order, at most its cap), in its own plain sentence."""
    E = STATE["E"]
    if not hasattr(E, "expand_folder"):
        raise Problem("This copy of Ryagram cannot read a whole folder yet. Choose the videos one by one.")
    try:
        _files, info = E.expand_folder("slot", Path(got))
    except E.Refused as e:
        raise Problem(str(e)) from None
    remember_dirs([Path(got) / "x"])
    return {"folder": str(Path(got)), "found": info["found"], "used": info["used"], "message": info["message"]}


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
ENDPOINTS = ("check", "plan", "build", "cancel", "sound", "pick-folder", "open-folder", "answers", "pick", "locate", "paste", "event", "log", "signin", "signin-start", "signin-poll", "signin-cancel", "signin-check", "signin-remove", "rights", "remove", "overlays", "node", "node-switch", "model-download", "model-cancel")
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
    "model": _one_of(*[n for n, _l, _s in PLAIN_MODELS]), "recipe": lambda v: isinstance(v, str) and re.fullmatch(r"[a-z0-9][a-z0-9-]{0,30}", v) is not None, "multiple": lambda v: isinstance(v, bool),
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
    "problem_shown": ("endpoint",), "error_shown": ("endpoint", "exception"), "log_off": (), "log_on": (), "log_full": (), "words_skipped": ("count",),
    "signin_started": (), "signin_done": (), "signin_ended": (), "signin_removed": (),
    "model_download_started": ("model",), "model_download_done": ("model",), "model_download_failed": ("model",), "model_download_cancelled": ("model",),
    "node_on": (), "node_off": (), "node_job_done": (), "node_job_failed": (), "node_job_refused": (),
    "image_added": ("count",), "image_refused": (), "image_rights": ("ok",), "image_removed": (), "rule_saved": ("count",), "occurrences_listed": ("count",),
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
<!--SONG-->
<section class="logbox" aria-labelledby="h-log"><h2 id="h-log">A note about a small log</h2>
<p id="log-notice">This kit keeps a short activity log on this computer, in <code id="log-path">(loading)</code>, to help Ryan make it better. It records which buttons you press and when, how long things took, and counts. It never records file names, the words you type, your answers, or anything from your videos. Nothing is sent anywhere. You can delete the file at any time, or untick the box below to stop it.</p>
<label class="logswitch" for="log-on"><input id="log-on" type="checkbox" checked> Keep this log</label><p id="log-state" class="note" role="status"></p></section>
<section class="logbox" id="signin" aria-labelledby="h-signin" hidden><h2 id="h-signin">Your Ryagram account</h2><div id="signin-body"></div><p id="signin-msg" class="note" role="status"></p></section>
<section class="logbox" id="node" aria-labelledby="h-node" hidden><h2 id="h-node">This computer renders my site films</h2>
<p id="node-what">While this is on, this computer checks the Ryagram site about every half minute for a film you ordered there, makes it here, and sends back only the finished film. Your own videos never leave this computer, and it uses no credits.</p>
<label class="logswitch" for="node-on"><input id="node-on" type="checkbox"> Let this computer make my site films</label>
<p id="node-state" class="note" role="status"></p><ul id="node-uploads"></ul></section>
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
<label for="model">How carefully to listen</label><select id="model"></select>
<p class="note" id="model-hint">Balanced works for most videos. Pick Fast for a quick try.</p>
<div id="model-dl" hidden><p class="note" id="model-dl-note"></p>
<div class="row"><button id="model-dl-go" type="button" class="button primary">Download the listening model</button><button id="model-dl-stop" type="button" class="button secondary" hidden>Cancel</button></div>
<progress id="model-dl-bar" max="100" value="0" hidden aria-label="Download progress"></progress>
<p class="note" id="model-dl-status" role="status"></p></div></section>
<section aria-labelledby="h-plan"><h2 id="h-plan">3. Plan, then Build</h2>
<div class="actions"><button id="plan" type="button" class="button secondary" aria-describedby="why">Plan</button><button id="build" type="button" class="button primary" aria-describedby="why" disabled>Build</button><button id="cancel" type="button" class="button secondary" hidden>Cancel</button></div>
<p id="why" class="note">Build turns on after a Plan says the files are ready.</p>
<p id="job-status" class="sr-only" role="status"></p>
<div id="plan-out"></div>
<div id="job-out"></div>
<div id="sound-out"></div>
<div id="results"></div></section>
<!--V2-->
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
a{color:var(--brand);text-underline-offset:.15em}
.code{display:inline-block;font:700 1.6rem/1.2 ui-monospace,Consolas,monospace;letter-spacing:.12em;background:var(--soft);border:1px solid var(--line);padding:.35em .6em;border-radius:8px;margin:.2em 0}
@media(max-width:600px){main{padding:12px}}
"""

JS = r"""(function () {
  'use strict';
  const T = new URLSearchParams(location.search).get('t') || sessionStorage.getItem('maker-token') || '';
  try { sessionStorage.setItem('maker-token', T); } catch (e) { /* the page still works without it */ }
  const $ = id => document.getElementById(id);
  if ($('song-link')) $('song-link').href = '/song?t=' + encodeURIComponent(T);
  if ($('edit-link')) $('edit-link').href = '/edit?t=' + encodeURIComponent(T);
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
  // ---- r9: Sign in to Ryagram (shown only when the server was started with a site address). No password is typed here; the token never reaches this page.
  let siTimer = null;
  const siMsg = t => { $('signin-msg').textContent = t || ''; };
  async function siCall(name, btn) {
    if (btn) btn.disabled = true;
    try { const r = await api('/api/signin-' + name, {}); drawSignin(r); if (r.message) siMsg(r.message); }
    catch (e) { siMsg(e.message); if (btn) btn.disabled = false; }
  }
  function drawSignin(st) {
    const box = $('signin'), body = $('signin-body');
    clearTimeout(siTimer);
    if (!st || !st.enabled) { box.hidden = true; return; }
    box.hidden = false;
    document.querySelector('.banner').replaceChildren(el('strong', {}, 'INTERNAL PROTOTYPE.'), ' Runs on this computer only. Your videos are never uploaded. Signing in only tells the Ryagram website that this computer is yours.');
    siMsg('');
    if (st.state !== 'signed_in') drawNode(null); else refreshNode();
    if (st.state === 'unavailable') { body.replaceChildren(el('p', { class: 'problems', role: 'alert' }, st.message)); return; }
    if (st.state === 'waiting') {
      body.replaceChildren(el('p', {}, 'On the Ryagram website, check that the code is this one, then press Approve:'), el('p', { class: 'code', id: 'signin-code', 'aria-label': 'Your code: ' + st.user_code.split('').join(' ') }, st.user_code),
        el('p', {}, el('a', { id: 'signin-open', href: st.open_url, target: '_blank', rel: 'noopener noreferrer' }, 'Open the approval page on the Ryagram website')),
        el('p', { class: 'note' }, `Only approve a code you can see on THIS screen right now. It ends in about ${Math.max(1, Math.round(st.seconds_left / 60))} minute${Math.round(st.seconds_left / 60) === 1 ? '' : 's'}.`),
        el('button', { type: 'button', id: 'signin-cancel', class: 'button secondary', onclick: ev => siCall('cancel', ev.currentTarget) }, 'Cancel'));
      siTimer = setTimeout(() => siCall('poll'), Math.max(1, st.interval || 5) * 1000);
      return;
    }
    if (st.state === 'signed_in') {
      const fmtDate = s => { const d = new Date(s + 'T12:00:00'); return isNaN(d.getTime()) ? s : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); };
      const ago = n => n <= 0 ? 'today' : n === 1 ? 'yesterday' : `${n} days ago`;
      body.replaceChildren(...[el('p', { id: 'signin-who' }, `Signed in as ${st.email || '(your account)'}. This computer is called \u201c${st.computer_name}\u201d. Works until ${st.approved_until ? fmtDate(st.approved_until) : '(unknown)'}.`),
        el('p', { class: 'note', id: 'signin-checked' }, st.days_since_check != null ? `Last checked ${ago(st.days_since_check)}. Site features on this computer pause after 7 days without a check; your own clip films never do.` : 'Not checked yet.'),
        st.note ? el('p', { class: st.paused ? 'warn' : 'note', role: 'status', id: 'signin-note' }, st.note) : null,
        el('div', { class: 'row' }, el('button', { type: 'button', id: 'signin-check', class: 'button secondary', onclick: ev => siCall('check', ev.currentTarget) }, 'Check my account'),
          el('button', { type: 'button', id: 'signin-remove', class: 'button secondary', onclick: ev => siCall('remove', ev.currentTarget) }, 'Remove from this computer')),
        el('p', { class: 'note', id: 'signin-kept' }, 'Your sign-in is kept on this computer in Windows, under your account, not in a file. Programs you run can read it, the same as a browser\u2019s saved sign-ins. You can remove it any time.')].filter(Boolean));
      return;
    }
    body.replaceChildren(el('p', {}, 'Sign in to link this computer to your Ryagram account. That is how the website can send your site films to be made on this computer, if your account allows it. Your own videos never leave this computer. You do not type a password here: the website shows you a short code to check, and you approve this computer there.'),
      el('button', { type: 'button', id: 'signin-start', class: 'button primary', onclick: ev => siCall('start', ev.currentTarget) }, 'Sign in to Ryagram'));
  }
  // ---- r9 M4: the switch for "this computer renders my site films" (only for a signed-in account that the site says may; off until the person turns it on)
  let nodeTimer = null;
  function drawNode(n) {
    clearTimeout(nodeTimer);
    const box = $('node');
    if (!n || !n.enabled || !n.allowed && n.phase !== 'paused') { box.hidden = true; return; }
    const g = n.message || '';
    box.hidden = false;
    $('node-on').checked = !!n.on;
    $('node-state').textContent = (!n.on ? 'It is off. Nothing is being checked.' : (g || 'Waiting for a film to make.')) + (n.last ? ' ' + n.last : '');
    $('node-uploads').replaceChildren(...(n.uploads || []).map(u => el('li', {}, `${u.name} (${Math.max(1, Math.round(u.bytes / 1024))} KB)`)));
    if (n.on) nodeTimer = setTimeout(refreshNode, 5000);
  }
  async function refreshNode() { try { drawNode(await api('/api/node')); } catch (e) { /* the card keeps what it had */ } }
  $('node-on').addEventListener('change', async ev2 => {
    const box = ev2.currentTarget; box.disabled = true;
    try { drawNode(await api('/api/node-switch', { on: box.checked })); } catch (e) { $('node-state').textContent = e.message; box.checked = !box.checked; } finally { box.disabled = false; }
  });
  api('/api/signin').then(r => { drawSignin(r); refreshNode(); }).catch(() => {});
  let modelChoices = [], dlLast = { state: 'idle', can: false }, dlTimer = null;
  function drawDl(d) {
    dlLast = d;
    const c = modelChoices.find(x => x.name === $('model').value);
    const running = d.state === 'running';
    const show = d.can && c && (c.ready === false || running || d.state === 'failed');
    $('model-dl').hidden = !show;
    if (!show) return;
    $('model-dl-note').textContent = `This downloads the ${c.label} listening model once (about ${c.mb} MB) from ${d.host}. Nothing of yours is sent, and every file is checked before it is kept.`;
    $('model-dl-go').disabled = running; $('model-dl-stop').hidden = !running; $('model-dl-bar').hidden = !running;
    if (running) {
      $('model-dl-bar').value = d.total ? Math.round(100 * d.done / d.total) : 0;
      $('model-dl-status').textContent = `${Math.round(d.done / 1048576)} of ${Math.round(d.total / 1048576)} MB`;
    } else { $('model-dl-status').textContent = d.state === 'failed' || d.state === 'cancelled' ? d.message : ''; }
  }
  async function dlPoll(was) {
    clearTimeout(dlTimer);
    try {
      const d = await api('/api/model-download');
      if (was === 'running' && d.state === 'done') { say(d.message); await loadModels(); return; }
      drawDl(d);
      if (d.state === 'running') dlTimer = setTimeout(() => dlPoll('running'), 700);
    } catch (e) { /* the card keeps what it had */ }
  }
  $('model-dl-go').addEventListener('click', async () => {
    $('model-dl-go').disabled = true;
    try { drawDl(await api('/api/model-download', { model: $('model').value })); dlPoll('running'); } catch (e) { $('model-dl-status').textContent = e.message; $('model-dl-go').disabled = false; }
  });
  $('model-dl-stop').addEventListener('click', async () => { try { await api('/api/model-cancel', {}); } catch (e) { /* the next poll shows the end */ } });
  async function loadModels() {
    try {
      const r = await api('/api/models');
      modelChoices = r.choices;
      $('model').replaceChildren(...r.choices.map(c => el('option', { value: c.name }, c.label + (c.ready === false ? ` \u2013 not downloaded yet (about ${c.mb} MB)` : c.ready ? ' \u2013 ready' : ` \u2013 about ${c.mb} MB, downloaded once`))));
      $('model').value = r.default; $('model-hint').textContent = r.hint;
      dlPoll();
    } catch (e) { /* the page still works; the server then uses its own default */ }
  }
  const WORDS_NOTE = $('words-note').textContent;
  let recipes = [], current = null, binds = {}, folderNotes = {}, planned = false, poll = null, lastState = '', lastWait = '', builtWords = '', eff = null, skippedNow = [], autoTried = false;
  const say = text => { $('job-status').textContent = ''; setTimeout(() => { $('job-status').textContent = text; }, 50); };      // the quiet status line a screen reader announces once
  const why = text => { $('why').textContent = text; };
  const fresh = keep => { if (!keep) { eff = null; skippedNow = []; } planned = false; soundFor = ''; $('sound-out').replaceChildren(); $('build').disabled = true; why('Build turns on after a Plan says the files are ready.'); $('plan-out').replaceChildren(); };
  function drawSlots() {
    const box = $('slots'); box.replaceChildren();
    if (!current) return;
    for (const s of current.slots) {
      const files = binds[s.id] || [];
      const dropNote = el('p', { class: 'note drop-note' });
      const zone = el('div', { class: 'slot', role: 'group', 'aria-label': `${s.label}: you can drop a video file here` }, el('h3', {}, s.label), el('p', { class: 'note' }, (s.multiple ? 'One or more video files.' : 'One video file.') + ' Drag a video file here from a folder window, or press Choose a file.'), dropNote,
        files.length ? el('ul', {}, files.map(f => el('li', {}, f))) : el('p', { class: 'note' }, 'No file chosen yet.'),
        folderNotes[s.id] ? el('p', { class: 'note', role: 'status' }, folderNotes[s.id]) : null,
        el('div', { class: 'row' }, el('button', { type: 'button', class: 'button secondary', 'aria-label': `Choose a file for ${s.label}`, onclick: async ev => {
          const btn = ev.currentTarget; btn.disabled = true;      // (currentTarget is gone after an await, so keep the button)
          try { const r = await api('/api/pick', { multiple: s.multiple }); if (r.files.length) { binds[s.id] = s.multiple ? (binds[s.id] || []).concat(r.files) : r.files.slice(0, 1); fresh(); drawSlots(); } }
          catch (e) { $('recipe-note').textContent = e.message; } finally { btn.disabled = false; }
        } }, files.length ? 'Add or change' : 'Choose a file\u2026'),
        s.multiple ? el('button', { type: 'button', class: 'button secondary', 'aria-label': `Choose a whole folder of videos for ${s.label}`, onclick: async ev => {
          const btn = ev.currentTarget; btn.disabled = true;
          try { const r = await api('/api/pick-folder', {}); if (r.folder) { binds[s.id] = (binds[s.id] || []).concat([r.folder]); folderNotes[s.id] = r.message; fresh(); drawSlots(); } }
          catch (e) { $('recipe-note').textContent = e.message; } finally { btn.disabled = false; }
        } }, 'Choose a folder\u2026') : null,
        files.length ? el('button', { type: 'button', class: 'button secondary', 'aria-label': `Clear the files for ${s.label}`, onclick: () => { binds[s.id] = []; delete folderNotes[s.id]; fresh(); drawSlots(); ev('slot_cleared'); } }, 'Clear') : null));
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
    $('words-note').textContent = current && current.op === 'every' ? 'Type one word or a short phrase. The film shows EVERY time it is said in your videos, one after another.' : WORDS_NOTE;
    drawSlots();
  }
  $('recipe').addEventListener('change', () => { drawRecipe(); ev('recipe_changed', { recipe: $('recipe').value.replace(/\.json$/i, '') }); });
  $('model').addEventListener('change', () => { fresh(); drawDl(dlLast); ev('model_changed', { model: $('model').value }); });
  $('words').addEventListener('input', fresh);
  $('words').addEventListener('change', () => ev('words_edited', { chars: $('words').value.length }));
  // what the engine is asked: the words go along only when they differ from the recipe file's own
  const reqBody = () => { const w = $('words').value.replace(/\s+/g, ' ').trim(); const b = { recipe: current.file, binds, model: $('model').value }; if (w && w !== current.find) b.phrase = w; if (eff) { b.typed = b.phrase || current.find; b.phrase = eff; b.skipped = skippedNow; } return b; };
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
        el('dd', {}, p.slots.map(s => el('div', {}, `${s.label}: `, s.files.map(f => `${f.name} (${f.mb < 1 ? 'under 1 MB' : f.mb + ' MB'})`).join('; ')))), el('dt', {}, 'How carefully it listens'), el('dd', {}, p.model_label || p.model), el('dt', {}, 'How long the listening takes'), el('dd', {}, p.listen_words),
        el('dt', {}, 'Network'), el('dd', {}, p.network), el('dt', {}, 'Room on the work drive'), el('dd', {}, `${p.free_gb} GB free`)));
  }
  $('plan').addEventListener('click', () => runPlan(false));
  async function runPlan(auto) {
    if (!auto) { eff = null; skippedNow = []; autoTried = false; }
    if (!current) { $('plan-out').replaceChildren(el('p', { class: 'problems', role: 'alert' }, 'Choose a recipe first.')); return; }
    if (current.has_find && !$('words').value.replace(/\s+/g, ' ').trim()) { $('plan-out').replaceChildren(el('p', { class: 'problems', role: 'alert' }, 'Type a short phrase one of your videos really says.')); return; }
    const btn = $('plan'); btn.disabled = true;
    try {
      const body = reqBody();
      const c = await api('/api/check', body);
      if (!c.ok) { fresh(true); $('plan-out').replaceChildren(el('div', { class: 'panel' }, el('p', { role: 'alert' }, 'Not ready yet:'), el('ul', { class: 'problems' }, c.problems.map(x => el('li', {}, x))))); return; }
      fresh(true); $('job-out').replaceChildren(); lastWait = c.listen_words || '';
      $('plan-out').replaceChildren(summary(c), el('p', { class: 'note' }, 'Now the plan listens to your files and says what it would build. It writes no film. It keeps the words it hears, so Build does not listen again.'));
      await api('/api/plan', body); poll = setInterval(watch, 1200); watch();
    } catch (e) { $('plan-out').replaceChildren(el('p', { class: 'problems', role: 'alert' }, e.message)); }
    finally { if (!poll) btn.disabled = false; }
  }
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
    if (j.state === 'gaps' && j.skip_phrase && !autoTried) {              // never a dead end: plan again without the words nobody says
      autoTried = true; eff = j.skip_phrase; skippedNow = j.plan.gaps.slice();
      if (poll) { clearInterval(poll); poll = null; }
      say(`Nobody says ${skippedNow.join(', ')} in your videos, so I am planning the film without ${skippedNow.length === 1 ? 'it' : 'them'}.`);
      runPlan(true);
      return;
    }
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
      if (j.state === 'planned' && j.meaning_risk && j.meaning_risk.length) parts.unshift(el('p', { class: 'problems', role: 'alert', id: 'meaning-risk' }, `This changes what is said: ${j.meaning_risk.map(w => '\u201c' + w + '\u201d').join(', ')} ${j.meaning_risk.length === 1 ? 'is' : 'are'} missing from your videos, so the film will not say what you typed. Check your words above before you make the film.`));
      if (a.clips.length) parts.push(el('p', {}, `It would cut ${a.clips.length} clip${a.clips.length === 1 ? '' : 's'}, about ${a.seconds_estimate} s:`),
        el('ol', {}, a.clips.map(c => el('li', {}, `\u201c${c.words}\u201d from ${c.file_name}, ${(c.start_ms / 1000).toFixed(2)} to ${(c.end_ms / 1000).toFixed(2)} s`))));
      if (a.cut_off) parts.push(el('p', { class: 'warn', role: 'status', id: 'cut-off-note' }, `The words are said ${a.found} times. This film holds the first ${a.clips.length}; ${a.cut_off} more are not in it.`));
      if (a.gaps.length) parts.push(el('p', { class: 'problems', role: 'alert' }, `Nobody says these words in the videos you chose: ${a.gaps.join(', ')}. Try different words above, or add more videos.`));
      const miss = skippedNow.length ? skippedNow : (Array.isArray(a.skipped) ? a.skipped.map(x => typeof x === 'string' ? x : (x && x.word) || '').filter(Boolean) : []);
      if (j.state === 'planned' && miss.length) parts.push(el('p', { class: 'warn', role: 'status', id: 'skipped-note' }, `Left out, because nobody says ${miss.length === 1 ? 'it' : 'them'} in your videos: ${miss.join(', ')}. The film will be made without ${miss.length === 1 ? 'it' : 'them'}.`));
    }
    if (j.state === 'built' && j.meaning_risk && j.meaning_risk.length) parts.unshift(el('p', { class: 'problems', role: 'alert', id: 'meaning-risk-built' }, `This film does not say what you typed: ${j.meaning_risk.map(w => '\u201c' + w + '\u201d').join(', ')} had to be left out, which changes the meaning.`));
    if (j.state === 'built' && j.receipt && j.receipt.cut_off) parts.push(el('p', { class: 'warn', id: 'cut-off-built' }, `The words are said ${j.receipt.found} times. This film holds the first ${j.receipt.clips.length}; ${j.receipt.cut_off} more are not in it.`));
    if (j.state === 'built' && j.skipped && j.skipped.length) parts.push(el('p', { class: 'warn', id: 'skipped-built' }, `Left out, because nobody says ${j.skipped.length === 1 ? 'it' : 'them'} in your videos: ${j.skipped.join(', ')}. A note listing ${j.skipped.length === 1 ? 'it' : 'them'} is saved next to the film.`));
    if (j.state === 'built' && j.receipt && j.receipt.seconds < 5 && current && current.op !== 'every') parts.push(el('p', { class: 'note', id: 'short-film' }, `The film looks for the words \u201c${builtWords || current.find}\u201d and uses them once, so it is short (${j.receipt.seconds.toFixed(1)} s). For a longer film, type a longer sentence in the box above (or put it in the recipe).`));
    if (j.state === 'built') parts.push(el('p', {}, `Your film: ${j.path}`), j.receipt ? el('p', { class: 'note' }, `${j.receipt.clips.length} clip(s), ${j.receipt.seconds.toFixed(1)} s. Nothing went online (${j.receipt.network_attempts} connections). A list of where each word came from is saved beside the film.`) : null);
    if (j.next && !running) parts.push(el('p', {}, el('strong', {}, 'Next: '), j.next));
    if (j.state === 'stopped') parts.push(el('p', { class: 'note' }, 'Something stopped it. Press Plan again. If it stops again, copy the text above and send it to Ryan.'));
    if (j.lines && j.lines.length && (running || j.state === 'stopped')) parts.push(el('div', { class: 'log', role: 'log', 'aria-label': 'What it printed' }, j.lines.join('\n')));
    $('job-out').replaceChildren(...parts);
    planned = j.state === 'planned' || (j.state === 'built' && planned);
    $('cancel').hidden = !running; $('plan').disabled = running; $('build').disabled = running || !planned;
    why(running ? 'A job is running, so Plan and Build are off until it ends. You can cancel it.' : planned ? 'The plan is ready. Press Build.' : 'Build turns on after a Plan says the files are ready.');
    if (j.state === 'planned') checkSound(reqBody());
    drawResults(j);
    if (v2 && j.state === 'planned') v2.refresh();
    if (j.state !== lastState) {                                  // announce a change once, not every poll
      lastState = j.state;
      if (running) say(j.kind === 'plan' ? ('Listening to your files. ' + lastWait).trim() : 'Building the film.');
      else if (j.state === 'planned') say(`Plan ready: ${j.plan.clips.length} clip${j.plan.clips.length === 1 ? '' : 's'}, about ${j.plan.seconds_estimate} seconds. Build is now on.`);
      else if (j.state === 'gaps') say(`Nobody says these words in your videos: ${j.plan.gaps.join(', ')}. Try different words, or add more videos.`);
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
  function makeV2() {
    const fmtKb = b => b < 1e6 ? `${Math.max(1, Math.round(b / 1000))} KB` : `${(b / 1e6).toFixed(1)} MB`;
    const clock = n => `${Math.floor(n / 60)}:${String(Math.floor(n % 60)).padStart(2, '0')}`;
    let st = { images: [], rules: [], occurrences: [], warnings: [] };
    const put = r => { st = r; draw(); const bad = (r.refused || []).map(x => x.problem).join(' '); $('v2-refused').textContent = bad; };
    const rules = () => st.rules.map(({ phrase, image_id, seconds, mode, fade_s }) => ({ phrase, image_id, seconds, mode, fade_s }));
    async function saveRules(list) { try { $('v2-ruleerr').textContent = ''; put(await api('/api/overlays', { rules: list })); } catch (e) { $('v2-ruleerr').textContent = e.message; } }
    function draw() {
      $('v2-images').replaceChildren(...st.images.map(i => el('li', {}, `${i.name} (${i.width} x ${i.height} px, ${fmtKb(i.bytes)}) `,
        el('label', { class: 'v2-right' }, el('input', { type: 'checkbox', checked: i.rights, onchange: async ev => { try { put(await api('/api/image/rights', { id: i.id, ok: ev.currentTarget.checked })); } catch (e) { $('v2-refused').textContent = e.message; } } }), ' I have the right to use this picture'),
        el('button', { type: 'button', class: 'button secondary', 'aria-label': `Remove ${i.name}`, onclick: async () => { put(await api('/api/image/remove', { id: i.id })); } }, 'Remove'))));
      const sel = $('v2-image'), keep = sel.value;
      sel.replaceChildren(...st.images.map(i => el('option', { value: i.id }, i.name)));
      if (keep) sel.value = keep;
      const modeWords = { full: 'full frame', centre: 'in the centre', corner: 'in the corner', lower_third: 'in the lower third' };
      $('v2-rules').replaceChildren(...st.rules.map((r, k) => {
        const im = st.images.find(i => i.id === r.image_id), o = (st.occurrences[k] || {}).at_s || [];
        return el('li', {}, `Every time “${r.phrase}” is said, show ${im ? im.name : 'a picture'} for ${r.seconds} s, ${modeWords[r.mode]}, fading over ${r.fade_s} s. `,
          o.length ? `Found ${o.length} time${o.length === 1 ? '' : 's'} (about ${o.map(clock).join(', ')}; approximate). ` : '',
          el('button', { type: 'button', class: 'button secondary', 'aria-label': `Remove the rule for ${r.phrase}`, onclick: () => saveRules(rules().filter((_, j) => j !== k)) }, 'Remove'));
      }));
      $('v2-occ').replaceChildren(...st.warnings.map(w => el('p', { class: 'warn' }, w)));
    }
    $('v2-add').addEventListener('click', async ev => { const b = ev.currentTarget; b.disabled = true; try { put(await api('/api/image/pick', {})); } catch (e) { $('v2-refused').textContent = e.message; } finally { b.disabled = false; } });
    $('v2-rule').addEventListener('click', () => saveRules(rules().concat([{ phrase: $('v2-phrase').value, image_id: $('v2-image').value, seconds: Number($('v2-seconds').value), mode: $('v2-mode').value, fade_s: Number($('v2-fade').value) }])));
    const box = $('v2');
    box.addEventListener('dragover', ev => ev.preventDefault());
    box.addEventListener('drop', async ev => {
      ev.preventDefault(); ev.stopPropagation();
      for (const f of [...(ev.dataTransfer && ev.dataTransfer.files ? ev.dataTransfer.files : [])]) { try { put(await api('/api/image/locate', { name: f.name, size: f.size, mtime_ms: f.lastModified })); } catch (e) { $('v2-refused').textContent = e.message; } }
    });
    api('/api/overlays').then(put).catch(() => {});
    return { refresh: () => api('/api/overlays').then(put).catch(() => {}) };
  }
  const v2 = $('v2') ? makeV2() : null;
  (async () => {
    try {
      await loadModels();
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

    def _send(self, code: int, body: bytes, ctype: str, csp: str | None = None):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Security-Policy", csp or CSP)
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
        u = urlparse(self.path)
        path = u.path
        if path.startswith(("/api/edit", "/edit")) or path == "/api/image/file":
            me = _edit_mod()
            if me is None:
                self._json(404, {"error": "Not found."})
                return
            if me.get(path, u.query, self._send, self._json, self._auth, self._host_ok, self._send_ranged):
                return
        if path.startswith(("/api/song", "/song")):
            ms = _song_mod()
            if ms is None:
                self._json(404, {"error": "Not found."})
                return
            if ms.get(path, u.query, self._send, self._json, self._auth, self._host_ok):
                return
        if path == "/":
            if self._auth(query_ok=True):
                act("page_opened")
                self._send(200, page_html().encode("utf-8"), "text/html; charset=utf-8")
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
        elif path == "/api/signin":
            if self._auth():
                self._json(200, signin_status())
        elif path == "/api/node":
            if self._auth():
                self._json(200, node_status())
        elif path == "/api/overlays":
            if not STATE.get("v2"):
                self._json(404, {"error": "Not found."})
            elif self._auth():
                self._json(200, overlays_view())
        elif path == "/api/model-download":
            if self._auth():
                self._json(200, model_dl_status())
        elif path == "/api/models":
            if self._auth():
                ch = model_choices()
                self._json(200, {"choices": ch, "default": default_model(ch), "hint": model_hint()})
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
        self._send_ranged(f)

    def _send_ranged(self, f):
        """One file, with Range so a player can seek (the film, or the edit page's preview)."""
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
            if n > (600_000 if urlparse(self.path).path.startswith(("/api/song", "/api/edit")) else 200_000):
                raise Problem("That request is too large.")
            body = json.loads(self.rfile.read(n) or b"{}")
            if not isinstance(body, dict):
                raise Problem("Bad request.")
            path = urlparse(self.path).path
            if path.startswith("/api/edit") or (path == "/api/image/pick" and STATE.get("edit_on")):
                me = _edit_mod()
                if me is None:
                    self._json(404, {"error": "Not found."})
                    return
                if me.post(path, body, self._json):
                    return
            if path.startswith("/api/song"):
                ms = _song_mod()
                if ms is None:
                    self._json(404, {"error": "Not found."})
                    return
                if ms.post(path, body, self._json):
                    return
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
            elif path.startswith("/api/image/") or path == "/api/overlays":
                if not STATE.get("v2"):
                    self._json(404, {"error": "Not found."})
                else:
                    self._json(200, v2_post(path, body))
            elif path == "/api/pick-folder":
                got = pick_folder_path()
                act("files_picked", multiple=True, count=0) if got else None
                self._json(200, folder_answer(got) if got else {"folder": None})
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
            elif path == "/api/model-download":
                self._json(200, model_dl_start(str(body.get("model") or "")))
            elif path == "/api/model-cancel":
                self._json(200, model_dl_cancel())
            elif path == "/api/node-switch":
                self._json(200, node_switch(body.get("on") is True))
            elif path in ("/api/signin-start", "/api/signin-poll", "/api/signin-cancel", "/api/signin-check", "/api/signin-remove"):
                self._json(200, signin_do(path[len("/api/signin-"):]))
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


def locate(name, size, mtime_ms, limit_s=None, exts=None) -> dict:
    """A browser page is never told where a dropped file lives (only its name, size and modified time), so find it: the folders the person's files came from first, then the usual places
    (Videos, Downloads, Desktop, Documents, or the --search folders). A match needs the same name, the same size in bytes and the same modified time (to 2 s). Only listings are read; no file is
    opened, copied or sent anywhere. Stops after SEARCH_SECONDS and says so."""
    base = Path(str(name or "")).name
    if Path(base).suffix.lower() not in (exts or STATE["E"].VIDEO_EXTS):
        raise Problem(f"{base or 'That'} is not a {'picture' if exts else 'video'} file this tool reads ({', '.join(exts or STATE['E'].VIDEO_EXTS)}).")
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
# "small" (the Balanced choice) is ESTIMATED from the base numbers above and a measured ratio, not measured on real footage: on this PC (2026-10-20, synthetic speech, real engine) the same plan took
# 2.3x as long for 1 minute of video (37.8 s against 16.5 s) and 2.4x for 4 minutes (84.4 s against 34.6 s), with about 2.6x the time per minute. So: start 90 -> 190 s, per minute 2 -> 5 s.
# "tiny" and "medium" are not measured, and say so.
LISTEN_START_SECONDS = {"base": 90, "small": 190}
LISTEN_SECONDS_PER_MINUTE = {"base": 2, "small": 5}
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
        return f"{length} of video to listen to. How long that takes has not been measured for the \u201c{model_label(model)}\u201d choice; the \u201c{model_label('base')}\u201d choice takes about {LISTEN_START_SECONDS['base']} seconds to start and then about {LISTEN_SECONDS_PER_MINUTE['base']} seconds for each minute of video."
    secs = listen_expect_s(total_s, model)
    wait = "under a minute" if secs < 60 else f"about {round(secs / 60)} minute{'' if round(secs / 60) == 1 else 's'}"
    if total_s < 300:
        wait += ", often much less"
    return f"{length} of video to listen to: expect {wait} (about {LISTEN_START_SECONDS[model]} seconds to start, then about {per} seconds for each minute of video with the \u201c{model_label(model)}\u201d choice, measured on one computer; less if you have planned these files before)."


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


def _signin_mod():
    """tools/ryagram_signin.py sits beside this file; load it only when a site was given (r9)."""
    if str(HERE) not in sys.path:
        sys.path.insert(0, str(HERE))
    import ryagram_signin
    return ryagram_signin


def _node_mod():
    if str(HERE) not in sys.path:
        sys.path.insert(0, str(HERE))
    import ryagram_node
    return ryagram_node


def node_status() -> dict:
    n = STATE.get("node")
    if n is None:
        return {"enabled": False}
    st = n.status()
    st["enabled"] = True
    return st


def node_switch(on: bool) -> dict:
    n = STATE.get("node")
    if n is None:
        raise Problem("Signing in is not turned on in this copy.")
    st = n.set_switch(bool(on))
    if on:
        n.start()
    else:
        n.stop()
    st = node_status()
    return st


def signin_status() -> dict:
    s = STATE.get("signin")
    if s is not None:
        return s.status()
    if STATE.get("signin_unavailable"):
        return {"enabled": True, "state": "unavailable", "message": STATE["signin_unavailable"]}
    return {"enabled": False}


def signin_do(what: str) -> dict:
    s = STATE.get("signin")
    if s is None:
        raise Problem(STATE.get("signin_unavailable") or "Signing in is not turned on in this copy.")
    mod = _signin_mod()
    try:
        return {"start": s.begin, "poll": s.poll, "cancel": s.cancel, "check": s.check, "remove": s.remove}[what]()
    except mod.SignInError as e:
        raise Problem(str(e)) from None


def make_server(engine: Path, recipes: Path, work: Path, out: Path, port: int = 8765, token: str | None = None, questions: Path | None = None, search: list | None = None, activity: bool = True, v2: bool = False,
                site: str | None = None, approval_hosts=(), signin_store=None, signin_transport=None, signin_clock=None, node_renderer=None, node_datasets=None, node_validate=None):
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
    STATE["v2"] = bool(v2)
    STATE["images"], STATE["rules"], STATE["last_plan"] = {}, [], None
    STATE["activity"] = ActivityLog(STATE["out"], enabled=activity and not (STATE["out"] / ACTIVITY_OFF_NAME).exists())
    STATE["signin"], STATE["signin_unavailable"] = None, ""
    if site:                                        # r9: sign in to a Ryagram account. Off (no card, no network) unless a site address is given.
        mod = _signin_mod()
        try:
            kw = {"transport": signin_transport} if signin_transport else {}
            if signin_clock:
                kw["clock"] = signin_clock
            STATE["signin"] = mod.SignIn(site, signin_store or mod.default_store(), STATE["work"], computer_name=platform.node(), approval_hosts=approval_hosts, log=lambda ev: act(ev), **kw)
        except mod.SignInError as e:
            STATE["signin_unavailable"] = str(e)
    STATE["node"] = None
    if STATE.get("signin") is not None:              # r9 M4: "this computer renders my site films". OFF until the person switches it on; no renderer yet = it takes no jobs.
        STATE["node"] = _node_mod().NodeLoop(STATE["signin"], STATE["work"], renderer=node_renderer, datasets=node_datasets, validate=node_validate, log=lambda ev: act(ev))
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


def bind_free_port(engine, recipes, work, out, first: int, questions=None, search=None, activity: bool = True, v2: bool = False, **signin):
    """Start on the asked port, or the next free one (up to 10 more), so a second start does not fail with an error screen."""
    last = None
    for port in range(first, first + 11) if first else (0,):
        try:
            return make_server(engine, recipes, work, out, port, questions=questions, search=search, activity=activity, v2=v2, **signin)
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
    ap.add_argument("--v2", action="store_true", help="TEST: show the pictures-and-rules section (images as inputs, the every-time-a-word-is-said rule); off by default")
    ap.add_argument("--song", action="store_true", help="TEST: serve the song page (a line sung to your music, words from your own videos); off by default")
    ap.add_argument("--edit", action="store_true", help="TEST: serve the edit page (reorder, trim, slides, pictures, captions, text, then render); off by default")
    ap.add_argument("--song-forge", action="store_true", help="TEST, with --song: build a word nobody says from the sounds of words your videos do say, when the alignment model is on this PC (it is never downloaded by the maker)")
    ap.add_argument("--no-activity-log", action="store_true", help="start with the local activity log turned off (the page also has a switch)")
    ap.add_argument("--open", action="store_true", help="open the page in this computer's browser once the server is ready")
    ap.add_argument("--site", default=os.environ.get("RYAGRAM_SITE", ""), help="r9, off unless given: the Ryagram site's node address (https://...), to show the Sign in card")
    ap.add_argument("--approval-host", action="append", default=[], help="a host the site may send you to, to approve this computer (repeat for more), for example uselai.com")
    a = ap.parse_args(argv)
    engine = Path(a.engine) if a.engine else find_engine()
    if not engine:
        raise SystemExit("I cannot find the Ryagram folder (it has a folder named ryagram, with a folder named local inside it). Keep this tool inside it, or start with --engine <that folder>.")
    recipes = Path(a.recipes) if a.recipes else engine / "recipes"
    if not recipes.is_dir() or not list(recipes.glob("*.json")):
        raise SystemExit(f"There are no recipe files (.json) in {recipes}. Put a recipe there, or start with --recipes <a folder that has one>.")
    try:
        srv = bind_free_port(engine, recipes, Path(a.work_dir), Path(a.out_dir), a.port, Path(a.questions) if a.questions else None, a.search or None, activity=not a.no_activity_log, site=a.site or None, approval_hosts=a.approval_host, v2=a.v2 or os.environ.get("RYAGRAM_MAKER_V2") == "1")
    except ModuleNotFoundError as e:
        raise SystemExit(f"A part of Python that the maker needs is missing ({e.name}). Most likely the speech add-on is not installed. "
                         + ADDON_STEP)
    if a.song or os.environ.get("RYAGRAM_MAKER_SONG") == "1":
        STATE["song_on"] = True
        STATE["song_forge"] = bool(a.song_forge or os.environ.get("RYAGRAM_MAKER_SONG_FORGE") == "1")
        import maker_song  # noqa: PLC0415
        maker_song.attach(sys.modules[__name__])
    if a.edit or os.environ.get("RYAGRAM_MAKER_EDIT") == "1":
        STATE["edit_on"] = True
        import maker_edit  # noqa: PLC0415
        maker_edit.attach(sys.modules[__name__])
    url = f"http://127.0.0.1:{STATE['port']}/?t={STATE['token']}"
    print("Desktop maker is running on this computer only.", flush=True)
    print(f"Open  {url}", flush=True)
    mroot = os.environ.get("RYAGRAM_MODEL_DIR")
    if mroot:
        have = models_present(mroot)
        print(f"Listening model folder: {mroot} ({'found: ' + ', '.join(model_label(m) for m in have) if have else 'no model there yet: use the Download button on the page'})", flush=True)
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
