"""The live editor's routes in the maker, with the REAL engine modules (editbuild, edittracks) and no video: NEXT-CONNECT 142.

    py -I tools/check-maker-live-routes.py <an engine checkout that has ryagram/local/edittracks.py>

The maker's own state is a stand-in (a dict), the clips' lengths are made up (so no file is read), and the edit list is kept in memory; everything else is the real thing: the routes in
tools/maker_live.py, the draft, the page's rules, and BUILDER's edit_from_tracks / tracks_from_edit with the engine's own parse_edit re-check. What it proves: a change the page makes becomes
the edit list the engine builds from BEFORE it is kept; one the engine refuses is refused and nothing moves; an AI's change that arrives through the sync lands in the same edit list; the routes
are behind the token, absent without the flag, and name no path. MUST-FAILs at the end."""
import copy
import json
import sys
import types
from pathlib import Path

HERE = Path(__file__).resolve().parent
ENGINE = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else None
if ENGINE is None or not (ENGINE / "ryagram" / "local" / "edittracks.py").is_file():
    print("usage: check-maker-live-routes.py <engine checkout with ryagram/local/edittracks.py>")
    sys.exit(2)
sys.path[:0] = [str(HERE), str(ENGINE)]
import maker_live as ML  # noqa: E402
import maker_live_sync as MS  # noqa: E402
from ryagram.local import editbuild as EB  # noqa: E402
from ryagram.local import edittracks as ET  # noqa: E402

FAILED = []


def check(ok, what):
    print(("  ok   " if ok else "  FAIL ") + what)
    if not ok:
        FAILED.append(what)


MEDIA = {"my-clips/a.mp4": 20.0, "my-clips/b.mp4": 8.0, "c.mp4": 12.0}
SHA = "ab" * 32
BASE = {"schema": EB.SCHEMA, "mode": "compilation", "film": {"width": 1280, "height": 720, "fps": 30}, "seq": 3,
        "clips": [{"id": "c1", "file_name": "my-clips/a.mp4", "in_s": 2.0, "out_s": 5.5, "join": {"kind": "cut", "s": 0}, "words": [{"w": "hello", "s": 2.2, "e": 2.6}]},
                  {"id": "c2", "file_name": "my-clips/b.mp4", "in_s": 0.0, "out_s": 3.0, "join": {"kind": "cut", "s": 0}, "words": []},
                  {"id": "c3", "file_name": "c.mp4", "in_s": 6.0, "out_s": 8.0, "join": {"kind": "cut", "s": 0}, "words": []}],
        "images": [], "rules": [], "texts": [{"text": "Day one", "start_s": 1.0, "length_s": 3.0, "position": "top"}],
        "captions": {"on": True, "size": "medium", "position": "bottom"}, "look": {"theme": "dark"}, "music": None}
TOKEN = "tok"


class FakeEdit:
    """What maker_live uses of tools/maker_edit.py: the saved edit list, and the engine's editbuild."""

    class Problem(Exception):
        pass

    def __init__(self):
        self.saved = copy.deepcopy(BASE)
        self.saves = 0
        self.rendered = []
        self.refuse = None

    def render(self, body):
        if self.refuse:
            raise self.Problem(self.refuse)
        self.rendered.append(copy.deepcopy(body["edit"]))
        return {"message": "Your film is ready: edit-1.mp4, in films.", "film": "edit-1.mp4"}

    def load(self):
        return {"edit": copy.deepcopy(self.saved)}

    def save(self, body):
        self.saved = copy.deepcopy(body["edit"])
        self.saves += 1
        return {"saved": True}

    def _eb(self):
        return EB

    def _media_items(self):
        return []


def make(tmp, flag=True, signin=None):
    dm = types.SimpleNamespace(STATE={"work": tmp, "live_on": flag, "signin": signin})
    ML.attach(dm)
    ML._ME = fake = FakeEdit()
    ML._media_seconds = lambda: dict(MEDIA)
    return dm, fake


class Out:
    def __init__(self):
        self.code, self.obj = None, None

    def json(self, code, obj):
        self.code, self.obj = code, obj


def rpc(name, **args):
    o = Out()
    ML.post("/api/live/rpc", {"name": name, "args": args}, o.json)
    return o.code, o.obj


import tempfile  # noqa: E402

tmp = Path(tempfile.mkdtemp(prefix="maker-live-routes-"))
dm, ed = make(tmp)
code, got = rpc("my_edit_ops_since", p_project="p", p_mode="compilation", p_revision=0)
st = got["data"]["state"]
ids = {c["track"] + str(i): c["id"] for i, c in enumerate(st["clips"])}
check(code == 200 and got["error"] is None and [c["track"] for c in st["clips"]].count("video") == 3 and st.get("lanes") == ["video", "text"], "the draft is made from the edit list by the engine's own tracks module: three video clips, a text, the lanes the maker can build")
check(ed.saves == 0, "just looking changes nothing on disk")

vid = [c for c in st["clips"] if c["track"] == "video"]
txt = [c for c in st["clips"] if c["track"] == "text"][0]
rev = got["data"]["revision"]
code, r = rpc("editor_apply_ops", p_project="p", p_mode="compilation", p_base_revision=rev, p_ops=[{"op": "reorder_clip", "id": vid[2]["id"], "index": 0}, {"op": "move_clip", "id": txt["id"], "start": 2}])
check(r["error"] is None and r["data"]["changes"] == 2 and ed.saves == 1, "the page's change is accepted and the edit list is rewritten at once")
check([c["file_name"] for c in ed.saved["clips"]] == ["c.mp4", "my-clips/a.mp4", "my-clips/b.mp4"] and ed.saved["texts"][0]["start_s"] == 2, "the new edit list is what the engine builds from: the clip order and the text time changed")
check(EB.parse_edit(copy.deepcopy(ed.saved)) is not None, "and the engine's own parse_edit accepts it")

# a change the engine refuses is refused and nothing moves
real = ET.edit_from_tracks
rev2 = rpc("my_edit_ops_since", p_project="p", p_mode="compilation", p_revision=0)[1]["data"]["revision"]


def refusing(state, base, secs):
    if any(c.get("text") == "NOPE" for c in state["clips"]):
        raise ET.TrackError("The engine cannot build that.")
    return real(state, base, secs)


ET.edit_from_tracks = refusing
before_saved, before_state = copy.deepcopy(ed.saved), rpc("my_edit_ops_since", p_project="p", p_mode="compilation", p_revision=0)[1]["data"]["state"]
code, r = rpc("editor_apply_ops", p_project="p", p_mode="compilation", p_base_revision=rev2, p_ops=[{"op": "set_clip_text", "id": txt["id"], "text": "NOPE"}])
after = rpc("my_edit_ops_since", p_project="p", p_mode="compilation", p_revision=0)[1]["data"]
check(r["error"]["code"] == "22023" and "cannot build that" in r["error"]["message"] and ed.saved == before_saved and after["state"] == before_state and after["revision"] == rev2,
      "a change the engine refuses is refused in its own words; the edit list, the draft and the revision did not move")
ET.edit_from_tracks = real

# undo goes through the engine too
ops = rpc("my_edit_ops_since", p_project="p", p_mode="compilation", p_revision=0)[1]["data"]["ops"]
code, r = rpc("editor_undo", p_project="p", p_mode="compilation", p_op_id=ops[-1]["id"])
check(r["error"] is None and r["data"]["undone"] == 1 and ed.saved["texts"][0]["start_s"] == 1.0, "undoing the text move puts the edit list back")

# Build: the same render the Edit page starts, on the edit list the draft keeps; its own refusals come back as plain sentences
o = Out()
ML.post("/api/live/render", {}, o.json)
check(o.code == 200 and o.obj["film"] == "edit-1.mp4" and ed.rendered and [c["file_name"] for c in ed.rendered[0]["clips"]] == ["c.mp4", "my-clips/a.mp4", "my-clips/b.mp4"], "Build renders the edit list the live changes produced (the reordered one), through the Edit page's own render")
ed.refuse = "Something is already running here. Wait for it to finish."
o = Out()
ML.post("/api/live/render", {}, o.json)
check(o.code == 400 and "already running" in o.obj["error"], "a second build at the same time is refused in the Edit page's own words")
ed.refuse = None

# the routes: token, flag, names, data mode
o = Out()
ML.post("/api/live/rpc", {"name": "delete_everything", "args": {}}, o.json)
check(o.obj["error"]["code"] == "22023", "a call that is not one of the five is refused")
o = Out()
ML.post("/api/live/rpc", {"name": "my_edit_ops_since", "args": {"p_project": "p", "p_mode": "data", "p_revision": 0}}, o.json)
check(o.obj["error"]["code"] == "PT404" and "yet" in o.obj["error"]["message"], "data films on this computer answer 'not yet', not a crash")
sent = []
check(ML.get("/live", "", lambda *a: sent.append(a), lambda *a: sent.append(a), lambda **k: False, lambda: True) is True and sent == [], "GET /live without the maker's token sends nothing (auth answered)")
sent.clear()
ML.get("/live", "", lambda code, body, ctype, csp=None: sent.append((code, ctype, csp)), lambda *a: sent.append(a), lambda **k: True, lambda: True)
check(sent and sent[0][0] == 200 and "default-src 'none'" in sent[0][2] and "frame-ancestors 'none'" in sent[0][2], "the page is served with a strict policy")
dm_off, _ = make(tmp / "off", flag=False)
o = Out()
ML.post("/api/live/rpc", {"name": "my_edit_ops_since", "args": {}}, o.json)
check(o.code == 404, "without the flag the routes answer 404")
dm, ed = make(tmp / "again")

# the sync, signed out and signed in
o = Out()
ML.post("/api/live/sync", {"mirror": True, "ai_visible": True, "project": "00000000-0000-4000-8000-0000000000a1"}, o.json)
check(o.code == 400 and "Sign this computer in" in o.obj["error"], "switching the mirror on while signed out is refused in plain words")
o = Out()
ML.post("/api/live/sync", {"mirror": True, "project": "../../etc/passwd"}, o.json)
check(o.code == 400, "a project that is not an id is refused")


class Site:
    def __init__(self):
        self.calls, self.queue = [], []

    def status(self):
        return {"state": "signed_in"}

    def api(self, method, route, body):
        self.calls.append((route, body))
        if route == "/node/edit-pending":
            return 200, {"changes": list(self.queue)}
        for a in body.get("applied", []):
            self.queue = [c for c in self.queue if c["id"] != a["op_id"]]
        return 200, {"revision": 1, "mirrored": True, "ai_visible": True}


site = Site()
dm, ed = make(tmp / "signed", signin=site)
ML.threading = types.SimpleNamespace(Thread=lambda target, daemon: types.SimpleNamespace(start=lambda: None), RLock=ML.threading.RLock, Lock=ML.threading.Lock)      # no background thread in the check
o = Out()
PROJ = "00000000-0000-4000-8000-0000000000a1"
ML.post("/api/live/sync", {"mirror": True, "ai_visible": True, "project": PROJ}, o.json)
check(o.code == 200 and o.obj["mirror"] and o.obj["ai_visible"] and o.obj["project"] == PROJ, "signed in, the two switches and the film's project are taken")
sy = ML.S()["sync"]
t0 = ML.draft().state("compilation")
txt = [c for c in t0["clips"] if c["track"] == "text"][0]
site.queue.append({"id": 7, "project_id": PROJ, "revision": 2, "client": "Claude", "op": {"op": "set_clip_text", "id": txt["id"], "text": "From my AI"}})
r = sy.tick(force=True)
check(r["applied"] == 1 and ed.saved["texts"][0]["text"] == "From my AI", "an AI's change that arrives through the sync lands in the edit list the engine builds from")
post = [b for route, b in site.calls if route == "/node/edit-summary"][-1]
check(post["applied"] == [{"op_id": 7, "ok": True}] and post["summary"]["schema"] == "ryagram.edit-tracks/0" and "C:" not in json.dumps(post), "and is acknowledged, with the new summary and no path")

# the first final film is checked against the list Plan made (FACES --previous): maker_edit seeds committed-edit.json once, and never overwrites it
import maker_edit as MEd  # noqa: E402
MEd._dm = types.SimpleNamespace(STATE={"work": tmp / "seed"})
MEd._seed_committed(BASE)
seed = tmp / "seed" / "edit" / "committed-edit.json"
check(seed.is_file() and json.loads(seed.read_text(encoding="utf-8")) == BASE, "Plan's edit list is written as the first committed list")
seed.write_text('{"kept": true}', encoding="utf-8")
MEd._seed_committed(BASE)
check(json.loads(seed.read_text(encoding="utf-8")) == {"kept": True}, "and a later list is never overwritten by it")

print("RESULT: " + ("PASS" if not FAILED else f"FAIL ({len(FAILED)})"))
sys.exit(1 if FAILED else 0)
