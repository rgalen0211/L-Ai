"""Wednesday's first strangers, rendered (BUILDER 11-23; CC1 08:34 asked for a rendered check beside the source tests in tests/wed-gating-1123.test.mjs).
Real Chrome, mock mode, LOCAL server only (every request to any other host is aborted), at 390 and 1280:
  - home: the 'Ask us to make a film' row is hidden while buying is closed unless the balance covers a request (the mock's request costs 10 credits): hidden at 0 and 5,
    shown at 10; shown at 0 with buying open;
  - #/request (reached by address): Send disabled + the plain closed line at 0 and 5 with buying closed; enabled at 10, and at 0 with buying open;
  - Credits with buying closed: no packs, plans or prices; the closed line is there;
  - PLANTED FAULT: ?mock&credits=0 with buying OPEN must fail the closed-state measurements (the checks are not blind).
Not part of the node suite (needs Chrome). Writes screenshots.

    python tools/check-wed-gating.py [outdir]        (default: a new folder under the system temp)
"""
import functools
import http.server
import socketserver
import sys
import tempfile
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(tempfile.mkdtemp(prefix='wed-gating-'))
BASE = ''      # set in main() from a free port the system picks (a fixed port let parallel page checks serve another tree's pages)

HOME_ROW = """() => { const a = [...document.querySelectorAll('.home-links a')].find(x => x.getAttribute('href') === '#/request');
  if (!a) return 'absent'; return a.closest('li').hidden ? 'hidden' : 'shown'; }"""
REQUEST = """() => { const send = [...document.querySelectorAll('button[type=submit]')].find(x => /Send request/.test(x.textContent));
  const note = document.querySelector('.request-closed');
  return { disabled: !!(send && send.disabled), note: !!(note && !note.hidden),
           noteText: note ? note.textContent : '', overflow: document.documentElement.scrollWidth > innerWidth + 1 }; }"""
CREDITS = """() => { const main = document.querySelector('main') || document.body; const text = main.innerText;
  return { offers: main.querySelectorAll('.offer').length, price: /\\$\\d/.test(text), closed: /Buying credits is not open yet\\./.test(text),
           overflow: document.documentElement.scrollWidth > innerWidth + 1 }; }"""


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


def closed_home_faults(row, credits):
    return [] if row == ('shown' if credits >= 10 else 'hidden') else [f'home row {row} at {credits} credits']


def main():
    global BASE
    sys.stdout.reconfigure(encoding='utf-8')
    OUT.mkdir(parents=True, exist_ok=True)
    srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=str(ROOT)))
    BASE = f'http://127.0.0.1:{srv.server_address[1]}'
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    ok = True
    outside = []

    def check(cond, what):
        nonlocal ok
        print(('  ok   ' if cond else '  FAIL ') + what)
        ok = ok and bool(cond)

    try:
        with sync_playwright() as pw:
            b = pw.chromium.launch()
            for width, height in ((390, 844), (1280, 800)):
                ctx = b.new_context(viewport={'width': width, 'height': height}, has_touch=width < 500)

                def route(r):
                    if r.request.url.startswith(BASE) and '/assets/ryagram-config.js' in r.request.url:
                        # the opening branch ships buyingOpen true; these checks are about the CLOSED page, so they serve the config closed (web-buying-flip-1124)
                        r.fulfill(body=(ROOT / 'assets/ryagram-config.js').read_text(encoding='utf-8').replace('buyingOpen: true,', 'buyingOpen: false,'), content_type='text/javascript')
                        return
                    if r.request.url.startswith(BASE):
                        r.continue_()
                    else:
                        outside.append(r.request.url)
                        r.abort()
                ctx.route('**/*', route)
                page = ctx.new_page()
                errors = []
                page.on('pageerror', lambda e: errors.append(str(e)))

                def home(query):
                    page.goto(f'{BASE}/app/?mock&noinvite{query}#/', wait_until='load')
                    page.wait_for_function("() => /available/.test((document.querySelector('.credit-balance')||{}).textContent||'')", timeout=20000)
                    page.wait_for_timeout(500)
                    return page.evaluate(HOME_ROW)

                def request(query):
                    page.goto(f'{BASE}/app/?mock&noinvite{query}#/request', wait_until='load')
                    page.wait_for_selector('h1:has-text("Request a film")', timeout=20000)
                    page.wait_for_timeout(800)
                    return page.evaluate(REQUEST)

                for credits in (0, 5, 8, 10):
                    row = home(f'&buyingclosed&credits={credits}')
                    check(closed_home_faults(row, credits) == [], f'[{width}] CLOSED home at {credits} credits: the request row is {row}')
                    st = request(f'&buyingclosed&credits={credits}')
                    short = credits < 10
                    check(st['disabled'] == short and st['note'] == short, f'[{width}] CLOSED #/request at {credits} credits: Send disabled={st["disabled"]}, closed line={st["note"]}')
                    check(not st['overflow'], f'[{width}] #/request at {credits} credits: no sideways scroll')
                    if credits in (0, 8):
                        want = 'A film request costs 10 credits; you have ' + ('0 credits' if credits == 0 else '8 credits') + '. Buying credits is not open yet.'
                        check(st['noteText'] == want, f'[{width}] the closed line says the cost and the balance at {credits} credits: {st["noteText"]!r}')
                    if credits == 0:
                        page.screenshot(path=str(OUT / f'request-closed-0-{width}.png'), full_page=True)
                row = home('&credits=0')
                check(row == 'shown', f'[{width}] OPEN home at 0 credits: the request row is {row} (buying open leaves it as it was)')
                st = request('&credits=0')
                check(not st['disabled'] and not st['note'], f'[{width}] OPEN #/request at 0 credits: Send enabled, no closed line')
                # PLANTED FAULT: the open state judged by the closed-state rule must fail
                check(closed_home_faults(row, 0) != [], f'[{width}] PLANTED FAULT (the open home judged as a closed one at 0 credits) is caught')

                page.goto(f'{BASE}/app/?mock&noinvite&buyingclosed&credits=0#/credits', wait_until='load')
                page.wait_for_function("() => /available|Couldn/.test((document.querySelector('.credit-balance')||{}).textContent||'')", timeout=20000)
                page.wait_for_timeout(500)
                cs = page.evaluate(CREDITS)
                page.screenshot(path=str(OUT / f'credits-closed-{width}.png'), full_page=True)
                check(cs['offers'] == 0 and not cs['price'] and cs['closed'], f'[{width}] CLOSED Credits: no packs, plans or prices, closed line shown ({cs})')
                check(not cs['overflow'], f'[{width}] CLOSED Credits: no sideways scroll')
                page.goto(f'{BASE}/app/?mock&noinvite&credits=0#/credits', wait_until='load')
                page.wait_for_function("() => /available|Couldn/.test((document.querySelector('.credit-balance')||{}).textContent||'')", timeout=20000)
                page.wait_for_timeout(500)
                co = page.evaluate(CREDITS)
                check(co['offers'] > 0 and co['price'], f'[{width}] PLANTED FAULT: the OPEN Credits page has packs and prices, so the closed measurement is not blind ({co})')
                check(not errors, f'[{width}] no page errors {errors[:2]}')
                ctx.close()
            b.close()
    finally:
        srv.shutdown()
    print(f'  note every other host was aborted: {len(outside)} requests ({sorted(set(u.split("/")[2] for u in outside))[:5]})')
    print(f'shots: {OUT}')
    print('RESULT', 'ALL PASS' if ok else 'FAIL')
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
