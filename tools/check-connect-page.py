"""/connect-ai/ in real Chrome at desktop and phone: the draft banner, the headings, no sideways scroll, placeholder addresses wrap, no console errors. Writes screenshots.
Not part of the node suite.   python tools/check-connect-page.py [outdir]   (default D:/Ryagram-scratch/WEB/connect-page-shots)
"""
import http.server
import socketserver
import sys
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('D:/Ryagram-scratch/WEB/connect-page-shots')
PORT = 8177


class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=str(ROOT), **k)

    def log_message(self, *a):
        pass


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    socketserver.TCPServer.allow_reuse_address = True
    srv = socketserver.ThreadingTCPServer(('127.0.0.1', PORT), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
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
                p = b.new_context(**opts).new_page()
                errors = []
                p.on('pageerror', lambda e: errors.append(str(e)))
                p.on('console', lambda m: errors.append(m.text) if m.type == 'error' and 'status of 404' not in m.text else None)
                p.goto(f'http://127.0.0.1:{PORT}/connect-ai/', wait_until='load')
                check('Pending' not in p.inner_text('.shell-banner') and 'DRAFT' in p.inner_text('.shell-banner'), 'the draft banner')
                check(p.locator('h2').count() == 7, 'seven sections')
                check('only on plans that allow custom MCP connectors' in p.inner_text('main'), 'the ChatGPT plan sentence')
                check(p.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), 'no sideways scroll (long placeholder addresses wrap)')
                p.screenshot(path=str(OUT / f'connect-ai-{name}.png'), full_page=True)
                check(not errors, f'no console errors {errors[:2]}')
            b.close()
    finally:
        srv.shutdown()
    print('RESULT:', 'PASS' if ok else 'FAIL')
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
