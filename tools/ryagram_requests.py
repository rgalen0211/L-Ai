"""WHAT YOUR AI ASKED FOR (NEXT-CONNECT 131b; Ryan's go in CC1's window 2026-10-26 ~18:09, part 2). Standard library only.

A person connects their own AI to Ryagram (the connector). The AI may WRITE DOWN a request for a compilation (a phrase, folder names, switches, a note) on one of the person's projects. This
module lets the desktop app, signed in as THIS computer, READ those requests and show them, so the person can do the work here on their own computer from their own videos.

WHAT IT NEVER DOES: the READING half starts nothing (no job, no plan, no build); the RUN half (RequestRunner, below) starts a plan or a build ONLY when the person presses it; it uploads nothing (there is no upload, signed address or file in this module, and the one call it makes is the read
POST /node/compilation-requests); it sends no video, sound or path anywhere; it writes no file; it shows only plain text cut to fixed lengths (never markup, never a path or address). The site
answers only with THIS person's requests (the computer's token resolves the person; no argument names an owner). The finished compilation stays on this computer: nothing here hosts it."""
from __future__ import annotations

import json
import math
import os
import re
import subprocess
import sys
import threading
import time
from pathlib import Path

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
MAX_FOLDERS = 8                 # the engine's cap (ryagram.local.from_request.MAX_FOLDERS): the site allows 10, the engine 8, so the app stops at the engine's number and says so in words
_ITEM_ID = re.compile(r"^[a-z0-9_-]{1,20}$")      # the site's own checklist id rule
_SHA = re.compile(r"^[0-9a-f]{64}$")
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
    iid = it.get("id") if isinstance(it.get("id"), str) and _ITEM_ID.match(it.get("id")) else f"c{index + 1}"
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
    names = [f.strip() for f in (req.get("folders") if isinstance(req.get("folders"), list) else [])[:MAX_FOLDERS] if isinstance(f, str)]
    names = [n for n in names if _mc.NAME.match(n) and n not in (".", "..") and not n.startswith("-") and not _PATHISH.search(n) and not _LINKISH.search(n)]      # a name never starts with '-': it must not be able to read as an option
    sha = row.get("sha256") if isinstance(row.get("sha256"), str) and _SHA.match(row.get("sha256")) else ""
    out = {"title": _text(row.get("title"), 200), "phrase": phrase, "mode": mode, "search": search, "note": "" if _PATHISH.search(note) else note,
           "updated_at": _text(row.get("updated_at"), 40), "project_id": pid, "folders": names, "sha256": sha}
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
        self._raw: dict = {}            # project_id -> (the request with its CLEANED folder names, the site's fingerprint); read by RequestRunner only, never shown or sent
        self._over_cap: set = set()     # of those, the ones that named more than MAX_FOLDERS folders (said in their own words)
        self._ok = False                # the last read of the list reached the site and was understood
        self._dropped: set = set()      # project ids whose request had a folder name the name rule or the 8-folder cap removed: not runnable (it would run a different request than the one written)
        self._message = ""

    def status(self, force: bool = False) -> dict:
        """{"on": False} when this computer is not signed in (no card, nothing asked). Otherwise the requests last read (at most every MIN_GAP_SECONDS) and a plain message when the read failed."""
        try:
            signed_in = self.signin.status().get("state") == "signed_in"
        except Exception:  # noqa: BLE001
            signed_in = False
        if not signed_in:
            with self._lock:
                self._items, self._message, self._last, self._raw, self._dropped, self._over_cap, self._ok = [], "", 0.0, {}, set(), set(), False
            return {"on": False}
        with self._lock:
            now = self.clock()
            if force or self._last == 0.0 or now - self._last >= MIN_GAP_SECONDS:
                self._last = now
                self._refresh()
            return {"on": True, "requests": list(self._items), "message": self._message}

    def _refresh(self) -> None:
        self._ok = False
        try:
            status, obj = self.signin.api("POST", ROUTE, {})
        except Exception as e:  # noqa: BLE001  (a removed computer, no internet, a server error: the card keeps what it had and says so in words)
            self._message = _text(str(e), 200) or "Could not read what your AI asked for just now."
            return
        if status != 200 or not isinstance(obj, dict) or not isinstance(obj.get("requests"), list):
            self._message = "Could not read what your AI asked for just now."
            return
        items = [c for c in (_clean(r) for r in obj["requests"][:MAX_ITEMS]) if c]
        self._items, self._message, self._ok = items, "", True
        raw, dropped, over = {}, set(), set()
        for r in obj["requests"][:MAX_ITEMS]:
            c = _clean(r)
            if not (c and c["project_id"] and c["sha256"] and isinstance(r.get("request"), dict)):
                continue
            asked = r["request"].get("folders")
            if not isinstance(asked, list) or len(asked) != len(c["folders"]):
                dropped.add(c["project_id"])
                if isinstance(asked, list) and len([f for f in asked if isinstance(f, str)]) > MAX_FOLDERS:
                    over.add(c["project_id"])
            raw[c["project_id"]] = ({**r["request"], "folders": list(c["folders"])}, c["sha256"])      # the cleaned names, so the name rule and the cap apply to what is run
        self._raw, self._dropped, self._over_cap = raw, dropped, over

    def request_for(self, project_id: str):
        """(request, sha256) for a project as last read, or None (not listed, or this computer is signed out). The site's own fingerprint is the one reports must carry. The request's folders
        are the CLEANED names (the same ones the page shows)."""
        with self._lock:
            return self._raw.get(project_id)

    def recheck(self, project_id: str, sha: str) -> str:
        """Ask the site again (not rate-limited: one call, when the person presses Plan) and say whether it still holds THIS request for the project: "current", "changed" (another request, or none,
        is held now) or "unknown" (the site could not be reached or understood, or this computer is signed out: the cached request is all there is)."""
        try:
            self.status(force=True)
        except Exception:  # noqa: BLE001
            return "unknown"
        with self._lock:
            if not self._ok:
                return "unknown"
            got = self._raw.get(project_id)
            return "current" if got and got[1] == sha else "changed"

    def folders_over_cap(self, project_id: str) -> bool:
        """True when the request named more than MAX_FOLDERS folders (said in its own words; the closed code stays request_invalid)."""
        with self._lock:
            return project_id in self._over_cap

    def folders_dropped(self, project_id: str) -> bool:
        """True when cleaning removed a folder name from this request (a bad name, or more than MAX_FOLDERS): it is not run, because the run would not be the request that was written."""
        with self._lock:
            return project_id in self._dropped


# ---------------------------------------------------------------------------------------------------- the run half (gap G1)
REPORT_ROUTE = "/node/compilation-report"
#: What the site's route takes, exactly (router.ts REPORT_KEYS). The engine's report key is `project_id` too (renamed on the engine side, v2): it is sent as it is, nothing is translated.
REPORT_KEYS = ("project_id", "request_sha256", "state", "matches", "clips", "film_seconds", "error_code", "step_done", "step_total", "percent")
REPORT_STATES = ("planning", "matching", "building", "done", "failed", "cancelled")
FINAL_STATES = ("done", "failed", "cancelled")
#: The closed list of eleven (ryagram.local.compilation_report.ERROR_CODES), each with the person's words and the next step (FACES-COMPILATION-WORDS-1127).
ERROR_WORDS = {
    "request_invalid": ("The request could not be read.", "Save it again, or ask your AI to write it again."),
    "song_request": ("Compilations do not make songs.", "Take out the song and save again."),
    "folder_not_chosen": ("A folder in your request is not chosen on your computer yet.", "Open the Ryagram app and choose where that folder is."),
    "folder_missing": ("A folder you chose is not there any more.", "Open the Ryagram app and choose it again."),
    "folder_empty": ("A folder you chose has no videos in it.", "Choose the folder that holds your videos."),
    "folders_overlap": ("Two of your folders hold the same videos.", "Choose folders that do not overlap."),
    "no_speech": ("No speech was found in your videos.", "Try videos where people talk."),
    "not_said": ("Your videos do not say these words.", "Try other words, or add more folders."),
    "edit_failed": ("The matches could not be turned into a film.", "Try again; if it happens twice, tell us."),
    "build_failed": ("The film could not be built. Nothing left your computer.", "Try again in the Ryagram app."),
    "crash": ("Something went wrong on your computer. Nothing left it.", "Close the app, open it and try again."),
}
ERROR_CODES = tuple(ERROR_WORDS)
CAP_WORDS = (f"This request names more than {MAX_FOLDERS} folders; one compilation holds at most {MAX_FOLDERS}.", "Ask your AI for fewer folders, or for several compilations.")
CANCELLED_WORDS = ("Stopped: you stopped it on this computer. Nothing was kept.", "Press Plan to start again.")


def words_for(code) -> tuple:
    """(words, next step) for a closed code; anything else is the crash words, never the code itself."""
    return ERROR_WORDS.get(code) or ERROR_WORDS["crash"]


#: What report_run answers: a small closed list. `ok` the site took it; `not_current` (404) the site no longer holds this request as the project's current one; `busy` (409) another run is open there;
#: `not_open` (403) compilations are not open for this account; `refused` anything else the site or this module said no to (a bad report is not sent at all); `offline` no answer (no internet, signed out,
#: removed, a server error). Only `offline` is worth trying again. `app_refused`: this module's own check said no (a key, a state, a code, a count, a string it will not send): the site never saw it.
REPORT_RESULTS = ("ok", "not_current", "busy", "not_open", "not_running", "moved_past", "too_many", "too_many_tries", "too_many_runs", "slow_down", "refused", "app_refused", "offline")
RATE_LIMITED = ("too_many", "too_many_tries", "too_many_runs", "slow_down")        # 429: the site says wait; a heartbeat is tried again later, not given up on
SERVER_REFUSALS = ("not_current", "busy", "not_open", "not_running", "moved_past", *RATE_LIMITED, "refused")      # the site saw the report and said no
_SITE_CODES = {c: c for c in SERVER_REFUSALS if c != "refused"}
SITE_WORDS = {
    "not_current": "Ryagram no longer holds this request as the current one, so it was not told how far this got. Your film is not affected.",
    "busy": "Ryagram thinks another compilation is still running, so it was not told how far this got. Your film is not affected.",
    "not_open": "Compilations are not open for this account on Ryagram yet, so it was not told how far this got. Your film is not affected.",
    "not_running": "Ryagram says this run is no longer open there, so it was not told how far this got. Your film is not affected. Start again with Plan.",
    "moved_past": "An earlier run for this request is still open. Start again with Plan.",
    "too_many": "You have reached the limit of 30 builds in 24 hours. Try again later.",
    "too_many_tries": "Too many tries in a short time. Wait, then try again.",
    "too_many_runs": "Too many runs in 24 hours. Try again later.",
    "slow_down": "Ryagram asked this computer to slow down, so it was not told how far this got. Your film is not affected. Wait a little and try again later.",
    "refused": "Ryagram did not take the update on how far this got. Your film is not affected.",
}
NOT_STARTED_WORDS = "Nothing was started on this computer."        # a Plan or Build the site refused when it was opened: the engine is not run, and the refusal's own words follow it
APP_WORDS = "The app could not send the update. Your film is not affected."        # the app's own check refused the report: the site never saw it
COUNT_CAP = 100000          # the most a count of matches or clips is sent as (the site's own cap)
SECONDS_CAP = 86400         # the most a film length is sent as, in seconds
RETRY_TRIES = 3             # a report is sent up to 3 times when there is no answer (no internet, a server error), with a short wait between
RETRY_WAITS = (2.0, 6.0)    # seconds to wait after the first and after the second try
HEARTBEAT_RETRY_S = 60      # after a heartbeat the site did not take, the next one is tried no sooner than this (the last ACCEPTED report still sets the 10-minute count)
_nap = time.sleep           # the wait between tries; a test injects its own (RunReporter / RequestRunner `sleep=`), so nothing sleeps for real

# ---- PROGRESS (Ryan, 11-27 23:06): the engine's --progress-file, read here, shown on this computer, and told to the site as THREE WHOLE NUMBERS ONLY
#: The engine (Ryagram faces-compilations-progress-1127, compilation_progress.py) writes one JSON line per update to --progress-file of draft-request: {"phase", "file_index", "file_count", "file_name",
#: "file_percent", "percent", "seconds_left_estimate"}; phase is one of planning, listening, matching, building, done, failed, cancelled. Every key is optional here and any other key is ignored.
#: build-edit has no --progress-file, and the record never carries a CLIP number (in a building line file_index/file_count are the last VIDEO's), so a build shows no clip count. The FILE NAME is shown on this computer's own page and nowhere else: nothing below ever puts it in a report.
PROGRESS_NAME = "progress.jsonl"                 # in the run's work folder
PROGRESS_FLAG = "--progress-file"                # the app passes it only when the engine's own help lists it (an older engine would refuse the whole command)
PROGRESS_KEYS = ("step_done", "step_total", "percent")      # BUILDER 23:12: the only progress keys the site's route takes; whole numbers, no strings, no decimals
STEP_CAP = 1000             # step_total 0 to 1000; step_done 0 to step_total and only together with step_total (a lone step_done is a 400 on the site)
PROGRESS_GAP_S = 10         # BUILDER rule 3: at most one report every 10 seconds per build
ETA_CAP_S = 86400
_PHASES = ("planning", "listening", "matching", "building", "done", "failed", "cancelled")
_END_PHASES = ("done", "failed", "cancelled")


def _whole(v, hi):
    """A whole number from 0 to hi (a larger or smaller one is made right, not dropped), or None for anything that is not a finite number (a string, a bool, nan)."""
    if isinstance(v, bool) or not isinstance(v, (int, float)) or (isinstance(v, float) and not math.isfinite(v)):
        return None
    return int(round(min(max(v, 0), hi)))


def _local_name(v) -> str:
    """A file NAME for this computer's own page: the last part of whatever the engine wrote, as plain cut-down text. Never sent anywhere."""
    if not isinstance(v, str):
        return ""
    return _text(re.split(r"[\\/]", v)[-1], 120)


def parse_progress_line(line):
    """One line of the engine's progress file as the local view, or None when it holds nothing this app reads. Tolerates missing keys, wrong types and out-of-range numbers."""
    if isinstance(line, (str, bytes)):
        try:
            line = json.loads(line)
        except ValueError:
            return None
    if not isinstance(line, dict):
        return None
    out = {}
    for k, hi in (("file_index", STEP_CAP), ("file_count", STEP_CAP), ("file_percent", 100), ("percent", 100), ("seconds_left_estimate", ETA_CAP_S)):
        got = _whole(line.get(k), hi)
        if got is not None:
            out[k] = got
    name = _local_name(line.get("file_name"))
    if name:
        out["file_name"] = name
    phase = line.get("phase")
    out["phase"] = phase if phase in _PHASES else ""
    return out if len(out) > 1 or out["phase"] else None


def clean_progress(nums) -> dict:
    """The site's three progress numbers from whatever is given: whole numbers in range, step_done only with step_total, nothing else."""
    out = {}
    if not isinstance(nums, dict):
        return out
    total = _whole(nums.get("step_total"), STEP_CAP)
    if total is not None:
        out["step_total"] = total
        done = _whole(nums.get("step_done"), total)
        if done is not None:
            out["step_done"] = done
    pct = _whole(nums.get("percent"), 100)
    if pct is not None:
        out["percent"] = pct
    return out


def site_progress(view, kind) -> dict:
    """What the SITE is told, from the local view: in a plan the step is a video (file_index of file_count; while matching, all of them, as the engine's own report numbers say), percent is the overall
    estimate. A build has no clip numbers in the engine's record, so it gets the percent only. An end phase (done, failed, cancelled) gets nothing. Three integers, never a name."""
    if not view or view.get("phase") in _END_PHASES:
        return {}
    if kind == "build":
        return clean_progress({"percent": view.get("percent")}) if view.get("phase") == "building" else {}
    n = view.get("file_count")
    i = n if view.get("phase") == "matching" and n else view.get("file_index")
    return clean_progress({"step_done": i, "step_total": n, "percent": view.get("percent")})


def _minutes_words(eta_s) -> str:
    if eta_s < 60:
        return "less than a minute left (an estimate)"
    m = max(1, round(eta_s / 60))
    return f"about {m} minute{'' if m == 1 else 's'} left (an estimate)"


def progress_view(view, kind):
    """What THIS computer's page shows while a plan or build runs: the words (with the file name), the percents, a rough time left. None when the engine has said nothing yet, or has ended (done, failed,
    cancelled: the card shows the result then). No 'clip N of M' is made up: the engine's record has no clip number."""
    if not view or view.get("phase") in _END_PHASES:
        return None
    n, i, phase = view.get("file_count"), view.get("file_index"), view.get("phase")
    if kind == "build":
        head = "Building your film on this computer"
    elif phase == "matching":
        head = "Finding your words in what it heard"
    elif phase == "planning" or not n:
        head = "Listening to your videos"
    else:
        head = f"Listening to video {min(max(i or 1, 1), n)} of {n}" + (": " + view["file_name"] if view.get("file_name") else "")
    bits = []
    if kind != "build" and phase == "listening" and view.get("file_percent") is not None:
        bits.append(f"This video: {view['file_percent']}%")
    if view.get("percent") is not None:
        bits.append(f"Overall: {view['percent']}%")
    if view.get("seconds_left_estimate") is not None:
        bits.append(_minutes_words(view["seconds_left_estimate"]))
    return {"headline": head, "detail": " \u00b7 ".join(bits), "overall": view.get("percent"), "file_pct": view.get("file_percent") if kind != "build" and phase == "listening" else None}


def help_lists_flag(text, flag) -> bool:
    """Does an engine's --help text list this option (as an option, in the usage line or at the start of an option line), not merely mention it inside another option's words?"""
    return bool(re.search(r"(?:\[|^ {0,4})" + re.escape(flag) + r"(?=[\s=\]]|$)", str(text), re.MULTILINE))


def clean_count(v):
    """A count of matches or clips as the site takes it: a whole number from 0 to COUNT_CAP, or None (not a number, negative, not finite): never a float, and never more than the cap."""
    if isinstance(v, bool) or not isinstance(v, (int, float)) or (isinstance(v, float) and not math.isfinite(v)) or v < 0:
        return None
    return int(min(v, COUNT_CAP))


def clean_seconds(v):
    """A film length in seconds, from 0 to SECONDS_CAP, or None."""
    if isinstance(v, bool) or not isinstance(v, (int, float)) or (isinstance(v, float) and not math.isfinite(v)) or v < 0:
        return None
    return min(v, SECONDS_CAP) if isinstance(v, int) else round(min(v, float(SECONDS_CAP)), 2)


def _clean_counts(counts) -> dict:
    out = {}
    for k, fn in (("matches", clean_count), ("clips", clean_count), ("film_seconds", clean_seconds)):
        got = fn(counts.get(k))
        if got is not None:
            out[k] = got
    return out


def report_run(signin, payload, *, sha256=None) -> str:
    """Tell the site how far a run is. `payload` is the engine's report (project_id, state, counts, closed error code), sent with the keys it has. `sha256` is the SITE's own
    fingerprint of the request (the row's `sha256`): it replaces the payload's, because the engine hashes the request with Python's JSON and the site with the database's text, and the site
    compares the two. Returns one word of REPORT_RESULTS (`ok` only when the site took it: 200 and a run_id); never raises, so a failed report cannot stop a build. A payload with any key the route
    does not take, a state or error code off the closed lists, a count off its range, or a string that looks like a path or an address is NOT sent (`app_refused`: the site never saw it)."""
    try:
        if not isinstance(payload, dict):
            return "app_refused"
        body = {}
        for k, v in payload.items():
            if k not in REPORT_KEYS:
                return "app_refused"
            if v is not None:
                body[k] = v
        if sha256 is not None:
            body["request_sha256"] = sha256
        if not (isinstance(body.get("project_id"), str) and _UUID.match(body["project_id"]) and isinstance(body.get("request_sha256"), str) and _SHA.match(body["request_sha256"])):
            return "app_refused"
        if body.get("state") not in REPORT_STATES or ("error_code" in body and body["error_code"] not in ERROR_CODES):
            return "app_refused"
        for k in ("matches", "clips"):
            if k in body and (isinstance(body[k], bool) or not isinstance(body[k], int) or body[k] < 0 or body[k] > COUNT_CAP):
                return "app_refused"
        if "film_seconds" in body and (isinstance(body["film_seconds"], bool) or not isinstance(body["film_seconds"], (int, float)) or not 0 <= body["film_seconds"] <= SECONDS_CAP):
            return "app_refused"
        if any(k in body for k in PROGRESS_KEYS):                # BUILDER's four rules: whole numbers, in range, step_done only with step_total, and only with a running state
            if body["state"] in FINAL_STATES or any(isinstance(body[k], bool) or not isinstance(body[k], int) for k in PROGRESS_KEYS if k in body):
                return "app_refused"
            if "step_total" in body and not 0 <= body["step_total"] <= STEP_CAP:
                return "app_refused"
            if "step_done" in body and ("step_total" not in body or not 0 <= body["step_done"] <= body["step_total"]):
                return "app_refused"
            if "percent" in body and not 0 <= body["percent"] <= 100:
                return "app_refused"
        if any(isinstance(v, str) and (_PATHISH.search(v) or _LINKISH.search(v)) for v in body.values()):
            return "app_refused"
        status, obj = signin.api("POST", REPORT_ROUTE, body)
        if status == 200 and isinstance(obj, dict) and isinstance(obj.get("run_id"), int) and not isinstance(obj.get("run_id"), bool):
            return "ok"
        if isinstance(status, int) and not isinstance(status, bool) and (status <= 0 or status >= 500):
            return "offline"                            # no answer, or the server is down: the same as having no internet
        code = obj.get("error") if isinstance(obj, dict) else None
        if status == 429 and not (isinstance(code, str) and code in RATE_LIMITED):
            return "slow_down"                          # a 429 with a code this app does not know still means: wait
        return _SITE_CODES.get(code, "refused") if isinstance(code, str) else "refused"
    except Exception:  # noqa: BLE001  (offline, signed out, removed: the film matters more than the progress line)
        return "offline"


def report_with_retry(signin, payload, *, sha256=None, sleep=None, tries=RETRY_TRIES, waits=RETRY_WAITS) -> str:
    """report_run, tried up to `tries` times while there is NO answer (`offline`), with a short wait between (`sleep`, injected by tests). Any answer ends it. A FINAL report (done, failed, cancelled) that
    the site answers `not_running` on a LATER try was taken on an earlier one whose answer was lost: that is `ok` (already delivered). Never raises."""
    nap = sleep or _nap
    final = isinstance(payload, dict) and payload.get("state") in FINAL_STATES
    res = "offline"
    for i in range(max(1, tries)):
        res = report_run(signin, payload, sha256=sha256)
        if res == "not_running" and i > 0 and final:
            return "ok"
        if res != "offline":
            return res
        if i < tries - 1:
            try:
                nap(waits[min(i, len(waits) - 1)] if waits else 0)
            except Exception:  # noqa: BLE001
                pass
    return res


class RunReporter:
    """The reports of ONE run, in order, never after a final one. `step` sends through report_run and counts a failure instead of raising."""

    def __init__(self, signin, project_id: str, sha256: str, *, send=None, on_final=None, clock=time.time, sleep=None, on_open=None):
        self.signin, self.project_id, self.sha = signin, project_id, sha256
        self.on_open = on_open                      # called when the site first takes a report of this run (the open-run file is written then, whenever that is)
        self.clock = clock
        self._sleep = sleep
        self.last_result = None                     # one word of REPORT_RESULTS for the last report (not a heartbeat)
        self.last_refusal = None                    # the last server refusal (a word of SERVER_REFUSALS), for the person's words
        self.last_at = clock()                      # when the site last TOOK a report of this run (the run's start until then): the heartbeat and the 100-minute window both count from here; an offline or refused send does not move it
        self.last_try = clock()                     # when the site was last asked at all (a heartbeat the site did not take is not tried again at once)
        self.open_lost = False                      # the last try to open the run (`planning`) got no answer at all
        self.opened = False                         # the site has taken a report of this run, so it holds the run open: a run it never heard of is opened again with `planning` before anything else is said
        self.beats: list = []                       # the heartbeats sent (their results), kept apart from `sent`
        self.beats_off = False                      # the site refused a heartbeat: no more are sent, and nothing is said
        self._lock = threading.Lock()               # reports of one run go out one at a time, in the order they were asked, whichever thread asks
        self.on_final = on_final                    # called with True/False (was the final report taken) after the final report
        self.ok_last = False
        self._send = send or (lambda p: report_with_retry(signin, p, sha256=sha256, sleep=self._sleep))       # each report: up to 3 tries when there is no answer
        self._send_once = send or (lambda p: report_run(signin, p, sha256=sha256))                            # a heartbeat is one try: the next one is the retry
        self.sent: list = []
        self.failures = 0
        self.final = False
        self.final_lost = False                     # a final report went out and got no answer at all: it is sent again before the next run begins
        self.older = None                           # an OLDER run's reporter whose final report is still not answered (the runner sends it again before anything else, and keeps it until the site has answered it)
        self.open_refused = None                    # the site refused the OPENING report (a word of SERVER_REFUSALS): the run never began, nothing more is sent, and this first refusal stays the one shown
        self.started = False
        self.counts = {"matches": None, "clips": None, "film_seconds": None}
        self.progress = {}                          # the three whole numbers the site may be told while the run is going (clean_progress); never a name
        self.progress_off = False                   # the site answered 400 to a report that carried them (an older route): they are not sent again for this run
        self._progress_sent = {}                    # the numbers the site last TOOK

    @staticmethod
    def _word(r) -> str:
        """The result of one send as a word of REPORT_RESULTS (an injected sender may answer True or False)."""
        if r is True:
            return "ok"
        if isinstance(r, str) and r in REPORT_RESULTS:
            return r
        return "offline"

    def step(self, state: str, error_code=None, **counts) -> bool:
        with self._lock:
            if self.final:
                return False
            if not self.opened and state != "planning" and (self.open_lost or not self.started):
                self._do("planning", None, {})          # the opening report was lost (no answer): open the run first, or the site answers not_running to everything after it and the run is dead
                if self.final:
                    return False
            return self._do(state, error_code, counts)

    def _opened(self) -> None:
        first, self.opened, self.open_lost = not self.opened, True, False
        if first and self.on_open:
            try:
                self.on_open()
            except Exception:  # noqa: BLE001
                pass

    def _do(self, state: str, error_code, counts) -> bool:
        for k, v in _clean_counts(counts).items():
            self.counts[k] = v                          # whole numbers within the caps, never a float: one odd number must not drop the whole report
        p = {"project_id": self.project_id, "request_sha256": self.sha, "state": state, "error_code": error_code, **self.counts}
        if self.progress and not self.progress_off and state not in FINAL_STATES:      # BUILDER rule 2: only with a running state
            p.update(self.progress)
        res, p = self._deliver(p)
        ok = res == "ok"
        if ok:
            self._progress_sent = {k: p[k] for k in PROGRESS_KEYS if k in p}
        self.last_result, self.last_try = res, self.clock()
        if state == "planning" and not self.opened:
            self.open_lost = res == "offline"
        if ok:
            self.last_at = self.last_try                          # only a report the site TOOK moves the time
            self._opened()
        if res in SERVER_REFUSALS:
            self.last_refusal = res
        if not ok:
            self.failures += 1
        self.sent.append(p)
        self.started = True
        self.final = state in FINAL_STATES
        if self.final:
            self.final_lost = res == "offline"
        if state == "planning" and not self.opened and res in SERVER_REFUSALS:
            self.open_refused, self.final = res, True   # the site said no to the opening: no report after it (they would only be answered not_running, hiding this reason)
            return ok
        if self.final and self.on_final:
            try:
                self.on_final(res != "offline")         # a server refusal is an answer: nothing to try again later; only an offline final report is kept for the next start
            except Exception:  # noqa: BLE001
                pass
        return ok

    def resend_final(self) -> bool:
        """A final report (done, failed, cancelled) that got no answer is sent again (up to 3 tries), once, before the next run begins: until the site has it, it holds the old run open and answers the next
        Plan `moved_past`. Returns whether it is delivered now (any answer counts; `offline` keeps it to try again). Nothing is sent when no final was lost."""
        with self._lock:
            if not (self.final and self.final_lost and self.sent):
                return not self.final_lost
            try:
                res = self._word(self._send(dict(self.sent[-1])))
            except Exception:  # noqa: BLE001
                res = "offline"
            self.final_lost = res == "offline"
            if self.on_final:
                try:
                    self.on_final(res != "offline")     # the open-run file goes only once the site has answered
                except Exception:  # noqa: BLE001
                    pass
            return not self.final_lost

    def heartbeat(self, interval_s: float) -> bool:
        """Say the run is still going: the last non-final state is sent again (with the counts so far) when `interval_s` have passed since the site was last asked, so the site's 2 hour stale rule
        never trips on a long build. The site takes an equal-state repeat today; if it ever refuses one, heartbeats stop for this run, silently: no failure is counted and nothing is shown. An
        offline heartbeat is simply tried again after the next interval. Returns whether one was sent."""
        with self._lock:
            now = self.clock()
            if self.final or self.beats_off or not self.sent or now - self.last_at < interval_s or now - self.last_try < min(interval_s, HEARTBEAT_RETRY_S):
                return False
            p = {**self.sent[-1], **{k: v for k, v in self.counts.items() if v is not None}}
            p = {k: v for k, v in p.items() if k not in PROGRESS_KEYS}
            if not self.opened and self.open_lost:
                p = {**p, "state": "planning", "error_code": None}      # the site never heard the opening report: this one opens the run
            if self.progress and not self.progress_off and p.get("state") not in FINAL_STATES:
                p.update(self.progress)                                 # the numbers as they stand now (rule 3: a report in the same state also updates them)
            res, p = self._deliver(p, once=True)
            self.last_try = self.clock()
            if res == "ok":
                self.last_at = self.last_try                            # the 10 minutes (and the 100-minute window) count from the last report the site TOOK
                self._progress_sent = {k: p[k] for k in PROGRESS_KEYS if k in p}
                self._opened()
            self.beats.append(res)
            if res in SERVER_REFUSALS and res not in RATE_LIMITED:
                self.beats_off = True                                   # a 429 says wait: the next heartbeat is tried; any other refusal ends them
            return True

    def _deliver(self, p, once: bool = False):
        """Send one report; when the site answers 400 to one that carries the progress numbers (an older route that does not know them: BUILDER rule 4), send it again without them and leave them
        out for the rest of this run. Returns (the result word, the report as finally sent)."""
        send = self._send_once if once else self._send
        try:
            res = self._word(send(p))
        except Exception:  # noqa: BLE001
            res = "offline"
        if res == "refused" and not self.progress_off and any(k in p for k in PROGRESS_KEYS):
            self.progress_off = True
            p = {k: v for k, v in p.items() if k not in PROGRESS_KEYS}
            try:
                res = self._word(send(p))
            except Exception:  # noqa: BLE001
                res = "offline"
        return res, p

    def set_progress(self, nums) -> None:
        """The numbers as the engine last said them (whole numbers, in range); the next report carries them."""
        self.progress = clean_progress(nums)

    def clear_progress(self) -> None:
        self.progress = {}

    def progress_due(self) -> bool:
        """The numbers have changed since the site last took them, and the run is still going."""
        return bool(self.progress) and not self.progress_off and not self.final and bool(self.sent) and self.progress != self._progress_sent

    def forward(self, line, *, hold_done: bool = True) -> None:
        """One line of the engine's --report-file. Only state, counts and a closed code are read from it. With hold_done the engine's `done` of a PLAN (the draft is made, the film is not) is kept back:
        the site hears `done` only when the film is built."""
        if not isinstance(line, dict) or line.get("state") not in REPORT_STATES:
            return
        st = line["state"]
        counts = _clean_counts(line)                    # whole numbers within the caps; a float or an over-large number is made right, not allowed to drop the report
        if st == "done" and hold_done:
            self.counts.update(counts)
            return
        code = line.get("error_code") if st == "failed" else None
        self.step(st, error_code=(code if code in ERROR_CODES else "crash") if st == "failed" else None, **counts)

    def fail(self, code: str) -> None:
        self.step("failed", error_code=code if code in ERROR_CODES else "crash")           # step opens the run first (planning) when the site never took an opening report

    def cancel(self) -> None:
        if self.started and not self.final:
            self.step("cancelled")


class FolderMap:
    """Which real folder on THIS computer each folder NAME of a request means: {project_id: {name: path}}. It lives in one file here and goes nowhere: no function of this module sends it."""

    def __init__(self, path=None):
        self.path = Path(path) if path else None
        self._lock = threading.Lock()
        self._map: dict = {}
        try:
            data = json.loads(self.path.read_text(encoding="utf-8")) if self.path and self.path.is_file() else {}
            if isinstance(data, dict):
                self._map = {str(k): {str(n): str(v) for n, v in m.items()} for k, m in data.items() if isinstance(m, dict)}
        except Exception:  # noqa: BLE001
            self._map = {}

    def set(self, project_id: str, name: str, folder) -> None:
        with self._lock:
            self._map.setdefault(project_id, {})[name] = str(folder)
            if self.path:
                try:
                    self.path.parent.mkdir(parents=True, exist_ok=True)
                    self.path.write_text(json.dumps(self._map, indent=1, ensure_ascii=False), encoding="utf-8")
                except OSError:
                    pass                                # kept for this session; the next press asks again

    def get(self, project_id: str) -> dict:
        with self._lock:
            return dict(self._map.get(project_id, {}))

    def chosen(self, project_id: str, names) -> dict:
        """{name: True/False} for the page: has the person chosen a folder for this name? (never the path)"""
        have = self.get(project_id)
        return {n: n in have for n in names}


class RunRefused(ValueError):
    """A plain sentence for the person (the maker shows it as a Problem)."""


#: The engine flags the runner needs. An engine without them refuses the command (rc 2), which would be reported as the wrong thing: so they are looked for in the engine's own help first.
ENGINE_FLAGS = ("--report-file", "--project", "--preview", "--request-sha256")
OLD_ENGINE_WORDS = "This version of the Ryagram engine is too old to make compilations. Update the engine."
PAGE_GRACE_S = 60          # a plan waiting for Build is held open on the site only while the page has asked about it within this many seconds (the page asks every 10 s while it is open)
DRAFT_MAX_S = 6000         # 100 minutes: well before the site's 2 hours after which it marks a run stale and refuses `building` and `done`
HEARTBEAT_S = 600          # a long run says "still going" every 10 minutes, so the site's 2 hour stale rule never trips while the film is still being made here
RECOVER_MAX_AGE_S = 3 * 86400
OPEN_NAME = "request-open-run.json"


def _norm(p) -> Path:
    """A folder as one comparable path: resolved (links, `..`) and case-folded on Windows."""
    try:
        q = Path(p).resolve()
    except (OSError, RuntimeError):
        q = Path(p)
    return Path(os.path.normcase(str(q)))


def plan_command(python, reqfile, wd, out, model, report_file, project_id, pairs, sha256, progress_file=None) -> list:
    """The engine's command line for a Plan. `sha256` is the SITE's own fingerprint of the request (the row's sha256): the engine refuses --report-file without it and uses it in every report. Every option carries its value as `--flag=value` and the request file comes after `--`, so no value (a path, a folder name) can ever be read as an option."""
    cmd = [str(python), "-m", "ryagram.local", "draft-request", f"--work-dir={wd}", f"--out={out}", f"--model={model}", f"--report-file={report_file}", f"--project={project_id}", f"--request-sha256={sha256}", "--preview"]
    cmd += [f"--folder={n}={path}" for n, path in pairs]
    if progress_file:
        cmd.append(f"{PROGRESS_FLAG}={progress_file}")
    return cmd + ["--", str(reqfile)]


def build_command(python, edit_file, work_dir, film, media, progress_file=None) -> list:
    """The engine's command line for a Build, written the same way as plan_command."""
    cmd = [str(python), "-m", "ryagram.local", "build-edit", f"--work-dir={work_dir}", f"--out={film}"]
    cmd += [f"--media={m}" for m in media]
    if progress_file:
        cmd.append(f"{PROGRESS_FLAG}={progress_file}")
    return cmd + ["--", str(edit_file)]


class RequestRunner:
    """Plan and Build for one listed request, on this computer. `plan` runs `python -m ryagram.local draft-request ... --preview --report-file ... --project ... --request-sha256 ...`; `build` runs `build-edit` on the draft.
    Every report goes through report_run with the site's own fingerprint, and goes out from a background thread, never from the page's request (an offline report can take ~20 s to give up).
    Injected for tests: popen, kill, send, probe (the engine's help), clock.

    A run the site holds open (planned, waiting for Build) is held only while the person has the page open: the page asks about it every 10 s (`touch`); 60 s without that, or 100 minutes of
    waiting, closes it as `cancelled`. The one open run is also written to a small file here (project id and the site's fingerprint, nothing else); when the app starts, `recover` (called ONCE, by
    make_server, never by the page's questions) reports that run as `cancelled` and removes the file, so a restart never leaves the site refusing the next Plan as busy. It never touches a file that
    belongs to a run this process holds."""

    def __init__(self, airq, signin, folders: FolderMap, *, engine_dir, work_dir, out_dir, python=None, popen=subprocess.Popen, kill=None, poll_s: float = 0.4, send=None,
                 probe=None, clock=time.time, state_file=None, page_grace_s: float = PAGE_GRACE_S, draft_max_s: float = DRAFT_MAX_S, reap_s: float = 5.0, heartbeat_s: float = HEARTBEAT_S, sleep=None):
        self.airq, self.signin, self.folders = airq, signin, folders
        self.engine_dir, self.work_dir, self.out_dir = Path(engine_dir), Path(work_dir), Path(out_dir)
        self.python = python or sys.executable
        self.popen, self.kill, self.poll_s, self._send = popen, kill, poll_s, send
        self._probe, self.clock, self._sleep = probe, clock, sleep
        self.state_file = Path(state_file) if state_file else None
        self.page_grace_s, self.draft_max_s, self.reap_s, self.heartbeat_s = page_grace_s, draft_max_s, reap_s, heartbeat_s
        self._lock = threading.Lock()
        self._threads: list = []
        self._engine_ok = False
        self._help: dict = {}           # the engine's help text per command, kept to see whether it lists --progress-file
        self._recovered = False         # recover() works once per process (at app start)
        self._tlock = threading.Lock()
        self._burnt: set = set()        # work folders of runs that were cancelled: a killed engine may still hold them, so the next Plan never reuses one
        self.last_seen = clock()
        self.job = None                 # the one run now (or last)
        self.last_rep = None            # the last run's reporter, so a NEW plan can close it as cancelled

    # --- what the page shows
    def listing(self, project_id: str) -> dict:
        got = self.airq.request_for(project_id)
        names = [f for f in (got[0].get("folders") or []) if isinstance(f, str)] if got else []
        return {"folders": [{"name": n, "chosen": c} for n, c in self.folders.chosen(project_id, names).items()]}

    def touch(self) -> None:
        """The page asked about the run: it is open."""
        self.last_seen = self.clock()

    def status(self) -> dict:
        j = self.job
        if not j:
            return {"state": "none"}
        out = {k: j[k] for k in ("kind", "state", "error_code", "words", "next", "matches", "clips", "film_seconds") if k in j}
        out["project_id"] = j["project_id"]
        out["reports_not_sent"] = j["rep"].failures
        if j["rep"].last_refusal and j["rep"].last_result in SERVER_REFUSALS:
            out["site_said"] = j["rep"].last_refusal         # a closed word, never the site's own text; the page shows `site_words`
            out["site_words"] = SITE_WORDS[j["rep"].last_refusal]
        elif j["rep"].last_result == "app_refused":
            out["app_said"] = "app_refused"                  # the app's own check refused the report: the site never saw it
            out["app_words"] = APP_WORDS
        if j["state"] in ("planning", "building") and j.get("progress"):
            out["progress"] = progress_view(j["progress"], j["kind"])        # for THIS computer's page only (it holds the file name); nothing in it is ever reported
        if j["state"] == "built":
            out["film"] = Path(j["film"]).name        # the name only; the page opens the folder through the maker's own open-folder
        return out

    def busy(self) -> bool:
        """A plan or build of a request is running now (the maker's own Plan and Build do not start meanwhile)."""
        j = self.job
        return bool(j and j.get("state") in ("planning", "building"))

    def _alive(self) -> list:
        with self._tlock:
            self._threads = [t for t in self._threads if t.is_alive()]      # a thread that has finished is forgotten, so the list cannot grow without end
            return list(self._threads)

    def _track(self, t) -> None:
        with self._tlock:
            self._threads = [x for x in self._threads if x.is_alive()] + [t]

    def join(self, timeout=30):
        end = time.time() + timeout
        while True:                                     # a thread may start another (the begin thread starts the watcher): wait until none is left
            alive = self._alive()
            if not alive or time.time() > end:
                return
            alive[0].join(max(0.01, end - time.time()))

    def _bg(self, fn, *a):
        t = threading.Thread(target=lambda: self._guard(fn, *a), daemon=True)
        self._track(t)
        t.start()

    @staticmethod
    def _guard(fn, *a):
        try:
            fn(*a)
        except Exception:  # noqa: BLE001  (a report that cannot go out must not take the thread, or the film, with it)
            pass

    # --- the one open run, on this computer (project id + the site's fingerprint, nothing else)
    def _save_open(self, project_id, sha):
        if not self.state_file:
            return
        try:
            self.state_file.parent.mkdir(parents=True, exist_ok=True)
            self.state_file.write_text(json.dumps({"project_id": project_id, "request_sha256": sha, "at": int(self.clock())}), encoding="utf-8")
        except OSError:
            pass

    def _clear_open(self, ok=True, project_id=None, sha=None):
        """Remove the open-run file. With a run named (project, fingerprint) it goes only when the file holds THAT run: an answer to one run never deletes the file that still holds another (older) one."""
        if ok and self.state_file:
            if project_id is not None:
                try:
                    d = json.loads(self.state_file.read_text(encoding="utf-8"))
                except (OSError, ValueError):
                    return
                if not isinstance(d, dict) or d.get("project_id") != project_id or d.get("request_sha256") != sha:
                    return
            try:
                self.state_file.unlink()
            except OSError:
                pass

    def _held(self, pid, sha) -> bool:
        """True when this process holds the run (project, fingerprint): its own job or its last reporter."""
        for j in (self.job, ):
            if j and j.get("project_id") == pid and j.get("sha") == sha:
                return True
        rep = self.last_rep
        return bool(rep is not None and rep.project_id == pid and rep.sha == sha)

    def recover(self) -> bool:
        """Close, as `cancelled`, the run an EARLIER session left open (the file above). It works once per process, at app start (make_server); the page's questions never call it. A file that belongs
        to a run this process holds is left alone. Off the page's thread; if the site cannot be reached the file is kept for the next start; dropped after 3 days. Returns whether a try began."""
        with self._lock:
            if self._recovered:
                return False
            if not self.state_file or not self.state_file.is_file() or self.busy():
                return False
            try:
                d = json.loads(self.state_file.read_text(encoding="utf-8"))
                pid, sha, at = d["project_id"], d["request_sha256"], d.get("at", 0)
                if not (isinstance(pid, str) and _UUID.match(pid) and isinstance(sha, str) and _SHA.match(sha)) or self.clock() - at > RECOVER_MAX_AGE_S:
                    raise ValueError("stale or unreadable")
            except (OSError, ValueError, KeyError, TypeError):
                self._recovered = True
                self._clear_open()
                return False
            if self._held(pid, sha):
                return False                            # this process's own open run: not an earlier session's
            self._recovered = True
        self._bg(self._close_left_open, pid, sha)
        return True

    def _close_left_open(self, pid, sha):
        """The start-up close, up to RETRY_TRIES tries. A report names the project and the fingerprint, never a run, so the site closes whichever run is open for them: before EACH try, if this process has
        itself started a run of that request meanwhile (the person pressed Plan while a try was waiting), the close stops and sends nothing more, and the file is left to that newer run (never cleared here).
        A server refusal is an answer: the file goes. No answer on every try: the file is kept for the next start."""
        nap = self._sleep or _nap
        for i in range(max(1, RETRY_TRIES)):
            if self._held(pid, sha):
                return
            res = report_run(self.signin, {"project_id": pid, "request_sha256": sha, "state": "cancelled"}, sha256=sha)
            if res != "offline":
                self._clear_open(True, pid, sha)
                return
            if i < RETRY_TRIES - 1:
                nap(RETRY_WAITS[min(i, len(RETRY_WAITS) - 1)] if RETRY_WAITS else 0)

    # --- the engine must know the flags
    def engine_problem(self):
        """The plain sentence when the engine is too old to make compilations, else None. Looked for in the engine's own help for `draft-request`, before anything runs or is reported. If the help
        cannot be read at all, nothing is claimed here (the run itself will say what went wrong)."""
        if self._engine_ok:
            return None
        try:
            rc, text = (self._probe or self._run_help)()
        except Exception:  # noqa: BLE001
            return None
        if rc != 0:
            return OLD_ENGINE_WORDS if "invalid choice" in text else None          # the command does not exist at all
        if any(f not in text for f in ENGINE_FLAGS):
            return OLD_ENGINE_WORDS
        self._engine_ok = True
        self._help["draft-request"] = text
        return None

    def _can_progress(self, sub: str) -> bool:
        """Does this engine's own help for `sub` list --progress-file? An older engine would refuse the whole command over an option it does not know, so the option is passed only when it is listed."""
        if sub not in self._help:
            try:
                rc, text = (self._probe or (lambda: self._run_help(sub)))()
            except Exception:  # noqa: BLE001
                rc, text = 1, ""
            self._help[sub] = text if rc == 0 else ""
        return help_lists_flag(self._help[sub], PROGRESS_FLAG)

    def _run_help(self, sub="draft-request"):
        env = dict(os.environ, PYTHONPATH=str(self.engine_dir), PYTHONIOENCODING="utf-8", NO_PROXY="127.0.0.1,localhost")
        r = subprocess.run([self.python, "-m", "ryagram.local", sub, "--help"], cwd=str(self.engine_dir), env=env, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=60)
        return r.returncode, (r.stdout or "") + (r.stderr or "")

    # --- Plan
    def plan(self, project_id: str, model: str = "base") -> dict:
        cached, seen = self.airq.request_for(project_id), "unknown"
        if cached and not self.busy():
            try:
                seen = self.airq.recheck(project_id, cached[1])     # one more question to the site, off the lock: a request it no longer holds is never run from the cache
            except Exception:  # noqa: BLE001
                seen = "unknown"
        with self._lock:
            if self.job and self.job["state"] in ("planning", "building"):
                raise RunRefused("Something is already running here. Cancel it or wait for it to finish.")
            got = self.airq.request_for(project_id)
            if not got:
                raise RunRefused("That request is not on this computer's list any more. Wait a moment for the list to refresh, then try again.")
            if seen == "changed":
                raise RunRefused("Your AI changed this request since the list was read. The list has been read again: check the folders it shows, then press Plan.")
            old = self.engine_problem()
            if old:
                raise RunRefused(old)                   # said before anything runs; nothing is reported to the site
            req, sha = got
            prev = self.last_rep                        # a run left open on the site (planned, never built) is closed before the next one starts
            rep = RunReporter(self.signin, project_id, sha, send=self._send, on_final=lambda ok, _p=project_id, _s=sha: self._clear_open(ok, _p, _s), clock=self.clock, sleep=self._sleep, on_open=lambda: self._save_open(project_id, sha))
            self.last_rep = rep
            rep.older = prev                            # the run before it, until the site has answered its final report: a Plan that is refused or fails at once keeps it owed
            names = [n for n in (req.get("folders") or []) if isinstance(n, str)]
            have = self.folders.get(project_id)
            job = {"kind": "plan", "project_id": project_id, "rep": rep, "state": "planning", "sha": sha, "names": names, "cancelled": False}
            self.job = job
            self.touch()
            bad = "request_invalid" if self.airq.folders_dropped(project_id) else ("song_request" if req.get("song") is True or req.get("mode") == "song" else self._folder_problem(names, have))
            if bad:
                return self._fail(job, bad, prev, CAP_WORDS if bad == "request_invalid" and self.airq.folders_over_cap(project_id) else None)
            wd = self._fresh_wd(sha)
            reqfile = wd / "request.json"
            reqfile.write_text(json.dumps(req, ensure_ascii=False), encoding="utf-8")
            job.update(wd=wd, draft=wd / "draft.json", preview=wd / "draft.preview.json", seen=0, report_file=wd / "report.jsonl", stdout=[])
            job["report_file"].unlink(missing_ok=True)
            job.update(progress_file=(wd / PROGRESS_NAME) if self._can_progress("draft-request") else None, ppos=0, progress=None)
            if job["progress_file"]:
                job["progress_file"].unlink(missing_ok=True)
            cmd = plan_command(self.python, reqfile, wd, job["draft"], model, job["report_file"], project_id, [(n, have[n]) for n in names], sha, job["progress_file"])
            self._bg(self._begin, job, prev, "planning", {}, cmd)
        return {"started": True}

    def _begin(self, job, prev, first_state, counts, cmd):
        """Off the page's thread: close the earlier open run, tell the site this one has begun (before the long listening starts), then start the engine."""
        left = self._settle(prev if prev is not None else job["rep"].older)    # an earlier run still open on the site is closed first, and an earlier final report the site never answered is sent again (3 tries); until it is, the site holds that run open. Build has no `prev`: the owed chain is the one its Plan's reporter holds
        job["rep"].step(first_state, **counts)         # (the open-run file is written by the reporter, the moment the site first takes a report)
        job["rep"].older = None if job["rep"].opened else left      # the site has taken this run's opening: it has moved on from the older one; otherwise that one is still owed (for Build, the chain its Plan left on this reporter)
        if job["rep"].open_refused:
            self._refused_opening(job, left)            # the site said no to the opening (not open, busy, too many, an earlier run still open ...): the engine is not started, and nothing more is reported
            return
        if job["cancelled"]:                            # Cancel was pressed while the report was going out: the engine never starts
            job["rep"].cancel()
            return
        self._start(job, cmd)

    def _settle(self, prev):
        """Close the earlier run `prev` (cancelled, when it is still open) and send every earlier final report the site never answered, OLDEST first, 3 tries each. Returns the newest one still unanswered
        (its `older` chain holds the rest), or None: those are kept, and tried again by the next Plan, until the site answers them."""
        chain, r = [], prev
        while r is not None and r not in chain and len(chain) < 8:
            chain.append(r)
            r = r.older
        keep = []
        for r in reversed(chain):
            r.cancel()
            r.resend_final()
            if r.final and r.final_lost:
                keep.append(r)
        for i, r in enumerate(keep):
            r.older = keep[i - 1] if i else None
        return keep[-1] if keep else None

    def _refused_opening(self, job, left):
        """The site refused the OPENING report of this run (403 not_open, 409 busy or moved_past, 429 too_many, too_many_runs, too_many_tries, slow_down ...). Nothing is run and nothing more is reported (a
        later report could only be answered `not_running`, which would hide the real reason): the first refusal's own fixed words are shown, with 'Nothing was started on this computer.' before them. The
        open-run file is left alone (an earlier run may still be open there, and the next start closes it), and an earlier final report that is still undelivered is kept to be sent again by the next Plan."""
        with self._lock:
            if self.job is not job:
                return
            if not job["cancelled"]:
                job.update(state="failed", error_code=None)
                job["words"], job["next"] = NOT_STARTED_WORDS, ""
            self.last_rep = left                        # (the earlier final reports still unanswered, or None)

    def _fresh_wd(self, sha):
        """The work folder of this Plan: `request-<12 of the fingerprint>`, or with a number after it when an earlier run of the same request was cancelled (its killed engine may still hold the old folder)."""
        k = 1
        while True:
            wd = self.work_dir / ("request-" + sha[:12] + ("" if k == 1 else f"-{k}"))
            if str(wd) not in self._burnt:
                wd.mkdir(parents=True, exist_ok=True)
                return wd
            k += 1

    def _folder_problem(self, names, have):
        if not names or any("=" in n or n.startswith("-") for n in names):
            return "request_invalid"                    # a name with '=' or a leading '-' is never handed to the engine
        if any(n not in have for n in names):
            return "folder_not_chosen"                  # a name with no chosen folder: said in words, nothing is run
        if any(not Path(have[n]).is_dir() for n in names):
            return "folder_missing"
        real = [_norm(have[n]) for n in names]
        if any(i != j and (a == b or a.is_relative_to(b)) for i, a in enumerate(real) for j, b in enumerate(real)):
            return "folders_overlap"                    # two names that mean the same folder (or one inside the other): said in words, not left to the engine
        return None

    def _fail(self, job, code, prev=None, words=None):
        job.update(state="failed", error_code=code)
        job["words"], job["next"] = words or words_for(code)
        self._bg(self._fail_report, job, code, prev)
        return {"started": False, "error_code": code}

    def _fail_report(self, job, code, prev):
        """Off the page's thread: the earlier run is settled first (its unanswered final report is kept until the site answers it), then this run's own `failed`."""
        left = self._settle(prev) if prev is not None else None
        rep = job["rep"]
        if prev is not None:
            rep.older = left
        rep.fail(code)
        if prev is not None and rep.opened:
            rep.older = None                            # the site has taken a report of this run: it has moved on from the older one

    # --- Build
    def build(self, project_id: str) -> dict:
        with self._lock:
            j = self.job
            if not j or j["project_id"] != project_id or j["state"] != "drafted" or j["rep"].final:
                raise RunRefused("Press Plan first for this request, and wait for it to say it is ready.")
            try:
                edit = json.loads(Path(j["draft"]).read_text(encoding="utf-8"))["edit"]
            except Exception:  # noqa: BLE001
                return self._fail(j, "edit_failed")
            have = self.folders.get(project_id)
            bad = self._folder_problem(j["names"], have)
            if bad:
                return self._fail(j, bad)
            (j["wd"] / "edit.json").write_text(json.dumps(edit, ensure_ascii=False), encoding="utf-8")
            self.out_dir.mkdir(parents=True, exist_ok=True)
            j.update(kind="build", state="building", film=self.out_dir / ("compilation-" + time.strftime("%Y%m%d-%H%M%S") + ".mp4"), stdout=[])
            j.update(progress_file=(j["wd"] / PROGRESS_NAME) if self._can_progress("build-edit") else None, ppos=0, progress=None)
            if j["progress_file"]:
                j["progress_file"].unlink(missing_ok=True)
            j["rep"].clear_progress()                   # the plan's numbers (videos) are not the build's (clips)
            cmd = build_command(self.python, j["wd"] / "edit.json", j["wd"] / "cut", j["film"], [have[n] for n in j["names"]], j["progress_file"])
            self.touch()
            self._bg(self._begin, j, None, "building", {k: j.get(k) for k in ("matches", "clips", "film_seconds")}, cmd)
        return {"started": True}

    def _burn(self, job):
        if job.get("wd") is not None:
            self._burnt.add(str(job["wd"]))

    # --- Cancel (a plan, a build, or a plan that is waiting for Build)
    def cancel(self) -> dict:
        with self._lock:
            j = self.job
            if not j or j["state"] not in ("planning", "building", "drafted"):
                return {"state": "none"}
            was, proc = j["state"], j.get("proc")
            self._burn(j)
            j["cancelled"] = True
            j.update(state="cancelled", error_code=None)
            j["words"], j["next"] = CANCELLED_WORDS
        if proc is not None and proc.poll() is None:
            try:
                (self.kill or (lambda p: p.kill()))(proc)       # my own job, by its PID and its children, never by name
            except Exception:  # noqa: BLE001
                pass                                            # the watcher reports `cancelled` when the process is gone
        elif was == "drafted":
            self._bg(j["rep"].cancel)                           # nothing is running: close the open run on the site now
        # planning before the engine started: _begin sees `cancelled` and reports it; a running process: _watch does
        return self.status()

    # --- the process and its reports
    def _start(self, job, cmd):
        env = dict(os.environ, PYTHONPATH=str(self.engine_dir), PYTHONIOENCODING="utf-8", NO_PROXY="127.0.0.1,localhost")
        job["proc"] = self.popen(cmd, cwd=str(self.engine_dir), env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding="utf-8", errors="replace")
        for stream in (job["proc"].stdout, job["proc"].stderr):
            if stream is not None:
                threading.Thread(target=lambda s=stream: [job["stdout"].append(x.rstrip("\n")[:500]) for x in s], daemon=True).start()
        if job["cancelled"]:                            # Cancel came in between the check and the start
            try:
                (self.kill or (lambda p: p.kill()))(job["proc"])
            except Exception:  # noqa: BLE001
                pass
        t = threading.Thread(target=lambda: self._guard(self._watch, job), daemon=True)
        self._track(t)
        t.start()

    def _drain(self, job):
        """Forward the lines the engine has written to its report file since last time (a plan only; a build is reported here, from its exit)."""
        if job["kind"] != "plan":
            return
        try:
            lines = Path(job["report_file"]).read_text(encoding="utf-8").splitlines()
        except OSError:
            return
        for raw in lines[job["seen"]:]:
            job["seen"] += 1
            try:
                line = json.loads(raw)
            except ValueError:
                continue
            if isinstance(line, dict) and line.get("state") != "planning":      # `planning` was sent when Plan was pressed
                job["rep"].forward(line)
                job.update(_clean_counts(line))                       # the page's counts are whole numbers within the caps too

    def _tail_progress(self, job, final: bool = False):
        """Read the lines the engine has added to its progress file since last time: the newest one is what the page shows, and its three numbers are what the next report carries."""
        pf = job.get("progress_file")
        if not pf:
            return
        try:
            with open(pf, "rb") as f:
                f.seek(job.get("ppos", 0))
                data = f.read(1 << 20)
        except OSError:
            return
        if final and data and not data.endswith(b"\n"):
            data += b"\n"
        cut = data.rfind(b"\n")
        if cut < 0:
            return
        job["ppos"] = job.get("ppos", 0) + cut + 1
        last = None
        for raw in data[:cut].splitlines():
            got = parse_progress_line(raw.decode("utf-8", "replace"))
            if got:
                last = got
        if last:
            job["progress"] = last
            job["rep"].set_progress(site_progress(last, job["kind"]))

    def _watch(self, job):
        proc = job["proc"]
        while proc.poll() is None:
            if not job["cancelled"]:
                self._drain(job)
                self._tail_progress(job)
                job["rep"].heartbeat(PROGRESS_GAP_S if job["rep"].progress_due() else self.heartbeat_s)          # still going (a long listen or build): so the site does not mark the run stale; new progress numbers go at most every 10 s
            time.sleep(self.poll_s)
        time.sleep(0.2)                                 # let the output readers finish
        rc, rep = proc.returncode, job["rep"]
        if job["cancelled"]:
            rep.cancel()                                # the state and the words were set when Cancel was pressed
            return
        self._tail_progress(job, final=True)
        self._drain(job)
        job["progress"] = None
        if job["kind"] == "plan":
            if rc == 0 and Path(job["draft"]).is_file():
                with self._lock:
                    kept = not job["cancelled"]
                    if kept:
                        job["state"], job["drafted_at"] = "drafted", self.clock()
                        job["words"], job["next"] = "Ready to build. The preview and the draft are on this computer; no film has been written yet.", "Press Build. Keep this page open: if you close it, the plan is closed on Ryagram."
                if kept:
                    sent = bool(rep._progress_sent)
                    rep.clear_progress()                # the plan is done: the video numbers are not left on the site while it waits for Build
                    if sent:
                        rep.heartbeat(0)
                    threading.Thread(target=lambda: self._guard(self._reap, job), daemon=True).start()
                else:
                    rep.cancel()
                return
            code = rep.sent[-1]["error_code"] if rep.final and rep.sent[-1]["state"] == "failed" else ("request_invalid" if rc == 2 else "crash")
            rep.fail(code)                              # a run that ended with no failure line (a crash, a refused flag) still closes on the site
            job.update(state="failed", error_code=code)
            job["words"], job["next"] = words_for(code)
            return
        if rc == 0 and Path(job["film"]).is_file():
            built = [x for x in job["stdout"] if x.startswith("built ")]
            found = re.search(r"\(([0-9]+(?:\.[0-9]+)?) s\)", built[-1]) if built else None
            if found:
                job["film_seconds"] = round(float(found.group(1)), 2)
            rep.step("done", matches=job.get("matches"), clips=job.get("clips"), film_seconds=job.get("film_seconds"))
            job.update(state="built", error_code=None)
            job["words"], job["next"] = "Your film is on this computer.", "Open the folder to see it. It was never sent anywhere."
            return
        rep.fail("build_failed")
        job.update(state="failed", error_code="build_failed")
        job["words"], job["next"] = words_for("build_failed")

    def _reap(self, job):
        """A plan waiting for Build stays open on the site only while the page is open (and for less than DRAFT_MAX_S); then it is closed as `cancelled`, in words, off the page's thread."""
        while True:
            time.sleep(self.reap_s)
            with self._lock:
                if self.job is not job or job["state"] != "drafted":
                    return
                gone, old = self.clock() - self.last_seen > self.page_grace_s, self.clock() - job["rep"].last_at > self.draft_max_s       # 100 minutes from the last report the site TOOK, not from when the draft was made
                if not (gone or old):
                    continue
                self._burn(job)
                job.update(state="cancelled", error_code=None, cancelled=True)
                job["words"] = "The plan was closed on Ryagram because " + ("the page was closed." if gone else "it waited too long for Build.")
                job["next"] = "Press Plan to start again."
            job["rep"].cancel()
            return
