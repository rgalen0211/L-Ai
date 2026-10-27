"""The #/device landing fix in real Chrome, mock mode, desktop and phone (live ride, Ryan 2026-10-26 12:37): a tab left on #/device with no code does not land there after sign-in
(home instead); #/device with no code says in one line what it is for and has a Back to my films button; with a code in the link nothing changes; the 'You have signed out.' note is cleared
once signed in again. Writes screenshots. Needs Chrome, so it is not part of the node suite.

    python tools/check-device-landing.py [outdir]        (default D:/Ryagram-scratch/WEB/device-shots)
"""
import http.server
import re
import socketserver
import sys
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('D:/Ryagram-scratch/WEB/device-shots')
PORT = 8189
BASE = f'http://127.0.0.1:{PORT}'


def serve():
    class H(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *a, **k):
            super().__init__(*a, directory=str(ROOT), **k)

        def log_message(self, *a):
            pass

        def end_headers(self):
            self.send_header('Cache-Control', 'no-store')
            super().end_headers()
    socketserver.TCPServer.allow_reuse_address = True
    srv = socketserver.ThreadingTCPServer(('127.0.0.1', PORT), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    srv = serve()
    ok = True

    def check(cond, what):
        nonlocal ok
        print(('  ok   ' if cond else '  FAIL ') + what)
        ok = ok and bool(cond)
    cfg = (ROOT / 'assets' / 'ryagram-config.js').read_text(encoding='utf-8')
    flipped = re.sub(r'desktopApp:\s*false', 'desktopApp: true', cfg)
    try:
        with sync_playwright() as pw:
            b = pw.chromium.launch(channel='chrome')
            for name, opts in (('desktop', dict(viewport={'width': 1280, 'height': 900})),
                               ('phone', dict(viewport={'width': 390, 'height': 844}, device_scale_factor=3, is_mobile=True, has_touch=True))):
                print(name)
                ctx = b.new_context(**opts)
                ctx.route('**/assets/ryagram-config.js*', (lambda body: (lambda route: route.fulfill(status=200, content_type='text/javascript', body=body)))(flipped))
                p = ctx.new_page()
                errors = []
                p.on('pageerror', lambda e: errors.append(str(e)))
                p.on('console', lambda m: errors.append(m.text) if m.type == 'error' and 'status of 404' not in m.text and 'Failed to load resource' not in m.text else None)
                # 1. a tab left on #/device with no code: signing in lands on home, not on the approval page
                p.goto(f'{BASE}/app/?mock#/device', wait_until='load')
                p.wait_for_selector('#library h1', timeout=20000)
                p.wait_for_timeout(800)
                check(p.evaluate('location.hash') in ('#/', ''), 'opening the app on #/device with no code lands on home, not on the approval page')
                check('Approve this computer?' not in p.inner_text('main'), 'the approval question is not on screen')
                p.screenshot(path=str(OUT / f'home-{name}.png'), full_page=True)
                # 2. reached on purpose with no code: one line and a way back
                p.evaluate("location.hash = '#/device'")
                p.wait_for_selector('h1:has-text("Approve this computer?")', timeout=10000)
                t = p.inner_text('main')
                check('Only needed if the Ryagram desktop app showed you a code.' in t, 'no code: one line says what the page is for')
                check('is asking to sign in to your account' not in t, 'no code: it does not claim an app is asking')
                check(p.locator('#device-back').count() == 1 and p.inner_text('#device-back') == 'Back to my films', 'a Back to my films button')
                check(p.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth'), 'no sideways scroll')
                p.screenshot(path=str(OUT / f'device-nocode-{name}.png'), full_page=True)
                p.click('#device-back')
                p.wait_for_selector('h1:has-text("Your projects")', timeout=10000)
                check(p.evaluate('location.hash') in ('#/', ''), 'Back to my films goes home')
                # 3. a code in the link: the page is as it was
                p.evaluate("location.hash = '#/device?code=ABCD-2345'")
                p.wait_for_selector('h1:has-text("Approve this computer?")', timeout=10000)
                check('is asking to sign in to your account' in p.inner_text('main') and p.locator('#device-back').count() == 0, 'with a code in the link nothing changes')
                # 4. the signed-out note does not follow you back in
                p.evaluate("location.hash = '#/'")
                p.wait_for_selector('#sign-out', timeout=10000)
                p.click('#sign-out')
                p.wait_for_selector('#app-status:has-text("You have signed out.")', timeout=10000)
                check(True, 'signing out shows the note')
                p.fill('#si-email', 'mock@localhost')
                p.fill('#si-password', 'x')
                p.click('#sign-in-form button[type=submit]')
                p.wait_for_selector('#sign-out', timeout=10000)
                p.wait_for_timeout(400)
                check('You have signed out.' not in p.inner_text('#app-status') or p.locator('#app-status').is_hidden(), 'signed in again: the "You have signed out." note is gone')
                check(errors == [], 'no console errors')
                ctx.close()
            b.close()
    finally:
        srv.shutdown()
    print('ALL OK' if ok else 'FAILED')
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
