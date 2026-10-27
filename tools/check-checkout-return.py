"""Real Chrome (mock mode): coming back from Checkout shows the 'Thanks. Stripe has your payment' line ONCE; ?paid=... is dropped from the address at once, so a
reload and a later visit show nothing. Not part of the node suite (it needs Chrome).

    python tools/check-checkout-return.py
"""
import http.server
import socketserver
import sys
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('D:/Ryagram-scratch/WEB/return-shots')
PORT = 8167
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
    srv = serve()
    ok = True

    def check(cond, what):
        nonlocal ok
        print(('  ok   ' if cond else '  FAIL ') + what)
        ok = ok and bool(cond)
    try:
        with sync_playwright() as pw:
            b = pw.chromium.launch(channel='chrome')
            ctx = b.new_context(viewport={'width': 1280, 'height': 800})
            page = ctx.new_page()
            errors = []
            page.on('pageerror', lambda e: errors.append(str(e)))
            page.goto(f'{BASE}/app/?mock#/credits?paid=pack_starter', wait_until='load')
            page.wait_for_selector('.credit-thanks', timeout=20000)
            check('Stripe has your payment' in page.inner_text('.credit-thanks') or 'credits have arrived' in page.inner_text('.credit-thanks'), 'the thanks line shows on the return')
            check(page.evaluate('location.hash') == '#/credits', f'and ?paid is gone from the address ({page.evaluate("location.hash")!r})')
            page.reload(wait_until='load')
            page.wait_for_selector('.credit-balance', timeout=20000)
            check(page.locator('.credit-thanks').count() == 0, 'after a reload there is no thanks line')
            page.goto(f'{BASE}/app/?mock#/', wait_until='load')
            page.goto(f'{BASE}/app/?mock#/credits', wait_until='load')
            page.wait_for_selector('.credit-balance', timeout=20000)
            check(page.locator('.credit-thanks').count() == 0, 'a later visit to Credits has none')
            check(not errors, f'no page errors {errors}')
            b.close()
    finally:
        srv.shutdown()
    print('RESULT:', 'PASS' if ok else 'FAIL')
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
