"""PRIVATE LINKS for a film made on this computer (NEXT-CONNECT 120, for PAID PLANS; paper: proposals\\CONNECT-COMPILATION-DELIVERY-PAPER.md). Standard library only. OFF by default; nothing is live.

The film stays on this computer. ONLY when the person presses "Get a private link" (after ticking that they have the right to share what is in the film) is the ONE finished file sent to Ryagram,
where it is kept 30 days, private, and opened by them alone through a link made fresh each time. Their original videos are never touched or sent.

THE LAUNCH CHECK (the personal-engine pathway, as Claude's item 120 words it): the app is signed in to the Ryagram account and asks the site what the plan allows (POST /node/compilation/status). The answer
is kept on this computer and may be used for up to 7 days without the internet (the same 7 days the sign-in already counts); after that the button is locked until the next check. The SITE re-checks plan,
switch and limits on every start and every finish, so a stale answer here never uploads for a lapsed plan: this check only decides whether to SHOW the button.

THREE independent OFFs: a flag file in this app's folder (ryagram-links.json {"on": true}, absent = off), the site's own switch, and the edge function's setting. Any one of them off = no button, no upload.

WHAT IT NEVER DOES: it sends nothing unless asked; it sends only a file inside the films folder that ends in .mp4 (names only from the page, never a path); the signed upload address must be on the site's
own host; no account detail, token or path is ever put in a message or a file it writes."""
from __future__ import annotations

import hashlib
import json
import re
import threading
import time
from pathlib import Path

SWITCH_NAME = "ryagram-links.json"                 # {"on": true}; absent or anything else = off
CACHE_NAME = "ryagram-links-status.json"           # the last launch check, so the button can show offline for up to 7 days
LIST_NAME = "ryagram-links-list.json"              # what this computer has sent (names, sizes, dates; no path)
GRACE_SECONDS = 7 * 24 * 3600
MAX_TITLE = 200


class LinksError(Exception):
    def __init__(self, message: str, kind: str = "other"):
        super().__init__(message)
        self.kind = kind


def _int(v, default=None):
    return v if isinstance(v, int) and not isinstance(v, bool) and v >= 0 else default


def _clean_status(s) -> dict:
    """Only the fields we know, only of the right kind: whatever else the site sent is dropped."""
    s = s if isinstance(s, dict) else {}
    return {"switch_on": s.get("switch_on") is True, "plan": s.get("plan") if isinstance(s.get("plan"), str) and re.fullmatch(r"[a-z0-9_]{1,40}", s.get("plan")) else None,
            "active": s.get("active") is True, "allowed": s.get("allowed") is True, "max_film_bytes": _int(s.get("max_film_bytes")), "max_kept_bytes": _int(s.get("max_kept_bytes")),
            "starts_per_hour": _int(s.get("starts_per_hour")), "kept_bytes": _int(s.get("kept_bytes"), 0)}


def _why_not(s: dict) -> str:
    if not s["switch_on"]:
        return "Private links are not switched on yet."
    if not s["active"]:
        return "Private links are part of a Ryagram plan. Choose a plan on the Ryagram website, then check again."
    return "Your plan does not include private links for films made on your computer."


def _mb(n) -> str:
    return f"{max(1, round((n or 0) / 1048576))} MB"


class PrivateLinks:
    def __init__(self, signin, folder, *, films_dir, uploader=None, clock=time.time, log=None):
        self.signin = signin
        self.folder = Path(folder)
        self.films = Path(films_dir)
        self.clock = clock
        self._log = log or (lambda ev: None)
        if uploader is None:
            from ryagram_node import put_file                  # the node loop's own upload: host-checked, no account header, no redirects
            uploader = put_file
        self.uploader = uploader
        self._lock = threading.RLock()
        self._state = {"phase": "idle", "message": "", "film": None}
        self._thread = None

    # ---- the flag: off unless the file says on (read each time, so it can be flipped without a restart)
    @property
    def on(self) -> bool:
        try:
            return json.loads((self.folder / SWITCH_NAME).read_text(encoding="utf-8")).get("on") is True
        except (OSError, ValueError, AttributeError):
            return False

    def _read(self, name, default):
        try:
            return json.loads((self.folder / name).read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return default

    def _write(self, name, obj):
        try:
            self.folder.mkdir(parents=True, exist_ok=True)
            (self.folder / name).write_text(json.dumps(obj), encoding="utf-8")
        except OSError:
            pass

    # ---- the launch check
    def check(self) -> dict:
        """{allowed, offline, reason, status, checked_at, days_old}. Asks the site; when it cannot be reached, uses the last answer for up to 7 days."""
        out = {"allowed": False, "offline": False, "reason": "", "status": None, "checked_at": None, "days_old": None}
        if not self.on:
            out["reason"] = "off"
            return out
        sig = self.signin.status()
        if sig.get("state") != "signed_in":
            out["reason"] = "Sign in to Ryagram (above) to get private links."
            return out
        now = self.clock()
        try:
            status, r = self.signin.api("POST", "/node/compilation/status", {})
        except Exception as e:                                                          # noqa: BLE001  (offline, removed, an odd reply: all the same to the button)
            if getattr(e, "kind", "") == "removed":
                out["reason"] = str(e)
                return out
            cached = self._read(CACHE_NAME, None)
            if isinstance(cached, dict) and isinstance(cached.get("status"), dict) and isinstance(cached.get("fetched_at"), (int, float)) and 0 <= now - cached["fetched_at"] <= GRACE_SECONDS:
                s = _clean_status(cached["status"])
                out.update(status=s, offline=True, checked_at=cached["fetched_at"], days_old=int((now - cached["fetched_at"]) // 86400), allowed=s["allowed"])
                out["reason"] = "" if s["allowed"] else _why_not(s)
                return out
            out.update(offline=True, reason="I could not reach Ryagram, and your plan was last checked more than 7 days ago (or never). Connect to the internet once, then check again.")
            return out
        if status == 404:
            out["reason"] = "Private links are not available yet."
            return out
        if status != 200 or not isinstance(r.get("status"), dict):
            out["reason"] = "Ryagram would not say what your plan allows. Try again in a minute."
            return out
        s = _clean_status(r["status"])
        self._write(CACHE_NAME, {"fetched_at": now, "status": s})
        out.update(status=s, checked_at=now, days_old=0, allowed=s["allowed"], reason="" if s["allowed"] else _why_not(s))
        return out

    # ---- what the page may see
    def status(self, film_name: str | None = None) -> dict:
        if not self.on:
            return {"on": False}
        c = self.check()
        s = c["status"]
        with self._lock:
            up = dict(self._state)
        return {"on": True, "allowed": c["allowed"], "offline": c["offline"], "reason": c["reason"], "days_old": c["days_old"], "plan": s and s["plan"],
                "max_film": s and s["max_film_bytes"] and _mb(s["max_film_bytes"]), "kept": s and _mb(s["kept_bytes"]) if s and s["kept_bytes"] else None, "film": film_name,
                "upload": up, "links": self.links()}

    def links(self) -> list:
        raw = self._read(LIST_NAME, [])
        return [x for x in raw if isinstance(x, dict)][-20:] if isinstance(raw, list) else []

    # ---- the one upload
    def _film(self, name: str) -> Path:
        if not isinstance(name, str) or not name or "/" in name or "\\" in name or ":" in name or name.startswith(".") or not name.lower().endswith(".mp4"):
            raise LinksError("Choose a finished film from your films folder.", "film")
        p = self.films / name
        if p.is_symlink() or not p.is_file() or p.resolve().parent != self.films.resolve():
            raise LinksError("That film is not in your films folder any more.", "film")
        if p.stat().st_size < 1:
            raise LinksError("That film is empty.", "film")
        return p

    def _set(self, phase, message="", film=None):
        with self._lock:
            self._state = {"phase": phase, "message": message, "film": film}

    def upload(self, film_name: str, title: str, rights) -> dict:
        """Send the ONE finished film. Raises LinksError with a plain sentence. Only after a LIVE check says the plan allows it (a cached answer only shows the button)."""
        if not self.on:
            raise LinksError("Private links are switched off in this copy.", "off")
        if rights is not True:
            raise LinksError("Tick that you have the right to share what is in this film.", "rights")
        title = " ".join(str(title or "").split())
        if not 1 <= len(title) <= MAX_TITLE:
            raise LinksError("Give the film a title of 1 to 200 letters.", "title")
        path = self._film(film_name)
        self._set("checking", "Checking your plan.", film_name)
        c = self.check()
        if c["offline"]:
            raise LinksError("I could not reach Ryagram. A private link needs the internet for the upload; try again when you are online.", "offline")
        if not c["allowed"]:
            raise LinksError(c["reason"] or "Private links are not available.", "not_allowed")
        s = c["status"]
        size = path.stat().st_size
        if s["max_film_bytes"] is not None and size > s["max_film_bytes"]:
            raise LinksError(f"This film is {_mb(size)}. Your plan allows {_mb(s['max_film_bytes'])} for a private link. Make it shorter or smaller.", "too_large")
        self._set("hashing", "Getting the film ready.", film_name)
        h = hashlib.sha256()
        with open(path, "rb") as fh:
            for chunk in iter(lambda: fh.read(1 << 20), b""):
                h.update(chunk)
        self._set("sending", "Sending the film. Your original videos are not sent.", film_name)
        started = None
        try:
            status, r = self.signin.api("POST", "/node/compilation/start", {"title": title, "bytes": size, "sha256": h.hexdigest(), "rights": True})
            if status != 200 or not isinstance(r.get("upload_url"), str) or not isinstance(r.get("id"), str):
                raise LinksError(str(r.get("message") or "Ryagram would not take the film.")[:300], "refused")
            started = r["id"]
            self.uploader(r["upload_url"], path, "video/mp4", {self.signin.host})
            self._set("finishing", "Checking it arrived whole.", film_name)
            status, r2 = self.signin.api("POST", "/node/compilation/finish", {"id": started})
            if status != 200:
                raise LinksError(str(r2.get("message") or "The upload did not arrive whole.")[:300], "refused")
        except LinksError:
            self._cancel(started)
            raise
        except Exception as e:                                                          # noqa: BLE001  (the uploader's NodeError, a sign-in error, a network error)
            self._cancel(started)
            raise LinksError(str(e)[:300] if getattr(e, "kind", None) else "The upload did not finish. Nothing was kept.", getattr(e, "kind", "other")) from None
        entry = {"id": started, "title": title, "film": film_name, "bytes": size, "expires_at": str(r2.get("expires_at") or "")[:10]}
        self._write(LIST_NAME, (self.links() + [entry])[-20:])
        self._log("links_upload_done")
        self._set("done", f"Your private link is ready. It is kept until {entry['expires_at']}. Open it from My films on the Ryagram website.", film_name)
        return entry

    def _cancel(self, started):
        if started:
            try:
                self.signin.api("POST", "/node/compilation/cancel", {"id": started})
            except Exception:                                                           # noqa: BLE001  (the site ends an unfinished upload by itself after an hour)
                pass

    def start_upload(self, film_name: str, title: str, rights) -> dict:
        """The page's call: validate now (so a mistake is a plain refusal), then send in the background; the page polls status()."""
        with self._lock:
            if self._thread is not None and self._thread.is_alive():
                raise LinksError("One film is being sent. Wait for it to finish.", "busy")
            if not self.on:
                raise LinksError("Private links are switched off in this copy.", "off")
            if rights is not True:
                raise LinksError("Tick that you have the right to share what is in this film.", "rights")
            self._film(film_name)
            self._log("links_upload_started")

            def run():
                try:
                    self.upload(film_name, title, rights)
                except LinksError as e:
                    self._log("links_upload_failed")
                    self._set("failed", str(e), film_name)
            self._set("checking", "Checking your plan.", film_name)
            self._thread = threading.Thread(target=run, daemon=True)
            self._thread.start()
        return self.status(film_name)
