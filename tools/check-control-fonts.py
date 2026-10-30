"""Every control takes the page's own font stack (King's Island W7), measured, not guessed: the computed font-family of a button, an input and a select equals the page's body font
in real Chrome, mock mode, desktop and phone. Needs Chrome.   python tools/check-control-fonts.py"""
import http.server, socketserver, threading, sys
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
PORT = 8300


class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=str(ROOT), **k)
    def log_message(self, *a): pass


socketserver.TCPServer.allow_reuse_address = True
srv = socketserver.ThreadingTCPServer(('127.0.0.1', PORT), H)
threading.Thread(target=srv.serve_forever, daemon=True).start()
ok = True
with sync_playwright() as pw:
    b = pw.chromium.launch(channel='chrome')
    for name, opts in (('desktop', dict(viewport={'width': 1280, 'height': 900})), ('phone', dict(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True))):
        p = b.new_context(**opts).new_page()
        p.goto(f'http://127.0.0.1:{PORT}/app/?mock#/account', wait_until='load'); p.wait_for_selector('#acct-ais')
        r = p.evaluate("""() => { const f = sel => { const e = document.querySelector(sel); return e ? getComputedStyle(e).fontFamily : null; };
          return { body: f('body'), button: f('button.button'), input: f('input'), select: f('select') }; }""")
        for k in ('button', 'input', 'select'):
            good = r[k] == r['body']
            ok = ok and good
            print(('  ok   ' if good else '  FAIL ') + f'{name}: {k} font = the page font ({r[k]!r} vs {r["body"]!r})')
    b.close()
srv.shutdown()
print('ALL OK' if ok else 'FAILED'); sys.exit(0 if ok else 1)
