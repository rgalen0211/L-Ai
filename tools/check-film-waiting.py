"""A queued film on a computer account says plainly that it waits for a computer when none is signed in, and keeps the ordinary line when one is, or on an ordinary account.
Real Chrome against the mock (paused worker keeps the film queued). Not part of the node suite.

    python tools/check-film-waiting.py
"""
import http.server, socketserver, sys, threading
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
PORT = 8168
BASE = f'http://127.0.0.1:{PORT}'
WAIT = 'Waiting for your computer.'


def serve():
    class H(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *a, **k):
            super().__init__(*a, directory=str(ROOT), **k)

        def log_message(self, *a):
            pass
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
            for name, query, expect in (('tester, no computer signed in', 'mock&empty&tester', True), ('ordinary account', 'mock&empty', False)):
                print(name)
                p = b.new_context(viewport={'width': 1280, 'height': 900}).new_page()
                errors = []
                p.on('pageerror', lambda e: errors.append(str(e)))
                p.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
                p.goto(f'{BASE}/app/?{query}#/', wait_until='load')
                p.wait_for_selector('h1:has-text("Your projects")', timeout=20000)
                p.click('button:has-text("Pause worker")')
                p.click('#first-film')
                p.click('.builder-start[data-start="housing"]')
                p.wait_for_selector('.builder-summary', timeout=15000)
                p.click('button:has-text("Make the film and a free contact sheet")')
                p.wait_for_selector('h1:has-text("Version 1")', timeout=20000)
                p.wait_for_selector('.job-row-queued', timeout=20000)
                p.wait_for_timeout(1500)
                text = p.inner_text('.job-row-queued')
                check((WAIT in text) is expect, f'the queued film {"says" if expect else "does not say"} it is waiting for a computer ({text[:120]!r})')
                if expect:
                    check('open the ryagram app on your computer and sign in' in text.lower(), 'and says what to do')
                    check('minutes' not in text and 'soon' not in text.lower(), 'and promises no time')
                check(not errors, f'no console errors {errors[:2]}')
            b.close()
    finally:
        srv.shutdown()
    print('ALL OK' if ok else 'FAILED')
    sys.exit(0 if ok else 1)


main()
