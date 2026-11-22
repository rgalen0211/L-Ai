"""Credits and the BUYING OPEN switch (WEB 11-21), real Chrome, mock mode, LOCAL server only, at 390 and 1280.
CLOSED (?buyingclosed): Credits shows the balance, what credits are for, what a full film costs, the packs and plans with NO Buy / Subscribe button, NO test-card text, and the plain line
'Buying credits is not open yet.'; the home page has no 'Buy credits' link; a render short of credits says buying is not open yet instead of linking to checkout.
OPEN (mock default): today's page, Buy / Subscribe buttons and the mock-mode line. Planted fault: ?plant (a closed page that carries the open markup) must be CAUGHT by the same measurements.
Writes screenshots. Not part of the node suite (needs Chrome).

    python tools/check-credits-buying.py [outdir]        (default D:/Ryagram-scratch/WEB/credits-buying-shots)
"""
import http.server
import socketserver
import sys
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('D:/Ryagram-scratch/WEB/credits-buying-shots')
PORT = 0
BASE = ''

STATE = """() => {
  const main = document.querySelector('main') || document.body;
  const text = main.innerText;
  const buttons = [...main.querySelectorAll('button')].map(b => b.textContent.trim());
  const links = [...main.querySelectorAll('a')].map(a => a.textContent.trim());
  return { text, buy: buttons.filter(t => /^(Buy|Subscribe)$/.test(t)).length, buyLinks: links.filter(t => /buy credits/i.test(t)).length,
           card: /4242/.test(text), testMode: /test mode/i.test(text), closedLine: /Buying credits is not open yet\\./.test(text),
           free: /Contact sheets are free\\. Each project gets 6 free previews/.test(text),
           offers: [...main.querySelectorAll('.offer')].length, filmCost: /A full film costs/.test(text), overflow: document.documentElement.scrollWidth > innerWidth + 1 };
}"""


def serve():
    global PORT, BASE
    class H(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *a, **k):
            super().__init__(*a, directory=str(ROOT), **k)

        def log_message(self, *a):
            pass

        def end_headers(self):
            self.send_header('Cache-Control', 'no-store')
            super().end_headers()
    srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), H)
    PORT = srv.server_address[1]; BASE = f'http://127.0.0.1:{PORT}'
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


def closed_faults(s):
    """What is wrong with a closed Credits page (the planted fault must produce at least one)."""
    bad = []
    if s['buy']: bad.append('Buy/Subscribe button')
    if s['card']: bad.append('test card')
    if s['testMode']: bad.append('test mode text')
    if not s['closedLine'] or not s['free']: bad.append('closed line missing')
    if s['offers'] < 3: bad.append('offers not listed')
    return bad


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
            for width, height in ((390, 844), (1280, 800)):
                ctx = b.new_context(viewport={'width': width, 'height': height}, has_touch=width < 500)
                page = ctx.new_page()
                errors = []
                page.on('pageerror', lambda e: errors.append(str(e)))

                def credits(query):
                    page.goto(f'{BASE}/app/?mock{query}#/credits', wait_until='load')
                    page.wait_for_selector('.credit-balance', timeout=20000)
                    page.wait_for_function("() => /available|Couldn/.test(document.querySelector('.credit-balance').textContent)", timeout=20000)
                    page.wait_for_timeout(300)
                    return page.evaluate(STATE)
                s = credits('&buyingclosed')
                page.screenshot(path=str(OUT / f'bc-credits-closed-{width}.png'), full_page=True)
                check(closed_faults(s) == [], f'[{width}] CLOSED Credits: no Buy/Subscribe, no test card, no Test mode text, closed line, offers listed ({closed_faults(s)})')
                check(not s['overflow'], f'[{width}] CLOSED Credits: no sideways scroll')
                check(s['filmCost'] and 'between 6 and 10 credits' in s['text'], f'[{width}] CLOSED Credits says what a full film costs (read from the price table)')
                s = credits('')
                page.screenshot(path=str(OUT / f'bc-credits-open-{width}.png'), full_page=True)
                check(s['filmCost'] and 'between 6 and 10 credits' in s['text'], f'[{width}] OPEN Credits says what a full film costs')
                check(s['buy'] == 5 and not s['closedLine'], f'[{width}] OPEN Credits: Buy and Subscribe buttons, no closed line ({s["buy"]} buttons)')
                # planted fault: open markup in the closed page is caught by the same measurement
                s = credits('')
                check(closed_faults(s) != [], f'[{width}] PLANTED FAULT (the open page judged as a closed one) is caught: {closed_faults(s)}')
                # home: the Buy credits link follows the switch
                page.goto(f'{BASE}/app/?mock&buyingclosed#/', wait_until='load')
                page.wait_for_function("() => /available/.test((document.querySelector('.credit-balance')||{}).textContent||'')", timeout=20000)
                page.wait_for_timeout(300)
                s = page.evaluate(STATE)
                check(s['buyLinks'] == 0, f'[{width}] CLOSED home: no Buy credits link')
                page.goto(f'{BASE}/app/?mock#/', wait_until='load')
                page.wait_for_function("() => /available/.test((document.querySelector('.credit-balance')||{}).textContent||'')", timeout=20000)
                page.wait_for_timeout(300)
                s = page.evaluate(STATE)
                check(s['buyLinks'] == 1, f'[{width}] OPEN home: one Buy credits link')
                # a render that needs more credits than the person has: closed says so plainly, open links to Credits
                for query, want in (('&buyingclosed&credits=3', 'closed'), ('&credits=3', 'open')):
                    page.goto(f'{BASE}/app/?mock{query}#/', wait_until='load')
                    page.wait_for_selector('.film-grid a, .film-grid button', timeout=20000)
                    page.locator('.film-grid h3 a').first.click()
                    vlink = page.locator('main a[href^="#/v/"]').first
                    vlink.wait_for(timeout=20000)
                    vlink.click()
                    sheet = page.get_by_role('button', name='Make contact sheet').first
                    sheet.wait_for(timeout=20000)
                    page.wait_for_timeout(400)
                    sheet.click()
                    page.wait_for_function("() => /Contact sheet: Complete/i.test(document.body.innerText)", timeout=90000)
                    prev = page.get_by_role('button', name='Make preview').first
                    prev.wait_for(timeout=20000)
                    page.wait_for_timeout(500)
                    prev.click()
                    page.wait_for_function("() => /Preview: Complete/i.test(document.body.innerText)", timeout=90000)
                    page.wait_for_timeout(800)
                    body = page.inner_text('main')
                    page.screenshot(path=str(OUT / f'bc-render-short-{want}-{width}.png'), full_page=True)
                    final_title = page.get_by_role('button', name='Render final film').first.get_attribute('title') or ''
                    said = 'Buying credits is not open yet.' in body or 'Buying credits is not open yet.' in final_title
                    linked = page.locator('main a[href="#/credits"]').count() > 0
                    if want == 'closed':
                        check(said and not linked, f'[{width}] CLOSED, short of credits: says buying is not open yet, no link to checkout (said={said}, link={linked})')
                    else:
                        check(not said, f'[{width}] OPEN, short of credits: no closed line (link={linked})')
                check(not errors, f'[{width}] no page errors {errors}')
                ctx.close()
            b.close()
    finally:
        srv.shutdown(); srv.server_close()
    print('RESULT:', 'PASS' if ok else 'FAIL')
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
