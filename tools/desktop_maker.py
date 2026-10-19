"""Desktop maker (INTERNAL prototype, for Sam): a one-page screen on THIS computer for ENGINE's local build. Pick a recipe, see its slots, pick a local video file for each slot (or paste the
`--bind slot=FILE` lines WORKER's `library find --emit-binds` prints), press Plan to see exactly what Build would do, then Build, which runs ENGINE's CLI (`python -m ryagram.local build`).

    py tools/desktop_maker.py --engine <a Ryagram checkout that has ryagram/local> --recipes <a folder of recipe .json files> [--work-dir <folder>] [--out-dir <folder>] [--port 8765]

What it is not: no upload (the page has no file input and the server never sends or receives file bytes, only paths on this computer), no Supabase, no account, no network call of its own. The server
listens on 127.0.0.1 only; every request must carry a random token that is printed once at start-up and must name the local host (a web page on another site cannot drive it). The page and its script and style
are served by this server under a strict policy (no inline script or style, no outside connections). Plan changes nothing; Build writes the MP4 and its receipt to the out folder and everything else to the work folder.
Plan is this tool's own dry run (ENGINE's CLI has only `build` today): it uses ENGINE's own recipe check and bind check, then tests the files, so what Plan accepts is what Build will not refuse at the door.
Stdlib only. The file picker is the operating system's own dialog (tkinter), opened by the server on this computer."""
from __future__ import annotations

import argparse
import json
import os
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
EXIT_WORDS = {
    0: "Built.",
    2: "Refused: something about the recipe or the files is not right.",
    3: "Cannot build: the files do not say every word the recipe needs. Nothing was written.",
    4: "Blocked: the build tried to use the network, which it must not. Nothing was kept.",
}
STATE = {"engine": None, "recipes": None, "work": None, "out": None, "token": "", "port": 0, "job": None, "R": None, "E": None}
LOCK = threading.Lock()


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
                    "find": (rec.get("find") or {}).get("text", "")})
    return out


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
        if re.search(r"#\d+-\d+$", f) and not Path(f).is_file():
            bad.append(f"line {n}: a start-end range after the file name is not supported by the build yet (use the whole file)")
            continue
        binds.setdefault(m.group("slot"), []).append(f)
    return binds, bad


def plan(body: dict) -> dict:
    """The dry run. Returns {ok, problems[], lines[], ...}; changes nothing on disk."""
    R, E = STATE["R"], STATE["E"]
    problems: list[str] = []
    rec = None
    try:
        rec = R.parse_recipe(recipe_path(body.get("recipe")).read_bytes())
    except Problem as e:
        problems.append(str(e))
    except Exception as e:  # noqa: BLE001
        problems.append(f"The recipe is refused: {str(e)[:200]}")
    model = body.get("model") or "base"
    if model not in MODELS:
        problems.append(f"The model must be one of {', '.join(MODELS)}.")
    raw = body.get("binds") or {}
    pairs = []
    for slot, files in (raw.items() if isinstance(raw, dict) else []):
        for f in (files if isinstance(files, list) else []):
            pairs.append(f"{slot}={f}")
    binds: dict = {}
    for pair in pairs:
        try:
            for slot, files in E.parse_binds([pair]).items():
                binds.setdefault(slot, []).extend(files)
        except E.Refused as e:
            problems.append(str(e))
    lines: list[dict] = []
    if rec:
        extra = sorted(set(binds) - {s["id"] for s in rec["slots"]})
        if extra:
            problems.append("Not a slot of this recipe: " + ", ".join(extra))
        for s in rec["slots"]:
            files = binds.get(s["id"], [])
            if not files:
                problems.append(f"The slot \u201c{s['label']}\u201d has no file yet.")
            if len(files) > 1 and not s["multiple"]:
                problems.append(f"The slot \u201c{s['label']}\u201d takes one file; it has {len(files)}.")
            lines.append({"slot": s["id"], "label": s["label"], "files": [{"name": p.name, "mb": round(p.stat().st_size / 1e6, 1)} for p in files]})
    work, out = STATE["work"], STATE["out"]
    free_gb = round(shutil.disk_usage(work if work.exists() else work.parent if work.parent.exists() else Path(work.anchor)).free / 1e9, 1)
    ffmpeg = shutil.which("ffmpeg") is not None
    if not ffmpeg:
        problems.append("ffmpeg is not on this computer's PATH, and the build cuts the files with it.")
    total_mb = sum(f["mb"] for ln in lines for f in ln["files"])
    if free_gb < max(2.0, total_mb / 1000 * 1.5):
        problems.append(f"Only {free_gb} GB free where the work folder is; choose a drive with more room.")
    film = None
    if rec:
        film = re.sub(r"[^A-Za-z0-9._-]+", "-", rec["name"]).strip("-")[:60] or "film"
    return {"ok": not problems, "problems": problems, "recipe": rec["name"] if rec else None, "find": (rec.get("find") or {}).get("text", "") if rec else "", "slots": lines, "model": model, "film": f"{film}.mp4" if film else None,
            "out_dir": str(out), "work_dir": str(work), "free_gb": free_gb, "network": "none (the build has a guard that stops any network attempt)",
            "steps": ["Listen to each file with the speech model on this computer (the slowest step) and note when each word is said.",
                      "Find the recipe's words in your files, in order, and plan one cut for each.",
                      "If any word is not said anywhere in your files, stop: nothing is written.",
                      "Cut the pieces with ffmpeg and join them into the MP4, with a receipt beside it."]}


# ---------------------------------------------------------------------------------------------------- build job

def start_build(body: dict) -> dict:
    with LOCK:
        job = STATE["job"]
        if job and job["proc"].poll() is None:
            raise Problem("A build is already running here. Cancel it or wait for it to finish.")
    p = plan(body)
    if not p["ok"]:
        raise Problem("Press Plan first and fix what it lists: " + " ".join(p["problems"][:3]))
    out_dir, work = STATE["out"], STATE["work"]
    out_dir.mkdir(parents=True, exist_ok=True)
    stamp = time.strftime("%Y%m%d-%H%M%S")
    out = out_dir / f"{Path(p['film']).stem}-{stamp}.mp4"
    wdir = work / stamp
    cmd = [sys.executable, "-m", "ryagram.local", "build", str(recipe_path(body["recipe"])), "--out", str(out), "--work-dir", str(wdir), "--model", p["model"]]
    for slot, files in body["binds"].items():
        for f in files:
            cmd += ["--bind", f"{slot}={f}"]
    env = dict(os.environ, PYTHONPATH=str(STATE["engine"]), PYTHONIOENCODING="utf-8", NO_PROXY="127.0.0.1,localhost")
    proc = subprocess.Popen(cmd, cwd=str(STATE["engine"]), env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="replace")
    job = {"proc": proc, "out": out, "lines": [], "started": time.time(), "cancelled": False, "id": stamp}
    threading.Thread(target=_pump, args=(job,), daemon=True).start()
    with LOCK:
        STATE["job"] = job
    return {"id": stamp, "film": out.name}


def _pump(job):
    for line in job["proc"].stdout:
        job["lines"].append(line.rstrip()[:300])
        del job["lines"][:-60]


def job_status() -> dict:
    job = STATE["job"]
    if not job:
        return {"state": "none"}
    code = job["proc"].poll()
    base = {"id": job["id"], "seconds": round(time.time() - job["started"]), "lines": job["lines"][-12:], "film": job["out"].name}
    if code is None:
        return {**base, "state": "running"}
    if job["cancelled"]:
        return {**base, "state": "cancelled", "words": "Cancelled. Anything half-made is in the work folder; nothing was kept as a film."}
    receipt = None
    rp = job["out"].with_suffix(".receipt.json")
    if code == 0 and rp.is_file():
        try:
            receipt = json.loads(rp.read_text(encoding="utf-8"))
        except Exception:  # noqa: BLE001
            receipt = None
    return {**base, "state": "built" if code == 0 else "stopped", "code": code, "words": EXIT_WORDS.get(code, "The build stopped with an unexpected error."), "receipt": receipt,
            "path": str(job["out"]) if code == 0 else None}


def cancel_build() -> dict:
    job = STATE["job"]
    if not job or job["proc"].poll() is not None:
        return {"state": "none"}
    job["cancelled"] = True
    pid = job["proc"].pid
    if os.name == "nt":
        subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"], capture_output=True)    # my own build, by its PID and its children, never by name
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


# ---------------------------------------------------------------------------------------------------- the page

PAGE = """<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Desktop maker</title><link rel="stylesheet" href="/maker.css"></head>
<body><main>
<p class="banner" role="note"><strong>INTERNAL PROTOTYPE.</strong> Runs on this computer only. Nothing is uploaded; there is no account.</p>
<h1>Desktop maker</h1>
<p class="intro">Make a film from a recipe and your own video files, on this computer. Choose a recipe, give each slot a file, press Plan to see what will happen, then Build.</p>
<section aria-labelledby="h-recipe"><h2 id="h-recipe">1. Recipe</h2>
<label for="recipe">Recipe</label><select id="recipe"></select>
<p id="recipe-note" class="note" role="status"></p></section>
<section aria-labelledby="h-files"><h2 id="h-files">2. Your files</h2>
<div id="slots"></div>
<details class="paste"><summary>Paste bind lines instead</summary>
<label for="paste">One line for each file, like <code>--bind source-1=C:\\clips\\a.mp4</code> (what <code>library find --emit-binds</code> prints)</label>
<textarea id="paste" rows="4" spellcheck="false"></textarea><button id="use-paste" type="button" class="button secondary">Use these lines</button>
<p id="paste-note" class="note" role="status"></p></details>
<label for="model">Speech model on this computer</label><select id="model"><option>tiny</option><option selected>base</option><option>small</option></select>
<p class="note">A larger model hears more words and is slower. Use the same one the finder used.</p></section>
<section aria-labelledby="h-plan"><h2 id="h-plan">3. Plan, then Build</h2>
<div class="actions"><button id="plan" type="button" class="button secondary">Plan</button><button id="build" type="button" class="button primary" disabled>Build</button><button id="cancel" type="button" class="button secondary" hidden>Cancel</button></div>
<div id="plan-out" aria-live="polite"></div>
<div id="job-out" aria-live="polite"></div></section>
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
.button.primary{background:var(--brand);color:var(--paper)}.button:disabled{opacity:.5;cursor:not-allowed}.button:focus-visible,select:focus-visible,textarea:focus-visible,summary:focus-visible{outline:3px solid var(--brand);outline-offset:2px}
.slot{border:1px solid var(--line);border-radius:12px;padding:12px 16px;margin:12px 0;background:var(--paper)}.slot h3{margin:0 0 4px;font-size:1rem}.slot ul{margin:6px 0;padding-left:20px}.slot li{margin:2px 0;word-break:break-all}
.row{display:flex;gap:10px;flex-wrap:wrap;align-items:center}.actions{display:flex;gap:12px;flex-wrap:wrap;margin:10px 0}
.problems{color:var(--bad);padding-left:20px}.ok{color:var(--brand);font-weight:700}.panel{border:1px solid var(--line);border-radius:12px;padding:12px 16px;margin:12px 0;background:var(--paper)}
.panel dt{font-weight:700}.panel dd{margin:0 0 6px}.log{font-family:ui-monospace,Consolas,monospace;font-size:.85rem;white-space:pre-wrap;background:var(--soft);border-radius:8px;padding:8px 10px;max-height:240px;overflow:auto}
.paste{margin:14px 0}.paste summary{cursor:pointer;min-height:44px;display:flex;align-items:center;font-weight:700}code{background:var(--soft);padding:1px 5px;border-radius:5px}
@media(max-width:600px){main{padding:12px}}
"""

JS = r"""(function () {
  'use strict';
  const T = new URLSearchParams(location.search).get('t') || sessionStorage.getItem('maker-token') || '';
  try { sessionStorage.setItem('maker-token', T); } catch (e) { /* the page still works without it */ }
  const $ = id => document.getElementById(id);
  const el = (tag, attrs, ...kids) => { const n = document.createElement(tag); for (const [k, v] of Object.entries(attrs || {})) { if (k === 'class') n.className = v; else if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else if (v !== false && v != null) n.setAttribute(k, v === true ? '' : v); } for (const c of kids.flat()) if (c != null) n.append(c); return n; };
  async function api(path, body) {
    const r = await fetch(path, { method: body ? 'POST' : 'GET', headers: { 'X-Maker-Token': T, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({ error: 'The server did not answer.' }));
    if (!r.ok) throw new Error(j.error || 'That did not work.');
    return j;
  }
  let recipes = [], current = null, binds = {}, planned = false, poll = null;
  const fresh = () => { planned = false; $('build').disabled = true; $('plan-out').replaceChildren(); };
  function drawSlots() {
    const box = $('slots'); box.replaceChildren();
    if (!current) return;
    for (const s of current.slots) {
      const files = binds[s.id] || [];
      box.append(el('div', { class: 'slot' }, el('h3', {}, s.label), el('p', { class: 'note' }, s.multiple ? 'One or more video files.' : 'One video file.'),
        files.length ? el('ul', {}, files.map(f => el('li', {}, f))) : el('p', { class: 'note' }, 'No file chosen yet.'),
        el('div', { class: 'row' }, el('button', { type: 'button', class: 'button secondary', 'aria-label': `Choose a file for ${s.label}`, onclick: async ev => {
          const btn = ev.currentTarget; btn.disabled = true;      // (currentTarget is gone after an await, so keep the button)
          try { const r = await api('/api/pick', { multiple: s.multiple }); if (r.files.length) { binds[s.id] = s.multiple ? (binds[s.id] || []).concat(r.files) : r.files.slice(0, 1); fresh(); drawSlots(); } }
          catch (e) { $('recipe-note').textContent = e.message; } finally { btn.disabled = false; }
        } }, files.length ? 'Add or change' : 'Choose a file\u2026'),
        files.length ? el('button', { type: 'button', class: 'button secondary', onclick: () => { binds[s.id] = []; fresh(); drawSlots(); } }, 'Clear') : null)));
    }
  }
  function drawRecipe() {
    const r = recipes.find(x => x.file === $('recipe').value);
    current = r && r.ok ? r : null; binds = {}; fresh();
    $('recipe-note').textContent = !r ? '' : !r.ok ? `This recipe is refused: ${r.problem}` : `Finds the words \u201c${r.find}\u201d in your files, in order.`;
    drawSlots();
  }
  $('recipe').addEventListener('change', drawRecipe);
  $('model').addEventListener('change', fresh);
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
  $('plan').addEventListener('click', async ev => {
    if (!current) { $('plan-out').replaceChildren(el('p', { class: 'problems', role: 'alert' }, 'Choose a recipe first.')); return; }
    const btn = ev.currentTarget; btn.disabled = true;
    try {
      const p = await api('/api/plan', { recipe: current.file, binds, model: $('model').value });
      planned = p.ok; $('build').disabled = !p.ok;
      $('plan-out').replaceChildren(p.ok
        ? el('div', { class: 'panel' }, el('p', { class: 'ok' }, 'Ready to build. Nothing has been written yet.'),
            el('dl', {}, el('dt', {}, 'Film'), el('dd', {}, `${p.film} (in ${p.out_dir})`), el('dt', {}, 'Words it will find'), el('dd', {}, p.find), el('dt', {}, 'Files'),
              el('dd', {}, p.slots.map(s => el('div', {}, `${s.label}: `, s.files.map(f => `${f.name} (${f.mb} MB)`).join(', ')))), el('dt', {}, 'Speech model'), el('dd', {}, p.model),
              el('dt', {}, 'Network'), el('dd', {}, p.network), el('dt', {}, 'Room on the work drive'), el('dd', {}, `${p.free_gb} GB free`)),
            el('p', {}, 'Build will:'), el('ol', {}, p.steps.map(x => el('li', {}, x))))
        : el('div', { class: 'panel' }, el('p', { role: 'alert' }, 'Not ready yet:'), el('ul', { class: 'problems' }, p.problems.map(x => el('li', {}, x)))));
    } catch (e) { $('plan-out').replaceChildren(el('p', { class: 'problems', role: 'alert' }, e.message)); }
    finally { btn.disabled = false; }
  });
  function drawJob(j) {
    const words = { running: `Building\u2026 ${j.seconds || 0} s`, built: j.words, stopped: j.words, cancelled: j.words };
    const parts = [el('p', { class: j.state === 'built' ? 'ok' : '' }, words[j.state] || '')];
    if (j.state === 'built') parts.push(el('p', {}, `Your film: ${j.path}`), j.receipt ? el('p', { class: 'note' }, `${j.receipt.clips.length} clip(s), ${j.receipt.seconds.toFixed(1)} s, network attempts: ${j.receipt.network_attempts}. A receipt is beside it.`) : null);
    if (j.state === 'stopped') parts.push(el('p', { class: 'note' }, `Exit code ${j.code}.`));
    if (j.lines && j.lines.length) parts.push(el('div', { class: 'log', 'aria-label': 'What the build printed' }, j.lines.join('\n')));
    $('job-out').replaceChildren(...parts);
    const running = j.state === 'running';
    $('cancel').hidden = !running; $('plan').disabled = running; $('build').disabled = running || !planned;
    if (!running && poll) { clearInterval(poll); poll = null; }
  }
  async function watch() { try { drawJob(await api('/api/job')); } catch (e) { $('job-out').textContent = e.message; } }
  $('build').addEventListener('click', async () => {
    if (!planned || !current) return;
    try { await api('/api/build', { recipe: current.file, binds, model: $('model').value }); poll = setInterval(watch, 1500); watch(); }
    catch (e) { $('job-out').replaceChildren(el('p', { class: 'problems', role: 'alert' }, e.message)); }
  });
  $('cancel').addEventListener('click', async () => { try { drawJob(await api('/api/cancel', {})); } catch (e) { $('job-out').textContent = e.message; } });
  (async () => {
    try {
      recipes = (await api('/api/recipes')).recipes.sort((a, b) => Number(b.ok) - Number(a.ok));      // the ones that work first, so the first choice is a usable one
      $('recipe').replaceChildren(...recipes.map(r => el('option', { value: r.file }, r.ok ? r.name : `${r.file} (refused)`)));
      if (!recipes.length) $('recipe-note').textContent = 'No recipe files (.json) were found in the recipes folder.';
      drawRecipe(); const j = await api('/api/job'); if (j.state === 'running') { poll = setInterval(watch, 1500); drawJob(j); }
    } catch (e) { $('recipe-note').textContent = e.message; }
  })();
})();
"""

CSP = "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"


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
                self._send(200, PAGE.encode("utf-8"), "text/html; charset=utf-8")
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
        else:
            self._json(404, {"error": "Not found."})

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
            if path == "/api/plan":
                self._json(200, plan(body))
            elif path == "/api/build":
                self._json(200, start_build(body))
            elif path == "/api/cancel":
                self._json(200, cancel_build())
            elif path == "/api/pick":
                self._json(200, {"files": pick_files(bool(body.get("multiple")))})
            elif path == "/api/paste":
                binds, bad = parse_pasted(body.get("text"))
                self._json(200, {"binds": binds, "bad": bad})
            else:
                self._json(404, {"error": "Not found."})
        except Problem as e:
            self._json(400, {"error": str(e)})
        except Exception as e:  # noqa: BLE001
            self._json(500, {"error": f"Unexpected: {type(e).__name__}: {str(e)[:200]}"})


def make_server(engine: Path, recipes: Path, work: Path, out: Path, port: int = 8765, token: str | None = None):
    STATE.update(engine=engine.resolve(), recipes=recipes.resolve(), work=work.resolve(), out=out.resolve(), token=token or secrets.token_urlsafe(24), port=port, job=None)
    STATE["R"], STATE["E"] = load_engine(STATE["engine"])
    srv = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    STATE["port"] = srv.server_address[1]
    return srv


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Desktop maker (internal prototype): ENGINE's local film build behind a one-page screen. Local only.")
    ap.add_argument("--engine", required=True, help="a Ryagram checkout that has ryagram/local (branch local-mvp)")
    ap.add_argument("--recipes", required=True, help="a folder of recipe .json files")
    ap.add_argument("--work-dir", default="D:/Ryagram-scratch/desktop-maker/work", help="where the index, cut clips and TEMP go (choose the drive with room)")
    ap.add_argument("--out-dir", default="D:/Ryagram-scratch/desktop-maker/films", help="where the MP4 and its receipt go")
    ap.add_argument("--port", type=int, default=8765)
    a = ap.parse_args(argv)
    srv = make_server(Path(a.engine), Path(a.recipes), Path(a.work_dir), Path(a.out_dir), a.port)
    print(f"Desktop maker: open  http://127.0.0.1:{STATE['port']}/?t={STATE['token']}\n(this computer only; press Ctrl+C to stop)")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
