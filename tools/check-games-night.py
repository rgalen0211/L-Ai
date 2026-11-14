"""The Games Coming soon page (WEB-8) in real Chrome, mock mode, LOCAL server only, `departments` details and `gameNightSteps` switched in a LOCAL config copy, desktop and phone (320 to 390 px): the page says the
reviewed line; with the switch OFF there is no 'Try it on your computer' box; with it ON the box shows the practice-night steps as text, with nothing in it that is a button or a link; the 'What we are building'
part names the games and says nothing is promised; no sideways scroll; no console errors. Needs Chrome.   python tools/check-games-night.py"""
import http.server, re, socketserver, sys, threading
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]


class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=str(ROOT), **k)
    def log_message(self, *a): pass
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store'); super().end_headers()


srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), H)
PORT = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()
base = (ROOT / 'assets/ryagram-config.js').read_text(encoding='utf-8')
cfg_off = re.sub(r'\bdepartmentDetails:\s*false', 'departmentDetails: true', base)
cfg_on = re.sub(r'\bgameNightSteps:\s*false', 'gameNightSteps: true', cfg_off)
assert 'departmentDetails: true' in cfg_off and 'gameNightSteps: true' in cfg_on
ok = True


def check(c, w):
    global ok
    print(('  ok   ' if c else '  FAIL ') + w); ok = ok and bool(c)


def page(b, cfg, vp, errs):
    ctx = b.new_context(viewport=vp, is_mobile=vp['width'] < 500)
    ctx.route('**/assets/ryagram-config.js*', lambda r, _q: r.fulfill(status=200, content_type='text/javascript', body=cfg))
    p = ctx.new_page(); p.on('pageerror', lambda e: errs.append(str(e))); p.on('console', lambda m: errs.append(m.text) if m.type == 'error' and 'Failed to load resource' not in m.text else None)
    p.goto(f'http://127.0.0.1:{PORT}/app/?mock&aiconnected#/d/games', wait_until='load'); p.wait_for_selector('h1:has-text("Games")', timeout=20000); p.wait_for_timeout(500)
    return ctx, p


with sync_playwright() as pw:
    b = pw.chromium.launch(channel='chrome')
    for name, vp in (('desktop', {'width': 1200, 'height': 900}), ('phone-390', {'width': 390, 'height': 844}), ('phone-320', {'width': 320, 'height': 640})):
        print(name); errs = []
        ctx, p = page(b, cfg_off, vp, errs)
        txt = p.inner_text('main, #app, body')
        check('Game night on your own TV: phones are the controllers' in txt, 'the page says the reviewed line')
        check('Eight games work today in the early version: Guess the next line, Bluff, Guess Who, Old Maid, Trivia, Act it out, Dub it and Who said it?' in txt, 'and names the eight games')
        check('No game can be played yet' not in txt and 'considering' not in txt, 'the old words are gone')
        check('no price and no date' in txt.lower(), 'it promises no price and no date')
        check(p.locator('.soon-night').count() == 0 and 'Try it on your computer' not in txt, 'with the switch OFF there is no box')
        check(p.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth'), 'no sideways scroll')
        ctx.close()
        ctx, p = page(b, cfg_on, vp, errs)
        box = p.locator('.soon-night')
        check(box.count() == 1 and 'This page cannot start a night' in box.inner_text(), 'with the switch ON the box is there and says the page cannot start a night')
        check('python -m ryagram.games.room_server --practice' in box.locator('code').inner_text() and '--wifi' not in box.inner_text(), 'it holds the practice-night line only')
        check(box.locator('button, a, input, form').count() == 0, 'nothing in it is a button or a link')
        check(p.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth') and p.evaluate("(() => { const c = document.querySelector('.soon-night code'); return c.scrollWidth <= document.documentElement.clientWidth + 1 || getComputedStyle(c).whiteSpace !== 'nowrap'; })()"), 'the command wraps instead of sticking out')
        p.screenshot(path=f'D:/Ryagram-scratch/WEB/games-night-{name}.png', full_page=True)
        check(not errs, 'no console errors' + (f': {errs[:2]}' if errs else ''))
        ctx.close()
    b.close()
srv.shutdown(); srv.server_close()
print('ALL OK' if ok else 'FAILED'); sys.exit(0 if ok else 1)
