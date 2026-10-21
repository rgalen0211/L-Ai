"""The live preview (/preview-demo/) on phone-sized screens in real Chrome, LOCAL server only: at 428, 414, 393, 390, 375 and 360 px, drag the slider to the end and check that the end card ("Made with Ryagram",
the line, Watch again and Make your own data film) sits wholly inside its box, and that the theme choices are at least 22 px with a 44 px row. Every request to another host is aborted. Not part of the node suite
(needs Chrome). Found by FACES (NEXT-FACES 71, 16:53): at every width the call-to-action was cut off at the bottom and at 390 px the heading at the top.

    python tools/check-preview-phone.py
"""
import http.server
import socketserver
import sys
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
WIDTHS = (428, 414, 393, 390, 375, 360)


class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=str(ROOT), **k)

    def log_message(self, *a):
        pass


def main():
    socketserver.TCPServer.allow_reuse_address = True
    srv = socketserver.ThreadingTCPServer(('127.0.0.1', 8192), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    ok = True

    def check(c, w):
        nonlocal ok
        print(('  ok   ' if c else '  FAIL ') + w)
        ok = ok and bool(c)
    try:
        with sync_playwright() as pw:
            b = pw.chromium.launch(channel='chrome')
            try:
                for w in WIDTHS:
                    ctx = b.new_context(viewport={'width': w, 'height': 900}, device_scale_factor=2, is_mobile=True, has_touch=True)
                    ctx.route('**/*', lambda r: r.continue_() if r.request.url.startswith('http://127.0.0.1') else r.abort())
                    p = ctx.new_page()
                    errs = []
                    p.on('pageerror', lambda e: errs.append(str(e)))
                    p.goto('http://127.0.0.1:8192/preview-demo/', wait_until='load')
                    p.wait_for_selector('input[type=range]', timeout=20000)
                    p.wait_for_timeout(5000)
                    p.locator('input[type=range]').first.evaluate("el => { el.value = el.max; el.dispatchEvent(new Event('input', {bubbles:true})); el.dispatchEvent(new Event('change', {bubbles:true})); }")
                    p.wait_for_timeout(2000)
                    info = p.evaluate("""() => { const c = document.querySelector('.pv-endcard'); const cb = c.getBoundingClientRect();
                        const kids = [...c.children].map(k => { const r = k.getBoundingClientRect(); return Math.min(r.top - cb.top, cb.bottom - r.bottom, r.left - cb.left, cb.right - r.right); });
                        const radio = document.querySelector('#demo-theme-dark').getBoundingClientRect(); const row = document.querySelector('.pv-theme .choice').getBoundingClientRect();
                        return { inside: Math.min(...kids), radio: Math.min(radio.width, radio.height), row: row.height, wide: document.documentElement.scrollWidth - document.documentElement.clientWidth }; }""")
                    check(info['inside'] >= 0, f'{w} px: the end card content is wholly inside its box (least margin {info["inside"]:.0f} px)')
                    check(info['radio'] >= 22 and info['row'] >= 44, f'{w} px: the theme choices are {info["radio"]:.0f} px with a {info["row"]:.0f} px row')
                    check(info['wide'] <= 0 and not errs, f'{w} px: no sideways scroll, no page errors')
                    ctx.close()
            finally:
                b.close()
    finally:
        srv.shutdown()
    print('RESULT: ' + ('PASS' if ok else 'FAIL'))
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
