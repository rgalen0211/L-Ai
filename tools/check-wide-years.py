"""'These columns are years' (Q6) in real Chrome, mock mode, desktop and phone: a wide file uploaded as a new person is read (the mock melts it like the worker will), the mapping card says
'This file has one column for each year', refuses 'These are right' until the box is ticked, then (with the source fields) confirms and the file is Ready. Writes screenshots.
    python tools/check-wide-years.py [outdir]   (default D:/Ryagram-scratch/WEB/audit-shots/wide)   Needs D:/Ryagram-scratch/WEB/byod/wide.csv
"""
import http.server
import socketserver
import sys
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('D:/Ryagram-scratch/WEB/audit-shots/wide')
WIDE = Path('D:/Ryagram-scratch/WEB/byod/wide.csv')
PORT = 8193


class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=str(ROOT), **k)

    def log_message(self, *a):
        pass

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()


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
            for name, opts in (('desktop', dict(viewport={'width': 1280, 'height': 900})), ('phone', dict(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True))):
                print(name)
                p = b.new_context(**opts).new_page()
                errs = []
                p.on('pageerror', lambda e: errs.append(str(e)))
                p.on('dialog', lambda d: d.accept())
                p.goto(f'http://127.0.0.1:{PORT}/app/?mock', wait_until='load')
                p.wait_for_selector('#np-title', timeout=20000)
                p.fill('#np-title', 'Wide rents')
                p.click('button:has-text("Create")')
                p.wait_for_selector('.uploads-panel', state='attached', timeout=20000)
                p.locator('.byod-pointer button').click()
                p.locator('#upload-file').set_input_files(str(WIDE))
                p.check('#upload-rights')
                p.get_by_role('button', name='Upload').click()
                p.wait_for_selector('.mapping-form', timeout=20000)
                text = p.inner_text('.mapping-form')
                check('This file has one column for each year' in text and 'These columns are years' in text, 'the card says the file has one column for each year and offers the tick')
                check(p.locator('#wide-tick').count() == 1 and not p.is_checked('#wide-tick'), 'the box starts unticked')
                check('Value' in text and 'period' in text, 'the columns shown are the long ones (place, period, value)')
                p.get_by_role('button', name='These are right').click()
                p.wait_for_selector('.mapping-form .app-error:not([hidden])')
                check('Tick \u201cThese columns are years\u201d' in p.inner_text('.mapping-form') or 'These columns are years' in p.inner_text('.mapping-form .app-error'), 'unticked is refused in words')
                p.screenshot(path=str(OUT / f'{name}-refused.png'), full_page=True)
                p.check('#wide-tick')
                p.fill('#prov-publisher', 'Census Bureau')
                p.locator('select[aria-label="What lets you use it"]').select_option('public_domain')
                p.fill('#prov-unit', 'dollars')
                p.check('#prov-attest')
                p.get_by_role('button', name='These are right').click()
                p.wait_for_selector('.upload-card button:has-text("Use in this film")', timeout=15000)
                check(True, 'ticked and complete: the file becomes Ready')
                m = p.evaluate("JSON.stringify(window.ryagramMock.client.db.datasets.at(-1).mapping)")
                check('"melt_wide":true' in m and '"wide_prefix":""' in m, f'the mapping sent carries melt_wide and wide_prefix ({m[:120]})')
                check(p.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), 'no sideways scroll')
                p.screenshot(path=str(OUT / f'{name}-ready.png'), full_page=True)
                check(not errs, f'no page errors {errs[:2]}')
            b.close()
    finally:
        srv.shutdown()
    print('RESULT:', 'PASS' if ok else 'FAIL')
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
