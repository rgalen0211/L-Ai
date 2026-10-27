"""Real Chrome: on every page where the L'Ai wordmark sits beside the word Ryagram, the two share ONE baseline (Ryagram bottom-aligned with the wordmark, not
vertically centred), at desktop and phone width. Writes a header screenshot per page. Not part of the node suite (it needs Chrome).

    python tools/check-brand-baseline.py [outdir]        (default D:/Ryagram-scratch/WEB/brand-shots)
"""
import http.server
import socketserver
import sys
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('D:/Ryagram-scratch/WEB/brand-shots')
PORT = 8166
BASE = f'http://127.0.0.1:{PORT}'
# (page, the link that holds both words, the wordmark, the word Ryagram)
PAGES = [('/ryagram/', '.rg-brand', '.rg-wordmark', '.rg-brand-sub'), ('/app/?mock', '.brand', '.wordmark', '.brand-copy'),
         ('/film/', '.brand', '.wordmark', '.brand-copy'), ('/help/', '.brand', '.wordmark', '.brand-copy'),
         ('/report/', '.brand', '.wordmark', '.brand-copy'), ('/preview-demo/', '.brand', '.wordmark', '.brand-copy')]
# the baseline of an element's first line: a zero-size inline-block placed at the end of its text sits exactly on that baseline
BASELINE = """(el) => { const m = document.createElement('span'); m.style.cssText = 'display:inline-block;width:0;height:0;overflow:hidden';
  el.appendChild(m); const y = m.getBoundingClientRect().bottom; m.remove(); return y; }"""


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
    try:
        with sync_playwright() as pw:
            b = pw.chromium.launch(channel='chrome')
            for name, opts in (('desktop', dict(viewport={'width': 1280, 'height': 800})),
                               ('phone', dict(viewport={'width': 390, 'height': 844}, device_scale_factor=3, is_mobile=True, has_touch=True))):
                print(name)
                ctx = b.new_context(**opts)
                for path, link, mark, word in PAGES:
                    page = ctx.new_page()
                    page.goto(BASE + path, wait_until='load')
                    page.wait_for_timeout(400)
                    if page.locator(f'{link} {word}').count() == 0:
                        print(f'  FAIL {path}: no {link} {word}')
                        ok = False
                        page.close()
                        continue
                    page.evaluate("document.fonts && document.fonts.ready")
                    a = page.locator(f'{link} {mark}').first.evaluate(BASELINE)
                    c = page.locator(f'{link} {word}').first.evaluate(BASELINE)
                    same = abs(a - c) < 1.0
                    print(('  ok   ' if same else '  FAIL ') + f'{path}: wordmark baseline {a:.1f}, Ryagram baseline {c:.1f}')
                    ok = ok and same
                    page.locator('header').first.screenshot(path=str(OUT / f'brand-{name}-{path.strip("/").split("?")[0].replace("/", "-")}.png'))
                    page.close()
                ctx.close()
            b.close()
    finally:
        srv.shutdown()
    print('RESULT:', 'PASS' if ok else 'FAIL')
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
