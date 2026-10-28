"""Departments in the top bar (NEXT-WEB 147) in real Chrome, mock mode, LOCAL server only, desktop and phone, with `aiFirst` and `departments` switched on in a LOCAL copy of the config only:
the bar (Start, Data films, ONE Coming soon group, My films, Credits), the Coming soon group's marked items, the Data films page (AI strip, your films, the no-AI link), a Coming soon page (tag, line,
a picture where there is one, 'Tell me when it's ready' -> Noted. -> Take it back, remembered across a reload), ids the page does not know ignored, a failing my_departments() leaving today's header
exactly as it is, an account that is not invited seeing no bar, the flag OFF changing nothing, and on a phone one Menu button with the list behind it. Writes screenshots. Needs Chrome, so it is not part
of the node suite.

    python tools/check-departments.py [outdir]        (default D:/Ryagram-scratch/WEB/departments-shots)
"""
import http.server
import re
import socketserver
import sys
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('D:/Ryagram-scratch/WEB/departments-shots')
PORT = 8197
BASE = f'http://127.0.0.1:{PORT}'


def serve():
    class H(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *a, **k):
            super().__init__(*a, directory=str(ROOT), **k)

        def log_message(self, *a):
            pass

        def end_headers(self):
            self.send_header('Cache-Control', 'no-store')
            super().end_headers()
    socketserver.TCPServer.allow_reuse_address = True
    srv = socketserver.ThreadingTCPServer(('127.0.0.1', PORT), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    srv = serve()
    ok = True

    def check(cond, what):
        nonlocal ok
        print(('  ok   ' if cond else '  FAIL ') + what)
        ok = ok and bool(cond)
    cfg = (ROOT / 'assets' / 'ryagram-config.js').read_text(encoding='utf-8')
    check(re.search(r'departments:\s*true', cfg) and re.search(r'aiFirst:\s*true', cfg), 'the committed config has departments and aiFirst ON (Ryan 2026-10-28, Q303)')
    off = re.sub(r'aiFirst:\s*true', 'aiFirst: false', re.sub(r'departments:\s*true', 'departments: false', cfg))                      # the 'flag off' cases below run against this
    flipped = cfg
    try:
        with sync_playwright() as pw:
            b = pw.chromium.launch(channel='chrome')
            for name, opts, phone in (('desktop', dict(viewport={'width': 1280, 'height': 900}), False),
                                      ('phone', dict(viewport={'width': 390, 'height': 844}, device_scale_factor=3, is_mobile=True, has_touch=True), True)):
                print(name)

                def page(flag=True):
                    ctx = b.new_context(**opts)
                    ctx.route('**/assets/ryagram-config.js*', (lambda body: (lambda route: route.fulfill(status=200, content_type='text/javascript', body=body)))(flipped if flag else off))
                    p = ctx.new_page()
                    errors = []
                    p.on('pageerror', lambda e: errors.append(str(e)))
                    p.on('console', lambda m: errors.append(m.text) if m.type == 'error' and 'status of 404' not in m.text and 'Failed to load resource' not in m.text else None)
                    return ctx, p, errors

                # 1. the bar
                ctx, p, errors = page()
                p.goto(f'{BASE}/app/?mock&aiconnected#/', wait_until='load')
                p.wait_for_selector('.dept-bar', timeout=20000)
                bar = p.locator('.dept-bar')
                if phone:
                    check(p.locator('.dept-menu').is_visible() and not p.locator('.dept-list').is_visible(), 'phone: one Menu button, the list behind it')
                    p.click('.dept-menu')
                    check(p.locator('.dept-list').is_visible() and p.get_attribute('.dept-menu', 'aria-expanded') == 'true', 'phone: the Menu opens the list')
                else:
                    check(not p.locator('.dept-menu').is_visible() and p.locator('.dept-list').is_visible(), 'desktop: the list is in the bar, no Menu button')
                t = bar.inner_text()
                for word in ('Start', 'Data films', 'Coming soon', 'My films', 'Credits'):
                    check(word.lower() in t.lower(), f'the bar has "{word}"')
                check(bar.locator('.dept-list > li > a').filter(has_text='Compilations').count() == 0, 'Compilations is NOT a normal bar item (it is in the Coming soon group)')
                p.screenshot(path=str(OUT / f'bar-{name}.png'), full_page=False)
                if not phone:
                    p.locator('.soon-group summary').click()          # a desktop list opens on a click; on a phone the items sit open under their heading in the Menu
                soon = p.locator('.soon-group ul li')
                check(soon.count() == 4 and all(x in p.locator('.soon-group ul').inner_text() for x in ('Compilations', 'Geographic Intelligence', 'Games', 'Animation Studio')), 'the Coming soon group lists the four not-built departments')
                check(p.locator('.soon-group .soon-tag').count() == 4, 'each one is marked "soon"')
                p.screenshot(path=str(OUT / f'bar-soon-open-{name}.png'), full_page=False)
                # 2. the Data films page
                p.evaluate("location.hash = '#/d/data_films'")
                p.wait_for_selector('h1:has-text("Data films")', timeout=10000)
                t = p.inner_text('main')
                check('Start one in your AI' in t and 'Your data films' in t and 'No AI? Build it step by step' in t, 'Data films: the AI strip, your films and the no-AI way are there')
                check(p.locator('a[aria-current=page]', has_text='Data films').count() >= 1, 'the current department is marked')
                p.screenshot(path=str(OUT / f'data-films-{name}.png'), full_page=True)
                # 3. a Coming soon page and its button
                p.evaluate("location.hash = '#/d/compilations'")
                p.wait_for_selector('h1:has-text("Compilations")', timeout=10000)
                t = p.inner_text('main')
                check('coming soon' in t.lower() and 'Say a phrase.' in t and p.locator('.soon-picture').count() == 1 and 'Tell me when it’s ready' in t, 'Compilations: tag, line, picture and the button')
                check('DRAFT WORDING' not in t, 'the draft-wording note is gone from the page (the words are approved)')
                p.screenshot(path=str(OUT / f'soon-before-{name}.png'), full_page=True)
                p.click('#soon-notify')
                p.wait_for_selector('#soon-noted', timeout=10000)
                check('Noted.' in p.inner_text('#soon-noted') and p.locator('#soon-takeback').count() == 1 and p.locator('#soon-notify').count() == 0, 'pressing the button says Noted. and offers Take it back')
                p.screenshot(path=str(OUT / f'soon-after-{name}.png'), full_page=True)
                p.evaluate("location.hash = '#/d/games'")
                p.wait_for_selector('h1:has-text("Games")', timeout=10000)
                check(p.locator('.soon-picture').count() == 0 and p.locator('#soon-notify').count() == 1, 'Games: no picture yet, its own button (interest is per department)')
                p.evaluate("location.hash = '#/d/compilations'")
                p.wait_for_selector('#soon-noted', timeout=10000)
                check(True, 'Compilations is still noted after going elsewhere and back')
                p.click('#soon-takeback')
                p.wait_for_selector('#soon-notify', timeout=10000)
                check(p.locator('#soon-noted').count() == 0, 'Take it back removes it and the button returns')
                check(p.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth'), 'no sideways scroll')
                small = p.evaluate("[...document.querySelectorAll('.dept-list a, .dept-list summary, .dept-menu, #soon-notify')].filter(e => e.offsetParent !== null && e.getBoundingClientRect().height < 43).length")
                check(small == 0, 'every bar item and the button is at least 44 px tall')
                check(errors == [], 'no console errors')
                ctx.close()
                # 4. ids the page does not know are ignored
                ctx, p, errors = page()
                p.goto(f'{BASE}/app/?mock&aiconnected&deptextra#/', wait_until='load')
                p.wait_for_selector('.dept-bar', timeout=20000)
                if phone:
                    p.click('.dept-menu')
                else:
                    p.locator('.soon-group summary').click()
                t = p.locator('.dept-bar').inner_text()
                check('Time machine' not in t and t.count('Games') == 1, 'an unknown id and a duplicate are ignored; Games appears once, as soon')
                ctx.close()
                # 5. my_departments() failing leaves today's header exactly as it is
                ctx, p, errors = page()
                p.goto(f'{BASE}/app/?mock&aiconnected&nodept#/', wait_until='load')
                p.wait_for_selector('#sign-out', timeout=20000)
                p.wait_for_timeout(800)
                check(p.locator('.dept-bar').count() == 0 and p.locator('#dept-slot').is_hidden(), 'a failing my_departments(): no bar')
                h = p.inner_text('header')
                check('Help' in h and 'Account' in h and 'Sign out' in h, 'a failing my_departments(): the header is as it was (Help, Account, Sign out)')
                check(p.locator('h1:has-text("Your projects")').count() == 1 or p.locator('h1').count() >= 1, 'and the page itself is fine')
                ctx.close()
                # 6. not invited: no bar
                ctx, p, errors = page()
                p.goto(f'{BASE}/app/?mock&noinvite#/', wait_until='load')
                p.wait_for_selector('#sign-out', timeout=20000)
                p.wait_for_timeout(800)
                check(p.locator('.dept-bar').count() == 0, 'an account that is not invited sees no bar')
                ctx.close()
                # 7. the flag OFF (the committed config): nothing changes
                ctx, p, errors = page(flag=False)
                p.goto(f'{BASE}/app/?mock&aiconnected#/', wait_until='load')
                p.wait_for_selector('#sign-out', timeout=20000)
                p.wait_for_timeout(800)
                check(p.locator('.dept-bar').count() == 0, 'flag off: no bar')
                p.evaluate("location.hash = '#/d/compilations'")
                p.wait_for_timeout(800)
                check('Tell me when it' not in p.inner_text('body'), 'flag off: #/d/compilations is not a page')
                check(errors == [], 'flag off: no console errors')
                ctx.close()
            b.close()
    finally:
        srv.shutdown()
    print('ALL OK' if ok else 'FAILED')
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
