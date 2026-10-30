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
import subprocess
import sys
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import parse_qs

SCHEMA = "ryagram.live-draft/0"
MIN_LEN = 0.3
MAX_TEXT = 200
TRACKS = ("video", "pictures", "text", "music")
OPS_PER_CALL, OPS_PER_MINUTE, OPS_PER_DAY, UNDONE_WINDOW_S = 20, 60, 600, 600
COLOUR = re.compile(r"^#[0-9a-fA-F]{6}$")
ID = re.compile(r"^[A-Za-z0-9_-]{1,40}$")
STYLES = ("title", "caption", "lower_third")
FILM_LOOK = ("theme", "text_color", "box_color", "box_opacity", "letterbox")
RULE_MODES = ("full", "centre", "corner", "lower_third")
MAX_RULES = 50
RULE_PICTURE = re.compile(r"^[A-Za-z0-9_.-]{1,100}$")
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
                  "delete_clip": ["op", "id"], "add_clip": ["op", "track", "start", "len", "text", "picture"], "set_clip_style": ["op", "id", "style"],
                  "set_music": ["op", "level_db", "fade_in_s", "fade_out_s", "source_start", "snap"], "set_rule": ["op", "id", "phrase", "picture", "seconds", "mode", "fade_s"],
                  "delete_rule": ["op", "id"], "set_film_look": ["op", "key", "value"]}
    if kind not in allowed_by:
        return f'"{kind[:40]}" is not a change this editor knows for a compilation.'
    if not known(allowed_by[kind]):
        return "That change has a field the editor does not know."
    if kind in ("move_clip", "trim_clip", "reorder_clip", "set_clip_text", "delete_clip", "set_clip_style") and not (isinstance(op.get("id"), str) and ID.match(op["id"])):
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
    elif kind == "set_clip_style":
        if not (isinstance(op.get("style"), str) and op["style"] in STYLES):
            return "A text style must be title, caption or lower_third."
    elif kind == "set_music":
        if len(op) < 2:
            return "set_music needs at least one setting."
        for name, lo, hi, msg in (("level_db", -30, 6, '"level_db" must be a number from -30 to 6.'), ("fade_in_s", 0, 5, '"fade_in_s" must be a number from 0 to 5 seconds.'),
                                  ("fade_out_s", 0, 5, '"fade_out_s" must be a number from 0 to 5 seconds.'), ("source_start", 0, 86400, '"source_start" must be a number from 0 to 86400 seconds.')):
            if name in op and not (_is_num(op[name]) and lo <= op[name] <= hi):
                return msg
        if "snap" in op and not isinstance(op["snap"], bool):
            return '"snap" must be true or false.'
    elif kind == "set_rule":
        if "id" in op and not (isinstance(op["id"], str) and ID.match(op["id"])):
            return 'A rule "id" is letters, digits, - and _ (leave it out to add a new rule).'
        if not text_ok(op.get("phrase"), 60):
            return "The phrase must be 1 to 60 characters of plain words (no places on a computer, no web addresses, no markup)."
        if not (isinstance(op.get("picture"), str) and RULE_PICTURE.match(op["picture"])):
            return 'A rule needs the "picture" id from the editor state.'
        if not (_is_num(op.get("seconds")) and 0.5 <= op["seconds"] <= 10):
            return '"seconds" must be a number from 0.5 to 10.'
        if not (isinstance(op.get("mode"), str) and op["mode"] in RULE_MODES):
            return "A rule mode must be full, centre, corner or lower_third."
        if "fade_s" in op and not (_is_num(op["fade_s"]) and 0 <= op["fade_s"] <= 1):
            return '"fade_s" must be a number from 0 to 1 second.'
    elif kind == "delete_rule":
        if not (isinstance(op.get("id"), str) and ID.match(op["id"])):
            return 'This change needs a rule "id" from get_edit_state.'
    elif kind == "set_film_look":
        if not (isinstance(op.get("key"), str) and op["key"] in FILM_LOOK):
            return "That is not a film look setting (theme, text_color, box_color, box_opacity, letterbox)."
        if "value" not in op:
            return 'A film look change needs a "value".'
        v = op["value"]
        if op["key"] == "theme" and v not in ("dark", "light"):
            return '"theme" can only be: dark, light.'
        if op["key"] in ("text_color", "box_color", "letterbox") and not (isinstance(v, str) and COLOUR.match(v)):
            return f'"{op["key"]}" needs a colour like #1a73e8.'
        if op["key"] == "box_opacity" and not (_is_num(v) and 0 <= v <= 1):
            return '"box_opacity" must be a number from 0 to 1.'
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
    if isinstance(init.get("text_rules"), dict):                    # the film's text layout rules (BUILDER: textstyle.rules): the page draws texts with them; they stay on this computer and never go in the summary
        s["text_rules"] = json.loads(json.dumps(init["text_rules"]))
    s["rules"] = json.loads(json.dumps(init.get("rules") or []))
    s["pictures"] = json.loads(json.dumps(init.get("pictures") or []))
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


def _page_values(op):
    """The value sentences of the page's own core (app-editor-core.js check) for the five newer ops: WEB's words, which differ from the vocabulary's (op_problem) where the page speaks to a person at the keyboard."""
    kind = op["op"]
    def unknown(allowed):
        return "That change has a field the editor does not know." if any(k not in allowed for k in op) else None
    def num(name, lo, hi, msg):
        return msg if name in op and not (_is_num(op[name]) and lo <= op[name] <= hi) else None
    if kind == "set_clip_style":
        return None if op.get("style") in STYLES else "A text style must be title, caption or lower_third."
    if kind == "set_music":
        fields = ("level_db", "fade_in_s", "fade_out_s", "source_start", "snap")
        if unknown(("op",) + fields):
            return unknown(("op",) + fields)
        if not any(k in op for k in fields):
            return "set_music needs at least one setting."
        if "snap" in op and not isinstance(op["snap"], bool):
            return "Snap to the beat is on or off."
        return (num("level_db", -30, 6, "The level must be a number from -30 to 6.") or num("fade_in_s", 0, 5, "The fade in must be a number from 0 to 5 seconds.")
                or num("fade_out_s", 0, 5, "The fade out must be a number from 0 to 5 seconds.") or num("source_start", 0, 86400, "Where the music starts must be a number from 0 to 86400 seconds."))
    if kind == "set_rule":
        if unknown(("op", "id", "phrase", "picture", "seconds", "mode", "fade_s")):
            return unknown(("op", "id", "phrase", "picture", "seconds", "mode", "fade_s"))
        if not text_ok(op.get("phrase"), 60):
            return "The phrase must be 1 to 60 characters of plain words (no places on a computer, no web addresses, no markup)."
        if not _is_num(op.get("seconds")) or not 0.5 <= op["seconds"] <= 10:
            return "The picture stays from 0.5 to 10 seconds."
        if op.get("mode") not in RULE_MODES:
            return "A rule mode must be full, centre, corner or lower_third."
        return num("fade_s", 0, 1, "The fade must be a number from 0 to 1 second.")
    if kind == "set_film_look":
        key, v = op.get("key"), op.get("value")
        if key not in FILM_LOOK:
            return "That is not a film look setting (theme, text_color, box_color, box_opacity, letterbox)."
        if "value" not in op:
            return "A film look change needs a value."
        if key == "theme" and v not in ("dark", "light"):
            return "The theme can only be: dark, light."
        if key in ("text_color", "box_color", "letterbox") and not (isinstance(v, str) and COLOUR.match(v)):
            return "That needs a colour like #1a73e8."
        if key == "box_opacity" and not (_is_num(v) and 0 <= v <= 1):
            return "The box opacity must be a number from 0 to 1."
    return None


def check(state: dict, op, look_keys=None):
    """None when the op may be applied to this state, else the sentence the page shows (app-editor-core.js check(), sentence for sentence)."""
    keys = look_keys or LOOK_KEYS
    ops = ("set_look", "unset_look", "move_clip", "trim_clip", "reorder_clip", "set_clip_text", "delete_clip", "add_clip", "set_clip_style", "set_music", "set_rule", "delete_rule", "set_film_look")
    if not isinstance(op, dict) or op.get("op") not in ops:
        return "That change is not one the editor can make."
    bad = _page_values(op)
    if bad:
        return bad
    if op["op"] == "set_film_look":
        return None
    if op["op"] == "set_rule":
        if op.get("id") is not None and not any(r.get("id") == op["id"] for r in state.get("rules") or []):
            return "That rule is not in this film."
        if op.get("id") is None and len(state.get("rules") or []) >= MAX_RULES:
            return f"A film can have at most {MAX_RULES} rules."
        if not any(p.get("id") == op.get("picture") for p in state.get("pictures") or []):
            return "That picture is not one of yours."
        return None
    if op["op"] == "delete_rule":
        return None if any(r.get("id") == op.get("id") for r in state.get("rules") or []) else "That rule is not in this film."
    if op["op"] == "set_music":
        m = _clip(state, "music")
        if m is None or m.get("track") != "music":
            return "There is no music on this film."
        if state.get("lanes") is not None and "music" not in state["lanes"]:
            return "That part of the film can not be edited here yet."
        return None
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
    elif op["op"] == "set_clip_style":
        if c["track"] != "text" and not (c["track"] == "video" and c.get("slide") is True and not c.get("picture")):
            return "Only a text clip has a style."
    elif op["op"] == "set_clip_text":
        if c["track"] != "text" and not (c["track"] == "video" and c.get("slide") is True and not c.get("picture")):         # a text line, or a text SLIDE (a video-lane slide with words and no picture)
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
    elif op["op"] == "set_film_look":
        nxt.setdefault("look", {})[op["key"]] = op["value"]
    elif op["op"] == "set_music":
        m = _clip(nxt, "music")
        for k in ("level_db", "fade_in_s", "fade_out_s", "source_start", "snap"):
            if k in op:
                m[k] = op[k]
    elif op["op"] == "delete_rule":
        nxt["rules"] = [r for r in nxt.get("rules") or [] if r.get("id") != op["id"]]
    elif op["op"] == "set_rule":
        rule = {k: op[k] for k in ("phrase", "picture", "seconds", "mode", "fade_s") if k in op}
        rules = nxt.setdefault("rules", [])
        if op.get("id") is None:
            rules.append({"id": f'rule{state["revision"] + 1}', **rule})
        else:
            rules[:] = [{"id": op["id"], **rule} if r.get("id") == op["id"] else r for r in rules]
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
        elif op["op"] == "set_clip_style":
            c["style"] = op["style"]
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
            keep = ("id", "track", "start", "len", "label", "text", "picture", "file", "source", "source_start", "min_len", "max_len", "position", "size", "ai_altered", "ai_altered_by", "ai_altered_derived", "slide", "mode", "fade_s", "style", "level_db", "fade_in_s", "fade_out_s", "snap")
            out = {"schema": "ryagram.edit-tracks/0", "duration": s.get("duration", 0), "clips": [{k: c[k] for k in keep if k in c} for c in s["clips"]]}
            if "lanes" in s:
                out["lanes"] = list(s["lanes"])
            out["rules"] = [{k: r[k] for k in ("id", "phrase", "picture", "seconds", "mode", "fade_s") if k in r} for r in s.get("rules") or []]
            out["pictures"] = [{"id": p["id"], "name": p["name"]} for p in s.get("pictures") or [] if "id" in p and "name" in p]   # NAMES only, never a place on this computer
            out["look"] = {k: v for k, v in (s.get("look") or {}).items() if k in FILM_LOOK}
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
#   GET  /api/live/text-rules            {rules}: state.text_rules again (null when the engine gives none)
#   GET  /api/live/frame?clip=<id>&t=<s> one small JPEG of what a clip shows at that moment (the page's preview); names only
#   POST /api/live/render {}             builds the film from the edit list (the Edit page's own render: one at a time) -> {message, film} | {error}; answers when the film is made
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
_MAKE = threading.RLock()     # the page's first calls arrive together (the poll and the heartbeat): the draft and the sync are made ONCE


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
    with _MAKE:
        return _draft_locked()


def _draft_locked() -> "LiveDraft":
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


def plan_changed() -> None:
    """Plan was pressed again and maker_edit dropped the old list: the draft starts again from the new rough cut (the revision keeps climbing, so an open page sees it)."""
    with _MAKE:
        s = S()
        if s["draft"] is None:
            try:
                (_dm.STATE["work"] / "live" / "live-draft.json").unlink(missing_ok=True)      # a draft file from the old plan must not be picked up
            except OSError:
                pass
            return
        lst = _edit().load()["edit"]
        s["draft"].set_base("compilation", _tracks().tracks_from_edit(lst, _media_seconds()))


def sync():
    with _MAKE:
        return _sync_locked()


def _sync_locked():
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
    elif path == "/api/live/text-rules":                                 # the same dict as state.text_rules (the page uses the state; this is its harmless fallback)
        try:
            send_json(200, {"rules": draft().state("compilation").get("text_rules")})
        except LiveError:
            send_json(200, {"rules": None})
    elif path == "/api/live/frame":
        try:
            send(200, frame(query), "image/jpeg", LIVE_CSP)
        except Problem as e:
            send_json(404, {"error": str(e)})
        except (OSError, subprocess.SubprocessError):
            send_json(404, {"error": "The picture for that moment could not be made."})
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
                try:
                    send_json(200, d.rpc(name, args))
                except Exception:  # noqa: BLE001  (a file that could not be written, a full disk: the page is told in words, never a dropped connection)
                    send_json(200, _rpc_error("22023", "The Ryagram app could not do that just now. Try again."))
        elif path == "/api/live/sync":
            send_json(200, set_sync(body))
        elif path == "/api/live/render":
            try:
                draft()                                                       # the film as the draft has it is what is built: the edit list on disk is rewritten at every accepted change
            except LiveError as e:
                raise Problem(e.message) from None
            me = _edit()
            try:
                send_json(200, me.render({"edit": me.load()["edit"]}))        # the same build the Edit page starts: one at a time, the engine's own checks, nothing is uploaded
            except me.Problem as e:
                send_json(400, {"error": str(e)})
        else:
            send_json(404, {"error": "Not found."})
    except Problem as e:
        send_json(400, {"error": str(e)})
    return True


# --------------------------------------------------------------------------------------------------------- 5. the film's frame for the preview (GET /api/live/frame)
# The live page's preview draws, from the host, the picture a clip shows at a moment: GET /api/live/frame?clip=<clip id>&t=<seconds into the clip> -> one small JPEG (640 wide at most). The clip is named
# by the id the draft lists; the video file comes from the maker's own list of chosen media (never from the address); no path is in the request or the answer. A clip with no picture (a text line, a
# text slide) answers 404 in words.
FRAME_WIDTH = 640
FRAME_MAX_BYTES = 400_000
_FRAME_GATE = threading.Semaphore(2)
_FRAME_CACHE: dict = {}
_FRAME_CACHE_MAX = 64


def _ffmpeg_jpeg(args_in: list, ss: float | None) -> bytes:
    cmd = ["ffmpeg", "-hide_banner", "-loglevel", "error"] + (["-ss", f"{ss:.3f}"] if ss is not None else []) + args_in + \
          ["-frames:v", "1", "-vf", f"scale={FRAME_WIDTH}:-2", "-q:v", "5", "-f", "mjpeg", "-"]
    with _FRAME_GATE:
        r = subprocess.run(cmd, capture_output=True, timeout=20)
    if r.returncode != 0 or not r.stdout or len(r.stdout) > FRAME_MAX_BYTES:
        raise Problem("The picture for that moment could not be made.")
    return r.stdout


def frame(query: str) -> bytes:
    q = parse_qs(query)
    cid = (q.get("clip") or [""])[0]
    try:
        t = float((q.get("t") or ["0"])[0])
    except ValueError:
        raise Problem("The moment must be a number of seconds.") from None
    if not ID.match(cid) or not math.isfinite(t) or t < 0 or t > 86400:
        raise Problem("That is not a clip and a moment this film has.")
    try:
        state = draft().state("compilation")
    except LiveError as e:
        raise Problem(e.message) from None
    clip = next((c for c in state["clips"] if c.get("id") == cid), None)
    if clip is None:
        raise Problem("That clip is not in this film.")
    me = _edit()
    if clip.get("track") == "video" and isinstance(clip.get("source"), str) and _is_num(clip.get("source_start")):
        try:
            media = me._eb().resolve_media(me._media_items())
        except Exception:  # noqa: BLE001
            raise Problem("The videos could not be read.") from None
        path = media.get(clip["source"])
        if path is None:
            raise Problem("That video is not one you chose.")
        at = clip["source_start"] + min(t, max(0.0, clip["len"] - 0.05))
        key = (str(path), round(at, 1))
        if key not in _FRAME_CACHE:
            if len(_FRAME_CACHE) >= _FRAME_CACHE_MAX:
                _FRAME_CACHE.pop(next(iter(_FRAME_CACHE)))
            _FRAME_CACHE[key] = _ffmpeg_jpeg(["-i", str(path)], at)
        return _FRAME_CACHE[key]
    pic = clip.get("picture")
    if isinstance(pic, str) and me.S()["images"].get(pic) is not None and me.S()["images"][pic].is_file():
        return _ffmpeg_jpeg(["-i", str(me.S()["images"][pic])], None)
    raise Problem("That clip has no picture of its own.")
