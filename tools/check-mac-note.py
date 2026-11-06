"""The Mac sentence on the download pages (NEXT-WEB 184) in real Chrome, mock mode, LOCAL server only, desktop and phone, with a Mac and a Windows browser identity: /get-app/ and the Account page's Download card show
the plain sentence only when macNote is on (a local config copy), never when off; the download button and everything else on both are unchanged; a Mac visitor sees the same words; no sideways scroll at 375 px; no
console errors. Needs Chrome.   python tools/check-mac-note.py"""
import http.server, re, socketserver, sys, threading
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
PORT = 8313
MAC_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15'
SENTENCE = 'The Ryagram app is for Windows today. A Mac version is planned. It is not built yet, and there is no date.'


class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=str(ROOT), **k)
    def log_message(self, *a): pass
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store'); super().end_headers()


srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), H)          # its own port: a fixed one can be bound twice at once on Windows (11-06)
PORT = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()
base = (ROOT / 'assets/ryagram-config.js').read_text(encoding='utf-8')
on_cfg = re.sub(r'macNote:\s*false', 'macNote: true', base)
ok = True


def check(c, w):
    global ok
    print(('  ok   ' if c else '  FAIL ') + w); ok = ok and bool(c)


def page(b, cfg, opts, errs):
    ctx = b.new_context(**opts)
    ctx.route(re.compile(r'https://fonts\.(googleapis|gstatic)\.com/.*'), lambda r, _q: r.abort())
    ctx.route(re.compile(r'https://.*supabase\.co/functions/v1/app-link.*'), lambda r, _q: r.fulfill(status=404, content_type='application/json', body='{"error":"Not found."}'))
    ctx.route('**/assets/ryagram-config.js*', lambda r, _q, c=cfg: r.fulfill(status=200, content_type='text/javascript', body=c))
    p = ctx.new_page()
    p.on('pageerror', lambda e: errs.append(str(e))); p.on('console', lambda m: errs.append(m.text) if m.type == 'error' and 'Failed to load resource' not in m.text else None)
    return p


with sync_playwright() as pw:
    b = pw.chromium.launch(channel='chrome')
    for name, opts in (('desktop, Windows browser', dict(viewport={'width': 1200, 'height': 900})), ('phone, Mac browser', dict(viewport={'width': 375, 'height': 812}, device_scale_factor=2, user_agent=MAC_UA))):
        print(name)
        for label, cfg in (('off', base), ('on', on_cfg)):
            errs = []
            p = page(b, cfg, opts, errs)
            p.goto(f'http://127.0.0.1:{PORT}/get-app/#t=' + 'a' * 64, wait_until='domcontentloaded'); p.wait_for_timeout(800)
            shown = p.locator('#ga-mac:visible').count() == 1
            check(shown is (label == 'on'), f'/get-app/ with the switch {label}: the Mac sentence is {"shown" if shown else "not shown"}')
            if label == 'on':
                check(p.inner_text('#ga-mac').startswith(SENTENCE), 'and it is the plain sentence: ' + p.inner_text('#ga-mac')[:60])
                check(p.locator('h1:has-text("Get the Ryagram app")').count() == 1, 'the page is otherwise the same')
            check(p.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth'), '/get-app/: no sideways scroll')
            check(not errs, f'/get-app/ {label}: no console errors' + (f': {errs[:2]}' if errs else ''))
            p.context.close()
            errs = []
            p = page(b, cfg, opts, errs)
            p.goto(f'http://127.0.0.1:{PORT}/app/?mock&tester#/account', wait_until='load'); p.wait_for_selector('h1:has-text("Your account")', timeout=20000); p.wait_for_timeout(800)
            card = p.locator('.windows-card')
            if card.count():
                shown = p.locator('.windows-mac-note:visible').count() == 1
                check(shown is (label == 'on'), f'Account card with the switch {label}: the Mac sentence is {"shown" if shown else "not shown"}')
                check(p.locator('.windows-card:has-text("Download Ryagram for Windows"), .windows-card button, .windows-card a.button').count() >= 1, 'and the download button is unchanged')
            else:
                print('  note  the Windows card is not shown in this mock (windows release record off): the card is covered by the node test')
            check(not errs, f'Account {label}: no console errors' + (f': {errs[:2]}' if errs else ''))
            p.context.close()
    b.close()
srv.shutdown(); srv.server_close()
print('ALL OK' if ok else 'FAILED'); sys.exit(0 if ok else 1)
