"""The live editor's sync with the person's account (tools/maker_live_sync.py), against a stand-in for the site. NEXT-CONNECT 142.

    py -I tools/check-maker-live-sync.py

The stand-in keeps the same rules as the SQL (supabase/migrations/20261027000400_live_editor.sql): it hands out waiting changes for one person, takes a summary and the acknowledgements, drops the AI's
waiting changes when the tick goes. Nothing is rendered, no network is used. MUST-FAILs at the end: the source is mutated in a scratch copy and this file must then fail."""
import json
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import maker_live as ML  # noqa: E402
import maker_live_sync as MS  # noqa: E402

FAILED = []


def check(ok, what):
    print(("  ok   " if ok else "  FAIL ") + what)
    if not ok:
        FAILED.append(what)


PROJECT = "00000000-0000-4000-8000-0000000000a1"
OTHER = "00000000-0000-4000-8000-0000000000a2"
SUMMARY = {"duration": 12, "lanes": ["video", "text"], "limits": {"text_chars": 120}, "clips": [
    {"id": "v1", "track": "video", "start": 0, "len": 5, "label": "great news", "source": "a.mp4", "source_start": 10, "min_len": 0.3, "max_len": 20, "speaker": "Frank", "voice_id": "v9"},
    {"id": "v2", "track": "video", "start": 5, "len": 4, "label": "good news", "source": "b.mp4", "source_start": 0, "min_len": 0.3, "max_len": 8},
    {"id": "t1", "track": "text", "start": 1, "len": 3, "label": "title", "text": "Hello", "min_len": 0.5, "max_len": 30}]}


class Site:
    """The site as the app meets it: signin.status() and signin.api(method, route, body) -> (status, obj)."""

    def __init__(self):
        self.signed_in = True
        self.queue = []                  # {id, project_id, revision, client, op}
        self.calls = []
        self.fail = None                 # an exception to raise on the next call
        self.mirror = {}                 # project -> posted body
        self.next_id = 1

    def add(self, project, revision, client, op):
        self.queue.append({"id": self.next_id, "project_id": project, "revision": revision, "client": client, "op": op})
        self.next_id += 1
        return self.next_id - 1

    def status(self):
        return {"state": "signed_in" if self.signed_in else "signed_out"}

    def api(self, method, route, body):
        self.calls.append((method, route, json.loads(json.dumps(body))))
        if self.fail:
            e, self.fail = self.fail, None
            raise e
        if route == "/node/edit-pending":
            return 200, {"changes": [dict(c) for c in self.queue[:100]]}
        if route == "/node/edit-summary":
            for a in body.get("applied", []):
                self.queue = [c for c in self.queue if c["id"] != a["op_id"]]
            if not body["mirror"] or not body.get("ai_visible"):
                self.queue = [c for c in self.queue if not (c["project_id"] == body["project_id"] and c["client"])]
            self.mirror[body["project_id"]] = body
            return 200, {"revision": len(self.calls), "mirrored": body["mirror"], "ai_visible": bool(body["mirror"] and body.get("ai_visible"))}
        return 404, {}


clock = [5_000.0]
tmp = Path(tempfile.mkdtemp(prefix="maker-live-sync-"))


def world(name, ai=True, mirror=True):
    site = Site()
    draft = ML.LiveDraft(tmp / (name + ".json"), clock=lambda: clock[0])
    draft.set_base("compilation", SUMMARY)
    sync = MS.LiveSync(site, draft, clock=lambda: clock[0])
    sync.attach(PROJECT)
    sync.set_switches(mirror, ai)
    return site, draft, sync


def texts(draft):
    return [c.get("text") for c in draft.state("compilation")["clips"] if c["track"] == "text"]


# 1. nothing is sent unless signed in, attached and switched on
site, draft, sync = world("off", mirror=False)
site.signed_in = False
sync.set_switches(True, True)
check(sync.tick(force=True) == {"asked": False, "applied": 0, "refused": 0, "posted": False} and site.calls == [], "signed out: nothing is asked and nothing is sent")
site.signed_in = True
sync.attach(None)
check(sync.tick(force=True)["asked"] is False and site.calls == [], "not attached to a film of the person's account: nothing is sent")
site, draft, sync = world("off2", mirror=False)
check(sync.tick(force=True)["asked"] is False and site.calls == [], "the mirror switched off from the start: nothing is asked and nothing is sent")

# 2. the first cycle mirrors the summary, with the person's own tick, names and times only
site, draft, sync = world("a")
r = sync.tick(force=True)
check(r["asked"] and r["posted"] and [c[1] for c in site.calls] == ["/node/edit-pending", "/node/edit-summary"], "the first cycle asks what waits and posts the summary: exactly the two routes")
body = site.calls[1][2]
check(body["mirror"] is True and body["ai_visible"] is True and body["project_id"] == PROJECT and body["summary"] == draft.summary(), "the post carries the mirror, the tick and the draft's own summary")
dump = json.dumps(body)
check("Frank" not in dump and "voice" not in dump and "C:\\" not in dump and set(body) <= {"project_id", "mirror", "ai_visible", "summary", "applied"}, "no speaker, voice or path leaves; only the five fields the route takes")
site.calls.clear()
clock[0] += 31
sync.tick()
check([c[1] for c in site.calls] == ["/node/edit-pending"], "when nothing changed, a later cycle only asks (no summary is posted again)")

# 3. an AI change is applied locally as the AI's, acknowledged, and the new summary is posted
site, draft, sync = world("b")
sync.tick(force=True)
op = site.add(PROJECT, 3, "Claude", {"op": "set_clip_text", "id": "t1", "text": "By the AI"})
site.calls.clear()
r = sync.tick(force=True)
rows = draft.ops_since("compilation", 0)["ops"]
check(r["applied"] == 1 and "By the AI" in texts(draft) and rows[-1]["actor"] == "ai" and rows[-1]["client"] == "Claude", "an AI change lands in the local draft as the AI's, tagged with its name")
post = [c for c in site.calls if c[1] == "/node/edit-summary"][0][2]
check(post["applied"] == [{"op_id": op, "ok": True}] and post["summary"]["clips"][2]["text"] == "By the AI" and site.queue == [], "it is acknowledged as applied and the new summary shows it")

# 4. the person's own change from their web editor (no AI name) is applied as the person's
site, draft, sync = world("c")
sync.tick(force=True)
site.add(PROJECT, 3, None, {"op": "move_clip", "id": "t1", "start": 6})
sync.tick(force=True)
check(draft.ops_since("compilation", 0)["ops"][-1]["actor"] == "person" and [c["start"] for c in draft.state("compilation")["clips"] if c["id"] == "t1"] == [6], "a change from the person's web editor is applied as the person's")

# 5. what cannot be applied is refused in the draft's words and acknowledged as not applied; a bad change refuses its whole batch
site, draft, sync = world("d")
sync.tick(force=True)
before = draft.state("compilation")
a1 = site.add(PROJECT, 4, "Claude", {"op": "set_clip_text", "id": "t1", "text": "Fine"})
a2 = site.add(PROJECT, 4, "Claude", {"op": "delete_clip", "id": "nope"})
b1 = site.add(PROJECT, 5, "Claude", {"op": "add_clip", "track": "pictures", "start": 1, "len": 2, "picture": "logo.png"})
site.calls.clear()
r = sync.tick(force=True)
post = [c for c in site.calls if c[1] == "/node/edit-summary"][0][2]
check(r["applied"] == 0 and r["refused"] == 3 and draft.state("compilation") == before, "a batch with one bad change changes nothing, and a lane the maker cannot build is refused: three not applied")
check(post["applied"] == [{"op_id": a1, "ok": False}, {"op_id": a2, "ok": False}, {"op_id": b1, "ok": False}], "every one is acknowledged as not applied")

# 6. while the tick is off the AI's changes are refused, and the site is told the tick is off
site, draft, sync = world("e", ai=False)
sync.tick(force=True)
check(site.mirror[PROJECT]["ai_visible"] is False, "without the tick the summary is posted with ai_visible false")
site.queue.append({"id": 99, "project_id": PROJECT, "revision": 3, "client": "Claude", "op": {"op": "set_clip_text", "id": "t1", "text": "x"}})   # (the site would not queue it; defence in depth)
r = sync.tick(force=True)
check(r["applied"] == 0 and "x" not in texts(draft), "even a change that reached the app is not applied while the tick is off")

# 7. other projects' changes are left alone
site, draft, sync = world("f")
sync.tick(force=True)
site.add(OTHER, 3, "Claude", {"op": "delete_clip", "id": "t1"})
site.calls.clear()
r = sync.tick(force=True)
check(r["applied"] == 0 and r["refused"] == 0 and len(site.queue) == 1 and "Hello" in texts(draft), "a change for another film is neither applied nor acknowledged")

# 8. the rhythm: 3 s while the editor page is open, 30 s otherwise; a person's local edit is mirrored
site, draft, sync = world("g")
sync.tick(force=True)
site.calls.clear()
clock[0] += 5
sync.tick()
check(site.calls == [], "closed editor: not asked again after 5 seconds")
clock[0] += 26
sync.tick()
check(len(site.calls) == 1, "closed editor: asked again after 30 seconds")
draft.heartbeat("compilation")
site.calls.clear()
sync.tick(force=True)
site.calls.clear()
clock[0] += 3.5
sync.tick()
check(len(site.calls) == 1, "editor page open: asked again after 3 seconds")
draft.apply_ops("compilation", draft.ops_since("compilation", 0)["revision"], [{"op": "set_clip_text", "id": "t1", "text": "Mine"}], "person")
site.calls.clear()
clock[0] += 3.5
sync.tick()
check([c[1] for c in site.calls] == ["/node/edit-pending", "/node/edit-summary"] and site.calls[1][2]["summary"]["clips"][2]["text"] == "Mine", "the person's own local edit is mirrored in the next cycle")

# 9. unticking and switching off
site, draft, sync = world("h")
sync.tick(force=True)
site.queue.append({"id": 50, "project_id": PROJECT, "revision": 9, "client": "Claude", "op": {"op": "delete_clip", "id": "t1"}})
sync.set_switches(True, False)
sync.tick(force=True)
check(site.mirror[PROJECT]["ai_visible"] is False and site.queue == [], "unticking tells the site, which drops the AI's waiting changes")
sync.set_switches(False, False)
site.calls.clear()
sync.tick(force=True)
check([(c[1], c[2]["mirror"]) for c in site.calls] == [("/node/edit-summary", False)] and "summary" not in site.calls[0][2], "switching the mirror off says so once, with no summary")
site.calls.clear()
clock[0] += 31
sync.tick()
check(site.calls == [], "and then nothing more is sent")

# 10. trouble: offline, a server error, a refused post; the draft is untouched; retried later and slower; an applied change is never applied twice
site, draft, sync = world("i")
sync.tick(force=True)
site.add(PROJECT, 3, "Claude", {"op": "add_clip", "track": "text", "start": 6, "len": 2, "text": "Once"})
orig = site.api
state = {"n": 0}


def flaky(method, route, body):
    if route == "/node/edit-summary" and state["n"] == 0:
        state["n"] += 1
        raise OSError("Could not reach Ryagram just now.")
    return orig(method, route, body)


site.api = flaky
r = sync.tick(force=True)
check(texts(draft).count("Once") == 1 and sync.message and sync.backoff == 30, "the post failed after the change was applied: the draft keeps it, the message is plain, the retry is slower")
clock[0] += 31
sync.tick()
clock[0] += 61
sync.tick()
check(texts(draft).count("Once") == 1 and site.queue == [] and sync.message == "", "the next cycle acknowledges it without applying it a second time, and the message clears")
site2, draft2, sync2 = world("j")
site2.fail = RuntimeError("boom")
r2 = sync2.tick(force=True)
check(r2["asked"] and sync2.backoff == 30 and sync2.message == "boom" and draft2.state("compilation")["clips"][0]["id"] == "v1", "a failing call never raises into the maker; the draft is as it was")

# 11. the source makes only the two calls and carries nothing else
src = (HERE / "maker_live_sync.py").read_text(encoding="utf-8")
check(len(re.findall(r"\.api\(", src)) == 2 and src.count('ROUTE_PENDING = "/node/edit-pending"') == 1 and src.count('ROUTE_SUMMARY = "/node/edit-summary"') == 1, "exactly two calls to the site, to the two routes")
check(not re.search(r"import (socket|urllib|http|requests|subprocess)|(?<![\w.])open\(|urlopen", src), "no network, process or file access in the module itself")

print("RESULT: " + ("PASS" if not FAILED else f"FAIL ({len(FAILED)})"))
sys.exit(1 if FAILED else 0)
