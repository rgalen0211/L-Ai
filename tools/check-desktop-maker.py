"""The desktop maker (tools/desktop_maker.py) in real Chrome at 1280 px, local only, plus its safety rules. It runs the REAL recipe check and bind check (including the START_MS-END_MS spans) from ENGINE's
local-ranges checkout; the PLAN and BUILD steps run a stand-in `ryagram.local` (a copy of that checkout whose __main__ prints a plan, writes a tiny fake MP4 and receipt, sleeps for slow.mp4, or exits
with a chosen code for gap.mp4, boom.mp4, net.mp4 and refuse.mp4), so no speech model and no ffmpeg are needed here. The operating system's file dialog cannot be driven by a script, so the check replaces
only that one function. Screenshots go to the out folder.

    python tools/check-desktop-maker.py <path to a Ryagram checkout with ryagram/local and its plan command> [outdir]       (default D:/Ryagram-scratch/WEB/engine-lr, D:/Ryagram-scratch/WEB/maker-shots)
"""
import importlib.util
import json
import shutil
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
if "slow.mp4" in joined:
    time.sleep(60)
clips = [{"n": 1, "words": "well that is great", "file_name": "a.mp4", "slot": "source-1", "start_ms": 7930, "end_ms": 9970, "duration_ms": 2040},
         {"n": 2, "words": "news", "file_name": "b.mkv", "slot": "source-2", "start_ms": 100, "end_ms": 900, "duration_ms": 800}]
if cmd == "plan":
    work.mkdir(parents=True, exist_ok=True); (work / "heard.txt").write_text("words")
    gap = "gap.mp4" in joined
    print(json.dumps({"ok": not gap, "gaps": ["news"] if gap else [], "clips": [] if gap else clips, "seconds_estimate": 2.96, "would_write": out.name, "model": "base", "network_attempts": 0}))
    sys.exit(3 if gap else 0)
out.parent.mkdir(parents=True, exist_ok=True)
out.write_bytes(b"\\x00\\x00\\x00\\x18ftypmp42")
if "buildfail.mp4" in joined:
    out.with_suffix(".receipt.json").write_text("{}"); print("a cut failed", file=sys.stderr); sys.exit(1)
if "slowbuild.mp4" in joined:
    print("joining ...", file=sys.stderr, flush=True); time.sleep(60)
out.with_suffix(".receipt.json").write_text(json.dumps({"schema": "ryagram.local-receipt/0", "recipe": "stub", "film": out.name, "seconds": 2.4, "model": "base", "network_attempts": 0, "clips": clips, "reused_words": (work / "heard.txt").is_file(), "work": str(work), "wall_seconds": 0.1}))
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


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    tmp = Path(tempfile.mkdtemp(prefix='maker-'))          # the computer's own TEMP, nothing assumes a D: drive
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
        for n in ('a.mp4', 'b.mkv', 'slow.mp4', 'gap.mp4', 'boom.mp4', 'net.mp4', 'refuse.mp4', 'buildfail.mp4', 'slowbuild.mp4'):
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
        check(st == 200 and b'type="file"' not in body and b'<input' not in body, 'the page has no file input: nothing can be uploaded')
        check("default-src 'none'" in h.get('Content-Security-Policy', '') and "connect-src 'self'" in h['Content-Security-Policy'], 'a strict policy: only this server, no inline script')
        check(post(f'{base}/api/check', {'recipe': '../../etc/x.json', 'binds': {}}, tok)[1]['problems'][0].startswith('That recipe is not in the recipes folder'), 'a recipe name with folder tricks is refused')
        text = ' '.join(post(f'{base}/api/check', {**sl, 'binds': {'source-1': [str(clips / 'notes.txt')], 'source-2': ['http://example.com/a.mp4']}}, tok)[1]['problems'])
        check('not a video file' in text and 'not an address' in text, f'a text file and a web address are refused by ENGINE\u2019s own bind check ({text[:90]!r})')
        text = ' '.join(post(f'{base}/api/check', {**sl, 'binds': {'source-1': [str(clips / 'a.mp4') + '#900-100'], 'source-2': [str(clips / 'b.mkv')]}}, tok)[1]['problems'])
        check('empty or backwards' in text, f'a backwards span is refused with ENGINE\u2019s sentence ({text[:90]!r})')
        pc = post(f'{base}/api/check', {**sl, 'binds': {'source-1': [str(clips / 'a.mp4') + '#100-900'], 'source-2': [str(clips / 'b.mkv')]}}, tok)[1]
        check(pc['ok'] and 'only 0.10 to 0.90 s' in pc['slots'][0]['files'][0]['name'], 'a START_MS-END_MS span is accepted and shown in seconds')
        check(post(f'{base}/api/build', {**sl, 'binds': good}, tok)[0] == 400, 'Build without a Plan is refused')
        # ---- the plan job, the work folder reuse, and a Build only for what was planned
        print('jobs')
        check(post(f'{base}/api/plan', {**sl, 'binds': good}, tok)[0] == 200, 'Plan starts ENGINE\u2019s plan command')
        j = wait_job(base, tok, ('planned', 'gaps', 'stopped'))
        check(j['state'] == 'planned' and len(j['plan']['clips']) == 2 and not (tmp / 'films').exists(), f'Plan ends ready with 2 clips and writes no film ({j["state"]})')
        check(post(f'{base}/api/build', {**sl, 'binds': {**good, 'source-2': [str(clips / 'a.mp4')]}}, tok)[0] == 400, 'Build for different files than the Plan was for is refused')
        check(post(f'{base}/api/build', {**sl, 'binds': good}, tok)[0] == 200, 'Build for exactly the planned files starts')
        j = wait_job(base, tok, ('built', 'stopped'))
        films = list((tmp / 'films').glob('*.mp4'))
        receipt = json.loads(films[0].with_suffix('.receipt.json').read_text()) if films else {}
        check(j['state'] == 'built' and len(films) == 1 and receipt.get('reused_words') is True, 'Build writes the film and its receipt, in the SAME work folder as Plan, so the words Plan heard are reused')
        # every exit code in words, with what to do next
        for fname, state, code, needle, nxt in (('gap.mp4', 'gaps', 3, 'do not say every word', 'Add a file'), ('boom.mp4', 'stopped', 1, 'unexpected', 'Press Plan again'),
                                                ('net.mp4', 'stopped', 4, 'network', 'Do not use this film'), ('refuse.mp4', 'stopped', 2, 'Refused', 'Fix it')):
            post(f'{base}/api/plan', {**sl, 'binds': {'source-1': [str(clips / 'a.mp4')], 'source-2': [str(clips / fname)]}}, tok)
            j = wait_job(base, tok, ('planned', 'gaps', 'stopped'))
            check(j['state'] == state and j.get('code') == code and needle in j['words'] and nxt in j['next'], f'exit code {code} ({fname}): {j.get("words", "")[:60]!r} then {j.get("next", "")[:40]!r}')
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
            names = sorted(f.name for f in (tmp / 'films').glob('*'))
            check(j['state'] in ('stopped', 'cancelled') and len(names) == 2, f'a build that {how} keeps no film and no receipt (only the one earlier film and its receipt remain: {len(names)} files)')
        # ---- the page
        dm.pick_files = lambda multiple: [str(clips / 'a.mp4'), str(clips / 'b.mkv')] if multiple else [str(clips / 'a.mp4')]
        films_before = len(list((tmp / 'films').glob('*.mp4')))
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
            check(page.locator('#build').is_disabled(), 'Build is off until a Plan is ready')
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
            check('Ready to build. No film has been written yet.' in pt and 'only 0.10 to 0.90 s' in pt and 'It would cut 2 clips, about 2.96 s' in pt and '\u201cnews\u201d from b.mkv' in pt, 'Plan shows the clips ENGINE\u2019s plan found, the span in seconds, and that no film is written yet')
            check(page.locator('#build').is_enabled() and len(list((tmp / 'films').glob('*.mp4'))) == films_before, 'Build is on after a ready Plan, and Plan wrote no film')
            check('Plan ready: 2 clips, about 2.96 seconds. Build is now on.' in page.inner_text('#job-status') and page.get_attribute('#job-status', 'role') == 'status', 'a screen reader is told once, in the quiet status line, that the plan is ready')
            check(page.locator('#plan-out[aria-live], #job-out[aria-live]').count() == 0, 'the busy panels are not live regions (they are rewritten every poll)')
            page.screenshot(path=str(OUT / '03-plan.png'), full_page=True)
            page.click('#build')
            page.wait_for_selector('#job-out:has-text("Your film:")', timeout=30000)
            jt = page.inner_text('#job-out')
            check('network attempts: 0' in jt and 'A receipt is beside it.' in jt, f'Build runs ENGINE\u2019s CLI and shows the film, the clip count and the receipt\u2019s network attempts ({jt[:60]!r})')
            page.screenshot(path=str(OUT / '04-built.png'), full_page=True)
            films_after = len(list((tmp / 'films').glob('*.mp4')))
            # a plan that stops: the words and what to do next
            dm.pick_files = lambda multiple: [str(clips / 'gap.mp4')]
            page.get_by_role('button', name='Choose a file for Second footage').click()
            page.locator('.slot').nth(1).get_by_text('gap.mp4').wait_for()
            page.click('#plan')
            page.wait_for_selector('#job-out:has-text("Not said anywhere")', timeout=30000)
            gt = page.inner_text('#job-out')
            check('do not say every word' in gt and 'news' in gt and 'Next: Add a file' in gt and page.locator('#build').is_disabled(), 'a plan with a missing word says which word, what to do next, and keeps Build off')
            page.screenshot(path=str(OUT / '05-gap.png'), full_page=True)
            # cancel a slow plan
            dm.pick_files = lambda multiple: [str(clips / 'slow.mp4')]
            page.get_by_role('button', name='Choose a file for Second footage').click()
            page.locator('.slot').nth(1).get_by_text('slow.mp4').wait_for()
            page.click('#plan')
            page.wait_for_selector('#cancel:not([hidden])', timeout=15000)
            check(page.inner_text('#job-status') == 'Listening to your files.' and 'cancel it' in page.inner_text('#why') and page.get_attribute('#build', 'aria-describedby') == 'why', 'while a plan runs the status line says so once, and the off buttons say why')
            page.click('#cancel')
            page.get_by_text('Cancelled.', exact=False).first.wait_for(timeout=15000)
            check(page.locator('#build').is_disabled() and len(list((tmp / 'films').glob('*.mp4'))) == films_after, 'Cancel stops the job, Build stays off, and no film was kept')
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
