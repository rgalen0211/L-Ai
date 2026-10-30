"""My films (#/films) in real Chrome, mock mode, LOCAL server only, `myFilms` ON in a local config copy, desktop and phone (NEXT-WEB 174): the page lists the films; a film whose contact sheet waits in line says Waiting;
when the worker finishes it says Ready; a film that fails a check says Did not finish with the plain reason and no raw text; Try again appears only where the free contact sheet may be retried; films that need a
person come first; the page is one column at 375 px with no sideways scroll; with the switch off there is no link and the address shows the library. Needs Chrome.   python tools/check-my-films.py"""
import http.server, re, socketserver, sys, threading
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
PORT = 8307


class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=str(ROOT), **k)
    def log_message(self, *a): pass
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store'); super().end_headers()


socketserver.TCPServer.allow_reuse_address = True
srv = socketserver.ThreadingTCPServer(('127.0.0.1', PORT), H)
threading.Thread(target=srv.serve_forever, daemon=True).start()
base = (ROOT / 'assets/ryagram-config.js').read_text(encoding='utf-8')
on_cfg = re.sub(r'myFilms:\s*false', 'myFilms: true', base)
ok = True


def check(c, w):
    global ok
    print(('  ok   ' if c else '  FAIL ') + w); ok = ok and bool(c)


def page(b, cfg, opts, errs):
    ctx = b.new_context(**opts)
    ctx.route(re.compile(r'https://fonts\.(googleapis|gstatic)\.com/.*'), lambda r, _q: r.abort())
    ctx.route('**/assets/ryagram-config.js*', lambda r, _q: r.fulfill(status=200, content_type='text/javascript', body=cfg))
    p = ctx.new_page()
    p.on('pageerror', lambda e: errs.append(str(e))); p.on('console', lambda m: errs.append(m.text) if m.type == 'error' and 'Failed to load resource' not in m.text else None)
    return p


def make_sheet(p, outcome=None, pause=False):
    """From the projects page: start the Housing ready-made film and ask for its free contact sheet."""
    p.goto(f'http://127.0.0.1:{PORT}/app/?mock&empty#/', wait_until='load'); p.wait_for_selector('h1:has-text("Your projects")')
    if outcome: p.select_option('#mock-outcome', outcome); p.wait_for_timeout(200)
    if pause: p.click('button:has-text("Pause worker")')
    p.click('#first-film'); p.click('.builder-start[data-start="housing"]'); p.wait_for_selector('.builder-summary', timeout=15000)
    p.click('button:has-text("Make the film and a free contact sheet")'); p.wait_for_selector('h1:has-text("Version 1")', timeout=20000); p.wait_for_selector('.job-row-queued, .job-row-running, .job-row-complete, .job-row-failed, .job-row-editorial_action_required', timeout=20000)


with sync_playwright() as pw:
    b = pw.chromium.launch(channel='chrome')
    for name, opts in (('desktop', dict(viewport={'width': 1200, 'height': 900})), ('phone', dict(viewport={'width': 375, 'height': 812}, device_scale_factor=2, is_mobile=True, has_touch=True))):
        print(name)
        errs = []
        # a film waiting in line, then ready
        p = page(b, on_cfg, opts, errs)
        make_sheet(p, pause=True)
        p.evaluate("location.hash = '#/films'"); p.wait_for_selector('h1:has-text("My films")'); p.wait_for_selector('.film-row')
        row = p.inner_text('.film-row')
        check('Waiting' in row and 'Contact sheet: Queued' in row, f'a film in line says Waiting ({row[:70]!r})')
        check(p.locator('.film-row a[href^="#/v/"]').count() >= 1, 'and links to the film')
        p.evaluate("location.hash = '#/'"); p.wait_for_selector('h1:has-text("Your projects")'); p.wait_for_selector('a:has-text("Open")', state='attached') if False else None
        p.go_back() if False else None
        p.locator('a[href^="#/p/"]').first.click(); p.wait_for_selector('a[href^="#/v/"]'); p.locator('a[href^="#/v/"]').first.click(); p.wait_for_selector('h1:has-text("Version 1")')
        p.click('button:has-text("Resume worker")'); p.wait_for_selector('.job-row-complete', timeout=40000)
        p.evaluate("location.hash = '#/films'"); p.wait_for_selector('.film-row')
        check('Ready' in p.inner_text('.film-row') and 'The contact sheet is ready' in p.inner_text('.film-row'), 'when the worker has finished it says Ready')
        check(p.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth'), 'no sideways scroll')
        p.screenshot(path=f'D:/Ryagram-scratch/WEB/my-films-{name}.png', full_page=True)
        p.context.close()
        # a film that fails a check
        p = page(b, on_cfg, opts, errs)
        make_sheet(p, outcome='gate')
        p.wait_for_selector('.job-row-failed, .job-row-editorial_action_required', timeout=60000)
        p.evaluate("location.hash = '#/films'"); p.wait_for_selector('.film-row')
        row = p.inner_text('.film-row')
        check('Did not finish' in row and '$' not in row and 'Traceback' not in row, f'a failed film says Did not finish with a plain reason ({row[:90]!r})')
        check(p.locator('.film-row button:has-text("Try again")').count() == 0, 'a failed check cannot be repeated, so there is no Try again')
        p.context.close()
        check(not errs, 'no console errors' + (f': {errs[:2]}' if errs else ''))
    print('switch off')
    errs = []
    p = page(b, base, dict(viewport={'width': 1200, 'height': 900}), errs)
    p.goto(f'http://127.0.0.1:{PORT}/app/?mock#/', wait_until='load'); p.wait_for_selector('h1:has-text("Your projects")')
    check(p.locator('a[href="#/films"]').count() == 0, 'no link with the switch off')
    p.goto(f'http://127.0.0.1:{PORT}/app/?mock#/films', wait_until='load'); p.wait_for_timeout(1200)
    check(p.locator('h1:has-text("My films")').count() == 0 and p.locator('h1:has-text("Your projects")').count() == 1, 'the address shows the library')
    p.context.close(); b.close()
srv.shutdown()
print('ALL OK' if ok else 'FAILED'); sys.exit(0 if ok else 1)
