"""Connect-your-AI for invitees only, in real Chrome, mock mode: an INVITED account sees Account > Connected AIs and the consent page; a NOT-INVITED account (?noinvite) sees neither, and typing the
consent address by hand does not show the consent page. The committed config keeps connectAi false; the mock turns the feature on for itself. Not part of the node suite (needs Chrome).

    python tools/check-connect-gate.py
"""
import http.server
import socketserver
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
PORT = 8183
BASE = f'http://127.0.0.1:{PORT}'
GOOD = '00000000-0000-4000-8000-0000000000aa'


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
            try:
                for label, query, invited in (('invited', '?mock', True), ('not invited', '?mock&noinvite', False)):
                    print(label)
                    p = b.new_context(viewport={'width': 1280, 'height': 900}).new_page()
                    errors = []
                    p.on('pageerror', lambda e: errors.append(str(e)))
                    p.goto(f'{BASE}/app/{query}#/account', wait_until='load')
                    p.wait_for_selector('main h1:visible', timeout=20000)
                    p.wait_for_timeout(1500)
                    text = p.inner_text('main')
                    check(('Connected AIs' in text) == invited, f'Account page {"shows" if invited else "does not show"} Connected AIs')
                    p.goto(f'{BASE}/app/{query}#/connect/consent?request={GOOD}')
                    p.wait_for_timeout(1500)
                    text = p.inner_text('main')
                    shown = 'Where you will be sent' in text and 'Approve' in text
                    check(shown == invited, f'the consent address {"opens" if invited else "does NOT open"} the consent page')
                    if not invited:
                        check('Approve' not in text, 'no Approve button anywhere on the page')
                        check('Connecting an AI is by invitation for now.' in text, 'and it says why in one plain line, not a blank page')
                    check(not errors, 'no page errors')
                    p.context.close()
            finally:
                b.close()
    finally:
        srv.shutdown()
    print('RESULT: ' + ('PASS' if ok else 'FAIL'))
    raise SystemExit(0 if ok else 1)


if __name__ == '__main__':
    main()
