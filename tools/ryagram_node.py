"""This computer renders my site films (NEXT-CONNECT 100, r9 M4: the app's node loop). Standard library only. OFF by default; nothing is live.

WHAT IT IS. A signed-in person whose account is flagged "renders on its own computer" can switch this on, on THIS computer. While it is on, the app asks the Ryagram
site, every 30 seconds (60 when it keeps finding nothing), for the next queued job THAT PERSON ordered and that is marked to run on their own computer. It checks
the job as data, renders it with the local engine, and sends back ONLY the finished files. The person's own videos never leave the computer. Credits are never
involved: an owner_local job is quoted at zero by the server.

WHAT IT WILL NOT DO (CC1, plan section 9 items 4 to 8). It polls only while the switch is on, the account state is fresh and the account is flagged. It claims nothing
if this app has no renderer (it says so, plainly, instead of failing a job). Every job is validated by the worker's own validate_job before anything runs, and a job
that fails is reported failed and never rendered. Only files the renderer produced INSIDE the job's folder are sent, of an allowed kind, under a size cap, and the list
is shown on the page first. It talks only to the site host: a signed upload address on any other host is refused. A removed computer is signed out on its next call.

THE SEAMS (so the real pieces can be plugged in at M6 without touching this file): `renderer(job, workdir, progress) -> {kind: Path}`, `validate(job) -> job`,
and `datasets` (the allowlist the app is told it may use). With no renderer the loop does not claim. With no datasets list, validation refuses every job (fail closed).
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

POLL_SECONDS = 30
IDLE_POLL_SECONDS = 60
IDLE_AFTER = 10                               # empty polls in a row before slowing down
HEARTBEAT_SECONDS = 20
MAX_UPLOAD_BYTES = 200_000_000                # the app's own cap; the site enforces its own as well
OUTPUT_KINDS = {"contact_sheet": ".png", "preview": ".mp4", "final_video": ".mp4", "thumbnail": ".jpg", "receipt": ".json", "receipt_text": ".txt", "metering": ".json"}
SWITCH_NAME = "ryagram-node.json"
KEEP_SET_ASIDE_SECONDS = 7 * 24 * 3600         # a dead attempt's folder (set aside, below) is kept this long as evidence, then swept at start
UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", re.I)


class NodeError(Exception):
    def __init__(self, message: str, kind: str = "other"):
        super().__init__(message)
        self.kind = kind


class RenderFailed(Exception):
    """The renderer could not make the film. `retry` says whether the same job may be tried again (the site decides)."""
    def __init__(self, code: str, retry: bool = False):
        super().__init__(code)
        self.code, self.retry = code, retry


def default_validate(datasets):
    """The worker's own validator, fail closed: with no allowlist every job is refused."""
    def check(job):
        if not datasets:
            raise NodeError("This app has not been told which datasets it may use, so it will not run site jobs yet.", "no_datasets")
        from ryagram.worker.schema import Rejected, validate_job            # imported here: the lean kit has only the schema
        try:
            return validate_job(job, datasets=set(datasets))
        except Rejected as e:
            raise NodeError("job_invalid: " + "; ".join(e.errors[:3])[:300], "job_invalid") from None
    return check


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):
        return None


def put_file(url: str, path: Path, content_type: str, allowed_hosts, timeout: float = 600.0) -> None:
    """PUT one file to a signed address. The host must be one we were told about; nothing else is added to the request (no account header, no token)."""
    u = urllib.parse.urlparse(url)
    host = (u.netloc or "").lower()
    local = (u.hostname or "") in ("127.0.0.1", "localhost", "::1")
    if host not in allowed_hosts or not (u.scheme == "https" or (u.scheme == "http" and local)) or u.username or u.password:
        raise NodeError("The site gave an upload address I do not trust, so nothing was sent.", "bad_upload_url")
    handlers = [_NoRedirect()] + ([urllib.request.ProxyHandler({})] if local else [])
    data = path.read_bytes()
    req = urllib.request.Request(url, data=data, method="PUT")
    req.add_header("Content-Type", content_type)
    req.add_header("x-upsert", "true")
    try:
        with urllib.request.build_opener(*handlers).open(req, timeout=timeout) as r:
            if r.status not in (200, 201, 204):
                raise NodeError("The site would not take the file.", "upload_refused")
    except urllib.error.HTTPError:
        raise NodeError("The site would not take the file.", "upload_refused") from None
    except (urllib.error.URLError, TimeoutError, OSError):
        raise NodeError("I could not send the file. It will be tried again.", "offline") from None


class NodeLoop:
    def __init__(self, signin, folder, *, renderer=None, validate=None, datasets=None, uploader=put_file, clock=time.time, log=None, work_root=None, engine_commit=None, cannot_render_reason=""):
        self.signin = signin
        self.folder = Path(folder)
        self.renderer = renderer
        self.validate = validate or default_validate(datasets)
        self.uploader = uploader
        self.clock = clock
        self._log = log or (lambda ev: None)
        self.work_root = Path(work_root) if work_root else self.folder / "node-jobs"
        self.cannot_render_reason = str(cannot_render_reason or "")[:300]   # plain words for why there is no renderer (tools/ryagram_node_render.py), shown on the card
        self.engine_commit = engine_commit          # the commit of the engine that renders (a string or a callable): the site refuses 'complete' without it (found by the local end-to-end harness)
        self.empty_polls = 0
        self.next_at = 0.0
        self.state = {"phase": "off", "message": "", "job": None, "uploads": []}
        self.last = ""                              # what happened to the last film, kept until the next one (the idle message would otherwise cover it at once)
        self._lock = threading.RLock()
        self._stop = threading.Event()
        self._thread = None
        self.on = self._read_switch()

    # ---- the switch: off by default, remembered on this computer, nothing else
    def _read_switch(self) -> bool:
        try:
            return json.loads((self.folder / SWITCH_NAME).read_text(encoding="utf-8")).get("on") is True
        except (OSError, ValueError, AttributeError):
            return False

    def set_switch(self, on: bool) -> dict:
        with self._lock:
            self.on = bool(on)
            try:
                self.folder.mkdir(parents=True, exist_ok=True)
                (self.folder / SWITCH_NAME).write_text(json.dumps({"on": self.on}), encoding="utf-8")
            except OSError:
                pass
            self.empty_polls = 0
            self.next_at = 0.0
            self._set("off" if not self.on else "idle", "" if self.on else "This computer is not rendering site films.")
            self._log("node_on" if self.on else "node_off")
            return self.status()

    def _set(self, phase, message="", job=None, uploads=None):
        self.state = {"phase": phase, "message": message, "job": job, "uploads": uploads or []}

    def status(self) -> dict:
        """What the page may show. No token, no path outside the job folder, no story."""
        with self._lock:
            g = self.signin.gate()
            st = dict(self.state)
            st.update(on=self.on, allowed=bool(g["node"]), can_render=self.renderer is not None, empty_polls=self.empty_polls, last=self.last)
            if self.on and not g["node"]:
                st["phase"], st["message"] = "paused", g["note"] or "This account does not render site films on this computer."
            elif self.on and self.renderer is None:
                st["phase"] = "cannot_render"
                st["message"] = ("This computer cannot make site films yet, so it is not taking any jobs: " + self.cannot_render_reason) if self.cannot_render_reason                     else "This copy of the app cannot make site films yet, so it is not taking any jobs."
            elif self.on and st["phase"] in ("paused", "cannot_render"):
                st["phase"], st["message"] = "idle", "Waiting for a film to make."          # whatever paused it has passed; the next step will say otherwise if not
            return st

    def next_delay(self) -> float:
        return IDLE_POLL_SECONDS if self.empty_polls >= IDLE_AFTER else POLL_SECONDS

    # ---- one turn of the loop (the thread calls this; tests call it directly)
    def step(self) -> str:
        with self._lock:
            if not self.on:
                return "off"
            g = self.signin.gate()
            if not g["node"]:
                self._set("paused", g["note"] or "This account does not render site films on this computer.")
                return "paused"
            if self.renderer is None:
                self._set("cannot_render", ("This computer cannot make site films yet, so it is not taking any jobs: " + self.cannot_render_reason) if self.cannot_render_reason
                          else "This copy of the app cannot make site films yet, so it is not taking any jobs.")
                return "cannot_render"
        try:
            status, r = self.signin.api("POST", "/node/claim", {})
        except Exception as e:                                          # offline, removed, anything: say it plainly and stay quiet
            with self._lock:
                self._set("waiting", str(e)[:200])
            return "error"
        if status == 403:
            with self._lock:
                self._set("paused", "The site says this account is not set to render on its own computer.")
            return "refused"
        if status != 200:
            with self._lock:
                self._set("waiting", "The site would not answer just now. It will try again.")
            return "error"
        job = r.get("job")
        if not job:
            with self._lock:
                self.empty_polls += 1
                self._set("idle", "Waiting for a film to make.")
            return "idle"
        with self._lock:
            self.empty_polls = 0
        return self._work(job)

    def _report(self, job_id, state, code=None, detail=None):
        body = {"job_id": job_id, "state": state}
        commit = self.engine_commit() if callable(self.engine_commit) else self.engine_commit
        if commit and state in ("running", "validating", "uploading", "complete"):
            body["engine_commit"] = str(commit)[:40]
            body["engine_dirty"] = False
        if code:
            body["error_code"] = code
        if detail:
            body["error_detail"] = str(detail)[:500]
        return self.signin.api("POST", "/node/state", body)

    def _work(self, job: dict) -> str:
        jid = str(job.get("id", ""))
        if not UUID.match(jid):
            self._set("idle", "The site sent a job I could not read.")
            return "rejected"
        try:
            checked = self.validate(job)                                 # the job is DATA: a bad one is reported failed and never rendered
        except NodeError as e:
            self._report(jid, "failed", e.kind[:40], str(e))
            with self._lock:
                self._set("idle", "A job did not pass the check, so it was not run.")
            self.last = "The last job did not pass the check, so it was not run."
            self._log("node_job_refused")
            return "rejected"
        work = self.work_root / jid
        if work.exists():
            # Left by an earlier attempt that died with this computer (shut down or crashed mid-render; the site requeued the job when its
            # lease ran out). Never reused: something it half-wrote must not be sent as this attempt's film. Moved aside, not deleted,
            # as the house worker does; if it cannot be moved the job fails plainly and nothing is removed.
            aside = work.with_name(f"{jid}.attempt-before-{int(self.clock())}")
            try:
                work.rename(aside)
            except OSError:
                self._report(jid, "failed", "node_leftover", "An earlier attempt's folder could not be set aside, so the film was not made.")
                with self._lock:
                    self._set("idle", "An earlier attempt's files are in the way, so that film was not made.")
                self._log("node_job_failed")
                return "failed"
            self._log("node_attempt_set_aside")
        work.mkdir(parents=True, exist_ok=True)
        last_beat = [self.clock()]

        def progress(note: str = ""):
            if note:                                                      # what the card says while the renderer works (fixed sentences only)
                with self._lock:
                    if self.state.get("phase") == "rendering":
                        self._set("rendering", str(note)[:120], {"id": jid})
            if self.clock() - last_beat[0] >= HEARTBEAT_SECONDS:
                last_beat[0] = self.clock()
                self.signin.api("POST", "/node/heartbeat", {"job_id": jid, "note": str(note)[:200]})

        try:
            with self._lock:
                self._set("rendering", "Making a film from your order.", {"id": jid})
            self._report(jid, "running")
            outputs = self.renderer(checked, work, progress)
            self._report(jid, "validating")
            files = self._collect(outputs, work)
            with self._lock:
                self._set("uploading", "Sending the finished film.", {"id": jid}, [{"kind": k, "name": p.name, "bytes": p.stat().st_size} for k, p in files])
            self._report(jid, "uploading")
            for kind, path in files:
                self._upload(jid, kind, path)
            status, r = self._report(jid, "complete")
            if status != 200:                                              # the site checks every file is there at the announced size before it says complete
                raise NodeError("The site did not accept the finished film as complete, so it was not marked done.", "not_complete")
            with self._lock:
                self.last = "The last film was made and sent."
                self._set("idle", "Done. Waiting for the next film.")
            self._log("node_job_done")
            return "worked"
        except RenderFailed as e:
            if e.retry:
                self.signin.api("POST", "/node/retry", {"job_id": jid, "error_code": e.code[:80]})
            else:
                self._report(jid, "failed", e.code[:80], "The film could not be made on this computer.")
            with self._lock:
                self._set("idle", "A film could not be made on this computer.")
            self.last = "The last film could not be made on this computer."
            self._log("node_job_failed")
            return "failed"
        except NodeError as e:
            self._report(jid, "failed", e.kind[:40], str(e)[:200])
            with self._lock:
                self._set("idle", str(e)[:200])
            self.last = "The last film could not be made on this computer."
            self._log("node_job_failed")
            return "failed"
        except Exception as e:                                           # nothing the renderer or the network does may end the loop; the detail is the exception TYPE only
            try:
                self._report(jid, "failed", "node_error", type(e).__name__)
            except Exception:                                            # noqa: BLE001
                pass
            with self._lock:
                self._set("idle", "Something went wrong on this computer, so that film was not made.")
            self.last = "The last film could not be made on this computer."
            self._log("node_job_failed")
            return "failed"

    def _collect(self, outputs, work: Path):
        """Only what the renderer produced INSIDE the job's own folder, of a known kind and extension, under the cap. Never a source video."""
        root = work.resolve()
        files = []
        for kind, p in (outputs or {}).items():
            path = Path(p)
            try:
                rp = path.resolve(strict=True)
            except OSError:
                raise NodeError("A finished file is missing.", "missing_output") from None
            if kind not in OUTPUT_KINDS or rp.suffix.lower() != OUTPUT_KINDS[kind]:
                raise NodeError("A finished file is not of a kind this computer may send.", "bad_output")
            if root not in rp.parents:
                raise NodeError("A file outside the job's own folder was about to be sent, so nothing was sent.", "outside_job")
            if rp.stat().st_size > MAX_UPLOAD_BYTES:
                raise NodeError("A finished file is larger than this computer may send.", "too_large")
            files.append((kind, rp))
        if not files:
            raise NodeError("The film made nothing to send.", "no_output")
        return files

    def _upload(self, jid: str, kind: str, path: Path):
        data = path.read_bytes()
        status, r = self.signin.api("POST", "/node/artifact", {"job_id": jid, "kind": kind, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()})
        if status == 413:
            raise NodeError("The site says a finished file is too large to send.", "too_large")
        if status != 200 or not isinstance(r.get("upload_url"), str):
            raise NodeError("The site would not accept a finished file.", "artifact_refused")
        ctype = {".png": "image/png", ".mp4": "video/mp4", ".jpg": "image/jpeg", ".json": "application/json", ".txt": "text/plain"}[path.suffix.lower()]
        self.uploader(r["upload_url"], path, ctype, {self.signin.host})

    def sweep_set_aside(self, now: float | None = None) -> int:
        """At start: delete dead attempts' folders (`<job id>.attempt-before-<time>`, set aside by _work) older than KEEP_SET_ASIDE_SECONDS.
        Only folders named so, directly in the job folder; never a link or junction, never followed."""
        now = self.clock() if now is None else now
        n = 0
        try:
            entries = list(self.work_root.iterdir())
        except OSError:
            return 0
        for p in entries:
            head, _, tail = p.name.partition(".attempt-before-")
            if not (UUID.match(head) and tail.isdigit()) or os.path.islink(p) or os.path.isjunction(p) or not p.is_dir():
                continue
            try:
                old = now - p.stat().st_mtime > KEEP_SET_ASIDE_SECONDS
            except OSError:
                continue
            if old:
                shutil.rmtree(p, ignore_errors=True)
                n += not p.exists()
        return n

    # ---- the background thread (the page switch starts and stops it)
    def start(self):
        self.sweep_set_aside()
        with self._lock:
            if self._thread and self._thread.is_alive():
                return
            self._stop.clear()
            self._thread = threading.Thread(target=self._run, daemon=True)
            self._thread.start()

    def _run(self):
        while not self._stop.is_set():
            res = self.step() if self.on else "off"
            self._stop.wait(2.0 if res == "worked" else (self.next_delay() if self.on else 5.0))

    def stop(self):
        self._stop.set()
