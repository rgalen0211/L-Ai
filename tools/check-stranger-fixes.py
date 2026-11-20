"""Three things a stranger walking the signed-in site notices (WEB 11-20, proposals/WEB-STRANGER-WALK-1120.md), in real Chrome, mock mode, LOCAL server only, desktop and phone:
(1) the tab title says where you are on every page (never the same 'Ryagram | L'Ai' everywhere); (2) every admin page goes back to the Admin page ('← Admin'), not to the user's home; (3) a page with no way back (the department pages, Start) gets '← All projects';
(4) on a phone the admin card link, a radio's whole row and the tutorial's sample link are at least 44 px tall.   Needs Chrome.   python tools/check-stranger-fixes.py"""
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
cfg = re.sub(r"\bdepartments:\s*false", 'departments: true', base)
ok = True


def check(c, w):
    global ok
    print(('  ok   ' if c else '  FAIL ') + w); ok = ok and bool(c)


def go(p, route):
    p.evaluate("r => { location.hash = r }", route); p.wait_for_timeout(1200)


with sync_playwright() as pw:
    b = pw.chromium.launch(channel='chrome')
    for name, opts in (('desktop', dict(viewport={'width': 1280, 'height': 860})), ('phone', dict(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True))):
        print(name)
        ctx = b.new_context(**opts); errs = []
        ctx.route(re.compile(r'https://fonts\.(googleapis|gstatic)\.com/.*'), lambda r, _q: r.abort())
        ctx.route('**/assets/ryagram-config.js*', lambda r, _q: r.fulfill(status=200, content_type='text/javascript', body=cfg))
        p = ctx.new_page(); p.on('pageerror', lambda e: errs.append(str(e)))
        p.goto(f'http://127.0.0.1:{PORT}/app/?mock', wait_until='load'); p.wait_for_selector('#np-title', timeout=20000); p.wait_for_timeout(800)
        titles = {}
        for route, want in (('#/', 'Your projects'), ('#/account', 'Your account'), ('#/help', 'Get help'), ('#/films', 'My films'), ('#/d/games', 'Games'), ('#/admin', 'Admin'), ('#/admin/funnel', 'Funnel by day')):
            go(p, route); titles[route] = p.title()
            check(p.title() == f'{want} | Ryagram', f'{route}: the tab says "{want} | Ryagram" ({p.title()!r})')
        check(len(set(titles.values())) == len(titles), 'and no two pages share a title')
        for route in ('#/admin/ops', '#/admin/visits', '#/admin/funnel', '#/admin/waitlist'):
            go(p, route)
            back = p.locator('a.back').first
            check(back.count() == 1 and back.get_attribute('href') == '#/admin' and 'Admin' in back.inner_text(), f'{route}: the way back goes to the Admin page')
        for route in ('#/d/games', '#/d/compilations', '#/d/data_films', '#/start'):
            go(p, route)
            check(p.locator('main a[href="#/"], #library a[href="#/"]').count() >= 1, f'{route}: there is a way back to Your projects')
        go(p, '#/')
        check(p.locator('a.back').count() == 0, 'Your projects itself has no back link')
        if name == 'phone':
            go(p, '#/admin')
            hs = p.eval_on_selector_all('.site-card-link', 'els => els.map(e => Math.round(e.getBoundingClientRect().height))')
            check(hs and min(hs) >= 44, f'phone: every admin card link is at least 44 px tall ({min(hs) if hs else None})')
            go(p, '#/help')
            rows = p.eval_on_selector_all('label:has(> input[type=radio])', 'els => els.map(e => Math.round(e.getBoundingClientRect().height))')
            check(rows and min(rows) >= 44, f'phone: every radio row on Get help is at least 44 px tall ({min(rows) if rows else None})')
            go(p, '#/build')
            sm = p.locator('.builder-sample-link a')
            check(sm.count() == 1 and sm.bounding_box()['height'] >= 44, 'phone: the tutorial’s sample link is at least 44 px tall')
        check(not errs, 'no page errors' + (f': {errs[:2]}' if errs else ''))
        ctx.close()
    b.close()
srv.shutdown()
print('ALL OK' if ok else 'FAILED'); sys.exit(0 if ok else 1)
