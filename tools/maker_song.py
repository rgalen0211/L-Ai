"""The song page's side of the desktop maker (NEXT-CONNECT 111b; contract: docs/maker-song-host-contract.md, WEB's screens in tools/maker-song/).

Off unless the maker is started with --song. The routes (all behind the maker's token, 127.0.0.1 only, nothing leaves this computer):

    GET  /song, /song.js, /song-model.js, /song.css      the page WEB built, served with its own content policy
    GET  /api/song                                       the saved song plan (song.json in the films folder) or null
    POST /api/song                                       save the page's plan (validated again here; names only, never a path)
    POST /api/song/videos | /track | /guide              the operating system's file dialog; only NAMES go back to the page
    POST /api/song/build                                 plan the song with ENGINE's own `plan --json` (no film is written); answers with the plan the screens read
    POST /api/song/hear                                  the person's own take of a word, or a line's takes on their beats (not stretched, no music); null when it cannot
    GET  /api/song/audio?id=                             the sound that hear named (needs the token header)
    POST /api/song/render                                the film: ENGINE's `build --approve-plan <the id of the plan the person looked at>`; one at a time

A song film is built only for a plan that was made here and looked at: render checks that the plan on the screen is the plan the engine made (same words, same clips) and passes ITS id to the
engine, which refuses a changed plan again. There is no batch path and nothing is published. Stdlib only; ENGINE's code runs in its own process, as it does for the main page.
Words built from sounds (item 112) are OFF unless the maker is started with --song-forge, and then only when the engine has the alignment model: the engine says so in a plain sentence and never
downloads anything itself."""
from __future__ import annotations

import hashlib
import json
import math
import os
import re
import secrets
import subprocess
import sys
import threading
import time
from pathlib import Path
from urllib.parse import parse_qs, urlparse

HERE = Path(__file__).resolve().parent
PAGE_DIR = HERE / "maker-song"
ASSETS = {"/song": ("song.html", "text/html; charset=utf-8"), "/song.js": ("song.js", "text/javascript; charset=utf-8"), "/song-model.js": ("song-model.js", "text/javascript; charset=utf-8"),
          "/song.css": ("song.css", "text/css; charset=utf-8")}
SONG_CSP = ("default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; base-uri 'none'; form-action 'none'; "
            "frame-ancestors 'none'")
VIDEO_EXTS = (".mp4", ".mkv", ".mov", ".avi", ".webm", ".m4v")
AUDIO_EXTS = (".mp3", ".wav", ".m4a", ".flac", ".ogg", ".aac", ".opus")
SCHEMA = "ryagram.song-plan/0"
MAX_VIDEOS = 300
MAX_LISTED = 5000                 # names the page may list (folders count each used video)
MAX_LINES = 64
MAX_WORDS_LINE = 40
MAX_PLAN_BYTES = 400_000
STATUSES = ("whole", "syllables", "phonemes", "gap")
KEEP_AUDIO = 40
NONE_SAID = "None of your words are in your videos. Choose other videos or change the words."
_PATHISH = re.compile(r"(?:[A-Za-z]:[\\/]|\\\\|(?:^|[\s\"'(])/(?:[\w.-]+/)+[\w.-]+)")
_EXT = r"(?:mp4|mkv|mov|avi|webm|m4v|mp3|wav|m4a|flac|ogg|aac|opus|json|txt)"
_WINPATH = re.compile(r"[A-Za-z]:[\\/].*?\." + _EXT + r"\b|[A-Za-z]:[\\/]\S*|\\\\\S+", re.I)          # a drive path up to its file extension, else up to a space; or a share
_POSPATH = re.compile(r"(?:(?<=^)|(?<=[\s\"'(]))/(?:[\w .-]+/)+[\w.-]+")
_dm = None                                                       # the desktop_maker module that serves this (set by attach)


class Problem(ValueError):
    """A sentence for the person (the maker turns it into a 400 with {"error": sentence})."""


def attach(dm) -> None:
    """Called by the maker with its own module (it runs as a script, so importing it again would make a second copy with its own STATE)."""
    global _dm
    _dm = dm
    dm.STATE.setdefault("song", {"videos": {}, "folders": {}, "track": None, "guide": None, "plan": None, "audio": {}, "busy": False, "files": None})


def S() -> dict:
    return _dm.STATE["song"]


def on() -> bool:
    return bool(_dm and _dm.STATE.get("song_on"))


# ----------------------------------------------------------------------------------------------------- words in plain sentences
def plain(text: str, kind: str) -> str:
    """The sentence for the person from what the engine said (rc 2 and the others). Never a path, a slot id or a command-line flag."""
    t = (text or "").strip()
    t = re.sub(r"^(refused|cannot build|blocked|error):\s*", "", t, flags=re.I)
    low = t.lower()
    if "has no file" in low:
        return "Choose your song." if "music" in low else "Choose at least one video."
    if "takes video files" in low:
        return "One of those files is not a video. Choose videos in the videos step."
    if "not a sound file" in low:
        return "That is not a sound file. Choose your song as mp3, wav, m4a, flac or ogg."
    if "takes exactly one file" in low:
        return "Choose one song."
    if "used whole" in low:
        return "A song is used whole."
    if "has no words to place" in low:
        return "Paste your words first."
    if low.startswith("no words could be heard in the vocal") or low.startswith("almost none of your words"):
        return t.split("\n")[0][:300]
    if "plan changed" in low or "changed since you looked" in low:
        return "The plan changed since you looked at it (different files, words or settings). Press Build again, look at it, then make the film."
    if "only from a plan you have looked at" in low:
        return "Build your song and look at it first, then make the film."
    if "rubberband" in low:
        return "This computer cannot do this yet."
    if "could not be read" in low:
        return "A file could not be read. Check that it still opens in another program."
    if "could not be made" in low or "could not be cut" in low or "could not be joined" in low or "could not be put together" in low:
        return "The film could not be made. Nothing was kept."
    if kind == "network":
        return "Blocked: the build tried to use the network, which it must not. Nothing was kept."
    t = _POSPATH.sub("a file", _WINPATH.sub("a file", t))
    t = re.sub(r"--[a-z-]+(?:[ =]\S+)?", "", t)
    t = " ".join(t.split())
    return (t[:240] or "Something unexpected went wrong. Nothing was kept as a film.")


# ----------------------------------------------------------------------------------------------------- files
def _ffmpeg() -> str:
    import shutil
    exe = shutil.which("ffmpeg")
    if not exe:
        raise Problem("ffmpeg is not on this computer's PATH, and the song is cut with it.")
    return exe


def audio_seconds(path: Path) -> float:
    """The length of a sound file, from ffmpeg's own report; Problem when it is not a sound this computer can read."""
    r = subprocess.run([_ffmpeg(), "-hide_banner", "-nostdin", "-i", str(path)], capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=60)
    m = re.search(r"Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)", r.stderr)
    if not m or "Audio:" not in r.stderr:
        raise Problem("That file is not a sound this computer can read. Choose your song as mp3, wav, m4a, flac or ogg.")
    return int(m.group(1)) * 3600 + int(m.group(2)) * 60 + float(m.group(3))


def pick_audio_file() -> str | None:
    """The operating system's own file dialog for one sound file (own process: tkinter must own its thread). The check replaces only this function."""
    code = ("import tkinter as tk\nfrom tkinter import filedialog\nr = tk.Tk(); r.withdraw(); r.attributes('-topmost', True)\n"
            "ft = [('Sound files', '*.mp3 *.wav *.m4a *.flac *.ogg *.aac *.opus')]\n"
            "res = filedialog.askopenfilename(title='Choose a sound file', filetypes=ft)\nimport json; print(json.dumps(res or ''))")
    r = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, encoding="utf-8", timeout=600)
    try:
        return json.loads(r.stdout.strip().splitlines()[-1]) or None
    except Exception:  # noqa: BLE001
        return None


def safe_name(name) -> bool:
    return isinstance(name, str) and 0 < len(name) <= 200 and not re.search(r"[\\/:\x00-\x1f]", name) and name not in (".", "..")


def safe_rel(name) -> bool:
    """A video name as the page keeps it: a bare file name, or a FOLDER-RELATIVE one (my-clips/Season 2/a.mp4). Never a drive, a leading slash, a backslash or '..'."""
    if not isinstance(name, str) or not 0 < len(name) <= 400 or re.search(r"[\\:\x00-\x1f]", name) or name.startswith("/"):
        return False
    return all(seg not in ("", ".", "..") for seg in name.split("/"))


def pick_folder_dialog() -> str | None:
    """The operating system's own dialog for ONE folder (own process: tkinter must own its thread). The check replaces only this function."""
    code = ("import tkinter as tk\nfrom tkinter import filedialog\nr = tk.Tk(); r.withdraw(); r.attributes('-topmost', True)\n"
            "res = filedialog.askdirectory(title='Choose a folder of videos', mustexist=True)\nimport json; print(json.dumps(res or ''))")
    r = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, encoding="utf-8", timeout=600)
    try:
        return json.loads(r.stdout.strip().splitlines()[-1]) or None
    except Exception:  # noqa: BLE001
        return None


def pick_folder() -> dict:
    """ONE folder of the person's videos. The engine's own rules say which videos in it are used (any depth, a fixed order, at most its cap), so what the page lists is what the film uses. The
    answer holds the folder's NAME and FOLDER-RELATIVE video names, never a path."""
    got = pick_folder_dialog()
    if not got:
        return {}
    folder = Path(got)
    E = _dm.STATE["E"]
    if not folder.is_dir():
        raise Problem("That is not a folder.")
    if not hasattr(E, "expand_folder"):
        raise Problem("This copy of Ryagram cannot read a whole folder yet. Choose the videos one by one.")
    try:
        binds, info = E.expand_folder("footage-1", folder)
    except E.Refused as e:
        raise Problem(plain(str(e), "other")) from None
    have = S()["folders"].get(folder.name)
    if have is not None and have != folder:
        raise Problem(f"A different folder is already called {folder.name}. Rename one of them, then choose it again.")
    _dm.remember_dirs([folder / "x"])
    S()["folders"][folder.name] = folder
    out = []
    for b in binds:
        rel = folder.name + "/" + b.path.relative_to(folder.resolve()).as_posix()
        S()["videos"][rel] = b.path
        S().setdefault("bare", {}).setdefault(b.path.name, b.path)
        out.append({"file_name": rel})
    return {"folder": {"name": folder.name, "found": info["found"], "used": info["used"]}, "videos": out}


def pick_videos() -> dict:
    got = _dm.pick_files(True)
    _dm.remember_dirs(got)
    out = []
    for p in got:
        path = Path(p)
        if path.suffix.lower() not in VIDEO_EXTS or not path.is_file():
            raise Problem(f"{path.name} is not a video this program reads (mp4, mkv, mov, avi, webm or m4v).")
        have = S()["videos"].get(path.name)
        if have is not None and have != path:
            raise Problem(f"A different video is already called {path.name}. Rename one of them, then choose it again.")
        if len(S()["videos"]) >= MAX_VIDEOS and path.name not in S()["videos"]:
            raise Problem(f"A song film uses at most {MAX_VIDEOS} videos.")
        S()["videos"][path.name] = path
        S().setdefault("bare", {}).setdefault(path.name, path)
        out.append({"file_name": path.name})
    return {"videos": out}


def pick_sound(kind: str) -> dict:
    got = pick_audio_file()
    if not got:
        return {}                                                # the dialog was closed: nothing chosen, nothing said
    path = Path(got)
    if path.suffix.lower() not in AUDIO_EXTS or not path.is_file():
        raise Problem("That is not a sound file. Choose your song as mp3, wav, m4a, flac or ogg.")
    secs = audio_seconds(path)
    S()[kind] = path
    _dm.remember_dirs([path])
    return {"track": {"file_name": path.name, "seconds": round(secs, 3)}} if kind == "track" else {"guide": {"file_name": path.name}}


# ----------------------------------------------------------------------------------------------------- the saved plan
def _walk_strings(x):
    if isinstance(x, str):
        yield x
    elif isinstance(x, dict):
        for k, v in x.items():
            yield from _walk_strings(k)
            yield from _walk_strings(v)
    elif isinstance(x, list):
        for v in x:
            yield from _walk_strings(v)


def _num(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def validate_plan(plan) -> dict:
    """The page's plan, checked again here before it is written: the right schema, names and never paths, words in order, a built word is ONE person's pieces. Returns the plan."""
    if not isinstance(plan, dict) or plan.get("schema") != SCHEMA:
        raise Problem("That is not a song plan this program wrote.")
    if len(json.dumps(plan)) > MAX_PLAN_BYTES:
        raise Problem("That song plan is too large to save.")
    for s in _walk_strings(plan):
        if _PATHISH.search(s) and len(s) < 300 and not s.startswith("http"):
            raise Problem("A song plan holds file names only, never a place on this computer.")
    track, cast, lines = plan.get("track"), plan.get("cast"), plan.get("lines")
    if not isinstance(track, dict) or not safe_name(track.get("file_name")) or not _num(track.get("seconds")) or track["seconds"] <= 0:
        raise Problem("The song plan has no music.")
    if plan.get("guide") is not None and not (isinstance(plan["guide"], dict) and safe_name(plan["guide"].get("file_name"))):
        raise Problem("The singing track in the song plan is not valid.")
    if not isinstance(cast, list) or not isinstance(lines, list) or not lines or len(lines) > MAX_LINES:
        raise Problem("The song plan has no lines, or too many.")
    ids = set()
    for c in cast:
        if not isinstance(c, dict) or not isinstance(c.get("id"), str) or not re.fullmatch(r"[A-Za-z0-9_.:-]{1,60}", c["id"]):
            raise Problem("A voice in the song plan is not valid.")
        ids.add(c["id"])
    for li, line in enumerate(lines, 1):
        if not isinstance(line, dict) or not isinstance(line.get("text"), str) or not isinstance(line.get("words"), list) or not line["words"]:
            raise Problem(f"Line {li} of the song plan has no words.")
        last = -1.0
        for w in line["words"]:
            if not isinstance(w, dict) or not isinstance(w.get("w"), str) or not w["w"].strip() or len(w["w"]) > 60:
                raise Problem(f"A word in line {li} is not valid.")
            if not (_num(w.get("beat_s")) and _num(w.get("end_s")) and w["beat_s"] >= 0 and w["end_s"] > w["beat_s"] and w["end_s"] <= track["seconds"] + 0.5):
                raise Problem(f"The word “{w['w']}” has a beat outside the music.")
            if w["beat_s"] < last - 1e-9:
                raise Problem(f"The words of line {li} are not in order.")
            last = w["beat_s"]
            if w.get("status") not in STATUSES:
                raise Problem(f"The word “{w['w']}” must be said as it is, built from sounds, or a gap.")
            if w["status"] == "gap":
                continue
            if w.get("speaker_id") not in ids or not safe_name(w.get("file_name")):
                raise Problem(f"The word “{w['w']}” must name its voice and its video by name only.")
            if not (_num(w.get("src_s")) and _num(w.get("src_e")) and w["src_e"] > w["src_s"] >= 0 and _num(w.get("stretch")) and 0 < w["stretch"] <= 20):
                raise Problem(f"The word “{w['w']}” has a source time or a stretch that is not valid.")
            if w["status"] != "whole":
                pcs = w.get("pieces")
                if not isinstance(pcs, list) or len(pcs) < 2:
                    raise Problem(f"The word “{w['w']}” is built from sounds, so it needs its pieces.")
                if any(not isinstance(p, dict) or p.get("speaker_id") != w["speaker_id"] for p in pcs):
                    raise Problem(f"The word “{w['w']}” mixes two people. A word is built from one person's sounds only.")
    return plan


def song_json() -> Path:
    return _dm.STATE["out"] / "song.json"


def load() -> dict:
    f = song_json()
    if not f.is_file():
        return {"plan": None}
    try:
        return {"plan": validate_plan(json.loads(f.read_text(encoding="utf-8")))}
    except (OSError, ValueError):
        return {"plan": None}


def save(body: dict) -> dict:
    plan = validate_plan(body.get("plan"))
    f = song_json()
    f.parent.mkdir(parents=True, exist_ok=True)
    tmp = f.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(plan, indent=1, ensure_ascii=False), encoding="utf-8")
    os.replace(tmp, f)
    return {"saved": True}


# ----------------------------------------------------------------------------------------------------- the engine
def _recipe(lines: list[str], has_guide: bool) -> dict:
    """The song recipe for these words: one slot of videos, the song, and the singing on its own when there is one. The settings are the engine's plain defaults (a clip at least 0.3 s, the
    picture holds 0.5 s, the music 6 dB under the voices, a word stretched at most 3x or squeezed to 0.5x). The engine checks it again with its own closed schema."""
    slots = [{"id": "footage-1", "label": "Your videos", "accepts": "video", "multiple": True}, {"id": "music", "label": "Your song", "accepts": "audio", "multiple": False}]
    song = {"lines": list(lines), "music_slot": "music", "min_clip_s": 0.3, "burst_s": 0.5, "music_db": -6, "min_stretch": 0.5, "max_stretch": 3.0}
    if has_guide:
        slots.append({"id": "guide", "label": "The singing on its own", "accepts": "audio", "multiple": False})
        song["guide_slot"] = "guide"
    rec = {"schema": "ryagram.recipe/0", "name": "Sing a line to your music", "slots": slots, "find": {"op": "song", "text": " ".join(lines), "unit": "words", "slots": ["footage-1"]},
           "select": {"min_length": 1, "max_length": 1, "min_seconds": 0.1, "max_seconds": 2.0}, "arrange": {"order": "text", "join": "cut", "crossfade_ms": 0},
           "effects": {"padding": {"lead_ms": 60, "trail_ms": 80}}, "render": {"preset": "720p30", "crf": 23}, "song": song}
    try:
        _dm.STATE["R"].validate_recipe(rec)
    except Exception:  # noqa: BLE001
        raise Problem("This copy of Ryagram cannot make song films yet.") from None
    return rec


def _door_problems() -> list[str]:
    dm = _dm
    out = []
    model = dm.default_model()
    if model not in dm.offered_models():
        out.append("Pick one of the choices in the listening list on the main page first.")
    mroot = os.environ.get("RYAGRAM_MODEL_DIR")
    if model in dm.offered_models() and mroot and model not in dm.models_present(mroot):
        out.append(dm.missing_model_sentence(model))
    if dm.faster_whisper_missing():
        out.append('The speech add-on is not installed on this PC. Type this in a PowerShell window, then press Build again:  python -m pip install faster-whisper "av<19"')
    return out


def _check_request(req: dict):
    """(lines, [video paths], track path, guide path or None) from the page's build request; a Problem names what is wrong in the person's words."""
    lines = req.get("lines")
    if not isinstance(lines, list) or not lines or not all(isinstance(x, str) for x in lines):
        raise Problem("Paste your words first.")
    lines = [" ".join(x.split()) for x in lines if " ".join(x.split())]
    if not lines or len(lines) > MAX_LINES or any(len(x.split()) > MAX_WORDS_LINE for x in lines):
        raise Problem(f"Use between 1 and {MAX_LINES} lines of at most {MAX_WORDS_LINE} words.")
    vids = req.get("videos")
    if not isinstance(vids, list) or not vids:
        raise Problem("Choose at least one video.")
    if len(vids) > MAX_LISTED:
        raise Problem(f"That is too many videos for one song. Choose fewer folders.")
    paths, seen, in_folder = [], set(), set()
    for v in vids:
        name = v.get("file_name") if isinstance(v, dict) else None
        if not safe_rel(name) or name in seen:
            raise Problem("The list of videos is not valid. Choose them again.")
        seen.add(name)
        p = S()["videos"].get(name)
        if p is None or not p.is_file():
            raise Problem(f"{name} is no longer where it was. Choose your videos again.")
        if "/" in name:
            in_folder.add(name.split("/", 1)[0])
        else:
            paths.append(p)                                 # a video chosen on its own
    asked = req.get("folders") or []
    if not isinstance(asked, list) or len(asked) > 50:
        raise Problem("The list of folders is not valid. Choose them again.")
    for f in asked:
        fname = f.get("name") if isinstance(f, dict) else None
        folder = S()["folders"].get(fname) if isinstance(fname, str) else None
        if folder is None or not folder.is_dir():
            raise Problem(f"The folder {fname if isinstance(fname, str) and safe_name(fname) else 'you chose'} is no longer where it was. Choose it again.")
        in_folder.add(fname)
    for fname in sorted(in_folder):
        folder = S()["folders"].get(fname)
        if folder is None or not folder.is_dir():
            raise Problem("A video is listed from a folder that is not chosen here. Choose the folder again.")
        paths.append(folder)                                # the engine reads the whole folder, in its own fixed order, up to its cap
    tr = req.get("track")
    track = S().get("track")
    if not isinstance(tr, dict) or track is None or tr.get("file_name") != track.name or not track.is_file():
        raise Problem("Choose your music first.")
    g = req.get("guide")
    guide = None
    if g is not None:
        guide = S().get("guide")
        if not isinstance(g, dict) or guide is None or g.get("file_name") != guide.name or not guide.is_file():
            raise Problem("Choose the singing track again.")
    return lines, paths, track, guide


def _run(args: list[str], what: str) -> tuple[int, str, str]:
    env = dict(os.environ, PYTHONPATH=str(_dm.STATE["engine"]), PYTHONIOENCODING="utf-8", NO_PROXY="127.0.0.1,localhost")
    proc = subprocess.Popen([sys.executable, "-m", "ryagram.local"] + args, cwd=str(_dm.STATE["engine"]), env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding="utf-8", errors="replace", **_dm._plat().popen_group_kwargs())
    S()["proc"] = proc
    try:
        out, err = proc.communicate()
    finally:
        S()["proc"] = None
    return proc.returncode, out, err


def _claim() -> None:
    with _dm.LOCK:
        job = _dm.STATE.get("job")
        if (job and job["proc"].poll() is None) or S()["busy"]:
            raise Problem("Something is already running here. Wait for it to finish.")
        S()["busy"] = True


def _release() -> None:
    S()["busy"] = False


def _forge(req: dict | None = None) -> bool:
    """Words built from sounds: only when the maker was started with --song-forge AND the page asks for them (Build asks; 'Make it without the words built from sounds' does not)."""
    asked = True if req is None or "forge" not in req else req.get("forge") is True
    return bool(_dm.STATE.get("song_forge")) and asked


def build(req: dict) -> dict:
    lines, vids, track, guide = _check_request(req)
    want_id = req.get("plan_id")
    if want_id is not None and not (isinstance(want_id, str) and re.fullmatch(r"[0-9a-f]{16}", want_id)):
        raise Problem("The plan on the screen is not valid. Press Build again.")
    forge = _forge(req)
    problems = _door_problems()
    if problems:
        raise Problem("Fix this first: " + " ".join(problems[:2]))
    _claim()
    try:
        key = hashlib.sha1(json.dumps([lines, [str(p) for p in vids], str(track), str(guide) if guide else None, forge]).encode("utf-8")).hexdigest()[:10]
        work = _dm.STATE["work"] / "song" / key
        work.mkdir(parents=True, exist_ok=True)
        rf = work / "song-recipe.json"
        rf.write_text(json.dumps(_recipe(lines, guide is not None), indent=1), encoding="utf-8")
        args = ["plan", str(rf), "--work-dir", str(work / "w"), "--model", _dm.default_model(), "--json"] + sum([["--bind", f"footage-1={p}"] for p in vids], [])
        args += ["--bind", f"music={track}"] + (["--bind", f"guide={guide}"] if guide else []) + (["--forge"] if forge else [])
        rc, out, err = _run(args, "plan")
        if rc not in (0, 3):
            raise Problem(plain(err.strip().splitlines()[-1] if err.strip() else "", "network" if rc == 4 else "other"))
        try:
            ans = json.loads(out)
        except ValueError:
            raise Problem("The engine did not give a plan. Nothing was kept.") from None
        if rc == 3 or not ans.get("ok"):
            raise Problem(NONE_SAID)
        view = ans.get("view")
        if not view:
            raise Problem("This copy of Ryagram cannot make song films yet.")
        if want_id is not None and ans.get("plan_id") != want_id:
            raise Problem("The plan changed since you looked at it (different files, words or settings). Press Build again, look at it, then make the film.")
        S().update(plan=ans, key=key, work=work, recipe=rf, binds=[(p, "footage-1") for p in vids], built_music=track, built_guide=guide, forge=forge)
        return {"plan": view}
    finally:
        _release()


# ----------------------------------------------------------------------------------------------------- hearing
def _remember_audio(path: Path) -> str:
    aid = secrets.token_hex(8)
    a = S()["audio"]
    a[aid] = path
    while len(a) > KEEP_AUDIO:
        old = next(iter(a))
        a.pop(old).unlink(missing_ok=True)
    return aid


def _rows_of(ans: dict, n: int) -> list[dict]:
    return [r for r in ans["rows"] if r["line"] == n]


def hear(req: dict) -> dict | None:
    ans = S().get("plan")
    kind, n, i = req.get("kind"), req.get("n"), req.get("i")
    if not ans or kind not in ("word", "line") or not isinstance(n, int) or n < 1:
        return None
    rows = _rows_of(ans, n)
    if not rows:
        return None
    hdir = S()["work"] / "hear"
    hdir.mkdir(parents=True, exist_ok=True)
    out = hdir / (secrets.token_hex(6) + ".wav")
    ff = _ffmpeg()
    if kind == "word":
        if not isinstance(i, int) or not 0 <= i < len(rows):
            return None
        r = rows[i]
        if r["state"] != "placed":
            return None
        if r.get("preview") and ans.get("preview_dir"):
            src = Path(ans["preview_dir"]) / Path(r["preview"]).name
            if src.is_file():
                import shutil
                shutil.copyfile(src, out)
                return {"url": "/api/song/audio?id=" + _remember_audio(out)}
        path = S()["videos"].get(r["clip"]) or S().get("bare", {}).get(r["clip"])
        if path is None or not path.is_file():
            return None
        a, b = max(0, r["src_start_ms"] - 20) / 1000.0, (r["src_end_ms"] + 20) / 1000.0
        cmd = [ff, "-v", "error", "-nostdin", "-y", "-ss", f"{a:.3f}", "-t", f"{b - a:.3f}", "-i", str(path), "-vn", "-ac", "2", "-ar", "44100", str(out)]
    else:
        placed = [r for r in rows if r["state"] == "placed"]
        if not placed:
            return None
        t0 = rows[0]["sung_start_ms"]
        cmd = [ff, "-v", "error", "-nostdin", "-y"]
        chains, labels = [], []
        for k, r in enumerate(placed):
            path = S()["videos"].get(r["clip"]) or S().get("bare", {}).get(r["clip"])
            if path is None or not path.is_file():
                return None
            a, b = max(0, r["src_start_ms"] - 20) / 1000.0, (r["src_end_ms"] + 20) / 1000.0
            cmd += ["-ss", f"{a:.3f}", "-t", f"{b - a:.3f}", "-i", str(path)]
            delay = max(0, r["sung_start_ms"] - t0)
            chains.append(f"[{k}:a]aformat=sample_rates=44100:channel_layouts=stereo,adelay={delay}|{delay}[a{k}]")
            labels.append(f"[a{k}]")
        graph = ";".join(chains) + ";" + "".join(labels) + f"amix=inputs={len(placed)}:normalize=0:dropout_transition=0,alimiter=limit=0.95[o]"
        cmd += ["-filter_complex", graph, "-map", "[o]", "-ac", "2", "-ar", "44100", str(out)]
    p = subprocess.run(cmd, capture_output=True, timeout=300)
    if p.returncode or not out.is_file() or out.stat().st_size < 100:
        out.unlink(missing_ok=True)
        return None
    return {"url": "/api/song/audio?id=" + _remember_audio(out)}


def audio_file(query: str) -> Path | None:
    aid = (parse_qs(query).get("id") or [""])[0]
    p = S()["audio"].get(aid)
    return p if p is not None and p.is_file() else None


# ----------------------------------------------------------------------------------------------------- the film
def _same_plan(page: dict, view: dict) -> bool:
    """The plan on the screen is the plan the engine made: the same words, each said by the same clip at the same seconds, the same gaps. (The screens add nothing the build could not do.)"""
    def sig(p):
        return [[(w["w"], w["status"], w.get("file_name"), w.get("src_s"), w.get("src_e")) for w in ln["words"] if not w.get("quiet")] for ln in p["lines"]]
    return sig(page) == sig(view)                               # the page's own plan has no id (its model keeps only what it shows); the engine's id is the one passed on


def render(body: dict) -> dict:
    if _dm.blur_refusal():
        raise Problem(_dm.blur_refusal())
    ans = S().get("plan")
    plan = validate_plan(body.get("plan"))
    if not ans:
        raise Problem("Build your song and look at it first, then make the film.")
    if any(w.get("quiet") and w["status"] != "gap" for ln in plan["lines"] for w in ln["words"]):
        raise Problem("Only a gap can be left quiet. Press Build again.")
    if plan.get("plan_id") is not None and plan["plan_id"] != ans["plan_id"]:
        raise Problem("The plan on the screen is not the one that was built here. Press Build again, look at it, then make the film.")
    if not _same_plan(plan, ans["view"]):
        raise Problem("The plan on the screen is not the one that was built here. Press Build again, look at it, then make the film.")
    for p, _slot in S()["binds"]:
        if not p.exists():
            raise Problem(f"{p.name} is no longer where it was. Choose your videos again and press Build.")
    _claim()
    try:
        out_dir = _dm.STATE["out"]
        out_dir.mkdir(parents=True, exist_ok=True)
        out = out_dir / f"song-{time.strftime('%Y%m%d-%H%M%S')}.mp4"
        args = ["build", str(S()["recipe"]), "--work-dir", str(S()["work"] / "w"), "--model", _dm.default_model(), "--out", str(out), "--approve-plan", ans["plan_id"]]
        args += sum([["--bind", f"{slot}={p}"] for p, slot in S()["binds"]], []) + ["--bind", f"music={S()['built_music']}"] + (["--bind", f"guide={S()['built_guide']}"] if S().get("built_guide") else [])
        args += ["--forge"] if S().get("forge") else []
        rc, so, err = _run(args, "build")
        if rc != 0:
            for f in (out, out.with_suffix(".receipt.json")):
                f.unlink(missing_ok=True)
            raise Problem(NONE_SAID if rc == 3 else plain(err.strip().splitlines()[-1] if err.strip() else "", "network" if rc == 4 else "other"))
        rp = out.with_suffix(".receipt.json")
        try:
            rcpt = json.loads(rp.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            rcpt = {}
        _dm.STATE["last_film"] = str(out)
        return {"message": film_ready_message(out.name, out_dir.name, rcpt), "film": out.name}
    finally:
        _release()


def film_ready_message(film_name: str, folder_name: str, rcpt: dict) -> str:
    """What the page says when the film is made. 'The word furthest from its beat' is only the words that WERE measured, so the words that ran on from the word before (the build cannot measure
    them: BUILDER's songjoined, receipt rows with joined_to_previous and no measured offset) are counted and named next to it: 'complete' is never read as 'every word measured on the beat'."""
    rcpt = rcpt if isinstance(rcpt, dict) else {}
    worst = (rcpt.get("offsets") or {}).get("max_abs_ms")
    built = len(rcpt.get("built_from_sounds") or [])
    joined = sum(1 for w in (rcpt.get("words") or []) if isinstance(w, dict) and w.get("joined_to_previous") and w.get("measured_offset_ms") is None)
    msg = f"Your film is ready: {film_name}, in {folder_name}."
    if worst is not None:
        msg += f" Measured on the finished film, the word furthest from its beat is {worst} ms off."
    if joined:
        msg += f" {joined} {'word ran' if joined == 1 else 'words ran'} together with the word before and {'was' if joined == 1 else 'were'} not measured."
    if built:
        msg += f" {built} {'word is' if built == 1 else 'words are'} built from sounds, and the receipt says so."
    return msg


# ----------------------------------------------------------------------------------------------------- routes
def get(path: str, query: str, send, send_json, auth, host_ok) -> bool:
    """True when this module answered. `send(code, body, ctype, csp=None)`, `send_json(code, obj)`, `auth(query_ok=)` -> bool (it has already sent the refusal when False)."""
    if not (path in ASSETS or path.startswith("/api/song")):
        return False
    if not on():
        send_json(404, {"error": "Not found."})
        return True
    if path in ASSETS:
        if path == "/song" and not auth(query_ok=True):
            return True
        if path != "/song" and not host_ok():
            send_json(403, {"error": "no"})
            return True
        name, ctype = ASSETS[path]
        send(200, (PAGE_DIR / name).read_bytes(), ctype, SONG_CSP)
        return True
    if not auth():
        return True
    if path == "/api/song":
        send_json(200, load())
    elif path == "/api/song/audio":
        f = audio_file(query)
        if f is None:
            send_json(404, {"error": "That sound is not there any more."})
        else:
            send(200, f.read_bytes(), "audio/wav", SONG_CSP)
    else:
        send_json(404, {"error": "Not found."})
    return True


def post(path: str, body: dict, send_json) -> bool:
    if not path.startswith("/api/song"):
        return False
    if not on():
        send_json(404, {"error": "Not found."})
        return True
    try:
        if path == "/api/song":
            send_json(200, save(body))
        elif path == "/api/song/videos":
            send_json(200, pick_videos())
        elif path == "/api/song/folder":
            send_json(200, pick_folder())
        elif path in ("/api/song/track", "/api/song/guide"):
            send_json(200, pick_sound(path.rpartition("/")[2]))
        elif path == "/api/song/build":
            send_json(200, build(body))
        elif path == "/api/song/hear":
            send_json(200, hear(body))
        elif path == "/api/song/render":
            send_json(200, render(body))
        else:
            send_json(404, {"error": "Not found."})
    except Problem as e:
        send_json(400, {"error": str(e)})
    return True
