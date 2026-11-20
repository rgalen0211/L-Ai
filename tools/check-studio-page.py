"""The Studio 'Coming soon' page (WEB 11-18, Ryan Q639) in real Chrome, mock mode, LOCAL server only (127.0.0.1), desktop and phone, dark and light: Studio is in the Coming soon list (after Animation Studio),
its page shows the tag, the heading, the approved line, 'What is coming' and 'Not built yet', and the 'Tell me when it's ready' button records interest and can be taken back; nothing scrolls sideways;
no page errors. Writes screenshots. Needs Chrome.

    python tools/check-studio-page.py [outdir]        (default D:/Ryagram-scratch/WEB/studio-shots)
"""
import http.server
import socketserver
import sys
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('D:/Ryagram-scratch/WEB/studio-shots')
LINE = 'Your podcast’s camera crew and editor in one: Ryagram works with your cameras, cuts to the right camera as people talk, and finds the moments worth sharing.'


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
        for name, opts in (('desktop', dict(viewport={'width': 1280, 'height': 900})), ('phone', dict(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True))):
            for scheme in ('dark', 'light'):
                tag = f'{name} {scheme}'
                ctx = b.new_context(color_scheme=scheme, **opts)
                p = ctx.new_page()
                errs = []
                p.on('pageerror', lambda e: errs.append(str(e)))
                p.goto(f'{base}/app/?mock&aiconnected#/', wait_until='load')
                p.wait_for_selector('.dept-bar', timeout=20000)
                if p.locator('.dept-menu').is_visible():
                    p.locator('.dept-menu').click()
                elif p.locator('.soon-group summary').count():
                    p.locator('.soon-group summary').click()
                items = p.locator('.soon-group ul li').all_inner_texts()
                names = [i.split(chr(10))[0] for i in items]
                server = [x for x in names if not x.startswith('Forecasts')]                  # Forecasts is a site-owned page (Ryan 11-20): it sits after the server's five
                check(len(server) == 5 and server[-1].startswith('Studio') and any(x.startswith('Forecasts') for x in names), f'{tag}: Studio is the last of the five announced Coming soon departments, and the site-owned Forecasts is listed too ({names})')
                p.locator('.soon-group ul a', has_text='Studio').last.click()
                p.wait_for_selector('h1:has-text("Studio")', timeout=15000)
                main = p.inner_text('main')
                check('coming soon' in main.lower() and LINE in main, f'{tag}: the tag, the heading and the approved line')
                check('What is coming' in main and 'Not built yet' in main and 'multi-camera setup' in main and 'Shorts' in main and 'no price and no date' in main, f'{tag}: the fuller words, with no price and no date')
                check(p.get_by_role('button', name='Tell me when it’s ready').count() == 1, f'{tag}: the Tell me button')
                p.screenshot(path=str(OUT / f'studio-{name}-{scheme}.png'), full_page=True)
                p.get_by_role('button', name='Tell me when it’s ready').click()
                p.wait_for_selector('#soon-noted', timeout=10000)
                check(p.evaluate("window.ryagramMock.client.db.deptInterest.includes('studio')"), f'{tag}: interest recorded (one row, nothing sent)')
                p.click('#soon-takeback')
                p.wait_for_selector('button:has-text("Tell me when it’s ready")', timeout=10000)
                check(not p.evaluate("window.ryagramMock.client.db.deptInterest.includes('studio')"), f'{tag}: Take it back removes it')
                check(p.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), f'{tag}: nothing scrolls sideways')
                check(not errs, f'{tag}: no page errors {errs[:1]}')
                ctx.close()
        b.close()
    srv.shutdown()
    print('ALL OK' if ok else 'SOME FAILED')
    sys.exit(0 if ok else 1)


main()
