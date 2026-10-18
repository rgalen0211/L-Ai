"""#/admin/funnel in real Chrome, mock mode, desktop and phone: the by-day table, the 7/14/30-day buttons, a summary line, and no controls that change anything.
Writes screenshots. Not part of the node suite (it needs Chrome).

    python tools/check-funnel-days.py [outdir]        (default D:/Ryagram-scratch/WEB/funnel-days-shots)
"""
import http.server
import socketserver
import sys
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('D:/Ryagram-scratch/WEB/funnel-days-shots')
PORT = 8173
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
                p.on('console', lambda m: errors.append(m.text) if m.type == 'error' and 'status of 404' not in m.text and 'fake.supabase.co' not in m.text and 'media-src' not in m.text else None)
                p.goto(f'{BASE}/app/?mock', wait_until='load')
                p.wait_for_selector('#np-title', timeout=20000)
                check(p.locator('.admin-links a:has-text("Funnel by day")').count() == 1, 'the admin links include Funnel by day')
                p.evaluate("location.hash = '#/admin/funnel'")
                p.wait_for_selector('table.funnel-days', timeout=15000)
                text = p.inner_text('main')
                check('Funnel by day' in text and 'Signed up' in text and 'First preview' in text and 'First order' in text, 'the columns: signed up, first preview, first order')
                check(p.locator('table.funnel-days tbody tr').count() == 15, '14 days plus a Total row')
                check('Over these days:' in text and 'null' not in text.split(), 'a summary line, no stray "null"')
                check(p.locator('main button:visible').count() == 3, 'only the three range buttons (read-only)')
                p.get_by_role('button', name='7 days').click()
                p.wait_for_function("document.querySelectorAll('table.funnel-days tbody tr').length === 8", timeout=10000)
                check(True, '7 days shows 7 rows and a total')
                check(p.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), 'no sideways scroll')
                p.screenshot(path=str(OUT / f'funnel-days-{name}.png'), full_page=True)
                check(not errors, f'no console errors {errors[:2]}')
                ctx.close()
            b.close()
    finally:
        srv.shutdown()
    print('RESULT:', 'PASS' if ok else 'FAIL')
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
