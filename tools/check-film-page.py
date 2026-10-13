"""Opens the SAMPLE public film page (the Interstate film) in real Chrome at desktop and phone width, checks what it must show and must not, and writes
screenshots. Not part of the node suite (it needs Chrome).

    python tools/check-film-page.py [outdir]        (default D:/Ryagram-scratch/WEB/film-shots)
"""
import http.server
import socketserver
import sys
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('D:/Ryagram-scratch/WEB/film-shots')
PORT = 8164
BASE = f'http://127.0.0.1:{PORT}'
LIVE = (ROOT / 'film' / 'samples' / 'interstate.json').exists()   # false while the sample is offline


def serve():
    class H(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *a, **k):
            super().__init__(*a, directory=str(ROOT), **k)

        def log_message(self, *a):
            pass
    socketserver.TCPServer.allow_reuse_address = True
    srv = socketserver.ThreadingTCPServer(('127.0.0.1', PORT), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    srv = serve()
    ok = True

    def check(cond, what):
        nonlocal ok
        print(('  ok   ' if cond else '  FAIL ') + what)
        ok = ok and bool(cond)
    try:
        with sync_playwright() as pw:
            b = pw.chromium.launch(channel='chrome')
            for name, opts in (('desktop', dict(viewport={'width': 1280, 'height': 900})),
                               ('phone', dict(viewport={'width': 390, 'height': 844}, device_scale_factor=3, is_mobile=True, has_touch=True))):
                print(name)
                ctx = b.new_context(**opts)
                page = ctx.new_page()
                errors = []
                page.on('response', lambda r: errors.append(f'{r.status} {r.url}') if r.status >= 400 and not r.url.endswith('/favicon.ico') else None)   # (a missing favicon is not the page's)
                page.on('pageerror', lambda e: errors.append(str(e)))
                if not LIVE:   # the Interstate sample is taken offline until the final Roads film lands (tests/fixtures/film-samples/)
                    page.goto(f'{BASE}/film/?sample=interstate', wait_until='load')
                    page.wait_for_timeout(1500)
                    check('No film here' in page.inner_text('main'), 'the Interstate sample is offline: it says "No film here"')
                    check(page.locator('.film-poster').count() == 0 and page.locator('video').count() == 0, 'and shows no film or poster')
                    p2 = ctx.new_page()
                    p2.goto(f'{BASE}/film/?sample=interstate#sources', wait_until='load')
                    p2.wait_for_timeout(1500)
                    check('No film here' in p2.inner_text('main'), 'the exported-film link (#sources) also says "No film here"')
                    check(not errors or all('/film/samples/' in e for e in errors), f'only the sample file itself is missing {errors}')
                else:
                    page.goto(f'{BASE}/film/?sample=interstate', wait_until='load')
                    page.wait_for_selector('.film-poster', timeout=20000)
                    text = page.inner_text('main')
                    check('The Interstate Highway System' in text, 'the title')
                    check('This is a sample page' in text, 'it says it is a sample')
                    check('Made with Ryagram · View sources' in text, '"Made with Ryagram · View sources" under the film')
                    check('Brooks & Liscow (2023), Infrastructure Costs, replication package' in text, 'the real source is named')
                    check(page.locator('a[href="https://doi.org/10.3886/E144281V1"]').count() == 1, 'the source links to its DOI')
                    check('CC BY 4.0' in text, 'its licence')
                    check('Receipt' in text and 'Engine version' in text and '9b3d886dee22' in text, 'the receipt, with the engine version')
                    check('Published' not in text, 'a sample shows no publish date')
                    for bad in ('C:\\', '/Users/', 'sidecar', 'cache', 'reproduce'):
                        check(bad.lower() not in text.lower(), f'nothing private on the page ({bad!r})')
                    cta = page.locator('.film-cta a.button').get_attribute('href')
                    check(cta.endswith('#waitlist') and 'utm_source=film_page' in cta and cta.startswith('/ryagram/'), f'"Make your own data film" goes to the waitlist: {cta}')
                    check(page.locator('#cta-top').get_attribute('href') == cta, 'the header button goes there too')
                    check(page.locator('meta[name=robots][content*=noindex]').count() == 1, 'a sample is noindex')
                    check(page.locator('video').count() == 0, 'no video file is shown for the sample (the film is not published)')
                    check(not errors, f'no console errors {errors}')
                    page.screenshot(path=str(OUT / f'film-sample-{name}-top.png'))
                    page.screenshot(path=str(OUT / f'film-sample-{name}-full.png'), full_page=True)
                    # the link an exported film points to: .../film/?sample=interstate#sources lands on the sources
                    p2 = ctx.new_page()
                    p2.goto(f'{BASE}/film/?sample=interstate#sources', wait_until='load')
                    p2.wait_for_selector('#sources', timeout=20000)
                    p2.wait_for_timeout(500)
                    top = p2.evaluate("document.getElementById('sources').getBoundingClientRect().top")
                    check(abs(top) < 120, f'the #sources link lands on the sources (top = {top:.0f}px)')
                    p2.screenshot(path=str(OUT / f'film-sample-{name}-sources-link.png'))
                p3 = ctx.new_page()
                p3.goto(f'{BASE}/film/?s=AAAAAAAAAAAAAAAAAAAAAA', wait_until='load')
                p3.wait_for_timeout(1500)
                check('No film here' in p3.inner_text('main'), 'an unknown film says "No film here" (and nothing else)')
                p4 = ctx.new_page()
                p4.goto(f'{BASE}/film/?sample=nope', wait_until='load')
                p4.wait_for_timeout(1000)
                check('No film here' in p4.inner_text('main'), 'an unknown sample says "No film here"')
                ctx.close()
            b.close()
    finally:
        srv.shutdown()
    print('RESULT:', 'PASS' if ok else 'FAIL')
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
