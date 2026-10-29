"""The Admin menu in the top bar (NEXT-WEB 159) in real Chrome, mock mode, desktop and phone: an admin account gets an 'Admin' menu with a link to every admin page that is switched on and to the normal
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


socketserver.TCPServer.allow_reuse_address = True
srv = socketserver.ThreadingTCPServer(('127.0.0.1', PORT), H)
threading.Thread(target=srv.serve_forever, daemon=True).start()
ok = True


def check(c, w):
    global ok
    print(('  ok   ' if c else '  FAIL ') + w); ok = ok and bool(c)


PAGES = [('Operations and invites', '#/admin/ops'), ('Render approvals', '#/admin/renders'), ('Tester computers and Connect an AI', '#/admin/tester'),
         ('Waitlist by film', '#/admin/waitlist'), ('Visits and signups', '#/admin/visits'), ('Funnel by day', '#/admin/funnel'), ('All projects', '#/'), ('Account', '#/account'), ('Help', '#/help')]
with sync_playwright() as pw:
    b = pw.chromium.launch(channel='chrome')
    for name, opts in (('desktop', dict(viewport={'width': 1280, 'height': 900})), ('phone', dict(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True))):
        print(name)
        ctx = b.new_context(**opts); p = ctx.new_page(); errs = []
        p.on('pageerror', lambda e: errs.append(str(e)))
        p.goto(f'http://127.0.0.1:{PORT}/app/?mock#/account', wait_until='load')
        if name == 'phone' and p.locator('#account').is_hidden():
            pass
        p.wait_for_selector('.admin-menu', state='attached', timeout=15000)
        # on a phone the header's account area may sit behind the page's Menu button
        menu_btn = p.locator('button:has-text("Menu")')
        if p.locator('.admin-menu > summary').is_hidden() and menu_btn.count(): menu_btn.first.click()
        summ = p.locator('.admin-menu > summary')
        check(summ.inner_text() == 'Admin', 'an Admin menu sits in the top bar')
        check(p.locator('.admin-menu').count() == 1, 'exactly one')
        summ.click()
        check(p.locator('.admin-menu[open]').count() == 1, 'it opens')
        texts = p.eval_on_selector_all('.admin-menu-panel a', 'els => els.map(e => [e.innerText.trim(), e.getAttribute("href")])')
        check([t for t in texts] == [list(x) for x in PAGES], f'it links every admin page and the normal pages ({len(texts)} links)')
        heights = p.eval_on_selector_all('.admin-menu-panel a', 'els => els.map(e => Math.round(e.getBoundingClientRect().height))')
        check(min(heights) >= 44, f'every link is at least 44 px tall ({min(heights)})')
        p.screenshot(path=str(OUT / f'admin-nav-{name}.png'))
        check(p.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth'), 'no sideways scroll with the menu open')
        p.keyboard.press('Escape'); p.wait_for_timeout(200)
        check(p.locator('.admin-menu[open]').count() == 0, 'Escape closes it')
        for label, href in PAGES[:6]:
            if p.locator('.admin-menu > summary').is_hidden() and menu_btn.count(): menu_btn.first.click()
            p.locator('.admin-menu > summary').click()
            p.locator('.admin-menu-panel a', has_text=label).first.click(); p.wait_for_timeout(900)
            check(p.evaluate('location.hash') == href and p.locator('h1').filter(visible=True).count() >= 1 and 'Loading' not in p.inner_text('main')[:20], f'{label}: opens {href}')
            check(p.locator('.admin-menu[open]').count() == 0, f'{label}: the menu closed on the choice')
        check(not errs, 'no page errors' + (f': {errs[:2]}' if errs else ''))
        ctx.close()
        # MUST-FAIL (CC1 21:17): ONE tab, accounts switched: an admin signs out, a NON-ADMIN signs in: no Admin menu and no #/admin link left in the header; then the admin again: the menu once, never twice
        ctx = b.new_context(**opts); t = ctx.new_page()
        t.goto(f'http://127.0.0.1:{PORT}/app/?mock#/account', wait_until='load'); t.wait_for_selector('.admin-menu', state='attached', timeout=15000)
        check(t.locator('.admin-menu').count() == 1, 'switch walk: the admin has the menu')

        def sign_out_and_in(email):
            if t.locator('#sign-out').is_hidden() and t.locator('button:has-text("Menu")').count(): t.locator('button:has-text("Menu")').first.click()
            t.click('#sign-out'); t.wait_for_selector('#si-email', state='visible', timeout=15000)
            t.fill('#si-email', email); t.fill('#si-password', 'a-long-password-12'); t.click('#sign-in-form button[type=submit]'); t.wait_for_selector('#account:not([hidden])', timeout=15000); t.wait_for_timeout(1500)
        sign_out_and_in('other@example.com')
        check(t.locator('.admin-menu').count() == 0, 'switch walk: the non-admin who signs in next gets NO Admin menu')
        check(t.locator('header a[href^="#/admin"]').count() == 0, 'and no #/admin link anywhere in the header')
        check(t.evaluate("document.querySelector('.nav').classList.contains('has-admin')") is False, 'and the header is not left in the admin layout')
        sign_out_and_in('mock@localhost')
        check(t.locator('.admin-menu').count() == 1, 'switch walk: the admin again: the menu exactly once, not twice')
        t.keyboard.press('Escape'); t.locator('.admin-menu > summary').click(); t.locator('.admin-menu-panel a', has_text='Account').first.click(); t.wait_for_timeout(300)
        check(t.locator('.admin-menu[open]').count() == 0, 'switch walk: the menu still works after the switch')
        ctx.close()
        # a non-admin account gets nothing new
        ctx = b.new_context(**opts); q = ctx.new_page()
        q.goto(f'http://127.0.0.1:{PORT}/app/?mock&nonadmin#/account', wait_until='load'); q.wait_for_timeout(2500)
        check(q.locator('.admin-menu').count() == 0, 'a non-admin account has no Admin menu')
        ctx.close()
    b.close()
srv.shutdown()
print('ALL OK' if ok else 'FAILED'); sys.exit(0 if ok else 1)
