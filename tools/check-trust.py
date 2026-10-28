"""The trust label on every upload (RULINGS 2026-10-26), in real Chrome, mock mode, desktop and phone, with `uploads` switched on in a LOCAL copy of the config only: the label
'Unverified, user-supplied', its plain warning and the 'I understand, use it anyway' box appear on the confirm screen of EVERY upload (mock mode also shows the S5 source fields), the confirm is
refused until the box is ticked (nothing is saved), the label rides on the uploaded dataset's card afterwards, and nothing sideways-scrolls. Writes screenshots. Needs Chrome, so it is not part of
the node suite.

    python tools/check-trust.py [outdir]        (default D:/Ryagram-scratch/WEB/trust-shots)
"""
import http.server
import re
import socketserver
import sys
import tempfile
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('D:/Ryagram-scratch/WEB/trust-shots')
PORT = 8187
BASE = f'http://127.0.0.1:{PORT}'
LABEL = 'Unverified, user-supplied'
CSV = 'State,Year,Rent\nAlabama,2015,1100\nAlabama,2016,1150\nAlaska,2015,1400\nAlaska,2016,1450\n'


def serve():
    class H(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *a, **k):
            super().__init__(*a, directory=str(ROOT), **k)

        def log_message(self, *a):
            pass

        def end_headers(self):
            self.send_header('Cache-Control', 'no-store')
            super().end_headers()
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
    cfg = (ROOT / 'assets' / 'ryagram-config.js').read_text(encoding='utf-8')
    cfg = re.sub(r'aiFirst:\s*true', 'aiFirst: false', re.sub(r'departments:\s*true', 'departments: false', cfg))      # this check walks the library; the AI-first door (ON since Q303) is checked by check-start.py
    tmp = Path(tempfile.mkdtemp(dir='D:/Ryagram-scratch/WEB/temp'))
    f = tmp / 'rents.csv'
    f.write_text(CSV, encoding='utf-8')
    try:
        with sync_playwright() as pw:
            b = pw.chromium.launch(channel='chrome')
            for guide in (False,):               # (mock mode shows the S5 fields whatever byodGuide says, so the guide-off path is pinned by tests/trust-label.test.mjs instead)
                flipped = re.sub(r'uploads:\s*false', 'uploads: true', cfg)
                if guide:
                    flipped = re.sub(r'byodGuide:\s*false', 'byodGuide: true', flipped)
                for name, opts in (('desktop', dict(viewport={'width': 1280, 'height': 900})),
                                   ('phone', dict(viewport={'width': 390, 'height': 844}, device_scale_factor=3, is_mobile=True, has_touch=True))):
                    tag = f'{name}-guide{"on" if guide else "off"}'
                    print(tag)
                    ctx = b.new_context(**opts)
                    ctx.route('**/assets/ryagram-config.js*', (lambda body: (lambda route: route.fulfill(status=200, content_type='text/javascript', body=body)))(flipped))
                    p = ctx.new_page()
                    errors = []
                    p.on('pageerror', lambda e: errors.append(str(e)))
                    p.on('console', lambda m: errors.append(m.text) if m.type == 'error' and 'status of 404' not in m.text and 'Failed to load resource' not in m.text else None)
                    p.on('dialog', lambda d: d.accept())
                    p.goto(f'{BASE}/app/?mock', wait_until='load')
                    p.wait_for_selector('#np-title', timeout=20000)
                    p.fill('#np-title', 'My rents')
                    p.click('button:has-text("Create")')
                    p.wait_for_selector('h1:has-text("Version 1")', timeout=20000)
                    p.wait_for_selector('.uploads-panel', state='attached', timeout=15000)
                    adv = p.locator('details.advanced-panel')
                    if adv.count() and adv.first.get_attribute('open') is None:
                        adv.first.locator('summary').first.click()
                    p.locator('.uploads-panel').scroll_into_view_if_needed()
                    p.set_input_files('#upload-file', str(f))
                    if not p.is_checked('#upload-rights'):
                        p.check('#upload-rights')
                    p.get_by_role('button', name='Upload').click()
                    p.wait_for_selector('.mapping-form', timeout=20000)
                    box = p.locator('.trust-box')
                    check(box.count() == 1 and LABEL in box.inner_text(), f'the confirm screen shows the label "{LABEL}"')
                    check('Ryagram has not checked this data' in box.inner_text() and 'I understand, use it anyway.' in box.inner_text(), 'with the plain warning and the choose-to-use-it box')
                    check(not p.is_checked('#trust-ack'), 'the box starts unticked')
                    p.locator('.upload-card').first.screenshot(path=str(OUT / f'confirm-{tag}.png'))
                    if p.locator('#prov-publisher').count():   # mock mode always shows the S5 source fields: fill them so only the trust box can stop the confirm
                        p.fill('#prov-publisher', 'Me'); p.locator('select[aria-label="What lets you use it"]').select_option('own_data')
                        p.fill('#prov-unit', 'dollars'); p.check('#prov-attest')
                    p.get_by_role('button', name='These are right').click()
                    p.wait_for_timeout(600)
                    check(p.locator('.mapping-form').count() == 1 and 'Tick the box to use this data anyway.' in p.inner_text('.uploads-panel'), 'confirming without the box is refused in words, and the screen stays')
                    p.check('#trust-ack')
                    p.get_by_role('button', name='These are right').click()
                    p.wait_for_selector('.upload-card button:has-text("Use in this film")', timeout=15000)
                    chip = p.locator('.upload-card .trust-chip')
                    check(chip.count() == 1 and chip.inner_text() == LABEL, 'after confirming, the dataset card carries the label')
                    check(p.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth'), 'no sideways scroll')
                    p.locator('.upload-card').first.screenshot(path=str(OUT / f'card-{tag}.png'))
                    check(errors == [], 'no console errors')
                    ctx.close()
            b.close()
    finally:
        srv.shutdown()
    print('ALL OK' if ok else 'FAILED')
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
