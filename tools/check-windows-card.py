"""The "Ryagram for Windows" download card in real Chrome, mock mode, LOCAL server only (phase 2, WEB 11-28: the Compilations account, the closed and open door, the setup-exe card and the Compilations page link,
at 390 and 1280 px: no sideways scroll, every button and link at least 44 px, the six Windows-warning steps, never the word unzip): hidden for a non-tester, shown (button OFF, "Not ready yet") for a tester with an empty release record, and
shown with a working https link, the file name and the SHA-256 for a tester when a release record is served in its place. No request leaves 127.0.0.1. Writes screenshots. Not part of the node suite (needs Chrome).

    python tools/check-windows-card.py [outdir]     (default D:/Ryagram-scratch/WEB/windows-card-shots)
"""
import http.server
import json
import socketserver
import sys
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('D:/Ryagram-scratch/WEB/windows-card-shots')
SHA = 'c' * 64
PINS = json.loads((ROOT / 'assets' / 'windows-release.pins.json').read_text(encoding='utf-8'))      # the committed release's name and hash: never typed here, so the next release cannot leave this check behind
EMPTY = "window.ryagramWindowsApp = Object.freeze({ url: null, fileName: null, sizeMb: null, unpackedMb: null, sha256: null, personalUseNotice: null });"
READY = ("window.ryagramWindowsApp = Object.freeze({ url: 'https://example.test/files/Ryagram-for-Windows-1.zip', fileName: 'Ryagram-for-Windows-1.zip', sizeMb: 212, sha256: '" + SHA + "', personalUseNotice: null });")


class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=str(ROOT), **k)

    def log_message(self, *a):
        pass


SMALL_JS = """() => [...document.querySelectorAll('section.windows-card button, section.windows-card a, .comp-getapp a')].filter(e => e.offsetParent).map(e => { const r = e.getBoundingClientRect(); return [e.textContent.trim().slice(0, 40), Math.round(r.height), Math.round(r.width)]; }).filter(x => x[1] < 44 || x[2] < 44)"""


def phase2(b, check, port, out, external):
    """The Compilations-account card at 390 and 1280 px (WEB 11-28). ?compon = the Compilations switch is on for a non-tester; ?appdoor = the mock of the day the server lets that account download."""
    for w in (390, 1280):
        shots = out / f'w{w}'
        shots.mkdir(parents=True, exist_ok=True)
        for label, query, page_hash in (
                ('switch off, not a tester', '?mock', '#/account'),
                ('switch on, door off (honest line, no button)', '?mock&compon', '#/account'),
                ('switch on, door on (setup card)', '?mock&compon&appdoor', '#/account'),
                ('tester, door off (zip card kept)', '?mock&tester', '#/account'),
                ('compilations page, door off', '?mock&compon', '#/d/compilations'),
                ('compilations page, door on', '?mock&compon&appdoor', '#/d/compilations')):
            print(f'{w}px: {label}')
            ctx = b.new_context(viewport={'width': w, 'height': 844 if w < 500 else 900}, is_mobile=w < 500)
            ctx.route('**/*', lambda r: (external.append(r.request.url), r.abort()) if not r.request.url.startswith('http://127.0.0.1') else r.continue_())
            p = ctx.new_page()
            errs = []
            p.on('pageerror', lambda e: errs.append(str(e)))
            p.goto(f'http://127.0.0.1:{port}/app/{query}{page_hash}', wait_until='load')
            p.wait_for_selector('main h1:visible', timeout=20000)
            p.wait_for_timeout(2200)
            card = p.locator('section.windows-card')
            slug = label.split(',')[0].replace(' ', '-') + '-' + ('door-on' if 'appdoor' in query else 'door-off') + ('-comp' if 'compilations' in label else '')
            if page_hash == '#/account':
                if label.startswith('switch off'):
                    check(card.count() == 0, 'no card')
                elif 'door off (honest' in label:
                    t = card.inner_text()
                    check(card.count() == 1 and 'The Ryagram app is not ready to download yet.' in t and card.locator('button, a').count() == 0, 'the honest line and no button, no link on the card')
                    check(card.locator('[aria-live=polite]').count() == 1, 'the line is in a polite live region')
                elif 'setup card' in label:
                    t = card.inner_text()
                    btn = card.locator('button#windows-download')
                    check(card.count() == 1 and btn.count() == 1 and btn.is_enabled(), 'an enabled Download button')
                    check('Ryagram-Setup-0.0.0-mock.exe' in t and 'd' * 64 in t, 'the setup file name and its SHA-256 are next to the button')
                    check('More info' in t and 'Run anyway' in t and '-Algorithm SHA256' in t and 'Get-FileHash Ryagram-Setup-0.0.0-mock.exe' in t, 'More info, Run anyway and the PowerShell line are on the card')
                    check('unzip' not in t.lower() and 'extract' not in t.lower(), 'no word unzip')
                    check(card.locator('ol.windows-warn-steps > li').count() == 6 and card.locator('img').count() == 0, 'six steps and no invented screenshot')
                    check(card.locator('[aria-live=polite]').count() >= 1, 'the download status is a polite live region')
                    btn.focus()
                    check(p.evaluate('document.activeElement && document.activeElement.id') == 'windows-download', 'the button is reachable by keyboard')
                else:
                    t = card.inner_text()
                    check(card.count() == 1 and card.locator('button#windows-download').count() == 1 and 'unzip' in t.lower(), 'the tester keeps the zip card with its button')
                if card.count() == 1:
                    check(p.evaluate(SMALL_JS) == [], 'every button and link on the card is at least 44 px')
                    card.screenshot(path=str(shots / f'card-{slug}.png'))
            else:
                link = p.locator('#comp-getapp')
                closed = p.locator('.comp-getapp-closed')
                p.click('text=Requests') if p.locator('text=Requests').count() else None
                p.wait_for_timeout(500)
                if 'door on' in label:
                    check(link.count() == 1 and link.inner_text().strip() == 'Get the Ryagram app' and closed.count() == 0, 'the Get the Ryagram app link is there')
                    check(p.evaluate(SMALL_JS) == [], 'the link is at least 44 px')
                else:
                    check(link.count() == 0 and closed.count() == 1 and 'not ready to download yet.' in closed.inner_text(), 'the honest line instead of a link')
                p.screenshot(path=str(shots / f'compilations-{slug}.png'))
            check(p.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1'), 'no sideways scroll')
            check(not errs, 'no page errors')
            ctx.close()


def main():
    global PORT
    OUT.mkdir(parents=True, exist_ok=True)
    srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), H)          # its own port (a fixed one can be bound twice at once on Windows)
    PORT = srv.server_address[1]
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    ok = True

    def check(c, w):
        nonlocal ok
        print(('  ok   ' if c else '  FAIL ') + w)
        ok = ok and bool(c)
    external = []
    try:
        with sync_playwright() as pw:
            b = pw.chromium.launch(channel='chrome')
            try:
                for label, query, ready in (('non-tester', '?mock', None), ('tester, not ready', '?mock&tester', EMPTY), ('tester, ready', '?mock&tester', READY), ('tester, committed record', '?mock&tester', 'committed')):
                    print(label)
                    ctx = b.new_context(viewport={'width': 1000, 'height': 900})

                    def make_route(ready):
                      def route(r):
                          u = r.request.url
                          if not u.startswith('http://127.0.0.1'):
                              external.append(u)
                              return r.abort()
                          if ready not in (None, 'committed') and '/assets/windows-release.js' in u:
                              return r.fulfill(status=200, content_type='application/javascript', body=ready)
                          return r.continue_()
                      return route
                    ctx.route('**/*', make_route(ready))
                    p = ctx.new_page()
                    errs = []
                    p.on('pageerror', lambda e: errs.append(str(e)))
                    p.goto(f'http://127.0.0.1:{PORT}/app/{query}#/account', wait_until='load')
                    p.wait_for_selector('main h1:visible', timeout=20000)
                    p.wait_for_timeout(1800)
                    card = p.locator('section.windows-card')
                    if label == 'non-tester':
                        check(card.count() == 0, 'no Windows card for a non-tester')
                    else:
                        check(card.count() == 1, 'the Windows card is on the account page')
                        t = card.inner_text()
                        check('Ryagram for Windows' in t and 'If anyone else ever asks you to press Run anyway, say no.' in t and 'Download the listening model' in t, 'the title, the three steps and the Run-anyway rule are there')
                        if ready == 'committed':
                            btn = card.locator('button#windows-download')
                            check(btn.count() == 1 and btn.is_enabled() and card.locator('a.button').count() == 0 and PINS['fileName'] in t and PINS['sha256'] in t, 'the committed record: an enabled Download button (no file link), the file name and the SHA-256')
                        elif ready == READY:
                            link = card.locator('a.button')
                            check(link.count() == 1 and link.get_attribute('href').startswith('https://') and SHA in t and 'Ryagram-for-Windows-1.zip' in t, 'a working https link, the file name and the SHA-256')
                        else:
                            btn = card.locator('button')
                            check(btn.count() == 1 and btn.is_disabled() and 'Not ready yet' in t and card.locator('a.button').count() == 0, 'the button is off and says Not ready yet, with no link')
                        card.screenshot(path=str(OUT / ('card-' + ('committed' if ready == 'committed' else 'ready' if ready == READY else 'notready') + '.png')))
                    check(not errs, 'no page errors')
                    ctx.close()
                phase2(b, check, PORT, OUT / 'phase2', external)
            finally:
                b.close()
    finally:
        srv.shutdown(); srv.server_close()
    check(not any(u.startswith('http://127.0.0.1') for u in external), f'every request to another host was aborted ({len(external)})')
    print('RESULT: ' + ('PASS' if ok else 'FAIL'))
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
