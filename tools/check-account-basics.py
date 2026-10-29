"""The account page in real Chrome, mock mode, desktop and phone: change email (bad address refused, good one says a link was sent), Download my data (a real file download whose
JSON says what it leaves out), and the Help line after Delete. Writes screenshots. Not part of the node suite (it needs Chrome).

    python tools/check-account-basics.py [outdir]        (default D:/Ryagram-scratch/WEB/account-shots)
"""
import http.server
import json
import socketserver
import sys
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('D:/Ryagram-scratch/WEB/account-shots')
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
            for name, opts in (('desktop', dict(viewport={'width': 1280, 'height': 900}, accept_downloads=True)),
                               ('phone', dict(viewport={'width': 390, 'height': 844}, device_scale_factor=3, is_mobile=True, has_touch=True, accept_downloads=True))):
                print(name)
                ctx = b.new_context(**opts)
                p = ctx.new_page()
                errors = []
                p.on('pageerror', lambda e: errors.append(str(e)))
                p.on('console', lambda m: errors.append(m.text) if m.type == 'error' and 'status of 404' not in m.text else None)
                p.goto(f'{BASE}/app/?mock#/account', wait_until='load')
                p.wait_for_selector('#acct-new-email', timeout=20000)
                text = p.inner_text('#library')
                check('null' not in text.split(), 'no stray "null" text')
                check(text.index('Password') < text.index('Email address') < text.index('Download your data') < text.index('Delete your account') < text.index('Help'), 'order: Password, Email, Download, Delete, Help')
                p.fill('#acct-new-email', 'nope')
                p.click('text=Send a confirmation link')
                p.wait_for_selector('#library p.app-error:not([hidden])')
                check('doesn’t look like an email' in p.inner_text('#library'), 'a bad address is refused in words')
                p.fill('#acct-new-email', 'new@example.com')
                p.click('text=Send a confirmation link')
                p.wait_for_selector('text=We sent a link to new@example.com')
                check(p.input_value('#acct-new-email') == '', 'the field is cleared after sending')
                with p.expect_download() as dl:
                    p.click('text=Download my account file')
                d = dl.value
                path = OUT / f'{name}-{d.suggested_filename}'
                d.save_as(path)
                f = json.loads(path.read_text(encoding='utf-8'))
                check(d.suggested_filename.startswith('ryagram-my-data-') and d.suggested_filename.endswith('.json'), f'downloaded {d.suggested_filename}')
                check(f['account']['email'] == 'mock@localhost' and 'projects' in f and 'not_in_this_file' in f, 'the file has the account, the parts and the gaps')
                p.wait_for_selector('text=was made on this device')
                check(p.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), 'no sideways scroll')
                p.screenshot(path=str(OUT / f'{name}-account.png'), full_page=True)
                check(not errors, f'no console errors {errors[:2]}')
                ctx.close()
            b.close()
    finally:
        srv.shutdown()
    print('PASS' if ok else 'FAIL')
    sys.exit(0 if ok else 1)


main()
