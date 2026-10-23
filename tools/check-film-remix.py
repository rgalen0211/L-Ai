"""'See your county' (NEXT-WEB 131) in real Chrome, LOCAL server only. On the sample film page (/film/?sample=interstate):
flag OFF -> no section at all; flag ON -> the section; a page made from uploaded data (the same page with uploaded_data true) -> no section even with the flag on;
open the picker (one remix_click, the places file fetched once), choose a state and county, press See it (one preview_created), check the canvas really drew pixels, and the final-film link carries the remix tag.
The funnel steps are captured on their way to a stub (nothing leaves 127.0.0.1). Phone width: no sideways scroll, controls 44 px. Writes screenshots. Not part of the node suite (needs Chrome).

    python tools/check-film-remix.py [outdir]        (default D:/Ryagram-scratch/WEB/film-remix-shots)
"""
import json
import re
import sys
import threading
import http.server
import socketserver
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('D:/Ryagram-scratch/WEB/film-remix-shots')
PORT = 8199
BASE = f'http://127.0.0.1:{PORT}'


class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=str(ROOT), **k)

    def log_message(self, *a):
        pass

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    socketserver.TCPServer.allow_reuse_address = True
    srv = socketserver.ThreadingTCPServer(('127.0.0.1', PORT), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    cfg_src = (ROOT / 'assets' / 'ryagram-config.js').read_text(encoding='utf8')
    ok = True

    def check(c, what):
        nonlocal ok
        print(('  ok   ' if c else '  FAIL ') + what)
        ok = ok and bool(c)

    def config(on, tracking=True):
        s = re.sub(r'seeYourCounty:\s*false', 'seeYourCounty: ' + ('true' if on else 'false'), cfg_src)
        if tracking:
            s = re.sub(r'funnelTracking:\s*false', 'funnelTracking: true', s)
            s = s.replace('supabaseUrl: \'https://jxtkfishqfxuptwjzczz.supabase.co\'', "supabaseUrl: '" + BASE + "/stub'")
        return s

    try:
        with sync_playwright() as pw:
            b = pw.chromium.launch(channel='chrome')

            def open_page(on, uploaded=False, width=1100, tracking=True):
                ctx = b.new_context(viewport={'width': width, 'height': 900}, is_mobile=width < 500, has_touch=width < 500, user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36')
                events, places = [], []
                ctx.add_init_script("Object.defineProperty(navigator, 'webdriver', { get: () => false })")     # (the funnel skips automated browsers on purpose; this check needs it to run)
                ctx.route('**/assets/ryagram-config.js*', lambda r: r.fulfill(status=200, content_type='text/javascript', body=config(on, tracking)))
                ctx.route('**/stub/rest/v1/rpc/funnel_anon', lambda r: (events.append(json.loads(r.request.post_data)['p_event']), r.fulfill(status=204, body=''))[1])
                ctx.on('request', lambda rq: places.append(rq.url) if 'interstate-practice.json' in rq.url else None)
                if uploaded:
                    def sample(r):
                        d = json.loads((ROOT / 'film' / 'samples' / 'interstate.json').read_text(encoding='utf8'))
                        d['summary']['uploaded_data'] = True
                        r.fulfill(status=200, content_type='application/json', body=json.dumps(d))
                    ctx.route('**/film/samples/interstate.json', sample)
                p = ctx.new_page()
                errs = []
                p.on('pageerror', lambda e: errs.append(str(e)))
                p.goto(f'{BASE}/film/?sample=interstate', wait_until='load')
                p.wait_for_selector('h1')
                p.wait_for_timeout(400)
                return ctx, p, events, places, errs

            ctx, p, ev, pl, errs = open_page(False)
            check(p.locator('#remix').count() == 0, 'flag off: no "See your county" section')
            check(ev == [] or ev == ['film_view'], f'flag off: only the film view step at most ({ev})')
            ctx.close()

            ctx, p, ev, pl, errs = open_page(True, uploaded=True)
            check(p.locator('#remix').count() == 0, 'MUST-FAIL: a film made from uploaded data shows no section, flag on')
            check('remix_click' not in ev and pl == [], 'and nothing about a remix was sent or fetched')
            ctx.close()

            ctx, p, ev, pl, errs = open_page(True)
            check(p.locator('#remix').count() == 1 and p.locator('#remix-open').is_visible(), 'flag on, public film: the section is there')
            check(pl == [], 'the places file is NOT fetched until someone asks')
            p.click('#remix-open')
            p.wait_for_selector('#remix-state:not([disabled])')
            check(len(pl) == 1, 'the places file is fetched once')
            p.select_option('#remix-state', '48')
            p.select_option('#remix-county', '201')
            p.click('#remix-go')
            p.wait_for_timeout(1500)
            px = p.evaluate("() => { const c = document.getElementById('remix-canvas'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let teal = 0; for (let i = 0; i < d.length; i += 4) if (d[i] < 90 && d[i + 1] > 150 && d[i + 2] > 130) teal++; return teal; }")
            check(px > 500, f'the preview really drew bars ({px} teal pixels)')
            check('practice numbers' in p.inner_text('#remix-live'), 'the practice numbers say they are practice')
            href = p.get_attribute('#remix-final', 'href')
            check('utm_medium=remix' in href and 'utm_campaign=remix_interstate' in href and href.endswith('#waitlist'), f'the final-film link is tagged ({href})')
            check(ev == ['film_view', 'remix_click', 'preview_created'], f'the funnel steps in order ({ev})')
            p.screenshot(path=str(OUT / 'desktop-preview.png'), full_page=True)
            check(not errs, f'no page errors {errs}')
            ctx.close()

            ctx, p, ev, pl, errs = open_page(True, width=390)
            p.click('#remix-open')
            p.wait_for_selector('#remix-state:not([disabled])')
            p.select_option('#remix-state', '01')
            p.select_option('#remix-county', '073')
            p.click('#remix-go')
            p.wait_for_timeout(1500)
            check(not p.evaluate('document.documentElement.scrollWidth > innerWidth + 1'), 'phone: no sideways scroll')
            small = p.evaluate("() => [...document.querySelectorAll('#remix button,#remix select,#remix a')].filter(e => e.getBoundingClientRect().width && e.getBoundingClientRect().height < 43.5).map(e => e.id + ' ' + Math.round(e.getBoundingClientRect().height))")
            check(not small, f'phone: every control 44 px or more {small}')
            p.screenshot(path=str(OUT / 'phone-preview.png'), full_page=True)
            ctx.close()
            b.close()
    finally:
        srv.shutdown()
    print('RESULT:', 'PASS' if ok else 'FAIL')
    sys.exit(0 if ok else 1)


main()
