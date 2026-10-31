"""Accessibility scan of the two landing page drafts (NEXT-WEB 193) with the switch ON in a local config copy, desktop and 320 px: names, headings, contrast, tap targets, alt text (the same scan as tools/audit-a11y.py).
Exit 1 on any finding. Needs Chrome.   python tools/audit-a11y-landing.py"""
import importlib.util, re, sys
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('aa', ROOT / 'tools' / 'audit-a11y.py'); aa = importlib.util.module_from_spec(spec); spec.loader.exec_module(aa)
srv = aa.serve(); port = srv.server_address[1] if hasattr(srv, 'server_address') else aa.PORT
cfg = re.sub(r'landingDrafts:\s*false', 'landingDrafts: true', (ROOT / 'assets/ryagram-config.js').read_text(encoding='utf-8'))
found = []
with sync_playwright() as pw:
    b = pw.chromium.launch(channel='chrome')
    for name, opts in (('desktop', dict(viewport={'width': 1200, 'height': 900})), ('phone320', dict(viewport={'width': 320, 'height': 700}, is_mobile=True, has_touch=True))):
        for slug in ('song-films', 'compilations'):
            ctx = b.new_context(**opts)
            ctx.route(re.compile(r'https://fonts\.(googleapis|gstatic)\.com/.*'), lambda r, _q: r.abort())
            ctx.route('**/assets/ryagram-config.js*', lambda r, _q: r.fulfill(status=200, content_type='text/javascript', body=cfg))
            p = ctx.new_page(); p.goto(f'http://127.0.0.1:{port}/landing-drafts/{slug}/', wait_until='load'); p.wait_for_timeout(400)
            r = p.evaluate(aa.SCAN)
            for k in ('noname', 'headings', 'contrast', 'small', 'noalt'):
                for v in r[k]: found.append((name, slug, k, v))
            ctx.close()
    b.close()
for f in found: print('FINDING', f)
print(f'FINDINGS: {len(found)}'); sys.exit(1 if found else 0)
