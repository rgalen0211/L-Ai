"""SUPERSEDED (2026-10-16): the Interstate film is public, so the sample's poster is now a real frame of the FINAL film: its last map frame, just before the
close card fades in, taken with
    ffmpeg -ss 96.8 -i roads-interstate-final.mp4 -frames:v 1 -q:v 2 film/samples/interstate-final-frame.jpg
and the sample's data with tools/make-film-sample.mjs from the final film's sidecar and story. The text below describes the earlier way (a vector draw from the demo bundle).

Makes the sample film page's poster: the Interstate film's LAST frame (1993, 39,279 miles), drawn by the engine's own drawer from the real scene
bundle in preview-demo/, as a 1920x1080 JPEG. Needs Chrome (playwright). Not part of the node suite.

    python tools/make-film-sample-poster.py
"""
import http.server
import socketserver
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'film' / 'samples' / 'interstate-final-frame.jpg'
PORT = 8163


class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=str(ROOT), **k)

    def log_message(self, *a):
        pass


socketserver.TCPServer.allow_reuse_address = True
srv = socketserver.ThreadingTCPServer(('127.0.0.1', PORT), H)
threading.Thread(target=srv.serve_forever, daemon=True).start()
with sync_playwright() as pw:
    b = pw.chromium.launch(channel='chrome')
    page = b.new_page(viewport={'width': 2000, 'height': 1200})
    page.goto(f'http://127.0.0.1:{PORT}/preview-demo/', wait_until='load')
    page.wait_for_selector('.pv-stage', timeout=60000, state='attached')
    for _ in range(300):
        if page.evaluate('!!(window.ryagramDemo && window.ryagramDemo.viewer)'):
            break
        page.wait_for_timeout(100)
    # the whole frame as vector at full size: no cached bitmap, the stage 1920 px wide
    page.evaluate('''() => { const v = window.ryagramDemo.viewer; const st = v.stage; st.style.width = '1920px'; st.style.border = '0'; st.style.borderRadius = '0';
                              v.cache.clear(); v.setFrame(2819); }''')
    page.wait_for_timeout(1500)
    page.evaluate("document.querySelector('.pv-bitmap').hidden = true; for (const c of document.querySelectorAll('.pv-endcard')) c.remove()")   # the closing card is the demo's, not the film's
    page.locator('.pv-stage').screenshot(path=str(OUT), type='jpeg', quality=88)
    b.close()
srv.shutdown()
print('wrote', OUT, OUT.stat().st_size, 'bytes')
