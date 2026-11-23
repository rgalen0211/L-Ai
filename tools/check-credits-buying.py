"""Credits and the BUYING OPEN switch (WEB 11-21), real Chrome, mock mode, LOCAL server only, at 390 and 1280.
CLOSED (?buyingclosed): Credits shows the balance, what credits are for, what a full film costs, NO packs, plans or prices (CC1 11-23), NO Buy / Subscribe button, NO test-card text, and the plain line
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
           offers: [...main.querySelectorAll('.offer')].length, price: /\\$\\d/.test(text), filmCost: /A full film costs/.test(text), overflow: document.documentElement.scrollWidth > innerWidth + 1 };
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
    if s['offers'] or s['price']: bad.append('packs, plans or prices listed')      # CC1 ruling 11-23 08:34: no price a stranger cannot pay while buying is closed
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
                check(closed_faults(s) == [], f'[{width}] CLOSED Credits: no Buy/Subscribe, no test card, no Test mode text, closed line, no packs, plans or prices ({closed_faults(s)})')
                check(not s['overflow'], f'[{width}] CLOSED Credits: no sideways scroll')
                check(s['filmCost'] and 'between 6 and 10 credits' in s['text'], f'[{width}] CLOSED Credits says what a full film costs (read from the price table)')
                # Q679 B: an account holding 8 welcome credits (and the 0 / 2 / 10 states) reads what the balance covers, never 'a full film needs credits'
                for have, cover in ((8, ' Your 8 credits cover the smaller film types.'), (2, ' Your 2 credits do not cover a full film.'), (10, None), (0, None)):
                    s = credits(f'&buyingclosed&credits={have}')
                    flat = ' '.join(s['text'].split())
                    word = '1 credit available' if have == 1 else f'{have} credits available'
                    check(word in flat, f'[{width}] CLOSED Credits at {have}: the balance row reads {word!r}')
                    check('A full film costs between 6 and 10 credits, depending on the film type.' in flat and 'Buying credits is not open yet.' in flat, f'[{width}] CLOSED Credits at {have}: the cost and the closed sentence')
                    check((cover is None and 'Your ' + str(have) + ' credits' not in flat) or (cover is not None and cover.strip() in flat), f'[{width}] CLOSED Credits at {have}: what the balance covers ({cover!r})')
                    check('needs credits' not in flat and not s['overflow'], f'[{width}] CLOSED Credits at {have}: no "needs credits", no sideways scroll')
                    if have == 8:
                        page.screenshot(path=str(OUT / f'bc-credits-closed-8-{width}.png'), full_page=True)
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
                for query, want in (('&buyingclosed&credits=3', 'closed'), ('&credits=3', 'open'), ('&buyingclosed&credits=8', 'welcome8')):
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
                    if want == 'welcome8':
                        # Q679 B: the strip reads THIS film's own cost against the 8 welcome credits (6 or 8: it can be made; 10: it cannot, and the page says why and the next step)
                        flat = ' '.join(body.split())
                        import re as _re
                        uses = _re.search(r'The full film uses (\d+) credits; you have 8 credits\.', flat)
                        cant = _re.search(r'The full film for this film type costs (\d+) credits and you have 8 credits, so it cannot be made yet\. Buying credits is not open yet\.', flat)
                        check(bool(uses) != bool(cant), f'[{width}] 8 credits: the strip says either what the film uses or that it cannot be made yet ({(uses or cant) and (uses or cant).group(0)})')
                        if uses: check(int(uses.group(1)) <= 8 and 'cannot be made' not in flat, f'[{width}] 8 credits: a film that costs {uses.group(1)} is offered')
                        if cant: check(int(cant.group(1)) > 8 and 'costs ' + cant.group(1) + ' credits and you have 8 credits' in final_title + ' ' + flat, f'[{width}] 8 credits: a film that costs {cant.group(1)} is refused with its reason; the final button says {final_title!r}')
                        check('Not enough credits' not in flat and '0 credits' not in flat.replace('10 credits', ''), f'[{width}] 8 credits: no raw refusal, no "0 credits"')
                    elif want == 'closed':
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
