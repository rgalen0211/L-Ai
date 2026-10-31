"""The tester first-run wizard (#/tester-start, NEXT-WEB 192) in real Chrome, mock mode, LOCAL server only, `testerWizard` ON in a local config copy, desktop and phone (375 and 320 px):
a tester with no computer is told to sign one in; a computer seen two days ago is not awake; one seen just now is; the disk step is the person's own yes (a click moves the wizard on and says the page cannot see the disk);
a plain (non-tester) account gets the one plain sentence; with the switch OFF the route shows nothing of the wizard; no sideways scroll; no console errors. Needs Chrome.   python tools/check-tester-wizard.py"""
import http.server, re, socketserver, sys, threading
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
PORT = 8318


class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=str(ROOT), **k)
    def log_message(self, *a): pass
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store'); super().end_headers()


socketserver.TCPServer.allow_reuse_address = True
srv = socketserver.ThreadingTCPServer(('127.0.0.1', PORT), H)
threading.Thread(target=srv.serve_forever, daemon=True).start()
base = (ROOT / 'assets/ryagram-config.js').read_text(encoding='utf-8')
on_cfg = re.sub(r'testerWizard:\s*false', 'testerWizard: true', base)
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


def go(p, q):
    p.goto(f'http://127.0.0.1:{PORT}/app/?mock{q}#/tester-start', wait_until='load'); p.wait_for_selector('.wiz-body *', timeout=20000); p.wait_for_timeout(300)


def txt(p): return p.inner_text('.wiz-body')


with sync_playwright() as pw:
    b = pw.chromium.launch(channel='chrome')
    for name, opts in (('desktop', dict(viewport={'width': 1200, 'height': 900})), ('phone375', dict(viewport={'width': 375, 'height': 812}, device_scale_factor=2, is_mobile=True, has_touch=True)),
                       ('phone320', dict(viewport={'width': 320, 'height': 700}, device_scale_factor=2, is_mobile=True, has_touch=True))):
        print(name)
        errs = []
        p = page(b, on_cfg, opts, errs)
        go(p, '&tester')
        check(p.locator('.wiz-step').count() == 4, 'four steps')
        check('No computer is signed in yet' in txt(p) and p.locator('.wiz-now h2').inner_text().startswith('2.'), 'a tester with no computer: step 2 is the one to do now')
        check(p.locator('.wiz-step[aria-current="step"]').count() == 1, 'exactly one step is marked as the current one')
        check('cannot see your computer' in txt(p) and '[DRAFT: Ryan to set how many GB]' in txt(p), 'the disk step says the page cannot see the disk and marks the number as a draft')
        p.context.close()
        p = page(b, on_cfg, opts, errs)
        go(p, '&tester&wzquiet')
        check('DESKTOP-WIZ is signed in, but it was last seen 2 days ago' in txt(p), 'a computer seen two days ago is not awake')
        p.context.close()
        p = page(b, on_cfg, opts, errs)
        go(p, '&tester&wzawake&empty')
        check('DESKTOP-WIZ is awake' in txt(p) and p.locator('.wiz-now h2').inner_text().startswith('3.'), 'a computer seen just now is awake; the disk step is next')
        p.get_by_role('button', name='I checked: the drive has room').click(); p.wait_for_timeout(400)
        check(p.locator('.wiz-now h2').inner_text().startswith('4.') and 'You said the drive has room' in txt(p), 'the person\'s own yes moves the wizard to the first film')
        check(p.locator('.wiz-now a.primary').count() == 1, 'the first film step has one clear button')
        p.context.close()
        p = page(b, on_cfg, opts, errs)
        go(p, '&tester&wzawake')
        p.get_by_role('button', name='I checked: the drive has room').click(); p.wait_for_timeout(400)
        check('All four steps are done' in txt(p) and p.locator('.wiz-now').count() == 0 and p.locator('a[href="#/films"]').count() == 1, 'with a film already made and the yes given, all four are done and My films is linked')
        p.reload(wait_until='load'); p.wait_for_selector('.wiz-body *'); p.wait_for_timeout(400)
        check('All four steps are done' in txt(p), 'the yes is remembered in this browser')
        check(p.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth'), 'no sideways scroll')
        check(not errs, 'no console errors' + (f': {errs[:2]}' if errs else ''))
        p.context.close()
    print('plain account and switch off')
    errs = []
    p = page(b, on_cfg, dict(viewport={'width': 1200, 'height': 900}), errs)
    go(p, '')
    check('invited testers' in txt(p) and p.locator('.wiz-step').count() == 0, 'an account without the tester flag gets the one plain sentence')
    p.context.close()
    p = page(b, base, dict(viewport={'width': 1200, 'height': 900}), errs)
    p.goto(f'http://127.0.0.1:{PORT}/app/?mock&tester#/tester-start', wait_until='load'); p.wait_for_timeout(1500)
    check(p.locator('.wiz-step').count() == 0 and p.locator('.wiz-body').count() == 0, 'with the switch off nothing of the wizard is shown')
    p.context.close(); b.close()
srv.shutdown()
print('ALL OK' if ok else 'FAILED'); sys.exit(0 if ok else 1)
