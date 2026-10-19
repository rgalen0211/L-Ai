"""The DRAFT housing film page (/film/?sample=housing-value-to-income) in real Chrome (and optionally headless Firefox) at a desktop and a phone width: it renders, the video slot is empty,
how-to-read, the chart (4 bars) and sources are there, no console errors, the favicon is requested without a 404, no sideways scroll. Screenshots go to the folder given (default D:/Ryagram-scratch/WEB/hfp-shots).
Usage: py tools/check-housing-film-page.py [shots-folder]"""
import http.server
import os
import socketserver
import subprocess
import sys
import tempfile
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('D:/Ryagram-scratch/WEB/hfp-shots')
OUT.mkdir(parents=True, exist_ok=True)
FF = r'C:\Program Files\Mozilla Firefox\firefox.exe'
URL_PATH = '/film/?sample=housing-value-to-income'
ok = True


def check(cond, what):
    global ok
    print(('  ok   ' if cond else '  FAIL ') + what)
    ok = ok and bool(cond)


class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=str(ROOT), **k)

    def log_message(self, *a):
        pass


socketserver.TCPServer.allow_reuse_address = False
srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), H)
port = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()
base = f'http://127.0.0.1:{port}'
try:
    with sync_playwright() as pw:
        b = pw.chromium.launch(channel='chrome')
        for tag, opts in (('desktop', dict(viewport={'width': 1280, 'height': 900})), ('phone', dict(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True))):
            ctx = b.new_context(**opts)
            page = ctx.new_page()
            errors, icon = [], []
            page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
            page.on('pageerror', lambda e: errors.append(str(e)))
            page.on('response', lambda r: icon.append((r.status, r.url)) if 'favicon' in r.url else None)
            page.goto(base + URL_PATH, wait_until='load')
            page.wait_for_selector('h1')
            page.wait_for_timeout(800)
            text = page.inner_text('main')
            check('DRAFT: How Many Years of Income Is a Home Worth?' in page.inner_text('h1'), f'[{tag}] the DRAFT title is the page heading')
            check(page.locator('.film-slot').count() == 1 and page.locator('video').count() == 0, f'[{tag}] an empty video slot, no video element')
            check('How to read this' in text and 'Hatched grey' in text, f'[{tag}] the how-to-read block is there, with the hatched grey line')
            check(page.locator('svg.film-chart rect').count() == 4 and '4.6%' in page.locator('svg.film-chart').text_content() and 'pending the R2 recheck' in text, f'[{tag}] the chart has four bars with the four shares and says pending')
            check('Sources and method' in text and 'B25077' in text and page.locator('a[href="https://api.census.gov/data/2024/acs/acs5"]').count() == 1, f'[{tag}] the sources block cites the ACS tables and links the Census')
            check(not page.evaluate('document.documentElement.scrollWidth > visualViewport.width + 1'), f'[{tag}] no sideways scroll')
            check(not errors, f'[{tag}] no console errors {errors[:2]}')
            check(not [x for x in icon if x[0] >= 400], f'[{tag}] the favicon is served without a 404 ({icon[:1]})')
            page.screenshot(path=str(OUT / f'{tag}.png'), full_page=True)
            ctx.close()
        b.close()
    # headless Firefox: the installed one, a throwaway profile on D:, a screenshot only (it cannot click)
    if Path(FF).is_file():
        for tag, (w, h) in (('desktop', (1280, 900)), ('phone', (390, 844))):
            prof = Path(tempfile.mkdtemp(prefix='ffprof-', dir='D:/Ryagram-scratch/WEB/temp'))
            png = OUT / f'firefox-{tag}.png'
            if png.exists():
                png.unlink()
            p = subprocess.Popen([FF, '--headless', '--no-remote', '-profile', str(prof), '--window-size', f'{w},{h}', '--screenshot', str(png), base + URL_PATH], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            try:
                p.communicate(timeout=90)
            except subprocess.TimeoutExpired:
                subprocess.run(['taskkill', '/PID', str(p.pid), '/T', '/F'], capture_output=True)
            check(png.exists() and png.stat().st_size > 20000, f'[firefox {tag}] headless Firefox photographed the page ({png.stat().st_size if png.exists() else 0} bytes)')
            import shutil
            shutil.rmtree(prof, ignore_errors=True)
finally:
    srv.shutdown()
print('RESULT:', 'PASS' if ok else 'FAIL')
sys.exit(0 if ok else 1)
