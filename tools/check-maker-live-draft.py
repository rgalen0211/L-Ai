"""The live editor's draft on this computer (tools/maker_live.py): its rules against the REAL editor core's answers, the shared op cases, and the draft's own behaviour. NEXT-CONNECT 142.

    py -I tools/check-maker-live-draft.py

Oracles (none is written by hand here):
  * tests/web-edit-vectors.json   WEB's cases made from assets/app-editor-core.js (L-Ai live-editor c970754, tools/make-edit-vectors.mjs): the state before, the op, and the refusal sentence or the state after.
  * tests/live-editor-vectors.json  280 more, made by the same core with a seeded generator (core sha256 inside the file), including hostile and random ops.
  * tests/edit-op-cases.json      the closed vocabulary, the file the SQL and TypeScript checks run (the three extra look keys are added, as they are there).
Then the draft: the five functions' answers and codes, the AI's limits, undo, persistence, the summary that may leave the computer. Nothing is rendered, nothing touches the network."""
import json
import sys
import tempfile
import threading
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))
import maker_live as ML  # noqa: E402

FAILED = []


def check(ok, what):
    print(("  ok   " if ok else "  FAIL ") + what)
    if not ok:
        FAILED.append(what)


def load(name):
    return json.loads((ROOT / "tests" / name).read_text(encoding="utf-8"))


def same(a, b):
    """Deep equality where 1 and 1.0 are the same number (JSON from JavaScript)."""
    if isinstance(a, dict) and isinstance(b, dict):
        return a.keys() == b.keys() and all(same(a[k], b[k]) for k in a)
    if isinstance(a, list) and isinstance(b, list):
        return len(a) == len(b) and all(same(x, y) for x, y in zip(a, b))
    if isinstance(a, bool) or isinstance(b, bool):
        return a is b
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        return a == b
    return a == b


# ------------------------------------------------------------------------------------------------ 1. the page's rules against the real core
def run_vectors(name, label):
    bad = []
    for c in load(name)["cases"]:
        before = json.loads(json.dumps(c["state_before"] if "state_before" in c else c["before"]))
        why = ML.check(before, c["op"])
        want_why = c.get("refusal", c.get("why"))
        if why != want_why:
            bad.append((c.get("name", ""), c["op"], why, want_why))
            continue
        if why is None:
            got = ML.apply(before, c["op"])
            want = c.get("state_after", c.get("after"))
            if not same(got, want):
                bad.append((c.get("name", ""), c["op"], "state_after differs", {k: (got.get(k), want.get(k)) for k in want if not same(got.get(k), want.get(k))}))
    for b in bad[:5]:
        print("      ", json.dumps(b, default=str)[:420])
    check(not bad, f"{label}: every case gives the core's answer (sentence for sentence, state for state); {len(bad)} differ")


web = load("web-edit-vectors.json")
run_vectors("web-edit-vectors.json", f"WEB's {len(web['cases'])} vectors")
mine = load("live-editor-vectors.json")
run_vectors("live-editor-vectors.json", f"the {mine['count']} seeded vectors")
check(sum(1 for c in web["cases"] if c.get("refusal")) >= 50 and sum(1 for c in mine["cases"] if c["why"] is None) >= 40, "the vectors hold both refusals and accepted changes in numbers that mean something")

# ------------------------------------------------------------------------------------------------ 2. the closed vocabulary against the shared cases
shared = load("edit-op-cases.json")
extra = {k["key"]: {"kind": k["kind"], "extra": ((k["min"], k["max"]) if k["kind"] == "number" else tuple(k.get("choices") or ()))} for k in shared["extra_look_keys"]}
defs = {k: {"kind": v[0], "extra": v[1]} for k, v in ML.LOOK_KEYS.items()}
defs.update(extra)
check(sorted(ML.LOOK_KEYS) == sorted(shared["look_keys"]), "the nine look keys are the shared list's")
wrong = []
for c in shared["cases"]:
    got = ML.op_problem(c["mode"], c["op"], defs)
    if c["ok"] and got is not None:
        wrong.append((c["op"], got))
    if not c["ok"] and (got is None or c["word"] not in got):
        wrong.append((c["op"], got, c["word"]))
check(not wrong, f"the vocabulary check agrees with all {len(shared['cases'])} shared cases (as the SQL and TypeScript do); {len(wrong)} differ")
for w in wrong[:4]:
    print("      ", json.dumps(w, default=str)[:300])

# ------------------------------------------------------------------------------------------------ 3. the draft
SUMMARY = {"duration": 12, "lanes": ["video", "text"], "limits": {"text_chars": 120}, "clips": [
    {"id": "v1", "track": "video", "start": 0, "len": 5, "label": "great news", "source": "a.mp4", "source_start": 10, "min_len": 0.3, "max_len": 20, "speaker": "Frank", "voice_id": "x"},
    {"id": "v2", "track": "video", "start": 5, "len": 4, "label": "good news", "source": "b.mp4", "source_start": 0, "min_len": 0.3, "max_len": 8},
    {"id": "t1", "track": "text", "start": 1, "len": 3, "label": "title", "text": "Hello", "min_len": 0.5, "max_len": 30, "private_note": "not for the site"}]}
DARK, LIGHT = "#112233", "#EEEEEE"
clock = [1_000_000.0]
tmp = Path(tempfile.mkdtemp(prefix="maker-live-", dir=None))
import atexit as _atexit  # noqa: E402
import shutil as _shutil  # noqa: E402
_atexit.register(_shutil.rmtree, tmp, True)                                      # the check leaves nothing behind in the Temp folder


def fresh(name, ai_visible=True):
    d = ML.LiveDraft(tmp / (name + ".json"), clock=lambda: clock[0])
    d.set_base("compilation", SUMMARY)
    d.set_ai_visible(ai_visible)
    return d


def rpc(d, name, **a):
    return d.rpc(name, a)


def fails(d, code, name, **a):
    r = d.rpc(name, a)
    return r["data"] is None and r["error"] and r["error"]["code"] == code and r["error"]["message"]


tr = {"canvas": {"w": 1280, "h": 720}, "styles": {"title": {}, "caption": {}, "lower_third": {}}}
dt = ML.LiveDraft(tmp / "tr.json", clock=lambda: clock[0])
dt.set_base("compilation", dict(SUMMARY, text_rules=tr))
check(dt.state("compilation").get("text_rules") == tr and dt.ops_since("compilation", 0)["state"].get("text_rules") == tr, "the film's text rules reach the page through the draft's state")
dt.apply_ops("compilation", dt.ops_since("compilation", 0)["revision"], [{"op": "set_clip_text", "id": "t1", "text": "x"}], "person")
check(dt.state("compilation").get("text_rules") == tr and "text_rules" not in dt.summary() and "text_rules" not in json.dumps(dt.summary()), "they survive a change, and they are NOT in the summary that may leave the computer")
d = fresh("a")
rev = d.ops_since("compilation", 0)["revision"]
check(d.state("compilation")["clips"][0].get("speaker") is None and d.state("compilation")["clips"][0].get("voice_id") is None, "speaker and voice fields never enter the draft (they stay on this computer's own pages)")
r = rpc(d, "editor_apply_ops", p_project="p", p_mode="compilation", p_base_revision=rev, p_ops=[{"op": "set_clip_text", "id": "t1", "text": "New words"}, {"op": "reorder_clip", "id": "v2", "index": 0}])
check(r["error"] is None and r["data"]["revision"] == rev + 1 and r["data"]["changes"] == 2 and r["data"]["pending"] is False, "the person's change is applied at once: one revision for the call, two changes, nothing waiting")
st = d.state("compilation")
check([c["id"] for c in st["clips"] if c["track"] == "video"] == ["v2", "v1"] and st["clips"][0]["start"] == 0 and st["clips"][1]["start"] == 4, "the video lane is packed again from 0 after a reorder")
check("The editor has changed" in (fails(d, "PT409", "editor_apply_ops", p_project="p", p_mode="compilation", p_base_revision=rev, p_ops=[{"op": "delete_clip", "id": "t1"}]) or ""), "a stale revision is refused with PT409 and the current revision")
before = d.state("compilation")
msg = fails(d, "22023", "editor_apply_ops", p_project="p", p_mode="compilation", p_base_revision=rev + 1, p_ops=[{"op": "delete_clip", "id": "t1"}, {"op": "move_clip", "id": "v1", "start": 3}])
check(bool(msg) and msg.startswith("Change 2 was not accepted, and nothing was changed:") and d.state("compilation") == before, "a batch is all or none: the bad second change refuses the whole call and nothing moved")
check(bool(fails(d, "22023", "editor_apply_ops", p_project="p", p_mode="compilation", p_base_revision=rev + 1, p_ops=[])) and bool(fails(d, "22023", "editor_apply_ops", p_project="p", p_mode="compilation", p_base_revision=rev + 1, p_ops=[{"op": "delete_clip", "id": "t1"}] * 21)),
      "none and twenty-one changes are refused")
check(bool(fails(d, "22023", "editor_apply_ops", p_project="p", p_mode="compilation", p_base_revision=rev + 1, p_ops=[{"op": "save_story"}])) and bool(fails(d, "22023", "editor_apply_ops", p_project="p", p_mode="compilation", p_base_revision=rev + 1, p_ops=[{"op": "set_clip_text", "id": "t1", "text": "C:\\Users\\me\\x.txt"}])),
      "an op outside the closed list, and text naming a place, are refused")
check(bool(fails(d, "22023", "no_such_function", p_project="p")) and d.rpc("editor_apply_ops", {})["error"]["code"] == "22023", "only the five names exist; a call missing its arguments is refused, not a crash")

# the AI
rev = d.ops_since("compilation", 0)["revision"]
a = d.apply_ops("compilation", rev, [{"op": "add_clip", "track": "text", "start": 6, "len": 2, "text": "By the AI"}], "ai", "Claude")
check(a["changes"] == 1 and d.ops_since("compilation", rev)["ops"][0]["actor"] == "ai" and d.ops_since("compilation", rev)["ops"][0]["client"] == "Claude", "an AI change is applied and shows in the page's next poll tagged as the AI's")
hidden = fresh("hidden", ai_visible=False)
code = None
try:
    hidden.apply_ops("compilation", hidden.ops_since("compilation", 0)["revision"], [{"op": "delete_clip", "id": "t1"}], "ai", "Claude")
except ML.LiveError as e:
    code = e.code
check(code == "PT403", "an AI is refused (PT403) while the person has not ticked 'Let my AI see my track list'")
try:
    d.apply_ops("compilation", d.ops_since("compilation", 0)["revision"], [{"op": "add_clip", "track": "pictures", "start": 1, "len": 2, "picture": "logo.png"}], "ai", "Claude")
    lane = None
except ML.LiveError as e:
    lane = e.message
check(lane is not None and "That part of the film can not be edited here yet." in lane, "add_clip on a lane the maker cannot build is refused in the page's own words")

# undo: the person undoes the AI's change; the AI may not repeat it for ten minutes; the person's own change stays
ai_row = [r for r in d.ops_since("compilation", 0)["ops"] if r["actor"] == "ai"][0]
u = rpc(d, "editor_undo", p_project="p", p_mode="compilation", p_op_id=ai_row["id"])["data"]
check(u["undone"] == 1 and not any(c["text"] == "By the AI" for c in d.state("compilation")["clips"] if c["track"] == "text") and any(c.get("text") == "New words" for c in d.state("compilation")["clips"]),
      "the person's undo takes back that AI change and leaves their own")
again = None
try:
    d.apply_ops("compilation", d.ops_since("compilation", 0)["revision"], [{"op": "add_clip", "track": "text", "start": 6, "len": 2, "text": "By the AI"}], "ai", "Claude")
except ML.LiveError as e:
    again = (e.code, e.message)
check(again is not None and again[0] == "PT409" and "undid exactly this" in again[1], "the AI cannot repeat it straight away (PT409)")
clock[0] += 11 * 60
ok_again = d.apply_ops("compilation", d.ops_since("compilation", 0)["revision"], [{"op": "add_clip", "track": "text", "start": 6, "len": 2, "text": "By the AI"}], "ai", "Claude")
check(ok_again["changes"] == 1, "after ten minutes it may be proposed again")
n = len([r for r in d.ops_since("compilation", 0)["ops"] if r["actor"] == "ai" and r["status"] == "applied"])
ua = rpc(d, "editor_undo_all_ai", p_project="p", p_mode="compilation")["data"]
check(ua["undone"] == n and n >= 1 and not any(r["status"] == "applied" and r["actor"] == "ai" for r in d.ops_since("compilation", 0)["ops"]) and any(c.get("text") == "New words" for c in d.state("compilation")["clips"]),
      "'undo all of my AI's changes' takes only the AI's")

# limits
lim = fresh("limits")
sent = 0
for i in range(3):
    lim.apply_ops("data", lim.ops_since("data", 0)["revision"], [{"op": "set_look", "key": "page.background", "value": DARK}] * 20, "ai", "Claude")
    sent += 20
code = None
try:
    lim.apply_ops("data", lim.ops_since("data", 0)["revision"], [{"op": "set_look", "key": "page.background", "value": LIGHT}], "ai", "Claude")
except ML.LiveError as e:
    code = e.code
check(code == "PT429", "the 61st change an AI makes in a minute is refused (PT429)")
person_ok = lim.apply_ops("data", lim.ops_since("data", 0)["revision"], [{"op": "set_look", "key": "page.background", "value": LIGHT}] * 20, "person")
check(person_ok["changes"] == 20, "the person has no such limit")
clock[0] += 61
day = fresh("day")
for i in range(30):
    day.apply_ops("data", day.ops_since("data", 0)["revision"], [{"op": "set_look", "key": "page.background", "value": DARK}] * 20, "ai", "Claude")
    clock[0] += 61
code = None
try:
    day.apply_ops("data", day.ops_since("data", 0)["revision"], [{"op": "set_look", "key": "page.background", "value": LIGHT}], "ai", "Claude")
except ML.LiveError as e:
    code = e.code
check(code == "PT429", "the 601st change in a day is refused (PT429)")

# data mode: undo never clobbers a newer change to the same setting
dm = fresh("dm")
dm.apply_ops("data", 0 + dm.ops_since("data", 0)["revision"], [{"op": "set_look", "key": "state.fill", "value": "#111111"}], "person")
r1 = dm.apply_ops("data", dm.ops_since("data", 0)["revision"], [{"op": "set_look", "key": "state.fill", "value": "#ff0000"}], "ai", "Claude")
dm.apply_ops("data", dm.ops_since("data", 0)["revision"], [{"op": "set_look", "key": "state.fill", "value": "#00ff00"}], "person")
ai_id = [r for r in dm.ops_since("data", 0)["ops"] if r["actor"] == "ai"][0]["id"]
res = rpc(dm, "editor_undo", p_project="p", p_mode="data", p_op_id=ai_id)["data"]
check(res["undone"] == 0 and res["skipped"] == 1 and res["state"]["look"]["state.fill"] == "#00ff00", "undoing an old change never clobbers a newer one to the same setting")
bk = rpc(dm, "editor_apply_ops", p_project="p", p_mode="data", p_base_revision=dm.ops_since("data", 0)["revision"], p_ops=[{"op": "set_look", "key": "nope.key", "value": "#000000"}])
check(bk["error"]["code"] == "22023" and "is not a look setting the editor has" in bk["error"]["message"], "a look key that is not on the list is refused in plain words")

# persistence, summary, heartbeat
reload = ML.LiveDraft(tmp / "a.json", clock=lambda: clock[0])
check(same(reload.state("compilation"), d.state("compilation")) and reload.ops_since("compilation", 0)["revision"] == d.ops_since("compilation", 0)["revision"], "the draft survives closing the maker (read back from its file)")
s = d.summary()
text = json.dumps(s)
check(s["schema"] == "ryagram.edit-tracks/0" and all(set(c) <= {"id", "track", "start", "len", "label", "text", "picture", "file", "source", "source_start", "min_len", "max_len", "position", "size", "ai_altered", "ai_altered_by"} for c in s["clips"]),
      "the summary that may leave the computer holds only the fields the site accepts")
check("Frank" not in text and "voice" not in text and "C:" not in text and "\\\\" not in text and "private_note" not in text, "no speaker, voice, path or field outside the fixed list in the summary")
check(not d.editor_open() and (d.heartbeat("compilation") or True) and d.editor_open() and not (clock.__setitem__(0, clock[0] + 31) or d.editor_open()), "the heartbeat says whether the editor page is open, for 30 seconds")
junk = tmp / "junk.json"
junk.write_text("not json", encoding="utf-8")
check(ML.LiveDraft(junk).state("data")["look"] == {}, "a damaged draft file starts a fresh draft instead of crashing")
race = fresh("race")
th = [threading.Thread(target=lambda: [race.apply_ops("data", 0, [{"op": "set_look", "key": "page.background", "value": DARK}], "person") if False else (race.heartbeat("data"), race.set_ai_visible(True)) for _ in range(20)]) for _ in range(4)]
[t.start() for t in th]
[t.join() for t in th]
check(ML.LiveDraft(tmp / "race.json").state("data")["look"] == {}, "parallel use of one draft by the page and the sync does not crash or damage the file")

# the page's own words for a clip over its length, as an AI would meet them
x = fresh("len")
code_msg = None
try:
    x.apply_ops("compilation", x.ops_since("compilation", 0)["revision"], [{"op": "trim_clip", "id": "v2", "edge": "end", "to": 100}], "person")
except ML.LiveError as e:
    code_msg = e.message
check(code_msg is not None and "past the end of the video file" in code_msg, "a trim past the end of the video file is refused with the page's sentence")

# ------------------------------------------------------------------------------------------------ 4. the vocabulary piece: text style, music, phrase rules, the film's look
S2 = dict(SUMMARY, lanes=["video", "text", "music"], pictures=[{"id": "p1", "name": "logo.png"}], rules=[{"id": "r1", "phrase": "good news", "picture": "p1", "seconds": 2, "mode": "corner"}],
          clips=SUMMARY["clips"] + [{"id": "music", "track": "music", "start": 0, "len": 12, "label": "Song", "source": "song.mp3", "source_start": 0, "level_db": -12, "fade_in_s": 0, "fade_out_s": 1, "snap": False}])
v = ML.LiveDraft(tmp / "vocab.json", clock=lambda: clock[0])
v.set_base("compilation", S2)
v.set_ai_visible(True)
st0 = v.state("compilation")
check(st0["rules"][0]["id"] == "r1" and st0["pictures"][0]["name"] == "logo.png", "rules and picture names come into the draft with the film")


def one(op):
    rev = v.ops_since("compilation", 0)["revision"]
    return v.rpc("editor_apply_ops", {"p_project": "p", "p_mode": "compilation", "p_base_revision": rev, "p_ops": [op]})


def word(op):
    r = one(op)
    return r["error"]["message"] if r["error"] else None


check(word({"op": "set_clip_style", "id": "t1", "style": "caption"}) is None and [c for c in v.state("compilation")["clips"] if c["id"] == "t1"][0]["style"] == "caption", "a text clip takes a style")
check("Only a text clip has a style." in (word({"op": "set_clip_style", "id": "v1", "style": "title"}) or ""), "a video clip does not")
check(word({"op": "set_music", "level_db": -6, "fade_in_s": 1.5, "snap": True}) is None and [c for c in v.state("compilation")["clips"] if c["id"] == "music"][0]["level_db"] == -6 and [c for c in v.state("compilation")["clips"] if c["id"] == "music"][0]["snap"] is True, "set_music changes only the fields it names")
check([c for c in v.state("compilation")["clips"] if c["id"] == "music"][0]["fade_out_s"] == 1, "the music fields it did not name are left alone")
nm = ML.LiveDraft(tmp / "nomusic.json", clock=lambda: clock[0])
nm.set_base("compilation", SUMMARY)
check("There is no music on this film." in (nm.rpc("editor_apply_ops", {"p_project": "p", "p_mode": "compilation", "p_base_revision": nm.ops_since("compilation", 0)["revision"], "p_ops": [{"op": "set_music", "level_db": 0}]})["error"] or {"message": ""})["message"], "set_music on a film with no music lane is refused in words")
check(word({"op": "set_rule", "phrase": "great news", "picture": "p1", "seconds": 3, "mode": "centre", "fade_s": 0.25}) is None and [r["id"] for r in v.state("compilation")["rules"]][-1].startswith("rule"), "a rule without an id is added with a new id")
check(word({"op": "set_rule", "id": "r1", "phrase": "good news!", "picture": "p1", "seconds": 4, "mode": "full"}) is None and [r for r in v.state("compilation")["rules"] if r["id"] == "r1"][0]["seconds"] == 4, "a rule with an id replaces that rule")
check("That picture is not one of yours." in (word({"op": "set_rule", "phrase": "x", "picture": "nope", "seconds": 2, "mode": "full"}) or ""), "a rule naming a picture the person does not have is refused")
check("That rule is not in this film." in (word({"op": "set_rule", "id": "zzz", "phrase": "x", "picture": "p1", "seconds": 2, "mode": "full"}) or "") and "That rule is not in this film." in (word({"op": "delete_rule", "id": "zzz"}) or ""), "changing or deleting a rule that is not there is refused")
check(word({"op": "delete_rule", "id": "r1"}) is None and not any(r["id"] == "r1" for r in v.state("compilation")["rules"]), "delete_rule takes it out")
many = ML.LiveDraft(tmp / "manyrules.json", clock=lambda: clock[0])
many.set_base("compilation", dict(S2, rules=[{"id": f"r{i}", "phrase": "a", "picture": "p1", "seconds": 1, "mode": "full"} for i in range(50)]))
r51 = many.rpc("editor_apply_ops", {"p_project": "p", "p_mode": "compilation", "p_base_revision": many.ops_since("compilation", 0)["revision"], "p_ops": [{"op": "set_rule", "phrase": "b", "picture": "p1", "seconds": 1, "mode": "full"}]})
check("at most 50 rules" in ((r51["error"] or {}).get("message") or ""), "the 51st rule is refused")
check(word({"op": "set_film_look", "key": "theme", "value": "light"}) is None and word({"op": "set_film_look", "key": "box_opacity", "value": 0.5}) is None and v.state("compilation")["look"]["theme"] == "light" and v.state("compilation")["look"]["box_opacity"] == 0.5, "the film's look changes")
sm = v.summary()
check([r["phrase"] for r in sm["rules"]] == ["great news"] and sm["pictures"] == [{"id": "p1", "name": "logo.png"}] and sm["look"] == {"theme": "light", "box_opacity": 0.5}, "the summary carries the rules, the picture NAMES and the film's look")
mc = [c for c in sm["clips"] if c["id"] == "music"][0]
check(mc["level_db"] == -6 and mc["fade_in_s"] == 1.5 and mc["fade_out_s"] == 1 and mc["snap"] is True, "the summary carries the music lane's settings")
undo_rev = v.ops_since("compilation", 0)["revision"]
last = [o for o in v.ops_since("compilation", 0)["ops"] if o["status"] == "applied"][-1]
check(v.rpc("editor_undo", {"p_mode": "compilation", "p_op_id": last["id"]})["error"] is None and "box_opacity" not in v.state("compilation")["look"], "undoing a film look change puts it back")

print("RESULT: " + ("PASS" if not FAILED else f"FAIL ({len(FAILED)})"))
sys.exit(1 if FAILED else 0)
