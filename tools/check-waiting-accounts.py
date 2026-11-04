"""Option B pages in real Chrome, mock mode, LOCAL server only (NEXT-WEB waiting pages): a WAITING account sees only "You are on the list" at any address; a wrong code is refused in words and a right one opens the library;
a failed access check also draws the waiting page (fail closed); Create an account (Q378 A: email only, a bad address refused, then the join answer; "not open yet" while the switch is off);
Ryan's #/admin/waiting lists them and approves only a CONFIRMED address; a non-admin gets no list; no sideways scroll at 1200, 375 and 320 px; no console errors.
    python tools/check-waiting-accounts.py [SCREENSHOT_FOLDER]      (default: a new folder in the system temp, so nobody's pictures are overwritten)"""
import http.server, re, socketserver, sys, tempfile, threading
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
PORT = 8321
SHOTS = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(tempfile.mkdtemp(prefix='waiting-shots-')); SHOTS.mkdir(parents=True, exist_ok=True)
print(f'screenshots: {SHOTS}')


class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=str(ROOT), **k)
    def log_message(self, *a): pass
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store'); super().end_headers()


socketserver.TCPServer.allow_reuse_address = True
srv = socketserver.ThreadingTCPServer(('127.0.0.1', PORT), H)
threading.Thread(target=srv.serve_forever, daemon=True).start()
ok = True


def check(c, w):
    global ok
    print(('  ok   ' if c else '  FAIL ') + w); ok = ok and bool(c)


def page(b, opts, errs):
    ctx = b.new_context(**opts)
    ctx.route(re.compile(r'https://fonts\.(googleapis|gstatic)\.com/.*'), lambda r, _q: r.abort())
    p = ctx.new_page()
    p.on('pageerror', lambda e: errs.append(str(e))); p.on('console', lambda m: errs.append(m.text) if m.type == 'error' and 'Failed to load resource' not in m.text else None)
    p.on('dialog', lambda d: d.accept())
    return p


def go(p, q, h='#/'):
    p.goto(f'http://127.0.0.1:{PORT}/app/?mock{q}{h}', wait_until='load'); p.wait_for_selector('#library:not([hidden]) h1, #sign-in:not([hidden]) h1, #create-account:not([hidden]) h1', timeout=20000); p.wait_for_timeout(400)


def h1(p): return p.locator('#library h1').first.inner_text()


def noscroll(p): return p.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth')


with sync_playwright() as pw:
    b = pw.chromium.launch(channel='chrome')
    for name, opts in (('desktop', dict(viewport={'width': 1200, 'height': 900})), ('phone375', dict(viewport={'width': 375, 'height': 812}, device_scale_factor=2, is_mobile=True, has_touch=True)),
                       ('phone320', dict(viewport={'width': 320, 'height': 700}, device_scale_factor=2, is_mobile=True, has_touch=True))):
        print(name)
        errs = []
        p = page(b, opts, errs)
        # a waiting account
        go(p, '&waiting')
        check(h1(p) == 'You are on the list', 'a waiting account lands on "You are on the list"')
        check('We will email you when your access opens.' in p.inner_text('#library'), 'it says the access email is coming')
        check(noscroll(p), 'no sideways scroll')
        p.screenshot(path=str(SHOTS / f'waiting-{name}.png'), full_page=True)
        check(p.locator('.dept-slot:visible').count() == 0 and p.locator('.admin-menu:visible').count() == 0, 'no department or admin menu is drawn')
        check(p.locator('#library a[href^="#/p/"], #library a[href="#/credits"], #library a[href="#/new"]').count() == 0, 'no project, credits or new-film links')
        for hh in ('#/credits', '#/account', '#/new', '#/admin/waiting', '#/p/00000000-0000-4000-8000-000000000001'):
            p.evaluate(f"location.hash='{hh}'"); p.wait_for_timeout(500)
            check(h1(p) == 'You are on the list', f'{hh} still shows only the waiting page')
        # wrong then right code
        p.fill('#wt-code', 'NOPE-NOPE'); p.click('#library form >> nth=0 >> button'); p.wait_for_timeout(400)
        check('isn’t valid' in p.inner_text('#library') or "isn't valid" in p.inner_text('#library'), 'a wrong code is refused in words')
        check(h1(p) == 'You are on the list', 'and the account stays waiting')
        p.fill('#wt-code', 'RYA-TEST-CODE'); p.click('#library form >> nth=0 >> button'); p.wait_for_timeout(900)
        check(h1(p) != 'You are on the list', 'a valid code opens the library')
        # fail closed
        go(p, '&accesserr')
        check(h1(p) == 'You are on the list', 'a failed access check draws the waiting page (fail closed)')
        # an ACTIVE account is untouched
        go(p, '')
        check(h1(p) != 'You are on the list', 'an active account sees the library')
        # admin list and approve
        p.evaluate("location.hash='#/admin/waiting'"); p.wait_for_timeout(600)
        check(h1(p) == 'Waiting list' and p.locator('#library .wl-row').count() == 2, 'Ryan sees two waiting accounts')
        check(p.locator('#library .wl-row >> nth=1 >> button').count() == 0 and 'not confirmed yet' in p.locator('#library .wl-row').nth(1).inner_text(), 'an unconfirmed address has no Approve button and says so')
        p.screenshot(path=str(SHOTS / f'admin-{name}.png'), full_page=True)
        p.click('#library .wl-row >> nth=0 >> button'); p.wait_for_timeout(500)
        check(p.locator('#library .wl-row').count() == 1 and 'is approved' in p.inner_text('#library'), 'approving the confirmed one removes it from the list and says so')
        p.evaluate("location.hash='#/admin/ops'"); p.wait_for_timeout(900)
        check('Waiting list (1)' in p.inner_text('#library') and 'Open the waiting list to approve' in p.inner_text('#library'), '#/admin/ops shows the waiting list count and the way to approve')
        go(p, '&nonadmin', '#/admin/waiting')
        check(h1(p) != 'Waiting list', 'a non-admin does not get the list')
        # create an account, signed out
        go(p, '')
        p.click('text=Sign out'); p.wait_for_selector('#sign-in:not([hidden])', timeout=8000)
        check(p.locator('#create-link').is_visible(), 'the sign-in page offers "Create an account"')
        p.click('#create-link'); p.wait_for_selector('#create-account:not([hidden])', timeout=5000)
        check(p.evaluate("document.activeElement.id") == 'create-account-title', 'focus moves to the new page title')
        check(noscroll(p), 'create page: no sideways scroll')
        p.screenshot(path=str(SHOTS / f'create-{name}.png'), full_page=True)
        check(p.locator('#create-account input[type=password]').count() == 0, 'no password box on the sign-up page (chosen from the emailed link)')
        p.evaluate("document.getElementById('create-account-form').noValidate = true")
        p.fill('#ca-email', 'nope'); p.click('#create-account-form button'); p.wait_for_timeout(200)
        check('email address' in p.inner_text('#create-account-error'), 'a bad address is refused in words')
        p.fill('#ca-email', 'new.person@example.com'); p.click('#create-account-form button'); p.wait_for_timeout(400)
        check('on its way' in p.inner_text('#create-account-note') and p.locator('#create-account-error').is_hidden(), 'join answers with the same "link is on its way" words')
        go(p, '&joinoff', '#/')
        if p.locator('text=Sign out').count(): p.click('text=Sign out'); p.wait_for_selector('#sign-in:not([hidden])', timeout=8000)
        p.click('#create-link'); p.wait_for_selector('#create-account:not([hidden])', timeout=5000)
        p.fill('#ca-email', 'later.person@example.com'); p.click('#create-account-form button'); p.wait_for_timeout(400)
        check('not open yet' in p.inner_text('#create-account-error'), 'while the switch is off, join says "not open yet" and points to the waitlist')
        check(not errs, f'no console errors {errs[:2]}')
        p.context.close()
    b.close()
srv.shutdown()
print('PASS' if ok else 'FAILED'); sys.exit(0 if ok else 1)
