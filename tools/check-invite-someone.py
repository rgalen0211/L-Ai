"""'Invite someone' on #/admin/ops in real Chrome, mock mode (fake data), desktop and phone: Ryan fills name + email (+ optional credits), the code is shown ONCE with an
'Email it' link carrying the address and the code, and Done clears it. Writes screenshots. Not part of the node suite (it needs Chrome).

    python tools/check-invite-someone.py [outdir]        (default D:/Ryagram-scratch/WEB/invite-shots)
"""
import http.server
import socketserver
import sys
import threading
import urllib.parse
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('D:/Ryagram-scratch/WEB/invite-shots')
PORT = 8170
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
    try:
        with sync_playwright() as pw:
            b = pw.chromium.launch(channel='chrome')
            for name, opts in (('desktop', dict(viewport={'width': 1280, 'height': 900})),
                               ('phone', dict(viewport={'width': 390, 'height': 844}, device_scale_factor=3, is_mobile=True, has_touch=True))):
                print(name)
                ctx = b.new_context(**opts)
                p = ctx.new_page()
                errors = []
                p.on('pageerror', lambda e: errors.append(str(e)))
                p.on('console', lambda m: errors.append(m.text) if m.type == 'error' and 'status of 404' not in m.text else None)
                p.on('response', lambda r: errors.append(f'{r.status} {r.url}') if r.status >= 400 and not r.url.endswith('/favicon.ico') else None)
                p.goto(f'{BASE}/app/?mock#/admin/ops', wait_until='load')
                p.wait_for_selector('text=Creator beta applications', timeout=20000)
                sec = p.locator('section.ops-section', has_text='Creator beta applications')
                sec.locator('summary', has_text='Invite someone').click()
                p.fill('#ip-name', 'Maya Ortiz')
                p.fill('#ip-email', 'maya@example.com')
                p.fill('#ip-credits', '35')
                sec.screenshot(path=str(OUT / f'invite-{name}-form.png'))
                sec.get_by_role('button', name='Make an invite code', exact=True).click()
                p.wait_for_selector('.invite-panel', timeout=10000)
                panel = p.locator('.invite-panel').inner_text()
                check('Invite code for Maya Ortiz' in panel and 'RYA-' in panel and 'shown once' in panel, 'the code is shown once with the name')
                href = p.locator('.invite-panel a').get_attribute('href')
                check(href.startswith('mailto:maya%40example.com?subject='), 'the Email it link is addressed to them')
                body = urllib.parse.unquote(href.split('&body=')[1])
                check('RYA-' in body and '35 beta credits will be waiting' in body, 'and carries the code and the 35 credits')
                check(p.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), 'no sideways scroll')
                sec.screenshot(path=str(OUT / f'invite-{name}-code.png'))
                p.locator('.invite-panel').get_by_role('button', name='Done').click()
                p.wait_for_timeout(300)
                check(p.locator('.invite-panel').count() == 0, 'Done clears the code from the screen')
                p.reload(wait_until='load')
                p.wait_for_selector('text=Creator beta applications', timeout=20000)
                check(p.locator('.invite-panel').count() == 0, 'and a reload does not bring it back')
                check(not errors, f'no page errors {errors}')
                ctx.close()
            b.close()
    finally:
        srv.shutdown()
    print('RESULT:', 'PASS' if ok else 'FAIL')
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
