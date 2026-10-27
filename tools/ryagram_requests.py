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

ROUTE = "/node/compilation-requests"
MIN_GAP_SECONDS = 30            # the page may ask as often as it likes; the site is asked at most this often
MAX_ITEMS = 20
MODES = ("phrase", "song")
SEARCHES = ("every", "words")
_TAGS = re.compile(r"[<>]")
_UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.IGNORECASE)
_PATHISH = re.compile(r"([A-Za-z]:[\\/])|(^|\s)/(Users|home|mnt|var|etc)/|\\\\|https?://|file://", re.IGNORECASE)


def _text(v, limit: int) -> str:
    if not isinstance(v, str):
        return ""
    s = _TAGS.sub("", re.sub(r"[\x00-\x1f\x7f]+", " ", v)).strip()
    return s[:limit]


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
    return {"title": _text(row.get("title"), 200), "phrase": phrase, "mode": mode, "search": search, "note": "" if _PATHISH.search(note) else note,
            "updated_at": _text(row.get("updated_at"), 40), "project_id": pid if isinstance(pid, str) and _UUID.match(pid) else ""}


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
