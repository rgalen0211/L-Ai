"""The Admin link in the top bar and the one Admin page (NEXT-WEB 159; WEB 11-20 replaced the dropdown) in real Chrome, mock mode, desktop and phone: an admin account gets an 'Admin' menu with a link to every admin page that is switched on and to the normal
pages, each link opens its page, the menu closes on a choice and on Escape, the links are tall enough to tap, nothing scrolls sideways; a non-admin account gets nothing new. Needs Chrome.

    python tools/check-admin-nav.py [outdir]        (default D:/Ryagram-scratch/WEB/admin-nav-shots)
"""
import http.server, socketserver, sys, threading
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('D:/Ryagram-scratch/WEB/admin-nav-shots')
PORT = 8298
OUT.mkdir(parents=True, exist_ok=True)


class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=str(ROOT), **k)
    def log_message(self, *a): pass


srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), H)          # its own port: a fixed one can be bound twice at once on Windows (flaky goto/ECONNREFUSED, 11-06)
PORT = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()
ok = True


def check(c, w):
    global ok
    print(('  ok   ' if c else '  FAIL ') + w); ok = ok and bool(c)


PAGES = [('Operations and invites', '#/admin/ops'), ('Waiting list', '#/admin/waiting'), ('Waitlist by film', '#/admin/waitlist'), ('Visits and signups', '#/admin/visits'), ('Funnel by day', '#/admin/funnel'),
         ('Render approvals', '#/admin/renders'), ('Tester computers and Connect an AI', '#/admin/tester')]
with sync_playwright() as pw:
    b = pw.chromium.launch(channel='chrome')
    for name, opts in (('desktop', dict(viewport={'width': 1280, 'height': 900})), ('phone', dict(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True))):
        print(name)
        ctx = b.new_context(**opts); p = ctx.new_page(); errs = []
        p.on('pageerror', lambda e: errs.append(str(e)))
        p.goto(f'http://127.0.0.1:{PORT}/app/?mock#/account', wait_until='load')
        p.wait_for_selector('.admin-link', state='attached', timeout=15000)
        menu_btn = p.locator('button:has-text("Menu")')                      # on a phone the header's account area may sit behind the page's Menu button
        if p.locator('.admin-link').is_hidden() and menu_btn.count(): menu_btn.first.click()
        check(p.locator('.admin-link').inner_text() == 'Admin' and p.locator('.admin-link').count() == 1 and p.locator('.admin-menu').count() == 0, 'ONE plain Admin link sits in the top bar (no dropdown)')
        check(p.get_attribute('header .brand', 'href') == '#/', 'signed in, the logo takes a person to their own home (Your projects)')
        p.locator('.admin-link').click(); p.wait_for_selector('h1:has-text("Admin")', timeout=15000); p.wait_for_timeout(500)
        check(p.evaluate('location.hash') == '#/admin', 'it opens the Admin page')
        got = p.eval_on_selector_all('.site-card-link', 'els => els.map(e => [e.innerText.trim(), e.getAttribute("href")])')
        check([list(x) for x in got] == [list(x) for x in PAGES], f'the Admin page links every admin page that is switched on, in plain words ({len(got)} cards)')
        check(p.locator('.site-card .meta').count() == len(PAGES), 'each card says in a line what the page is for')
        check(min(p.eval_on_selector_all('.site-card-link', 'els => els.map(e => Math.round(e.getBoundingClientRect().height))')) >= 44, 'every Admin card link is at least 44 px tall (the tap floor)')
        p.screenshot(path=str(OUT / f'admin-page-{name}.png'), full_page=True)
        check(p.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth'), 'no sideways scroll on the Admin page')
        for label, href in PAGES:
            p.goto(f'http://127.0.0.1:{PORT}/app/?mock#/admin'); p.wait_for_selector('.site-card-link', timeout=15000)
            p.locator('.site-card-link', has_text=label).first.click(); p.wait_for_timeout(900)
            check(p.evaluate('location.hash') == href and p.locator('h1').filter(visible=True).count() >= 1 and 'Loading' not in p.inner_text('main')[:20], f'{label}: opens {href}')
        p.goto(f'http://127.0.0.1:{PORT}/app/?mock#/'); p.wait_for_selector('#np-title', timeout=15000)
        check(p.locator('.admin-links').count() == 0 and p.locator('main a[href^="#/admin"]').count() == 0, 'no admin links are left on the user page (Your projects)')
        check(not errs, 'no page errors' + (f': {errs[:2]}' if errs else ''))
        ctx.close()
        # MUST-FAIL (CC1 21:17): ONE tab, accounts switched: an admin signs out, a NON-ADMIN signs in: no Admin link left in the header; then the admin again: the link once, never twice
        ctx = b.new_context(**opts); t = ctx.new_page()
        t.goto(f'http://127.0.0.1:{PORT}/app/?mock#/account', wait_until='load'); t.wait_for_selector('.admin-link', state='attached', timeout=15000)
        check(t.locator('.admin-link').count() == 1, 'switch walk: the admin has the link')

        def sign_out_and_in(email):
            if t.locator('#sign-out').is_hidden() and t.locator('button:has-text("Menu")').count(): t.locator('button:has-text("Menu")').first.click()
            t.click('#sign-out'); t.wait_for_selector('#si-email', state='visible', timeout=15000)
            t.fill('#si-email', email); t.fill('#si-password', 'a-long-password-12'); t.click('#sign-in-form button[type=submit]'); t.wait_for_selector('#account:not([hidden])', timeout=15000); t.wait_for_timeout(1500)
        t.click('#sign-out') if False else None
        sign_out_and_in('other@example.com')
        check(t.locator('.admin-link').count() == 0, 'switch walk: the non-admin who signs in next gets NO Admin link')
        check(t.locator('header a[href^="#/admin"]').count() == 0, 'and no #/admin link anywhere in the header')
        check(t.evaluate("document.querySelector('.nav').classList.contains('has-admin')") is False, 'and the header is not left in the admin layout')
        t.goto(f'http://127.0.0.1:{PORT}/app/?mock#/admin'); t.wait_for_timeout(1500)
        check(t.locator('h1:has-text("Admin")').count() == 0, 'and a non-admin who types #/admin does not get the Admin page')
        sign_out_and_in('mock@localhost')
        check(t.locator('.admin-link').count() == 1, 'switch walk: the admin again: the link exactly once, not twice')
        ctx.close()
        # a non-admin account gets nothing new
        ctx = b.new_context(**opts); q = ctx.new_page()
        q.goto(f'http://127.0.0.1:{PORT}/app/?mock&nonadmin#/account', wait_until='load'); q.wait_for_timeout(2500)
        check(q.locator('.admin-link').count() == 0, 'a non-admin account has no Admin link')
        ctx.close()
    # the in-between widths (701 to 980 px): app.css hides the bar's header links there; the Admin link must still be visible and open the Admin page (FACES 11-20)
    for w in (720, 800, 980):
        ctx = b.new_context(viewport={'width': w, 'height': 900}); q = ctx.new_page()
        q.goto(f'http://127.0.0.1:{PORT}/app/?mock#/account', wait_until='load'); q.wait_for_selector('.admin-link', state='attached', timeout=15000); q.wait_for_timeout(800)
        check(q.locator('.admin-link').is_visible(), f'{w}px: the Admin link is visible in the bar')
        q.locator('.admin-link').click(); q.wait_for_selector('h1:has-text("Admin")', timeout=15000)
        check(q.evaluate('location.hash') == '#/admin', f'{w}px: and it opens the Admin page')
        ctx.close()
    b.close()
srv.shutdown()
print('ALL OK' if ok else 'FAILED'); sys.exit(0 if ok else 1)
