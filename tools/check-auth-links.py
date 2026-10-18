"""Auth email links in real Chrome: (1) /app/?mock#/auth?token_hash=...&type=recovery shows a button and spends NOTHING until it is pressed, then asks for a new password;
(2) a wrong token lands on the "link expired" screen with the resend form; (3) the site ROOT forwards #error=...otp_expired to /app/#/auth/expired; (4) the sign-in page
has "Forgot your password?". Desktop and phone width; writes screenshots. Not part of the node suite (it needs Chrome).

    python tools/check-auth-links.py [outdir]        (default D:/Ryagram-scratch/WEB/auth-shots)
"""
import http.server
import socketserver
import sys
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('D:/Ryagram-scratch/WEB/auth-shots')
PORT = 8171
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
            for name, opts in (('desktop', dict(viewport={'width': 1280, 'height': 800})),
                               ('phone', dict(viewport={'width': 390, 'height': 844}, device_scale_factor=3, is_mobile=True, has_touch=True))):
                print(name)
                ctx = b.new_context(**opts)
                page = ctx.new_page()
                errors = []
                page.on('pageerror', lambda e: errors.append(str(e)))
                # 1. a good link: a button, nothing spent until it is pressed
                page.goto(f'{BASE}/app/?mock#/auth?token_hash=mock-reset-token&type=recovery', wait_until='load')
                page.wait_for_selector('#auth-link:not([hidden])', timeout=20000)
                check(page.evaluate('location.hash') == '#/', 'the token left the address bar')
                check('Reset your password' in page.inner_text('#auth-link'), 'it says what the link is for')
                check(page.locator('#sign-in').is_hidden() and page.locator('#set-password').is_hidden(), 'nothing else is shown, and no password screen yet')
                page.screenshot(path=str(OUT / f'link-{name}.png'))
                page.click('#auth-link-go')
                page.wait_for_selector('#set-password:not([hidden])', timeout=10000)
                check(page.locator('#auth-link').is_hidden(), 'after the button: the set-new-password screen')
                page.fill('#np-password', 'a-long-new-password')
                page.fill('#np-again', 'a-long-new-password')
                page.click('#set-password-form button[type=submit]')
                page.wait_for_selector('#library:not([hidden])', timeout=10000)
                check(True, 'the new password is saved and the library opens')
                # 2. a wrong token: the expired screen with a resend form
                page.goto(f'{BASE}/app/?mock#/auth?token_hash=wrong-token-0123456789&type=recovery', wait_until='load')
                page.reload(wait_until='load')
                page.goto(f'{BASE}/app/?mock#/auth?token_hash=wrong-token-0123456789&type=recovery', wait_until='load')
                page.wait_for_selector('#auth-link:not([hidden])', timeout=20000)
                page.click('#auth-link-go')
                page.wait_for_selector('#auth-expired:not([hidden])', timeout=10000)
                check('expired' in page.inner_text('#auth-expired').lower(), 'a spent or wrong link: the "expired" screen')
                page.fill('#ax-email', 'ryan@example.com')
                page.click('#auth-expired-form button[type=submit]')
                page.wait_for_function("document.getElementById('auth-expired-note').textContent.length > 0", timeout=10000)
                check('new link is on its way' in page.inner_text('#auth-expired-note'), 'the resend form answers')
                check(page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), 'no sideways scroll')
                page.screenshot(path=str(OUT / f'expired-{name}.png'))
                # 3. the site root forwards a Supabase error to the app
                page.goto(f'{BASE}/#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired', wait_until='load')
                page.wait_for_url('**/app/**', timeout=10000)
                page.wait_for_selector('#auth-expired:not([hidden])', timeout=20000)
                check(page.url.endswith('/app/#/') or '/app/' in page.url, f'the root forwarded to the app ({page.url})')
                check('error' not in page.url, 'and the error text is not left in the address')
                # 3b. a session fragment (a link Supabase already verified) signs nobody in from the address bar: the button names the account first
                import base64, json
                payload = base64.urlsafe_b64encode(json.dumps({'email': 'maya@example.com', 'sub': 'x'}).encode()).decode().rstrip('=')
                page.goto(f'{BASE}/app/?mock#access_token=eyJhbGciOiJIUzI1NiJ9.{payload}.c2lnbmF0dXJl&refresh_token=REFRESHtoken_0123456789&type=magiclink', wait_until='load')
                page.wait_for_selector('#auth-link:not([hidden])', timeout=20000)
                check('Continue as maya@example.com' in page.inner_text('#auth-link-go'), 'a session link shows "Continue as <email>"')
                check(page.locator('#library').is_hidden() and page.evaluate('location.hash') == '#/', 'nobody is signed in yet, and the tokens left the address')
                page.screenshot(path=str(OUT / f'session-{name}.png'))
                page.click('#auth-link-go')
                page.wait_for_selector('#library:not([hidden])', timeout=10000)
                check(True, 'pressing it signs in')
                # 4. the sign-in page offers Forgot your password
                page.goto(f'{BASE}/app/?mock', wait_until='load')
                page.evaluate("document.getElementById('sign-out') && document.getElementById('sign-out').click()")
                page.wait_for_timeout(500)
                page.goto(f'{BASE}/app/', wait_until='load')
                page.wait_for_selector('#sign-in:not([hidden])', timeout=20000)
                check(page.locator('#forgot-row').is_visible() and 'Forgot your password' in page.inner_text('#forgot-row'), 'the sign-in page has "Forgot your password?"')
                page.screenshot(path=str(OUT / f'signin-{name}.png'))
                check(not errors, f'no page errors {errors}')
                ctx.close()
            b.close()
    finally:
        srv.shutdown()
    print('RESULT:', 'PASS' if ok else 'FAIL')
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
