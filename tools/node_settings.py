"""The settings file that lets a tester's own PC make its own site films, WRITTEN BY THE APP at first start (NEXT-CONNECT 171; the plan is proposals/RENDERER-SITE-FILM-PACKAGING.md, 'The settings file').

Standard library only, no network. Nothing is hand-written by the tester and nothing here is a secret: it holds only paths inside the app's own folder, the Google Chrome the PC already has, and the fixed list of
datasets a tester build may render. The start file passes --node-auto; desktop_maker then calls ensure(), hands the file to tools/ryagram_node_render.py exactly as --node-config would, and that module's make() still
decides, in plain words, whether this computer is ready (a work folder on C:, too little memory or disk, no browser, no data folder ...). If anything is missing the app says so and behaves as before
('cannot make site films yet'); this file never switches a film on by itself.

What the generated file says (the worker-shaped settings the film job reads with the house worker's own Config.from_toml, plus the [node] table):
  root                  <app>/work/node-root          the film job's folder (never on C: unless the whole app is, and then make() refuses in words)
  [engine] engine_dir   the app folder                its own ryagram folder (kit + node-job closure)
  [engine] sequence_argv / sheet_argv   the app's own Python, -m ryagram.sequence[.sheet]
  [engine] chrome       Google Chrome (chrome.exe) in its usual places. ONLY Chrome: the house worker's Config refuses any other name, and Edge failed to launch with the vector renderer's flags in CC1's test
  [engine] path_dirs    the app's own ffmpeg folder
  [engine.env] RYAGRAM_CACHE_DIR   <app>/work/node-data   the data the film reads; the engine builds OFFLINE, so a film whose data is not here waits for the person's approved download plan
  [datasets] allow      STARTER_DATASETS only (the dataset whose data a tester can have: node-starter-data.json)
  [limits.*]            the house defaults (a runaway guard)
  [node]                gpu_lock = the app's tools/gpu_lock.py, gpu_lock_dir inside the work folder, no_house_worker = true (a tester PC has none), who
"""
from __future__ import annotations

import json
import os
import socket
import sys
from pathlib import Path

STARTER_DATASETS = ("bps_county_permits",)                       # tools/node-starter-data.json: the first free film's data; widening it is a deliberate edit
LIMITS = {"contact_sheet": (1800, 20971520), "preview": (2400, 62914560), "final_render": (5400, 524288000)}      # the house worker's own defaults: wall seconds, output bytes
MEMORY_BYTES = 8 << 30
WORK_BYTES = 6 << 30
REL_ROOT = Path("work") / "node-root"
REL_DATA = Path("work") / "node-data"
REL_LOCK = Path("work") / "node-lock"
REL_SETTINGS = Path("work") / "node-settings" / "ryagram-node.toml"


def _q(v) -> str:
    """A TOML basic string: JSON's own quoting is valid TOML."""
    return json.dumps(str(v).replace(chr(92), "/"), ensure_ascii=False)


def _list(vs) -> str:
    return "[" + ", ".join(_q(v) for v in vs) + "]"


def find_browser(env=None, exists=lambda p: Path(p).is_file()) -> str | None:
    """Google Chrome (chrome.exe) in its usual places for the machine and for this user. None when it is not there. Edge is NOT used: the film job refuses it (ryagram/worker/config.py _chrome)."""
    env = os.environ if env is None else env
    roots = [env.get("PROGRAMFILES(X86)"), env.get("PROGRAMFILES"), env.get("LOCALAPPDATA")]
    rels = [("Google", "Chrome", "Application", "chrome.exe")]
    for rel in rels:
        for r in roots:
            if r:
                p = Path(r).joinpath(*rel)
                if exists(p):
                    return str(p).replace(chr(92), "/")
    return None


def settings_text(app: Path, *, python: Path, ffmpeg_dir: Path, browser: str | None, computer: str, allow_c_inside_app: bool = False) -> str:
    app = Path(app)
    lines = [
        "# Written by the Ryagram app at first start (tools/node_settings.py). Do not edit: it is rewritten whenever the app starts.",
        f"root = {_q(app / REL_ROOT)}",
        f"worker_id = {_q((computer or 'TESTER')[:40] + '-NODE')}",
        "poll_s = 5.0",
        "heartbeat_s = 15.0",
        f"memory_bytes = {MEMORY_BYTES}",
        f"work_bytes = {WORK_BYTES}",
        "",
        "[engine]",
        f"engine_dir = {_q(app)}",
        f"chrome = {_q(browser or '')}",
        f"sequence_argv = {_list([python, '-m', 'ryagram.sequence'])}",
        f"sheet_argv = {_list([python, '-m', 'ryagram.sequence.sheet'])}",
        f"path_dirs = {_list([ffmpeg_dir])}",
        "",
        "[engine.env]",
        f"RYAGRAM_CACHE_DIR = {_q(app / REL_DATA)}",
        "",
        "[datasets]",
        f"allow = {_list(STARTER_DATASETS)}",
        "",
    ]
    for kind, (wall, size) in LIMITS.items():
        lines += [f"[limits.{kind}]", f"wall_s = {wall}", f"output_bytes = {size}"]
    lines += ["", "[node]", f"gpu_lock = {_q(app / 'tools' / 'gpu_lock.py')}", f"gpu_lock_dir = {_q(app / REL_LOCK)}", "no_house_worker = true", f"allow_c_inside_app = {'true' if allow_c_inside_app else 'false'}", "who = \"MAKER\"", ""]
    return "\n".join(lines)


def ensure(app, *, python=None, ffmpeg_dir=None, env=None, exists=lambda p: Path(p).is_file(), computer=None, allow_c_inside_app: bool = False) -> Path:
    """Write (or refresh) the settings file inside the app's own folder and return its path. Creates the small state folders it names, only under <app>/work. Never raises for a missing Chrome: the file says so and
    make() reports it in words."""
    app = Path(app).resolve()
    env = os.environ if env is None else env
    py = Path(python) if python else Path(sys.executable)
    ff = Path(ffmpeg_dir) if ffmpeg_dir else (Path(env["FFMPEG_PATH"]).parent if env.get("FFMPEG_PATH") else app / "ffmpeg")
    text = settings_text(app, python=py, ffmpeg_dir=ff, browser=find_browser(env, exists), computer=computer or socket.gethostname(), allow_c_inside_app=allow_c_inside_app)
    for rel in (REL_ROOT, REL_DATA, REL_LOCK, REL_SETTINGS.parent):
        (app / rel).mkdir(parents=True, exist_ok=True)
    target = app / REL_SETTINGS
    try:
        same = target.read_text(encoding="utf-8") == text
    except OSError:
        same = False
    if not same:
        target.write_text(text, encoding="utf-8", newline="\n")
    return target
