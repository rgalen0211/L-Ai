"""The Geographic Intelligence demo page (/geo-demo/, NEXT-WEB 198) in real Chrome, LOCAL server only, `geoDemo` ON in a local config copy, desktop and phone (375 and 320 px): switch off shows only the plain line;
on shows the synthetic banner, the map with its three marker kinds, a preset site draws a ring and fills the five labelled rows, a click on the map moves the site, the ring radius changes the numbers, a bigger ring never
holds fewer residents, every number has a label, the page makes no outside request, no sideways scroll, no console errors. Needs Chrome.   python tools/check-geo-demo.py"""
import http.server, re, socketserver, sys, threading
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
PORT = 8321


class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=str(ROOT), **k)
    def log_message(self, *a): pass
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store'); super().end_headers()


socketserver.TCPServer.allow_reuse_address = True
srv = socketserver.ThreadingTCPServer(('127.0.0.1', PORT), H)
threading.Thread(target=srv.serve_forever, daemon=True).start()
base = (ROOT / 'assets/ryagram-config.js').read_text(encoding='utf-8')
on_cfg = re.sub(r'geoDemo:\s*false', 'geoDemo: true', base)
ok = True


def check(c, w):
    global ok
    print(('  ok   ' if c else '  FAIL ') + w); ok = ok and bool(c)


def page(b, cfg, opts, errs, hosts):
    ctx = b.new_context(**opts)
    ctx.route(re.compile(r'https://fonts\.(googleapis|gstatic)\.com/.*'), lambda r, _q: r.abort())
    ctx.route('**/assets/ryagram-config.js*', lambda r, _q, c=cfg: r.fulfill(status=200, content_type='text/javascript', body=c))
    p = ctx.new_page()
    p.on('request', lambda rq: hosts.add(re.match(r'https?://[^/]+', rq.url).group(0)) if re.match(r'https?://', rq.url) else None)
    p.on('pageerror', lambda e: errs.append(str(e))); p.on('console', lambda m: errs.append(m.text) if m.type == 'error' and 'Failed to load resource' not in m.text else None)
    return p


def num(p, label):
    t = p.locator(f'.geo-results tr:has(th:text-is("{label}")) td').first.inner_text()
    return int(re.sub(r'[^0-9]', '', t.split(',')[0]) or 0)


with sync_playwright() as pw:
    b = pw.chromium.launch(channel='chrome')
    for name, opts in (('desktop', dict(viewport={'width': 1200, 'height': 900})), ('phone375', dict(viewport={'width': 375, 'height': 812}, device_scale_factor=2, is_mobile=True, has_touch=True)),
                       ('phone320', dict(viewport={'width': 320, 'height': 700}, device_scale_factor=2, is_mobile=True, has_touch=True))):
        print(name)
        errs, hosts = [], set()
        p = page(b, on_cfg, opts, errs, hosts)
        p.goto(f'http://127.0.0.1:{PORT}/geo-demo/', wait_until='load'); p.wait_for_selector('.geo-svg', timeout=20000)
        check('SYNTHETIC DEMO DATA' in p.inner_text('#geo-demo'), 'the synthetic banner shows')
        check(p.locator('.geo-svg polygon').count() >= 30 and p.locator('.geo-svg circle').count() >= 14 and p.locator('.geo-svg rect').count() >= 18, 'areas and the three marker kinds are drawn')
        check('Pick a site' in p.inner_text('.geo-results'), 'no numbers before a site is chosen')
        p.get_by_role('button', name='Middle of the map').click(); p.wait_for_timeout(200)
        rows = p.locator('.geo-results tbody tr')
        check(rows.count() == 6, 'a preset site fills six rows')
        labels = [t.strip() for t in p.locator('.geo-results tbody .geo-chip').all_inner_texts()]
        check(len(labels) == 6 and all(x in ('Observed', 'Calculated', 'Estimated', 'Simulated') for x in labels), f'every row carries a label: {labels}')
        check(p.locator('.geo-svg polygon[stroke-dasharray]').count() == 1, 'a ring is drawn')
        r2 = num(p, 'Residents inside the ring'); p.select_option('#geo-km', '4000'); p.wait_for_timeout(200); r4 = num(p, 'Residents inside the ring')
        check(r4 >= r2 > 0, f'a bigger ring never holds fewer residents ({r2} then {r4})')
        p.select_option('#geo-km', '1000'); p.wait_for_timeout(200); r1 = num(p, 'Residents inside the ring')
        check(r1 <= r2, f'a smaller ring holds no more ({r1})')
        bb = p.locator('.geo-svg').bounding_box()
        p.locator('.geo-svg').click(position={'x': bb['width'] * 0.15, 'y': bb['height'] * 0.2}); p.wait_for_timeout(250)
        check('Site A and site B' in p.inner_text('.geo-results caption') and p.locator('.geo-results tbody tr').count() == 6, 'the next click places site B and the two sites are compared in six rows')
        check(p.locator('.geo-svg polygon[stroke-dasharray="7 5"]').count() == 1 and p.locator('.geo-svg polygon[stroke-dasharray="2 5"]').count() == 1, 'two rings with different dash patterns, not colour alone')
        check('does not say which site is better' in p.inner_text('.geo-summary'), 'the summary counts and says it is not a verdict')
        diffs = [t.strip() for t in p.locator('.geo-results tbody td[data-col="B minus A"]').all_inner_texts()]
        check(len(diffs) == 6 and all(re.match(r'^([+−]?[0-9,.]+( people| m)?|not compared)$', d) for d in diffs), f'every difference reads as a signed number: {diffs}')
        chips = [t.strip() for t in p.locator('.geo-results tbody .geo-chip').all_inner_texts()]
        check(len(chips) == 6 and set(chips) <= {'Calculated', 'Estimated'} and 'Estimated' in chips, f'every row is labelled, and residents are Estimated: {sorted(set(chips))}')
        p.get_by_role('button', name='Remove site B').click(); p.wait_for_timeout(250)
        check('around site A' in p.inner_text('.geo-results caption') and p.get_by_role('button', name='Remove site B').count() == 0 or not p.get_by_role('button', name='Remove site B').is_visible(), 'removing site B goes back to one site')
        check(p.locator('button[aria-disabled="true"]').count() == 1 and 'not built yet' in p.inner_text('#geo-demo'), 'the film button says it is not built yet')
        check(p.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth'), 'no sideways scroll')
        check(hosts <= {f'http://127.0.0.1:{PORT}', 'https://fonts.googleapis.com'}, f'no outside request: {sorted(hosts)}')
        check(not errs, 'no console errors' + (f': {errs[:2]}' if errs else ''))
        p.screenshot(path=str(Path('D:/Ryagram-scratch/WEB/temp') / f'geo-demo-{name}.png'), full_page=True)
        p.context.close()
    print('switch off')
    errs, hosts = [], set()
    p = page(b, base, dict(viewport={'width': 1200, 'height': 900}), errs, hosts)
    p.goto(f'http://127.0.0.1:{PORT}/geo-demo/', wait_until='load'); p.wait_for_timeout(500)
    check(p.inner_text('main').strip() == 'This page is not available yet.', 'with the switch off only the plain line shows')
    p.context.close(); b.close()
srv.shutdown()
print('ALL OK' if ok else 'FAILED'); sys.exit(0 if ok else 1)
