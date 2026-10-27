"""The live editor's SYNC between this computer and the person's Ryagram account (NEXT-CONNECT 142, design: proposals/CONNECT-LIVE-EDITOR-DESKTOP.md). Standard library only.

WHAT IT DOES, and only when this computer is signed in AND the person has switched it on in the app:
  1. MIRROR  posts the track summary of the film being edited (names and times: the shape tools/maker_live.py's summary() makes, which the site checks again) to POST /node/edit-summary, with the
             person's own tick "Let my AI see my track list" (ai_visible). Unticking posts the end of the mirror, and the site drops the summary and the AI's waiting changes.
  2. LISTEN  asks POST /node/edit-pending (every 3 s while the editor page is open, every 30 s otherwise) for the changes the person's AI, or their web editor, queued for THIS film.
  3. APPLY   puts each waiting change into the local draft through the SAME function the page uses (LiveDraft.apply_ops, with the page's own rules), as the AI's change or the person's; one that
             does not apply (a clip that is gone, a lane the maker cannot build) is refused in the draft's words and acknowledged as not applied.
  4. ACKNOWLEDGE  tells the site which waiting changes were applied (op_id, ok) in the next summary post.

WHAT IT NEVER DOES: it uploads no video, sound, picture or path (the only fields that leave are in LiveDraft.summary(), a fixed list); it makes exactly two kinds of call, the two routes above; it starts no
render and spends nothing (render stays the person's click on the page); it never raises into the maker: a failed call leaves the draft as it was and is tried again later, slower. Offline, the page
works exactly the same: this module is simply quiet."""
from __future__ import annotations

import threading
import time

import maker_live as ML

ROUTE_PENDING = "/node/edit-pending"
ROUTE_SUMMARY = "/node/edit-summary"
GAP_OPEN_S = 3
GAP_CLOSED_S = 30
MAX_BACKOFF_S = 300


class LiveSync:
    def __init__(self, signin, draft: "ML.LiveDraft", *, clock=time.time):
        self.signin, self.draft, self.clock = signin, draft, clock
        self.lock = threading.Lock()
        self.project_id: str | None = None
        self.mirror = False                    # the person switched the mirror on
        self.ai_visible = False                # ... and ticked "Let my AI see my track list" (needs the mirror)
        self.posted_revision = -1              # the draft revision the site last got
        self.posted_flags: tuple | None = None
        self.acks: list = []                   # [{op_id, ok}] waiting for the next post
        self.next_at = 0.0
        self.backoff = 0
        self.message = ""
        self.stopping = False

    # ---- what the person chose
    def attach(self, project_id: str | None) -> None:
        """The site project this local film belongs to (the one the AI's request was written on). None = not attached: nothing is sent."""
        with self.lock:
            if project_id != self.project_id:
                self.project_id, self.posted_revision, self.posted_flags, self.acks = project_id, -1, None, []

    def set_switches(self, mirror: bool, ai_visible: bool) -> None:
        with self.lock:
            self.mirror = bool(mirror)
            self.ai_visible = bool(mirror and ai_visible)
            self.draft.set_ai_visible(self.ai_visible)
            self.next_at = 0.0                       # tell the site soon

    # ---- one cycle
    def status(self) -> dict:
        with self.lock:
            return {"on": self.mirror and self.project_id is not None, "message": self.message}

    def tick(self, force: bool = False) -> dict:
        """One cycle; returns what happened (for the page's small status line and for tests). Never raises."""
        with self.lock:
            return self._tick(force)

    def _signed_in(self) -> bool:
        try:
            return self.signin.status().get("state") == "signed_in"
        except Exception:  # noqa: BLE001
            return False

    def _tick(self, force: bool) -> dict:
        out = {"asked": False, "applied": 0, "refused": 0, "posted": False}
        now = self.clock()
        if self.project_id is None or not self._signed_in():
            return out
        if not force and now < self.next_at:
            return out
        try:
            if not self.mirror:
                if self.posted_flags is not None and self.posted_flags[0]:        # the person switched it off: say so once
                    self._post(mirror=False)
                    out["posted"] = True
                self._schedule(ok=True)
                return out
            out["asked"] = True
            changes = self._pending()
            applied, refused = self._apply(changes)
            out["applied"], out["refused"] = applied, refused
            flags = (self.mirror, self.ai_visible)
            if self.posted_revision != self.draft.ops_since("compilation", 0)["revision"] or self.posted_flags != flags or self.acks:
                self._post(mirror=True)
                out["posted"] = True
            self._schedule(ok=True)
        except Exception as e:  # noqa: BLE001  (offline, a removed computer, a server error: the draft keeps what it has; try again later and slower)
            self.message = (str(e) or "Could not reach Ryagram just now.")[:200]
            self._schedule(ok=False)
        return out

    def _schedule(self, ok: bool) -> None:
        if ok:
            self.backoff, self.message = 0, ""
            self.next_at = self.clock() + (GAP_OPEN_S if self.draft.editor_open() else GAP_CLOSED_S)
        else:
            self.backoff = min(MAX_BACKOFF_S, max(GAP_CLOSED_S, self.backoff * 2 or GAP_CLOSED_S))
            self.next_at = self.clock() + self.backoff

    def _pending(self) -> list:
        status, obj = self.signin.api("POST", ROUTE_PENDING, {})
        if status != 200 or not isinstance(obj, dict) or not isinstance(obj.get("changes"), list):
            raise RuntimeError("Could not read what is waiting for your film just now.")
        waiting_ack = {a["op_id"] for a in self.acks}                    # applied here already, the post that says so has not got through yet: never apply twice
        return [c for c in obj["changes"][:100] if isinstance(c, dict) and c.get("project_id") == self.project_id and isinstance(c.get("id"), int) and c["id"] not in waiting_ack
                and isinstance(c.get("op"), dict)]

    def _apply(self, changes: list) -> tuple[int, int]:
        """Changes that came together (same revision, same sender) are one batch: all or none, as the SQL made them."""
        applied = refused = 0
        i = 0
        while i < len(changes):
            j = i
            key = (changes[i].get("revision"), changes[i].get("client"))
            while j < len(changes) and (changes[j].get("revision"), changes[j].get("client")) == key:
                j += 1
            batch = changes[i:j]
            i = j
            actor = "ai" if key[1] else "person"
            ok = False
            try:
                base = self.draft.ops_since("compilation", 0)["revision"]
                self.draft.apply_ops("compilation", base, [c["op"] for c in batch[:ML.OPS_PER_CALL]], actor, (str(key[1])[:60] if key[1] else None))
                ok = len(batch) <= ML.OPS_PER_CALL
            except ML.LiveError:
                ok = False
            for c in batch:
                self.acks.append({"op_id": c["id"], "ok": ok})
            applied += len(batch) if ok else 0
            refused += 0 if ok else len(batch)
        return applied, refused

    def _post(self, mirror: bool) -> None:
        body = {"project_id": self.project_id, "mirror": mirror}
        if mirror:
            body["ai_visible"] = self.ai_visible
            body["summary"] = self.draft.summary()
        if self.acks:
            body["applied"] = self.acks[:100]
        status, obj = self.signin.api("POST", ROUTE_SUMMARY, body)
        if status != 200:
            raise RuntimeError("Could not tell Ryagram about your film just now.")
        self.acks = self.acks[100:]
        self.posted_revision = self.draft.ops_since("compilation", 0)["revision"]
        self.posted_flags = (mirror, self.ai_visible)

    # ---- a small background loop for the maker (the tests call tick() directly)
    def run_forever(self, sleep=time.sleep) -> None:  # pragma: no cover  (a thread in the maker)
        while not self.stopping:
            self.tick()
            sleep(1)
