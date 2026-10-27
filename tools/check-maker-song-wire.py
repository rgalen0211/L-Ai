"""The maker's song routes (tools/maker_song.py, NEXT-CONNECT 111b) against WEB's song page in real Chrome, local only. The engine's PLAN and BUILD run a stand-in `ryagram.local` (a copy of the
engine checkout whose __main__ builds a real song plan with the engine's own planner and view from made-up timings, writes a real tiny MP4 and a receipt, refuses a changed plan id, and can be told to
fail), so no speech model is needed; ffmpeg is real (hearing a word cuts the person's own made-up video). The operating system's file dialogs cannot be driven by a script, so the check replaces only
those two functions. Part A is the routes without a browser (token, names only, plain sentences, the plan checked again, one render at a time); part B walks the page.

    python tools/check-maker-song-wire.py <path to a Ryagram checkout that has the song modules> <outdir>
"""
import importlib.util
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
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if len(sys.argv) < 3:
    raise SystemExit('usage: python tools/check-maker-song-wire.py <a Ryagram checkout that has the song modules> <a folder for the screenshots>   (both are required, so a bare run never writes into somebody else\'s folder)')
ENGINE = Path(sys.argv[1])
OUT = Path(sys.argv[2])
sys.path.insert(0, str(ROOT / 'tools'))
spec = importlib.util.spec_from_file_location('desktop_maker', ROOT / 'tools' / 'desktop_maker.py')
dm = importlib.util.module_from_spec(spec)
sys.modules['desktop_maker'] = dm
spec.loader.exec_module(dm)
import maker_song as ms  # noqa: E402

STUB_MAIN = r'''import sys, json, os, time, hashlib, subprocess, shutil
from pathlib import Path
sys.path.insert(0, os.getcwd())
from ryagram.recipe import song_plan as SP, song_timing as ST
from ryagram.local import song_view as SV
a = sys.argv
cmd = a[1]
rec = json.loads(Path(a[2]).read_text(encoding="utf-8"))
binds = [a[i + 1].split("=", 1) for i, x in enumerate(a) if x == "--bind"]
vids = []
for s_, p_ in binds:
    if s_ == "footage-1":
        q_ = Path(p_)
        vids += sorted(f.name for f in q_.rglob("*") if f.is_file() and f.suffix.lower() in (".mp4", ".mkv", ".mov")) if q_.is_dir() else [q_.name]
music = [Path(p).name for s, p in binds if s == "music"]
guide = [Path(p).name for s, p in binds if s == "guide"]
lines = rec["song"]["lines"]
text = " ".join(lines)
if not vids:
    print("refused: slot 'footage-1' has no file: add --bind footage-1=<your video>", file=sys.stderr); sys.exit(2)
if "refuseme" in text:
    print("refused: slot 'footage-1' has no file: add --bind footage-1=<your video> (C:\\Users\\Someone\\Videos\\x.mp4)", file=sys.stderr); sys.exit(2)
if "weirdme" in text:
    print("refused: something odd happened at C:\\Users\\Someone\\v.mp4 near --bind footage-1=x", file=sys.stderr); sys.exit(2)
if "netme" in text:
    print("blocked: a network attempt was made", file=sys.stderr); sys.exit(4)
slots, n = [], 0
for li, ln in enumerate(lines, 1):
    for w in ln.split():
        slots.append(ST.Slot(n, li, w.lower().strip(".,!?"), 1000 + n * 600, 1400 + n * 600, "heard", None)); n += 1
def finder(tokens):
    if len(tokens) != 1 or tokens[0].startswith("z"):
        return []
    v = vids[sum(map(ord, tokens[0])) % len(vids)]
    return [SP.Candidate("m-" + v, v, 500, 900, tuple(tokens), "", ((500, 900),))]
plan = SP.plan_song(slots, rec["song"], finder, pad_ms=140)
who = "|".join([text] + vids + music + guide)
plan["plan_id"] = hashlib.sha256((plan["plan_id"] + who).encode()).hexdigest()[:16]
seconds = (slots[-1].end_ms / 1000.0 + 1.0) if slots else 2.0
pd = {"ok": plan["ok"], "buildable": plan["ok"], "complete": plan["complete"], "kind": "song", "plan_id": plan["plan_id"], "rows": plan["rows"], "metrics": plan["metrics"], "warnings": plan["warnings"],
      "estimated_words": plan["estimated_words"], "near_words": plan["near_words"], "found": plan["metrics"]["found"], "cut_off": plan["metrics"]["cut_off"], "forged": [], "preview_dir": None,
      "without_forged_plan_id": plan["plan_id"], "network_attempts": 0}
pd["view"] = SV.song_plan_view(pd, lines, track_name=music[0] if music else "song.wav", track_seconds=seconds, guide_name=guide[0] if guide else None)
if cmd == "plan":
    print(json.dumps(pd)); sys.exit(0 if plan["ok"] else 3)
out = Path(a[a.index("--out") + 1])
ap = a[a.index("--approve-plan") + 1] if "--approve-plan" in a else None
if not ap:
    print("refused: A song film is built only from a plan you have looked at. Plan first, check it, then build with that plan's id.", file=sys.stderr); sys.exit(2)
if ap != plan["plan_id"]:
    print("refused: The plan changed since you looked at it (different files, words or settings). Plan again, check it, then build that plan.", file=sys.stderr); sys.exit(2)
if "slowme" in text:
    time.sleep(4)
out.parent.mkdir(parents=True, exist_ok=True)
if "failme" in text:
    out.write_bytes(b"partial"); out.with_suffix(".receipt.json").write_text("{}")
    print("a cut failed in C:\\Users\\Someone\\v.mp4", file=sys.stderr); sys.exit(1)
ff = shutil.which("ffmpeg")
subprocess.run([ff, "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=duration=2:size=320x180:rate=10", "-f", "lavfi", "-i", "sine=frequency=330:duration=2", "-t", "2", "-pix_fmt", "yuv420p", "-c:a", "aac", str(out)], check=True)
out.with_suffix(".receipt.json").write_text(json.dumps({"schema": "ryagram.local-receipt/0", "kind": "song", "film": out.name, "seconds": 2.0, "plan_id": ap, "network_attempts": 0,
    "offsets": {"max_abs_ms": 12, "over_limit": [], "limit_ms": 30}, "built_from_sounds": [], "approved": ap, "argv_has_forge": "--forge" in a}))
print("built", out.name)
'''


def http(method, url, headers=None, body=None):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, method=method, headers={**(headers or {}), **({'Content-Type': 'application/json'} if body is not None else {})})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return r.status, dict(r.headers), r.read()
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read()


def jpost(base, path, body, tok):
    st, h, b = http('POST', base + path, tok, body)
    try:
        return st, json.loads(b)
    except ValueError:
        return st, b


def until(p, js, ms=60000):
    """Poll a page expression (the page's content policy forbids Playwright's string-eval wait_for_function)."""
    end = time.time() + ms / 1000
    while time.time() < end:
        if p.evaluate('() => ' + js):
            return True
        time.sleep(0.15)
    raise AssertionError('timed out waiting for: ' + js)


def mk_video(dest, hz):
    r = subprocess.run([shutil.which('ffmpeg'), '-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=duration=3:size=320x180:rate=10', '-f', 'lavfi', '-i', f'sine=frequency={hz}:duration=3', '-t', '3',
                        '-pix_fmt', 'yuv420p', '-c:a', 'aac', str(dest)], capture_output=True)
    assert r.returncode == 0, r.stderr
    return dest


def mk_wav(dest, hz=220, secs=12):
    r = subprocess.run([shutil.which('ffmpeg'), '-v', 'error', '-y', '-f', 'lavfi', '-i', f'sine=frequency={hz}:duration={secs}', str(dest)], capture_output=True)
    assert r.returncode == 0, r.stderr
    return dest


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    tmp = Path(tempfile.mkdtemp(prefix='makersong-'))
    ok = True
    errs, external = [], []

    def check(cond, what):
        nonlocal ok
        print(('  ok   ' if cond else '  FAIL ') + what)
        ok = ok and bool(cond)
    try:
        eng = tmp / 'engine'
        shutil.copytree(ENGINE / 'ryagram', eng / 'ryagram', ignore=shutil.ignore_patterns('__pycache__'))
        shutil.copytree(ENGINE / 'recipes', eng / 'recipes')
        (eng / 'ryagram' / 'local' / '__main__.py').write_text(STUB_MAIN, encoding='utf8')
        recipes = tmp / 'recipes'
        recipes.mkdir()
        shutil.copy(eng / 'recipes' / 'song-mode.json', recipes / 'song-mode.json')
        media = tmp / 'media'
        (media / 'other').mkdir(parents=True)
        v1, v2 = mk_video(media / 'walk.mp4', 330), mk_video(media / 'talk.mp4', 550)
        v1b = mk_video(media / 'other' / 'walk.mp4', 440)
        track, guide = mk_wav(media / 'my-song.wav', 220), mk_wav(media / 'my-singing.wav', 330)
        (media / 'notes.txt').write_text('not a sound')
        (media / 'fake.wav').write_text('this is text, not a wav')
        srv = dm.make_server(eng, recipes, tmp / 'work', tmp / 'films', port=0, token='testtoken')
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        port = dm.STATE['port']
        base = f'http://127.0.0.1:{port}'
        tok = {'X-Maker-Token': 'testtoken'}
        dm.faster_whisper_missing = lambda: False
        picks = {'videos': [], 'audio': None, 'folder': None}
        dm.pick_files = lambda multiple: list(picks['videos'])
        ms.pick_audio_file = lambda: picks['audio']
        ms.pick_folder_dialog = lambda: picks['folder']

        class _Bind:
            def __init__(self, p):
                self.path = p

        def fake_expand(slot, folder, limit=None):
            """The engine's own function (ryagram.local.engine.expand_folder) is proven in its own tests; the stand-in engine here has the same contract: every video at any depth, sorted, capped."""
            lim = 3 if limit is None else limit
            found = sorted((q for q in folder.rglob('*') if q.is_file() and q.suffix.lower() in ('.mp4', '.mkv', '.mov') and not any(p.startswith(('.', '$')) for p in q.relative_to(folder).parts)), key=lambda q: str(q.relative_to(folder)).lower())
            if not found:
                raise dm.STATE['E'].Refused('There are no videos in the folder.')
            return [_Bind(q.resolve()) for q in found[:lim]], {'slot': slot, 'folder': folder.name, 'found': len(found), 'used': min(len(found), lim)}

        print('A. the routes')
        check(http('GET', f'{base}/song?t=testtoken')[0] == 404 and jpost(base, '/api/song/build', {}, tok)[0] == 404, 'started without --song, the song page and every song route do not exist (404)')
        check(b'id="song-link"' not in http('GET', f'{base}/?t=testtoken')[2], 'without --song the main page has no link to the song page')
        ms.attach(dm)
        check(ms.on() is False, 'attached but not switched on: the song module says it is off')
        dm.STATE['song_on'] = True
        st, h, body = http('GET', f'{base}/?t=testtoken')
        check(b'id="song-link"' in body and b'/song?t=' in dm.JS.encode(), 'with --song the main page has a link to the song page (and its script gives the link the token)')
        check(http('GET', f'{base}/song')[0] == 403 and http('GET', f'{base}/song?t=wrong')[0] == 403, 'the song page without the token, or with a wrong one, is refused')
        st, h, body = http('GET', f'{base}/song?t=testtoken')
        csp = h.get('Content-Security-Policy', '')
        check(st == 200 and b'id="lyrics"' not in body and b'song.js' in body and "media-src 'self' blob:" in csp and "connect-src 'self'" in csp and "default-src 'none'" in csp, 'the song page is served with WEB\u2019s own content policy (blob: for the sound, only this server)')
        check(all(http('GET', f'{base}{p}')[0] == 200 for p in ('/song.js', '/song-model.js', '/song.css')) and http('GET', f'{base}/song.js', {'Host': 'evil.example'})[0] == 403, 'its script, model and style are served; a request naming another host is refused')
        check(http('POST', f'{base}/api/song/build', {}, {})[0] == 403 and http('GET', f'{base}/api/song')[0] == 403, 'every song call needs the token')

        print('   the choices (names only)')
        picks['videos'] = [str(v1), str(v2)]
        st, r = jpost(base, '/api/song/videos', {}, tok)
        check(st == 200 and r == {'videos': [{'file_name': 'walk.mp4'}, {'file_name': 'talk.mp4'}]} and str(media) not in json.dumps(r), 'choosing videos answers with file NAMES only')
        picks['videos'] = [str(v1b)]
        st, r = jpost(base, '/api/song/videos', {}, tok)
        check(st == 400 and 'different video is already called walk.mp4' in r['error'], 'a different video with a name already used is refused in plain words')
        picks['videos'] = [str(media / 'notes.txt')]
        st, r = jpost(base, '/api/song/videos', {}, tok)
        check(st == 400 and 'not a video' in r['error'], 'a text file is not a video')
        picks['audio'] = str(media / 'notes.txt')
        st, r = jpost(base, '/api/song/track', {}, tok)
        check(st == 400 and 'not a sound' in r['error'], 'a text file is not a song')
        picks['audio'] = str(media / 'fake.wav')
        st, r = jpost(base, '/api/song/track', {}, tok)
        check(st == 400 and 'not a sound this computer can read' in r['error'], 'MUST-FAIL: a text file named .wav is not a song (ffmpeg has the say, not the name)')
        picks['audio'] = str(track)
        st, r = jpost(base, '/api/song/track', {}, tok)
        check(st == 200 and r == {'track': {'file_name': 'my-song.wav', 'seconds': r['track']['seconds']}} and abs(r['track']['seconds'] - 12) < 0.2, 'the song: its name and its real length')
        picks['audio'] = str(guide)
        st, r = jpost(base, '/api/song/guide', {}, tok)
        check(st == 200 and r == {'guide': {'file_name': 'my-singing.wav'}}, 'the singing track: its name')
        picks['audio'] = None
        check(jpost(base, '/api/song/track', {}, tok) == (200, {}), 'closing the dialog without choosing changes nothing and says nothing')

        print('   a whole folder of videos (Ryan 13:10)')
        fol = media / 'my clips'
        (fol / 'sub').mkdir(parents=True, exist_ok=True)
        mk_video(fol / 'one.mp4', 400)
        mk_video(fol / 'sub' / 'two.mp4', 450)
        mk_video(fol / 'sub' / 'three.mp4', 500)
        mk_video(fol / 'four.mp4', 520)
        (media / 'empty').mkdir(exist_ok=True)
        saved_expand = getattr(dm.STATE['E'], 'expand_folder', None)
        if saved_expand is not None:                      # an engine that HAS the function (the combined one): take it away for this one check, as an older engine would not have it
            del dm.STATE['E'].expand_folder
        picks['folder'] = str(fol)
        st, r = jpost(base, '/api/song/folder', {}, tok)
        check(st == 400 and 'cannot read a whole folder' in r['error'], 'MUST-FAIL: an engine that cannot read folders says so in plain words (not a crash)')
        if saved_expand is not None:                      # the engine's own function, with its cap lowered to 3 so the 'found 4, uses 3' case is the real one
            dm.STATE['E'].expand_folder = saved_expand
            keep_cap = dm.STATE['E'].MAX_FOLDER_FILES
            dm.STATE['E'].MAX_FOLDER_FILES = 3
        else:
            dm.STATE['E'].expand_folder = fake_expand
        picks['folder'] = str(media / 'empty')
        st, r = jpost(base, '/api/song/folder', {}, tok)
        check(st == 400 and 'no videos' in r['error'].lower(), 'MUST-FAIL: an empty folder is refused in words')
        picks['folder'] = str(fol)
        st, r = jpost(base, '/api/song/folder', {}, tok)
        names = [v['file_name'] for v in r.get('videos', [])]
        check(st == 200 and r['folder'] == {'name': 'my clips', 'found': 4, 'used': 3} and names == ['my clips/four.mp4', 'my clips/one.mp4', 'my clips/sub/three.mp4'], f'a folder answers with its NAME, how many it found and uses, and FOLDER-RELATIVE video names ({r.get("folder")})')
        check(str(media) not in json.dumps(r) and not re.search(r'[A-Za-z]:[\/]', json.dumps(r)), 'no path in the folder answer')
        picks['folder'] = None
        check(jpost(base, '/api/song/folder', {}, tok) == (200, {}), 'closing the dialog without choosing changes nothing')
        goodf = {'lines': ['one two three together'], 'videos': [{'file_name': n} for n in names], 'folders': [{'name': 'my clips'}], 'track': {'file_name': 'my-song.wav'}}
        for what, req, want in (('a folder name that was not chosen', {**goodf, 'folders': [{'name': 'ghost'}]}, 'no longer where it was'), ('a path as a folder-relative name', {**goodf, 'videos': [{'file_name': 'C:/x/a.mp4'}]}, 'not valid'),
                                ('a .. in a name', {**goodf, 'videos': [{'file_name': 'my clips/../x.mp4'}]}, 'not valid'), ('a leading slash', {**goodf, 'videos': [{'file_name': '/my clips/one.mp4'}]}, 'not valid'),
                                ('a backslash', {**goodf, 'videos': [{'file_name': 'my clips\\one.mp4'}]}, 'not valid'), ('a name from a folder that is not chosen', {**goodf, 'videos': [{'file_name': 'nope/one.mp4'}], 'folders': []}, 'no longer where it was')):
            st, r = jpost(base, '/api/song/build', req, tok)
            check(st == 400 and want in r['error'], f'MUST-FAIL: {what}: refused in plain words ({r.get("error", "")[:50]!r})')
        st, r = jpost(base, '/api/song/build', goodf, tok)
        check(st == 200 and len(r['plan']['lines'][0]['words']) == 4 and r['plan']['track']['file_name'] == 'my-song.wav', 'a build from a folder alone works (the stand-in engine was given the FOLDER, not 3 files)')
        st, r = jpost(base, '/api/song/hear', {'kind': 'word', 'n': 1, 'i': 0}, tok)
        st2, h2, b2 = http('GET', base + r['url'], tok) if r else (0, 0, b'')
        check(st == 200 and st2 == 200 and b2[:4] == b'RIFF', 'Hear this word works for a video found through a folder (looked up by its own file name)')
        if saved_expand is not None:
            dm.STATE['E'].MAX_FOLDER_FILES = keep_cap
        dm.STATE['E'].expand_folder = saved_expand if saved_expand is not None else fake_expand

        print('   build: refusals in plain words, then a plan')
        good = {'lines': ['walk and talk together', 'one more line to sing'], 'videos': [{'file_name': 'walk.mp4'}, {'file_name': 'talk.mp4'}], 'track': {'file_name': 'my-song.wav'}, 'guide': {'file_name': 'my-singing.wav'}}
        for what, req, want in (('no words', {**good, 'lines': []}, 'Paste your words first.'), ('no videos', {**good, 'videos': []}, 'Choose at least one video.'),
                                ('a video not chosen here', {**good, 'videos': [{'file_name': 'ghost.mp4'}]}, 'no longer where it was'), ('a path as a name', {**good, 'videos': [{'file_name': 'C:\\x\\walk.mp4'}]}, 'not valid'),
                                ('a repeat', {**good, 'videos': [{'file_name': 'walk.mp4'}, {'file_name': 'walk.mp4'}]}, 'not valid'), ('another track', {**good, 'track': {'file_name': 'other.wav'}}, 'Choose your music first.'),
                                ('a line of 41 words', {**good, 'lines': [' '.join(['la'] * 41)]}, 'at most 40 words')):
            st, r = jpost(base, '/api/song/build', req, tok)
            check(st == 400 and want in r['error'], f'MUST-FAIL: {what}: refused in plain words ({r.get("error", "")[:50]!r})')
        st, r = jpost(base, '/api/song/render', {'plan': {}}, tok)
        check(st == 400, 'MUST-FAIL: render before any build is refused')
        st, r = jpost(base, '/api/song/build', {**good, 'lines': ['refuseme please']}, tok)
        check(st == 400 and r['error'] == 'Choose at least one video.' and '--bind' not in r['error'] and 'footage-1' not in r['error'] and 'Someone' not in r['error'], f'the engine\u2019s command-line sentence becomes the maker\u2019s own words ({r.get("error")!r})')
        st, r = jpost(base, '/api/song/build', {**good, 'lines': ['weirdme now']}, tok)
        check(st == 400 and r['error'] and 'Someone' not in r['error'] and '--bind' not in r['error'] and 'v.mp4' not in r['error'], f'an engine sentence the maker does not know is still shown without a path or a command-line flag ({r.get("error")!r})')
        st, r = jpost(base, '/api/song/build', {**good, 'lines': ['netme now']}, tok)
        check(st == 400 and r['error'].startswith('Blocked: the build tried to use the network'), 'a blocked network attempt is said plainly')
        st, r = jpost(base, '/api/song/build', {**good, 'lines': ['zzz zzzz']}, tok)
        check(st == 400 and r['error'] == ms.NONE_SAID, 'nobody says any of the words: the plain stop, no dead end')
        st, r = jpost(base, '/api/song/build', good, tok)
        plan = r.get('plan') if isinstance(r, dict) else None
        check(st == 200 and plan and plan['schema'] == 'ryagram.song-plan/0' and [len(l['words']) for l in plan['lines']] == [4, 5] and plan['track']['file_name'] == 'my-song.wav' and plan['guide']['file_name'] == 'my-singing.wav', f'build answers with the plan the screens read ({st})')
        node = shutil.which('node')
        if node:
            (tmp / 'p.json').write_text(json.dumps(plan))
            run = subprocess.run([node, '-e', "const m=require(process.argv[1]);const p=JSON.parse(require('fs').readFileSync(process.argv[2],'utf8'));const n=m.normalize(p);console.log(m.summarize(n).words)", str(ROOT / 'tools' / 'maker-song' / 'song-model.js'), str(tmp / 'p.json')], capture_output=True, text=True)
            check(run.returncode == 0 and run.stdout.strip() == '9', f'WEB\u2019s own validator accepts the plan the maker gives ({run.stderr.strip()[-80:]})')
        else:
            print('  SKIPPED  node is not here: WEB\u2019s validator DID NOT RUN on the maker\u2019s plan')
        blob = json.dumps(plan)
        check(str(media) not in blob and 'footage-1' not in blob and not re.search(r'[A-Za-z]:[\\/]', blob), 'the plan holds no path and no slot id')
        words = [w for l in plan['lines'] for w in l['words']]
        check(sum(1 for w in words if w['status'] == 'whole') == 9 and all(w['offset_ms'] is None and w['offset_measured'] is False for w in words if w['status'] == 'whole'), 'nothing is called measured before the film exists')

        print('   hear: the person\u2019s own take, never a made-up sound')
        st, r = jpost(base, '/api/song/hear', {'kind': 'word', 'n': 1, 'i': 0}, tok)
        url = r.get('url') if isinstance(r, dict) else None
        check(st == 200 and url and url.startswith('/api/song/audio?id='), 'Hear this word answers with an address for the sound')
        st, h, body = http('GET', base + url, tok)
        check(st == 200 and body[:4] == b'RIFF' and len(body) > 2000 and http('GET', base + url)[0] == 403, 'the sound is a real wav, and fetching it needs the token header (the token is not in the address)')
        st, r = jpost(base, '/api/song/hear', {'kind': 'line', 'n': 2}, tok)
        st2, h, body = http('GET', base + r['url'], tok) if r else (0, 0, b'')
        check(st == 200 and st2 == 200 and body[:4] == b'RIFF' and len(body) > 20000, 'Hear this line is its words\u2019 takes placed on their beats')
        check(jpost(base, '/api/song/hear', {'kind': 'alt', 'n': 1, 'i': 0, 'id': 'x'}, tok) == (200, None) and jpost(base, '/api/song/hear', {'kind': 'word', 'n': 9, 'i': 0}, tok) == (200, None),
              'another take, or a word that is not there, answers null (the page then plays its practice tone and says so)')

        st, r = jpost(base, '/api/song/build', {**good, 'lines': ['walk and zzzap together']}, tok)
        gp = r['plan']
        gi = [w['status'] for w in gp['lines'][0]['words']].index('gap')
        check(jpost(base, '/api/song/hear', {'kind': 'word', 'n': 1, 'i': gi}, tok) == (200, None), 'MUST-FAIL: Hear this word on a gap answers null (nothing is made up to play)')
        jpost(base, '/api/song/build', good, tok)
        print('   save and open')
        st, r = jpost(base, '/api/song', {'plan': plan}, tok)
        sj = tmp / 'films' / 'song.json'
        check(st == 200 and r == {'saved': True} and sj.is_file() and json.loads(sj.read_text(encoding='utf-8')) == plan, 'save writes song.json beside the films, the same plan')
        st, h, body = http('GET', f'{base}/api/song', tok)
        check(json.loads(body) == {'plan': plan}, 'open gives back the saved plan')
        bad = json.loads(json.dumps(plan))
        bad['lines'][0]['words'][0]['file_name'] = 'C:\\Users\\x\\walk.mp4'
        check(jpost(base, '/api/song', {'plan': bad}, tok)[0] == 400, 'MUST-FAIL: a plan with a path in a file name is refused')
        bad = json.loads(json.dumps(plan))
        bad['lines'][0]['text'] = 'sing along C:\\Users\\x\\clip.mp4 now'
        check(jpost(base, '/api/song', {'plan': bad}, tok)[0] == 400, 'MUST-FAIL: a place on this computer hidden in any other field (a line of text) is refused too')
        bad = json.loads(json.dumps(plan))
        bad['lines'][0]['words'][0].update(status='syllables', pieces=[{'text': 'wa', 'speaker_id': bad['cast'][0]['id']}, {'text': 'lk', 'speaker_id': 'someone-else'}])
        check(jpost(base, '/api/song', {'plan': bad}, tok)[0] == 400, 'MUST-FAIL: a built word whose pieces mix two people is refused')
        bad = json.loads(json.dumps(plan)); bad['schema'] = 'x'
        check(jpost(base, '/api/song', {'plan': bad}, tok)[0] == 400, 'MUST-FAIL: another schema is refused')
        sj.write_text('{"broken": ', encoding='utf-8')
        check(json.loads(http('GET', f'{base}/api/song', tok)[2]) == {'plan': None}, 'a damaged song.json opens as nothing saved, not as an error')
        jpost(base, '/api/song', {'plan': plan}, tok)

        print('   render: only the plan that was built, one at a time')
        gone = json.loads(json.dumps(plan)); gone['lines'][0]['words'][0]['file_name'] = 'talk.mp4' if gone['lines'][0]['words'][0]['file_name'] != 'talk.mp4' else 'walk.mp4'
        st, r = jpost(base, '/api/song/render', {'plan': gone}, tok)
        check(st == 400 and 'not the one that was built here' in r['error'], 'MUST-FAIL: a plan changed on the screen (another clip for a word) is refused; the build takes no overrides')
        quiet = json.loads(json.dumps(plan)); quiet['lines'][0]['words'][0]['quiet'] = True
        st, r = jpost(base, '/api/song/render', {'plan': quiet}, tok)
        check(st == 400 and 'Only a gap can be left quiet' in r['error'], 'MUST-FAIL: a real word cannot be left quiet')
        short = json.loads(json.dumps(plan)); short['lines'] = short['lines'][:1]
        check(jpost(base, '/api/song/render', {'plan': short}, tok)[0] == 400, 'MUST-FAIL: a plan with a line missing is not the plan that was built')
        st, r = jpost(base, '/api/song/render', {'plan': plan}, tok)
        film = tmp / 'films' / (r.get('film') or 'none') if isinstance(r, dict) else None
        rcpt = json.loads(film.with_suffix('.receipt.json').read_text(encoding='utf-8')) if film and film.with_suffix('.receipt.json').is_file() else {}
        check(st == 200 and film and film.is_file() and r['message'].startswith('Your film is ready: song-') and '12 ms off' in r['message'], f'render builds the film and says in plain words how close the worst word is ({r})')
        check(rcpt.get('approved') == plan['plan_id'] and rcpt.get('argv_has_forge') is False, 'the engine was given exactly the plan\u2019s id to approve, and no forge switch (off by default)')
        check(dm.STATE.get('last_film') == str(film), 'the film opens in the maker\u2019s own player (/film)')
        # a second render while one runs
        slow = {**good, 'lines': ['slowme walk and talk']}
        st, r = jpost(base, '/api/song/build', slow, tok)
        splan = r['plan']
        out2 = {}
        t = threading.Thread(target=lambda: out2.update(first=jpost(base, '/api/song/render', {'plan': splan}, tok)))
        t.start()
        time.sleep(1.2)
        st, r = jpost(base, '/api/song/render', {'plan': splan}, tok)
        check(st == 400 and 'already running' in r['error'], 'MUST-FAIL: a second render while one runs is refused')
        st, r = jpost(base, '/api/song/build', good, tok)
        check(st == 400 and 'already running' in r['error'], 'a build while a render runs is refused too')
        t.join()
        check(out2['first'][0] == 200, 'the first render finished')
        st, r = jpost(base, '/api/song/build', good, tok)
        plan = r['plan']
        st, r = jpost(base, '/api/song/build', {**good, 'lines': ['failme walk and talk']}, tok)
        before_n = len(list((tmp / 'films').glob('*.mp4')))
        st, r2 = jpost(base, '/api/song/render', {'plan': r['plan']}, tok)
        check(st == 400 and 'Someone' not in r2['error'] and len(list((tmp / 'films').glob('*.mp4'))) == before_n and not any(f.stat().st_size == 2 for f in (tmp / 'films').glob('*.receipt.json')), f'MUST-FAIL: a render that fails keeps nothing (no part-made film, no receipt) and says so without a path ({r2.get("error")!r})')
        st, r = jpost(base, '/api/song/build', good, tok)
        plan = r['plan']
        print('   the ids and the forge switch (WEB 10:46)')
        st, r = jpost(base, '/api/song/build', {**good, 'plan_id': plan['plan_id']}, tok)
        check(st == 200 and r['plan']['plan_id'] == plan['plan_id'], 'Build with the id of the plan on the screen gives that same plan (this is how Make it without is checked)')
        st, r = jpost(base, '/api/song/build', {**good, 'plan_id': '0' * 16}, tok)
        check(st == 400 and 'plan changed since you looked at it' in r['error'], 'MUST-FAIL: Build with another plan id is refused in plain words')
        jpost(base, '/api/song/build', good, tok)
        wrong = json.loads(json.dumps(plan)); wrong['plan_id'] = '1' * 16
        check(jpost(base, '/api/song/render', {'plan': wrong}, tok)[0] == 400, 'MUST-FAIL: render with a plan that carries another id is refused')
        argv_forge = {}
        for label, server, ask in (('off at the server, asked', False, True), ('on at the server, not asked', True, False), ('on at the server, asked', True, True)):
            dm.STATE['song_forge'] = server
            st, r = jpost(base, '/api/song/build', {**good, 'forge': ask}, tok)
            st, r = jpost(base, '/api/song/render', {'plan': r['plan']}, tok)
            argv_forge[label] = json.loads((tmp / 'films' / (r['film'].rsplit('.', 1)[0] + '.receipt.json')).read_text(encoding='utf-8'))['argv_has_forge']
        dm.STATE['song_forge'] = False
        check(argv_forge == {'off at the server, asked': False, 'on at the server, not asked': False, 'on at the server, asked': True}, f'MUST-FAIL: the engine gets --forge only when the maker was started with it AND the page asked ({argv_forge})')
        st, r = jpost(base, '/api/song/build', good, tok)
        plan = r['plan']
        # the engine refusing a changed plan (files changed after looking)
        keep = ms.S()['binds']
        ms.S()['binds'] = keep[:1]
        st, r = jpost(base, '/api/song/render', {'plan': plan}, tok)
        ms.S()['binds'] = keep
        check(st == 400 and 'plan changed since you looked at it' in r['error'] and 'Press Build again' in r['error'] and '--' not in r['error'], 'the engine\u2019s own refusal of a changed plan reaches the person in plain words')
        print('B. the page, in real Chrome')
        try:
            from playwright.sync_api import sync_playwright
        except ImportError:
            check(False, 'playwright is not installed here: the page walk DID NOT RUN')
            raise SystemExit(0 if ok else 1)
        (tmp / 'films' / 'song.json').unlink(missing_ok=True)
        ms.S().update(plan=None, videos={}, track=None, guide=None)
        picks['videos'] = [str(v1), str(v2)]
        with sync_playwright() as pw:
            b = pw.chromium.launch()
            try:
                ctx = b.new_context(viewport={'width': 1000, 'height': 1000})

                def route(r):
                    u = r.request.url
                    if u.startswith(base) or u.startswith('blob:') or u.startswith('data:'):
                        r.continue_()
                    else:
                        external.append(u)
                        r.abort()
                ctx.route('**/*', route)
                p = ctx.new_page()
                p.on('pageerror', lambda e: errs.append(str(e)))
                p.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
                p.goto(f'{base}/?t=testtoken', wait_until='load')
                p.get_by_role('link', name='Sing a line to your music').click()
                p.wait_for_selector('#lyrics', timeout=15000)
                check('/song' in p.url, 'the main page\u2019s link opens the song page')
                p.get_by_role('button', name='Build my song').click()
                check('words' in p.locator('#msg').inner_text().lower() or 'Paste' in p.locator('#msg').inner_text(), 'pressing Build with nothing says what is missing, in the page\u2019s own words')
                p.fill('#lyrics', 'walk and talk together\none more line to sing')
                picks['audio'] = str(track)
                p.get_by_role('button', name='Choose your videos').click()
                p.wait_for_selector('text=talk.mp4')
                p.get_by_role('button', name='Choose your music').click()
                p.wait_for_selector('text=my-song.wav')
                p.get_by_role('button', name='Build my song').click()
                p.wait_for_selector('#s-board:not([hidden])', timeout=60000)
                check(p.locator('button.chip').count() == 9, 'the board shows the 9 words, built by the maker from the stand-in engine')
                p.locator('[data-key="hear-line-1"]').click()
                until(p, "document.getElementById('player').src.startsWith('blob:')", 15000)
                src = p.evaluate("document.getElementById('player').src")
                check('testtoken' not in src, 'Hear this line plays the maker\u2019s sound from a blob: address (no token in it)')
                p.locator('button.chip').first.click()
                p.get_by_role('button', name='Hear this word').click()
                p.wait_for_timeout(500)
                p.get_by_role('button', name='Save my song').click()
                until(p, "document.getElementById('save').textContent === 'Saved'", 10000)
                saved = p.evaluate('window.ryagramSong.saveText()')
                p.reload(wait_until='load')
                p.wait_for_selector('html[data-ready="1"]', timeout=15000)
                check(p.evaluate('window.ryagramSong.saveText()') == saved and p.locator('button.chip').count() == 9, 'closed and reopened: the same song, the same bytes')
                check(not re.search(r'[A-Za-z]:[\\/]', saved) and str(media) not in saved, 'the saved plan holds no path')
                p.screenshot(path=str(OUT / 'song-wire-1-board.png'), full_page=True)
                p.get_by_role('button', name='Build again').click()
                until(p, "document.getElementById('build').disabled", 5000)
                until(p, "!document.getElementById('build').disabled", 60000)                   # the board is already showing the saved song: wait for the new build itself
                p.get_by_role('button', name='Make the film').click()
                until(p, "document.getElementById('live').textContent.includes('Your film is ready')", 60000)
                check(p.locator('#render').is_enabled() and len(list((tmp / 'films').glob('song-*.mp4'))) >= 2, 'Make the film: the maker answers in plain words when the film is done, and the button is back')
                p.screenshot(path=str(OUT / 'song-wire-2-film.png'), full_page=True)
                ctx.close()
            finally:
                b.close()
        check(not errs, f'no page errors or console errors ({errs[:2]})')
        check(not external, f'every request to another host was refused ({len(external)})')
        srv.shutdown()
    finally:
        pass
    print('RESULT: ' + ('PASS' if ok else 'FAIL'))
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
