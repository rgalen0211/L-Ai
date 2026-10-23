"""A whole folder of videos on the maker's MAIN page (Ryan 13:10: "the user can point at one or more folders"). Real engine (the Ryagram checkout given: it must have engine.expand_folder), real Chrome, local
only. The operating system's folder dialog cannot be driven by a script, so the check replaces only that one function.

    python tools/check-maker-folder.py <a Ryagram checkout that has engine.expand_folder> <a folder for the screenshots>      (both required)
"""
import importlib.util
import json
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if len(sys.argv) < 3:
    raise SystemExit('usage: python tools/check-maker-folder.py <a Ryagram checkout that has engine.expand_folder> <a folder for the screenshots>   (both are required)')
ENGINE = Path(sys.argv[1])
OUT = Path(sys.argv[2])
sys.path.insert(0, str(ROOT / 'tools'))
spec = importlib.util.spec_from_file_location('desktop_maker', ROOT / 'tools' / 'desktop_maker.py')
dm = importlib.util.module_from_spec(spec)
sys.modules['desktop_maker'] = dm
spec.loader.exec_module(dm)

RECIPE = {"schema": "ryagram.recipe/0", "name": "great news", "slots": [{"id": "source-1", "label": "Your videos", "accepts": "video", "multiple": True}, {"id": "source-2", "label": "One more video", "accepts": "video", "multiple": False}],
          "find": {"op": "words", "text": "great news", "unit": "words", "slots": ["source-1", "source-2"]},
          "select": {"min_length": 1, "max_length": 2, "min_seconds": 0.05, "max_seconds": 4.0}, "arrange": {"order": "text", "join": "cut", "crossfade_ms": 0},
          "effects": {"padding": {"lead_ms": 60, "trail_ms": 60}}, "render": {"preset": "720p30", "crf": 28}}


def http(method, url, headers=None, body=None):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, method=method, headers={**(headers or {}), **({'Content-Type': 'application/json'} if body is not None else {})})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, json.loads(r.read() or b'null')
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b'null')


def mk(path):
    path.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run([shutil.which('ffmpeg'), '-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0x203878:s=160x90:r=10:d=1', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=1', '-t', '1', '-pix_fmt', 'yuv420p', '-c:a', 'aac', str(path)], check=True)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    tmp = Path(tempfile.mkdtemp(prefix='makerfolder-'))
    ok = True
    errs, external = [], []

    def check(cond, what):
        nonlocal ok
        print(('  ok   ' if cond else '  FAIL ') + what)
        ok = ok and bool(cond)
    eng = tmp / 'engine'
    shutil.copytree(ENGINE / 'ryagram', eng / 'ryagram', ignore=shutil.ignore_patterns('__pycache__'))
    recipes = tmp / 'recipes'
    recipes.mkdir()
    (recipes / 'great-news.json').write_text(json.dumps(RECIPE), encoding='utf-8')
    folder = tmp / 'my clips'
    for rel in ('b.mp4', 'a.mp4', 'sub/c.mp4', 'sub/deep/d.mkv'):
        mk(folder / rel)
    (folder / 'notes.txt').write_text('x')
    mk(folder / '.hidden' / 'z.mp4')
    (tmp / 'empty').mkdir()
    single = tmp / 'one.mp4'
    mk(single)
    srv = dm.make_server(eng, recipes, tmp / 'work', tmp / 'films', port=0, token='testtoken')
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    base = f'http://127.0.0.1:{dm.STATE["port"]}'
    tok = {'X-Maker-Token': 'testtoken'}
    dm.faster_whisper_missing = lambda: False
    picks = {'folder': None}
    dm.pick_folder_path = lambda: picks['folder']
    E = dm.STATE['E']
    try:
        print('A. the route and the check')
        check(hasattr(E, 'expand_folder'), 'the engine has expand_folder')
        picks['folder'] = None
        check(http('POST', base + '/api/pick-folder', tok, {}) == (200, {'folder': None}), 'closing the dialog without choosing changes nothing')
        picks['folder'] = str(folder)
        st, r = http('POST', base + '/api/pick-folder', tok, {})
        check(st == 200 and (r['found'], r['used']) == (4, 4) and r['message'] == 'Using all 4 videos in “my clips”.', f'a folder answers how many videos it found and uses, in the engine’s own sentence ({r.get("message")!r})')
        check(http('POST', base + '/api/pick-folder', None, {})[0] == 403, 'the route needs the token')
        picks['folder'] = str(tmp / 'empty')
        st, r = http('POST', base + '/api/pick-folder', tok, {})
        check(st == 400 and 'no videos in the folder' in r['error'], 'MUST-FAIL: a folder with no videos is refused in words')
        keep = E.expand_folder
        del E.expand_folder
        picks['folder'] = str(folder)
        st, r = http('POST', base + '/api/pick-folder', tok, {})
        E.expand_folder = keep
        check(st == 400 and 'cannot read a whole folder' in r['error'], 'MUST-FAIL: an engine that cannot read folders says so in plain words')
        keep_cap = E.MAX_FOLDER_FILES
        E.MAX_FOLDER_FILES = 2
        picks['folder'] = str(folder)
        st, r = http('POST', base + '/api/pick-folder', tok, {})
        E.MAX_FOLDER_FILES = keep_cap
        check(st == 200 and (r['found'], r['used']) == (4, 2) and 'Found 4 videos' in r['message'] and 'uses the first 2' in r['message'], 'MUST-FAIL: more than the cap is said plainly (found 4, uses the first 2)')
        body = {'recipe': 'great-news.json', 'model': 'base', 'binds': {'source-1': [str(folder)], 'source-2': [str(single)]}}
        st, pc = http('POST', base + '/api/check', tok, body)
        files = pc['slots'][0]['files']
        check(st == 200 and len(files) == 1 and files[0]['count'] == 4 and 'my clips (a folder: 4 videos)' in files[0]['name'] and files[0]['message'].startswith('Using all 4'), 'Check lists the folder ONCE, with its count and the engine’s sentence (not four lines)')
        check(pc['bind_count'] == 5 and pc['folders'] and pc['folders'][0]['folder'] == 'my clips', 'the progress count is the real number of files (4 in the folder and 1 alone)')
        check(pc['ok'], f'a folder in a many-files slot is fine ({pc["problems"]})')
        body2 = {**body, 'binds': {'source-1': [str(folder)], 'source-2': [str(folder)]}}
        st, pc2 = http('POST', base + '/api/check', tok, body2)
        check(not pc2['ok'] and any('takes one file' in x for x in pc2['problems']), 'MUST-FAIL: a folder in a slot that takes one file is refused in plain words')

        print('B. the page, in real Chrome')
        try:
            from playwright.sync_api import sync_playwright
        except ImportError:
            check(False, 'playwright is not installed here: the page walk DID NOT RUN')
            raise SystemExit(0 if ok else 1)
        with sync_playwright() as pw:
            b = pw.chromium.launch()
            try:
                ctx = b.new_context(viewport={'width': 1100, 'height': 1000})

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
                p.wait_for_selector('#slots .slot', timeout=20000)
                picks['folder'] = str(folder)
                btns = p.get_by_role('button', name=re.compile('Choose a whole folder of videos'))
                check(btns.count() == 1, 'only the slot that takes many videos has a folder button')
                btns.click()
                p.wait_for_selector('text=Using all 4 videos')
                check(str(folder) in p.locator('#slots').inner_text() and 'Using all 4 videos in “my clips”.' in p.locator('#slots').inner_text(), 'the page lists the folder and says what the run uses, in the engine’s sentence')
                p.screenshot(path=str(OUT / 'folder-1.png'), full_page=True)
                p.get_by_role('button', name=re.compile('Clear the files for Your videos')).click()
                check('Using all 4' not in p.locator('#slots').inner_text(), 'Clear takes the folder and its sentence away')
                ctx.close()
            finally:
                b.close()
        check(not errs, f'no page errors or console errors ({errs[:2]})')
        check(not external, f'every request to another host was refused ({len(external)})')
    finally:
        srv.shutdown()
    print('RESULT: ' + ('PASS' if ok else 'FAIL'))
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
