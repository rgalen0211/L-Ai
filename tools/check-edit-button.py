"""The Edit button and the 'live editor isn't on for this account' page (WEB 11-17, Ryan's standing order item 2), real Chrome, mock mode, LOCAL server only (127.0.0.1).
Three configs, each a LOCAL copy of ryagram-config.js: liveEditor true (everyone: every project row and the top of the project page carry Edit, and it opens the editor), 'account' with an empty
switch list (the mock has none: the button still shows, and the editor address says plainly the editor is not on for this account and offers the way home, instead of the library),
and false (no Edit button anywhere, and the editor address also says it is not on). Needs Chrome.

    python tools/check-edit-button.py [outdir]        (default D:/Ryagram-scratch/WEB/edit-button-shots)
"""
import http.server
import re
import socketserver
import sys
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('D:/Ryagram-scratch/WEB/edit-button-shots')
PID = '00000000-0000-4000-8000-000000000001'


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
    cfg = (ROOT / 'assets/ryagram-config.js').read_text(encoding='utf-8')
    ok = True

    def check(cond, what):
        nonlocal ok
        print(('  ok   ' if cond else '  FAIL ') + what)
        ok = ok and bool(cond)

    with sync_playwright() as pw:
        b = pw.chromium.launch(channel='chrome')
        for value in ('true', "'account'", 'false'):
            print(f'liveEditor: {value}')
            body = re.sub(r"liveEditor:\s*(?:true|false|'account')", f'liveEditor: {value}', cfg)
            assert f'liveEditor: {value}' in body
            for name, opts in (('desktop', dict(viewport={'width': 1280, 'height': 900})), ('phone', dict(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True))):
                ctx = b.new_context(**opts)
                ctx.route('**/assets/ryagram-config.js*', (lambda b2: lambda r: r.fulfill(status=200, content_type='text/javascript', body=b2))(body))
                ctx.route('https://claude.ai/**', lambda r: r.abort())
                p = ctx.new_page()
                errs = []
                p.on('pageerror', lambda e: errs.append(str(e)))
                tag = f"{value.strip(chr(39))}-{name}"
                p.goto(f'{base}/app/?mock#/', wait_until='load')
                p.wait_for_selector('ul.film-grid a[href^="#/p/"]', timeout=20000)
                p.wait_for_timeout(400)
                rows = p.locator('ul.film-grid li').count()
                edits = p.locator('ul.film-grid li a[data-edit-project]').count()
                p.screenshot(path=str(OUT / f'{tag}-1-library.png'))
                shown = value != 'false'
                check(edits == (rows if shown else 0), f'{name}: Edit on every project row when shown ({edits} of {rows})')
                p.goto(f'{base}/app/?mock#/p/{PID}', wait_until='load')
                p.wait_for_selector('h1:visible:has-text("Obesity")', timeout=20000)
                top = p.locator('.actions-row a[data-edit-project]').count()
                check(top == (1 if shown else 0), f'{name}: Edit at the top of the project page ({top})')
                p.screenshot(path=str(OUT / f'{tag}-2-project.png'))
                if value == 'true':
                    p.click('.actions-row a[data-edit-project]')
                    p.wait_for_selector('img.le-svg', timeout=20000)
                    check('/editor/data/' in p.url, f'{name}: Edit opens the editor ({p.url.split("#")[1]})')
                    # GEO 11-17 points 2-4: the page does not move on the first edit, the card heading has no blank band, a phone's header does not stay over the page
                    m = "(() => { const r = s => document.querySelector(s).getBoundingClientRect(); return { titleH: Math.round(r('.le-top h1').height), below: Math.round(r('.le-view').top + window.scrollY), h2: Math.round(document.querySelector('.le-panel h2').getBoundingClientRect().top - r('.le-panel').top), pos: getComputedStyle(document.querySelector('body>header')).position, headH: Math.round(document.querySelector('body>header').getBoundingClientRect().height) } })()"
                    p.wait_for_selector('.le-pill:has-text("Saved")')
                    before = p.evaluate(m)
                    p.click('[data-preset="white-background"]')
                    p.wait_for_selector('.le-pill:has-text("Draft, not saved")')
                    after = p.evaluate(m)
                    check(before['titleH'] == after['titleH'] and before['below'] == after['below'], f'{name}: the first edit moves nothing ({before} -> {after})')
                    check(before['h2'] <= 16, f'{name}: no blank band above the Look heading ({before["h2"]}px)')
                    # the design system's header is ONE row and sticky on every screen (72 px); GEO's old rule (static on a phone) was about the former two-row header that hid the Undo row
                    check(before['pos'] == 'sticky' and before['headH'] <= 80, f'{name}: the header is {before["pos"]} and one row ({before["headH"]}px; sticky, one row on every screen)')
                    p.screenshot(path=str(OUT / f'{tag}-3-editor.png'))
                else:
                    if shown:
                        p.click('.actions-row a[data-edit-project]')
                    else:
                        p.goto(f'{base}/app/?mock#/editor/data/{PID}', wait_until='load')
                    p.wait_for_selector('h1:visible:has-text("isn’t on for this account")', timeout=20000)
                    check(p.locator('#editor-off-home').is_visible() and 'Your projects' not in p.inner_text('main h1'), f'{name}: the editor address says it is not on, with the way home, not the library')
                    p.screenshot(path=str(OUT / f'{tag}-3-not-on.png'))
                    p.click('#editor-off-home')
                    p.wait_for_selector('ul.film-grid')
                    check(p.url.endswith('#/'), f'{name}: the way home goes to the projects')
                check(not errs, f'{name}: no page errors {errs}')
                ctx.close()
        b.close()
    srv.shutdown()
    sys.exit(0 if ok else 1)


main()
