"""The desktop maker (tools/desktop_maker.py) in real Chrome at 1280 px, local only, plus its safety rules. It runs the REAL recipe check and bind check from ENGINE's local-mvp checkout; the BUILD step runs
a stand-in `ryagram.local` (a copy of that checkout whose __main__ only writes a tiny fake MP4 and receipt, or sleeps for a file named slow.mp4), so no speech model and no ffmpeg are needed here. The operating
system's file dialog cannot be driven by a script, so the check replaces only that one function. Screenshots go to the out folder.

    python tools/check-desktop-maker.py <path to a Ryagram checkout with ryagram/local> [outdir]       (default outdir D:/Ryagram-scratch/WEB/maker-shots)
"""
import importlib.util
import json
import shutil
import sys
import tempfile
import threading
import urllib.error
import urllib.request
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
ENGINE = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('D:/Ryagram-scratch/WEB/engine-lm')
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
out = Path(a[a.index("--out") + 1])
binds = [x for x in a if "=" in x and not x.startswith("--")]
print("indexing ...", flush=True)
if any("slow" in b for b in binds):
    time.sleep(60)
out.parent.mkdir(parents=True, exist_ok=True)
out.write_bytes(b"\\x00\\x00\\x00\\x18ftypmp42")
out.with_suffix(".receipt.json").write_text(json.dumps({"schema": "ryagram.local-receipt/0", "recipe": "stub", "film": out.name, "seconds": 2.4, "model": "base", "network_attempts": 0, "clips": [{"n": 1}], "wall_seconds": 0.1}))
print("built", out.name, flush=True)
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


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    tmp = Path(tempfile.mkdtemp(prefix='maker-', dir='D:/Ryagram-scratch/WEB/temp'))
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
        for n in ('a.mp4', 'b.mkv', 'slow.mp4'):
            (clips / n).write_bytes(b'not really a video; Plan only looks at the name and that it exists')
        (clips / 'notes.txt').write_text('x')
        srv = dm.make_server(eng, recipes, tmp / 'work', tmp / 'films', port=0, token='testtoken')
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        port = dm.STATE['port']
        base = f'http://127.0.0.1:{port}'
        tok = {'X-Maker-Token': 'testtoken'}
        # ---- the safety rules, without a browser
        print('safety')
        check(get(f'{base}/')[0] == 403, 'the page without the token is refused')
        check(get(f'{base}/api/recipes', {'Host': 'evil.example', **tok})[0] == 403, 'a request that names another host is refused (no DNS rebinding)')
        st, h, body = get(f'{base}/?t=testtoken')
        check(st == 200 and b'type="file"' not in body and b'<input' not in body, 'the page has no file input: nothing can be uploaded')
        check("default-src 'none'" in h.get('Content-Security-Policy', '') and "connect-src 'self'" in h['Content-Security-Policy'], 'a strict policy: only this server, no inline script')
        check(post(f'{base}/api/plan', {'recipe': '../../etc/x.json', 'binds': {}}, tok)[1]['problems'][0].startswith('That recipe is not in the recipes folder'), 'a recipe name with folder tricks is refused')
        sl = {'recipe': 'great-news.json', 'model': 'base'}
        p = post(f'{base}/api/plan', {**sl, 'binds': {'source-1': [str(clips / 'notes.txt')], 'source-2': ['http://example.com/a.mp4']}}, tok)[1]
        text = ' '.join(p['problems'])
        check('not a video file' in text and 'not an address' in text, f'a text file and a web address are refused by ENGINE\u2019s own bind check ({text[:120]!r})')
        check(post(f'{base}/api/build', {**sl, 'binds': {}}, tok)[0] == 400, 'Build without a good Plan is refused')
        # ---- the page
        dm.pick_files = lambda multiple: [str(clips / 'a.mp4'), str(clips / 'b.mkv')] if multiple else [str(clips / 'a.mp4')]
        with sync_playwright() as pw:
            b = pw.chromium.launch(channel='chrome')
            ctx = b.new_context(viewport={'width': 1280, 'height': 900})
            outside = []
            ctx.on('request', lambda r: outside.append(r.url) if not r.url.startswith(base) and not r.url.startswith(('data:', 'blob:')) else None)
            page = ctx.new_page()
            errors = []
            page.on('pageerror', lambda e: errors.append(str(e)))
            page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
            print('page')
            page.goto(f'{base}/?t=testtoken', wait_until='load')
            page.wait_for_selector('#recipe option', state='attached', timeout=10000)
            opts = page.locator('#recipe option').all_inner_texts()
            check('well that is great news' in opts and any('broken.json (refused)' in o for o in opts), f'recipes are listed, and a refused one says so ({opts})')
            check(page.locator('.slot').count() == 2 and 'One or more video files.' in page.inner_text('#slots'), 'the recipe\u2019s two slots are shown, one taking many files')
            check('Finds the words' in page.inner_text('#recipe-note'), 'the recipe says what it finds')
            check(page.locator('#build').is_disabled(), 'Build is off until a Plan is ready')
            page.screenshot(path=str(OUT / '01-recipe.png'), full_page=True)
            page.click('#plan')
            page.wait_for_selector('#plan-out .problems')
            pt = page.inner_text('#plan-out')
            check('has no file yet' in pt and page.locator('#build').is_disabled(), 'Plan with no files lists what is missing, and Build stays off')
            page.get_by_role('button', name='Choose a file for First footage').click()
            page.wait_for_selector('.slot li')
            check(page.locator('.slot').first.locator('li').count() == 2, 'a slot that takes many files shows both files chosen')
            page.locator('summary:has-text("Paste bind lines")').click()
            page.fill('#paste', f'--bind source-2="{clips / "a.mp4"}#100-900"\n--bind source-2={clips / "a.mp4"}\nnonsense\n--bind nope-9={clips / "a.mp4"}')
            page.click('#use-paste')
            page.locator('#paste-note:not(:empty)').wait_for()
            note = page.inner_text('#paste-note')
            check('range after the file name is not supported' in note and 'not a slot=file line' in note and 'nope-9 is not a slot' in note, f'pasted lines that do not fit are named, never guessed ({note[:140]!r})')
            check('a.mp4' in page.locator('.slot').nth(1).inner_text(), 'the good pasted line filled the second slot')
            page.screenshot(path=str(OUT / '02-files.png'), full_page=True)
            page.click('#plan')
            page.wait_for_selector('#plan-out .ok')
            pt = page.inner_text('#plan-out')
            check('Ready to build. Nothing has been written yet.' in pt and 'a.mp4' in pt and 'none (the build has a guard' in pt and 'Speech model' in pt, 'Plan says what Build will do and that nothing is written yet')
            check(page.locator('#build').is_enabled() and not (tmp / 'films').exists(), 'Build is on, and nothing has been written (no films folder yet)')
            page.screenshot(path=str(OUT / '03-plan.png'), full_page=True)
            page.click('#build')
            page.wait_for_selector('#job-out .ok', timeout=30000)
            jt = page.inner_text('#job-out')
            films = list((tmp / 'films').glob('*.mp4'))
            check('Built.' in jt and len(films) == 1 and films[0].with_suffix('.receipt.json').is_file(), f'Build runs ENGINE\u2019s CLI and the film and its receipt are in the out folder ({jt[:80]!r})')
            check('network attempts: 0' in jt, 'the receipt\u2019s network attempts (0) are shown')
            page.screenshot(path=str(OUT / '04-built.png'), full_page=True)
            # cancel a slow build
            dm.pick_files = lambda multiple: [str(clips / 'slow.mp4')]
            page.get_by_role('button', name='Choose a file for Second footage').click()
            page.locator('.slot').nth(1).get_by_text('slow.mp4').wait_for()
            page.click('#plan')
            page.wait_for_selector('#plan-out .ok')
            page.click('#build')
            page.wait_for_selector('#cancel:not([hidden])', timeout=10000)
            page.click('#cancel')
            page.get_by_text('Cancelled.', exact=False).wait_for(timeout=15000)
            check(len(list((tmp / 'films').glob('*.mp4'))) == 1, 'Cancel stops the build, and no second film was kept')
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
