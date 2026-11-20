"""The Home page (index.html) header at 861 to 1199 px (BUILDER's public walk 11-20: at 1000-1100 px the padded nav links pushed 'Book 15 minutes' 18-57 px off the screen),
real Chrome, LOCAL server only (127.0.0.1). At 870, 1000, 1024 and 1080 px: scrollWidth equals the page width (no sideways scroll) and the header stays one row from 1000 px (from 861 to 999 px the nav links wrap onto extra rows by the page's own earlier rule, which this fix does not touch).
Planted fault: the same page with the 861-1199 px rule removed must FAIL this check (proves it can see the fault). Needs Chrome.

    python tools/check-home-header.py [outdir]        (default D:/Ryagram-scratch/WEB/home-header-shots)
"""
import http.server
import socketserver
import sys
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('D:/Ryagram-scratch/WEB/home-header-shots')
WIDTHS = (870, 1000, 1024, 1080)
RULE = '@media(min-width:861px) and (max-width:1199px){.nav{gap:16px}nav{column-gap:10px}}'

MEASURE = """() => {
  const h = document.querySelector('header');
  const items = [...h.querySelectorAll('nav a, .nav > .button, .brand')].filter(e => e.offsetParent !== null);
  const tops = items.map(e => Math.round(e.getBoundingClientRect().top + e.getBoundingClientRect().height / 2));
  const rows = new Set(); tops.sort((a, b) => a - b).forEach(t => { if (![...rows].some(r => Math.abs(r - t) < 12)) rows.add(t); });
  const right = Math.max(...items.map(e => e.getBoundingClientRect().right));
  return { sw: document.documentElement.scrollWidth, vw: window.innerWidth, rows: rows.size, right: Math.round(right), n: items.length };
}"""


def serve(plant):
    class H(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *a, **k):
            super().__init__(*a, directory=str(ROOT), **k)

        def log_message(self, *a):
            pass

        def do_GET(self):
            if plant and self.path.split('?')[0] in ('/', '/index.html'):
                html = (ROOT / 'index.html').read_bytes().decode('utf-8')
                assert RULE in html, 'the 861-1199 px rule is not in index.html'
                body = html.replace(RULE, '').encode('utf-8')
                self.send_response(200)
                self.send_header('Content-Type', 'text/html; charset=utf-8')
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
            super().do_GET()

        def end_headers(self):
            self.send_header('Cache-Control', 'no-store')
            super().end_headers()
    srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


def run(pw, plant, shots):
    srv = serve(plant)
    base = f'http://127.0.0.1:{srv.server_address[1]}/'
    bad = []
    b = pw.chromium.launch(channel='chrome')
    for w in WIDTHS:
        pg = b.new_page(viewport={'width': w, 'height': 800})
        pg.goto(base)
        pg.wait_for_timeout(300)
        m = pg.evaluate(MEASURE)
        if shots:
            pg.screenshot(path=str(OUT / f'home-header-{w}.png'), clip={'x': 0, 'y': 0, 'width': w, 'height': 200})
        good = m['sw'] == m['vw'] and (m['rows'] == 1 or w < 1000) and m['n'] >= 4  # below 1000 px the nav wraps by design (max-width:999px rule), so one row is required from 1000 px
        print(('  ok   ' if good else '  FAIL ') + f"{'planted ' if plant else ''}{w} px: scrollWidth {m['sw']} vs width {m['vw']}, header rows {m['rows']}, rightmost item {m['right']}, items {m['n']}")
        if not good:
            bad.append(w)
        pg.close()
    b.close()
    srv.shutdown()
    return bad


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as pw:
        real = run(pw, False, True)
        planted = run(pw, True, False)
    ok = not real and bool(planted)
    print('  ok   the planted fault (rule removed) is caught at ' + str(planted) if planted else '  FAIL the planted fault was NOT caught')
    print('PASS' if ok else 'FAIL')
    sys.exit(0 if ok else 1)


main()
