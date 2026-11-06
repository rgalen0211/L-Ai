"""A tester account's films on My films (NEXT-WEB 186) in real Chrome, mock mode, LOCAL server only, `myFilms` and `testerFilmProgress` ON in a local config copy, desktop and phone: a queued film says what the computer
is doing (none signed in; signed in and seen a moment ago; signed in and last seen two days ago); a plain account's film says nothing about a computer; a finished film says Ready; with testerFilmProgress OFF a
tester sees the ordinary line. Needs Chrome.   python tools/check-tester-films.py"""
import http.server, re, socketserver, sys, threading
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
PORT = 8315


class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=str(ROOT), **k)
    def log_message(self, *a): pass
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store'); super().end_headers()


srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), H)          # its own port: a fixed one can be bound twice at once on Windows (11-06)
PORT = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()
base = (ROOT / 'assets/ryagram-config.js').read_text(encoding='utf-8')
films_cfg = re.sub(r'myFilms:\s*false', 'myFilms: true', base)
on_cfg = re.sub(r'testerFilmProgress:\s*false', 'testerFilmProgress: true', films_cfg)
ok = True


def check(c, w):
    global ok
    print(('  ok   ' if c else '  FAIL ') + w); ok = ok and bool(c)


def row_text(b, cfg, query, opts, errs, finish=False):
    ctx = b.new_context(**opts)
    ctx.route(re.compile(r'https://fonts\.(googleapis|gstatic)\.com/.*'), lambda r, _q: r.abort())
    ctx.route('**/assets/ryagram-config.js*', lambda r, _q, c=cfg: r.fulfill(status=200, content_type='text/javascript', body=c))
    p = ctx.new_page()
    p.on('pageerror', lambda e: errs.append(str(e))); p.on('console', lambda m: errs.append(m.text) if m.type == 'error' and 'Failed to load resource' not in m.text else None)
    p.goto(f'http://127.0.0.1:{PORT}/app/?mock&empty{query}#/', wait_until='load'); p.wait_for_selector('h1:has-text("Your projects")')
    p.click('button:has-text("Pause worker")')
    p.click('#first-film'); p.click('.builder-start[data-start="housing"]'); p.wait_for_selector('.builder-summary', timeout=15000)
    p.click('button:has-text("Make the film and a free contact sheet")'); p.wait_for_selector('h1:has-text("Version 1")', timeout=20000); p.wait_for_selector('.job-row-queued', timeout=20000)
    if finish:
        p.click('button:has-text("Resume worker")'); p.wait_for_selector('.job-row-complete', timeout=40000)
    p.evaluate("location.hash = '#/films'"); p.wait_for_selector('.film-row'); p.wait_for_timeout(500)
    text = p.inner_text('.film-row'); wide = p.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth')
    ctx.close()
    return text, wide


with sync_playwright() as pw:
    b = pw.chromium.launch(channel='chrome')
    for name, opts in (('desktop', dict(viewport={'width': 1200, 'height': 900})), ('phone', dict(viewport={'width': 375, 'height': 812}, device_scale_factor=2, is_mobile=True, has_touch=True))):
        print(name)
        errs = []
        t, wide = row_text(b, on_cfg, '&tester', opts, errs)
        check('Waiting' in t and 'No computer is signed in to your account. Open the Ryagram app on your computer and sign in.' in t, 'tester, no computer: waiting, and what to do')
        t, wide = row_text(b, on_cfg, '&tester&computer', opts, errs)
        check('Waiting for your computer to pick it up. It is signed in and was seen a moment ago.' in t, 'tester, computer seen just now: waiting for it to pick the film up')
        t, wide = row_text(b, on_cfg, '&tester&oldcomputer', opts, errs)
        check('DESKTOP-SAM-PC was last seen 2 days ago. Open the Ryagram app on it' in t, 'tester, computer last seen two days ago: says so and what to do')
        t, wide = row_text(b, on_cfg, '', opts, errs)
        check('computer' not in t and 'Contact sheet: Queued' in t, 'a plain account’s film says nothing about a computer: ' + t.replace('\n', ' ')[-40:])
        t, wide = row_text(b, on_cfg, '&tester&computer', opts, errs, finish=True)
        check('Ready' in t and 'The contact sheet is ready' in t, 'a finished film says Ready')
        check(wide, 'no sideways scroll')
        t, wide = row_text(b, films_cfg, '&tester&computer', opts, errs)
        check('computer' not in t and 'Contact sheet: Queued' in t, 'with testerFilmProgress off a tester sees the ordinary line')
        check(not errs, 'no console errors' + (f': {errs[:2]}' if errs else ''))
    b.close()
srv.shutdown(); srv.server_close()
print('ALL OK' if ok else 'FAILED'); sys.exit(0 if ok else 1)
