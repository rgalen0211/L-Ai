"""The desktop maker (tools/desktop_maker.py) in real Chrome at 1280 px, local only, plus its safety rules. It runs the REAL recipe check and bind check (including the START_MS-END_MS spans) from ENGINE's
local-ranges checkout; the PLAN and BUILD steps run a stand-in `ryagram.local` (a copy of that checkout whose __main__ prints a plan, writes a tiny fake MP4 and receipt, sleeps for slow.mp4, or exits
with a chosen code for gap.mp4, boom.mp4, net.mp4 and refuse.mp4), so no speech model and no ffmpeg are needed here. The operating system's file dialog cannot be driven by a script, so the check replaces
only that one function. Screenshots go to the out folder.

    python tools/check-desktop-maker.py <path to a Ryagram checkout with ryagram/local and its plan command> [outdir]       (default D:/Ryagram-scratch/WEB/engine-lr, D:/Ryagram-scratch/WEB/maker-shots)
"""
import importlib.util
import os
import re
import json
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
ENGINE = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('D:/Ryagram-scratch/WEB/engine-lr')
OUT = Path(sys.argv[2]) if len(sys.argv) > 2 else Path('D:/Ryagram-scratch/WEB/maker-shots')
spec = importlib.util.spec_from_file_location('desktop_maker', ROOT / 'tools' / 'desktop_maker.py')
dm = importlib.util.module_from_spec(spec)
sys.modules['desktop_maker'] = dm
spec.loader.exec_module(dm)

RECIPE = {"schema": "ryagram.recipe/0", "name": "well that is great news",
          "slots": [{"id": "source-1", "label": "First footage", "accepts": "video", "multiple": True},
                    {"id": "source-2", "label": "Second footage", "accepts": "video", "multiple": False}],
          "find": {"op": "words", "text": "well that is great news", "unit": "words", "slots": ["source-1", "source-2"]},
          "select": {"min_length": 1, "max_length": 8, "min_seconds": 0.05, "max_seconds": 4.0},
          "arrange": {"order": "text", "join": "cut", "crossfade_ms": 0},
          "effects": {"padding": {"lead_ms": 60, "trail_ms": 60}},
          "render": {"preset": "720p30", "crf": 28}}

STUB_MAIN = '''import sys, time, json
from pathlib import Path
a = sys.argv
cmd = a[1]
work = Path(a[a.index("--work-dir") + 1]); out = Path(a[a.index("--out") + 1])
binds = [x for x in a if "=" in x and not x.startswith("--")]
joined = " ".join(binds)
for name, code in (("refuse", 2), ("boom", 1), ("net", 4)):
    if name + ".mp4" in joined:
        print("stand-in says " + name, file=sys.stderr); sys.exit(code)
print("listening to the files ...", file=sys.stderr, flush=True)
for b in binds:
    name = Path(b.partition("=")[2].split("#")[0]).name
    print("  listening to " + name + " ...", file=sys.stderr, flush=True)
    if name == "slow.mp4":
        time.sleep(60)
    print("  " + name + ": 3 words in 2.0 s of audio", file=sys.stderr, flush=True)
clips = [{"n": 1, "words": "well that is great", "file_name": "a.mp4", "slot": "source-1", "start_ms": 7930, "end_ms": 9970, "duration_ms": 2040},
         {"n": 2, "words": "news", "file_name": "b.mkv", "slot": "source-2", "start_ms": 100, "end_ms": 900, "duration_ms": 800}]
if cmd == "plan":
    work.mkdir(parents=True, exist_ok=True); (work / "heard.txt").write_text("words")
    (work / "asked-for.txt").write_text(json.loads(Path(a[2]).read_text(encoding="utf-8"))["find"]["text"])
    gap = "gap.mp4" in joined
    print(json.dumps({"ok": not gap, "gaps": ["news"] if gap else [], "clips": [] if gap else clips, "seconds_estimate": 2.96, "would_write": out.name, "model": "base", "network_attempts": 0}))
    sys.exit(3 if gap else 0)
out.parent.mkdir(parents=True, exist_ok=True)
import os
real = os.environ.get("STUB_REAL_FILM")
out.write_bytes(Path(real).read_bytes() if real else b"\\x00\\x00\\x00\\x18ftypmp42")
if "buildfail.mp4" in joined:
    out.with_suffix(".receipt.json").write_text("{}"); print("a cut failed", file=sys.stderr); sys.exit(1)
if "slowbuild.mp4" in joined:
    print("joining ...", file=sys.stderr, flush=True); time.sleep(60)
out.with_suffix(".receipt.json").write_text(json.dumps({"schema": "ryagram.local-receipt/0", "recipe": "stub", "film": out.name, "seconds": 12.0 if "long.mp4" in joined else 2.4, "model": "base", "network_attempts": 0, "clips": clips, "reused_words": (work / "heard.txt").is_file(), "work": str(work), "wall_seconds": 0.1}))
with open(out, "ab") as fh:
    fh.write(bytes(range(256)) * 20)
print("built", out.name)
'''


def get(url, headers=None):
    req = urllib.request.Request(url, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.status, dict(r.headers), r.read()
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read()


def post(url, body, headers):
    req = urllib.request.Request(url, data=json.dumps(body).encode(), headers={**headers, 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())


def wait_job(base, tok, states, seconds=30):
    end = time.time() + seconds
    j = {}
    while time.time() < end:
        j = json.loads(get(f'{base}/api/job', tok)[2])
        if j['state'] in states:
            return j
        time.sleep(0.2)
    return j


def make_real_film(dest):
    exe = shutil.which('ffmpeg')
    if not exe:
        return None
    r = subprocess.run([exe, '-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=duration=2:size=320x180:rate=10', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', str(dest)], capture_output=True)
    return dest if r.returncode == 0 and dest.exists() else None


REAL_FILM = None


def main():
    global REAL_FILM
    OUT.mkdir(parents=True, exist_ok=True)
    tmp = Path(tempfile.mkdtemp(prefix='maker-'))
    REAL_FILM = make_real_film(tmp / 'real-film.mp4')
    if REAL_FILM:
        os.environ['STUB_REAL_FILM'] = str(REAL_FILM)          # the computer's own TEMP, nothing assumes a D: drive
    ok = True

    def check(cond, what):
        nonlocal ok
        print(('  ok   ' if cond else '  FAIL ') + what)
        ok = ok and bool(cond)
    try:
        eng = tmp / 'engine'
        shutil.copytree(ENGINE / 'ryagram', eng / 'ryagram', ignore=shutil.ignore_patterns('__pycache__', 'globe3d', 'maprace', 'trends'))
        (eng / 'ryagram' / 'local' / '__main__.py').write_text(STUB_MAIN, encoding='utf8')
        recipes = tmp / 'recipes'
        recipes.mkdir()
        (recipes / 'great-news.json').write_text(json.dumps(RECIPE), encoding='utf8')
        (recipes / 'broken.json').write_text(json.dumps({"schema": "ryagram.recipe/0", "name": "x", "slots": []}), encoding='utf8')
        clips = tmp / 'clips'
        clips.mkdir()
        for n in ('a.mp4', 'b.mkv', 'slow.mp4', 'gap.mp4', 'boom.mp4', 'net.mp4', 'refuse.mp4', 'buildfail.mp4', 'slowbuild.mp4', 'drift.mp4', 'long.mp4'):
            (clips / n).write_bytes(b'not really a video; the checks only look at the name and that it exists')
        (clips / 'notes.txt').write_text('x')
        srv = dm.make_server(eng, recipes, tmp / 'work', tmp / 'films', port=0, token='testtoken')
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        port = dm.STATE['port']
        base = f'http://127.0.0.1:{port}'
        tok = {'X-Maker-Token': 'testtoken'}
        sl = {'recipe': 'great-news.json', 'model': 'base'}
        good = {'source-1': [str(clips / 'a.mp4')], 'source-2': [str(clips / 'b.mkv')]}
        # ---- the safety rules, without a browser
        print('safety')
        check(get(f'{base}/')[0] == 403, 'the page without the token is refused')
        check(get(f'{base}/api/recipes', {'Host': 'evil.example', **tok})[0] == 403, 'a request that names another host is refused (no DNS rebinding)')
        st, h, body = get(f'{base}/?t=testtoken')
        check(st == 200 and b'type="file"' not in body and all(b'type="text"' in t or b'id="log-on"' in t for t in re.findall(rb'<input[^>]*>', body)), 'the page has no file input (its one text box is for the words to find; the other is the log switch): nothing can be uploaded')
        check(b'<details class="paste" hidden>' in body, 'r8: the paste-bind box is hidden unless the address carries advanced=1')
        check("default-src 'none'" in h.get('Content-Security-Policy', '') and "connect-src 'self'" in h['Content-Security-Policy'], 'a strict policy: only this server, no inline script')
        check(post(f'{base}/api/check', {'recipe': '../../etc/x.json', 'binds': {}}, tok)[1]['problems'][0].startswith('That recipe is not in the recipes folder'), 'a recipe name with folder tricks is refused')
        text = ' '.join(post(f'{base}/api/check', {**sl, 'binds': {'source-1': [str(clips / 'notes.txt')], 'source-2': ['http://example.com/a.mp4']}}, tok)[1]['problems'])
        check('not a video file' in text and 'not an address' in text, f'a text file and a web address are refused by ENGINE\u2019s own bind check ({text[:90]!r})')
        text = ' '.join(post(f'{base}/api/check', {**sl, 'binds': {'source-1': [str(clips / 'a.mp4') + '#900-100'], 'source-2': [str(clips / 'b.mkv')]}}, tok)[1]['problems'])
        check('empty or backwards' in text, f'a backwards span is refused with ENGINE\u2019s sentence ({text[:90]!r})')
        pc = post(f'{base}/api/check', {**sl, 'binds': {'source-1': [str(clips / 'a.mp4') + '#100-900'], 'source-2': [str(clips / 'b.mkv')]}}, tok)[1]
        check(pc['ok'] and 'only 0.10 to 0.90 s' in pc['slots'][0]['files'][0]['name'], 'a START_MS-END_MS span is accepted and shown in seconds')
        check(post(f'{base}/api/build', {**sl, 'binds': good}, tok)[0] == 400, 'Build without a Plan is refused')
        # the speech add-on missing is caught at the door check, in one plain sentence with the exact command (not after a long listen, not as a refusal about the recipe)
        keep_fw = dm.faster_whisper_missing
        dm.faster_whisper_missing = lambda: True
        pf = post(f'{base}/api/check', {**sl, 'binds': good}, tok)[1]
        dm.faster_whisper_missing = keep_fw
        # a missing Python package when the maker starts (the sign of a Python without the speech add-on: faster-whisper brings PyYAML and more) is ONE plain message with the command, not a traceback
        keep_le, keep_state = dm.load_engine, dict(dm.STATE)

        def boom(engine):
            raise ModuleNotFoundError("No module named 'yaml'", name='yaml')
        dm.load_engine = boom
        try:
            dm.main(['--engine', str(eng), '--recipes', str(recipes), '--work-dir', str(tmp / 'w-missing'), '--out-dir', str(tmp / 'o-missing'), '--port', '0'])
            msg = ''
        except SystemExit as e_:
            msg = str(e_.code)
        dm.load_engine = keep_le
        dm.STATE.clear()
        dm.STATE.update(keep_state)          # main() reset the running server's settings: put them back
        check('(yaml)' in msg and 'speech add-on' in msg and 'faster-whisper "av<19"' in msg and 'Traceback' not in msg, f'a missing Python package at start is one plain message with the exact command, not a traceback ({msg[:60]!r})')
        check(not pf['ok'] and any('speech add-on is not installed' in x and 'faster-whisper "av<19"' in x for x in pf['problems']), 'a missing speech add-on is named at the door check with the exact command (including av<19)')
        # ---- the expected wait in plain words, from the length of the files
        dm.media_seconds = lambda pth: {'a.mp4': 1800.0, 'b.mkv': 1800.0}.get(pth.name, 60.0)
        pc = post(f'{base}/api/check', {**sl, 'binds': good}, tok)[1]
        check(pc['listen_seconds'] == 3600 and '60 minutes of video to listen to: expect about 4 minutes' in pc['listen_words'] and 'about 90 seconds to start, then about 2 seconds for each minute of video with the \u201cFast (rough)\u201d choice' in pc['listen_words'], f'the expected wait is stated from the files\u2019 length ({pc["listen_words"][:90]!r})')
        check('has not been measured for the \u201cQuickest test (very rough)\u201d choice' in post(f'{base}/api/check', {**sl, 'model': 'tiny', 'binds': good}, tok)[1]['listen_words'], 'a model nobody measured says so instead of guessing a time')
        pc = post(f'{base}/api/check', {**sl, 'binds': {'source-1': [str(clips / 'a.mp4')], 'source-2': [str(clips / 'b.mkv') + '#100-900']}}, tok)[1]
        check(abs(pc['listen_seconds'] - 1800.8) < 0.01, 'a span counts only its own length')
        same = post(f'{base}/api/check', {**sl, 'binds': {'source-1': [str(clips / 'a.mp4')], 'source-2': [str(clips / 'a.mp4')]}}, tok)[1]
        check(same['listen_seconds'] == 1800 and same['bind_count'] == 2, 'one file bound to two slots is counted once in the expected wait (the engine listens to it once), while the progress still counts both')
        dm.media_seconds = lambda pth: None
        check('could not read how long the files are' in post(f'{base}/api/check', {**sl, 'binds': good}, tok)[1]['listen_words'], 'when the length cannot be read it says so, with no made-up time')
        dm.media_seconds = lambda pth: {'a.mp4': 1800.0, 'b.mkv': 1800.0}.get(pth.name, 60.0)
        check(post(f'{base}/api/check', {**sl, 'binds': good}, tok)[1]['film_stamped'] == 'well-that-is-great-news-<date and time>.mp4', 'the plan names the film the way it will really be named (with its date and time)')
        # which file the plan is listening to
        pg = {'source-1': [str(clips / 'a.mp4')], 'source-2': [str(clips / 'slow.mp4')]}
        post(f'{base}/api/plan', {**sl, 'binds': pg}, tok)
        end = time.time() + 15
        jp = {}
        while time.time() < end:
            jp = json.loads(get(f'{base}/api/job', tok)[2])
            if jp.get('progress', {}).get('current') == 'slow.mp4':
                break
            time.sleep(0.2)
        check(jp.get('progress', {}).get('done') == 1 and jp['progress']['of'] == 2 and jp['progress']['current'] == 'slow.mp4' and abs(jp['progress']['expect_s'] - 152) < 1, f'while it listens, the job says which file it is on ({jp.get("progress")})')
        post(f'{base}/api/cancel', {}, tok)
        wait_job(base, tok, ('cancelled',))
        # ---- the words can be typed on the page: they go to the engine in a copy of the recipe; the recipe file is never changed
        orig_bytes = (recipes / 'great-news.json').read_bytes()
        typed = {**sl, 'binds': good, 'phrase': '  oh   my god '}
        pt = post(f'{base}/api/check', typed, tok)[1]
        check(pt['ok'] and pt['find'] == 'oh my god', f'typed words (spaces tidied) replace the recipe\u2019s words in the plan summary ({pt["find"]!r})')
        check(post(f'{base}/api/check', {**sl, 'binds': good}, tok)[1]['find'] == 'well that is great news', 'with nothing typed the recipe\u2019s own words are used')
        post(f'{base}/api/plan', typed, tok)
        wait_job(base, tok, ('planned',))
        heard = (dm._work_for(typed) / 'asked-for.txt').read_text()
        check(heard == 'oh my god' and (recipes / 'great-news.json').read_bytes() == orig_bytes, f'the engine is asked for the typed words and the recipe file is untouched ({heard!r})')
        check(dm._work_for(typed) != dm._work_for({**sl, 'binds': good}), 'a different phrase gets its own work folder, so the old words are never reused')
        check(post(f'{base}/api/build', {**sl, 'binds': good}, tok)[0] == 400, 'a Build whose words differ from the ones planned is refused')
        check(post(f'{base}/api/check', {**sl, 'binds': good, 'phrase': 'x' * 400}, tok)[1]['find'] == 'x' * 200, 'typed words are cut at 200 letters')
        # MUST-FAIL: typed words that break ENGINE's own PLAIN rule (paths, shell-looking text, markup, right-to-left controls) are refused with ENGINE's sentence, and nothing runs
        bad_words = ['..' + chr(92) + '..' + chr(92) + 'Windows', '$(whoami)', 'rm -rf /', '<b>x</b>', 'abc' + chr(0x202e) + 'def', 'a`b', '100%']
        refused_all, ran = True, False
        for w in bad_words:
            pb = post(f'{base}/api/check', {**sl, 'binds': good, 'phrase': w}, tok)[1]
            refused_all = refused_all and (not pb['ok']) and any('find.text' in x and 'does not match' in x for x in pb['problems'])
            code, _ = post(f'{base}/api/plan', {**sl, 'binds': good, 'phrase': w}, tok)
            ran = ran or code == 200 or (dm._work_for({**sl, 'binds': good, 'phrase': w}) / 'recipe-with-typed-words.json').exists()
        check(refused_all and not ran, 'typed words that break the engine\u2019s PLAIN rule get its own refusal sentence, Plan will not start, and no recipe copy is written')
        post(f'{base}/api/plan', {**sl, 'binds': good}, tok)
        wait_job(base, tok, ('planned',))
        check((dm._work_for({**sl, 'binds': good}) / 'asked-for.txt').read_text() == 'well that is great news', 'planning with nothing typed asks for the recipe\u2019s own words')
        # ---- the plan job, the work folder reuse, and a Build only for what was planned
        print('jobs')
        check(post(f'{base}/api/plan', {**sl, 'binds': good}, tok)[0] == 200, 'Plan starts ENGINE\u2019s plan command')
        j = wait_job(base, tok, ('planned', 'gaps', 'stopped'))
        check(j['state'] == 'planned' and len(j['plan']['clips']) == 2 and not list((tmp / 'films').glob('*.mp4')), f'Plan ends ready with 2 clips and writes no film ({j["state"]})')      # r8: the films folder now also holds the activity log, so look for films
        check(post(f'{base}/api/build', {**sl, 'binds': {**good, 'source-2': [str(clips / 'a.mp4')]}}, tok)[0] == 400, 'Build for different files than the Plan was for is refused')
        check(post(f'{base}/api/build', {**sl, 'binds': good}, tok)[0] == 200, 'Build for exactly the planned files starts')
        j = wait_job(base, tok, ('built', 'stopped'))
        films = list((tmp / 'films').glob('*.mp4'))
        receipt = json.loads(films[0].with_suffix('.receipt.json').read_text()) if films else {}
        check(j['state'] == 'built' and len(films) == 1 and receipt.get('reused_words') is True, 'Build writes the film and its receipt, in the SAME work folder as Plan, so the words Plan heard are reused')
        # every exit code in words, with what to do next
        for fname, state, code, needle, nxt in (('gap.mp4', 'gaps', 3, 'Nobody says some of these words', 'Try different words'), ('boom.mp4', 'stopped', 1, 'unexpected', 'Press Plan again'),
                                                ('net.mp4', 'stopped', 4, 'network', 'Do not use this film'), ('refuse.mp4', 'stopped', 2, 'Refused', 'Fix it')):
            post(f'{base}/api/plan', {**sl, 'binds': {'source-1': [str(clips / 'a.mp4')], 'source-2': [str(clips / fname)]}}, tok)
            j = wait_job(base, tok, ('planned', 'gaps', 'stopped'))
            check(j['state'] == state and j.get('code') == code and needle in j['words'] and nxt in j['next'], f'exit code {code} ({fname}): {j.get("words", "")[:60]!r} then {j.get("next", "")[:40]!r}')
        # ---- the results view: play the film (byte ranges), open its folder, save the answers next to it, the sound warning
        print('results')
        film = films[0]
        data = film.read_bytes()
        opened = []
        dm.open_in_folder = lambda path: opened.append(str(path))
        req = urllib.request.Request(f'{base}/film?t=testtoken')
        with urllib.request.urlopen(req, timeout=10) as r:
            body, ctype = r.read(), r.headers.get('Content-Type')
        check(body == data and ctype == 'video/mp4', 'the last built film is served to the page, byte for byte, as video/mp4')
        req = urllib.request.Request(f'{base}/film?t=testtoken', headers={'Range': 'bytes=10-19'})
        with urllib.request.urlopen(req, timeout=10) as r:
            check(r.status == 206 and r.read() == data[10:20] and r.headers.get('Content-Range') == f'bytes 10-19/{len(data)}', 'a byte range is answered with 206 and exactly those bytes, so the player can seek')
        req = urllib.request.Request(f'{base}/film?t=testtoken', headers={'Range': 'bytes=-5'})
        with urllib.request.urlopen(req, timeout=10) as r:
            check(r.status == 206 and r.read() == data[-5:], 'a suffix range gives the last bytes')
        try:
            urllib.request.urlopen(urllib.request.Request(f'{base}/film?t=testtoken', headers={'Range': 'bytes=999999-'}), timeout=10)
            check(False, 'a range past the end is refused with 416')
        except urllib.error.HTTPError as e:
            check(e.code == 416, 'a range past the end is refused with 416')
        check(get(f'{base}/film')[0] == 403 and get(f'{base}/film/../../x?t=testtoken')[0] == 404, 'the film address needs the token, and no other file can be asked for')
        check(post(f'{base}/api/open-folder', {}, tok)[1].get('folder') == str(film.parent) and opened == [str(film)], 'Open folder shows the last built film in the computer\u2019s own file window (the page sends no path)')
        qs = json.loads(get(f'{base}/api/questions', tok)[2])['questions']
        check(len(qs) == 10 and qs[0].startswith('Did the start program open the page'), 'the ten first-run questions are offered')
        r1 = post(f'{base}/api/answers', {'answers': ['yes', 'the plan button'] + [''] * 8}, tok)[1]
        a1 = Path(r1['path'])
        check(a1.name == 'my-answers.txt' and a1.parent == film.parent and 'yes' in a1.read_text(encoding='utf8') and 'the plan button' in a1.read_text(encoding='utf8') and '(no answer)' in a1.read_text(encoding='utf8'), 'the answers are saved in my-answers.txt NEXT TO THE FILM, with each question and answer')
        r2 = post(f'{base}/api/answers', {'answers': ['second time']}, tok)[1]
        check(Path(r2['path']).name != 'my-answers.txt' and 'yes' in a1.read_text(encoding='utf8'), 'a second save makes a new file and never overwrites the first')
        check(post(f'{base}/api/answers', {'answers': 'x'}, tok)[0] == 400, 'a bad answers request is refused')
        # the sound check
        for name, fn, expect in (('a file with gaps', lambda pth: 2000 if 'drift' in pth.name else 0, 'drift.mp4 has about 2.0 s of silence where its sound has gaps or starts late (the file is damaged or oddly made); its words are timed correctly, but nothing said in a gap can be found.'),
                                 ('a file that cannot be measured', lambda pth: None, 'Could not check the sound in a.mp4, so any missing parts would not be noticed.')):
            dm.STATE['gap_fn'] = fn
            bd = {'source-1': [str(clips / 'a.mp4')], 'source-2': [str(clips / 'drift.mp4')]}
            if name == 'a file with gaps':
                check(post(f'{base}/api/sound', {**sl, 'binds': bd}, tok)[0] == 400, 'the sound check is refused before a Plan for those files')
            post(f'{base}/api/plan', {**sl, 'binds': bd}, tok)
            wait_job(base, tok, ('planned',))
            post(f'{base}/api/sound', {**sl, 'binds': bd}, tok)
            end = time.time() + 10
            sd = {}
            while time.time() < end:
                sd = json.loads(get(f'{base}/api/sound', tok)[2])
                if sd.get('state') != 'running':
                    break
                time.sleep(0.2)
            check(sd.get('state') == 'done' and expect in sd.get('warnings', []), f'{name}: the warning says it in words ({(sd.get("warnings") or ["none"])[0][:70]!r})')
        # the threshold is the library's own (GAP_WARN_MS), not a number of the maker's
        import types
        lib = sys.modules['ryagram.library']
        saved = getattr(lib, 'transcribe', None)
        fake = types.ModuleType('ryagram.library.transcribe')
        fake.GAP_WARN_MS = 3000
        fake.decode_gap_ms = lambda pth: 2000 if 'drift' in pth.name else 0
        lib.transcribe = fake
        sys.modules['ryagram.library.transcribe'] = fake
        got = dm._gap_fn()
        check(got is fake.decode_gap_ms and dm.STATE['gap_warn_ms'] == 3000, 'the maker reads the warning threshold from the library (GAP_WARN_MS), and finds decode_gap_ms there')
        dm.STATE['gap_fn'] = got
        bd = {'source-1': [str(clips / 'a.mp4')], 'source-2': [str(clips / 'drift.mp4')]}
        post(f'{base}/api/plan', {**sl, 'binds': bd}, tok)
        wait_job(base, tok, ('planned',))
        post(f'{base}/api/sound', {**sl, 'binds': bd}, tok)
        end = time.time() + 10
        while time.time() < end and json.loads(get(f'{base}/api/sound', tok)[2]).get('state') == 'running':
            time.sleep(0.2)
        sd = json.loads(get(f'{base}/api/sound', tok)[2])
        check(sd['state'] == 'done' and sd['warnings'] == [], 'with the library’s threshold at 3000 ms a 2000 ms gap is not warned about (the maker follows the library)')
        if saved is not None:
            lib.transcribe = saved
            sys.modules['ryagram.library.transcribe'] = saved
        dm.STATE['gap_warn_ms'] = dm.GAP_WARN_MS
        dm.STATE['gap_fn'] = None
        post(f'{base}/api/plan', {**sl, 'binds': good}, tok)
        wait_job(base, tok, ('planned',))
        sd = post(f'{base}/api/sound', {**sl, 'binds': good}, tok)[1]
        check(sd['state'] == 'unavailable' and 'cannot check the sound' in sd['warnings'][0], 'an engine copy without the sound check says so once, instead of staying silent')
        dm.STATE['gap_fn'] = lambda pth: 2000 if 'drift' in pth.name else 0
        # a build that fails, or is cancelled, keeps no film and no receipt (ENGINE may leave a part-written one); two quick presses start one job
        for fname, how in (('buildfail.mp4', 'fails'), ('slowbuild.mp4', 'is cancelled')):
            bb = {'source-1': [str(clips / 'a.mp4')], 'source-2': [str(clips / fname)]}
            post(f'{base}/api/plan', {**sl, 'binds': bb}, tok)
            wait_job(base, tok, ('planned',))
            res = []
            gate = threading.Barrier(2)

            def press():
                gate.wait()
                res.append(post(f'{base}/api/build', {**sl, 'binds': bb}, tok))
            ts = [threading.Thread(target=press) for _ in range(2)]
            [t.start() for t in ts]
            [t.join() for t in ts]
            codes = sorted(r[0] for r in res)
            check(codes == [200, 400], f'two Build presses at the same instant start exactly one job ({fname}: {codes})')
            if how == 'is cancelled':
                time.sleep(1.0)
                post(f'{base}/api/cancel', {}, tok)
            j = wait_job(base, tok, ('stopped', 'cancelled'))
            names = sorted(f.name for f in (tmp / 'films').glob('*') if not f.name.startswith(('my-answers', 'maker-activity-log')))      # r8: the activity log lives here too
            check(j['state'] in ('stopped', 'cancelled') and len(names) == 2, f'a build that {how} keeps no film and no receipt (only the one earlier film and its receipt remain: {len(names)} files)')
        # ---- a file dropped on a slot: the page knows only its name, size and modified time, so the server finds it
        print('drop')
        other = tmp / 'other' / 'sub'
        other.mkdir(parents=True)
        shutil.copy2(clips / 'a.mp4', other / 'a.mp4')                 # the same file in a second folder
        (other / 'b.mkv').write_bytes(b'a different size')             # same name, different size: not the one
        (clips / 'node_modules').mkdir()
        (clips / 'node_modules' / 'c.mp4').write_bytes(b'hidden in a skipped folder')
        # a junction (or a link) inside a search folder is never followed: it can point to another drive, or loop back
        elsewhere = tmp / 'elsewhere'
        elsewhere.mkdir()
        (elsewhere / 'j.mp4').write_bytes(b'only reachable through a junction')
        jn = clips / 'linked'
        subprocess.run(['cmd', '/c', 'mklink', '/J', str(jn), str(elsewhere)], capture_output=True)
        sj = (elsewhere / 'j.mp4').stat()
        dm.STATE['search_roots'] = [clips, tmp / 'other']
        dm.STATE['recent_dirs'] = []

        def st(f):
            x = f.stat()
            return x.st_size, int(x.st_mtime * 1000)

        sz, mt = st(clips / 'b.mkv')
        lb = post(f'{base}/api/locate', {'name': 'b.mkv', 'size': sz, 'mtime_ms': mt}, tok)[1]
        check(lb['matches'] == [str((clips / 'b.mkv').resolve())] and not lb['timed_out'], 'a dropped file is found by its name, size and modified time (the same name with another size is not taken)')
        sa, ma = st(clips / 'a.mp4')
        la = post(f'{base}/api/locate', {'name': 'a.mp4', 'size': sa, 'mtime_ms': ma}, tok)[1]
        check(len(la['matches']) == 2, 'the same file in two folders gives two matches, for the person to choose')
        check(post(f'{base}/api/locate', {'name': 'b.mkv', 'size': sz + 1, 'mtime_ms': mt}, tok)[1]['matches'] == [] and post(f'{base}/api/locate', {'name': 'b.mkv', 'size': sz, 'mtime_ms': mt + 60000}, tok)[1]['matches'] == [], 'a wrong size or a different modified time finds nothing')
        check(post(f'{base}/api/locate', {'name': 'notes.txt', 'size': 1, 'mtime_ms': 0}, tok)[0] == 400, 'a file that is not a video is refused')
        check(post(f'{base}/api/locate', {'name': '../../secret/b.mkv', 'size': sz, 'mtime_ms': mt}, tok)[1]['matches'] == lb['matches'], 'a dropped name with folder tricks is cut to its file name, so it cannot point elsewhere')
        sc = (clips / 'node_modules' / 'c.mp4').stat()
        check(post(f'{base}/api/locate', {'name': 'c.mp4', 'size': sc.st_size, 'mtime_ms': int(sc.st_mtime * 1000)}, tok)[1]['matches'] == [], 'folders like node_modules are not searched')
        check(jn.exists() and dm.locate('j.mp4', sj.st_size, int(sj.st_mtime * 1000))['matches'] == [], 'a junction inside a search folder is not followed, so a file that is only reachable through it is not offered')
        check(dm.locate('b.mkv', sz, mt, limit_s=0)['timed_out'] is True, 'the search stops at its time limit and says so')
        dm.remember_dirs([other / 'a.mp4'])
        check(dm.locate('a.mp4', sa, ma)['matches'] == [str((other / 'a.mp4').resolve())], 'folders the person already used are searched first, and a match there ends the search')
        dm.STATE['recent_dirs'] = []
        os.rmdir(jn)                                    # remove the junction itself first, so cleaning up can never reach through it
        check((elsewhere / 'j.mp4').is_file(), 'removing the junction left the file it pointed to untouched')
        # ---- the page
        dm.pick_files = lambda multiple: [str(clips / 'a.mp4'), str(clips / 'b.mkv')] if multiple else [str(clips / 'a.mp4')]
        films_before = len(list((tmp / 'films').glob('*.mp4')))
        with sync_playwright() as pw:
            b = pw.chromium.launch(channel=os.environ.get('MAKER_BROWSER', 'chrome'))
            ctx = b.new_context(viewport={'width': 1280, 'height': 900})
            outside = []
            ctx.on('request', lambda r: outside.append(r.url) if not r.url.startswith(base) and not r.url.startswith(('data:', 'blob:')) else None)
            page = ctx.new_page()
            errors = []
            page.on('pageerror', lambda e: errors.append(str(e)))
            page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
            print('page')
            page.goto(f'{base}/?t=testtoken&advanced=1', wait_until='load')        # advanced=1 shows the paste box these checks use (r8 hides it from Sam)
            page.wait_for_selector('#recipe option', state='attached', timeout=10000)
            opts = page.locator('#recipe option').all_inner_texts()
            check('well that is great news' in opts and any('broken.json (refused)' in o for o in opts), f'recipes are listed, and a refused one says so ({opts})')
            check(page.locator('.slot').count() == 2 and 'One or more video files.' in page.inner_text('#slots'), 'the recipe\u2019s two slots are shown, one taking many files')
            check(page.locator('#build').is_disabled(), 'Build is off until a Plan is ready')
            words = page.get_by_label('The words to find in your videos')
            check(words.input_value() == '' and words.get_attribute('placeholder') == 'well that is great news' and words.is_enabled() and 'the recipe file stays as it is' in page.inner_text('#words-note'), 'r8: a labelled box starts EMPTY with the recipe\u2019s words as grey placeholder text, and says the recipe file stays as it is')
            page.click('#plan')
            page.wait_for_selector('#plan-out .problems')
            check('Type a short phrase one of your videos really says.' in page.inner_text('#plan-out') and page.locator('#build').is_disabled(), 'r8: Plan with the words box empty asks for a phrase instead of searching for the example')
            words.fill('well that is great news')
            page.evaluate("document.getElementById('plan-out').replaceChildren()")
            check(not page.locator('details.paste').is_hidden(), 'r8: with advanced=1 the paste box is shown')
            page.screenshot(path=str(OUT / '01-recipe.png'), full_page=True)
            page.click('#plan')
            page.wait_for_selector('#plan-out .problems')
            check('has no file yet' in page.inner_text('#plan-out') and page.locator('#build').is_disabled(), 'Plan with no files lists what is missing, and Build stays off')
            page.get_by_role('button', name='Choose a file for First footage').click()
            page.wait_for_selector('.slot li')
            check(page.locator('.slot').first.locator('li').count() == 2, 'a slot that takes many files shows both files chosen')
            page.locator('summary:has-text("Paste bind lines")').click()
            page.fill('#paste', f'--bind source-2="{clips / "b.mkv"}#100-900"\nnonsense\n--bind nope-9={clips / "a.mp4"}')
            page.click('#use-paste')
            page.locator('#paste-note:not(:empty)').wait_for()
            note = page.inner_text('#paste-note')
            check('not a slot=file line' in note and 'nope-9 is not a slot' in note and 'range' not in note, f'pasted lines that do not fit are named, and a span is taken as it is ({note[:120]!r})')
            check('b.mkv#100-900' in page.locator('.slot').nth(1).inner_text(), 'the pasted span line filled the second slot')
            check(page.get_by_role('button', name='Clear the files for First footage').count() == 1 and page.get_by_role('button', name='Clear the files for Second footage').count() == 1, 'each Clear button names its slot')
            page.screenshot(path=str(OUT / '02-files.png'), full_page=True)
            page.click('#plan')
            page.wait_for_selector('#job-out .ok', timeout=30000)
            pt = page.inner_text('#plan-out') + page.inner_text('#job-out')
            check('How long the listening takes' in pt and '60 minutes of video to listen to: expect about 4 minutes' in pt and 'well-that-is-great-news-<date and time>.mp4' in pt, 'the plan summary says how long the listening will take, and the real file name')
            check('Ready to build. No film has been written yet.' in pt and 'only 0.10 to 0.90 s' in pt and 'It would cut 2 clips, about 2.96 s' in pt and '\u201cnews\u201d from b.mkv' in pt, 'Plan shows the clips ENGINE\u2019s plan found, the span in seconds, and that no film is written yet')
            check(page.locator('#build').is_enabled() and len(list((tmp / 'films').glob('*.mp4'))) == films_before, 'Build is on after a ready Plan, and Plan wrote no film')
            check('Plan ready: 2 clips, about 2.96 seconds. Build is now on.' in page.inner_text('#job-status') and page.get_attribute('#job-status', 'role') == 'status', 'a screen reader is told once, in the quiet status line, that the plan is ready')
            check(page.locator('#plan-out[aria-live], #job-out[aria-live]').count() == 0, 'the busy panels are not live regions (they are rewritten every poll)')
            page.screenshot(path=str(OUT / '03-plan.png'), full_page=True)
            page.click('#build')
            page.wait_for_selector('#job-out:has-text("Your film:")', timeout=30000)
            jt = page.inner_text('#job-out')
            check('Nothing went online (0 connections).' in jt and 'A list of where each word came from is saved beside the film.' in jt and 'network attempts' not in jt, f'Build runs ENGINE\u2019s CLI and shows the film, the clip count and the receipt\u2019s network attempts ({jt[:60]!r})')
            check('so it is short (2.4 s)' in page.inner_text('#job-out') and '\u201cwell that is great news\u201d' in page.inner_text('#job-out') and 'type a longer sentence in the box above' in page.inner_text('#job-out'), 'a short film says why it is short, and what to change')
            page.screenshot(path=str(OUT / '04-built.png'), full_page=True)
            # the results view in the page: the film plays from this computer, Open folder, the questions, and the sound warning
            res_before = len(opened)
            if REAL_FILM:
                page.locator('#results video').wait_for(state='attached', timeout=10000)
                page.wait_for_timeout(1500)
                vs = page.evaluate("""() => { const v = document.querySelector('#results video'); const c = document.createElement('canvas'); c.width = 64; c.height = 36;
                  let luma = -1; try { c.getContext('2d').drawImage(v, 0, 0, 64, 36); const d = c.getContext('2d').getImageData(0, 0, 64, 36).data; let t = 0; for (let i = 0; i < d.length; i += 4) t += (d[i] + d[i + 1] + d[i + 2]) / 3; luma = t / (d.length / 4); } catch (e) { luma = -2; }
                  return { ready: v.readyState, paused: v.paused, t: v.currentTime, w: v.videoWidth, luma }; }""")
                check(vs['ready'] >= 2 and vs['paused'] and vs['w'] > 0 and vs['luma'] > 25, f'before Play the player already shows the film\u2019s first real frame, not a black box ({vs})')
                page.locator('#results video').scroll_into_view_if_needed()
                page.locator('#results video').screenshot(path=str(OUT / '09-first-frame.png'))
            check(page.locator('#results video').count() == 1 and '/film?t=' in (page.get_attribute('#results video', 'src') or ''), 'after a build the page shows the film in a player that reads it from this computer')
            check(page.locator('#results textarea').count() == 10 and page.get_by_label('1. Did the start program open the page without help?', exact=False).count() == 1, 'the ten questions are there, each with its own label')
            page.get_by_role('button', name='Open the folder that holds the film').click()
            page.locator('#answers-note:has-text("Opened")').wait_for()
            check(len(opened) == res_before + 1, 'Open folder asks the computer to show the film (and says where)')
            page.fill('#q8', 'It is what I wanted; I would make it longer.')
            page.fill('#q10', 'Nothing would stop me.')
            page.click('#save-answers')
            page.locator('#answers-note:has-text("Saved in")').wait_for()
            saved = [f for f in (tmp / 'films').glob('my-answers*.txt') if 'I would make it longer' in f.read_text(encoding='utf8')]
            check(len(saved) == 1 and 'Nothing would stop me.' in saved[0].read_text(encoding='utf8'), 'Save my answers writes them next to the film, and the page says where')
            page.locator('#job-status:has-text("Your answers are saved in")').wait_for(state='attached', timeout=5000)
            check('Your answers are saved in' in page.text_content('#job-status'), 'a screen reader is told once that the answers are saved')
            page.screenshot(path=str(OUT / '04b-results.png'), full_page=True)
            films_after = len(list((tmp / 'films').glob('*.mp4')))
            # a chosen file with gaps in its sound: the page warns after a ready Plan, and Build is still allowed
            dm.pick_files = lambda multiple: [str(clips / 'drift.mp4')]
            page.get_by_role('button', name='Choose a file for Second footage').click()
            page.locator('.slot').nth(1).get_by_text('drift.mp4').wait_for()
            page.click('#plan')
            page.wait_for_selector('#sound-out .warn', timeout=30000)
            wt = page.inner_text('#sound-out')
            check('drift.mp4 has about 2.0 s of silence where its sound has gaps or starts late' in wt and 'nothing said in a gap can be found' in wt and 'timed wrongly' not in wt and 'Check this before you rely on the film' in wt and page.locator('#build').is_enabled(), 'a file whose sound has gaps gets a plain warning in the page, and Build is still the person\u2019s choice')
            page.locator('#job-status:has-text("2.0 s of silence")').wait_for(state='attached', timeout=5000)
            check('2.0 s of silence' in page.text_content('#job-status'), 'and a screen reader is told')
            page.screenshot(path=str(OUT / '06-sound-warning.png'), full_page=True)
            # a film that is not short gets no "short" sentence
            dm.pick_files = lambda multiple: [str(clips / 'long.mp4')]
            page.get_by_role('button', name='Choose a file for Second footage').click()
            page.locator('.slot').nth(1).get_by_text('long.mp4').wait_for()
            page.click('#plan')
            page.wait_for_selector('#job-out .ok', timeout=30000)
            page.click('#build')
            page.wait_for_selector('#job-out:has-text("12.0 s")', timeout=30000)
            check(page.locator('#short-film').count() == 0, 'a film of 12 seconds gets no "so this film is short" sentence')
            films_after = len(list((tmp / 'films').glob('*.mp4')))
            # a plan that stops: the words and what to do next
            dm.pick_files = lambda multiple: [str(clips / 'gap.mp4')]
            page.get_by_role('button', name='Choose a file for Second footage').click()
            page.locator('.slot').nth(1).get_by_text('gap.mp4').wait_for()
            page.click('#plan')
            page.wait_for_selector('#job-out:has-text("Nobody says these words")', timeout=30000)
            gt = page.inner_text('#job-out')
            check('Nobody says some of these words' in gt and 'news' in gt and 'Next: Try different words' in gt and 'Exit code' not in gt and page.locator('#build').is_disabled(), 'a plan with a missing word says which word, what to do next, and keeps Build off')
            page.screenshot(path=str(OUT / '05-gap.png'), full_page=True)
            # cancel a slow plan
            dm.pick_files = lambda multiple: [str(clips / 'slow.mp4')]
            page.get_by_role('button', name='Choose a file for Second footage').click()
            page.locator('.slot').nth(1).get_by_text('slow.mp4').wait_for()
            page.click('#plan')
            page.wait_for_selector('#cancel:not([hidden])', timeout=15000)
            page.locator('#job-out:has-text("Listening to file 3 of 3: slow.mp4")').wait_for(timeout=15000)
            check('so far, expected about' in page.inner_text('#job-out'), 'the running line names the file, the time so far and the expected time in all')
            page.locator('#job-status:has-text("Listening to your files.")').wait_for(state='attached', timeout=5000)      # the status line is set a moment after the change, on purpose
            check(page.text_content('#job-status').startswith('Listening to your files. 61 minutes of video to listen to: expect about 4 minutes') and 'cancel it' in page.inner_text('#why') and page.get_attribute('#build', 'aria-describedby') == 'why', 'while a plan runs the status line says so once, and the off buttons say why')
            page.click('#cancel')
            page.get_by_text('Cancelled.', exact=False).first.wait_for(timeout=15000)
            check(page.locator('#build').is_disabled() and len(list((tmp / 'films').glob('*.mp4'))) == films_after, 'Cancel stops the job, Build stays off, and no film was kept')
            # drag a file from a folder window onto a slot (the page sends only its name, size and modified time)
            def drop(label, name, size=0, mtime=0, target=None):
                return page.evaluate("""([label, name, size, mtime]) => {
                  const zone = [...document.querySelectorAll('.slot')].find(z => z.getAttribute('aria-label').startsWith(label + ':'));
                  const dt = new DataTransfer();
                  if (name) dt.items.add(new File([new Uint8Array(size)], name, { lastModified: mtime }));
                  const ev = new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true });
                  zone.dispatchEvent(ev);
                  return ev.defaultPrevented; }""", [label, name, size, mtime])
            for lbl in ('First footage', 'Second footage'):
                clear = page.get_by_role('button', name=f'Clear the files for {lbl}')
                if clear.count():
                    clear.click()
            dm.STATE['search_roots'] = [clips, tmp / 'other']
            dm.STATE['recent_dirs'] = []
            sz, mt = st(clips / 'b.mkv')
            drop('Second footage', 'b.mkv', sz, mt)
            page.locator('.slot').nth(1).get_by_text(str((clips / 'b.mkv').resolve())).wait_for(timeout=10000)
            check(True, 'dropping a file on a slot fills it with its real path on this computer (no typing)')
            sa, ma = st(clips / 'a.mp4')
            drop('First footage', 'a.mp4', sa, ma)
            page.locator('.slot').first.get_by_text('More than one file looks like a.mp4. Which one?').wait_for(timeout=10000)
            page.screenshot(path=str(OUT / '07-drop-choose.png'), full_page=True)
            page.locator('.slot').first.locator('.drop-note button').first.click()
            page.locator('.slot').first.locator('ul li').first.wait_for(timeout=10000)
            check(page.locator('.slot').first.locator('ul li').count() == 1 and 'a.mp4' in page.locator('.slot').first.inner_text(), 'two files look alike: the page asks which one, and the choice fills the slot')
            drop('First footage', 'nothere.mp4', 3, 12345)
            page.locator('.slot').first.get_by_text('I could not find where nothere.mp4 is on this computer').wait_for(timeout=15000)
            check('Press Choose a file instead.' in page.locator('.slot').first.inner_text(), 'a file it cannot find says so and points to Choose a file')
            drop('First footage', '')
            page.locator('.slot').first.get_by_text('I did not receive a file').wait_for(timeout=5000)
            check(True, 'a drop with no file says so in words')
            prevented = page.evaluate("""() => { const ev = new DragEvent('drop', { dataTransfer: new DataTransfer(), bubbles: true, cancelable: true }); document.body.dispatchEvent(ev); return ev.defaultPrevented; }""")
            check(prevented, 'a file dropped outside a slot is ignored (the browser does not open it)')
            # a slow search must not write "could not find" into a slot that got its file another way while it searched
            page.evaluate("""() => { const f = window.fetch; window.fetch = (u, o) => String(u).includes('/api/locate') ? new Promise(r => setTimeout(r, 1500)).then(() => f(u, o)) : f(u, o); }""")
            page.get_by_role('button', name='Clear the files for First footage').click()
            drop('First footage', 'nothere.mp4', 3, 12345)
            page.fill('#paste', f'--bind source-1={clips / "a.mp4"}')
            page.click('#use-paste')
            page.locator('.slot').first.locator('ul li').first.wait_for(timeout=5000)
            page.wait_for_timeout(3000)
            check('I could not find' not in page.locator('.slot').first.inner_text() and page.locator('.slot').first.locator('ul li').count() == 1, 'a slow search for a dropped file says nothing once the slot has a file another way')
            page.click('#plan')
            page.wait_for_selector('#job-out .ok, #plan-out .problems', timeout=30000)
            check('Your files are ready to use.' in page.inner_text('#plan-out') or page.locator('#job-out .ok').count() == 1, 'files that were dropped plan like any others')
            words.fill('oh my god')
            check(page.locator('#build').is_disabled(), 'changing the words turns Build off until Plan is pressed again')
            page.click('#plan')
            page.locator('#plan-out dd', has_text='oh my god').wait_for(timeout=30000)
            page.wait_for_selector('#job-out .ok', timeout=30000)
            check(page.locator('#build').is_enabled() and 'oh my god' in page.inner_text('#plan-out'), 'typed words are shown in the plan and Build comes on for them')
            page.screenshot(path=str(OUT / '08-typed-words.png'), full_page=True)
            page.click('#build')
            page.wait_for_selector('#job-out:has-text("Your film:")', timeout=30000)
            sf = page.inner_text('#short-film')
            check('oh my god' in sf and 'great news' not in sf, f'the short-film sentence names the words that were typed and built, not the recipe\u2019s ({sf[:70]!r})')
            check(page.get_by_role('button', name='Choose a file for First footage').count() == 1 and page.locator('summary:has-text("Paste bind lines")').count() == 1, 'the Choose a file button and the paste box are still there')
            check(not page.evaluate('document.documentElement.scrollWidth > window.innerWidth + 1'), 'no sideways scroll')
            check(not outside, f'the page contacted nothing but this server {outside[:3]}')
            check(not errors, f'no page errors {errors}')
            b.close()
        srv.shutdown()
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    print('RESULT:', 'PASS' if ok else 'FAIL')
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
