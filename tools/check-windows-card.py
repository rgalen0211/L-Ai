"""The "Ryagram for Windows" download card in real Chrome, mock mode, LOCAL server only: hidden for a non-tester, shown (button OFF, "Not ready yet") for a tester with an empty release record, and
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


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    socketserver.TCPServer.allow_reuse_address = True
    srv = socketserver.ThreadingTCPServer(('127.0.0.1', 8193), H)
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
                    p.goto(f'http://127.0.0.1:8193/app/{query}#/account', wait_until='load')
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
            finally:
                b.close()
    finally:
        srv.shutdown()
    check(not any(u.startswith('http://127.0.0.1') for u in external), f'every request to another host was aborted ({len(external)})')
    print('RESULT: ' + ('PASS' if ok else 'FAIL'))
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
