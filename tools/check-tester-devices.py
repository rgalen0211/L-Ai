"""Each tester's computers on #/admin/tester (NEXT-WEB 187) in real Chrome, mock mode (admin), LOCAL server only, `adminTesterDevices` ON in a local config copy, desktop and phone: the page lists each tester with
its computers in words (one awake, one not seen for two days holding nothing, a tester with no computer and films waiting), says plainly what the app does not report yet, has no sideways scroll at 375 px, and with
the switch OFF the section is not there; a plain (non-admin) account is told no. Needs Chrome.   python tools/check-tester-devices.py"""
import http.server, re, socketserver, sys, threading
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
PORT = 8316


class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=str(ROOT), **k)
    def log_message(self, *a): pass
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store'); super().end_headers()


socketserver.TCPServer.allow_reuse_address = True
srv = socketserver.ThreadingTCPServer(('127.0.0.1', PORT), H)
threading.Thread(target=srv.serve_forever, daemon=True).start()
base = (ROOT / 'assets/ryagram-config.js').read_text(encoding='utf-8')
on_cfg = re.sub(r'adminTesterDevices:\s*false', 'adminTesterDevices: true', base)
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


with sync_playwright() as pw:
    b = pw.chromium.launch(channel='chrome')
    for name, opts in (('desktop', dict(viewport={'width': 1200, 'height': 900})), ('phone', dict(viewport={'width': 375, 'height': 812}, device_scale_factor=2, is_mobile=True, has_touch=True))):
        print(name)
        errs = []
        p = page(b, on_cfg, opts, errs)
        p.goto(f'http://127.0.0.1:{PORT}/app/?mock#/admin/tester', wait_until='load'); p.wait_for_selector('.tester-device', timeout=20000); p.wait_for_timeout(300)
        check(p.locator('.tester-device').count() == 3, 'three testers listed')
        sam = p.inner_text('.tester-device:has-text("sam@example.com")')
        check('a computer is awake' in sam and 'DESKTOP-SAM-PC: seen in the last 3 minutes; holding 1 film now' in sam and 'ALIENWARE: not seen for a while (last 2 days ago)' in sam and '1 film waiting for a computer' in sam, 'Sam: one computer awake and holding a film, one not seen for 2 days, one film waiting')
        check('no computer seen lately' in p.inner_text('.tester-device:has-text("pat@example.com")'), 'Pat: signed in but not seen lately')
        lee = p.inner_text('.tester-device:has-text("lee@example.com")')
        check('no computer signed in' in lee and '2 films waiting for a computer' in lee, 'Lee: no computer, two films waiting')
        check('can render' in p.inner_text('.tester-devices') and 'disk floor' in p.inner_text('.tester-devices') and 'not reported' in p.inner_text('.tester-devices'), 'it says plainly what the app does not report')
        check(p.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth'), 'no sideways scroll')
        check(not errs, 'no console errors' + (f': {errs[:2]}' if errs else ''))
        p.context.close()
    print('switch off and a plain account')
    errs = []
    p = page(b, base, dict(viewport={'width': 1200, 'height': 900}), errs)
    p.goto(f'http://127.0.0.1:{PORT}/app/?mock#/admin/tester', wait_until='load'); p.wait_for_selector('h1:has-text("Tester computers")', timeout=20000); p.wait_for_timeout(500)
    check(p.locator('.tester-devices:visible').count() == 0 and p.locator('.tester-device').count() == 0, 'with the switch off the section is not shown')
    p.context.close()
    p = page(b, on_cfg, dict(viewport={'width': 1200, 'height': 900}), errs)
    p.goto(f'http://127.0.0.1:{PORT}/app/?mock&nonadmin#/admin/tester', wait_until='load'); p.wait_for_timeout(1500)
    check(p.locator('.tester-device').count() == 0, 'a plain account sees no list of testers')
    p.context.close(); b.close()
srv.shutdown()
print('ALL OK' if ok else 'FAILED'); sys.exit(0 if ok else 1)
