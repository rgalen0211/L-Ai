"""'Download my data' (NEXT-WEB 153) in real Chrome, mock mode, LOCAL server only, desktop and phone, with `uploads` switched on in a LOCAL copy of the config only: an upload is confirmed, its card
shows a Download my data button, pressing it downloads ONE zip made in the browser from the person's own session; the zip holds the file exactly as it was uploaded, RECEIPT.txt and receipt.json
(the fingerprint is computed from the bytes in the zip and matches the recorded one, the trust label and the acknowledgement date are there, the mapping is the prep log) and no cleaned table (it
says so); when the file is no longer in the person's slot the button still gives the receipt, said plainly. Reads the zip back with Python's zipfile (an independent reader). Needs Chrome.

    python tools/check-download-data.py [outdir]        (default D:/Ryagram-scratch/WEB/download-data-shots)
"""
import hashlib
import http.server
import json
import re
import socketserver
import sys
import tempfile
import threading
import zipfile
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('D:/Ryagram-scratch/WEB/download-data-shots')
PORT = 8281
BASE = f'http://127.0.0.1:{PORT}'
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
    flipped = re.sub(r'uploads:\s*false', 'uploads: true', cfg)
    tmp = Path(tempfile.mkdtemp(dir='D:/Ryagram-scratch/WEB/temp'))
    f = tmp / 'rents.csv'
    f.write_bytes(CSV.encode())                                              # exact bytes (no newline translation)
    want_bytes = f.read_bytes()
    want_sha = hashlib.sha256(want_bytes).hexdigest()
    try:
        with sync_playwright() as pw:
            b = pw.chromium.launch(channel='chrome')
            for name, opts in (('desktop', dict(viewport={'width': 1280, 'height': 900}, accept_downloads=True)),
                               ('phone', dict(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True, accept_downloads=True))):
                print(name)
                ctx = b.new_context(**opts)
                ctx.route('**/assets/ryagram-config.js*', lambda route: route.fulfill(status=200, content_type='text/javascript', body=flipped))
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
                if p.locator('#prov-publisher').count():
                    p.fill('#prov-publisher', 'Me')
                    p.locator('select[aria-label="What lets you use it"]').select_option('own_data')
                    p.fill('#prov-unit', 'dollars')
                    p.check('#prov-attest')
                p.check('#trust-ack')
                p.get_by_role('button', name='These are right').click()
                p.wait_for_selector('.upload-card button:has-text("Use in this film")', timeout=15000)
                btn = p.locator('.upload-card button[data-key="download-my-data"]')
                check(btn.count() == 1 and btn.inner_text() == 'Download this dataset', 'the dataset card has a Download my data button')
                btn.scroll_into_view_if_needed()
                with p.expect_download(timeout=15000) as dl:
                    btn.click()
                path = dl.value.path()
                check(dl.value.suggested_filename.endswith('.zip') and 'my data' in dl.value.suggested_filename, 'one zip is downloaded, named for the data')
                z = zipfile.ZipFile(path)
                names = sorted(z.namelist())
                check(names == ['RECEIPT.txt', 'receipt.json', 'source/rents.csv'], 'the zip holds the receipt (words and JSON) and the file, and no cleaned table (' + ', '.join(names) + ')')
                check(z.read('source/rents.csv') == want_bytes, 'the file inside is exactly what was uploaded, byte for byte')
                check(all(i.compress_type == zipfile.ZIP_STORED for i in z.infolist()) and z.testzip() is None, 'a valid stored zip (Python\u2019s own reader finds no bad CRC)')
                r = json.loads(z.read('receipt.json').decode())
                check(r['dataset']['sha256_of_file_in_this_zip'] == want_sha, 'the fingerprint is computed from the bytes in the zip')
                check(r['trust']['label'] == 'Unverified, user-supplied' and r['trust']['you_acknowledged_on'], 'the receipt carries the trust label and the day the person acknowledged it')
                check(r['how_ryagram_read_it']['column_meanings_you_confirmed'] is not None and r['in_this_zip']['cleaned_table'] is None, 'it carries the confirmed column meanings (the prep log) and says there is no cleaned table')
                txt = z.read('RECEIPT.txt').decode()
                check('you uploaded it on' in txt and 'cleaned table is not available' in txt, 'RECEIPT.txt says so in plain words')
                check(p.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth'), 'no sideways scroll')
                check('is downloading' in p.locator('.upload-card .download-data').inner_text(), 'the card says the zip is downloading')
                p.locator('.upload-card').first.screenshot(path=str(OUT / f'card-{name}.png'))
                check(not errors, 'no console errors' + (f': {errors[:2]}' if errors else ''))
                ctx.close()
            b.close()
    finally:
        srv.shutdown()
    print('ALL OK' if ok else 'FAILED')
    sys.exit(0 if ok else 1)


main()
