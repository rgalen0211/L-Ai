"""The website intake (#/new) in real Chrome, mock mode, LOCAL server only, `intake` ON in a local config copy, desktop and phone (NEXT-WEB 173): one basic question first (a data film, a compilation, something coming
soon); a data film then asks what it is about and lands on the guided builder with the film type chosen (a county map: the dataset list already narrowed to counties); the globe and the unbuilt ideas are coming-soon
pages with no dead end; Back works; with the switch OFF there is no link and the address shows the library. Needs Chrome.   python tools/check-intake.py"""
import http.server, re, socketserver, sys, threading
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
PORT = 8306


class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=str(ROOT), **k)
    def log_message(self, *a): pass
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store'); super().end_headers()


socketserver.TCPServer.allow_reuse_address = True
srv = socketserver.ThreadingTCPServer(('127.0.0.1', PORT), H)
threading.Thread(target=srv.serve_forever, daemon=True).start()
base = (ROOT / 'assets/ryagram-config.js').read_text(encoding='utf-8')
on_cfg = re.sub(r'intake:\s*false', 'intake: true', base)
ok = True


def check(c, w):
    global ok
    print(('  ok   ' if c else '  FAIL ') + w); ok = ok and bool(c)


def open_page(b, cfg, opts, errs):
    ctx = b.new_context(**opts)
    ctx.route(re.compile(r'https://fonts\.(googleapis|gstatic)\.com/.*'), lambda r, _q: r.abort())
    ctx.route('**/assets/ryagram-config.js*', lambda r, _q: r.fulfill(status=200, content_type='text/javascript', body=cfg))
    p = ctx.new_page()
    p.on('pageerror', lambda e: errs.append(str(e))); p.on('console', lambda m: errs.append(m.text) if m.type == 'error' and 'Failed to load resource' not in m.text else None)
    return p


with sync_playwright() as pw:
    b = pw.chromium.launch(channel='chrome')
    for name, opts in (('desktop', dict(viewport={'width': 1200, 'height': 900})), ('phone', dict(viewport={'width': 375, 'height': 812}, device_scale_factor=2, is_mobile=True, has_touch=True))):
        print(name)
        errs = []
        p = open_page(b, on_cfg, opts, errs)
        p.goto(f'http://127.0.0.1:{PORT}/app/?mock#/', wait_until='load'); p.wait_for_selector('h1:has-text("Your projects")')
        check(p.locator('a:has-text("What do you want to make?")').count() == 1, 'the projects page has the link (switch on)')
        p.click('a:has-text("What do you want to make?")'); p.wait_for_selector('h2:has-text("What do you want to make?")')
        check(p.locator('.intake-choice').count() == 3, 'one basic question first: three answers')
        # compilation: no second question
        p.click('[data-choice="compilation"]'); p.wait_for_selector('h2:has-text("on your own computer")')
        check(p.locator('a[href="#/start"]').count() >= 1 and p.locator('.intake-choice').count() == 0, 'a compilation has no second question and says where it is made')
        p.click('.intake >> button:has-text("Back")'); p.wait_for_selector('h2:has-text("What do you want to make?")')
        # something else: coming soon list
        p.click('[data-choice="soon"]'); p.wait_for_selector('.intake-soon-list')
        check(p.locator('.intake-soon-list li').count() == 3 and 'None of this exists yet' in p.inner_text('.intake'), 'something else lists the coming-soon ideas and says none exists yet')
        p.click('.intake >> button:has-text("Back")')
        # data film: map -> builder with the county search
        p.click('[data-choice="data"]'); p.wait_for_selector('h2:has-text("What is your film about?")')
        check(p.locator('.intake-choice').count() == 4 and 'Coming soon' in p.inner_text('[data-choice="globe"]'), 'a data film asks what it is about; the globe is marked coming soon')
        p.click('[data-choice="globe"]'); p.wait_for_selector('h2:has-text("not built yet")')
        check('Geographic Intelligence' in p.inner_text('.intake-soon-list') and p.locator('a.button.primary').count() == 0, 'the globe is a coming-soon page with no dead link')
        p.click('.intake >> button:has-text("Back")'); p.wait_for_selector('h2:has-text("What is your film about?")')
        p.click('[data-choice="map"]'); p.wait_for_selector('a:has-text("Open the builder")')
        href = p.get_attribute('a:has-text("Open the builder")', 'href')
        check(href == '#/build?type=map&q=county', f'a map lands on the builder with the type and the county search ({href})')
        p.click('a:has-text("Open the builder")'); p.wait_for_selector('h2:has-text("Which data?")', timeout=15000)
        check(p.input_value('#bd-filter') == 'county', 'the dataset list opens already narrowed to counties')
        cards = p.locator('.builder-card').all_inner_texts()
        check(len(cards) >= 1 and all('county' in c.lower() or 'counties' in c.lower() for c in cards), f'every dataset shown is a county one ({len(cards)} shown)')
        p.locator('.builder-card').first.click(); p.wait_for_timeout(600); p.click('button:has-text("Next")')
        for heading in ('What do you want to show?', 'Which years?'):
            p.wait_for_selector(f'h2:has-text("{heading}")'); p.click('button:has-text("Next")')
        p.wait_for_selector('h2:has-text("What kind of film?")')
        check(p.locator('input[name="bd-type"][value="map"]:checked').count() == 1, 'the film type step already has Map chosen')
        check(p.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth'), 'no sideways scroll')
        # bars address
        p.goto(f'http://127.0.0.1:{PORT}/app/?mock#/build?type=bars&q=%3Cscript%3E', wait_until='load'); p.wait_for_selector('h2:has-text("Which data?")', timeout=15000)
        check(p.input_value('#bd-filter') == '', 'a search word that is not plain letters is ignored')
        check(not errs, 'no console errors' + (f': {errs[:2]}' if errs else ''))
        p.context.close()
    print('switch off')
    errs = []
    p = open_page(b, base, dict(viewport={'width': 1200, 'height': 900}), errs)
    p.goto(f'http://127.0.0.1:{PORT}/app/?mock#/', wait_until='load'); p.wait_for_selector('h1:has-text("Your projects")')
    check(p.locator('a:has-text("What do you want to make?")').count() == 0, 'no link with the switch off')
    p.goto(f'http://127.0.0.1:{PORT}/app/?mock#/new', wait_until='load'); p.wait_for_timeout(1200)
    check(p.locator('.intake').count() == 0 and p.locator('h1:has-text("Your projects")').count() == 1, 'the address shows the library, not the intake')
    p.context.close(); b.close()
srv.shutdown()
print('ALL OK' if ok else 'FAILED'); sys.exit(0 if ok else 1)
