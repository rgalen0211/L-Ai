"""The top bar at in-between widths (WEB 11-17, WORKER's Q636 dry run: at about 790 px the header cut off Help and Account and ran four rows tall over the page title), real Chrome, mock mode
(the mock account is an admin, so the bar carries the Admin menu AND the departments), LOCAL server only (127.0.0.1). At 700 to 1100 px: the bar stays one or two short rows, nothing in it is
clipped (Help and Account are whole words), no two items overlap, the page title starts below the bar, nothing scrolls sideways. Needs Chrome.

    python tools/check-header-widths.py [outdir]        (default D:/Ryagram-scratch/WEB/header-width-shots)
"""
import http.server
import socketserver
import sys
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('D:/Ryagram-scratch/WEB/header-width-shots')
WIDTHS = (701, 760, 790, 820, 900, 1000, 1100)

MEASURE = """() => {
  const vis = e => e.offsetParent !== null && getComputedStyle(e).visibility !== 'hidden';
  const box = e => { const b = e.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom }; };
  const header = document.querySelector('header');
  const sel = '.nav > a, .nav .app-nav-link, .nav .dept-list > li > a, .nav .dept-list > li > details > summary, .nav .admin-menu > summary, .nav #sign-out, .nav .dept-menu';
  const items = [...header.querySelectorAll(sel)].filter(vis).map(e => ({ text: e.textContent.trim().slice(0, 20), clipped: e.scrollWidth > e.clientWidth + 1, ...box(e) }));
  const links = ['Help', 'Account'].map(w => { const a = [...header.querySelectorAll('.app-account .app-nav-link')].find(x => x.textContent.trim() === w); return a && vis(a) ? { w, clipped: a.scrollWidth > a.clientWidth + 1, width: a.getBoundingClientRect().width } : { w, hidden: true }; });
  const h1 = [...document.querySelectorAll('main h1')].find(vis);
  return { header: box(header), items, links, h1top: h1 ? box(h1).t : null, sw: document.documentElement.scrollWidth, vw: window.innerWidth };
}"""


def overlap(a, b):
    return min(a['r'], b['r']) - max(a['l'], b['l']) > 2 and min(a['b'], b['b']) - max(a['t'], b['t']) > 2


def main():
    OUT.mkdir(parents=True, exist_ok=True)

    class H(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *a, **k):
            super().__init__(*a, directory=str(ROOT), **k)

        def log_message(self, *a):
            pass

        def end_headers(self):
            self.send_header('Cache-Control', 'no-store')
            super().end_headers()
    srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), H)
    base = f'http://127.0.0.1:{srv.server_address[1]}'
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    ok = True

    def check(cond, what):
        nonlocal ok
        print(('  ok   ' if cond else '  FAIL ') + what)
        ok = ok and bool(cond)

    with sync_playwright() as pw:
        b = pw.chromium.launch(channel='chrome')
        for scheme in ('dark', 'light'):
            for w in WIDTHS:
                ctx = b.new_context(viewport={'width': w, 'height': 700}, color_scheme=scheme)
                p = ctx.new_page()
                errs = []
                p.on('pageerror', lambda e: errs.append(str(e)))
                p.goto(f'{base}/app/?mock#/', wait_until='load')
                p.wait_for_selector('h1:visible', timeout=15000)
                p.wait_for_timeout(600)
                m = p.evaluate(MEASURE)
                p.screenshot(path=str(OUT / f'{scheme}-{w}.png'))
                tag = f'{scheme} {w}px'
                hh = m['header']['b'] - m['header']['t']
                check(hh <= 130, f'{tag}: the bar is at most two short rows ({hh:.0f}px tall)')
                bad = [x['text'] for x in m['items'] if x['clipped']]
                check(not bad, f'{tag}: nothing in the bar is clipped {bad}')
                check(all(not l.get('clipped') for l in m['links']), f'{tag}: Help and Account are whole words {m["links"]}')
                clash = [(a['text'], c['text']) for i, a in enumerate(m['items']) for c in m['items'][i + 1:] if overlap(a, c)]
                check(not clash, f'{tag}: no two items overlap {clash[:3]}')
                check(m['h1top'] is None or m['h1top'] >= m['header']['b'] - 1, f'{tag}: the page title starts below the bar')
                check(m['sw'] <= m['vw'], f'{tag}: nothing scrolls sideways')
                check(not errs, f'{tag}: no page errors {errs[:1]}')
                ctx.close()
        b.close()
    srv.shutdown()
    print('ALL OK' if ok else 'SOME FAILED')
    sys.exit(0 if ok else 1)


main()
