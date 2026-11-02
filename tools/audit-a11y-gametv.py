"""Accessibility scan of the TV screen page (NEXT-WEB 203) in each state (question, locked, reveal, final) with gameTv ON in a local config copy, desktop and 320 px: names, headings, contrast, tap targets, alt text
(the same scan as tools/audit-a11y.py). Exit 1 on any finding. Needs Chrome.   python tools/audit-a11y-gametv.py"""
import importlib.util, re, sys
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('aa', ROOT / 'tools' / 'audit-a11y.py'); aa = importlib.util.module_from_spec(spec); spec.loader.exec_module(aa)
srv = aa.serve(); port = srv.server_address[1] if hasattr(srv, 'server_address') else aa.PORT
cfg = re.sub(r'gameTv:\s*false', 'gameTv: true', (ROOT / 'assets/ryagram-config.js').read_text(encoding='utf-8'))
found, states = [], 0
with sync_playwright() as pw:
    b = pw.chromium.launch(channel='chrome')
    for name, opts in (('desktop', dict(viewport={'width': 1200, 'height': 900})), ('phone320', dict(viewport={'width': 320, 'height': 700}, is_mobile=True, has_touch=True))):
        ctx = b.new_context(**opts)
        ctx.route(re.compile(r'https://fonts\.(googleapis|gstatic)\.com/.*'), lambda r, _q: r.abort())
        ctx.route('**/assets/ryagram-config.js*', lambda r, _q: r.fulfill(status=200, content_type='text/javascript', body=cfg))
        p = ctx.new_page(); p.goto(f'http://127.0.0.1:{port}/game-tv/', wait_until='load'); p.wait_for_selector('.tv-screen', timeout=20000)
        for step in range(11):                                     # 3 rounds x 3 phases, then the final screen
            r = p.evaluate(aa.SCAN); states += 1
            for k in ('noname', 'headings', 'contrast', 'small', 'noalt'):
                for v in r[k]: found.append((name, step, k, v))
            p.keyboard.press('ArrowRight'); p.wait_for_timeout(80)
        ctx.close()
    b.close()
for f in found: print('FINDING', f)
print(f'states scanned: {states}; FINDINGS: {len(found)}'); sys.exit(1 if found or states != 22 else 0)
