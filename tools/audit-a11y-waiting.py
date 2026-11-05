"""Accessibility scan (the scan of tools/audit-a11y.py) of the Option B pages in mock mode: the waiting page, the admin waiting list, and the create-account page, desktop and 320 px: names, headings, contrast,
tap targets, alt. Exit 1 on any finding. Needs Chrome.   python tools/audit-a11y-waiting.py"""
import importlib.util, re, sys
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('aa', ROOT / 'tools' / 'audit-a11y.py'); aa = importlib.util.module_from_spec(spec); spec.loader.exec_module(aa)
srv = aa.serve(); port = srv.server_address[1] if hasattr(srv, 'server_address') else aa.PORT
found, states = [], 0
with sync_playwright() as pw:
    b = pw.chromium.launch(channel='chrome')
    for name, opts in (('desktop', dict(viewport={'width': 1200, 'height': 900})), ('phone320', dict(viewport={'width': 320, 'height': 700}, is_mobile=True, has_touch=True))):
        ctx = b.new_context(**opts)
        ctx.route(re.compile(r'https://fonts\.(googleapis|gstatic)\.com/.*'), lambda r, _q: r.abort())
        p = ctx.new_page()
        for label, q, h in (('waiting', '&waiting', '#/'), ('admin', '', '#/admin/waiting')):
            p.goto(f'http://127.0.0.1:{port}/app/?mock{q}{h}', wait_until='load'); p.wait_for_selector('#library:not([hidden]) h1', timeout=20000); p.wait_for_timeout(500)
            r = p.evaluate(aa.SCAN); states += 1
            for k in ('noname', 'headings', 'contrast', 'small', 'noalt'):
                for v in r[k]: found.append((name, label, k, v))
        p.click('text=Sign out'); p.wait_for_selector('#sign-in:not([hidden])', timeout=8000)
        p.click('#create-link'); p.wait_for_selector('#create-account:not([hidden])', timeout=5000)
        r = p.evaluate(aa.SCAN); states += 1
        for k in ('noname', 'headings', 'contrast', 'small', 'noalt'):
            for v in r[k]: found.append((name, 'create', k, v))
        ctx.close()
    b.close()
for f in found: print('FINDING', f)
print(f'states scanned: {states}; FINDINGS: {len(found)}'); sys.exit(1 if found or states != 6 else 0)
