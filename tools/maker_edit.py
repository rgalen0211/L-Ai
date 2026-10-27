"""The edit page's side of the desktop maker (NEXT-CONNECT 113b; contract: docs/maker-edit-host-contract.md, WEB's page in tools/maker-edit/).

Off unless the maker is started with --edit. The routes (all behind the maker's token, 127.0.0.1 only, nothing leaves this computer):

    GET  /edit, /edit.js, /edit-model.js, /edit.css       the page WEB built, served with its own content policy
    GET  /api/edit                                        the saved edit list (edit.json in the films folder), or, if there is none, the one made from the last Plan
    POST /api/edit                                        save the page's list (checked again: schema, names only, no place on this computer in any field)
    GET  /api/edit/proxy, POST /api/edit/proxy            the small preview film (the clips joined at 360p, nothing drawn): its state and address; POST rebuilds it for the list sent
    GET  /api/edit/proxy/file                             that preview, with Range so the player can seek (the token is in the address: a video element cannot send a header, as for /film)
    POST /api/image/pick, GET /api/image/file?id=         the operating system's picture dialog (a real still PNG, JPEG or WEBP only); the picture's bytes, with the token header
    POST /api/edit/render                                 the film: ENGINE's `build-edit` for the list sent, one at a time

The engine does the work in its own process (python -m ryagram.local build-edit), exactly as the main page's Plan and Build do. Files are named to the page by NAME only (a folder's videos
by folder-relative names); paths stay in this process. Stdlib only."""
from __future__ import annotations

import hashlib
import json
import os
import re
import secrets
import shutil
import struct
import subprocess
import sys
import threading
import time
from pathlib import Path
from urllib.parse import parse_qs

import maker_song as MS

HERE = Path(__file__).resolve().parent
PAGE_DIR = HERE / "maker-edit"
ASSETS = {"/edit": ("edit.html", "text/html; charset=utf-8"), "/edit.js": ("edit.js", "text/javascript; charset=utf-8"), "/edit-model.js": ("edit-model.js", "text/javascript; charset=utf-8"),
          "/edit.css": ("edit.css", "text/css; charset=utf-8")}
EDIT_CSP = ("default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; base-uri 'none'; form-action 'none'; "
            "frame-ancestors 'none'")
SCHEMA = "ryagram.maker-edit/0"
MAX_LIST_BYTES = 600_000
MAX_IMAGE_BYTES = 20_000_000
MAX_IMAGE_PIXELS = 25_000_000
NO_ENGINE = "This copy of Ryagram cannot edit a film yet."
_dm = None
_PROXY_LOCK = threading.Lock()                # one preview is built at a time; a second request waits its turn and then builds the NEWEST list (it never blocks a render)


Problem = MS.Problem                       # a sentence for the person


def attach(dm) -> None:
    global _dm
    _dm = dm
    dm.STATE.setdefault("edit", {"images": {}, "proxy": {"state": "none", "path": None, "seq": 0}, "busy": False, "media_items": []})
    MS.attach(dm)


def S() -> dict:
    return _dm.STATE["edit"]


def on() -> bool:
    return bool(_dm and _dm.STATE.get("edit_on"))


def _eb():
    try:
        from ryagram.local import editbuild  # noqa: PLC0415
    except ImportError:
        raise Problem(NO_ENGINE) from None
    return editbuild


# ----------------------------------------------------------------------------------------------------- pictures
def inspect_image(path: Path) -> dict:
    """{kind, width, height} from the picture's own first bytes; a Problem unless it is a still PNG, JPEG or WEBP of a sane size."""
    if not path.is_file():
        raise Problem("That picture is not there.")
    if path.stat().st_size > MAX_IMAGE_BYTES:
        raise Problem("That picture is larger than 20 MB.")
    with open(path, "rb") as fh:
        head = fh.read(65536)
        kind = None
        w = h = 0
        if head[:8] == b"\x89PNG\r\n\x1a\n" and head[12:16] == b"IHDR":
            kind, (w, h) = "png", struct.unpack(">II", head[16:24])
            if b"acTL" in head:
                raise Problem("An animated picture is not accepted. Choose a still PNG, JPEG or WEBP.")
        elif head[:3] == b"\xff\xd8\xff":
            kind, i = "jpeg", 2
            while i + 9 < len(head):
                if head[i] != 0xFF:
                    i += 1
                    continue
                m = head[i + 1]
                if m in (0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF):
                    h, w = struct.unpack(">HH", head[i + 5:i + 9])
                    break
                i += 2 + struct.unpack(">H", head[i + 2:i + 4])[0]
        elif head[:4] == b"RIFF" and head[8:12] == b"WEBP":
            kind = "webp"
            if head[12:16] == b"VP8X":
                if head[20] & 0x02:
                    raise Problem("An animated picture is not accepted. Choose a still PNG, JPEG or WEBP.")
                w, h = 1 + int.from_bytes(head[24:27], "little"), 1 + int.from_bytes(head[27:30], "little")
            elif head[12:16] == b"VP8 ":
                w, h = struct.unpack("<HH", head[26:30])
                w, h = w & 0x3FFF, h & 0x3FFF
            elif head[12:16] == b"VP8L":
                b = struct.unpack("<I", head[21:25])[0]
                w, h = (b & 0x3FFF) + 1, ((b >> 14) & 0x3FFF) + 1
    if kind is None or not w or not h:
        raise Problem("That is not a still PNG, JPEG or WEBP picture.")
    if w * h > MAX_IMAGE_PIXELS:
        raise Problem("That picture is larger than 25 million pixels.")
    return {"kind": kind, "width": int(w), "height": int(h)}


def pick_image_dialog() -> str | None:
    """The operating system's own dialog for ONE picture (own process: tkinter must own its thread). The check replaces only this function."""
    code = ("import tkinter as tk\nfrom tkinter import filedialog\nr = tk.Tk(); r.withdraw(); r.attributes('-topmost', True)\n"
            "ft = [('Pictures', '*.png *.jpg *.jpeg *.webp')]\n"
            "res = filedialog.askopenfilename(title='Choose a picture', filetypes=ft)\nimport json; print(json.dumps(res or ''))")
    r = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, encoding="utf-8", timeout=600)
    try:
        return json.loads(r.stdout.strip().splitlines()[-1]) or None
    except Exception:  # noqa: BLE001
        return None


def pick_image() -> dict:
    got = pick_image_dialog()
    if not got:
        return {}
    p = Path(got)
    info = inspect_image(p)
    digest = hashlib.sha256(p.read_bytes()).hexdigest()
    iid = "img-" + digest[:8]
    S()["images"][iid] = p.resolve()
    _dm.remember_dirs([p])
    return {"image": {"id": iid, "file_name": p.name, "sha256": digest, "width": info["width"], "height": info["height"]}}


IMAGE_EXTS = (".png", ".jpg", ".jpeg", ".webp")
MAX_FOLDER_IMAGES = 100


def pick_image_folder_dialog() -> str | None:
    """The operating system's own dialog for ONE folder of pictures (own process: tkinter must own its thread). The check replaces only this function."""
    code = ("import tkinter as tk\nfrom tkinter import filedialog\nr = tk.Tk(); r.withdraw(); r.attributes('-topmost', True)\n"
            "res = filedialog.askdirectory(title='Choose a folder of pictures', mustexist=True)\nimport json; print(json.dumps(res or ''))")
    r = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, encoding="utf-8", timeout=600)
    try:
        return json.loads(r.stdout.strip().splitlines()[-1]) or None
    except Exception:  # noqa: BLE001
        return None


def pick_image_folder() -> dict:
    """ONE folder of the person's pictures: every real still PNG, JPEG or WEBP in it at any depth (never through a link or junction, in a fixed order, at most MAX_FOLDER_IMAGES), each named
    FOLDER-RELATIVE with its folder's name in front. The answer holds names, sizes and hashes, never a path."""
    got = pick_image_folder_dialog()
    if not got:
        return {}
    folder = Path(got)
    if not folder.is_dir():
        raise Problem("That is not a folder.")
    try:
        from ryagram.local import folders as FO      # noqa: PLC0415  (the engine's own junction-safe walk)
    except ImportError:
        raise Problem("This copy of Ryagram cannot read a whole folder yet. Choose the pictures one by one.") from None
    found = FO.videos_in(folder, IMAGE_EXTS)
    images, skipped = [], 0
    for rel, q in found:
        if len(images) >= MAX_FOLDER_IMAGES:
            break
        try:
            info = inspect_image(q)
        except Problem:
            skipped += 1
            continue
        digest = hashlib.sha256(q.read_bytes()).hexdigest()
        iid = "img-" + digest[:8]
        S()["images"][iid] = q.resolve()
        images.append({"id": iid, "file_name": folder.name + "/" + rel, "sha256": digest, "width": info["width"], "height": info["height"]})
    _dm.remember_dirs([folder / "x"])
    msg = f"{len(found)} picture{'s' if len(found) != 1 else ''} found in {folder.name}; {len(images)} used."
    if skipped:
        msg += f" {skipped} {'was' if skipped == 1 else 'were'} not a real still picture of a usable size and {'was' if skipped == 1 else 'were'} left out."
    if len(images) >= MAX_FOLDER_IMAGES and len(found) - skipped > len(images):
        msg += f" At most {MAX_FOLDER_IMAGES} pictures are used."
    if not images:
        raise Problem(f"There is no picture (PNG, JPEG or WEBP) in {folder.name}.")
    return {"folder": {"name": folder.name, "found": len(found), "used": len(images), "message": msg}, "images": images}


def image_bytes(query: str):
    iid = (parse_qs(query).get("id") or [""])[0]
    p = S()["images"].get(iid)
    if p is None or not p.is_file():
        return None
    kind = inspect_image(p)["kind"]
    return p.read_bytes(), {"png": "image/png", "jpeg": "image/jpeg", "webp": "image/webp"}[kind]


# ----------------------------------------------------------------------------------------------------- the list
def edit_path() -> Path:
    return _dm.STATE["out"] / "edit.json"


def check_list(edit) -> dict:
    """The page's list checked again before it is written: right schema, a sane size, and no place on this computer in ANY text (the clips, the pictures and the words are named, never located)."""
    if not isinstance(edit, dict) or edit.get("schema") != SCHEMA:
        raise Problem("That is not an edit list this program wrote.")
    if len(json.dumps(edit)) > MAX_LIST_BYTES:
        raise Problem("That edit list is too large to save.")
    for s in MS._walk_strings(edit):
        if MS._PATHISH.search(s) and len(s) < 300 and not s.startswith("http"):
            raise Problem("An edit list holds file names only, never a place on this computer.")
    clips = edit.get("clips")
    if not isinstance(clips, list) or not clips or len(clips) > 600:
        raise Problem("An edit list needs 1 to 600 clips.")
    return edit


def _media_items_from_plan() -> list:
    args = _dm.STATE.get("last_plan_args") or []
    items = []
    for a in args:
        raw = str(a).partition("=")[2]
        path = re.sub(r"#[0-9]+-[0-9]+$", "", raw) if not Path(raw).exists() else raw
        if path and path not in items:
            items.append(path)
    return items


def _media_items() -> list:
    if S().get("media_items"):
        return S()["media_items"]
    f = _dm.STATE["work"] / "edit-media.json"
    if f.is_file():
        try:
            return [str(x) for x in json.loads(f.read_text(encoding="utf-8"))]
        except (OSError, ValueError):
            return []
    return []


def _remember_media(items: list) -> None:
    S()["media_items"] = list(items)
    f = _dm.STATE["work"] / "edit-media.json"
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text(json.dumps(list(items)), encoding="utf-8")            # paths, local only: this file is never put in a plan, a list or a receipt


def load() -> dict:
    f = edit_path()
    if f.is_file():
        try:
            return {"edit": check_list(json.loads(f.read_text(encoding="utf-8")))}
        except (OSError, ValueError, Problem):
            pass
    plan = _dm.STATE.get("last_plan")
    if not plan:
        raise Problem("Press Plan first. The edit page opens on the rough cut that Plan makes.")
    eb = _eb()
    items = _media_items_from_plan()
    try:
        media = eb.resolve_media(items)
        lst = eb.initial_edit(plan, media)
    except (eb.EditError, OSError) as e:
        raise Problem(MS.plain(str(e), "other")) from None
    _remember_media(items)
    return {"edit": lst}


def save(body: dict) -> dict:
    lst = check_list(body.get("edit"))
    f = edit_path()
    f.parent.mkdir(parents=True, exist_ok=True)
    tmp = f.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(lst, indent=1, ensure_ascii=False), encoding="utf-8")
    os.replace(tmp, f)
    return {"saved": True}


# ----------------------------------------------------------------------------------------------------- the engine
def _claim() -> None:
    with _dm.LOCK:
        job = _dm.STATE.get("job")
        if (job and job["proc"].poll() is None) or S()["busy"] or _dm.STATE["song"]["busy"]:
            raise Problem("Something is already running here. Wait for it to finish.")
        S()["busy"] = True


def _release() -> None:
    S()["busy"] = False


def _engine_takes_previous() -> bool:
    """True when this engine's build-edit has --previous (FACES 63: the last committed edit list, so a final film cannot quietly drop footage marked as AI-altered)."""
    try:
        return "--previous" in (Path(_dm.STATE["engine"]) / "ryagram" / "local" / "__main__.py").read_text(encoding="utf-8")
    except OSError:
        return False


def _args_for(lst: dict, out: Path, work: Path, proxy: bool) -> list:
    f = work / ("proxy-edit.json" if proxy else "render-edit.json")
    work.mkdir(parents=True, exist_ok=True)
    f.write_text(json.dumps(lst), encoding="utf-8")
    args = ["build-edit", str(f), "--work-dir", str(work / "w"), "--out", str(out)]
    committed = work / "committed-edit.json"
    if not proxy and committed.is_file() and _engine_takes_previous():
        args += ["--previous", str(committed)]
    for item in _media_items():
        args += ["--media", item]
    for iid, path in sorted(S()["images"].items()):
        args += ["--image", f"{iid}={path}"]
    return args + (["--proxy"] if proxy else [])


def _run_engine(args: list) -> tuple:
    env = dict(os.environ, PYTHONPATH=str(_dm.STATE["engine"]), PYTHONIOENCODING="utf-8", NO_PROXY="127.0.0.1,localhost")
    p = subprocess.run([sys.executable, "-m", "ryagram.local"] + args, cwd=str(_dm.STATE["engine"]), env=env, capture_output=True, text=True, encoding="utf-8", errors="replace")
    return p.returncode, p.stdout, p.stderr


def _sentence(rc: int, err: str) -> str:
    last = err.strip().splitlines()[-1] if err.strip() else ""
    return MS.plain(last, "network" if rc == 4 else "other")


def proxy_state() -> dict:
    p = S()["proxy"]
    if p["state"] == "ready" and p["path"] and Path(p["path"]).is_file():
        return {"state": "ready", "url": f"/api/edit/proxy/file?t={_dm.STATE['token']}&v={p['seq']}"}
    return {"state": p["state"] if p["state"] in ("failed", "updating") else "ready", "url": None}


def rebuild_proxy(body: dict) -> dict:
    lst = check_list(body.get("edit"))
    _eb()
    with _PROXY_LOCK:
        return _rebuild_proxy_locked(lst)


def _rebuild_proxy_locked(lst: dict) -> dict:
    S()["proxy"]["seq"] += 1
    seq = S()["proxy"]["seq"]
    out = _dm.STATE["work"] / "edit" / f"proxy-{seq}.mp4"
    out.parent.mkdir(parents=True, exist_ok=True)
    rc, _so, err = _run_engine(_args_for(lst, out, _dm.STATE["work"] / "edit", True))
    if rc != 0 or not out.is_file():
        S()["proxy"].update(state="failed", path=None)
        return {"state": "failed", "url": None}
    old = S()["proxy"].get("path")
    S()["proxy"].update(state="ready", path=str(out))
    if old and old != str(out):
        Path(old).unlink(missing_ok=True)
    return proxy_state()


def render(body: dict) -> dict:
    lst = check_list(body.get("edit"))
    _eb()
    _claim()
    try:
        out_dir = _dm.STATE["out"]
        out_dir.mkdir(parents=True, exist_ok=True)
        out = out_dir / f"edit-{time.strftime('%Y%m%d-%H%M%S')}.mp4"
        rc, _so, err = _run_engine(_args_for(lst, out, _dm.STATE["work"] / "edit", False))
        if rc != 0:
            for f in (out, out.with_suffix(".receipt.json")):
                f.unlink(missing_ok=True)
            raise Problem(_sentence(rc, err))
        try:
            rcpt = json.loads(out.with_suffix(".receipt.json").read_text(encoding="utf-8"))
        except (OSError, ValueError):
            rcpt = {}
        _dm.STATE["last_film"] = str(out)
        try:
            shutil.copyfile(_dm.STATE["work"] / "edit" / "render-edit.json", _dm.STATE["work"] / "edit" / "committed-edit.json")     # the list this film was built from: the next final film is checked against it
        except OSError:
            pass
        msg = f"Your film is ready: {out.name}, in {out_dir.name}."
        if rcpt.get("seconds"):
            msg += f" It is {rcpt['seconds']:.0f} seconds long."
        miss = [r["phrase"] for r in (rcpt.get("overlays") or {}).get("rules", []) if r.get("times") == 0]
        if miss:
            msg += " Nothing was drawn for: " + ", ".join(f"“{m}”" for m in miss) + " (not said in this film)."
        return {"message": msg, "film": out.name}
    finally:
        _release()


# ----------------------------------------------------------------------------------------------------- routes
def get(path: str, query: str, send, send_json, auth, host_ok, send_file) -> bool:
    if not (path in ASSETS or path.startswith("/api/edit") or path == "/api/image/file"):
        return False
    if not on():
        send_json(404, {"error": "Not found."})
        return True
    try:
        if path in ASSETS:
            if path == "/edit" and not auth(query_ok=True):
                return True
            if path != "/edit" and not host_ok():
                send_json(403, {"error": "no"})
                return True
            name, ctype = ASSETS[path]
            send(200, (PAGE_DIR / name).read_bytes(), ctype, EDIT_CSP)
            return True
        if path == "/api/edit/proxy/file":
            if not auth(query_ok=True):
                return True
            p = S()["proxy"].get("path")
            if not p or not Path(p).is_file():
                send_json(404, {"error": "There is no preview yet."})
            else:
                send_file(Path(p))
            return True
        if not auth():
            return True
        if path == "/api/edit":
            send_json(200, load())
        elif path == "/api/edit/proxy":
            send_json(200, proxy_state())
        elif path == "/api/image/file":
            got = image_bytes(query)
            if got is None:
                send_json(404, {"error": "That picture is not there any more."})
            else:
                send(200, got[0], got[1], EDIT_CSP)
        else:
            send_json(404, {"error": "Not found."})
    except Problem as e:
        send_json(400, {"error": str(e)})
    return True


def post(path: str, body: dict, send_json) -> bool:
    if not (path.startswith("/api/edit") or path in ("/api/image/pick", "/api/image/folder")):
        return False
    if not on():
        send_json(404, {"error": "Not found."})
        return True
    try:
        if path == "/api/edit":
            send_json(200, save(body))
        elif path == "/api/edit/proxy":
            send_json(200, rebuild_proxy(body))
        elif path == "/api/edit/render":
            send_json(200, render(body))
        elif path == "/api/image/pick":
            send_json(200, pick_image())
        elif path == "/api/image/folder":
            send_json(200, pick_image_folder())
        else:
            send_json(404, {"error": "Not found."})
    except Problem as e:
        send_json(400, {"error": str(e)})
    return True
