"""THE LAUNCH GATE (NEXT-WEB 132 G8, growth plan #3), real Chrome at PHONE width (390 x 844, touch), LOCAL server only, mock mode for the signed-in part. One script, one pass/fail:
a brand-new invited user can find Ryagram, make a meaningful preview, and see how to buy a final render, without help.

  1. The Ryagram page (/ryagram/): the invite way in is on the first screen of text ("Already have an invite? Sign in").
  2. Sign in (/app/): the real sign-in page loads, names its fields, offers the invite code form's entry in mock mode (the live switch is inviteSignup).
  3. Signed in with no projects (mock): ONE big "Make your first film" on the first screen; no other path needed.
  4. The builder opens on ready-made starts; one tap on Housing lands on the Review with everything filled; "Make the film and a free contact sheet".
  5. The version page shows the film and, when the free first picture arrives, a plain strip: it was free; the full film uses N credits; you have M; how to buy.
At every screen: no sideways scroll, every control named, every button and field 44 px or more, no page error. Not part of the node suite (needs Chrome).

    python tools/check-launch-gate.py [outdir]        (default D:/Ryagram-scratch/WEB/launch-gate-shots)
"""
import http.server
import importlib.util
import socketserver
import sys
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('D:/Ryagram-scratch/WEB/launch-gate-shots')
PORT = 8183
BASE = f'http://127.0.0.1:{PORT}'
spec = importlib.util.spec_from_file_location('audit_a11y', ROOT / 'tools' / 'audit-a11y.py')
aa = importlib.util.module_from_spec(spec)
spec.loader.exec_module(aa)

BIG = r"""() => {
  const out = [];
  const vis = el => { const r = el.getBoundingClientRect(), s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && !el.closest('[hidden],[aria-hidden=true]'); };
  for (const el of document.querySelectorAll('main button, main select, main summary, main input:not([type=hidden]):not([type=radio]):not([type=checkbox]), main a.button')) {
    if (!vis(el) || el.id === 'mock-outcome') continue;
    if (el.getBoundingClientRect().height < 43.5) out.push(el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + ':' + (el.textContent || '').trim().slice(0, 24) + ' ' + Math.round(el.getBoundingClientRect().height));
  }
  return out;
}"""


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
    sys.stdout.reconfigure(encoding='utf-8')
    OUT.mkdir(parents=True, exist_ok=True)
    srv = serve()
    ok = True

    def check(cond, what):
        nonlocal ok
        print(('  ok   ' if cond else '  FAIL ') + what)
        ok = ok and bool(cond)

    def screen(p, key, label):
        p.wait_for_timeout(300)
        p.screenshot(path=str(OUT / f'{key}.png'), full_page=True)
        scan = p.evaluate(aa.SCAN)
        check(not scan['overflow'], f'{label}: no sideways scroll')
        check(not scan['noname'], f'{label}: every control has a name {scan["noname"]}')
        small = p.evaluate(BIG)
        check(not small, f'{label}: every button and field 44 px or more {small}')

    try:
        with sync_playwright() as pw:
            b = pw.chromium.launch(channel='chrome')
            ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
            p = ctx.new_page()
            errors = []
            p.on('pageerror', lambda e: errors.append(str(e)))
            p.on('dialog', lambda d: d.accept())

            print('1. find Ryagram')
            p.goto(f'{BASE}/ryagram/', wait_until='load')
            link = p.locator('.rg-release a[href="/app/"]')
            check(link.count() == 1, 'the invite way in is on the Ryagram page ("Already have an invite? Sign in")')
            hero = p.locator('.rg-hero-signin')
            check(hero.count() == 1 and hero.first.bounding_box()['y'] < 1100, 'and a plain "Already invited? Sign in" sits right under the hero button, high on the page')
            p.screenshot(path=str(OUT / '1-ryagram.png'), full_page=True)
            link.first.click()

            print('2. sign in')
            p.wait_for_selector('#sign-in:not([hidden]) #si-email', timeout=20000)
            check(p.url.rstrip('/').endswith('/app') or '/app/' in p.url, 'the invite link goes to the app\'s sign-in')
            screen(p, '2-signin', 'sign-in')
            check(p.locator('button:has-text("Sign in")').count() >= 1, 'the Sign in button is there')

            print('3. signed in, nothing made yet (mock)')
            p.goto(f'{BASE}/app/?mock&empty#/', wait_until='load')
            p.wait_for_selector('h1:has-text("Your projects")', timeout=20000)
            p.wait_for_timeout(500)
            box = p.locator('#first-film').bounding_box() if p.locator('#first-film').count() else None
            check(box is not None and box['y'] + box['height'] <= 844, 'ONE big "Make your first film" is on the first screen without scrolling')
            screen(p, '3-library', 'library')
            p.click('#first-film')

            print('4. the builder')
            p.wait_for_selector('h2:has-text("Start from a ready-made film")', timeout=15000)
            check(p.locator('.builder-start').count() == 3, 'three ready-made starts')
            screen(p, '4-starts', 'builder start')
            p.click('.builder-start[data-start="housing"]')
            p.wait_for_selector('.builder-summary', timeout=15000)
            text = p.inner_text('.builder-summary')
            check('1990 to 2024' in text and 'Map' in text, 'one tap lands on the Review with data, years and kind filled')
            screen(p, '5-review', 'review')
            p.click('button:has-text("Make the film and a free contact sheet")')

            print('5. the first picture and how to buy')
            p.wait_for_selector('h1:has-text("Version 1")', timeout=20000)
            p.wait_for_selector('.next-strip:not([hidden])', timeout=40000)
            strip = p.inner_text('.next-strip')
            check('free' in strip and 'credits' in strip and 'you have' in strip and 'Buy credits' in strip, f'the page says what is free, what the full film uses, what they have, and where to buy ({strip})')
            check('$' not in strip, 'and shows no money')
            check(p.locator('button:has-text("Render final film")').count() == 1, 'the way to the full film is on the same page')
            screen(p, '6-version', 'version page')
            check(not errors, f'no page errors {errors}')
            ctx.close()
            b.close()
    finally:
        srv.shutdown()
    print('RESULT:', 'PASS' if ok else 'FAIL')
    sys.exit(0 if ok else 1)


main()
