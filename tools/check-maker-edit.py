"""The edit-and-preview page (tools/maker-edit/) in real Chrome, LOCAL server only. No request leaves 127.0.0.1.

Part A, the practice cut (?fixture): scrub every second and compare what the page draws with what the edit list says; keyboard on the scrubber; add a picture, tick the rights box, add the rule
"every time <phrase> is said", turn captions on, switch the look, reorder a clip, add text; save, reload, and check the SAME list and the SAME picture at every half second; warnings; every control has a name;
the phone width has no sideways scroll and big enough buttons; a second Render press is refused while one runs.
Part B, the maker host: a tiny stand-in for the maker's local server (token on every call) serves the page's /api calls; load, add a picture, save, render are checked against what the server received.
Writes screenshots. Not part of the node suite (needs Chrome).

    python tools/check-maker-edit.py [outdir]      (default D:/Ryagram-scratch/WEB/maker-edit-shots)
"""
import http.server
import json
import socketserver
import sys
import threading
from pathlib import Path
from urllib.parse import urlparse, parse_qs

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1] / 'tools' / 'maker-edit'
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('D:/Ryagram-scratch/WEB/maker-edit-shots')
PORT = 8197
TOKEN = 'tok123'
STATE = {'edit': None, 'saved': [], 'renders': 0, 'picks': 0}
SVG = b'<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="#7a2a6f"/></svg>'
PIC = {'id': 'img-api', 'file_name': 'api-picture.png', 'sha256': 'cd' * 32, 'width': 400, 'height': 300}


class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=str(ROOT), **k)

    def log_message(self, *a):
        pass

    def _json(self, code, obj):
        b = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def _api(self, method):
        u = urlparse(self.path)
        q = parse_qs(u.query)
        tok = self.headers.get('X-Maker-Token') or (q.get('t') or [''])[0]
        if tok != TOKEN:
            return self._json(403, {'error': 'Open the address the maker printed when it started (it has the token in it).'})
        body = {}
        if method == 'POST':
            n = int(self.headers.get('Content-Length') or 0)
            body = json.loads(self.rfile.read(n) or b'{}')
        if u.path == '/api/edit' and method == 'GET':
            return self._json(200, {'edit': STATE['edit']})
        if u.path == '/api/edit' and method == 'POST':
            STATE['saved'].append(body['edit'])
            return self._json(200, {'saved': True})
        if u.path == '/api/edit/proxy':
            return self._json(200, {'state': 'ready', 'url': None})
        if u.path == '/api/image/pick':
            STATE['picks'] += 1
            return self._json(200, {'image': PIC})
        if u.path == '/api/image/file':
            self.send_response(200)
            self.send_header('Content-Type', 'image/svg+xml')
            self.send_header('Content-Length', str(len(SVG)))
            self.end_headers()
            self.wfile.write(SVG)
            return None
        if u.path == '/api/edit/render':
            STATE['renders'] += 1
            return self._json(200, {'message': 'The render has started.'})
        return self._json(404, {'error': 'Not found.'})

    def do_GET(self):
        if self.path.startswith('/api/'):
            return self._api('GET')
        return super().do_GET()

    def do_POST(self):
        return self._api('POST')


ok = True


def check(c, w):
    global ok
    print(('  ok   ' if c else '  FAIL ') + w)
    ok = ok and bool(c)


NAMES_JS = """() => [...document.querySelectorAll('button, input, select')].filter(e => e.type !== 'hidden').filter(e => {
  const lab = (e.labels && e.labels.length) || e.getAttribute('aria-label') || e.getAttribute('aria-labelledby') || (e.textContent || '').trim();
  return !lab; }).map(e => e.outerHTML.slice(0, 80))"""

DRAWN_JS = """() => [...document.querySelectorAll('.layer .ov')].map(e => e.dataset.kind + ':' + e.dataset.id).sort()"""


def until(p, js, ms=8000):
    """Poll a page expression (the page's content policy forbids Playwright's string-eval wait_for_function)."""
    import time
    end = time.time() + ms / 1000
    while time.time() < end:
        if p.evaluate('() => ' + js):
            return True
        time.sleep(0.05)
    raise AssertionError('timed out waiting for: ' + js)


def drawn_matches(p, t):
    p.evaluate("t => { const r = document.getElementById('scrub'); r.value = String(t); r.dispatchEvent(new Event('input', { bubbles: true })); }", t)
    want = p.evaluate("t => window.ryagramEdit.frame(t).active.map(a => a.kind + ':' + a.id).sort()", t)
    got = p.evaluate(DRAWN_JS)
    return want == got, want, got


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    socketserver.TCPServer.allow_reuse_address = True
    srv = socketserver.ThreadingTCPServer(('127.0.0.1', PORT), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    base = f'http://127.0.0.1:{PORT}'
    external = []
    try:
        with sync_playwright() as pw:
            b = pw.chromium.launch(channel='chrome')
            try:
                def make_route():
                    def route(r):
                        if not r.request.url.startswith('http://127.0.0.1') and not r.request.url.startswith('data:'):
                            external.append(r.request.url)
                            return r.abort()
                        return r.continue_()
                    return route

                ctx = b.new_context(viewport={'width': 1000, 'height': 1000})
                ctx.route('**/*', make_route())
                p = ctx.new_page()
                errs = []
                p.on('pageerror', lambda e: errs.append(str(e)))
                p.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
                print('A. the practice cut')
                p.goto(f'{base}/edit.html?fixture', wait_until='load')
                p.wait_for_selector('html[data-ready="1"]', timeout=15000)
                total = p.evaluate('window.ryagramEdit.model.timeline(window.ryagramEdit.edit).total_s')
                check(total > 5, f'the practice cut opens ({total} s, {p.locator("ol.strip li").count()} clips in the strip)')
                check(p.locator('#status').inner_text() == 'Preview is ready', 'the preview says it is ready')
                p.screenshot(path=str(OUT / 'edit-1-open-dark.png'))

                print('   scrub every second, then the keyboard')
                bad = []
                for t in range(0, int(total) + 1):
                    same, want, got = drawn_matches(p, float(t))
                    if not same:
                        bad.append((t, want, got))
                check(not bad, f'at every second 0..{int(total)} the page draws what the edit list says')
                p.evaluate("window.ryagramEdit.setT(0)")
                p.locator('#scrub').focus()
                for _ in range(5):
                    p.keyboard.press('ArrowRight')
                tv = float(p.locator('#scrub').input_value())
                check(abs(tv - 0.5) < 0.01 and '0:00.5' in p.locator('#time').inner_text(), f'five arrow presses move the scrubber to {tv} s and the time reads {p.locator("#time").inner_text()}')

                print('   pictures, the rule, captions, text')
                p.get_by_role('tab', name='Images and text').click()
                p.get_by_role('button', name='Add a picture').click()
                p.wait_for_selector('text=demo-star.png')
                p.fill('#r-phrase', 'great news')
                p.get_by_role('button', name='Add this rule').click()
                check('not draw' in ' '.join(p.locator('#warns li').all_inner_texts()) or 'Tick' in ' '.join(p.locator('#warns li').all_inner_texts()), 'without the rights tick the page warns and draws nothing')
                same, want, got = drawn_matches(p, 3.2)
                check(not any(x.startswith('image:') for x in got), 'no picture is drawn without the tick')
                p.get_by_label('I have the right to use this picture').check()
                check('3 times' in p.locator('ul.list').nth(1).inner_text(), 'the rule finds "great news" 3 times in the finished film')
                first = p.evaluate("window.ryagramEdit.model.specs(window.ryagramEdit.edit).find(s => s.kind === 'image').start_s")
                same, want, got = drawn_matches(p, first + 1.0)
                check(same and any(x.startswith('image:') for x in got), f'at {first + 1.0:.1f} s the picture is on screen')
                check(p.locator('.layer img').count() == 1 and p.locator('.layer img').get_attribute('src').startswith('data:'), 'the picture is drawn from the picture itself, nothing fetched')
                p.get_by_label('Show the spoken words as captions').check()
                same, want, got = drawn_matches(p, 0.7)
                check(same and 'great news everyone' in p.locator('.layer .cap').first.inner_text(), 'captions on: the clip\'s words show at the right moment')
                p.fill('#t-text', 'Thanks for watching')
                p.fill('#t-start', '1')
                p.get_by_role('button', name='Add this text').click()
                same, want, got = drawn_matches(p, 1.5)
                check(same and any(x.startswith('text:') for x in got), 'free text shows in its time')
                p.fill('#r-phrase', 'crypto')
                p.get_by_role('button', name='Add this rule').click()
                check('"crypto" is not said in this film' in ' '.join(p.locator('#warns li').all_inner_texts()), 'a phrase that is not said warns, and the film is still renderable')
                check(not p.locator('#render').is_disabled(), 'warnings never block Render')

                print('   look, order, trim')
                p.get_by_role('tab', name='Look').click()
                p.get_by_label('Light', exact=True).check()
                bg = p.evaluate("getComputedStyle(document.querySelector('.film')).backgroundColor")
                check(bg == 'rgb(244, 246, 245)', f'the light look is on (letterbox {bg})')
                p.get_by_role('button', name='Text colour: #0b3d5c').click()
                check(p.evaluate('window.ryagramEdit.edit.look.text_color') == '#0b3d5c', 'a text colour from the palette is chosen')
                p.screenshot(path=str(OUT / 'edit-2-light-rules.png'))
                p.get_by_label('Dark (the default)').check()
                p.get_by_role('tab', name='Clips').click()
                p.locator('button.card[data-id="c5"]').click()
                before = p.evaluate("window.ryagramEdit.edit.clips.map(c => c.id).join()")
                p.get_by_role('button', name='Move earlier').click()
                after = p.evaluate("window.ryagramEdit.edit.clips.map(c => c.id).join()")
                check(before != after and after.index('c5') < before.index('c5'), f'a clip moves earlier ({after})')
                check(p.locator('#status').inner_text() in ('Updating the preview', 'Preview is ready'), 'the preview refreshes after a clip change')
                until(p, "document.getElementById('status').textContent === 'Preview is ready'")
                p.get_by_role('button', name='End 0.1 s earlier').click()
                p.get_by_role('button', name='Undo').click()
                check(p.evaluate("window.ryagramEdit.edit.clips.find(c => c.id === 'c5').out_s") == p.evaluate("window.ryagramEdit.model.normalize(window.ryagramEdit.edit).clips.find(c => c.id === 'c5').out_s"), 'trim then Undo is back where it was')
                p.screenshot(path=str(OUT / 'edit-3-clips-dark.png'))

                print('   save, reload, open')
                p.get_by_role('button', name='Save my edit').click()
                until(p, "document.getElementById('save').textContent === 'Saved'")
                saved = p.evaluate('window.ryagramEdit.saveText()')
                frames = p.evaluate("(() => { const out = []; const tot = window.ryagramEdit.model.timeline(window.ryagramEdit.edit).total_s; for (let t = 0; t <= tot; t += 0.5) out.push(window.ryagramEdit.frame(t)); return JSON.stringify(out); })()")
                p.reload(wait_until='load')
                p.wait_for_selector('html[data-ready="1"]', timeout=15000)
                check(p.evaluate('window.ryagramEdit.saveText()') == saved, 'the reopened list saves to the same bytes')
                frames2 = p.evaluate("(() => { const out = []; const tot = window.ryagramEdit.model.timeline(window.ryagramEdit.edit).total_s; for (let t = 0; t <= tot; t += 0.5) out.push(window.ryagramEdit.frame(t)); return JSON.stringify(out); })()")
                check(frames == frames2, 'the reopened film shows the same picture at every half second')
                check('C:\\\\' not in saved and '/Users/' not in saved, 'the saved list holds no path')

                print('   names, render, the phone')
                nameless = p.evaluate(NAMES_JS)
                for tab in ('Images and text', 'Look'):
                    p.get_by_role('tab', name=tab).click()
                    nameless += p.evaluate(NAMES_JS)
                check(not nameless, f'every button, box and menu has a name ({nameless[:2]})')
                p.evaluate("window.ryagramEdit.host.render = () => new Promise(r => setTimeout(() => r({ message: 'The render has started.' }), 400))")
                p.locator('#render').click()
                check(p.locator('#render').is_disabled(), 'while a render runs the Render button is off (a second press is refused)')
                until(p, "!document.getElementById('render').disabled")
                ctx.close()

                ctx = b.new_context(viewport={'width': 375, 'height': 812})
                ctx.route('**/*', make_route())
                p = ctx.new_page()
                p.on('pageerror', lambda e: errs.append(str(e)))
                p.goto(f'{base}/edit.html?fixture', wait_until='load')
                p.wait_for_selector('html[data-ready="1"]', timeout=15000)
                p.wait_for_timeout(500)
                w = p.evaluate('[document.documentElement.scrollWidth, window.innerWidth]')
                check(w[0] <= w[1], f'no sideways scroll at 375 px ({w})')
                small = p.evaluate("[...document.querySelectorAll('button, select, input[type=text], input[type=number]')].filter(e => e.offsetParent !== null && e.getBoundingClientRect().height < 43).map(e => e.outerHTML.slice(0, 60))")
                check(not small, f'every button is at least 44 px tall ({small[:2]})')
                p.screenshot(path=str(OUT / 'edit-4-phone.png'), full_page=True)
                ctx.close()

                print('B. the maker host')
                ctx = b.new_context(viewport={'width': 1000, 'height': 1000})
                ctx.route('**/*', make_route())
                p = ctx.new_page()
                p.on('pageerror', lambda e: errs.append(str(e)))
                p.goto(f'{base}/edit.html?fixture', wait_until='load')
                p.wait_for_selector('html[data-ready="1"]', timeout=15000)
                STATE['edit'] = p.evaluate('window.ryagramEdit.edit')
                p.close()
                p = ctx.new_page()
                p.on('pageerror', lambda e: errs.append(str(e)))
                p.goto(f'{base}/edit.html?t=wrong', wait_until='load')
                p.wait_for_timeout(800)
                txt = p.locator('#top').inner_text()
                check('Open the address the maker printed' in txt and 'Traceback' not in txt and '403' not in txt, 'a wrong token gives a plain sentence')
                p.goto(f'{base}/edit.html?t={TOKEN}', wait_until='load')
                p.wait_for_selector('html[data-ready="1"]', timeout=15000)
                check(p.locator('ol.strip li').count() == 6, 'the maker host loads the edit list')
                p.get_by_role('tab', name='Images and text').click()
                p.get_by_role('button', name='Add a picture').click()
                p.wait_for_selector('text=api-picture.png')
                p.get_by_label('I have the right to use this picture').check()
                p.fill('#r-phrase', 'great news')
                p.get_by_role('button', name='Add this rule').click()
                p.wait_for_timeout(300)
                p.evaluate("window.ryagramEdit.setT(window.ryagramEdit.model.specs(window.ryagramEdit.edit)[0].start_s + 1)")
                p.wait_for_timeout(200)
                check(p.locator('.layer img').count() == 1 and '/api/image/file' in p.locator('.layer img').get_attribute('src') and 'api-picture' not in p.locator('.layer img').get_attribute('src'), 'the picture comes from the maker by id (no file name or path in the address)')
                mine = p.evaluate('window.ryagramEdit.saveText()')
                p.get_by_role('button', name='Save my edit').click()
                until(p, "document.getElementById('save').textContent === 'Saved'")
                check(STATE['picks'] == 1 and json.dumps(STATE['saved'][-1], sort_keys=True) == json.dumps(json.loads(mine), sort_keys=True), 'the maker received exactly the edit list the page holds')
                p.get_by_role('button', name='Render').click()
                until(p, "document.getElementById('live').textContent.includes('render has started')")
                check(STATE['renders'] == 1, 'Render sent one request, after saving')
                ctx.close()
            finally:
                b.close()
    finally:
        srv.shutdown()
    check(not errs, f'no page errors or console errors ({errs[:2]})')
    check(not external, f'every request to another host was refused ({len(external)})')
    print('RESULT: ' + ('PASS' if ok else 'FAIL'))
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
