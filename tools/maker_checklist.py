"""GUIDED FOOTAGE: the media checklist beside the request (NEXT-CONNECT 161, PUNCH P10). Standard library only. LOCAL ONLY.

The person's AI may write a checklist into its compilation request: footage the PERSON gets for themselves (what it is, where they might find it, what it must contain, the NAME of the folder it goes in and how many
files to expect). This module is the desktop app's half: it looks in THIS computer's own folders (the ones the maker already searches: Videos, Downloads, Desktop, Documents, Movies and the folders the person's
files came from), counts the video files in the named folder and says whether the item is done; and it remembers the ticks the person made by hand.

WHAT IT NEVER DOES: it downloads nothing; it makes no network call; it sends nothing anywhere (the counts and the ticks stay in a file in the maker's work folder); it never reads a file's contents (it lists names and
extensions only); it never follows a link (a folder or file that is a shortcut/junction/symlink does not count); it never goes below one level (the files must be IN the named folder); and a folder NAME is looked up only
directly under a folder the maker already searches, so a name can never become a path."""
from __future__ import annotations

import hashlib
import json
import os
import re
import threading
from pathlib import Path

VIDEO_EXTS = (".mp4", ".mkv", ".mov", ".avi", ".webm", ".m4v")
NAME = re.compile(r'^[^\\/:*?"<>|\x00-\x1f]{1,80}$')
KEY = re.compile(r"^[0-9a-f]{16}$")
MAX_ENTRIES = 5000          # entries looked at in one folder, so a huge folder cannot stall the page
MAX_TICKS = 500             # ticks remembered


def item_key(project_id: str, item: dict) -> str:
    """The tick belongs to THIS item of THIS project as the AI wrote it: if the AI changes the item, the old tick no longer applies."""
    raw = "|".join([str(project_id), str(item.get("id", "")), str(item.get("what", "")), str(item.get("folder", "")), str(item.get("count", 1))])
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16]


def _is_link(p: Path) -> bool:
    try:
        if p.is_symlink():
            return True
        is_junction = getattr(p, "is_junction", None)
        return bool(is_junction and is_junction())
    except OSError:
        return True


def folder_for(name: str, roots) -> Path | None:
    """The folder called `name` DIRECTLY inside one of the folders the maker searches, or None. A name that is not a plain name, a link, or something that is not a folder is None."""
    if not isinstance(name, str) or not NAME.match(name) or name in (".", ".."):
        return None
    for root in roots:
        try:
            cand = Path(root) / name
            if cand.is_dir() and not _is_link(cand):
                return cand
        except OSError:
            continue
    return None


def count_videos(folder: Path) -> int:
    """Video files directly in the folder (by extension; names only, never contents); links are not counted."""
    n = seen = 0
    try:
        with os.scandir(folder) as it:
            for e in it:
                seen += 1
                if seen > MAX_ENTRIES:
                    break
                try:
                    if e.is_file(follow_symlinks=False) and e.name.lower().endswith(VIDEO_EXTS):
                        n += 1
                except OSError:
                    continue
    except OSError:
        return 0
    return n


class Ticks:
    """The ticks the person made by hand, in one small file in the maker's work folder."""

    def __init__(self, path: Path):
        self.path = Path(path)
        self._lock = threading.Lock()

    def _read(self) -> dict:
        try:
            d = json.loads(self.path.read_text(encoding="utf-8"))
            return {k: True for k, v in d.items() if KEY.match(k) and v is True} if isinstance(d, dict) else {}
        except (OSError, ValueError):
            return {}

    def get(self) -> set:
        with self._lock:
            return set(self._read())

    def set(self, key: str, done: bool) -> bool:
        if not isinstance(key, str) or not KEY.match(key):
            return False
        with self._lock:
            d = self._read()
            if done:
                d[key] = True
                for old in list(d)[:-MAX_TICKS]:
                    d.pop(old, None)
            else:
                d.pop(key, None)
            try:
                self.path.parent.mkdir(parents=True, exist_ok=True)
                self.path.write_text(json.dumps(d), encoding="utf-8")
            except OSError:
                return False
        return True


def decorate(requests: list, roots, ticks: set) -> list:
    """Each request's checklist items gain: have (videos found in the named folder), found (the folder exists), manual (the person ticked it), done (enough files, or ticked)."""
    out = []
    for r in requests:
        items = []
        for it in r.get("checklist") or []:
            folder = folder_for(it.get("folder"), roots)
            have = count_videos(folder) if folder else 0
            manual = it.get("key") in ticks
            items.append({**it, "found": folder is not None, "have": have, "manual": manual, "done": bool(manual or (folder is not None and have >= int(it.get("count") or 1)))})
        out.append({**r, "checklist": items} if items else r)
    return out
