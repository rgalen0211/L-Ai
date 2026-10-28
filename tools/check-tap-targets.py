"""The AI-first 'Connect your AI to start films by talking' bar on the library (King's Island walk W6): the WHOLE bar is the tap target (at least 44 px tall), desktop and phone, no sideways scroll.
Real Chrome, mock mode.   python tools/check-tap-targets.py"""
import http.server, socketserver, threading, sys
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
PORT = 8297


class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=str(ROOT), **k)
    def log_message(self, *a): pass


socketserver.TCPServer.allow_reuse_address = True
srv = socketserver.ThreadingTCPServer(('127.0.0.1', PORT), H)
threading.Thread(target=srv.serve_forever, daemon=True).start()
ok = True


def check(c, w):
    global ok
    print(('  ok   ' if c else '  FAIL ') + w); ok = ok and bool(c)


with sync_playwright() as pw:
    b = pw.chromium.launch(channel='chrome')
    for name, opts in (('desktop', dict(viewport={'width': 1280, 'height': 900})), ('phone', dict(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True))):
        print(name)
        p = b.new_context(**opts).new_page()
        p.goto(f'http://127.0.0.1:{PORT}/app/?mock', wait_until='load'); p.wait_for_selector('.start-bar a', timeout=15000)
        box = p.locator('.start-bar a').bounding_box(); bar = p.locator('.start-bar').bounding_box()
        check(box['height'] >= 44, f'the link is at least 44 px tall ({box["height"]:.0f})')
        check(abs(box['width'] - (bar['width'] - 2)) < 3, f'and fills the bar ({box["width"]:.0f} of {bar["width"]:.0f})')
        p.locator('.start-bar a').click(position={'x': 5, 'y': 4}); p.wait_for_timeout(600)
        check(p.evaluate('location.hash') == '#/start', 'a tap at the very edge of the bar opens the door')
        check(p.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth'), 'no sideways scroll')
    b.close()
srv.shutdown()
print('ALL OK' if ok else 'FAILED'); sys.exit(0 if ok else 1)
