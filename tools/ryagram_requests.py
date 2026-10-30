"""WHAT YOUR AI ASKED FOR (NEXT-CONNECT 131b; Ryan's go in CC1's window 2026-10-26 ~18:09, part 2). Standard library only.

A person connects their own AI to Ryagram (the connector). The AI may WRITE DOWN a request for a compilation (a phrase, folder names, switches, a note) on one of the person's projects. This
module lets the desktop app, signed in as THIS computer, READ those requests and show them, so the person can do the work here on their own computer from their own videos.

WHAT IT NEVER DOES: it starts nothing (no job, no plan, no build); it uploads nothing (there is no upload, signed address or file in this module, and the one call it makes is the read
POST /node/compilation-requests); it sends no video, sound or path anywhere; it writes no file; it shows only plain text cut to fixed lengths (never markup, never a path or address). The site
answers only with THIS person's requests (the computer's token resolves the person; no argument names an owner). The finished compilation stays on this computer: nothing here hosts it."""
from __future__ import annotations

import re
import threading
import time

import maker_checklist as _mc          # the guided-footage checklist (NEXT-CONNECT 161): the item key and the folder-name rule live there

ROUTE = "/node/compilation-requests"
MIN_GAP_SECONDS = 30            # the page may ask as often as it likes; the site is asked at most this often
MAX_ITEMS = 20
MODES = ("phrase", "song")
SEARCHES = ("every", "words")
_TAGS = re.compile(r"[<>]")
_UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.IGNORECASE)
_LINKISH = re.compile(r"[A-Za-z][A-Za-z0-9+.-]*://|\bwww\.|\b[A-Za-z0-9-]+\.(com|org|net|gov|edu|io|co|us|uk)\b", re.IGNORECASE)
MAX_CHECKLIST = 12
_PATHISH = re.compile(r"([A-Za-z]:[\\/])|(^|\s)/(Users|home|mnt|var|etc)/|\\\\|https?://|file://", re.IGNORECASE)


def _text(v, limit: int) -> str:
    if not isinstance(v, str):
        return ""
    s = _TAGS.sub("", re.sub(r"[\x00-\x1f\x7f]+", " ", v)).strip()
    return s[:limit]


def _item(it, pid: str, index: int) -> dict | None:
    """One checklist item as the page shows it: plain, cut-down text only. An item with no words, with a link or a place in its words, or with a folder that is not a plain NAME is dropped; in the optional texts a link or place is blanked."""
    if not isinstance(it, dict):
        return None
    what = _text(it.get("what"), 200)
    if not what or _PATHISH.search(what) or _LINKISH.search(what):
        return None
    where = _text(it.get("from"), 200)
    must = _text(it.get("must_contain"), 200)
    if _PATHISH.search(where) or _LINKISH.search(where):
        where = ""
    if _PATHISH.search(must) or _LINKISH.search(must):
        must = ""
    folder = it.get("folder")
    folder = folder.strip() if isinstance(folder, str) else ""
    if not _mc.NAME.match(folder) or folder in (".", ".."):
        return None
    count = it.get("count")
    count = count if isinstance(count, int) and not isinstance(count, bool) and 1 <= count <= 20 else 1
    iid = it.get("id") if isinstance(it.get("id"), str) and re.match(r"^c[0-9]{1,2}$", it.get("id")) else f"c{index + 1}"
    d = {"id": iid, "what": what, "from": where, "must_contain": must, "folder": folder, "count": count}
    d["key"] = _mc.item_key(pid, d)
    return d


def _clean(row) -> dict | None:
    """One request as the page shows it: only plain, cut-down text. A row that is not an object, or has no phrase, is dropped."""
    if not isinstance(row, dict):
        return None
    req = row.get("request")
    if not isinstance(req, dict):
        return None
    phrase = _text(req.get("phrase"), 300)
    if not phrase:
        return None
    note = _text(req.get("note"), 500)
    mode = req.get("mode") if req.get("mode") in MODES else "phrase"
    search = req.get("search") if req.get("search") in SEARCHES else "every"
    pid = row.get("project_id")
    pid = pid if isinstance(pid, str) and _UUID.match(pid) else ""
    raw_list = req.get("checklist") if isinstance(req.get("checklist"), list) else []
    checklist = [c for c in (_item(x, pid, i) for i, x in enumerate(raw_list[:MAX_CHECKLIST])) if c]
    out = {"title": _text(row.get("title"), 200), "phrase": phrase, "mode": mode, "search": search, "note": "" if _PATHISH.search(note) else note,
           "updated_at": _text(row.get("updated_at"), 40), "project_id": pid}
    if checklist:
        out["checklist"] = checklist
    return out


class AiRequests:
    def __init__(self, signin, *, clock=time.time):
        self.signin = signin
        self.clock = clock
        self._lock = threading.Lock()
        self._last = 0.0
        self._items: list = []
        self._message = ""

    def status(self, force: bool = False) -> dict:
        """{"on": False} when this computer is not signed in (no card, nothing asked). Otherwise the requests last read (at most every MIN_GAP_SECONDS) and a plain message when the read failed."""
        try:
            signed_in = self.signin.status().get("state") == "signed_in"
        except Exception:  # noqa: BLE001
            signed_in = False
        if not signed_in:
            with self._lock:
                self._items, self._message, self._last = [], "", 0.0
            return {"on": False}
        with self._lock:
            now = self.clock()
            if force or self._last == 0.0 or now - self._last >= MIN_GAP_SECONDS:
                self._last = now
                self._refresh()
            return {"on": True, "requests": list(self._items), "message": self._message}

    def _refresh(self) -> None:
        try:
            status, obj = self.signin.api("POST", ROUTE, {})
        except Exception as e:  # noqa: BLE001  (a removed computer, no internet, a server error: the card keeps what it had and says so in words)
            self._message = _text(str(e), 200) or "Could not read what your AI asked for just now."
            return
        if status != 200 or not isinstance(obj, dict) or not isinstance(obj.get("requests"), list):
            self._message = "Could not read what your AI asked for just now."
            return
        items = [c for c in (_clean(r) for r in obj["requests"][:MAX_ITEMS]) if c]
        self._items, self._message = items, ""
