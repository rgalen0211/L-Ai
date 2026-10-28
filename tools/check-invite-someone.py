"""'Invite someone' on #/admin/ops in real Chrome, mock mode (fake data), desktop and phone: Ryan fills name + email (+ optional credits), Ryagram SENDS the
invite email itself (NEXT-WEB 155; the mock stands in for send-invite), the code is shown ONCE with what happened in words, Resend and Copy code, and Done clears it. Writes screenshots. Not part of the node suite (it needs Chrome).

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
                def open_form():
                    p.wait_for_selector('text=Creator beta applications', timeout=20000)
                    sec = p.locator('section.ops-section', has_text='Creator beta applications')
                    sec.locator('summary', has_text='Invite someone').click()
                    p.fill('#ip-name', 'Maya Ortiz')
                    p.fill('#ip-email', 'maya@example.com')
                    p.fill('#ip-credits', '35')
                    return sec

                p.goto(f'{BASE}/app/?mock#/admin/ops', wait_until='load')
                sec = open_form()
                sec.screenshot(path=str(OUT / f'invite-{name}-form.png'))
                check('Ryagram sends the invite here' in sec.inner_text(), 'the form says Ryagram sends it')
                sec.get_by_role('button', name='Send the invite', exact=True).click()
                p.wait_for_selector('.invite-panel [data-key="invite-line"]:has-text("Sent to maya@example.com")', timeout=10000)
                panel = p.locator('.invite-panel').inner_text()
                check('Invite code for Maya Ortiz' in panel and 'RYA-' in panel and 'shown once' in panel, 'the code is shown once with the name')
                check(p.locator('.invite-panel a[href^="mailto:"]').count() == 0, 'there is no mail-program link on the card')
                check(p.locator('.invite-panel [data-key="invite-resend"]').inner_text() == 'Resend to maya@example.com', 'a Resend button is there')
                check(p.locator('.invite-panel button:has-text("Copy code")').count() == 1, 'and Copy code stays as the fallback')
                check(p.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), 'no sideways scroll')
                sec.screenshot(path=str(OUT / f'invite-{name}-code.png'))
                p.locator('.invite-panel [data-key="invite-resend"]').click()
                p.wait_for_selector('.invite-panel [data-key="invite-line"]:has-text("send 2 of 3")', timeout=10000)
                check(True, 'Resend sends again and counts it (send 2 of 3)')
                p.locator('.invite-panel [data-key="invite-resend"]').click()
                p.wait_for_selector('.invite-panel [data-key="invite-line"]:has-text("send 3 of 3")', timeout=10000)
                p.locator('.invite-panel [data-key="invite-resend"]').click()
                p.wait_for_selector('.invite-panel [data-key="invite-line"]:has-text("3 times")', timeout=10000)
                check('Not sent' in p.locator('.invite-panel [data-key="invite-line"]').inner_text(), 'a fourth send is refused in words, and the card says Not sent')
                p.locator('.invite-panel').get_by_role('button', name='Done').click()
                p.wait_for_timeout(300)
                check(p.locator('.invite-panel').count() == 0, 'Done clears the code from the screen')
                p.reload(wait_until='load')
                p.wait_for_selector('text=Creator beta applications', timeout=20000)
                check(p.locator('.invite-panel').count() == 0, 'and a reload does not bring it back')
                # mail not switched on: SAVED, never "Sent"
                p.goto(f'{BASE}/app/?mock&mailoff#/admin/ops', wait_until='load')
                sec = open_form()
                sec.get_by_role('button', name='Send the invite', exact=True).click()
                p.wait_for_selector('.invite-panel [data-key="invite-line"]', timeout=10000)
                line = p.locator('.invite-panel [data-key="invite-line"]').inner_text()
                check(line.startswith('Not sent: mail is not switched on') and 'Recent messages' in line, 'dry-run says plainly that nothing was sent')
                check(p.locator('.invite-panel [data-key="invite-resend"]').inner_text() == 'Send to maya@example.com', 'and the button reads Send, not Resend')
                # the mail service refuses: the code exists, the card shows it with the reason and a Send again
                p.goto(f'{BASE}/app/?mock&sendfail#/admin/ops', wait_until='load')
                sec = open_form()
                sec.get_by_role('button', name='Send the invite', exact=True).click()
                p.wait_for_selector('.invite-panel [data-key="invite-line"]', timeout=10000)
                line = p.locator('.invite-panel [data-key="invite-line"]').inner_text()
                check(line.startswith('Not sent:') and 'did not accept the message' in line and 'RYA-' in p.locator('.invite-panel').inner_text(), 'a refused send keeps the code on the card, with the reason')
                sec.screenshot(path=str(OUT / f'invite-{name}-failed.png'))
                check(not errors, f'no page errors {errors}')
                ctx.close()
            b.close()
    finally:
        srv.shutdown()
    print('RESULT:', 'PASS' if ok else 'FAIL')
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
