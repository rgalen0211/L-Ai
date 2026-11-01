"""The two landing-page DRAFT pages (song films, compilations) in real Chrome (NEXT-WEB 193), LOCAL server only, desktop and phone: with the switch off (as shipped) each says only that it is not available; with landingDrafts on
(a local config copy) the draft shows with its banner and its marked sentences; the marks are visible (not hidden by the page's styles); no sideways scroll at 320 px; the page has one h1; no console errors.
Needs Chrome.   python tools/check-landing-drafts.py"""
import http.server, re, socketserver, sys, threading
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
PORT = 8320


class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=str(ROOT), **k)
    def log_message(self, *a): pass
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store'); super().end_headers()


socketserver.TCPServer.allow_reuse_address = True
srv = socketserver.ThreadingTCPServer(('127.0.0.1', PORT), H)
threading.Thread(target=srv.serve_forever, daemon=True).start()
base = (ROOT / 'assets/ryagram-config.js').read_text(encoding='utf-8')
on_cfg = re.sub(r'landingDrafts:\s*false', 'landingDrafts: true', base)
ok = True


def check(c, w):
    global ok
    print(('  ok   ' if c else '  FAIL ') + w); ok = ok and bool(c)


with sync_playwright() as pw:
    b = pw.chromium.launch(channel='chrome')
    for name, opts in (('desktop', dict(viewport={'width': 1200, 'height': 900})), ('phone', dict(viewport={'width': 320, 'height': 700}, device_scale_factor=2, is_mobile=True, has_touch=True))):
        print(name)
        for page_name in ('song-films', 'compilations'):
            for label, cfg in (('off', base), ('on', on_cfg)):
                ctx = b.new_context(**opts)
                ctx.route(re.compile(r'https://fonts\.(googleapis|gstatic)\.com/.*'), lambda r, _q: r.abort())
                ctx.route('**/assets/ryagram-config.js*', lambda r, _q, c=cfg: r.fulfill(status=200, content_type='text/javascript', body=c))
                p = ctx.new_page(); errs = []
                p.on('pageerror', lambda e: errs.append(str(e))); p.on('console', lambda m: errs.append(m.text) if m.type == 'error' and 'Failed to load resource' not in m.text else None)
                p.goto(f'http://127.0.0.1:{PORT}/landing-drafts/{page_name}/', wait_until='domcontentloaded'); p.wait_for_timeout(500)
                text = p.inner_text('main')
                if label == 'off':
                    check(text.strip() == 'This page is not available yet.', f'{page_name}, switch off: only "not available" shows')
                else:
                    check('DRAFT.' in text and p.locator('mark:visible').count() >= 5, f'{page_name}, switch on: the draft and its {p.locator("mark:visible").count()} marked sentences show')
                    check(p.locator('h1:visible').count() == 1, f'{page_name}: one heading')
                    check('This page is not available yet' not in text, f'{page_name}: the not-available line is gone')
                    check(p.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth'), f'{page_name}: no sideways scroll')
                check(not errs, f'{page_name} {label}: no console errors' + (f': {errs[:2]}' if errs else ''))
                ctx.close()
    b.close()
srv.shutdown()
print('ALL OK' if ok else 'FAILED'); sys.exit(0 if ok else 1)
