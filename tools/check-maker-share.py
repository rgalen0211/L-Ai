"""'Share this film as a recipe', 'Use a recipe from a file' and 'Blur faces I haven't named' in the desktop maker (NEXT-CONNECT 149; WORKER 46 found the engine side unreachable from the app).

    py -I tools/check-maker-share.py <Ryagram checkout with ryagram/recipe/export.py and ryagram/local/bystander.py> <scratch base folder on D:>

The REAL tools/maker_edit.py and tools/desktop_maker.py functions, the engine's own recipe, export, portability and bystander modules, a small fake face finder (the real one is a model file the app does not
have yet). No video is made, no network, no dialog opens: the file dialog is replaced by the path a person would have picked. Scratch is deleted at the end."""
import hashlib
import json
import os
import shutil
import sys
import tempfile
import types
from pathlib import Path

HERE = Path(__file__).resolve().parent
ENGINE = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else None
if ENGINE is None or not (ENGINE / "ryagram" / "recipe" / "export.py").is_file() or not (ENGINE / "ryagram" / "local" / "bystander.py").is_file():
    print("usage: check-maker-share.py <Ryagram checkout that has recipe/export.py and local/bystander.py> <scratch base folder on D:>")
    sys.exit(2)
sys.path[:0] = [str(HERE), str(ENGINE)]
import desktop_maker as DM  # noqa: E402
import maker_edit as ME  # noqa: E402
from ryagram import recipe as R  # noqa: E402
from ryagram.local import editbuild as EB  # noqa: E402

FAILED = []


def check(ok, what):
    if isinstance(ok, str):                                            # (what, ok) written the other way round
        ok, what = what, ok
    print(("  ok   " if ok else "  FAIL ") + what)
    if not ok:
        FAILED.append(what)


def problem_of(fn):
    try:
        fn()
    except (ME.Problem, DM.Problem) as e:
        return str(e)
    return None


base_dir = Path(sys.argv[2]) if len(sys.argv) > 2 else Path(tempfile.gettempdir())
tmp = Path(tempfile.mkdtemp(prefix="share-", dir=str(base_dir)))
os.environ.pop("RYAGRAM_MODEL_DIR", None)
try:
    work, out, recipes = tmp / "work", tmp / "films", tmp / "recipes"
    for d in (work, out, recipes, tmp / "engine" / "ryagram"):
        d.mkdir(parents=True)
    shutil.copy(ENGINE / "recipes" / "sam-first.json", recipes / "sam-first.json")
    shutil.copy(ENGINE / "recipes" / "every-time.json", recipes / "every-time.json")
    DM.STATE.update(engine=tmp / "engine", recipes=recipes, work=work, out=out, R=R, edit_on=True, live_on=False, job=None, last_film=None, last_recipe=None, last_plan=None)
    DM.STATE.pop("edit", None)
    ME.attach(DM)
    base = json.loads((recipes / "sam-first.json").read_text(encoding="utf-8-sig"))

    def w(word, s):
        return {"w": word, "s": s, "e": s + 0.3}

    def clip(cid, a, b, words):
        return {"id": cid, "file_name": "show.mp4", "in_s": a, "out_s": b, "join": {"kind": "cut", "s": 0}, "words": words}

    edit = {"schema": EB.SCHEMA, "mode": "compilation", "film": {"width": 1280, "height": 720, "fps": 30}, "seq": 3,
            "clips": [clip("c2", 10.0, 12.0, [w("great", 10.2), w("news", 10.6)]), clip("c1", 2.0, 4.0, [w("well", 2.1), w("that", 2.5), w("is", 2.9)]), clip("c3", 20.0, 22.0, [w("for", 20.2), w("everyone", 20.6)])],
            "images": [], "rules": [], "texts": [{"text": "Day one", "start_s": 1.0, "length_s": 3.0, "position": "top"}], "captions": {"on": True, "size": "medium", "position": "bottom"},
            "look": {"theme": "dark"}, "music": None}

    # ---- 1. share as a recipe
    check("Build a final film" in (problem_of(lambda: ME.share_recipe({})) or ""), "before any film is built the button says what to do first")
    (work / "edit").mkdir()
    (work / "edit" / "committed-edit.json").write_text(json.dumps(edit), encoding="utf-8")
    DM.STATE["last_film"] = str(out / "edit-20261027-120000.mp4")
    check("with a film but no Plan in this run it asks for a Plan", "Press Plan first" in (problem_of(lambda: ME.share_recipe({})) or ""))
    DM.STATE["last_recipe"] = base
    got = ME.share_recipe({})
    f = out / got["file"]
    shared = json.loads(f.read_text(encoding="utf-8"))
    check(f.name == "edit-20261027-120000.recipe.json" and f.parent == out, "the recipe is saved beside the films, named after the film")
    check(shared["find"]["text"] == "great news well that is for everyone", "it holds the person's words in the EDITED order")
    check(R.parse_recipe(f.read_bytes())["name"] == shared["name"], "the engine reads it back as a recipe")
    blob = json.dumps(shared)
    check("show.mp4" not in blob and "Day one" not in blob and str(tmp) not in blob and "C:" not in blob, "no file name, no text from the film and no place on this computer is in it")
    check(any("texts on the film are not shared" in n for n in got["notes"]), "the notes say the texts on the film are not shared")
    check("Use a recipe from a file" in got["message"], "the message tells the person what the other person does with it")
    named = ME.share_recipe({"name": "My great remix"})
    check(json.loads((out / named["file"]).read_text(encoding="utf-8"))["name"] == "My great remix", "a name typed by the person is used")
    DM.STATE["last_recipe"] = json.loads((recipes / "every-time.json").read_text(encoding="utf-8-sig"))
    check("words recipe" in (problem_of(lambda: ME.share_recipe({})) or ""), "a film made from an every-time recipe is refused in the engine's words")
    DM.STATE["last_recipe"] = base

    # ---- 2. use a recipe from a file
    friend = tmp / "from-a-friend"
    friend.mkdir()
    (friend / "pick.json").write_bytes(f.read_bytes())
    r = DM.import_recipe(str(friend / "pick.json"))
    names = [x["file"] for x in DM.list_recipes(recipes)]
    check(r["file"] in names and all(x["ok"] for x in DM.list_recipes(recipes)) and "added to your list" in r["message"], "a picked recipe file is checked, copied into the recipes folder and shows in the list")
    again = DM.import_recipe(str(friend / "pick.json"))
    check(again["file"] == r["file"] and "already in your list" in again["message"], "picking the same file again does not make a second copy")
    other = dict(shared, find=dict(shared["find"], text="great news well that is"))
    (friend / "pick2.json").write_text(json.dumps(other), encoding="utf-8")
    r2 = DM.import_recipe(str(friend / "pick2.json"))
    check(r2["file"] != r["file"] and (recipes / r["file"]).exists() and (recipes / r2["file"]).exists(), "a different recipe with the same name gets its own file, the first is not replaced")
    check(DM.import_recipe("") == {"file": None}, "closing the dialog changes nothing")
    (friend / "bad.json").write_text("{not json", encoding="utf-8")
    check("not a recipe" in (problem_of(lambda: DM.import_recipe(str(friend / "bad.json"))) or ""), "a damaged file is refused in words and nothing is added")
    leaky = json.loads(json.dumps(shared))
    leaky["name"] = "best of S02E08"                                          # the recipe rules accept this name; the portability check does not
    (friend / "leaky.json").write_text(json.dumps(leaky), encoding="utf-8")
    check(problem_of(lambda: DM.import_recipe(str(friend / "leaky.json"))) is not None, "a recipe that names a place on a computer or an episode is refused by the portability check")
    (friend / "notrecipe.json").write_text(json.dumps({"name": "hello", "x": 1}), encoding="utf-8")
    check("not a recipe" in (problem_of(lambda: DM.import_recipe(str(friend / "notrecipe.json"))) or ""), "valid JSON that is not a recipe is refused by the engine's own rules")
    check("episode" in (problem_of(lambda: DM.import_recipe(str(friend / "leaky.json"))) or "").lower() or "not added" in (problem_of(lambda: DM.import_recipe(str(friend / "leaky.json"))) or ""), "the refusal of a tied-to-one-show recipe is in words")
    import importlib
    saved_portable = sys.modules.get("ryagram.recipe.portable")
    saved_attr = getattr(R, "portable", None)
    if saved_attr is not None:
        delattr(R, "portable")
    sys.modules["ryagram.recipe.portable"] = None                     # an import of it now raises ImportError, as in a kit that left it out
    (friend / "fine.json").write_text(json.dumps(dict(shared, name="A fine one")), encoding="utf-8")
    refused_blind = problem_of(lambda: DM.import_recipe(str(friend / "fine.json")))
    check("cannot check recipe files" in (refused_blind or "") and not any(p.name.startswith("a-fine-one") for p in recipes.iterdir()), "without the portability check in the kit, a recipe is refused in words and NOT added (never fail open)")
    if saved_attr is not None:
        R.portable = saved_attr
    if saved_portable is not None:
        sys.modules["ryagram.recipe.portable"] = saved_portable
    else:
        del sys.modules["ryagram.recipe.portable"]
    check(problem_of(lambda: DM.import_recipe(str(friend / "missing.json"))) is not None, "a file that is not there is refused")
    before = sorted(p.name for p in recipes.iterdir())
    check("pick.json" not in before and (friend / "pick.json").exists(), "the picked file itself is only read")

    # ---- 3. blur faces I haven't named
    st = ME.blur_state()
    check(st["available"] is False and st["on"] is False and "does not have the face finder" in st["message"], "with no face finder file the switch is off and says why")
    check("face finder" in (problem_of(lambda: ME.set_blur({"on": True})) or "") and ME.blur_state()["on"] is False, "switching it on without the file is refused")
    models = tmp / "models"
    models.mkdir()
    (models / "face_detection_yunet_2023mar.onnx").write_bytes(b"not a real model")
    os.environ["RYAGRAM_MODEL_DIR"] = str(models)
    stw = ME.blur_state()
    check(stw["available"] is False and "not the one this app was built with" in stw["message"], "MUST-FAIL: a file with a yunet name that is NOT the pinned one is never used, and the switch says so")
    check("face finder" in (problem_of(lambda: ME.set_blur({"on": True})) or ""), "and the switch cannot be turned on with it")
    ME.YUNET_SHA256 = hashlib.sha256(b"not a real model").hexdigest()                            # the stand-in below is pinned for this check only; the real pin is in the maker
    check(ME.blur_state()["available"] is True and ME.blur_state()["on"] is False, "with the file the switch can be used and starts off")
    check(ME.set_blur({"on": True})["on"] is True and "pixelated" in ME.blur_state()["message"] and ME.set_blur({"on": False})["on"] is False, "it can be switched on and off, and says what it does")

    from ryagram.local import bystander as BL  # noqa: E402
    from ryagram.local import bystander_detect as BD  # noqa: E402
    from ryagram.local import editbuild as EB  # noqa: E402
    (tmp / "show.mp4").write_bytes(b"x")
    ME.S()["media_items"] = [str(tmp / "show.mp4")]
    scanned = []
    BL.video_size = lambda ff, p: (1280, 720)
    BD.load_session = lambda m: "session"
    import numpy as np  # noqa: E402
    BL.scan = lambda session, ff, p, a, b, frame, **k: scanned.append((a, b)) or [{"id": "t1", "kf": [[a, np.float32(100), np.float32(100), np.float32(80), np.float32(80)]], "n": 1, "score": np.float32(0.9)}]      # like the real finder: numpy float32, which json cannot write (WORKER 48)
    lst = json.loads(json.dumps(edit))
    lst["clips"].append({"id": "s1", "slide": {"text": "The end"}, "in_s": 0, "out_s": 2, "words": []})
    ME.set_blur({"on": False})
    check(ME._with_blur(lst) is lst, "switched off, the list is built as it is")
    ME.set_blur({"on": True})
    blurred = ME._with_blur(lst)
    specs = [c.get("bystander_blur") for c in blurred["clips"]]
    check(len(scanned) == 3 and specs[0] and specs[3] is None, "every video clip is scanned, a slide is not")
    check(all(s["on"] is True and all(t["kept"] is False and t["consent"] is False and t["name"] is None for t in s["tracks"]) for s in specs if s) and BL.blurred_tracks(specs[0]), "every face found is blurred and nobody is marked as named")
    check("bystander_blur" not in json.dumps(lst), "the person's own edit list is not changed")
    try:
        json.dumps(blurred)
        plain = True
    except TypeError:
        plain = False
    check(plain, "MUST-FAIL (WORKER 48): the face tracks a real finder returns (numpy float32) are written as plain numbers, so the list can be saved and the engine can read it")
    parsed = EB.parse_edit(ME._with_blur(edit))
    check(all(c.get("bystander_blur") and c["bystander_blur"]["on"] for c in parsed["clips"]), "the engine reads the list with the specs in it and keeps them on every clip")

    # the OTHER Build buttons cannot blur: while the switch is on they refuse in words and make nothing (WORKER 48: the main page's Build gave an unblurred film without a word)
    ME.set_blur({"on": True})
    DM.STATE["job"] = None
    said = problem_of(lambda: DM.start_job("build", {}))
    check(said is not None and "does not blur" in said and "Build final film" in said, f"MUST-FAIL: the main page's Build refuses while the switch is on, and says where blurring happens: {str(said)[:80]}")
    import maker_song as MS  # noqa: E402
    said = problem_of(lambda: MS.render({}))
    check(said is not None and "does not blur" in said, "MUST-FAIL: the song page's film button refuses while the switch is on too")
    ME.set_blur({"on": False})
    check("does not blur" not in (problem_of(lambda: DM.start_job("build", {})) or ""), "switched off, the main page's Build is not stopped by the blur rule")
    ME.set_blur({"on": True})

    # the final build uses it
    captured = {}
    ME._run_engine = lambda args: (captured.setdefault("args", args) and (0, "", "")) or (0, "", "")
    ME._claim = lambda: None
    ME._release = lambda: None
    ME._args_for_real = ME._args_for
    ME.render({"edit": edit})
    written = json.loads((work / "edit" / "render-edit.json").read_text(encoding="utf-8"))
    check(any(c.get("bystander_blur") for c in written["clips"]), "Build final film writes the blurred list for the engine to build from")
    ME.set_blur({"on": False})
    ME.render({"edit": edit})
    written = json.loads((work / "edit" / "render-edit.json").read_text(encoding="utf-8"))
    check(not any(c.get("bystander_blur") for c in written["clips"]), "switched off, the engine gets the plain list")

    # ---- 4. the page
    page = DM.page_html()
    check('id="recipe-import"' in page and 'id="share-card"' in page and 'id="blur-on"' in page and "Use a recipe from a file" in page, "the main page has the three controls")
    DM.STATE["edit_on"] = False
    check('id="share-card"' not in DM.page_html() and 'id="recipe-import"' in DM.page_html(), "without --edit the share card is absent, the recipe file button stays")
    check("current.has_find && current.op === 'words' ? current.find : ''" in DM.JS and "/api/recipes/import" in DM.JS and "/api/edit/share-recipe" in DM.JS and "/api/edit/blur" in DM.JS, "the page script is wired to the routes, and a words recipe fills the words box with its own words")
finally:
    os.environ.pop("RYAGRAM_MODEL_DIR", None)
    shutil.rmtree(tmp, ignore_errors=True)
print("RESULT: " + ("PASS" if not FAILED else f"FAIL ({len(FAILED)})"))
sys.exit(1 if FAILED else 0)
