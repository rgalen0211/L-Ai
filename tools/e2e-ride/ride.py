"""THE COMPILATION RIDE, end to end, LOCAL ONLY (NEXT-CONNECT 116). Run it with run.ps1 (the same arguments as the r9 harness). Nothing is live, no credit is spent, nothing leaves 127.0.0.1.

A brand-new invited test person (1) signs in on their PC, (2) connects an AI through the connector, (3) asks it for "every time <phrase> is said", (4) points the maker at a whole FOLDER of their own
videos, (5) plans, (6) turns song mode on, (7) edits in the shared workspace (a picture rule, a text, clean cuts, the speaker step), (8) previews in the browser's player, (9) builds on their OWN PC,
(10) gets the delivery link. One step function each; every step prints PASS / FAIL / COVERED with the seconds it took and a plain-words reason. By default the ride STOPS at the first FAIL; with
--keep-going it carries on (the steps that need nothing from the broken one) so the report can list every broken step.

What is REAL: the Postgres schema and functions (migrations + r9 node SQL), the node function code under Deno, the app's sign-in and node loop, the connector's own code (its in-memory stand-in world),
the maker (tools/desktop_maker.py + maker_edit/maker_song) over HTTP, the engine (plan, folders, overlays, build-edit) with real ffmpeg on small synthetic clips, decoded frames.
What is FAKE (named again in the report): the speech model (known word times), the website's Approve (done in SQL as the person), invite redemption (an admin sets the tester flag), Storage (loopback),
the operating system's folder and picture dialogs (replaced by one function each), the connector's OAuth consent (covered by tools/connect_e2e.mjs on the PROOF project, not repeated here).

    powershell -File run.ps1 ...        [--keep-going]
"""
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
import wave
from pathlib import Path
from types import SimpleNamespace

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "r9-e2e"))
KEEP_GOING = "--keep-going" in sys.argv
import e2e  # noqa: E402  (prints and checks the heads under test; refuses a dirty checkout)
import numpy as np  # noqa: E402

APP_REPO, ENGINE = e2e.APP_REPO, e2e.ENGINE
RESULTS = []                        # (n, title, status, seconds, reason)
CTX = {}
FAKES = ["the speech model (known word times, no model download)", "the website's Approve (done in SQL as the person)", "invite redemption (an admin sets the tester flag)",
         "Storage (a loopback stand-in)", "the operating system's folder and picture dialogs (one replaced function each)", "the connector's OAuth consent (tools/connect_e2e.mjs covers it on the PROOF project)",
         "the live project, its roles, secrets and pooler"]
SR = 44100
TABLES = {"a.mp4": [("great", 200, 700), ("news", 800, 1300), ("today", 1500, 2000)],
          "b.mp4": [("great", 100, 600), ("news", 700, 1200), ("everyone", 1400, 2100)],
          "more/c.mp4": [("so", 100, 400), ("great", 500, 1000), ("news", 1100, 1600)]}
PHRASE = "great news"


class Fail(Exception):
    """A step that did not work, in the words the report uses."""


class Covered(Exception):
    """A step proven by another check that is not repeated here."""


def step(n, title):
    def deco(fn):
        def run():
            t0 = time.time()
            try:
                note = fn() or ""
                status, why = "PASS", note
            except Covered as e:
                status, why = "COVERED", str(e)
            except Fail as e:
                status, why = "FAIL", str(e)
            except Exception as e:                                                          # noqa: BLE001
                status, why = "FAIL", f"the step crashed: {type(e).__name__}: {str(e)[:300]}"
            RESULTS.append((n, title, status, round(time.time() - t0, 1), why))
            print(f"[{status}] step {n}: {title}  ({RESULTS[-1][3]} s)\n        {why}", flush=True)
            return status
        run.n = n
        return run
    return deco


def http(method, url, headers=None, body=None, timeout=300):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, method=method, headers={**(headers or {}), **({"Content-Type": "application/json"} if body is not None else {})})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, dict(r.headers), r.read()
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read()


def jpost(base, path, body, tok):
    st, _h, b = http("POST", base + path, tok, body)
    try:
        return st, json.loads(b)
    except ValueError:
        return st, b


def jget(base, path, tok):
    st, _h, b = http("GET", base + path, tok)
    try:
        return st, json.loads(b)
    except ValueError:
        return st, b


def make_mp4(path, words, secs=2.6):
    path.parent.mkdir(parents=True, exist_ok=True)
    x = np.zeros(int(secs * SR), dtype=np.float32)
    for i, (_w, s, e) in enumerate(words):
        t = np.arange(int((e - s) * SR / 1000)) / SR
        x[int(s * SR / 1000):int(s * SR / 1000) + len(t)] += (0.4 * np.sin(2 * np.pi * (300 + 150 * i) * t)).astype(np.float32)
    wav = path.with_suffix(".wav")
    with wave.open(str(wav), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes((np.clip(x, -1, 1) * 32767).astype("<i2").tobytes())
    subprocess.run([shutil.which("ffmpeg"), "-v", "error", "-y", "-f", "lavfi", "-i", f"color=c=0x203878:s=640x360:r=30:d={secs}", "-i", str(wav), "-t", str(secs), "-c:v", "libx264", "-pix_fmt", "yuv420p",
                    "-c:a", "aac", str(path)], check=True)
    wav.unlink()


def frame_magenta(film, t):
    r = subprocess.run([shutil.which("ffmpeg"), "-v", "error", "-ss", f"{t:.3f}", "-i", str(film), "-frames:v", "1", "-vf", "scale=64:36", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], capture_output=True)
    c = np.frombuffer(r.stdout, dtype=np.uint8).reshape(36, 64, 3).astype(int)[18, 32]
    return bool(c[0] > 190 and c[2] > 190 and c[1] < 70)


# ============================================================================================== the site: Postgres + the node function + the gateway (the r9 harness's own pieces)
def site_up():
    e = e2e
    CTX["pgbase"] = Path(tempfile.mkdtemp(prefix="ryagram-pg-ride-"))
    CTX["appfolder"] = Path(tempfile.mkdtemp(prefix="ride-app-"))
    srv = e.pgserver.get_server(CTX["pgbase"], cleanup_mode="stop")
    CTX["pg"] = srv
    with e.psycopg.connect(srv.get_uri(), autocommit=True) as c:
        c.execute("create database ride")
    uri = srv.get_uri(database="ride")
    CTX["uri"] = uri
    with e.psycopg.connect(uri, autocommit=True) as c:
        c.execute((e.core.ROOT / "tests" / "supabase_stub.sql").read_text(encoding="utf-8"))
        for p in e.schema_files(e.core):
            c.execute(p.read_text(encoding="utf-8"))
        c.execute("insert into auth.users (id, email) values (%s,'worker@x'),(%s,'sam@example.test'),(%s,'admin@x')", (e.WORKER, e.SAM, e.ADMIN))
        c.execute("insert into public.workers (user_id, name) values (%s, 'house-pc')", (e.WORKER,))
        c.execute("insert into public.app_admins (user_id) values (%s)", (e.ADMIN,))
        c.execute("update public.ops_settings set auto_render = true, default_credits_per_day = 100000")
        c.execute("insert into public.credit_dataset_shapes (dataset, shape, noted_by) values (%s, 'standard', 'test') on conflict do nothing", (e.STORY["dataset"],))
        c.execute(e.psycopg.sql.SQL("alter role node_runner login password {}").format(e.psycopg.sql.Literal(e.DBPASS)))
    u = e.urlparse(srv.get_uri())
    e.State.admin_conn = e.psycopg.connect(uri, autocommit=True)
    e.State.bridge_conn = e.psycopg.connect(host=u.hostname, port=u.port, dbname="ride", user="node_runner", password=e.DBPASS, autocommit=True, row_factory=e.dict_row)
    gateway = e.Gateway(("127.0.0.1", 0), e.make_handler(e.State))
    CTX["gateway"] = gateway
    gport = gateway.server_address[1]
    threading.Thread(target=gateway.serve_forever, daemon=True).start()
    import socket
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    dport = s.getsockname()[1]
    s.close()
    e.State.deno_port = dport
    env = dict(os.environ, PORT=str(dport), BRIDGE_URL=f"http://127.0.0.1:{gport}/__bridge/q", SUPABASE_URL=f"http://127.0.0.1:{gport}", NODE_UPLOAD_KEY=e.KEY,
               NODE_APPROVAL_URL=f"http://127.0.0.1:{gport}/app", NODE_SALT="ride-salt", FN_ROOT=(APP_REPO / "supabase" / "functions").as_uri())
    deno = subprocess.Popen(["deno", "run", "--no-lock", "--allow-net=127.0.0.1", "--allow-env=PORT,BRIDGE_URL,SUPABASE_URL,NODE_UPLOAD_KEY,NODE_APPROVAL_URL,NODE_SALT,FN_ROOT", f"--allow-read={APP_REPO}",
                             str(e.HARNESS / "serve.ts")], env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    CTX["deno"] = deno
    if "LISTENING" not in deno.stdout.readline():
        raise Fail("the node function did not start under Deno")
    CTX["site"] = f"http://127.0.0.1:{gport}/functions/v1/node"
    CTX["gport"] = gport


@step(1, "an invited test person signs in on their PC (a code on screen, approved on the website, the token kept on the PC only)")
def s1_sign_in():
    e = e2e
    site_up()
    admin = e.core.Db(CTX["uri"])
    admin.as_(e.ADMIN).one("select admin_set_local_compute(%s, true, 'ride')", e.SAM)
    store = e.si.MemoryStore()
    app = e.si.SignIn(CTX["site"], store, CTX["appfolder"], computer_name="Sam-PC", log=lambda _m: None)
    st = app.begin()
    if not re.match(r"^[A-Z2-9]{4}-[A-Z2-9]{4}$", st.get("user_code", "")):
        raise Fail(f"the app did not show a code ({st})")
    e.core.Db(CTX["uri"]).as_(e.SAM).one("select device_decide(%s, true)", st["user_code"])
    time.sleep(5.5)
    st2 = app.poll()
    if st2.get("state") != "signed_in":
        raise Fail(f"after the approval the app is not signed in ({st2.get('state')})")
    gate = app.gate()
    if not (gate["node"] and gate["clip_films"]):
        raise Fail(f"the account is not flagged for the node and clip films ({gate})")
    CTX["app"] = app
    return f"code {st['user_code']} approved as the test person; signed in as {st2['email']} (masked); the account may run films on its own PC"


@step(2, "the person connects an AI through the connector (initialize, the tools it is given, who am I)")
def s2_connector():
    r = subprocess.run(["deno", "run", "--no-lock", f"--allow-read={APP_REPO}", str(HERE / "connector.ts")], capture_output=True, text=True, timeout=120, cwd=APP_REPO)
    try:
        out = json.loads(r.stdout.strip().splitlines()[-1])
    except Exception:                                                                          # noqa: BLE001
        raise Fail("the connector stand-in did not answer: " + (r.stderr or r.stdout)[-300:])
    CTX["tools"] = out["tools"]
    if out["init"] != 200 or out["server"] != "ryagram" or not out["whoOk"]:
        raise Fail(f"the AI could not connect and ask who it is ({out['init']}, {out['server']}, ok={out['whoOk']})")
    return "the AI connects and asks who it is; it is given: " + ", ".join(t["name"] for t in out["tools"]) + ". (OAuth consent is covered by tools/connect_e2e.mjs on the PROOF project.)"


@step(3, f"the person asks the AI for \"every time {PHRASE} is said\" (a tool the AI can use to ask for a compilation)")
def s3_ai_asks():
    tools = CTX.get("tools")
    if tools is None:
        raise Fail("step 2 did not run, so there is no tool list to look in")
    words = ("compilation", "supercut", "phrase", "clips", "folder", "videos", "montage")
    hits = [t["name"] for t in tools if any(w in (t["name"] + " " + t["description"]).lower() for w in words)]
    if not hits:
        raise Fail("the AI is given only data-film tools (" + ", ".join(t["name"] for t in tools) + "). None of them takes a phrase, a folder or a request for a compilation, so the AI cannot ask for this film. "
                   "SMALLEST FIX: one write tool, set_compilation_request {phrase, mode, note}, that saves the request on the person's project (data only, no media); the maker reads it when it is signed in.")
    return "tools that mention it: " + ", ".join(hits)


# ============================================================================================== the maker, in this process, over HTTP, with the real engine
def maker_up():
    sys.path.insert(0, str(APP_REPO / "tools"))
    import importlib.util
    spec = importlib.util.spec_from_file_location("desktop_maker", APP_REPO / "tools" / "desktop_maker.py")
    dm = importlib.util.module_from_spec(spec)
    sys.modules["desktop_maker"] = dm
    spec.loader.exec_module(dm)
    import maker_edit as me
    import maker_song as ms
    tmp = Path(tempfile.mkdtemp(prefix="ride-maker-"))
    CTX["tmp"] = tmp
    eng = tmp / "engine"
    shutil.copytree(ENGINE / "ryagram", eng / "ryagram", ignore=shutil.ignore_patterns("__pycache__"))
    try:
        import yaml                                                                            # noqa: F401
    except ImportError:                                                                        # this test python has no PyYAML (the portable app's Python ships it): lend the engine the harness's shim
        for d in os.environ.get("PYTHONPATH", "").split(os.pathsep):
            if d and (Path(d) / "yaml").is_dir():
                shutil.copytree(Path(d) / "yaml", eng / "yaml")
                if (Path(d) / "_yaml").is_dir():
                    shutil.copytree(Path(d) / "_yaml", eng / "_yaml")
                break
    media = tmp / "My Videos"                                                                      # the person's own folder, with a sub-folder
    for n, w in TABLES.items():
        make_mp4(media / n, w)
    png = tmp / "pic.png"
    subprocess.run([shutil.which("ffmpeg"), "-v", "error", "-y", "-f", "lavfi", "-i", "color=c=0xff00ff:s=200x100", "-frames:v", "1", str(png)], check=True)
    (tmp / "recipes").mkdir()
    srv = dm.make_server(eng, tmp / "recipes", tmp / "work", tmp / "films", port=0, token="ridetoken")
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    CTX.update(dm=dm, me=me, ms=ms, media=media, png=png, msrv=srv, base=f"http://127.0.0.1:{dm.STATE['port']}", tok={"X-Maker-Token": "ridetoken"}, picks={"folder": None, "image": None, "songfolder": None})
    dm.pick_folder_path = lambda: CTX["picks"]["folder"]
    me.pick_image_dialog = lambda: CTX["picks"]["image"]
    ms.pick_folder_dialog = lambda: CTX["picks"]["songfolder"]
    me.attach(dm)
    ms.attach(dm)
    dm.STATE["edit_on"] = True
    dm.STATE["song_on"] = True


@step(4, "the person points the maker at a whole FOLDER of their own videos (one folder, sub-folders included, nothing uploaded)")
def s4_folder():
    maker_up()
    dm, base, tok = CTX["dm"], CTX["base"], CTX["tok"]
    CTX["picks"]["folder"] = str(CTX["media"])
    st, r = jpost(base, "/api/pick-folder", {}, tok)
    if st != 200 or (r.get("found"), r.get("used")) != (3, 3):
        raise Fail(f"the maker did not read the folder: {st} {r}")
    body = {"recipe": "great-news.json", "model": "base", "binds": {"source-1": [str(CTX["media"])]}}
    CTX["check_body"] = body
    return f"{r['message']}"


@step(5, f"the maker plans \"every time {PHRASE} is said\" across the folder (words found in all three videos, in the engine's own order)")
def s5_plan():
    dm = CTX["dm"]
    E = dm.STATE["E"]
    from ryagram.library import transcribe as T

    class Fake:
        def transcribe_file(self, p, mid, language=None):
            rel = Path(p).resolve().relative_to(CTX["media"].resolve()).as_posix()
            return SimpleNamespace(words=[T.Word(mid, i, w, w, s, e - s) for i, (w, s, e) in enumerate(TABLES[rel])], language="en", audio_ms=2600)
    recipe = dm.STATE["R"].validate_recipe({"schema": "ryagram.recipe/0", "name": PHRASE, "slots": [{"id": "source-1", "label": "Videos", "accepts": "video", "multiple": True}],
                                            "find": {"op": "every", "text": PHRASE, "unit": "words", "slots": ["source-1"]},
                                            "select": {"min_length": 1, "max_length": 2, "min_seconds": 0.05, "max_seconds": 4.0}, "arrange": {"order": "text", "join": "cut", "crossfade_ms": 0},
                                            "effects": {"padding": {"lead_ms": 60, "trail_ms": 60}}, "render": {"preset": "720p30", "crf": 28}})
    binds, info = E.expand_folder("source-1", CTX["media"])
    plan = json.loads(json.dumps(E.plan(recipe, {"source-1": binds}, CTX["tmp"] / "planwork", model="base", log=lambda _m: None, transcriber_factory=lambda _m: Fake())))
    clips = plan.get("clips") or []
    if len(clips) < 3:
        raise Fail(f"the plan found {len(clips)} clip(s) for '{PHRASE}' in three videos that each say it")
    dm.STATE["last_plan"] = plan
    dm.STATE["last_plan_args"] = [f"source-1={b.path}" for b in binds]
    CTX["plan"] = plan
    return f"{len(clips)} clips, from {len({c['file_name'] for c in clips})} different videos (the speech model is a fake with known word times)"


@step(6, "song mode is on: the song page opens and takes the same folder")
def s6_song():
    base, tok = CTX["base"], CTX["tok"]
    st, _h, body = http("GET", f"{base}/song?t=ridetoken")
    if st != 200:
        raise Fail(f"the song page did not open ({st})")
    CTX["picks"]["songfolder"] = str(CTX["media"])
    st, r = jpost(base, "/api/song/folder", {}, tok)
    names = [v["file_name"] for v in (r.get("videos") or [])] if isinstance(r, dict) else []
    if st != 200 or len(names) != 3 or str(CTX["media"]) in json.dumps(r):
        raise Fail(f"the song page did not take the folder by name ({st}, {names})")
    raise Covered(f"the page opens and lists the folder's {len(names)} videos by folder-relative name, no path. Building a song (tune, alignment, the forged word) is proven by tools/check-maker-song-wire.py "
                  "and the engine's song lanes; it is not repeated here (needs the alignment model).")


@step(7, "the person edits in the shared workspace: a picture rule, a text, then clean cuts and the speaker step")
def s7_workspace():
    me, base, tok, picks = CTX["me"], CTX["base"], CTX["tok"], CTX["picks"]
    st, r = jget(base, "/api/edit", tok)
    lst = r.get("edit") if isinstance(r, dict) else None
    if st != 200 or not lst:
        raise Fail(f"the workspace gave no rough cut after Plan ({st} {r})")
    picks["image"] = str(CTX["png"])
    st, r = jpost(base, "/api/image/pick", {}, tok)
    img = r.get("image") if isinstance(r, dict) else None
    if st != 200 or not img:
        raise Fail(f"the picture was not taken ({st} {r})")
    edit = json.loads(json.dumps(lst))
    edit["images"] = [{**img, "rights_ticked": True}]
    edit["rules"] = [{"id": "r1", "phrase": PHRASE, "image_id": img["id"], "seconds": 0.5, "mode": "full", "fade_s": 0.1}]
    edit["texts"] = [{"id": "t1", "text": "Great news, everyone", "start_s": 0.0, "length_s": 1.0, "position": "bottom", "size": "large"}]
    st, r = jpost(base, "/api/edit", {"edit": edit}, tok)
    if st != 200:
        raise Fail(f"the list was not saved ({st} {r})")
    CTX["edit"] = edit
    problems = []
    src = " ".join((APP_REPO / "tools" / f).read_text(encoding="utf-8", errors="replace") for f in ("maker_edit.py",)) + " ".join(p.read_text(encoding="utf-8", errors="replace") for p in (APP_REPO / "tools" / "maker-edit").glob("*.js"))
    if not re.search(r"clean[ _-]?cut", src, re.I):
        problems.append("CLEAN CUTS have no switch in the workspace or in the edit list: the engine turns them on only when RYAGRAM_CLEAN_CUTS=1 is in the environment of the program (editbuild.py:229), "
                        "so a person cannot turn them on. SMALLEST FIX: an option 'clean_cuts' (on/off) in the shared options list and the edit list, and maker_edit passing it to build-edit as that variable.")
    if not re.search(r"speaker", src, re.I):
        problems.append("the SPEAKER STEP is a command-line tool (tools/faces_speaker_filter.py / faces_speaker_step.py) and is not reachable from the maker or the workspace: no route, no button, no field in the list. "
                        "SMALLEST FIX: FACES' step 1 as a maker route (pick a reference voice, keep the clips where that voice speaks) that edits the list's clips, plus a switch in the workspace.")
    if problems:
        raise Fail("the picture rule and the text are in the list and saved, but: " + " | ".join(problems))
    return "picture rule, text, clean cuts and speaker step are all in the workspace"


@step(8, "the person previews in the browser's player (the clips joined small, with Range so the player can seek)")
def s8_preview():
    base, tok = CTX["base"], CTX["tok"]
    edit = CTX.get("edit")
    if edit is None:
        raise Fail("step 7 did not save a list, so there is nothing to preview")
    st, r = jpost(base, "/api/edit/proxy", {"edit": edit}, tok)
    if st != 200 or r.get("state") != "ready":
        raise Fail(f"the preview did not get ready ({st} {r})")
    st, h, b = http("GET", base + r["url"], None)
    pf = CTX["tmp"] / "proxy-copy.mp4"
    pf.write_bytes(b)
    info = subprocess.run([shutil.which("ffmpeg"), "-hide_banner", "-i", str(pf)], capture_output=True, text=True).stderr
    st2, h2, b2 = http("GET", base + r["url"], {"Range": "bytes=0-99"})
    if st != 200 or "640x360" not in info or st2 != 206:
        raise Fail(f"the preview file is not a seekable 360p video ({st}, {st2})")
    return f"a seekable 640x360 preview of {len(b)} bytes. (The edit page itself, in real Chrome, is walked by tools/check-maker-edit-wire.py.)"


@step(9, "the maker builds the film on the person's OWN PC from the edited list (picture on the phrase, the text, real cuts, nothing uploaded)")
def s9_build():
    base, tok = CTX["base"], CTX["tok"]
    edit = CTX.get("edit")
    if edit is None:
        raise Fail("step 7 did not save a list")
    before = {k: v for k, v in os.environ.items() if k.startswith("RYAGRAM_CLEAN")}
    st, r = jpost(base, "/api/edit/render", {"edit": edit}, tok)
    film = CTX["tmp"] / "films" / (r.get("film") or "none") if isinstance(r, dict) else None
    if st != 200 or not film or not film.is_file():
        raise Fail(f"the film was not built ({st} {r})")
    rc = json.loads(film.with_suffix(".receipt.json").read_text(encoding="utf-8"))
    occ = rc["overlays"]["rules"][0]
    if occ["times"] < 3 or not frame_magenta(film, occ["at"][0]["start_s"] + 0.25):
        raise Fail(f"the picture is not on the decoded film at the phrase ({occ['times']} times found)")
    if str(CTX["media"]) in json.dumps(rc):
        raise Fail("the receipt holds a place on this computer")
    CTX["film"] = film
    CTX["built_with_clean_env"] = False
    # the probe a real clean-cuts switch would use: the SAME list built with the engine's variable on, to show the fix is only wiring
    os.environ["RYAGRAM_CLEAN_CUTS"] = "1"
    try:
        st2, r2 = jpost(base, "/api/edit/render", {"edit": edit}, tok)
        CTX["built_with_clean_env"] = st2 == 200
    finally:
        os.environ.pop("RYAGRAM_CLEAN_CUTS", None)
    return (f"{r['message']} The phrase was found {occ['times']} times; the picture is on the decoded frame; the receipt has names only. "
            f"(Probe: the same list builds with RYAGRAM_CLEAN_CUTS=1 set: {'yes' if CTX['built_with_clean_env'] else 'NO'}.)")


@step(10, "the person gets the delivery link for the film they built")
def s10_delivery():
    e = e2e
    if "uri" not in CTX:
        raise Fail("step 1 did not run, so there is no site to ask")
    kinds = [r[0] for r in e.State.admin_conn.execute("select unnest(enum_range(null::public.job_type))::text").fetchall()]
    node_kinds = re.search(r"KINDS = \[([^\]]*)\]", (APP_REPO / "supabase" / "functions" / "node-core" / "router.ts").read_text(encoding="utf-8"))
    film = CTX.get("film")
    if film is None:
        raise Fail("step 9 built no film")
    if not any("compil" in k or "clip" in k or "edit" in k for k in kinds):
        raise Fail(f"the site has no place for this film. Job types: {', '.join(kinds)}; none is a compilation. The node loop only takes SITE jobs (a story the worker validates), and the maker never creates "
                   f"a site job for a film built from the person's clips, so the finished film is never registered as an artifact and no delivery link can exist. It stays in the films folder on the PC. "
                   f"SMALLEST FIX (needs Ryan's decision first, it adds a job type and a site table): a 'local_compilation' job the maker creates when signed in, whose only artifacts are a "
                   f"preview poster and the receipt text (names only, never the person's footage), so the site can show a delivery page without ever holding the clips.")
    return "a job type for compilations exists"


STEPS = [s1_sign_in, s2_connector, s3_ai_asks, s4_folder, s5_plan, s6_song, s7_workspace, s8_preview, s9_build, s10_delivery]


def cleanup():
    e = e2e
    for what, fn in [("deno", lambda: CTX.get("deno") and CTX["deno"].terminate()), ("gateway", lambda: CTX.get("gateway") and CTX["gateway"].shutdown()), ("maker", lambda: CTX.get("msrv") and CTX["msrv"].shutdown()),
                     ("bridge", lambda: e.State.bridge_conn and e.State.bridge_conn.close()), ("admin", lambda: e.State.admin_conn and e.State.admin_conn.close()),
                     ("postgres", lambda: CTX.get("pg") and CTX["pg"].cleanup())]:
        try:
            fn()
        except Exception as ex:                                                                  # noqa: BLE001
            print("  cleanup", what, type(ex).__name__)
    for k in ("pgbase", "appfolder", "tmp"):
        if CTX.get(k):
            shutil.rmtree(CTX[k], ignore_errors=True)


def main():
    stopped = None
    try:
        for fn in STEPS:
            if stopped and not KEEP_GOING:
                RESULTS.append((fn.n, "(not run)", "SKIPPED", 0.0, f"stopped at step {stopped}"))
                continue
            status = fn()
            if status == "FAIL" and stopped is None:
                stopped = fn.n
    finally:
        print("\ncleaning up (my own processes by PID, my own folders)")
        cleanup()
    print("\n=== THE RIDE ===")
    for n, title, status, secs, why in RESULTS:
        print(f"{n:>2}. {status:<8} {secs:>6} s  {title}")
    print("\nSTILL FAKE: " + "; ".join(FAKES) + ".")
    bad = [r for r in RESULTS if r[2] == "FAIL"]
    out = os.environ.get("RIDE_JSON")
    if out:
        Path(out).write_text(json.dumps({"results": RESULTS, "fakes": FAKES}, indent=1), encoding="utf-8")
    print(f"\n{len(bad)} step(s) FAILED" if bad else "\nthe whole ride works")
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
