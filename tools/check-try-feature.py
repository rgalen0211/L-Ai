"""tools/try-feature.mjs in real Chrome: with `node tools/try-feature.mjs myFilms` running (its own port, this PC), /app/?mock#/films shows the My films page; with no switch (a plain server of the same folder, config untouched) the same address does not. Needs Chrome and node.   python tools/check-try-feature.py"""
import re, subprocess, sys, http.server, socketserver, threading
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT = Path(__file__).resolve().parents[1]
ok = True
def check(c, w):
    global ok
    print(('  ok   ' if c else '  FAIL ') + w); ok = ok and bool(c)

class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=str(ROOT), **k)
    def log_message(self, *a): pass
    def end_headers(self): self.send_header('Cache-Control', 'no-store'); super().end_headers()
plain = socketserver.ThreadingTCPServer(('127.0.0.1', 0), H); threading.Thread(target=plain.serve_forever, daemon=True).start()
proc = subprocess.Popen(['node', str(ROOT / 'tools/try-feature.mjs'), 'myFilms'], stdout=subprocess.PIPE, text=True, cwd=ROOT)
try:
    url = None
    for line in proc.stdout:
        m = re.search(r'(http://127\.0\.0\.1:\d+)/app/\?mock', line)
        if m: url = m.group(1); break
    check(url, 'the launcher printed an address on this PC')
    with sync_playwright() as pw:
        b = pw.chromium.launch(channel='chrome')
        def text(base):
            ctx = b.new_context(viewport={'width': 1100, 'height': 900}); ctx.route(re.compile(r'https://fonts\..*'), lambda r, _q: r.abort())
            p = ctx.new_page(); errs = []; p.on('pageerror', lambda e: errs.append(str(e)))
            p.goto(base + '/app/?mock#/films'); p.wait_for_timeout(2500)
            t = p.inner_text('body'); ctx.close(); return t, errs
        on, e1 = text(url); off, e2 = text(f'http://127.0.0.1:{plain.server_address[1]}')
        check(on != off, 'with the switch the page differs from without it (My films appears)')
        check('film' in on.lower(), 'the launched page shows films')
        check(not e1, f'no page errors {e1[:1]}')
        b.close()
finally:
    proc.terminate(); plain.shutdown()
print('ALL OK' if ok else 'FAILED'); raise SystemExit(0 if ok else 1)
