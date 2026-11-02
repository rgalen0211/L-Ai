"""Accessibility scan of the Geographic Intelligence demo page (NEXT-WEB 198) with geoDemo ON in a local config copy and a site chosen, desktop and 320 px: names, headings, contrast, tap targets, alt text (the same scan as
tools/audit-a11y.py). Exit 1 on any finding. Needs Chrome.   python tools/audit-a11y-geo.py"""
import importlib.util, re, sys
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('aa', ROOT / 'tools' / 'audit-a11y.py'); aa = importlib.util.module_from_spec(spec); spec.loader.exec_module(aa)
srv = aa.serve(); port = srv.server_address[1] if hasattr(srv, 'server_address') else aa.PORT
cfg = re.sub(r'geoDemo:\s*false', 'geoDemo: true', (ROOT / 'assets/ryagram-config.js').read_text(encoding='utf-8'))
found, seen = [], 0
with sync_playwright() as pw:
    b = pw.chromium.launch(channel='chrome')
    for name, opts in (('desktop', dict(viewport={'width': 1200, 'height': 900})), ('phone320', dict(viewport={'width': 320, 'height': 700}, is_mobile=True, has_touch=True))):
        ctx = b.new_context(**opts)
        ctx.route(re.compile(r'https://fonts\.(googleapis|gstatic)\.com/.*'), lambda r, _q: r.abort())
        ctx.route('**/assets/ryagram-config.js*', lambda r, _q: r.fulfill(status=200, content_type='text/javascript', body=cfg))
        p = ctx.new_page(); p.goto(f'http://127.0.0.1:{port}/geo-demo/', wait_until='load'); p.wait_for_selector('.geo-svg', timeout=20000)
        p.get_by_role('button', name='Middle of the map').click(); p.wait_for_timeout(300)
        p.get_by_role('button', name='North edge').click(); p.wait_for_timeout(300)          # the second site: the compare table is the one scanned
        seen += p.locator('.geo-results tbody tr').count()
        r0 = p.evaluate(aa.SCAN)
        for k in ('noname', 'headings', 'contrast', 'small', 'noalt'):
            for v in r0[k]: found.append((name, k, v))
        p.get_by_label('City anatomy').check(); p.wait_for_timeout(300)            # City Anatomy is scanned too (the compare table above, the access table here)
        seen += p.locator('.geo-results tbody tr').count() * 0
        r = p.evaluate(aa.SCAN)
        for k in ('noname', 'headings', 'contrast', 'small', 'noalt'):
            for v in r[k]: found.append((name, k, v))
        REAL = Path('D:/Ryagram-scratch/WEB/private/geo-dayton-real.json')
        if REAL.exists():                                           # the private real-data mode, when the file is on this computer
            real_cfg = re.sub(r'geoRealData:\s*false', 'geoRealData: true', cfg)
            ctx.unroute('**/assets/ryagram-config.js*'); ctx.route('**/assets/ryagram-config.js*', lambda r, _q: r.fulfill(status=200, content_type='text/javascript', body=real_cfg))
            p.goto(f'http://127.0.0.1:{port}/geo-demo/', wait_until='load'); p.wait_for_selector('#geo-real-file'); p.set_input_files('#geo-real-file', str(REAL)); p.wait_for_selector('.geo-sources', timeout=30000)
            p.locator('.geo-sources summary').click()
            p.get_by_role('button', name='Most crowded area (an example site)').click(); p.get_by_role('button', name='Highest median income area (an example site)').click(); p.wait_for_timeout(600)
            seen += p.locator('.geo-results tbody tr').count() * 0
            r = p.evaluate(aa.SCAN)
            for k in ('noname', 'headings', 'contrast', 'small', 'noalt'):
                for v in r[k]: found.append((name + '-real', k, v))
        ctx.close()
    b.close()
for f in found: print('FINDING', f)
print(f'rows scanned: {seen}; FINDINGS: {len(found)}'); sys.exit(1 if found or seen != 12 else 0)
