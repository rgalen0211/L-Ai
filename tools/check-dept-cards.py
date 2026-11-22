"""The Departments row on Your projects: the cards in one row share ONE width and ONE height (RENDERER's dept-cards look delta, 11-20), real Chrome, mock mode, LOCAL server only (127.0.0.1).
Desktop 1280 px (several cards per row) and phone 390 px (one card per row): every card in a row has the same width and height (within 1 px), all columns are the same width, the row has no sideways scroll,
and every card is at least 120 px wide. Planted fault: the same page with the card list turned into a content-sized flex row (the grid rule replaced) must FAIL this check.   Needs Chrome.

    python tools/check-dept-cards.py [outdir]        (default D:/Ryagram-scratch/WEB/dept-cards-shots)
"""
import http.server
import socketserver
import sys
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('D:/Ryagram-scratch/WEB/dept-cards-shots')
GRID = '.dept-card-list{grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:16px}'
FAULT = '.dept-card-list{display:flex;flex-wrap:wrap;gap:16px}.dept-card{flex:0 0 auto}'
# the design sheet (assets/ryagram-ds.css, loaded after app-site.css) owns the same grid with higher specificity, so the fault is planted there too
DS_GRID = 'display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:var(--gutter)}'
DS_FAULT = 'display:flex;flex-wrap:wrap;gap:16px}body.ryagram-ds.ryagram-look .dept-card{flex:0 0 auto}'
CFG = (ROOT / 'assets/ryagram-config.js').read_text(encoding='utf-8')

MEASURE = """() => {
  const cs = [...document.querySelectorAll('.dept-card')].map(e => { const r = e.getBoundingClientRect(); return { t: Math.round(r.top + scrollY), w: r.width, h: r.height }; });
  const rows = {}; cs.forEach(c => { (rows[c.t] = rows[c.t] || []).push(c); });
  return { n: cs.length, rows: Object.values(rows), sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth };
}"""


def serve(plant):
    class H(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *a, **k):
            super().__init__(*a, directory=str(ROOT), **k)

        def log_message(self, *a):
            pass

        def do_GET(self):
            if plant and self.path.split('?')[0] == '/assets/app-site.css':
                css = (ROOT / 'assets/app-site.css').read_bytes().decode('utf-8')
                assert GRID in css, 'the card grid rule is not in assets/app-site.css'
                body = css.replace(GRID, FAULT).encode('utf-8')
                self.send_response(200)
                self.send_header('Content-Type', 'text/css; charset=utf-8')
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
            if plant and self.path.split('?')[0] == '/assets/ryagram-ds.css':
                css = (ROOT / 'assets/ryagram-ds.css').read_bytes().decode('utf-8')
                assert DS_GRID in css, 'the card grid rule is not in assets/ryagram-ds.css'
                body = css.replace(DS_GRID, DS_FAULT).encode('utf-8')
                self.send_response(200)
                self.send_header('Content-Type', 'text/css; charset=utf-8')
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
    base = f'http://127.0.0.1:{srv.server_address[1]}/app/?mock&aiconnected#/'
    bad = []
    b = pw.chromium.launch(channel='chrome')
    for name, opts, per_row in (('1280', dict(viewport={'width': 1280, 'height': 900}), 2), ('390', dict(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True), 1)):
        ctx = b.new_context(**opts)
        ctx.route('**/assets/ryagram-config.js*', lambda r, _q: r.fulfill(status=200, content_type='text/javascript', body=CFG))
        pg = ctx.new_page()
        pg.goto(base, wait_until='load')
        pg.wait_for_selector('.dept-card', timeout=20000)
        pg.wait_for_timeout(300)
        m = pg.evaluate(MEASURE)
        rows = m['rows']
        # The design's first Departments card is a wide hero row (ryagram-ds.css .dept-card:first-child, WEB rollout 11-22): on desktop a first row of ONE card above rows of several is that card; the equal-width rule applies to every other card.
        hero = len(rows) > 1 and len(rows[0]) == 1 and max(len(r) for r in rows[1:]) > 1
        if hero: rows = rows[1:]
        same_row = all(max(c['w'] for c in r) - min(c['w'] for c in r) <= 1 and max(c['h'] for c in r) - min(c['h'] for c in r) <= 1 for r in rows)
        widths = [c['w'] for r in rows for c in r]
        same_col = max(widths) - min(widths) <= 1
        wide = min(widths) >= 120
        many = max(len(r) for r in rows) >= per_row and (per_row == 1 or max(len(r) for r in rows) >= 2)
        calm = m['sw'] <= m['cw']
        good = m['n'] >= 6 and same_row and same_col and wide and many and calm
        if shots:
            el = pg.locator('.dept-cards')
            el.scroll_into_view_if_needed()
            el.screenshot(path=str(OUT / f'dept-cards-{name}.png'))
        print(('  ok   ' if good else '  FAIL ') + f"{'planted ' if plant else ''}{name} px: {m['n']} cards in rows of {[len(r) for r in rows]}, widths {min(widths):.0f}-{max(widths):.0f}, row heights {[round(max(c['h'] for c in r) - min(c['h'] for c in r), 1) for r in rows]} spread, scrollWidth {m['sw']} vs {m['cw']}")
        if not good:
            bad.append(name)
        ctx.close()
    b.close()
    srv.shutdown()
    return bad


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as pw:
        real = run(pw, False, True)
        planted = run(pw, True, False)
    ok = not real and bool(planted)
    print('  ok   the planted fault (flex row, content-sized cards) is caught at ' + str(planted) if planted else '  FAIL the planted fault was NOT caught')
    print('PASS' if ok else 'FAIL')
    sys.exit(0 if ok else 1)


main()
