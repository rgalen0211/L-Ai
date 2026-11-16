"""Screenshots of the app routes that sit behind account switches (My films, #/new, the tester start, the start page, the editors, Your look, the request page), local server on 127.0.0.1 only, real Chrome, mock mode.
A LOCAL COPY of the config turns the account switches on for the page; nothing is changed in the repo and nothing is sent. 1280 and 390 px, dark. For the website look before and after (WEB, 2026-11-15).

    python tools/shoot-app-routes.py <folder>
"""
import http.server, re, socketserver, sys, threading
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(sys.argv[1]); OUT.mkdir(parents=True, exist_ok=True)
ROUTES = ['#/', '#/films', '#/new', '#/tester-start', '#/start', '#/request', '#/looks', '#/editor/data', '#/build/sample']


class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=str(ROOT), **k)
    def log_message(self, *a): pass
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store'); super().end_headers()


srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), H)
PORT = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()
cfg = (ROOT / 'assets/ryagram-config.js').read_text(encoding='utf-8')
for k in ('intake', 'myFilms', 'testerWizard', 'liveEditor', 'departmentDetails'):
    cfg, n = re.subn(rf"\b{k}:\s*(?:false|'account')", f'{k}: true', cfg); assert n == 1, k
with sync_playwright() as pw:
    b = pw.chromium.launch(channel='chrome')
    for size, vp in (('1280', {'width': 1280, 'height': 900}), ('390', {'width': 390, 'height': 844})):
        ctx = b.new_context(viewport=vp, color_scheme='dark', is_mobile=(size == '390'))
        ctx.route(re.compile(r'https://fonts\.(googleapis|gstatic)\.com/.*'), lambda r, _q: r.abort())
        ctx.route('**/assets/ryagram-config.js*', lambda r, _q: r.fulfill(status=200, content_type='text/javascript', body=cfg))
        p = ctx.new_page()
        for route in ROUTES:
            slug = re.sub(r'[^a-z0-9]+', '-', route.lower()).strip('-') or 'home'
            try:
                p.goto(f'http://127.0.0.1:{PORT}/app/?mock{route}', wait_until='load', timeout=20000); p.wait_for_timeout(1200)
                p.evaluate("() => document.querySelectorAll('header, .mock-bar').forEach(e => { e.dataset.wasPos = e.style.position; e.style.setProperty('position', 'static', 'important'); })")
                p.screenshot(path=str(OUT / f'{slug}-{size}.png'), full_page=True)
                p.evaluate("() => document.querySelectorAll('header, .mock-bar').forEach(e => { e.style.position = e.dataset.wasPos || ''; })")
            except Exception as e:
                print('FAILED', route, size, str(e)[:100])
        ctx.close()
    b.close()
srv.shutdown(); srv.server_close()
print('done')
