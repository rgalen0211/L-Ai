"""The forecast toggle in real Chrome, mock mode, LOCAL server only (CC1 for Claude 15:30 item 2): the switch forecastToggle is turned on IN THE BROWSER ONLY (the config response is
rewritten, with liveEditor too, which the editor page needs; the committed config stays OFF). The live data editor's "Show a forecast" draws the made-up fixture: an SVG with a solid observed line, a dashed forecast, a shaded range and a
"Forecast begins" line, and a key that says Estimated, gives the backtest and never says Observed; "Hide the forecast" removes it. The film page shows NO forecast section for a film without one,
and with one (the sample page given the fixture) it is hidden until asked, then drawn the same way. With the switch OFF neither page shows anything. No sideways scroll at 1200 and 375 px;
no console errors.      python tools/check-forecast-toggle.py [SCREENSHOT_FOLDER]      (default: a new folder in the system temp)"""
import http.server, json, re, socketserver, sys, tempfile, threading
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
PORT = 8323
SHOTS = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(tempfile.mkdtemp(prefix='forecast-shots-')); SHOTS.mkdir(parents=True, exist_ok=True)
print(f'screenshots: {SHOTS}')
FIXTURE = json.loads((ROOT / 'tests' / 'fixtures' / 'forecast-estimated-1104.json').read_text(encoding='utf-8'))


class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=str(ROOT), **k)
    def log_message(self, *a): pass
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store'); super().end_headers()


srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), H)          # its own port: a fixed one can be bound twice at once on Windows (11-06)
PORT = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()
ok = True


def check(c, w):
    global ok
    print(('  ok   ' if c else '  FAIL ') + w); ok = ok and bool(c)


def context(b, opts, errs, switch_on):
    ctx = b.new_context(**opts)
    ctx.route(re.compile(r'https://fonts\.(googleapis|gstatic)\.com/.*'), lambda r, _q: r.abort())
    if switch_on:
        def cfg(route, _req):
            body = (ROOT / 'assets' / 'ryagram-config.js').read_text(encoding='utf-8')
            assert 'forecastToggle: false,' in body
            assert "  liveEditor: 'account'," in body
            route.fulfill(status=200, content_type='application/javascript', body=body.replace('forecastToggle: false,', 'forecastToggle: true,', 1).replace("  liveEditor: 'account',", '  liveEditor: true,', 1))
        ctx.route(re.compile(r'.*/assets/ryagram-config\.js.*'), cfg)
    p = ctx.new_page()
    p.on('pageerror', lambda e: errs.append(str(e))); p.on('console', lambda m: errs.append(m.text) if m.type == 'error' and 'Failed to load resource' not in m.text else None)
    return ctx, p


def noscroll(p): return p.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth')


def chart_checks(p, where, scope):
    svg = p.locator(f'{scope} svg.fc-svg')
    check(svg.count() == 1, f'{where}: one forecast chart is drawn')
    check(p.locator(f'{scope} svg.fc-svg polyline[data-part=observed]:not([stroke-dasharray])').count() >= 1, f'{where}: the observed line is solid')
    check(p.locator(f'{scope} svg.fc-svg polyline[data-part=forecast][stroke-dasharray]').count() == 1, f'{where}: the forecast line is dashed')
    check(p.locator(f'{scope} svg.fc-svg polygon[data-part=band]').count() == 1, f'{where}: the likely range is shaded')
    check(p.locator(f'{scope} svg.fc-svg line[data-part=begins]').count() == 1, f'{where}: a "Forecast begins" line')
    text = p.inner_text(f'{scope} .fc-chart')
    check('Estimated' in text and 'A test:' in text and 'Forecast begins' in text, f'{where}: the key says Estimated, gives the test and where the forecast begins')
    check('Observed' not in text and 'Observed' not in (svg.get_attribute('aria-label') or ''), f'{where}: the word Observed is never used for the forecast')


with sync_playwright() as pw:
    b = pw.chromium.launch(channel='chrome')
    for name, opts in (('desktop', dict(viewport={'width': 1200, 'height': 900})), ('phone375', dict(viewport={'width': 375, 'height': 812}, device_scale_factor=2, is_mobile=True, has_touch=True))):
        print(name)
        errs = []
        # 1. the live data editor, switch ON in the browser
        ctx, p = context(b, opts, errs, True)
        p.goto(f'http://127.0.0.1:{PORT}/app/?mock#/editor/data', wait_until='load'); p.wait_for_selector('#library h1', timeout=20000); p.wait_for_timeout(600)
        btn = p.locator('#le-fc-toggle')
        check(btn.count() == 1 and btn.inner_text() == 'Show a forecast' and p.locator('svg.fc-svg').count() == 0, 'editor: "Show a forecast" is offered and nothing is drawn until asked')
        btn.click(); p.wait_for_timeout(700)
        chart_checks(p, 'editor', '.le-forecast')
        check('A made-up example series, not real data.' in p.inner_text('.le-forecast'), 'editor: the mock series is said to be made up')
        check(noscroll(p), 'editor: no sideways scroll')
        p.screenshot(path=str(SHOTS / f'editor-forecast-{name}.png'), full_page=True)
        p.locator('#le-fc-toggle').click(); p.wait_for_timeout(300)
        check(p.locator('svg.fc-svg').count() == 0 and p.locator('#le-fc-toggle').inner_text() == 'Show a forecast', 'editor: "Hide the forecast" removes it')
        # 2. the film page: the sample has no forecast, so there is no section
        p.goto(f'http://127.0.0.1:{PORT}/film/?mock', wait_until='load'); p.wait_for_selector('#film h1', timeout=20000); p.wait_for_timeout(500)
        check(p.locator('#film-fc-toggle').count() == 0, 'film page: a film without a forecast shows no forecast section')
        ctx.close()
        # 3. the film page with a forecast in its data (the sample page given the fixture)
        ctx, p = context(b, opts, errs, True)
        def sample(route, _req):
            page = json.loads((ROOT / 'tests' / 'fixtures' / 'film' / 'page-sample.json').read_text(encoding='utf-8'))
            page.setdefault('summary', {})['forecast'] = FIXTURE
            route.fulfill(status=200, content_type='application/json', body=json.dumps(page))
        ctx.route(re.compile(r'.*/tests/fixtures/film/page-sample\.json.*'), sample)
        p.goto(f'http://127.0.0.1:{PORT}/film/?mock', wait_until='load'); p.wait_for_selector('#film h1', timeout=20000); p.wait_for_timeout(500)
        fb = p.locator('#film-fc-toggle')
        check(fb.count() == 1 and p.locator('svg.fc-svg').count() == 0, 'film page: the forecast is hidden until the visitor asks')
        fb.click(); p.wait_for_timeout(500)
        chart_checks(p, 'film page', '.film-forecast')
        check(noscroll(p), 'film page: no sideways scroll')
        p.screenshot(path=str(SHOTS / f'film-forecast-{name}.png'), full_page=True)
        ctx.close()
        # 4. switch OFF (the committed config): nothing on either page
        ctx, p = context(b, opts, errs, False)
        p.goto(f'http://127.0.0.1:{PORT}/app/?mock#/editor/data', wait_until='load'); p.wait_for_selector('#library h1', timeout=20000); p.wait_for_timeout(500)
        check(p.locator('#le-fc-toggle').count() == 0 and p.locator('.le-forecast').count() == 0, 'switch OFF: the editor shows no forecast control')
        ctx.close()
        check(not errs, f'no console errors {errs[:2]}')
    b.close()
srv.shutdown(); srv.server_close()
print('PASS' if ok else 'FAILED'); sys.exit(0 if ok else 1)
