"""The consent page says WHICH account it would connect, and 'Not you? Switch account' (NEXT-WEB 162, PUNCH P1) in real Chrome, mock mode, desktop and phone: the signed-in email is on the page in words with the
rule about administrator accounts; Switch signs out and keeps the consent address; signing in as the other account lands on the SAME request with the new email; nothing was approved or denied by switching;
a refused request (an administrator) shows the same strip and the way out. Needs Chrome.   python tools/check-consent-account.py"""
import http.server, socketserver, sys, threading
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
PORT = 8301
GOOD = '00000000-0000-4000-8000-0000000000aa'
ADMIN_REFUSED = '00000000-0000-4000-8000-0000000000dd'


class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=str(ROOT), **k)
    def log_message(self, *a): pass


socketserver.TCPServer.allow_reuse_address = True
srv = socketserver.ThreadingTCPServer(('127.0.0.1', PORT), H)
threading.Thread(target=srv.serve_forever, daemon=True).start()
ok = True


def check(c, w):
    global ok
    print(('  ok   ' if c else '  FAIL ') + w); ok = ok and bool(c)


def sign_in_as(p, email):
    p.wait_for_selector('#si-email', state='visible', timeout=15000)
    p.fill('#si-email', email); p.fill('#si-password', 'a-long-password-12'); p.click('#sign-in-form button[type=submit]')


with sync_playwright() as pw:
    b = pw.chromium.launch(channel='chrome')
    for name, opts in (('desktop', dict(viewport={'width': 1280, 'height': 900})), ('phone', dict(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True))):
        print(name)
        p = b.new_context(**opts).new_page(); errs = []
        p.on('pageerror', lambda e: errs.append(str(e)))
        p.goto(f'http://127.0.0.1:{PORT}/app/?mock#/connect/consent?request={GOOD}', wait_until='load')
        p.wait_for_selector('[data-key="consent-account"]', timeout=15000)
        check(p.locator('[data-key="consent-email"]').inner_text() == 'mock@localhost', 'the page says which account: mock@localhost')
        t = p.inner_text('[data-key="consent-account"]')
        check('Approving connects THIS Ryagram account' in t and 'Administrator accounts cannot be connected' in t, 'in words, with the rule about administrator accounts')
        check(p.locator('button:has-text("Approve")').count() == 1, 'Approve is still there (the strip adds, it does not replace)')
        check(p.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth'), 'no sideways scroll')
        p.screenshot(path=f'D:/Ryagram-scratch/WEB/consent-account-{name}.png', full_page=True)
        before = p.evaluate("(window.ryagramMock && window.ryagramMock.client.db.connectDecisions || []).length")
        p.click('[data-key="consent-switch"]')
        p.wait_for_selector('#si-email', state='visible', timeout=15000)
        check(p.evaluate('location.hash') == f'#/connect/consent?request={GOOD}', 'Switch account signs out and KEEPS the consent address')
        sign_in_as(p, 'other@example.com')
        p.wait_for_selector('[data-key="consent-email"]', timeout=15000)
        check(p.locator('[data-key="consent-email"]').inner_text() == 'other@example.com', 'signing in as the other account lands on the SAME request, now showing other@example.com')
        check(p.locator('h1.consent-who').count() == 1 and p.locator('button:has-text("Approve")').count() == 1, 'with the full consent page')
        after = p.evaluate("(window.ryagramMock && window.ryagramMock.client.db.connectDecisions || []).length")
        check(before == after == 0, 'nothing was approved or denied by switching')
        # a refused request for an administrator: the same strip and the way out
        q = b.new_context(**opts).new_page()
        q.goto(f'http://127.0.0.1:{PORT}/app/?mock#/connect/consent?request={ADMIN_REFUSED}', wait_until='load')
        q.wait_for_selector('[data-key="consent-account"]', timeout=15000)
        check('Administrator accounts cannot be connected to an AI assistant.' in q.inner_text('main') and q.locator('button:has-text("Approve")').count() == 0, 'an administrator is refused in the server\'s words, with no Approve button')
        check(q.locator('[data-key="consent-switch"]').count() == 1, 'and the Switch account button is there')
        q.click('[data-key="consent-switch"]'); sign_in_as(q, 'other@example.com')
        q.wait_for_selector('h1.consent-who', timeout=15000)
        check(q.locator('[data-key="consent-email"]').inner_text() == 'other@example.com', 'switching from the refused page lands on the same request, now allowed for the other account')
        check(not errs, 'no page errors' + (f': {errs[:2]}' if errs else ''))
    b.close()
srv.shutdown()
print('ALL OK' if ok else 'FAILED'); sys.exit(0 if ok else 1)
