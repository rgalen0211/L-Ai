"""The honest words on the Geographic Intelligence and Games Coming soon pages (NEXT-WEB 200) in real Chrome, mock mode, LOCAL server only, desktop and phone (375 and 320 px): with `departmentDetails` ON each page
shows the draft note, the three sections and the not-built-yet list, with the button still working; with it OFF the pages are exactly as before; Compilations is never changed; no sideways scroll; no console errors.
Needs Chrome.   python tools/check-department-details.py"""
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


socketserver.TCPServer.allow_reuse_address = True
srv = socketserver.ThreadingTCPServer(('127.0.0.1', PORT), H)
threading.Thread(target=srv.serve_forever, daemon=True).start()
base = (ROOT / 'assets/ryagram-config.js').read_text(encoding='utf-8')
on_cfg = re.sub(r'departmentDetails:\s*false', 'departmentDetails: true', base)
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
        for dept, title, must in (('geo_intelligence', 'Geographic Intelligence', ['one Ohio county', 'No made-up points', 'straight-line rings']), ('games', 'Games', ['Guess the next line', 'consent', 'No game can be played yet'])):
            p = page(b, on_cfg, opts, errs); go(p, dept, title)
            t = p.inner_text('main')
            check('Draft wording, not yet approved.' in t and all(x in t for x in must), f'{title}: the draft note and the words show')
            check([x.strip() for x in p.locator('main h2').all_inner_texts()][:3] == ['What we are building', 'How it will treat your data and other people', 'What is not built yet'], f'{title}: the three sections in order')
            check('no price and no date' in t.lower() and p.locator('#soon-notify').count() == 1, f'{title}: says no price, no date, and the Tell me button is still there')
            check(p.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth'), f'{title}: no sideways scroll')
            if dept == 'games': p.screenshot(path=str(Path('D:/Ryagram-scratch/WEB/temp') / f'dept-games-{name}.png'), full_page=True)
            p.context.close()
        p = page(b, on_cfg, opts, errs); go(p, 'compilations', 'Compilations')
        check('Draft wording' not in p.inner_text('main') and 'What we are building' not in p.inner_text('main'), 'Compilations is not changed')
        p.context.close()
        check(not errs, 'no console errors' + (f': {errs[:2]}' if errs else ''))
    print('switch off')
    errs = []
    for dept, title in (('geo_intelligence', 'Geographic Intelligence'), ('games', 'Games')):
        p = page(b, base, dict(viewport={'width': 1200, 'height': 900}), errs); go(p, dept, title)
        check('Draft wording' not in p.inner_text('main') and p.locator('main h2').count() == 0 and p.locator('#soon-notify').count() == 1, f'{title}: exactly as before with the switch off')
        p.context.close()
    b.close()
srv.shutdown()
print('ALL OK' if ok else 'FAILED'); sys.exit(0 if ok else 1)
