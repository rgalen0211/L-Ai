"""My films and #/new after the polish (WEB 2026-11-13), real Chrome, mock mode, LOCAL server only, `intake` and `myFilms` ON in a local config copy, desktop and phone: the intake cards are left-aligned and
big enough to tap (44 px), nothing sticks out sideways, a Coming soon mark is a tag; My films' meta line has no leading dot and the page has no sideways scroll. Needs Chrome.   python tools/check-polish-films-new.py"""
import http.server, re, socketserver, sys, threading
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]


class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=str(ROOT), **k)
    def log_message(self, *a): pass
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store'); super().end_headers()


srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), H)
PORT = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()
cfg = (ROOT / 'assets/ryagram-config.js').read_text(encoding='utf-8')
for k in ('intake', 'myFilms'):
    cfg, n = re.subn(rf"\b{k}:\s*(?:false|'account')", f'{k}: true', cfg); assert n == 1
ok = True


def check(c, w):
    global ok
    print(('  ok   ' if c else '  FAIL ') + w); ok = ok and bool(c)


with sync_playwright() as pw:
    b = pw.chromium.launch(channel='chrome')
    for name, vp in (('desktop', {'width': 1200, 'height': 900}), ('phone', {'width': 390, 'height': 844})):
        print(name)
        ctx = b.new_context(viewport=vp, is_mobile=name == 'phone'); errs = []
        ctx.route('**/assets/ryagram-config.js*', lambda r, _q: r.fulfill(status=200, content_type='text/javascript', body=cfg))
        p = ctx.new_page(); p.on('pageerror', lambda e: errs.append(str(e)))
        p.goto(f'http://127.0.0.1:{PORT}/app/?mock#/new', wait_until='load'); p.wait_for_selector('.intake-choice', timeout=15000)
        check(p.evaluate("getComputedStyle(document.querySelector('.intake-choice')).textAlign") in ('left', 'start'), 'the choice cards are left-aligned')
        hs = p.evaluate("[...document.querySelectorAll('.intake-choice')].map(e => e.getBoundingClientRect().height)")
        check(min(hs) >= 44, f'every card is at least 44 px tall ({min(hs):.0f})')
        check(p.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth'), 'no sideways scroll on #/new')
        soon = p.locator('.intake-choice .intake-soon')
        check(soon.count() == 0 or p.evaluate("parseFloat(getComputedStyle(document.querySelector('.intake-choice .intake-soon')).borderRadius) > 10"), 'a Coming soon mark is a tag')
        p.screenshot(path=f'D:/Ryagram-scratch/WEB/polish-new-{name}.png', full_page=True)
        p.goto(f'http://127.0.0.1:{PORT}/app/?mock#/films', wait_until='load'); p.wait_for_selector('.film-row', timeout=15000)
        metas = p.evaluate("[...document.querySelectorAll('.film-row .meta')].map(e => e.textContent.trim())")
        check(metas and all(not m.startswith('·') and not m.endswith('·') for m in metas), f'no stray dot in the meta line ({metas[:1]})')
        check(p.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth'), 'no sideways scroll on My films')
        p.screenshot(path=f'D:/Ryagram-scratch/WEB/polish-films-{name}.png', full_page=True)
        check(not errs, 'no page errors' + (f': {errs[:1]}' if errs else ''))
        ctx.close()
    b.close()
srv.shutdown(); srv.server_close()
print('ALL OK' if ok else 'FAILED'); sys.exit(0 if ok else 1)
