"""The guided first film (NEXT-WEB 132), real Chrome, mock mode, LOCAL server only, at PHONE width (390 x 844, touch): a newcomer with no projects sees ONE big "Make your first film",
the builder opens on three ready-made starts (housing, health, work; no income), one tap on Housing lands on the Review with the years and title filled, "Make the film and a free
contact sheet" makes the project and goes to its version page. Every button, field and button-link 44 px or more (the back link's 44 px is phone-pass-1's rule), no sideways scroll, the main button on the first screen without scrolling.
Writes screenshots. Not part of the node suite (needs Chrome).

    python tools/check-first-film.py [outdir]        (default D:/Ryagram-scratch/WEB/first-film-shots)
"""
import http.server
import socketserver
import sys
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('D:/Ryagram-scratch/WEB/first-film-shots')
PORT = 8181
BASE = f'http://127.0.0.1:{PORT}'

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
    try:
        with sync_playwright() as pw:
            b = pw.chromium.launch(channel='chrome')
            ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
            p = ctx.new_page()
            errors = []
            p.on('pageerror', lambda e: errors.append(str(e)))
            p.goto(f'{BASE}/app/?mock&empty#/', wait_until='load')
            p.wait_for_selector('h1:has-text("Your projects")', timeout=20000)
            p.wait_for_timeout(500)
            check(p.locator('#first-film').count() == 1, 'a newcomer with no projects sees "Make your first film"')
            box = p.locator('#first-film').bounding_box()
            check(box and box['y'] + box['height'] <= 844, f'and it is on the first screen without scrolling (bottom at {box and round(box["y"] + box["height"])})')
            check('Name it above' not in p.inner_text('main'), 'the empty-library copy no longer sends them down the old path')
            check(not p.evaluate('document.documentElement.scrollWidth > innerWidth + 1'), 'no sideways scroll on the library')
            p.screenshot(path=str(OUT / '1-library.png'), full_page=True)
            p.click('#first-film')
            p.wait_for_selector('h2:has-text("Start from a ready-made film")', timeout=15000)
            starts = p.locator('.builder-start')
            check(starts.count() == 3, f'three ready-made starts ({starts.count()})')
            names = [starts.nth(i).inner_text().split('\n')[0] for i in range(starts.count())]
            check(names == ['Housing', 'Health', 'Work'], f'housing, health, work, and no income ({names})')
            check(p.locator('h2:has-text("Which data?")').count() == 1 and p.locator('[aria-label="Datasets"] .builder-card').count() == 3, 'the full dataset list is still there under it')
            small = p.evaluate(BIG)
            check(not small, f'every control 44 px or more {small}')
            check(not p.evaluate('document.documentElement.scrollWidth > innerWidth + 1'), 'no sideways scroll in the builder')
            p.screenshot(path=str(OUT / '2-starts.png'), full_page=True)
            p.click('.builder-start[data-start="housing"]')
            p.wait_for_selector('h2:has-text("Review")', timeout=15000)
            p.wait_for_selector('.builder-summary', timeout=15000)
            text = p.inner_text('.builder-summary')
            check('Residential building permits' in text and '1990 to 2024' in text and 'Map' in text and 'New homes permitted' in text, f'one tap lands on the Review with the data, years, kind and title filled ({text.replace(chr(10), " | ")[:150]})')
            check('Source:' in p.inner_text('main') and 'Licence:' in p.inner_text('main'), 'the source and licence are shown on the Review')
            p.screenshot(path=str(OUT / '3-review.png'), full_page=True)
            p.click('.builder-nav button:has-text("Back")')
            p.wait_for_selector('h2:has-text("What is it called?")')
            check('New homes permitted' in p.input_value('#bd-title'), 'Back works: the title step has the start\'s title')
            p.click('button:has-text("Next")')
            p.wait_for_selector('.builder-summary')
            p.click('button:has-text("Make the film and a free contact sheet")')
            p.wait_for_selector('h1:has-text("Version 1")', timeout=20000)
            check(True, 'the free contact sheet is made and the version page opens')
            p.wait_for_selector('.next-strip:not([hidden])', timeout=40000)
            strip = p.inner_text('.next-strip')
            check('That first picture was free' in strip and 'credits' in strip and 'you have' in strip, f'after the free first picture the page says what the full film uses and what they have ({strip})')
            check('$' not in strip and 'per credit' not in strip.lower(), 'and never a price per credit')
            check(p.locator('.next-strip a:has-text("Buy credits")').count() == 1, 'and shows how to buy credits')
            p.screenshot(path=str(OUT / '4-version.png'), full_page=True)
            check(not errors, f'no page errors {errors}')
            ctx.close()
            b.close()
    finally:
        srv.shutdown()
    print('RESULT:', 'PASS' if ok else 'FAIL')
    sys.exit(0 if ok else 1)


main()
