"""GEO's Location Intelligence words on the Geographic Intelligence Coming soon page (BACKLOG WEB-3 / NEXT-WEB 207) in real Chrome, mock mode, LOCAL server only, desktop and phone (375 and 320 px):
with `locationWords` ON the page shows the draft note, the three sections in order, the no-figure line and the sources, with the Tell me button still working and the departmentDetails words NOT doubled; with it OFF the page is exactly
as before; Games and Compilations are never changed; no sideways scroll; no console errors. Needs Chrome.   python tools/check-location-words.py"""
import http.server, re, socketserver, sys, threading
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
PORT = 8322


class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=str(ROOT), **k)
    def log_message(self, *a): pass
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store'); super().end_headers()


srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), H)          # its own port: a fixed one can be bound twice at once on Windows (11-06)
PORT = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()
base = (ROOT / 'assets/ryagram-config.js').read_text(encoding='utf-8')
on_cfg = re.sub(r'locationWords:\s*false', 'locationWords: true', base)
ok = True


def check(c, w):
    global ok
    print(('  ok   ' if c else '  FAIL ') + w); ok = ok and bool(c)


def page(b, cfg, opts, errs):
    ctx = b.new_context(**opts)
    ctx.route(re.compile(r'https://fonts\.(googleapis|gstatic)\.com/.*'), lambda r, _q: r.abort())
    ctx.route('**/assets/ryagram-config.js*', lambda r, _q, c=cfg: r.fulfill(status=200, content_type='text/javascript', body=c))
    p = ctx.new_page()
    p.on('pageerror', lambda e: errs.append(str(e))); p.on('console', lambda m: errs.append(m.text) if m.type == 'error' and 'Failed to load resource' not in m.text else None)
    return p


def go(p, dept, title):
    p.goto(f'http://127.0.0.1:{PORT}/app/?mock#/d/{dept}', wait_until='load'); p.wait_for_selector(f'h1:has-text("{title}")', timeout=20000); p.wait_for_timeout(300)


with sync_playwright() as pw:
    b = pw.chromium.launch(channel='chrome')
    for name, opts in (('desktop', dict(viewport={'width': 1200, 'height': 900})), ('phone375', dict(viewport={'width': 375, 'height': 812}, device_scale_factor=2, is_mobile=True, has_touch=True)),
                       ('phone320', dict(viewport={'width': 320, 'height': 700}, device_scale_factor=2, is_mobile=True, has_touch=True))):
        print(name)
        errs = []
        p = page(b, on_cfg, opts, errs); go(p, 'geo_intelligence', 'Geographic Intelligence')
        t = p.inner_text('main')
        check('Draft wording, not yet approved.' in t and 'Coming soon.' in t and 'does not pick a' in t and 'never shows a zero' in t and 'Each source is named beside its numbers' in t, 'Geographic Intelligence: the draft note and GEO words show')
        check([x.strip() for x in p.locator('main h2').all_inner_texts()] == ['What it will do', 'What it will not claim', 'How to read the numbers', 'Where the data comes from'], 'the sections in order')
        check('What we are building' not in t and 'one Ohio county' not in t, 'the departmentDetails words are not doubled')
        check(p.locator('#soon-notify').count() == 1, 'the Tell me button is still there')
        check(p.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth'), 'no sideways scroll')
        p.screenshot(path=str(Path('D:/Ryagram-scratch/WEB') / f'li-soon-{name}.png'), full_page=True)
        p.context.close()
        p = page(b, on_cfg, opts, errs); go(p, 'games', 'Games')
        check('Draft wording' not in p.inner_text('main') and p.locator('main h2').count() == 0, 'Games is not changed')
        p.context.close()
        p = page(b, on_cfg, opts, errs); go(p, 'compilations', 'Compilations')
        check('Draft wording' not in p.inner_text('main') and 'What we are building' not in p.inner_text('main'), 'Compilations is not changed')
        p.context.close()
        check(not errs, 'no console errors' + (f': {errs[:2]}' if errs else ''))
    print('switch off')
    errs = []
    p = page(b, base, dict(viewport={'width': 1200, 'height': 900}), errs); go(p, 'geo_intelligence', 'Geographic Intelligence')
    check('Draft wording' not in p.inner_text('main') and p.locator('main h2').count() == 0 and p.locator('#soon-notify').count() == 1, 'exactly as before with the switch off')
    p.context.close()
    b.close()
srv.shutdown(); srv.server_close()
print('ALL OK' if ok else 'FAILED'); sys.exit(0 if ok else 1)
