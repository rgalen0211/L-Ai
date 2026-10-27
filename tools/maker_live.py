"""The live editor's DRAFT on this computer (NEXT-CONNECT 142, design: proposals/CONNECT-LIVE-EDITOR-DESKTOP.md). Standard library only; nothing here touches the network, a video or a path.

WHAT IT IS. The website's editor page talks to its draft through one seam, rpc(name, args) -> {data, error}, written against five functions (editor_apply_ops, editor_undo, editor_undo_all_ai,
my_edit_ops_since, editor_heartbeat; supabase/migrations/20261027000400_live_editor.sql is their authority). In the maker the same page talks to THIS module instead, so the page cannot tell it is
offline: the same revision rule, the same refusals in the same words, the same answers and error codes (PT409 stale, PT403 not shared, PT404, PT429, 22023). The draft lives in one small file
(live-draft.json) and holds names and times only.

WHY A PYTHON TWIN OF THE PAGE'S CORE. An AI's change arrives (through the sync) while the editor page may be CLOSED, and must still be applied to the film: so the page's own rules (assets/app-editor-core.js,
WEB's file: check() and apply(), the video lane packed from 0, the length limits, the lanes the maker can build) exist here too. tests/live-editor-vectors.json is made FROM the real core
(node) and tools/check-maker-live-draft.py runs every case through this module, sentence for sentence, so the two cannot drift; the closed vocabulary (edit_op_problem in SQL) is checked first,
with tests/edit-op-cases.json, the same file the SQL and TypeScript checks run.

WHAT IT NEVER DOES: no network, no process, no file but its own draft file, no path in any answer. The AI's limits (20 changes a call, 60 a minute, 600 a day, no repeating what the person undid
in the last 10 minutes) are enforced for actor 'ai' exactly as in SQL; the person has none."""
from __future__ import annotations

import json
import math
import os
import re
import sys
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

SCHEMA = "ryagram.live-draft/0"
MIN_LEN = 0.3
MAX_TEXT = 200
TRACKS = ("video", "pictures", "text", "music")
OPS_PER_CALL, OPS_PER_MINUTE, OPS_PER_DAY, UNDONE_WINDOW_S = 20, 60, 600, 600
COLOUR = re.compile(r"^#[0-9a-fA-F]{6}$")
ID = re.compile(r"^[A-Za-z0-9_-]{1,40}$")
PICTURE = re.compile(r'^[^\\/:*?"<>|\x00-\x1f\x7f-\x9f]{1,100}\.(png|jpg|jpeg|webp)$', re.IGNORECASE)
_BAD = [(0, 31), (127, 127), (0x200E, 0x200F), (0x202A, 0x202E), (0x2066, 0x2069), (60, 60), (62, 62)]
_CLEAN = re.compile("[" + "".join(chr(a) + "-" + chr(b) for a, b in _BAD) + "]")
_CTRL = re.compile("[" + chr(0) + "-" + chr(31) + chr(127) + "-" + chr(159) + "]")
_BIDI = re.compile("[" + chr(0x202A) + "-" + chr(0x202E) + chr(0x2066) + "-" + chr(0x2069) + chr(0x200E) + chr(0x200F) + "]")
_PLACE = re.compile(r"([A-Za-z]:[\\/]|\\\\|(^|\s)/[A-Za-z]|\.\.[\\/]|[A-Za-z][A-Za-z0-9+.-]*://)")
LOCAL_ONLY = ("speaker", "speakers", "speaker_state", "speaker_label", "voice", "voices", "voice_id", "cast", "cast_badge", "face", "faces")
INF = float("inf")


def _is_num(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def _is_int(v) -> bool:
    return _is_num(v) and v == int(v)


def js_num(n) -> str:
    """A number the way JavaScript writes it in a sentence (1 not 1.0), so a refusal reads the same on both sides."""
    if isinstance(n, float) and n == int(n) and abs(n) < 1e15:
        return str(int(n))
    return repr(n) if isinstance(n, float) else str(n)


def rnd(n) -> float:
    """Math.round(n * 1000) / 1000 (half rounds up, as in JavaScript)."""
    r = math.floor(n * 1000 + 0.5) / 1000
    return int(r) if r == int(r) and abs(r) < 1e15 else r


def clean_text(s) -> str:
    return _CLEAN.sub("", str(s))[:MAX_TEXT]


def text_ok(t, mx: int) -> bool:
    return isinstance(t, str) and 1 <= len(t) <= mx and not _CTRL.search(t) and not _BIDI.search(t) and not _PLACE.search(t) and not re.search(r"[<>]", t)


# --------------------------------------------------------------------------------------------------------- the look keys (edit_look_keys in SQL; WEB's LOOK_KEYS)
LOOK_KEYS = {
    "network.color": ("colour", None), "network.base_color": ("colour", None), "network.context_color": ("colour", None), "state.fill": ("colour", None), "page.background": ("colour", None),
    "choropleth.low": ("colour", None), "choropleth.high": ("colour", None),
    "state.outline_width": ("number", (0, 4)), "sequence.theme": ("enum", ("light", "dark")),
}


def _look_ok(key: str, v, keys=LOOK_KEYS) -> bool:
    kind, extra = keys[key]
    if kind == "colour":
        return isinstance(v, str) and bool(COLOUR.match(v))
    if kind == "number":
        return _is_num(v) and extra[0] <= v <= extra[1]
    if kind == "enum":
        return isinstance(v, str) and v in extra
    if kind == "bool":
        return isinstance(v, bool)
    return False


# --------------------------------------------------------------------------------------------------------- 1. the closed vocabulary (edit_op_problem in SQL; opProblem in TypeScript)
def op_problem(mode: str, op, look_keys=None):
    """None = fine, else the plain sentence. Same words as the SQL and the TypeScript twin (tests/edit-op-cases.json is run through all three)."""
    keys_def = look_keys or {k: {"kind": v[0], "extra": v[1]} for k, v in LOOK_KEYS.items()}
    if not isinstance(op, dict):
        return "A change must be an object."
    if not isinstance(op.get("op"), str):
        return 'A change needs an "op" naming what it does.'
    kind = op["op"]
    have = list(op.keys())

    def known(allowed):
        return all(k in allowed for k in have)

    if mode == "data":
        if kind == "set_look":
            allowed = ["op", "key", "value"]
        elif kind == "unset_look":
            allowed = ["op", "key"]
        else:
            return f'"{kind[:40]}" is not a change this editor knows for a data film.'
        if not known(allowed):
            return "That change has a field the editor does not know."
        if not isinstance(op.get("key"), str):
            return 'A look change needs a "key".'
        k = keys_def.get(op["key"])
        if k is None:
            return f'"{op["key"][:60]}" is not a look setting the editor has.'
        if kind == "unset_look":
            return None
        if "value" not in op:
            return 'A set_look change needs a "value".'
        v, kk = op["value"], k["kind"]
        if kk == "colour" and not (isinstance(v, str) and COLOUR.match(v)):
            return f'"{op["key"]}" needs a colour like #1a73e8.'
        if kk == "enum" and not (isinstance(v, str) and v in k["extra"]):
            return f'"{op["key"]}" can only be: {", ".join(k["extra"])}.'
        if kk == "number":
            if not _is_num(v):
                return f'"{op["key"]}" needs a number.'
            if v < k["extra"][0] or v > k["extra"][1]:
                return f'"{op["key"]}" must be between {js_num(k["extra"][0])} and {js_num(k["extra"][1])}.'
        if kk == "bool" and not isinstance(v, bool):
            return f'"{op["key"]}" must be true or false.'
        return None
    allowed_by = {"move_clip": ["op", "id", "start"], "trim_clip": ["op", "id", "edge", "to"], "reorder_clip": ["op", "id", "index"], "set_clip_text": ["op", "id", "text"],
                  "delete_clip": ["op", "id"], "add_clip": ["op", "track", "start", "len", "text", "picture"]}
    if kind not in allowed_by:
        return f'"{kind[:40]}" is not a change this editor knows for a compilation.'
    if not known(allowed_by[kind]):
        return "That change has a field the editor does not know."
    if kind != "add_clip" and not (isinstance(op.get("id"), str) and ID.match(op["id"])):
        return 'This change needs a clip "id" from get_edit_state.'
    for name in ("start", "to", "len"):
        if name in op and not _is_num(op[name]):
            return f'"{name}" must be a number.'
    text_msg = "The text must be 1 to 120 characters of plain words (no places on a computer, no web addresses, no markup)."
    if kind == "move_clip":
        if "start" not in op:
            return 'move_clip needs "start".'
        if op["start"] < 0 or op["start"] > 86400:
            return '"start" must be between 0 and 86400 seconds.'
    elif kind == "trim_clip":
        if op.get("edge") not in ("start", "end"):
            return 'Trim the "start" or the "end".'
        if "to" not in op:
            return 'trim_clip needs "to".'
        if op["to"] < 0 or op["to"] > 86400:
            return '"to" must be between 0 and 86400 seconds.'
    elif kind == "reorder_clip":
        if not (_is_int(op.get("index")) and 0 <= op["index"] <= 199):
            return '"index" must be a whole number from 0 to 199.'
    elif kind == "set_clip_text":
        if not text_ok(op.get("text"), 120):
            return text_msg
    elif kind == "add_clip":
        if op.get("track") not in ("text", "pictures"):
            return 'The AI can add a "text" or a "pictures" clip.'
        if "start" not in op or "len" not in op:
            return 'A new clip needs "start" and "len".'
        if op["start"] < 0 or op["start"] > 3600:
            return '"start" must be between 0 and 3600 seconds.'
        if op["len"] < 0.3 or op["len"] > 30:
            return '"len" must be between 0.3 and 30 seconds.'
        if op["track"] == "text":
            if "picture" in op or "text" not in op:
                return 'A text clip needs "text" and no "picture".'
            if not text_ok(op["text"], 120):
                return text_msg
        else:
            if "text" in op or "picture" not in op:
                return 'A picture clip needs a "picture" name and no "text".'
            if not (isinstance(op["picture"], str) and PICTURE.match(op["picture"])):
                return "A picture is the NAME of one the person added in the app (png, jpg or webp), never a place."
    return None


# --------------------------------------------------------------------------------------------------------- 2. the page's own rules (app-editor-core.js: newState, check, apply)
def new_state(init: dict | None = None) -> dict:
    init = init or {}
    s = {"look": json.loads(json.dumps(init.get("look") or {})), "clips": [], "duration": init.get("duration") or 0, "revision": 0}
    for c in init.get("clips") or []:
        c = json.loads(json.dumps(c))
        for k in LOCAL_ONLY:
            c.pop(k, None)
        s["clips"].append(c)
    if isinstance(init.get("lanes"), list):
        s["lanes"] = [x for x in init["lanes"] if x in TRACKS]
    lim = init.get("limits")
    if isinstance(lim, dict):
        s["limits"] = {"text_chars": lim["text_chars"] if _is_int(lim.get("text_chars")) else None}
    return s


def _min_len(c) -> float:
    return c["min_len"] if _is_num(c.get("min_len")) else MIN_LEN


def _max_len(c) -> float:
    return c["max_len"] if _is_num(c.get("max_len")) else INF


def _clip(state, cid):
    return next((c for c in state["clips"] if c.get("id") == cid), None)


def _videos(state):
    return [c for c in state["clips"] if c.get("track") == "video"]


def repack(state) -> None:
    t = 0
    for c in _videos(state):
        c["start"] = rnd(t)
        t += c["len"]


def _end_of(state):
    return rnd(max([c["start"] + c["len"] for c in state["clips"]] or [0]))


def _cap(state):
    lim = state.get("limits")
    return lim.get("text_chars") if isinstance(lim, dict) else None


def check(state: dict, op, look_keys=None):
    """None when the op may be applied to this state, else the sentence the page shows (app-editor-core.js check(), sentence for sentence)."""
    keys = look_keys or LOOK_KEYS
    ops = ("set_look", "unset_look", "move_clip", "trim_clip", "reorder_clip", "set_clip_text", "delete_clip", "add_clip")
    if not isinstance(op, dict) or op.get("op") not in ops:
        return "That change is not one the editor can make."
    if op["op"] in ("set_look", "unset_look"):
        if not isinstance(op.get("key"), str) or op["key"] not in keys:
            return "That setting is not available yet."
        if op["op"] == "set_look" and not _look_ok(op["key"], op.get("value"), keys):
            return "That value is not allowed for this setting."
        return None
    lanes = state.get("lanes")
    if op["op"] == "add_clip":
        if op.get("track") not in ("text", "pictures"):
            return "You can add a text line or a picture here."
        if lanes is not None and op["track"] not in lanes:
            return "That part of the film can not be edited here yet."
        if not _is_num(op.get("start")) or op["start"] < 0 or not _is_num(op.get("len")) or op["len"] < (0.5 if op["track"] == "text" else MIN_LEN) - 1e-9:
            return "Give it a start and a length that fit the film."
        if state.get("duration") and op["start"] + op["len"] > state["duration"] + 1e-6:
            return "That is outside the film."
        if op["track"] == "text":
            if not isinstance(op.get("text"), str) or not clean_text(op["text"]).strip():
                return "A text line needs some words."
            cap = _cap(state)
            if cap and len(clean_text(op["text"])) > cap:
                return f"Text can be at most {cap} letters here."
        elif not isinstance(op.get("picture"), str) or not op["picture"]:
            return "Pick one of your pictures."
        return None
    c = _clip(state, op.get("id"))
    if c is None:
        return "That clip is not in this film."
    if lanes is not None and c.get("track") not in lanes:
        return "That part of the film can not be edited here yet."
    if op["op"] == "move_clip":
        if c["track"] == "video":
            return "Video clips follow each other. Reorder this one instead."
        if not _is_num(op.get("start")) or op["start"] < 0 or (state.get("duration") and op["start"] + c["len"] > state["duration"] + 1e-6):
            return "That is outside the film."
    elif op["op"] == "trim_clip":
        if op.get("edge") not in ("start", "end"):
            return "Trim the start or the end."
        if not _is_num(op.get("to")) or op["to"] < 0:
            return "That is outside the film."
        delta = op["to"] - c["start"] if op["edge"] == "start" else 0
        new_len = c["len"] - delta if op["edge"] == "start" else op["to"] - c["start"]
        frm = op["to"] if op["edge"] == "start" else c["start"]
        to = c["start"] + c["len"] if op["edge"] == "start" else op["to"]
        if new_len < _min_len(c) - 1e-9:
            return f"A clip can not be shorter than {js_num(_min_len(c))} seconds."
        if c["track"] == "video":
            if op["edge"] == "start" and _is_num(c.get("source_start")) and c["source_start"] + delta < -1e-9:
                return "That is before the start of the video file."
            room = _max_len(c) - (delta if op["edge"] == "start" else 0)
            if new_len > room + 1e-9:
                return "That is past the end of the video file."
        else:
            if new_len > _max_len(c) + 1e-9:
                return f"A clip can not be longer than {js_num(_max_len(c))} seconds."
            if state.get("duration") and to > state["duration"] + 1e-6:
                return "That is outside the film."
            if frm < 0:
                return "That is outside the film."
    elif op["op"] == "reorder_clip":
        if c["track"] != "video":
            return "Only video clips can be reordered."
        if not _is_int(op.get("index")) or op["index"] < 0 or op["index"] >= len(_videos(state)):
            return "There is no such place in the list."
    elif op["op"] == "set_clip_text":
        if c["track"] != "text":
            return "Only a text clip has text."
        if not isinstance(op.get("text"), str):
            return "The text must be words."
        cap = _cap(state)
        if cap and len(clean_text(op["text"])) > cap:
            return f"Text can be at most {cap} letters here."
    return None


def apply(state: dict, op: dict) -> dict:
    """The next state (app-editor-core.js apply()). The caller has checked the op."""
    nxt = json.loads(json.dumps(state))
    if op["op"] == "set_look":
        nxt["look"][op["key"]] = op["value"]
    elif op["op"] == "unset_look":
        nxt["look"].pop(op["key"], None)
    elif op["op"] == "add_clip":
        cid = f'new{state["revision"] + 1}'
        if op["track"] == "text":
            nxt["clips"].append({"id": cid, "track": "text", "start": rnd(op["start"]), "len": rnd(op["len"]), "label": "Text", "text": clean_text(op["text"]), "min_len": 0.5})
        else:
            nxt["clips"].append({"id": cid, "track": "pictures", "start": rnd(op["start"]), "len": rnd(op["len"]), "label": "Picture", "picture": op["picture"]})
    else:
        c = _clip(nxt, op["id"])
        if op["op"] == "move_clip":
            c["start"] = rnd(op["start"])
        elif op["op"] == "trim_clip":
            if op["edge"] == "start" and c["track"] == "video":
                delta = op["to"] - c["start"]
                c["len"] = rnd(c["len"] - delta)
                if _is_num(c.get("source_start")):
                    c["source_start"] = rnd(c["source_start"] + delta)
                if _is_num(c.get("max_len")):
                    c["max_len"] = rnd(c["max_len"] - delta)
            elif op["edge"] == "start":
                end = c["start"] + c["len"]
                c["start"] = rnd(op["to"])
                c["len"] = rnd(end - op["to"])
            else:
                c["len"] = rnd(op["to"] - c["start"])
            if c["track"] == "video":
                repack(nxt)
        elif op["op"] == "reorder_clip":
            vids = _videos(nxt)
            vids.remove(c)
            vids.insert(op["index"], c)
            others = [x for x in nxt["clips"] if x.get("track") != "video"]
            nxt["clips"] = vids + others
            repack(nxt)
        elif op["op"] == "set_clip_text":
            c["text"] = clean_text(op["text"])
        elif op["op"] == "delete_clip":
            nxt["clips"] = [x for x in nxt["clips"] if x is not c]
            if c["track"] == "video":
                repack(nxt)
    d = state.get("duration") or 0
    nxt["duration"] = max(d, _end_of(nxt))
    nxt["revision"] = state["revision"] + 1
    return nxt


# --------------------------------------------------------------------------------------------------------- 3. the draft, with the five functions
class LiveError(Exception):
    """An answer the page maps by code: PT409 stale, PT403 not shared, PT404 not found, PT429 too fast, 22023 refused."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code, self.message = code, message


def _iso(t: float) -> str:
    return datetime.fromtimestamp(t, timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")


class LiveDraft:
    """The draft of one project on this computer. `path` = live-draft.json beside edit.json; `clock` is injectable for tests. Thread-safe (the page and the sync both call it)."""

    def __init__(self, path, clock=time.time, look_keys=None, hook=None):
        self.path, self.clock, self.look_keys = Path(path), clock, look_keys
        self.hook = hook                 # hook(mode, state): turns the new state into what the engine builds from, or raises LiveError to refuse it; called before anything is kept
        self.lock = threading.RLock()
        self.data = self._load()

    # ---- storage
    def _blank_mode(self, mode):
        base = new_state({"look": {}, "clips": []})
        return {"revision": 0, "base": base, "state": base, "ops": [], "ai_visible": False, "editor_seen_at": None}

    def _load(self):
        try:
            d = json.loads(self.path.read_text(encoding="utf-8"))
            if d.get("schema") == SCHEMA and isinstance(d.get("modes"), dict):
                for m in ("data", "compilation"):
                    d["modes"].setdefault(m, self._blank_mode(m))
                return d
        except (OSError, ValueError):
            pass
        return {"schema": SCHEMA, "next_op_id": 1, "modes": {m: self._blank_mode(m) for m in ("data", "compilation")}}

    def _save(self):
        tmp = self.path.with_name(self.path.name + ".tmp")
        tmp.write_text(json.dumps(self.data, separators=(",", ":"), sort_keys=True), encoding="utf-8")
        os.replace(tmp, self.path)

    def _mode(self, mode):
        if mode not in ("data", "compilation"):
            raise LiveError("22023", "That is not an editor mode.")
        return self.data["modes"][mode]

    # ---- the film this draft sits on
    def set_base(self, mode: str, base: dict) -> None:
        """A new starting point (the plan changed, or the edit list was rebuilt): the log starts again from it, the revision keeps climbing."""
        with self.lock:
            m = self._mode(mode)
            st = new_state(base)
            m["base"], m["state"], m["ops"] = st, json.loads(json.dumps(st)), []
            m["revision"] += 1
            self._save()

    def set_ai_visible(self, visible: bool) -> None:
        """The person's tick 'Let my AI see my track list'. Unticking drops the AI's changes that have not been applied (none wait locally) and nothing else."""
        with self.lock:
            self._mode("compilation")["ai_visible"] = bool(visible)
            self._save()

    def state(self, mode: str) -> dict:
        with self.lock:
            return json.loads(json.dumps(self._mode(mode)["state"]))

    def summary(self) -> dict:
        """What the sync may post to the site: names and times only (the shape node_edit_post_summary accepts). Local-only fields never leave."""
        with self.lock:
            s = self._mode("compilation")["state"]
            keep = ("id", "track", "start", "len", "label", "text", "picture", "file", "source", "source_start", "min_len", "max_len", "position", "size", "ai_altered", "ai_altered_by")
            out = {"schema": "ryagram.edit-tracks/0", "duration": s.get("duration", 0), "clips": [{k: c[k] for k in keep if k in c} for c in s["clips"]]}
            if "lanes" in s:
                out["lanes"] = list(s["lanes"])
            if s.get("limits"):
                out["limits"] = {k: v for k, v in s["limits"].items() if v is not None}
            return out

    # ---- the five functions
    def rpc(self, name: str, args: dict) -> dict:
        """The seam the page calls: {data, error}. Only the five names exist."""
        try:
            if name == "editor_apply_ops":
                return {"data": self.apply_ops(args["p_mode"], args["p_base_revision"], args["p_ops"], "person", None), "error": None}
            if name == "editor_undo":
                return {"data": self.undo(args["p_mode"], [args["p_op_id"]], "person"), "error": None}
            if name == "editor_undo_all_ai":
                return {"data": self.undo_all_ai(args["p_mode"]), "error": None}
            if name == "my_edit_ops_since":
                return {"data": self.ops_since(args["p_mode"], args["p_revision"]), "error": None}
            if name == "editor_heartbeat":
                self.heartbeat(args["p_mode"])
                return {"data": None, "error": None}
        except LiveError as e:
            return {"data": None, "error": {"code": e.code, "message": e.message}}
        except (KeyError, TypeError):
            return {"data": None, "error": {"code": "22023", "message": "That call was not understood."}}
        return {"data": None, "error": {"code": "22023", "message": "That call is not one the editor makes."}}

    def apply_ops(self, mode, base_revision, ops, actor="person", client=None):
        """apply_edit_ops: all or none, a revision check, the vocabulary, then the page's own rules op by op on a running copy; the AI is also held to its limits."""
        with self.lock:
            m = self._mode(mode)
            if actor not in ("person", "ai"):
                raise LiveError("22023", "That is not an editor mode.")
            if not isinstance(ops, list) or not 1 <= len(ops) <= OPS_PER_CALL:
                raise LiveError("22023", "Send between 1 and 20 changes at a time.")
            if base_revision != m["revision"]:
                raise LiveError("PT409", f'The editor has changed since you looked (it is now at revision {m["revision"]}). Read it again with get_edit_state and send your changes on top of that.')
            if mode == "compilation" and actor == "ai" and not m["ai_visible"]:
                raise LiveError("PT403", 'The person has not shared their track list with their AI. Ask them to tick "Let my AI see my track list" in the Ryagram app.')
            now = self.clock()
            if actor == "ai":
                times = self.data.setdefault("ai_times", [])
                times[:] = [x for x in times if now - x < 86400]                              # the AI's own ledger: the shown log keeps only the last 400 changes
                recent = lambda secs: sum(1 for x in times if now - x < secs)  # noqa: E731
                if recent(60) + len(ops) > OPS_PER_MINUTE:
                    raise LiveError("PT429", "That is more than 60 changes in a minute. Wait a minute and continue.")
                if recent(86400) + len(ops) > OPS_PER_DAY:
                    raise LiveError("PT429", "That is more than 600 changes in a day, the limit for now. Try tomorrow.")
            running = m["state"]
            for i, op in enumerate(ops, 1):
                why = op_problem(mode, op, self._look_defs()) or check(running, op, self.look_keys)
                if why:
                    raise LiveError("22023", f"Change {i} was not accepted, and nothing was changed: {why}")
                if actor == "ai" and any(r["status"] in ("undone", "rejected") and r.get("ended_by") == "person" and r["op"] == op and now - (r["undone_at"] or 0) < UNDONE_WINDOW_S
                                         for r in m["ops"]):
                    raise LiveError("PT409", f"Change {i} was not accepted: the person undid exactly this a moment ago. Ask them before doing it again.")
                running = apply(running, op)
            if self.hook:
                self.hook(mode, running)
            revision = m["revision"] + 1
            for op in ops:
                self._add_row(m, revision, actor, client, op, now)
                if actor == "ai":
                    self.data.setdefault("ai_times", []).append(now)
            m["state"], m["revision"] = running, revision
            self._save()
            return {"revision": revision, "changes": len(ops), "state": self._shown(mode, running), "pending": False}

    def _look_defs(self):
        return None

    def _add_row(self, m, revision, actor, client, op, now):
        rid = self.data["next_op_id"]
        self.data["next_op_id"] = rid + 1
        m["ops"].append({"id": rid, "revision": revision, "actor": actor, "client": (client or ("ai" if actor == "ai" else None)), "op": op, "status": "applied", "at": now, "undone_at": None, "ended_by": None})
        del m["ops"][:-400]                                                      # a draft keeps its last 400 changes: it is a working file, not a history

    @staticmethod
    def _shown(mode, state):
        if mode == "data":
            return {"look": json.loads(json.dumps(state["look"]))}
        return json.loads(json.dumps(state))

    def undo(self, mode, op_ids, by="person"):
        """Take some changes back. The film is replayed from its base without them; a data setting that a LATER change also set is left alone (skipped), as in SQL."""
        with self.lock:
            m = self._mode(mode)
            now = self.clock()
            undone = skipped = 0
            for row in sorted((r for r in m["ops"] if r["id"] in op_ids), key=lambda r: -r["id"]):
                if row["status"] != "applied":
                    skipped += 1
                    continue
                if mode == "data" and any(r["id"] > row["id"] and r["status"] == "applied" and r["op"].get("key") == row["op"].get("key") for r in m["ops"]):
                    skipped += 1
                    continue
                row["status"], row["undone_at"], row["ended_by"] = "undone", now, by
                undone += 1
            if undone:
                new_state = self._replay(m)
                try:
                    if self.hook:
                        self.hook(mode, new_state)
                except LiveError:
                    for row in m["ops"]:                                           # the film could not be rebuilt without them: nothing was taken back
                        if row["id"] in op_ids and row["undone_at"] == now and row["status"] == "undone":
                            row["status"], row["undone_at"], row["ended_by"] = "applied", None, None
                    raise
                m["state"] = new_state
                m["revision"] += 1
                self._save()
            return {"undone": undone, "skipped": skipped, "revision": m["revision"], "state": self._shown(mode, m["state"])}

    def undo_all_ai(self, mode):
        with self.lock:
            m = self._mode(mode)
            return self.undo(mode, [r["id"] for r in m["ops"] if r["actor"] == "ai" and r["status"] == "applied"], "person")

    def undo_last_ai_batch(self, mode):
        """The AI taking back its own newest batch (never the person's changes)."""
        with self.lock:
            m = self._mode(mode)
            mine = [r for r in m["ops"] if r["actor"] == "ai" and r["status"] == "applied"]
            last = max((r["revision"] for r in mine), default=-1)
            return self.undo(mode, [r["id"] for r in mine if r["revision"] == last], "ai")

    def _replay(self, m):
        s = m["base"]
        for r in m["ops"]:
            if r["status"] == "applied" and check(s, r["op"], self.look_keys) is None:
                s = apply(s, r["op"])
        return json.loads(json.dumps(s))

    def ops_since(self, mode, revision):
        with self.lock:
            m = self._mode(mode)
            rows = [{"id": r["id"], "revision": r["revision"], "actor": r["actor"], "client": r["client"], "op": r["op"], "status": r["status"], "at": _iso(r["at"])}
                    for r in m["ops"] if r["revision"] > revision][:200]
            return {"revision": m["revision"], "state": self._shown(mode, m["state"]), "mirrored": True, "ai_visible": bool(m["ai_visible"]), "ops": rows}

    def heartbeat(self, mode):
        with self.lock:
            self._mode(mode)["editor_seen_at"] = self.clock()

    def editor_open(self, mode="compilation", within=30) -> bool:
        with self.lock:
            t = self._mode(mode)["editor_seen_at"]
            return t is not None and self.clock() - t < within


# --------------------------------------------------------------------------------------------------------- 4. the maker's side: routes (off unless the maker is started with --live)
# Routes, all behind the maker's token, 127.0.0.1 only (the same rules as tools/maker_edit.py):
#   GET  /live, /live.js, /live.css      WEB's standalone page (tools/maker-live/, pinned), served with its own content policy
#   POST /api/live/rpc {name, args}      the five editor_* functions on this computer's draft -> {data, error}
#   GET  /api/live/sync                  {signed_in, mirror, ai_visible, project, message}: what the small card shows
#   POST /api/live/sync {mirror, ai_visible, project}   the person's two switches and the site project this film belongs to
# The film itself is still the edit list (edit.json): every accepted change is turned into it by the engine's own tracks module (ryagram.local.edittracks) BEFORE it is kept, so a change the
# engine could not build (a clip from a video the person did not choose, a trim past the end of a file) is refused in plain words and nothing moves.
HERE = Path(__file__).resolve().parent
PAGE_DIR = HERE / "maker-live"
ASSETS = {"/live": ("live.html", "text/html; charset=utf-8"), "/live.js": ("live.js", "text/javascript; charset=utf-8"), "/live.css": ("live.css", "text/css; charset=utf-8")}
LIVE_CSP = ("default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'")
RPC_NAMES = ("editor_apply_ops", "editor_undo", "editor_undo_all_ai", "my_edit_ops_since", "editor_heartbeat")
UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.IGNORECASE)
NO_TRACKS = "The track editor is not in this build of the app yet."
_dm = None
_ME = None                    # tools/maker_edit.py once loaded


class Problem(Exception):
    """A sentence for the page (the maker answers 400 {error})."""


def attach(dm) -> None:
    global _dm
    _dm = dm
    dm.STATE.setdefault("live", {"draft": None, "sync": None, "project": None, "mirror": False, "ai_visible": False})


def on() -> bool:
    return bool(_dm and _dm.STATE.get("live_on"))


def S() -> dict:
    return _dm.STATE["live"]


def _edit():
    global _ME
    if _ME is None:
        if str(HERE) not in sys.path:
            sys.path.insert(0, str(HERE))
        import maker_edit  # noqa: PLC0415
        _ME = maker_edit
    return _ME


def _tracks():
    try:
        from ryagram.local import edittracks  # noqa: PLC0415
    except ImportError:
        raise LiveError("PT404", NO_TRACKS) from None
    return edittracks


def _media_seconds() -> dict:
    """{file name: seconds} of the videos the person chose (names only); the engine reads each file's header once."""
    me, et = _edit(), _tracks()
    eb = me._eb()
    items = me._media_items()
    try:
        secs, _unreadable = et.media_seconds(eb.resolve_media(items))
    except Exception as e:  # noqa: BLE001
        raise LiveError("22023", str(e)[:200] or "A video could not be read.") from None
    return secs


def _convert(state: dict) -> dict:
    """The tracks state -> the engine's edit list, or a LiveError with the engine's own sentence. Nothing is written here."""
    me, et = _edit(), _tracks()
    try:
        base = me.load()["edit"]
        return et.edit_from_tracks(state, base, _media_seconds())
    except LiveError:
        raise
    except Exception as e:  # noqa: BLE001  (TrackError, EditError, Problem: all carry a plain sentence)
        raise LiveError("22023", (str(e) or "The engine could not build that.")[:300]) from None


def _hook(mode: str, state: dict) -> None:
    """Called by the draft before a change is kept: the film must still be buildable, and edit.json is then rewritten from it."""
    if mode != "compilation":
        return
    new_edit = _convert(state)
    try:
        _edit().save({"edit": new_edit})
    except Exception as e:  # noqa: BLE001
        raise LiveError("22023", (str(e) or "The edit list could not be saved.")[:300]) from None


def draft() -> "LiveDraft":
    """The draft of the film on this computer, made on first use from the edit list (Plan's rough cut or the saved one)."""
    s = S()
    if s["draft"] is None:
        me, et = _edit(), _tracks()
        f = _dm.STATE["work"] / "live" / "live-draft.json"
        f.parent.mkdir(parents=True, exist_ok=True)
        d = LiveDraft(f, hook=_hook)
        try:
            lst = me.load()["edit"]
        except Exception as e:  # noqa: BLE001
            raise LiveError("PT404", (str(e) or "Press Plan first.")[:300]) from None
        d.set_base("compilation", et.tracks_from_edit(lst, _media_seconds()))
        d.set_ai_visible(bool(s["ai_visible"]))
        s["draft"] = d
    return s["draft"]


def sync():
    s = S()
    if s["sync"] is None and _dm.STATE.get("signin") is not None:
        if str(HERE) not in sys.path:
            sys.path.insert(0, str(HERE))
        import maker_live_sync  # noqa: PLC0415
        s["sync"] = maker_live_sync.LiveSync(_dm.STATE["signin"], draft())
        s["sync"].attach(s["project"])
        s["sync"].set_switches(s["mirror"], s["ai_visible"])
        threading.Thread(target=s["sync"].run_forever, daemon=True).start()
    return s["sync"]


def sync_status() -> dict:
    s = S()
    sy = s["sync"]
    return {"signed_in": _dm.STATE.get("signin") is not None, "mirror": s["mirror"], "ai_visible": s["ai_visible"], "project": s["project"], "message": (sy.status()["message"] if sy else "")}


def set_sync(body: dict) -> dict:
    s = S()
    project = body.get("project", s["project"])
    if project is not None and not (isinstance(project, str) and UUID.match(project)):
        raise Problem("That film is not one of your Ryagram projects.")
    for k in ("mirror", "ai_visible"):
        if k in body and not isinstance(body[k], bool):
            raise Problem("Switch each one on or off.")
    want_mirror = bool(body.get("mirror", s["mirror"]))
    want_ai = bool(want_mirror and body.get("ai_visible", s["ai_visible"]))
    if _dm.STATE.get("signin") is None and want_mirror:
        raise Problem("Sign this computer in to Ryagram first (the Sign in card), then switch this on.")
    s["project"], s["mirror"], s["ai_visible"] = project, want_mirror, want_ai
    try:
        sy = sync() if (want_mirror or s["sync"] is not None) else None
    except LiveError as e:
        raise Problem(e.message) from None
    if sy:
        sy.attach(project)
        sy.set_switches(want_mirror, want_ai)
    elif s["draft"] is not None:
        s["draft"].set_ai_visible(want_ai)
    return sync_status()


def get(path: str, query: str, send, send_json, auth, host_ok, send_file=None) -> bool:
    if not (path in ASSETS or path.startswith("/api/live")):
        return False
    if not on():
        send_json(404, {"error": "Not found."})
        return True
    if path in ASSETS:
        if path == "/live" and not auth(query_ok=True):
            return True
        if path != "/live" and not host_ok():
            send_json(403, {"error": "no"})
            return True
        name, ctype = ASSETS[path]
        send(200, (PAGE_DIR / name).read_bytes(), ctype, LIVE_CSP)
        return True
    if not auth():
        return True
    if path == "/api/live/sync":
        send_json(200, sync_status())
    else:
        send_json(404, {"error": "Not found."})
    return True


def _rpc_error(code: str, message: str) -> dict:
    return {"data": None, "error": {"code": code, "message": message}}


def post(path: str, body: dict, send_json) -> bool:
    if not path.startswith("/api/live"):
        return False
    if not on():
        send_json(404, {"error": "Not found."})
        return True
    try:
        if path == "/api/live/rpc":
            name, args = body.get("name"), body.get("args")
            if name not in RPC_NAMES or not isinstance(args, dict):
                send_json(200, _rpc_error("22023", "That call is not one the editor makes."))
            elif args.get("p_mode") not in ("compilation", "data"):
                send_json(200, _rpc_error("22023", "That is not an editor mode."))
            elif args.get("p_mode") == "data":
                send_json(200, _rpc_error("PT404", "Data films cannot be edited on this computer yet."))
            else:
                try:
                    d = draft()
                except LiveError as e:
                    send_json(200, _rpc_error(e.code, e.message))
                    return True
                send_json(200, d.rpc(name, args))
        elif path == "/api/live/sync":
            send_json(200, set_sync(body))
        else:
            send_json(404, {"error": "Not found."})
    except Problem as e:
        send_json(400, {"error": str(e)})
    return True
