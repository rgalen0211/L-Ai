"""A second Plan must reach the editor and 'Build final film' (WORKER 46, 14:59): the REAL tools/maker_edit.py and tools/maker_live.py with a stand-in maker state and the engine's own edittracks.

    py -I tools/check-maker-plan-reset.py <engine checkout with ryagram/local/edittracks.py> [scratch base folder on D:]

What it proves: a new plan (other words or other videos) drops the edit list saved for the old one, the list the final film is checked against, and the live draft restarts from the new rough cut with a
higher revision; the SAME plan again keeps the person's edits; a restart of the maker keeps them too (the plan's fingerprint is on disk), and a different plan after a restart drops them. No video, no
network, nothing but small files in a throwaway folder that is deleted at the end."""
import copy
import json
import shutil
import sys
import tempfile
import types
from pathlib import Path

HERE = Path(__file__).resolve().parent
ENGINE = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else None
if ENGINE is None or not (ENGINE / "ryagram" / "local" / "edittracks.py").is_file():
    print("usage: check-maker-plan-reset.py <engine checkout with ryagram/local/edittracks.py> [scratch base folder on D:]")
    sys.exit(2)
sys.path[:0] = [str(HERE), str(ENGINE)]
import maker_edit as ME  # noqa: E402
import maker_live as ML  # noqa: E402
from ryagram.local import editbuild as EB  # noqa: E402

FAILED = []


def check(ok, what):
    print(("  ok   " if ok else "  FAIL ") + what)
    if not ok:
        FAILED.append(what)


def edit_for(tag):
    return {"schema": EB.SCHEMA, "mode": "compilation", "film": {"width": 1280, "height": 720, "fps": 30}, "seq": 1,
            "clips": [{"id": "c1", "file_name": "a.mp4", "in_s": 2.0, "out_s": 5.5, "join": {"kind": "cut", "s": 0}, "words": [{"w": "hello", "s": 2.2, "e": 2.6}]},
                      {"id": "c2", "file_name": "b.mp4", "in_s": 0.0, "out_s": 3.0, "join": {"kind": "cut", "s": 0}, "words": []}],
            "images": [], "rules": [], "texts": [{"text": tag, "start_s": 1.0, "length_s": 3.0, "position": "top"}],
            "captions": {"on": True, "size": "medium", "position": "bottom"}, "look": {"theme": "dark"}, "music": None}


class FakeEngine:
    """The part of editbuild maker_edit.load() needs to make a rough cut from a plan; the plan here is {'tag': ...}."""

    class EditError(Exception):
        pass

    SCHEMA = EB.SCHEMA

    @staticmethod
    def resolve_media(items):
        return {"a.mp4": 20.0, "b.mp4": 8.0}

    @staticmethod
    def initial_edit(plan, media):
        return edit_for(plan["tag"])


ME._eb = lambda: FakeEngine
ML._media_seconds = lambda: {"a.mp4": 20.0, "b.mp4": 8.0}
base = Path(sys.argv[2]) if len(sys.argv) > 2 else Path(tempfile.gettempdir())
tmp = Path(tempfile.mkdtemp(prefix="plan-reset-", dir=str(base)))


def maker(work, out):
    """A fresh 'run' of the maker: its own STATE, the same folders on disk."""
    dm = types.SimpleNamespace(STATE={"work": work, "out": out, "last_plan": None, "last_plan_args": ["--video=a.mp4", "--video=b.mp4"], "edit_on": True, "live_on": True, "signin": None})
    ME.attach(dm)
    ML.attach(dm)
    ML._ME = ME
    return dm


def plan(dm, tag):
    dm.STATE["last_plan"] = {"tag": tag}
    return ME.plan_changed(dm.STATE["last_plan"])


def texts(lst):
    return [t["text"] for t in lst["texts"]]


try:
    work, out = tmp / "work", tmp / "films"
    work.mkdir()
    out.mkdir()
    dm = maker(work, out)

    check(plan(dm, "A") is True and texts(ME.load()["edit"]) == ["A"], "the first plan: the editor opens on its rough cut")
    committed = work / "edit" / "committed-edit.json"
    check(committed.is_file() and texts(json.loads(committed.read_text(encoding="utf-8"))) == ["A"], "the list the final film is checked against is seeded from it")
    d = ML.draft()
    rev_a = d.ops_since("compilation", 0)["revision"]
    check([c["id"] for c in d.state("compilation")["clips"] if c["track"] == "video"] == ["c1", "c2"], "the live draft opens on plan A's clips")

    mine = edit_for("A")
    mine["texts"][0]["text"] = "A, edited by the person"
    ME.save({"edit": mine})
    check(plan(dm, "A") is False and texts(ME.load()["edit"]) == ["A, edited by the person"], "the SAME plan again keeps the person's edits")

    check(plan(dm, "B") is True, "a different plan is noticed")
    check(not ME.edit_path().exists() and not committed.exists(), "the saved edit list and the committed list of the old plan are gone")
    check(texts(ME.load()["edit"]) == ["B"], "the editor and 'Build final film' now open on plan B's rough cut, not plan A's")
    check(committed.is_file() and texts(json.loads(committed.read_text(encoding="utf-8"))) == ["B"], "the committed list is seeded from plan B")
    ML.plan_changed()
    d = ML.draft()
    texts_b = [c.get("text") for c in d.state("compilation")["clips"] if c["track"] == "text"]
    check(texts_b == ["B"] and d.ops_since("compilation", 0)["revision"] > rev_a, "the live draft starts again from plan B and its revision went UP (an open page sees it)")

    ME.save({"edit": dict(edit_for("B"), texts=[{"text": "B edited", "start_s": 1.0, "length_s": 3.0, "position": "top"}])})
    dm2 = maker(work, out)                                              # the maker is closed and opened again
    check(plan(dm2, "B") is False and texts(ME.load()["edit"]) == ["B edited"], "after a restart, the same plan keeps the person's edits (the fingerprint is on disk)")
    dm3 = maker(work, out)
    check(plan(dm3, "C") is True and texts(ME.load()["edit"]) == ["C"], "after a restart, a different plan starts from its own rough cut")

    ML._dm.STATE["live"]["draft"] = None
    (work / "live").mkdir(exist_ok=True)
    (work / "live" / "live-draft.json").write_text("{}", encoding="utf-8")
    ML.plan_changed()
    check(not (work / "live" / "live-draft.json").exists(), "with no draft made yet, an old draft file is removed so a new draft cannot start from it")
    check(ME.plan_sha({"tag": "A"}) != ME.plan_sha({"tag": "B"}) and ME.plan_sha({"x": 1, "y": 2}) == ME.plan_sha({"y": 2, "x": 1}), "the fingerprint tells plans apart and ignores key order")
    # the maker's own job_status() is what calls it when a Plan finishes (the real desktop_maker, its job runner stood in)
    import desktop_maker as DM  # noqa: E402
    work2, out2 = tmp / "work2", tmp / "films2"
    work2.mkdir()
    out2.mkdir()
    DM.STATE.update(work=work2, out=out2, last_plan=None, last_plan_args=[], edit_on=True, live_on=True, signin=None, job=None)
    DM.STATE.pop("edit", None)
    DM.STATE.pop("live", None)
    ME.attach(DM)
    ML.attach(DM)
    ML._ME = ME
    state = {"v": "A"}
    DM._job_status = lambda: {"state": "planned", "plan": {"tag": state["v"]}}
    DM.job_status()
    check(texts(ME.load()["edit"]) == ["A"], "job_status() on a finished Plan: the editor opens on it")
    ME.save({"edit": dict(edit_for("A"), texts=[{"text": "A edited", "start_s": 1.0, "length_s": 3.0, "position": "top"}])})
    DM.job_status()
    check(texts(ME.load()["edit"]) == ["A edited"], "job_status() polled again with the same plan keeps the person's edits")
    state["v"] = "B"
    DM.job_status()
    check(texts(ME.load()["edit"]) == ["B"], "job_status() on a SECOND Plan: the editor and the final film open on the new rough cut")
    DM.STATE["live_on"] = False
    state["v"] = "C"
    DM.job_status()
    check(texts(ME.load()["edit"]) == ["C"], "without --live the edit page still starts again on a new plan")
finally:
    shutil.rmtree(tmp, ignore_errors=True)
print("RESULT: " + ("PASS" if not FAILED else f"FAIL ({len(FAILED)})"))
sys.exit(1 if FAILED else 0)
