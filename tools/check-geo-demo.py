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
        check(p.locator('.geo-svg polygon[data-ring]').count() == 1, 'a ring is drawn')
        r2 = num(p, 'Residents inside the ring'); p.select_option('#geo-km', '4000'); p.wait_for_timeout(200); r4 = num(p, 'Residents inside the ring')
        check(r4 >= r2 > 0, f'a bigger ring never holds fewer residents ({r2} then {r4})')
        p.select_option('#geo-km', '1000'); p.wait_for_timeout(200); r1 = num(p, 'Residents inside the ring')
        check(r1 <= r2, f'a smaller ring holds no more ({r1})')
        bb = p.locator('.geo-svg').bounding_box()
        p.locator('.geo-svg').click(position={'x': bb['width'] * 0.15, 'y': bb['height'] * 0.2}); p.wait_for_timeout(250)
        check('Site A and site B' in p.inner_text('.geo-results caption') and p.locator('.geo-results tbody tr').count() == 6, 'the next click places site B and the two sites are compared in six rows')
        check(p.locator('.geo-svg polygon[data-ring]').count() == 2 and p.locator('.geo-svg text:text-is("A")').count() == 1 and p.locator('.geo-svg text:text-is("B")').count() == 1, 'two rings and two pins carrying their letters (A and B never depend on colour)')
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
    print('real data mode (the private file; skipped when it is not on this computer)')
    REAL = Path('D:/Ryagram-scratch/WEB/private/geo-dayton-real.json')
    real_cfg = re.sub(r'geoRealData:\s*false', 'geoRealData: true', on_cfg)
    errs, hosts = [], set()
    p = page(b, on_cfg, dict(viewport={'width': 1200, 'height': 900}), errs, hosts)
    p.goto(f'http://127.0.0.1:{PORT}/geo-demo/', wait_until='load'); p.wait_for_selector('.geo-svg')
    check(p.locator('#geo-real-file').count() == 0, 'with geoRealData off there is no file chooser')
    p.context.close()
    if REAL.exists():
        for name, opts in (('desktop', dict(viewport={'width': 1200, 'height': 900})), ('phone320', dict(viewport={'width': 320, 'height': 700}, device_scale_factor=2, is_mobile=True, has_touch=True))):
            errs, hosts = [], set()
            p = page(b, real_cfg, opts, errs, hosts)
            p.goto(f'http://127.0.0.1:{PORT}/geo-demo/', wait_until='load'); p.wait_for_selector('#geo-real-file')
            bad = ROOT / 'tools' / 'check-geo-demo.py'
            p.set_input_files('#geo-real-file', str(bad)); p.wait_for_timeout(300)
            check('not the real-data file' in p.inner_text('.geo-real') or 'could not be read' in p.inner_text('.geo-real'), f'{name}: a wrong file is refused in words')
            p.set_input_files('#geo-real-file', str(REAL)); p.wait_for_selector('.geo-sources', timeout=30000); p.wait_for_timeout(500)
            t = p.inner_text('#geo-demo')
            check('PRIVATE REAL DATA' in t and 'OpenStreetMap contributors' in t, f'{name}: the private banner and the OpenStreetMap credit show')
            check(p.locator('.geo-svg polygon').count() >= 400 and p.locator('.geo-svg circle').count() > 10, f'{name}: the real block groups and places are drawn')
            p.locator('.geo-sources summary').click(); check('ODbL' in p.inner_text('.geo-sources') and 'fingerprint' in p.inner_text('.geo-sources'), f'{name}: the sources, licences and fingerprints are listed')
            p.get_by_role('button', name='Most crowded area (an example site)').click(); p.wait_for_timeout(500)
            check(p.locator('.geo-results tbody tr').count() == 5 and 'Estimated' in p.inner_text('.geo-results'), f'{name}: a site gives five labelled rows with residents Estimated')
            p.get_by_role('button', name='Highest median income area (an example site)').click(); p.wait_for_timeout(500)
            check('Site A and site B' in p.inner_text('.geo-results caption'), f'{name}: the second site is compared')
            check(p.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth'), f'{name}: no sideways scroll')
            check(hosts <= {f'http://127.0.0.1:{PORT}', 'https://fonts.googleapis.com'}, f'{name}: no outside request: {sorted(hosts)}')
            check(not errs, f'{name}: no console errors' + (f': {errs[:2]}' if errs else ''))
            p.screenshot(path=str(Path('D:/Ryagram-scratch/WEB/temp') / f'geo-real-{name}.png'), full_page=True)
            p.get_by_role('button', name='Back to the made-up demo').click(); p.wait_for_timeout(300)
            check('SYNTHETIC DEMO DATA' in p.inner_text('#geo-demo'), f'{name}: back to the made-up demo')
            p.context.close()
    else:
        print('  skip the private real-data file is not on this computer')
    print('switch off')
    errs, hosts = [], set()
    p = page(b, base, dict(viewport={'width': 1200, 'height': 900}), errs, hosts)
    p.goto(f'http://127.0.0.1:{PORT}/geo-demo/', wait_until='load'); p.wait_for_timeout(500)
    check(p.inner_text('main').strip() == 'This page is not available yet.', 'with the switch off only the plain line shows')
    p.context.close(); b.close()
srv.shutdown()
print('ALL OK' if ok else 'FAILED'); sys.exit(0 if ok else 1)
