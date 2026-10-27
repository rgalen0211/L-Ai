"""The admin-only tester switch (#/admin/tester) in real Chrome, mock mode: an admin turns a tester on and off with a reason, every change appears in the history with old, new and why, a short reason is
said in words, a worker account is refused, and a non-admin does not get the page. Not part of the node suite (needs Chrome).

    python tools/check-tester-admin.py
"""
import http.server, socketserver, threading
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT = Path(__file__).resolve().parents[1]

class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=str(ROOT), **k)
    def log_message(self, *a): pass

socketserver.TCPServer.allow_reuse_address = True
srv = socketserver.ThreadingTCPServer(('127.0.0.1', 8188), H)
threading.Thread(target=srv.serve_forever, daemon=True).start()
ok = True
def check(c, w):
    global ok
    print(('  ok   ' if c else '  FAIL ') + w); ok = ok and bool(c)
try:
    with sync_playwright() as pw:
        b = pw.chromium.launch(channel='chrome')
        try:
            p = b.new_context(viewport={'width': 1100, 'height': 900}).new_page(); errs = []
            p.on('pageerror', lambda e: errs.append(str(e)))
            p.goto('http://127.0.0.1:8188/app/?mock#/admin/tester', wait_until='load')
            p.wait_for_selector('h1:has-text("Tester computers")', timeout=20000)
            check('Only an admin can change this' in p.inner_text('main'), 'admin sees the page')
            p.fill('#tester-email', 'sam@example.com'); p.fill('#tester-reason', 'ab')
            p.get_by_role('button', name='Turn on').click(); p.wait_for_timeout(300)
            check('Say why, in a few words.' in p.inner_text('main'), 'a short reason is said in words, nothing sent')
            p.fill('#tester-reason', 'Sam tests r9'); p.get_by_role('button', name='Turn on').click(); p.wait_for_timeout(800)
            t = p.inner_text('main')
            check('sam@example.com is now a tester' in t and 'off to on' in t and 'Why: Sam tests r9' in t, 'turning on shows the status and an audit row with old, new and why')
            p.fill('#tester-reason', 'Done testing'); p.get_by_role('button', name='Turn off').click(); p.wait_for_timeout(800)
            t = p.inner_text('main')
            check('on to off' in t and t.index('Done testing') < t.index('Sam tests r9'), 'turning off adds a row above the first (newest first)')
            p.fill('#tester-email', 'worker@example.com'); p.fill('#tester-reason', 'try'); p.get_by_role('button', name='Turn on').click(); p.wait_for_timeout(600)
            check('worker account is not a person' in p.inner_text('main'), 'a worker account is refused with the server sentence')
            check(not errs, 'no page errors')
            q = b.new_context(viewport={'width': 1100, 'height': 900}).new_page()
            q.goto('http://127.0.0.1:8188/app/?mock&nonadmin#/admin/tester', wait_until='load'); q.wait_for_timeout(3000)
            check('Tester computers' not in q.inner_text('main') and 'Turn on' not in q.inner_text('main'), 'a non-admin does not get the page')
        finally:
            b.close()
finally:
    srv.shutdown()
print('RESULT: ' + ('PASS' if ok else 'FAIL'))
