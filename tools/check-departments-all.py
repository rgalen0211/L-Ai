"""Ryan 11-20 11:01: a new user must reach EVERY department's page, and every department that is not launch-ready must have a Coming soon page. Real Chrome, mock mode, LOCAL server only, desktop 1280 and phone 390,
for an invited account, a not-invited one (an administrator never is), a non-admin account and one whose my_departments() fails. For each of the seven departments (Data films, Compilations, Perfect City, Games,
Animation Studio, Studio, Forecasts) the page is opened BOTH from the top bar (on a phone through the Menu) and from its card on Your projects and must show its own heading, never the home page, a blank or the 'isn't
available' page; Data films is the working page, the six others are Coming soon pages with the tag and either the 'Tell me when it's ready' button or (Forecasts, which the server does not name yet) the plain
'Nothing to sign up for yet' line; with ?deptforecasts the server names Forecasts and it gets the button too.   Needs Chrome.   python tools/check-departments-all.py [outdir]"""
import http.server, re, socketserver, sys, threading
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('D:/Ryagram-scratch/WEB/dept-all-shots')
DEPTS = [('data_films', 'Data films'), ('compilations', 'Compilations'), ('geo_intelligence', 'Perfect City'), ('games', 'Games'), ('animation_studio', 'Animation Studio'), ('studio', 'Studio'), ('forecasts', 'Forecasts')]


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


ACCOUNTS = [('invited', '?mock&aiconnected'), ('admin, not invited', '?mock&noinvite'), ('non-admin', '?mock&nonadmin&aiconnected'), ('list fails', '?mock&noinvite&nodept')]


def judge(p, tag, did, label, how):
    p.wait_for_selector('h1:visible', timeout=15000); p.wait_for_timeout(600)
    h1 = p.locator('h1:visible').first.inner_text(); body = p.inner_text('main')
    here = p.evaluate('location.hash')
    check(here == f'#/d/{did}' and label.lower() in h1.lower() and 'Your projects' not in h1 and 'isn’t available' not in body, f'{tag}: {label} from the {how} opens its own page ({h1!r}, {here})')
    if did == 'data_films':
        check('your data films' in body.lower(), f'{tag}: {label} is the working page')
        notinv = '&noinvite' in p.url                                  # dead-end sweep row 1 (11-21): the AI heading and its #/start link only for an account #/start works for
        starts = p.locator('main a[href="#/start"]').count()
        check((starts == 0 and 'start one in your ai' not in body.lower()) if notinv else ('start one in your ai' in body.lower()), f'{tag}: {label} shows the way into #/start only to an invited account ({starts} link(s))')
    else:
        want = ('tell me when it’s ready' in body.lower()) if did != 'forecasts' or '&deptforecasts' in p.url else ('nothing to sign up for yet' in body.lower())
        check('coming soon' in body.lower() and want, f'{tag}: {label} is a Coming soon page with {"its sign-up button" if did != "forecasts" or "&deptforecasts" in p.url else "the plain no-sign-up line"}')
    check(len(body.strip()) > 80, f'{tag}: {label} is not a blank page')


with sync_playwright() as pw:
    b = pw.chromium.launch(channel='chrome')
    OUT.mkdir(parents=True, exist_ok=True)
    for dev, opts, phone in (('desktop', dict(viewport={'width': 1280, 'height': 900}), False), ('phone', dict(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True), True)):
        for who, q in ACCOUNTS + [('forecasts named', '?mock&aiconnected&deptforecasts')]:
            tag = f'{dev}, {who}'
            print(tag)
            ctx = b.new_context(**opts); errs = []
            ctx.route('**/assets/ryagram-config.js*', lambda r, _q: r.fulfill(status=200, content_type='text/javascript', body=cfg))
            p = ctx.new_page()
            p.on('pageerror', lambda e: errs.append(str(e))); p.on('console', lambda m: errs.append(m.text) if m.type == 'error' and 'Failed to load resource' not in m.text and 'status of 404' not in m.text else None)
            for did, label in DEPTS:
                # from the card on Your projects
                p.goto(f'http://127.0.0.1:{PORT}/app/{q}#/', wait_until='load'); p.wait_for_selector('.dept-card', timeout=20000)
                p.locator(f'.dept-card a[href="#/d/{did}"]').click(); judge(p, tag, did, label, 'card')
                # from the top bar (a phone opens the Menu first; a desktop opens the Coming soon list for a Coming soon page)
                p.goto(f'http://127.0.0.1:{PORT}/app/{q}#/', wait_until='load'); p.wait_for_selector('.dept-bar', state='attached', timeout=20000)
                if phone: p.locator('.dept-menu').click()
                elif did != 'data_films': p.locator('.soon-group summary').click()
                p.locator(f'.dept-bar a[href="#/d/{did}"]').click(); judge(p, tag, did, label, 'top bar')
            p.screenshot(path=str(OUT / f'{dev}-{who.split(",")[0].replace(" ", "-")}-forecasts.png'), full_page=True) if did == 'forecasts' else None
            check(not errs, f'{tag}: no console errors' + (f' {errs[:2]}' if errs else ''))
            ctx.close()
    b.close()
srv.shutdown(); srv.server_close()
print('ALL OK' if ok else 'FAILED'); sys.exit(0 if ok else 1)
