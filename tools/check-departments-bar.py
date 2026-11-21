"""EVERY signed-in account can steer to every department by hand (CLAUDE 11-20 06:25, Ryan's live walk: an admin page with Admin, Help, Account and no way to Games). Real Chrome, mock mode, LOCAL server only, desktop 1280 and phone 390.
Four accounts: an invited account, a NOT invited one (an administrator never is: ?noinvite), an account whose my_departments() fails (?nodept), and both together. Each shows the Departments bar with all six
departments, reachable by clicking (Data films opens, the other five are Coming soon pages with their tag), the bar stays on other signed-in pages (account, tutorial, your look, help), the Start door only for the invited
account, and 'Your projects' carries a Departments row of six cards that link the same pages, with no sideways scroll on a phone.   Needs Chrome.   python tools/check-departments-bar.py [outdir]"""
import http.server, re, socketserver, sys, threading
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('D:/Ryagram-scratch/WEB/dept-bar-shots')
IDS = ['data_films', 'compilations', 'geo_intelligence', 'games', 'animation_studio', 'studio', 'forecasts']
LABELS = {'forecasts': 'Forecasts', 'data_films': 'Data films', 'compilations': 'Compilations', 'geo_intelligence': 'Perfect City', 'games': 'Games', 'animation_studio': 'Animation Studio', 'studio': 'Studio'}


class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=str(ROOT), **k)
    def log_message(self, *a): pass
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store'); super().end_headers()


srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), H)
PORT = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()
cfg = (ROOT / 'assets/ryagram-config.js').read_text(encoding='utf-8')
ok = True


def check(c, w):
    global ok
    print(('  ok   ' if c else '  FAIL ') + w); ok = ok and bool(c)


ACCOUNTS = [('invited', '?mock&aiconnected', True), ('not invited (admin)', '?mock&noinvite', False), ('my_departments fails', '?mock&aiconnected&nodept', True), ('not invited and fails', '?mock&noinvite&nodept', False)]

with sync_playwright() as pw:
    b = pw.chromium.launch(channel='chrome')
    OUT.mkdir(parents=True, exist_ok=True)
    for dev, opts, phone in (('desktop', dict(viewport={'width': 1280, 'height': 900}), False), ('phone', dict(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True), True)):
        for who, q, invited in ACCOUNTS:
            tag = f'{dev}, {who}'
            print(tag)
            ctx = b.new_context(**opts); errs = []
            ctx.route('**/assets/ryagram-config.js*', lambda r, _q: r.fulfill(status=200, content_type='text/javascript', body=cfg))
            p = ctx.new_page()
            p.on('pageerror', lambda e: errs.append(str(e))); p.on('console', lambda m: errs.append(m.text) if m.type == 'error' and 'Failed to load resource' not in m.text and 'status of 404' not in m.text else None)
            p.goto(f'http://127.0.0.1:{PORT}/app/{q}#/', wait_until='load'); p.wait_for_selector('.dept-bar', state='attached', timeout=20000); p.wait_for_selector('.dept-card', timeout=20000)
            hrefs = p.evaluate("[...document.querySelectorAll('.dept-bar a')].map(a => a.getAttribute('href'))")
            check(all(f'#/d/{i}' in hrefs for i in IDS), f'{tag}: the bar links all seven departments')
            check((('#/start' in hrefs) == invited), f'{tag}: the Start door is {"there" if invited else "absent"}')
            cards = p.evaluate("[...document.querySelectorAll('.dept-card a')].map(a => a.getAttribute('href'))")
            check(cards == [f'#/d/{i}' for i in IDS], f'{tag}: the Departments row on Your projects has seven cards in order ({cards})')
            check(p.locator('.dept-card-open').count() == 1 and p.locator('.dept-card .soon-tag').count() == 6, f'{tag}: one card Open, six soon')
            check(p.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth'), f'{tag}: no sideways scroll')
            check(p.evaluate("[...document.querySelectorAll('.dept-card a')].every(a => a.getBoundingClientRect().height >= 24)"), f'{tag}: every card link is at least 24 px tall')
            if who == 'invited' or who == 'not invited (admin)':
                p.screenshot(path=str(OUT / f'{dev}-{who.split()[0]}-projects.png'), full_page=True)
            for i in IDS:                                                                   # reach each department by clicking its card
                p.goto(f'http://127.0.0.1:{PORT}/app/{q}#/', wait_until='load'); p.wait_for_selector('.dept-card', timeout=20000)
                _t = p.locator('.flip-tab:has-text("Departments")')
                if _t.count(): _t.click(); p.wait_for_timeout(600)          # the department cards are the Departments section of the home page
                p.locator(f'.dept-card a[href="#/d/{i}"]').click(); p.wait_for_selector('h1:visible', timeout=15000); p.wait_for_timeout(500)
                h1 = p.locator('h1:visible').first.inner_text(); body = p.inner_text('#app, main, body')
                good = LABELS[i].lower() in h1.lower() and (('coming soon' in body.lower()) if i != 'data_films' else ('your data films' in body.lower()))
                check(good and 'isn’t available' not in body, f'{tag}: the card for {LABELS[i]} opens its page ({h1!r})')
            for path, word in (('#/account', 'Account'), ('#/build', ''), ('#/looks', ''), ('#/help', '')):      # the bar stays on other signed-in pages
                p.goto(f'http://127.0.0.1:{PORT}/app/{q}{path}', wait_until='load'); p.wait_for_timeout(1200)
                check(p.locator('.dept-bar').count() == 1, f'{tag}: the bar is on {path}')
            check(not errs, f'{tag}: no console errors' + (f' {errs[:2]}' if errs else ''))
            ctx.close()
    b.close()
srv.shutdown(); srv.server_close()
print('ALL OK' if ok else 'FAILED'); sys.exit(0 if ok else 1)
