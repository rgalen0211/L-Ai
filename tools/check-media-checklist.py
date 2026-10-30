"""Guided footage, the desktop app's half (NEXT-CONNECT 161): the media checklist beside the request. tools/maker_checklist.py, the checklist part of tools/ryagram_requests.py and the card in the desktop maker.
LOCAL ONLY: nothing is downloaded, nothing is sent, no file's contents are read. Every refusal has a case that FAILS if the check is removed (tools/check-media-checklist-mutants.py).

    py -I tools/check-media-checklist.py <scratch base folder on D:>
"""
import importlib.util
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
BASE = Path(sys.argv[1]) if len(sys.argv) > 1 else None
import maker_checklist as MC  # noqa: E402
import ryagram_requests as RQ  # noqa: E402

FAILED = []


def check(c, what):
    print(("  ok   " if c else "  FAIL ") + what)
    if not c:
        FAILED.append(what)


PID = "11111111-2222-3333-4444-555555555555"
ITEM = {"id": "c1", "what": "The 1969 launch, wide shot", "from": "the National Archives", "must_contain": "the words lift-off", "folder": "Apollo", "count": 2}
ROW = lambda items, **kw: {"project_id": PID, "title": "My film", "request": {"schema": "ryagram.compilation-request/0", "phrase": "lift-off", "search": "every", "note": "", "checklist": items, **kw},
                           "sha256": "a" * 64, "updated_at": "2026-10-30T10:00:00Z"}

print("A. the request as the app reads it (ryagram_requests)")
got = RQ._clean(ROW([ITEM, {"what": "A hearing clip", "folder": "Hearings"}]))
cl = got["checklist"]
check([c["id"] for c in cl] == ["c1", "c2"] and cl[1]["count"] == 1 and cl[1]["from"] == "" and cl[0]["count"] == 2, "items are read with their ids, a count of 1 by default and empty optional texts")
check(all(re.match(r"^[0-9a-f]{16}$", c["key"]) for c in cl) and cl[0]["key"] != cl[1]["key"], "each item has its own 16-letter key")
check(MC.item_key(PID, cl[0]) == cl[0]["key"] and MC.item_key(PID, {**cl[0], "what": "Something else"}) != cl[0]["key"] and MC.item_key(PID, {**cl[0], "count": 3}) != cl[0]["key"] and MC.item_key("other", cl[0]) != cl[0]["key"], "the key changes when the AI changes the item or the project, so an old tick no longer applies")
check("checklist" not in RQ._clean(ROW([])), "no checklist: the request looks exactly as before (no empty field)")
check("checklist" not in RQ._clean({"project_id": PID, "title": "t", "request": {"phrase": "x", "search": "every"}}), "an older request with no checklist field at all is read as before")
hostile = RQ._clean(ROW([
    {"what": "see https://evil.example/x", "folder": "A"},                                         # a link in the words: the item is dropped
    {"what": "see www.evil.example", "folder": "A"},
    {"what": "put it in C:\\Users\\Sam\\Videos", "folder": "A"},                                   # a place: dropped
    {"what": "ok one", "from": "https://evil.example", "must_contain": "C:\\x", "folder": "A"},      # links/places in the optional texts are blanked
    {"what": "bad folder", "folder": "C:\\Videos"}, {"what": "bad folder 2", "folder": "a/b"}, {"what": "bad folder 3", "folder": ".."}, {"what": "bad folder 4", "folder": ""},
    {"what": "<b>markup</b> removed", "folder": "B", "count": 99},
    {"what": "count text", "folder": "B", "count": "2"}, {"what": "count bool", "folder": "B", "count": True},
    "not an item", 7, {"folder": "A"}, {"what": "   ", "folder": "A"},
]))
names = [c["what"] for c in hostile["checklist"]]
check(names == ["ok one", "bmarkup/b removed", "count text", "count bool"], f"hostile items are dropped or cut down: {names}")
byw = {c["what"]: c for c in hostile["checklist"]}
check(byw["ok one"]["from"] == "" and byw["ok one"]["must_contain"] == "", "MUST-FAIL guard: a link or a place in an item's optional words is blanked")
check([byw[k]["count"] for k in ("bmarkup/b removed", "count text", "count bool")] == [1, 1, 1], "a count that is not a whole number from 1 to 20 becomes 1")
check(len(RQ._clean(ROW([{"what": f"w{i}", "folder": "A"} for i in range(40)]))["checklist"]) == 12, "at most 12 items")

print("B. the folder on this computer (maker_checklist)")
tmp = Path(tempfile.mkdtemp(prefix="ckl-", dir=str(BASE) if BASE else None))
try:
    roots = [tmp / "Videos", tmp / "Downloads"]
    for r in roots:
        r.mkdir()
    ap = roots[0] / "Apollo"
    ap.mkdir()
    for n in ("a.mp4", "b.MOV", "c.mkv", "notes.txt", "d.mp4.part", "e.jpg"):
        (ap / n).write_bytes(b"x")
    (ap / "deeper").mkdir()
    (ap / "deeper" / "f.mp4").write_bytes(b"x")
    check(MC.folder_for("Apollo", roots) == ap, "a folder NAME is found directly inside a folder the maker searches")
    check(MC.folder_for("apollo", roots) is not None or os.name != "nt", "(on Windows the lookup ignores capital letters like the file system does)")
    check(MC.count_videos(ap) == 3, "only video files directly in the folder are counted: by extension, not in sub-folders, not .part, not notes")
    for bad in ("..", ".", "a/b", "a\\b", "C:\\Videos", "", "x" * 81, "Apollo/..", "*", 7, None):
        check(MC.folder_for(bad, roots) is None, f"MUST-FAIL guard: {bad!r} can never become a path")
    check(MC.folder_for("Nowhere", roots) is None, "a folder that is not there is not found")
    (roots[0] / "afile").write_bytes(b"x")
    check(MC.folder_for("afile", roots) is None, "a name that is a file, not a folder, is not found")
    outside = tmp / "outside"
    outside.mkdir()
    (outside / "z.mp4").write_bytes(b"x")
    link = roots[0] / "Linked"
    mk = subprocess.run(["cmd", "/c", "mklink", "/J", str(link), str(outside)], capture_output=True, text=True) if os.name == "nt" else None
    if mk is None:
        os.symlink(outside, link)
    check(link.exists(), "(setup) a link to a folder outside can be made")
    check(MC.folder_for("Linked", roots) is None, "MUST-FAIL guard: a folder that is a link is not followed")
    (ap / "v.mp4").write_bytes(b"x")
    big = roots[1] / "Big"
    big.mkdir()
    for i in range(30):
        (big / f"{i}.mp4").write_bytes(b"x")
    keep = MC.MAX_ENTRIES
    MC.MAX_ENTRIES = 10
    check(MC.count_videos(big) <= 10, "a huge folder is looked at only so far")
    MC.MAX_ENTRIES = keep

    print("C. done, ticks and the file of ticks")
    reqs = [{"phrase": "lift-off", "project_id": PID, "checklist": cl}]
    out = MC.decorate(reqs, roots, set())
    c0 = out[0]["checklist"][0]
    check((c0["found"], c0["have"], c0["done"], c0["manual"]) == (True, 4, True, False), "Apollo holds 4 videos (a, b, c and v) and 2 were asked: the item ticks itself")
    c1 = out[0]["checklist"][1]
    check((c1["found"], c1["have"], c1["done"]) == (False, 0, False), "Hearings is not among the searched folders: not found, not done")
    (roots[1] / "Hearings").mkdir()
    out = MC.decorate(reqs, roots, set())
    check(out[0]["checklist"][1]["found"] is True and out[0]["checklist"][1]["have"] == 0 and out[0]["checklist"][1]["done"] is False, "an empty folder is found but not done")
    (roots[1] / "Hearings" / "h.mp4").write_bytes(b"x")
    check(MC.decorate(reqs, roots, set())[0]["checklist"][1]["done"] is True, "one video in it, one asked: done")
    t = MC.Ticks(tmp / "work" / "ai-checklist.json")
    k = cl[1]["key"]
    (roots[1] / "Hearings" / "h.mp4").unlink()
    check(MC.decorate(reqs, roots, t.get())[0]["checklist"][1]["done"] is False, "(setup) not done without the file")
    check(t.set(k, True) is True and k in t.get(), "the person's tick is kept")
    d = MC.decorate(reqs, roots, t.get())[0]["checklist"][1]
    check(d["manual"] is True and d["done"] is True, "a hand-ticked item is done even with no file")
    check(MC.Ticks(tmp / "work" / "ai-checklist.json").get() == {k}, "and the tick is still there when the app is opened again (it is in a file in the work folder)")
    check(t.set(k, False) is True and k not in t.get(), "unticking removes it")
    for bad in ("", "short", "G" * 16, "../../etc/passwd", "a" * 17, None, 5):
        check(t.set(bad, True) is False, f"MUST-FAIL guard: {bad!r} is not a key and is not stored")
    check(t.get() == set(), "nothing odd was stored")
    (tmp / "work" / "ai-checklist.json").write_text('{"not-a-key": true, "' + "b" * 16 + '": "yes", "' + "c" * 16 + '": true}', encoding="utf-8")
    check(t.get() == {"c" * 16}, "a damaged or hand-edited ticks file only yields real keys with a true value")
    (tmp / "work" / "ai-checklist.json").write_text("not json", encoding="utf-8")
    check(t.get() == set(), "an unreadable ticks file is no ticks, not a crash")

    print("D. it is local only")
    src = (ROOT / "tools" / "maker_checklist.py").read_text(encoding="utf-8")
    code = "\n".join(l for l in src.splitlines() if l.lstrip().startswith(("import ", "from ")))
    mods = set(re.findall(r"^(?:import|from) (\w+)", code, flags=re.M))
    check(mods <= {"__future__", "hashlib", "json", "os", "re", "threading", "pathlib"}, f"it imports only standard file and text modules: {sorted(mods)}")
    body = re.sub(r"#.*", "", src.split('"""', 2)[2])
    check(not re.search(r"\b(import|from)\s+(socket|urllib|http|requests|subprocess|ftplib|smtplib|webbrowser)\b", body), "it names no network or process module")
    check(not re.search(r"\.(read_bytes|read_text)\(", body.replace("self.path.read_text", "")) and "open(" not in body, "it never reads a media file (only its name is looked at; the one file it reads is its own ticks file)")

    print("E. the card in the desktop maker")
    spec = importlib.util.spec_from_file_location("desktop_maker", ROOT / "tools" / "desktop_maker.py")
    dm = importlib.util.module_from_spec(spec)
    sys.modules["desktop_maker"] = dm
    spec.loader.exec_module(dm)

    class FakeAirq:
        def __init__(self, items):
            self.items = items

        def status(self, force=False):
            return {"on": True, "requests": list(self.items), "message": ""}

    work = tmp / "work2"
    work.mkdir()
    dm.STATE.update(work=work, search_roots=roots, recent_dirs=[], airq=FakeAirq([RQ._clean(ROW([ITEM, {"what": "A hearing clip", "folder": "Hearings"}]))]))
    st = dm.ai_requests_status()
    items = st["requests"][0]["checklist"]
    check(st["on"] and [(i["have"], i["done"]) for i in items] == [(4, True), (0, False)], "the card's data carries the counts, counted on this computer in the maker's own search folders")
    key = items[1]["key"]
    check(dm.ai_checklist_tick({"key": key, "done": True}) == {"key": key, "done": True}, "a tick is taken")
    check(dm.ai_requests_status()["requests"][0]["checklist"][1]["done"] is True, "and the next read shows it ticked")
    check(dm.ai_checklist_tick({"key": key, "done": False}) == {"key": key, "done": False} and dm.ai_requests_status()["requests"][0]["checklist"][1]["done"] is False, "and unticking works")
    for bad in ({"key": "nope", "done": True}, {"key": 5, "done": True}, {"done": True}, {"key": "../x", "done": True}):
        try:
            dm.ai_checklist_tick(bad)
            check(False, f"MUST-FAIL guard: {bad!r} is refused")
        except dm.Problem:
            check(True, f"MUST-FAIL guard: {bad!r} is refused")
    check(dm.ai_checklist_tick({"key": key, "done": "yes"}) == {"key": key, "done": False}, "only a real yes ticks (the word 'yes' does not)")
    dm.STATE["airq"] = FakeAirq([RQ._clean({"project_id": PID, "title": "t", "request": {"phrase": "plain", "search": "every"}})])
    check("checklist" not in dm.ai_requests_status()["requests"][0], "a request with no checklist is shown as before")
    page = dm.JS
    check("/api/ai-checklist" in page and "Ryagram downloads nothing: put the files" in page and "'ck-' + c.key" in page, "the page draws the checklist, ticks through its own route, and says Ryagram downloads nothing")
    check("ai-checklist" in dm.ENDPOINTS, "the route is one of the page's own routes")
    js = page[page.index("function drawRequests"):page.index("async function drawLive")]
    check("innerHTML" not in js and "insertAdjacentHTML" not in js, "the checklist is drawn with text nodes only, never as markup")
    check(re.search(r"https?://", js) is None, "the card draws no link and loads nothing from the internet")
finally:
    for j in list(tmp.rglob("Linked")):
        try:
            os.rmdir(j)
        except OSError:
            pass
    shutil.rmtree(tmp, ignore_errors=True)
print()
print("RESULT: " + ("PASS" if not FAILED else f"FAIL ({len(FAILED)})"))
sys.exit(1 if FAILED else 0)
