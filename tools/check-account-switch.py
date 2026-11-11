"""Per-account switch (Q576) in real Chrome, LOCAL server only, mock mode: with `myFilms: 'account'` in a local config copy, the My films link and page show only when the person's own list names myFilms (the mock returns ['myFilms']); with ?noswitches (empty list) and ?switcherr (the list fails) they do not, and with myFilms false they do not. No page errors.   python tools/check-account-switch.py"""
import http.server, re, socketserver, threading
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT = Path(__file__).resolve().parents[1]
class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=str(ROOT), **k)
    def log_message(self, *a): pass
    def end_headers(self): self.send_header('Cache-Control', 'no-store'); super().end_headers()
srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
base = (ROOT / 'assets/ryagram-config.js').read_text(encoding='utf-8')
def cfg(v): return re.sub(r'\bmyFilms:\s*false', 'myFilms: ' + v, base)
ok = True
def check(c, w):
    global ok
    print(('  ok   ' if c else '  FAIL ') + w); ok = ok and bool(c)
with sync_playwright() as pw:
    b = pw.chromium.launch(channel='chrome')
    def my_films(value, q):
        ctx = b.new_context(viewport={'width': 1100, 'height': 900}); ctx.route(re.compile(r'https://fonts\..*'), lambda r, _q: r.abort())
        ctx.route('**/assets/ryagram-config.js*', lambda r, _q: r.fulfill(status=200, content_type='text/javascript', body=cfg(value)))
        p = ctx.new_page(); errs = []; p.on('pageerror', lambda e: errs.append(str(e)))
        p.goto(f'http://127.0.0.1:{srv.server_address[1]}/app/?mock{q}#/films'); p.wait_for_timeout(2500)
        link = p.evaluate("[...document.querySelectorAll('a')].some(a => a.textContent.trim() === 'My films' && a.getAttribute('href') === '#/films')")
        body = p.inner_text('body'); ctx.close(); return link, body, errs
    l, body, e = my_films("'account'", '');            check(l, "'account' and the list names myFilms: My films shows"); check(not e, f'no page errors {e[:1]}')
    l, _, e = my_films("'account'", '&noswitches');   check(not l, "'account' and an empty list: no My films")
    l, _, e2 = my_films("'account'", '&switcherr');   check(not l and not e2, "'account' and the list fails: no My films, no page error")
    l, _, _ = my_films('false', '');                  check(not l, 'false: no My films, whatever the list says')
    l, _, _ = my_films('true', '&noswitches');        check(l, 'true: everyone, even with an empty list')
    b.close()
srv.shutdown(); print('ALL OK' if ok else 'FAILED'); raise SystemExit(0 if ok else 1)
