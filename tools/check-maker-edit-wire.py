"""The maker's edit routes (tools/maker_edit.py, NEXT-CONNECT 113b) against WEB's edit page in real Chrome, local only. Unlike the song check this one runs the REAL engine (the Ryagram checkout given):
Plan is run in this process with a FAKE speech model (known word times) over made-up videos, then the routes make the edit list from that plan, rebuild the preview and render with the engine's own
`build-edit` in its own process, with real ffmpeg. The operating system's picture dialog cannot be driven by a script, so the check replaces only that one function.

    python tools/check-maker-edit-wire.py <a Ryagram checkout that has ryagram/local/editbuild.py> <a folder for the screenshots>      (both required)
"""
import importlib.util
import json
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

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
if len(sys.argv) < 3:
    raise SystemExit('usage: python tools/check-maker-edit-wire.py <a Ryagram checkout that has ryagram/local/editbuild.py> <a folder for the screenshots>   (both are required)')
ENGINE = Path(sys.argv[1])
OUT = Path(sys.argv[2])
sys.path.insert(0, str(ROOT / 'tools'))
spec = importlib.util.spec_from_file_location('desktop_maker', ROOT / 'tools' / 'desktop_maker.py')
dm = importlib.util.module_from_spec(spec)
sys.modules['desktop_maker'] = dm
spec.loader.exec_module(dm)
import maker_edit as me  # noqa: E402

SR = 44100
TABLES = {'a.mp4': [('great', 200, 700), ('news', 800, 1300), ('today', 1500, 2000)], 'b.mp4': [('great', 100, 600), ('news', 700, 1200), ('everyone', 1400, 2100)]}


def http(method, url, headers=None, body=None):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, method=method, headers={**(headers or {}), **({'Content-Type': 'application/json'} if body is not None else {})})
    try:
        with urllib.request.urlopen(req, timeout=300) as r:
            return r.status, dict(r.headers), r.read()
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read()


def jget(base, path, tok):
    st, h, b = http('GET', base + path, tok)
    try:
        return st, json.loads(b)
    except ValueError:
        return st, b


def jpost(base, path, body, tok):
    st, h, b = http('POST', base + path, tok, body)
    try:
        return st, json.loads(b)
    except ValueError:
        return st, b


def until(p, js, ms=60000):
    end = time.time() + ms / 1000
    while time.time() < end:
        if p.evaluate('() => ' + js):
            return True
        time.sleep(0.15)
    raise AssertionError('timed out waiting for: ' + js)


def make_mp4(path, words, secs=2.6):
    x = np.zeros(int(secs * SR), dtype=np.float32)
    for i, (w, s, e) in enumerate(words):
        t = np.arange(int((e - s) * SR / 1000)) / SR
        x[int(s * SR / 1000):int(s * SR / 1000) + len(t)] += (0.4 * np.sin(2 * np.pi * (300 + 150 * i) * t)).astype(np.float32)
    wav = path.with_suffix('.wav')
    with wave.open(str(wav), 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes((np.clip(x, -1, 1) * 32767).astype('<i2').tobytes())
    subprocess.run([shutil.which('ffmpeg'), '-v', 'error', '-y', '-f', 'lavfi', '-i', f'color=c=0x203878:s=640x360:r=30:d={secs}', '-i', str(wav), '-t', str(secs), '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
                    '-c:a', 'aac', str(path)], check=True)
    wav.unlink()


def frame_magenta(film, t):
    r = subprocess.run([shutil.which('ffmpeg'), '-v', 'error', '-ss', f'{t:.3f}', '-i', str(film), '-frames:v', '1', '-vf', 'scale=64:36', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], capture_output=True)
    c = np.frombuffer(r.stdout, dtype=np.uint8).reshape(36, 64, 3).astype(int)[18, 32]
    return bool(c[0] > 190 and c[2] > 190 and c[1] < 70)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    tmp = Path(tempfile.mkdtemp(prefix='makeredit-'))
    ok = True
    errs, external = [], []

    def check(cond, what):
        nonlocal ok
        print(('  ok   ' if cond else '  FAIL ') + what)
        ok = ok and bool(cond)
    eng = tmp / 'engine'
    shutil.copytree(ENGINE / 'ryagram', eng / 'ryagram', ignore=shutil.ignore_patterns('__pycache__'))
    media = tmp / 'media'
    (media / 'sub').mkdir(parents=True)
    for n, w in TABLES.items():
        make_mp4(media / n, w)
    png = media / 'pic.png'
    subprocess.run([shutil.which('ffmpeg'), '-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0xff00ff:s=200x100', '-frames:v', '1', str(png)], check=True)
    (media / 'notes.png').write_text('this is text, not a picture')
    raw_png = png.read_bytes()
    (media / 'anim.png').write_bytes(raw_png[:33] + b'\x00\x00\x00\x08acTL\x00\x00\x00\x02\x00\x00\x00\x00\x00\x00\x00\x00' + raw_png[33:])
    (media / 'huge.png').write_bytes(raw_png[:16] + (10000).to_bytes(4, 'big') + (10000).to_bytes(4, 'big') + raw_png[24:])
    (tmp / 'recipes').mkdir()
    srv = dm.make_server(eng, tmp / 'recipes', tmp / 'work', tmp / 'films', port=0, token='testtoken')
    E = dm.STATE['E']
    from ryagram.library import transcribe as T  # noqa: E402

    class Fake:
        def transcribe_file(self, p, mid, language=None):
            return SimpleNamespace(words=[T.Word(mid, i, w, w, s, e - s) for i, (w, s, e) in enumerate(TABLES[Path(p).name])], language='en', audio_ms=2600)
    recipe = dm.STATE['R'].validate_recipe({'schema': 'ryagram.recipe/0', 'name': 'great news', 'slots': [{'id': 'source-1', 'label': 'First', 'accepts': 'video', 'multiple': True}, {'id': 'source-2', 'label': 'Second', 'accepts': 'video', 'multiple': True}],
                                            'find': {'op': 'words', 'text': 'great news great news today everyone', 'unit': 'words', 'slots': ['source-1', 'source-2']},
                                            'select': {'min_length': 1, 'max_length': 2, 'min_seconds': 0.05, 'max_seconds': 4.0}, 'arrange': {'order': 'text', 'join': 'cut', 'crossfade_ms': 0},
                                            'effects': {'padding': {'lead_ms': 60, 'trail_ms': 60}}, 'render': {'preset': '720p30', 'crf': 28}})
    plan = E.plan(recipe, {'source-1': [E.Bind(media / 'a.mp4')], 'source-2': [E.Bind(media / 'b.mp4')]}, tmp / 'planwork', model='base', log=lambda _m: None, transcriber_factory=lambda _m: Fake())
    plan = json.loads(json.dumps(plan))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    port = dm.STATE['port']
    base = f'http://127.0.0.1:{port}'
    tok = {'X-Maker-Token': 'testtoken'}
    picks = {'image': None, 'imgfolder': None}
    me.pick_image_dialog = lambda: picks['image']
    me.pick_image_folder_dialog = lambda: picks['imgfolder']
    try:
        print('A. the routes')
        check(http('GET', f'{base}/edit?t=testtoken')[0] == 404 and jpost(base, '/api/edit/render', {}, tok)[0] == 404, 'started without --edit, the edit page and every edit route do not exist (404)')
        check(b'id="edit-link"' not in http('GET', f'{base}/?t=testtoken')[2], 'without --edit the main page has no link to the edit page')
        me.attach(dm)
        check(me.on() is False, 'attached but not switched on: the edit module says it is off')
        dm.STATE['edit_on'] = True
        check(b'id="edit-link"' in http('GET', f'{base}/?t=testtoken')[2] and b'/edit?t=' in dm.JS.encode(), 'with --edit the main page has a link to the edit page, and its script gives the link the token')
        check(http('GET', f'{base}/edit')[0] == 403 and http('GET', f'{base}/edit?t=wrong')[0] == 403 and http('GET', f'{base}/api/edit')[0] == 403, 'the page and the list need the token')
        st, h, body = http('GET', f'{base}/edit?t=testtoken')
        check(st == 200 and b'edit.js' in body and "media-src 'self' blob:" in h.get('Content-Security-Policy', '') and "default-src 'none'" in h.get('Content-Security-Policy', ''), 'the edit page is served with WEB\u2019s own content policy')
        check(all(http('GET', f'{base}{p}')[0] == 200 for p in ('/edit.js', '/edit-model.js', '/edit.css')) and http('GET', f'{base}/edit.js', {'Host': 'evil.example'})[0] == 403, 'its script, model and style are served; another host name is refused')
        st, r = jget(base, '/api/edit', tok)
        check(st == 400 and 'Press Plan first' in r['error'], 'before any Plan the list says so in plain words')
        dm.STATE['last_plan'] = plan
        dm.STATE['last_plan_args'] = [f"source-1={media / 'a.mp4'}", f"source-2={media / 'b.mp4'}"]
        st, r = jget(base, '/api/edit', tok)
        lst = r.get('edit') if isinstance(r, dict) else None
        check(st == 200 and lst and lst['schema'] == 'ryagram.maker-edit/0' and [c['file_name'] for c in lst['clips']] == [c['file_name'] for c in plan['clips']] and all(c['words'] for c in lst['clips']), f'after Plan, the list is the rough cut: the plan\u2019s clips in order, each with its words ({st})')
        check(str(media) not in json.dumps(lst) and not re.search(r'[A-Za-z]:[\\/]', json.dumps(lst)), 'the list holds names only: no path')

        print('   save and open')
        st, r = jpost(base, '/api/edit', {'edit': lst}, tok)
        saved = tmp / 'films' / 'edit.json'
        check(st == 200 and r == {'saved': True} and json.loads(saved.read_text(encoding='utf-8')) == lst, 'save writes edit.json beside the films, the same list')
        check(jget(base, '/api/edit', tok)[1] == {'edit': lst}, 'open gives back the saved list')
        bad = json.loads(json.dumps(lst))
        bad['clips'][0]['file_name'] = 'C:\\Users\\x\\a.mp4'
        check(jpost(base, '/api/edit', {'edit': bad}, tok)[0] == 400, 'MUST-FAIL: a list with a path in a name is refused')
        bad = json.loads(json.dumps(lst))
        bad['texts'] = [{'id': 't1', 'text': 'see C:\\Users\\x\\secret.mp4', 'start_s': 0, 'length_s': 1, 'position': 'bottom'}]
        check(jpost(base, '/api/edit', {'edit': bad}, tok)[0] == 400, 'MUST-FAIL: a place on this computer hidden in the text is refused too')
        check(jpost(base, '/api/edit', {'edit': {**lst, 'schema': 'x'}}, tok)[0] == 400 and jpost(base, '/api/edit', {'edit': {**lst, 'clips': []}}, tok)[0] == 400, 'MUST-FAIL: another schema, or no clips, is refused')

        print('   pictures')
        picks['image'] = str(media / 'notes.png')
        st, r = jpost(base, '/api/image/pick', {}, tok)
        check(st == 400 and 'not a still' in r['error'], 'MUST-FAIL: a text file named .png is not a picture')
        picks['image'] = str(media / 'anim.png')
        st, r = jpost(base, '/api/image/pick', {}, tok)
        check(st == 400 and 'animated' in r['error'], 'MUST-FAIL: an animated picture is refused in words')
        picks['image'] = str(media / 'huge.png')
        st, r = jpost(base, '/api/image/pick', {}, tok)
        check(st == 400 and '25 million' in r['error'], 'MUST-FAIL: a picture of 100 million pixels is refused in words')
        picks['image'] = str(png)
        st, r = jpost(base, '/api/image/pick', {}, tok)
        img = r.get('image') if isinstance(r, dict) else None
        digest = img and img['sha256']
        check(st == 200 and img['file_name'] == 'pic.png' and (img['width'], img['height']) == (200, 100) and re.fullmatch(r'[0-9a-f]{64}', digest) and str(media) not in json.dumps(r), 'a real picture answers with its name, size and SHA-256, never a path')
        st, h, b = http('GET', base + f"/api/image/file?id={img['id']}", tok)
        check(st == 200 and b[:4] == b'\x89PNG' and http('GET', base + f"/api/image/file?id={img['id']}")[0] == 403, 'the picture is fetched with the token header (and refused without it)')
        picks['image'] = None
        check(jpost(base, '/api/image/pick', {}, tok) == (200, {}), 'closing the dialog without choosing changes nothing')

        print('   pictures from a folder (WEB item 129)')
        gal, outside = tmp / 'gallery', tmp / 'outside-pics'
        (gal / 'sub').mkdir(parents=True)
        outside.mkdir()
        (gal / 'a.png').write_bytes(raw_png + b'\x01')
        (gal / 'sub' / 'b.png').write_bytes(raw_png + b'\x00')
        (gal / 'notes.png').write_text('this is text, not a picture')
        (gal / 'anim.png').write_bytes((media / 'anim.png').read_bytes())
        (gal / 'readme.txt').write_text('not a picture type')
        (outside / 'secret.png').write_bytes(raw_png + b'\x00\x00')
        linked = subprocess.run(['cmd', '/c', 'mklink', '/J', str(gal / 'linked'), str(outside)], capture_output=True).returncode == 0
        picks['imgfolder'] = str(gal)
        st, r = jpost(base, '/api/image/folder', {}, tok)
        names = [i['file_name'] for i in (r.get('images') or [])] if isinstance(r, dict) else []
        check(st == 200 and names == ['gallery/a.png', 'gallery/sub/b.png'] and r['folder']['name'] == 'gallery' and (r['folder']['found'], r['folder']['used']) == (4, 2), f'a folder of pictures answers with folder-relative names in a fixed order, what was found and what is used ({st}, {names})')
        check(all(re.fullmatch(r'[0-9a-f]{64}', i['sha256']) and (i['width'], i['height']) == (200, 100) for i in r['images']) and str(tmp) not in json.dumps(r), 'each picture has its size and SHA-256, and no place on this computer is sent to the page')
        check('4 pictures found in gallery; 2 used' in r['folder']['message'] and '2 were not a real still picture' in r['folder']['message'], f"the sentence says what was found, used and left out ({r['folder']['message']})")
        if linked:
            check('secret.png' not in json.dumps(r), 'MUST-FAIL: a junction inside the folder is not walked into (nothing outside the folder is listed)')
        else:
            print('   NOT RUN: a junction could not be made here, so the junction check did not run (this is not a pass)')
        st2, h2, b2 = http('GET', base + f"/api/image/file?id={r['images'][1]['id']}", tok)
        check(st2 == 200 and b2[:4] == b'\x89PNG', 'a picture from the folder is served by id with the token header')
        bare = tmp / 'no-pictures'
        bare.mkdir()
        (bare / 'readme.txt').write_text('not a picture type')
        (bare / 'notes.png').write_text('this is text, not a picture')
        picks['imgfolder'] = str(bare)
        st, r = jpost(base, '/api/image/folder', {}, tok)
        check(st == 400 and 'no picture' in r['error'] and str(tmp) not in r['error'], f"MUST-FAIL: a folder with no usable picture is refused in words ({st})")
        if linked:
            (gal / 'linked').rmdir()                      # removes the link only, never what it points to
        picks['imgfolder'] = str(tmp / 'not-there')
        st, r = jpost(base, '/api/image/folder', {}, tok)
        check(st == 400 and 'not a folder' in r['error'], 'MUST-FAIL: something that is not a folder is refused')
        picks['imgfolder'] = None
        check(jpost(base, '/api/image/folder', {}, tok) == (200, {}), 'closing the folder dialog without choosing changes nothing')

        print('   the preview')
        st, r = jget(base, '/api/edit/proxy', tok)
        check(st == 200 and r['url'] is None, 'before any preview is built there is no address')
        st, r = jpost(base, '/api/edit/proxy', {'edit': lst}, tok)
        check(st == 200 and r['state'] == 'ready' and r['url'].startswith('/api/edit/proxy/file?t=testtoken'), f'rebuilding the preview answers ready with an address ({r})')
        st, h, b = http('GET', base + r['url'], None)
        pf = tmp / 'proxy-copy.mp4'
        pf.write_bytes(b)
        info = subprocess.run([shutil.which('ffmpeg'), '-hide_banner', '-i', str(pf)], capture_output=True, text=True).stderr
        check(st == 200 and '640x360' in info, 'the preview is the clips joined at 360p')
        st, h, b = http('GET', base + r['url'], {'Range': 'bytes=0-99'})
        check(st == 206 and len(b) == 100 and h.get('Content-Range', '').startswith('bytes 0-99/'), 'the preview is served with Range so the player can seek')
        check(http('GET', f'{base}/api/edit/proxy/file')[0] == 403, 'the preview needs the token')
        check(http('GET', base + f"/api/image/file?id=nope", tok)[0] == 404, 'a picture that was never picked is not there')
        mixed = json.loads(json.dumps(lst))
        mixed['clips'][0]['join'] = {'kind': 'crossfade', 's': 0.3}
        st, r = jpost(base, '/api/edit/proxy', {'edit': mixed}, tok)
        check(st == 200 and r['state'] == 'failed' and r['url'] is None, 'a list the engine cannot build (mixed joins) gives a failed preview, not a crash')

        print('   render')
        edit = json.loads(json.dumps(lst))
        edit['images'] = [{**img, 'rights_ticked': True}]
        edit['rules'] = [{'id': 'r1', 'phrase': 'great news', 'image_id': img['id'], 'seconds': 0.5, 'mode': 'full', 'fade_s': 0.1}]
        edit['clips'] = edit['clips'][1:] + edit['clips'][:1]                     # reordered: the first clip goes last
        st, r = jpost(base, '/api/edit/render', {'edit': edit}, tok)
        film = tmp / 'films' / (r.get('film') or 'none') if isinstance(r, dict) else None
        rc = json.loads(film.with_suffix('.receipt.json').read_text(encoding='utf-8')) if film and film.with_suffix('.receipt.json').is_file() else {}
        check(st == 200 and film and film.is_file() and r['message'].startswith('Your film is ready: edit-') and rc.get('kind') == 'edit', f'render builds the film the list describes and says so in plain words ({r})')
        check([c['file_name'] for c in rc.get('clips', [])] == [c['file_name'] for c in edit['clips']] and rc['overlays']['rules'][0]['times'] >= 1, 'the receipt has the clips in the LISTED order and the rule found its phrase')
        check(frame_magenta(film, rc['overlays']['rules'][0]['at'][0]['start_s'] + 0.25), 'on the decoded film the picture shows 0.25 s into the first occurrence')
        check(str(media) not in json.dumps(rc) and not re.search(r'[A-Za-z]:[\\/]', json.dumps(rc)), 'the receipt holds no path')
        check(dm.STATE.get('last_film') == str(film), 'the film opens in the maker\u2019s own player')
        edit2 = json.loads(json.dumps(edit))
        edit2['clips'][0]['join'] = {'kind': 'crossfade', 's': 0.3}
        st, r = jpost(base, '/api/edit/render', {'edit': edit2}, tok)
        check(st == 400 and 'Mixed joins' in r['error'] and '--' not in r['error'], 'MUST-FAIL: mixed joins are refused in plain words and no film is kept')
        edit3 = json.loads(json.dumps(edit))
        edit3['images'] = [{**img, 'rights_ticked': False}]
        st, r = jpost(base, '/api/edit/render', {'edit': edit3}, tok)
        check(st == 400 and 'right to use' in r['error'], 'MUST-FAIL: a picture without the rights tick is refused in plain words')
        edit4 = json.loads(json.dumps(edit))
        edit4['images'][0]['sha256'] = '0' * 64
        st, r = jpost(base, '/api/edit/render', {'edit': edit4}, tok)
        check(st == 400 and 'changed after you added it' in r['error'], 'MUST-FAIL: a picture whose hash is not the one the engine sees is refused')
        me.S()['busy'] = True
        st, r = jpost(base, '/api/edit/render', {'edit': edit}, tok)
        me.S()['busy'] = False
        check(st == 400 and 'already running' in r['error'], 'MUST-FAIL: a second render while one runs is refused')
        n_before = len(list((tmp / 'films').glob('edit-*.mp4')))
        edit5 = json.loads(json.dumps(edit))
        edit5['clips'][0]['file_name'] = 'ghost.mp4'
        st, r = jpost(base, '/api/edit/render', {'edit': edit5}, tok)
        check(st == 400 and 'no longer where it was' in r['error'] and len(list((tmp / 'films').glob('edit-*.mp4'))) == n_before, 'MUST-FAIL: a clip that is not among the videos is refused in plain words, nothing kept')

        leak = me._sentence(2, "refused: the clip broke at C:\\Users\\Someone\\clips\\a.mp4 near --media x")
        check('Someone' not in leak and '--media' not in leak and me._sentence(4, 'blocked: a network attempt was made').startswith('Blocked'), f'MUST-FAIL: an engine sentence with a place or a flag in it reaches the person without either ({leak!r})')
        print('B. the page, in real Chrome')
        try:
            from playwright.sync_api import sync_playwright
        except ImportError:
            check(False, 'playwright is not installed here: the page walk DID NOT RUN')
            raise SystemExit(0 if ok else 1)
        saved.unlink(missing_ok=True)
        check(jpost(base, '/api/edit/proxy', {'edit': lst}, tok)[1]['state'] == 'ready', 'a good preview is built again before the page opens (the failed one above is history)')
        with sync_playwright() as pw:
            b = pw.chromium.launch()
            try:
                ctx = b.new_context(viewport={'width': 1200, 'height': 900})

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
                p.get_by_role('link', name='Edit your film (after Plan)').click()
                p.wait_for_selector('html[data-ready="1"]', timeout=20000)
                check('/edit' in p.url and p.locator('ol.strip li').count() == len(plan['clips']), f'the main page\u2019s link opens the edit page on the rough cut ({p.locator("ol.strip li").count()} clips in the strip)')
                until(p, "document.getElementById('status').textContent === 'Preview is ready'", 60000)
                check(p.locator('.film video').count() == 1, 'the preview video from the maker is in the page')
                p.get_by_role('tab', name='Images and text').click()
                picks['image'] = str(png)
                p.get_by_role('button', name='Add a picture').click()
                p.wait_for_selector('text=pic.png')
                p.screenshot(path=str(OUT / 'edit-wire-1.png'), full_page=True)
                p.get_by_role('tab', name='Clips').click()
                p.locator('button.card').nth(1).click()
                p.get_by_role('button', name='Move earlier').click()
                p.get_by_role('button', name='Save my edit').click()
                until(p, "document.getElementById('save') && /Saved|saved/.test(document.getElementById('save').textContent + document.getElementById('live').textContent)", 15000)
                check(saved.is_file() and json.loads(saved.read_text(encoding='utf-8'))['clips'][0]['id'] == 'c%d' % plan['clips'][1]['n'], 'the clip moved on the page is moved in the saved list')
                n_films = len(list((tmp / 'films').glob('edit-*.mp4')))
                p.locator('#render').click()
                until(p, "!document.getElementById('render').disabled", 180000)
                check(len(list((tmp / 'films').glob('edit-*.mp4'))) == n_films + 1 and 'Your film is ready' in p.locator('#live').inner_text(), 'Render: the maker builds the film and the page says so in plain words')
                print('   page says:', p.evaluate("() => [document.getElementById('live').textContent, (document.getElementById('msg') || {}).textContent]"))
                p.screenshot(path=str(OUT / 'edit-wire-2.png'), full_page=True)
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
