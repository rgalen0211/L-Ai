"""Opens the creator beta section of /ryagram/ and Ryan's Operations screen (mock mode) in real Chrome at desktop and phone width, checks what they
must show, and writes screenshots. Not part of the node suite (it needs Chrome).

    python tools/check-creator-beta.py [outdir]        (default D:/Ryagram-scratch/WEB/creator-shots)
"""
import http.server
import socketserver
import sys
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('D:/Ryagram-scratch/WEB/creator-shots')
PORT = 8165
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
    global PORT, BASE
    srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), H)          # its own port (a fixed one can be bound twice at once on Windows)
    PORT = srv.server_address[1]; BASE = f'http://127.0.0.1:{PORT}'
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
    try:
        with sync_playwright() as pw:
            b = pw.chromium.launch(channel='chrome')
            for name, opts in (('desktop', dict(viewport={'width': 1280, 'height': 900})),
                               ('phone', dict(viewport={'width': 390, 'height': 844}, device_scale_factor=3, is_mobile=True, has_touch=True))):
                print(name)
                ctx = b.new_context(**opts)
                page = ctx.new_page()
                errors = []
                page.on('pageerror', lambda e: errors.append(str(e)))
                page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
                page.goto(f'{BASE}/ryagram/', wait_until='load')
                text = page.inner_text('#creators')
                check('Creator beta' in text, 'the section is on the page')
                for who in ('YouTubers', 'podcasters', 'newsletter writers', 'journalists', 'teachers', 'researchers'):
                    check(who in text, f'it names {who}')
                check('Beta credits are free, in exchange for your feedback.' in text, 'it says beta credits are free, in exchange for feedback')
                check('disclose that your credits were free' in text, 'it says any promotion is disclosed')
                check(page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), 'no sideways scroll')
                nav = page.locator('.rg-navlink')
                if name == 'phone':
                    check(nav.count() == 1 and not nav.is_visible(), 'on a phone the header is the brand and one button (the hero leads to the creator beta)')
                else:
                    check(nav.count() == 1 and nav.bounding_box()['height'] >= 44, 'the nav link is there and a 44px target')
                box = page.locator('.rg-top').bounding_box()
                check(box['height'] < 140, f'the header did not wrap into a tall block ({box["height"]:.0f}px)')
                page.locator('#creators').scroll_into_view_if_needed()
                page.screenshot(path=str(OUT / f'creator-{name}-section.png'))
                # creatorBeta is OFF in the committed config (Ryan 2026-10-17: the landing ships before the Terms and Privacy pages), so there is no form to fill in for nothing: the fields are hidden,
                # the form's place says to email, and the hero button is the invite email. (This block used to fill and submit the form; that was the page before the ruling.)
                sent = []
                page.on('request', lambda r: sent.append(r.url) if 'functions/v1' in r.url else None)
                fields = page.locator('#creator-form .creator-fields')
                check(fields.count() == 1 and not fields.is_visible(), 'switched off: the form fields are not shown')
                msg = page.inner_text('#creator-status')
                check('open soon' in msg and 'ryagram@uselai.com' in msg, f'switched off: it says to email, not "thanks" ({msg[:60]!r})')
                hero = page.locator('.rg-hero-cta a.rg-btn')
                check(hero.count() == 1 and (hero.get_attribute('href') or '').startswith('mailto:ryagram@uselai.com'), 'and the hero button is the invite email')
                check(not sent, 'and nothing was sent')
                page.screenshot(path=str(OUT / f'creator-{name}-filled.png'))
                check(not errors, f'no console errors {errors}')
                ctx.close()

                # Ryan's Operations screen, in mock mode (fake data, local only)
                ctx = b.new_context(**opts)
                p = ctx.new_page()
                errors = []
                p.on('pageerror', lambda e: errors.append(str(e)))
                p.goto(f'{BASE}/app/?mock#/admin/ops', wait_until='load')
                p.wait_for_selector('text=Creator beta applications', timeout=20000)
                sec = p.locator('section.ops-section', has_text='Creator beta applications')
                t = sec.inner_text()
                check('(2)' in t and 'Maya Ortiz' in t and 'Dr. Sam Lee' in t, 'two waiting applications are listed')
                check('Did cities that legalized duplexes' in t and 'Weekly explainers on housing' in t, 'with what they make and their question')
                check('Approving sends nothing and grants no credits' in t, 'it says approving sends nothing and grants no credits')
                link = sec.locator('a[href^="https://www.youtube.com"]')
                check(link.count() == 1 and link.get_attribute('rel') == 'noopener noreferrer' and link.get_attribute('target') == '_blank', 'their link opens safely')
                sec.screenshot(path=str(OUT / f'creator-{name}-admin.png'))
                sec.get_by_role('button', name='Approve').first.click()
                p.wait_for_timeout(800)
                t2 = p.locator('section.ops-section', has_text='Creator beta applications').inner_text()
                check('(1)' in t2 and '1 approved' in t2, 'Approve moves it out of the waiting list and into the approved count')
                p.locator('section.ops-section', has_text='Creator beta applications').get_by_role('button', name='Decline').first.click()
                p.wait_for_timeout(800)
                t3 = p.locator('section.ops-section', has_text='Creator beta applications').inner_text()
                check('(0)' in t3 and '1 declined' in t3, 'Decline likewise')
                check(not errors, f'no page errors on the Operations screen {errors}')
                p.screenshot(path=str(OUT / f'creator-{name}-admin-full.png'), full_page=True)
                ctx.close()
            b.close()
    finally:
        srv.shutdown()
    print('RESULT:', 'PASS' if ok else 'FAIL')
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
