"""The sign-in landing fix in real Chrome, mock mode, desktop and phone (live ride, Ryan 2026-10-26 17:32): signing in as a DIFFERENT account from a tab left on the last account's version page
lands on home (not on 'Cannot coerce the result to a single JSON object'); the same account signing back in keeps its page; a page that is not there says 'This page isn't available on this account'
with a way home, never the database's own sentence; the 'You have signed out.' note is gone once signed in. Writes screenshots. Needs Chrome, so it is not part of the node suite.

    python tools/check-signin-landing.py [outdir]        (default D:/Ryagram-scratch/WEB/signin-shots)
"""
import http.server
import re
import socketserver
import sys
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('D:/Ryagram-scratch/WEB/signin-shots')
PORT = 8191
BASE = f'http://127.0.0.1:{PORT}'
GONE = '00000000-0000-4000-8000-000000000999'


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


OFF_CFG = re.sub(r'aiFirst:\s*true', 'aiFirst: false', re.sub(r'departments:\s*true', 'departments: false', (ROOT / 'assets' / 'ryagram-config.js').read_text(encoding='utf-8')))


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    srv = serve()
    ok = True

    def check(cond, what):
        nonlocal ok
        print(('  ok   ' if cond else '  FAIL ') + what)
        ok = ok and bool(cond)

    def sign_in(p, email):
        p.fill('#si-email', email)
        p.fill('#si-password', 'x')
        p.click('#sign-in-form button[type=submit]')
        p.wait_for_selector('#sign-out', timeout=10000)
        p.wait_for_timeout(500)
    try:
        with sync_playwright() as pw:
            b = pw.chromium.launch(channel='chrome')
            for name, opts in (('desktop', dict(viewport={'width': 1280, 'height': 900})),
                               ('phone', dict(viewport={'width': 390, 'height': 844}, device_scale_factor=3, is_mobile=True, has_touch=True))):
                print(name)
                ctx = b.new_context(**opts)
                ctx.route('**/assets/ryagram-config.js*', lambda route: route.fulfill(status=200, content_type='text/javascript', body=OFF_CFG))      # this check walks the library; the AI-first door (ON since Q303) is checked by check-start.py
                p = ctx.new_page()
                errors = []
                p.on('pageerror', lambda e: errors.append(str(e)))
                p.on('console', lambda m: errors.append(m.text) if m.type == 'error' and 'status of 404' not in m.text and 'Failed to load resource' not in m.text else None)
                p.goto(f'{BASE}/app/?mock', wait_until='load')
                p.wait_for_selector('#np-title', timeout=20000)
                p.fill('#np-title', 'Account A project')
                p.click('button:has-text("Create")')
                p.wait_for_selector('h1:has-text("Version 1")', timeout=20000)
                page_hash = p.evaluate('location.hash')
                check(page_hash.startswith('#/v/'), 'a signed-in person is on a version page')
                # 1. the same account signs out and back in: it keeps its page
                p.click('#sign-out')
                p.wait_for_selector('#app-status:has-text("You have signed out.")', timeout=10000)
                sign_in(p, 'mock@localhost')
                check(p.evaluate('location.hash') == page_hash and p.locator('h1:has-text("Version 1")').count() == 1, 'the SAME account signing back in keeps its version page')
                check(p.locator('#app-status').is_hidden() or 'signed out' not in p.inner_text('#app-status'), 'and the "You have signed out." note is gone')
                # 2. a DIFFERENT account signs in from that page: home, never the last account's page
                p.click('#sign-out')
                p.wait_for_selector('#app-status:has-text("You have signed out.")', timeout=10000)
                p.screenshot(path=str(OUT / f'signed-out-{name}.png'), full_page=True)
                sign_in(p, 'other@localhost')
                p.wait_for_selector('h1:has-text("Your projects")', timeout=10000)
                check(p.evaluate('location.hash') in ('#/', ''), 'a DIFFERENT account lands on home, not on the last account\'s version page')
                t = p.inner_text('main') if p.locator('main').count() else p.inner_text('body')
                check('Cannot coerce' not in t and 'JSON object' not in t and 'Something went wrong' not in t, 'no database sentence and no "Something went wrong"')
                check(p.locator('#app-status').is_hidden() or 'signed out' not in p.inner_text('#app-status'), 'the "You have signed out." note is gone on the signed-in page')
                p.screenshot(path=str(OUT / f'other-account-home-{name}.png'), full_page=True)
                # 3. a page that is not there says so plainly, with a way home
                for kind in ('v', 'p'):
                    p.evaluate(f"location.hash = '#/{kind}/{GONE}'")
                    p.wait_for_selector('h1:has-text("This page isn’t available on this account")', timeout=10000)
                    t = p.inner_text('body')
                    check('JSON object' not in t and 'Cannot coerce' not in t and 'Something went wrong' not in t, f'#/{kind}/<missing>: plain words, no database sentence')
                    check(p.locator('#not-available-home').count() == 1 and 'different account' in t, f'#/{kind}/<missing>: says why and has a way home')
                    if kind == 'v':
                        p.screenshot(path=str(OUT / f'not-available-{name}.png'), full_page=True)
                p.click('#not-available-home')
                p.wait_for_selector('h1:has-text("Your projects")', timeout=10000)
                check(p.evaluate('location.hash') in ('#/', ''), 'the button goes home')
                check(p.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth'), 'no sideways scroll')
                check(errors == [], 'no console errors')
                ctx.close()
            b.close()
    finally:
        srv.shutdown()
    print('ALL OK' if ok else 'FAILED')
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
