"""Full-page screenshots of every static page of the site (local server on 127.0.0.1 only, real Chrome), at 1280 and 390 px, light and dark colour scheme, into a folder. Used for the before and after of the
website look (WEB, 2026-11-15). Nothing is sent anywhere; fonts from outside are blocked so a shot never waits on them.

    python tools/shoot-pages.py <folder> [name-filter]
"""
import http.server, re, socketserver, sys, threading
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(sys.argv[1]); OUT.mkdir(parents=True, exist_ok=True)
ONLY = sys.argv[2] if len(sys.argv) > 2 else ''
PAGES = ['', 'ryagram/', 'help/', 'connect-ai/', 'get-app/', 'report/', 'film/', 'terms/', 'privacy-policy.html', 'workflow-audit/', 'workflow-audit-thanks.html', 'thank-you.html', '404.html',
         'ai-content/', 'game-phone/', 'game-tv/', 'geo-demo/', 'preview-demo/', 'landing-drafts/compilations/', 'landing-drafts/song-films/', 'legal-drafts/terms.html', 'legal-drafts/privacy-policy.html']


class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=str(ROOT), **k)
    def log_message(self, *a): pass
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store'); super().end_headers()


srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), H)
PORT = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()
with sync_playwright() as pw:
    b = pw.chromium.launch(channel='chrome')
    for path in PAGES:
        slug = re.sub(r'[^a-z0-9]+', '-', (path or 'home').lower()).strip('-')
        if ONLY and ONLY not in slug: continue
        for size, vp in (('1280', {'width': 1280, 'height': 900}), ('390', {'width': 390, 'height': 844})):
            for scheme in ('light', 'dark'):
                ctx = b.new_context(viewport=vp, color_scheme=scheme, is_mobile=(size == '390'))
                ctx.route(re.compile(r'https://fonts\.(googleapis|gstatic)\.com/.*'), lambda r, _q: r.abort())
                p = ctx.new_page()
                try:
                    p.goto(f'http://127.0.0.1:{PORT}/{path}', wait_until='load', timeout=20000); p.wait_for_timeout(500)
                    p.screenshot(path=str(OUT / f'{slug}-{size}-{scheme}.png'), full_page=True)
                except Exception as e:
                    print('FAILED', path, size, scheme, str(e)[:100])
                ctx.close()
        print('shot', slug)
    b.close()
srv.shutdown(); srv.server_close()
