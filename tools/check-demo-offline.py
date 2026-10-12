"""Checks /preview-demo/ with the network OFF and with BAD wifi, in real Chrome. Not part of the node suite (it needs Chrome).

    python tools/check-demo-offline.py

1. A fresh browser opens the page online and waits until the page says it is saved for use without internet.
2. It reloads once (so the saved copy is in charge), then switches the network OFF and reloads: the film must open, the slider must move through the
   film, and the page must say it is ready. Nothing may be requested from the network except Google Fonts (which has a fallback font).
3. BAD wifi: the network answers only after many seconds. The page must still appear (the saved copy after the 3-second allowance) and the film open,
   without waiting for the slow network. The time to a working slider is reported.
4. A browser that has NEVER seen the page, with the network off, cannot open it: that is stated, not hidden (open the page once while online).
Exit 0 only if every check passes.
"""
import http.server
import json
import socketserver
import sys
import threading
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
PORT = 8162
URL = f'http://localhost:{PORT}/preview-demo/'


DELAY = {'seconds': 0.0}          # bad wifi: the server answers, but only after this long (the saved copy must not wait for it)


def serve():
    class H(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *a, **k):
            super().__init__(*a, directory=str(ROOT), **k)

        def end_headers(self):
            self.send_header('Cache-Control', 'no-store')            # so a slow network is really waited for, not answered from the browser's own cache
            super().end_headers()

        def do_GET(self):
            if DELAY['seconds']:
                time.sleep(DELAY['seconds'])
            try:
                super().do_GET()
            except (ConnectionError, BrokenPipeError):
                pass                                                  # the browser gave up on a slow request: expected on a bad network

        def log_message(self, *a):
            pass
    class Quiet(socketserver.ThreadingTCPServer):
        daemon_threads = True

        def handle_error(self, request, client_address):
            pass
    Quiet.allow_reuse_address = True
    srv = Quiet(('127.0.0.1', PORT), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


def film_works(page, label):
    """The film opens and the slider moves through it. Returns a dict of facts."""
    page.wait_for_selector('.pv-slider', timeout=60000, state='attached')
    for _ in range(300):
        if page.evaluate('!!(window.ryagramDemo && window.ryagramDemo.viewer)'):
            break
        page.wait_for_timeout(100)
    facts = page.evaluate('''() => {
      const v = window.ryagramDemo.viewer; const out = {};
      for (const f of [0, 700, 1500, 2819]) { v.setFrame(f); out['label' + f] = document.querySelector('.pv-label').textContent; }
      out.frame = v.state().frame; out.nodes = document.querySelectorAll('.pv-svg *').length;
      return out; }''')
    assert facts['frame'] == 2819 and facts['nodes'] > 50, f'{label}: the film did not draw: {facts}'
    return facts


def main():
    srv = serve()
    ok = True
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(channel='chrome')
            ctx = browser.new_context(viewport={'width': 1280, 'height': 900})
            page = ctx.new_page()
            errors = []
            page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
            page.on('pageerror', lambda e: errors.append(str(e)))

            # 1. online, first visit
            page.goto(URL, wait_until='load')
            page.wait_for_selector('#demo-offline[data-ready="yes"]', timeout=60000, state='attached')
            print('1. online: page says:', page.inner_text('#demo-offline'))
            film_works(page, 'online')
            page.reload(wait_until='load')                                          # now the saved copy is in charge
            page.wait_for_selector('#demo-offline[data-ready="yes"]', timeout=60000, state='attached')
            controlled = page.evaluate('!!navigator.serviceWorker.controller')
            print('   the saved copy is in charge after a reload:', controlled)
            ok = ok and controlled

            # 2. network OFF
            ctx.set_offline(True)
            t0 = time.time()
            page.reload(wait_until='domcontentloaded')
            facts = film_works(page, 'offline')
            page.wait_for_selector('#demo-offline[data-ready="yes"]', timeout=60000, state='attached')
            print(f'2. network OFF: film opened and the slider moved through it ({time.time() - t0:.1f} s); labels {facts["label0"]!r} .. {facts["label2819"]!r}; page says:',
                  page.inner_text('#demo-offline'))
            offline_errors = [e for e in errors if 'fonts.g' not in e and 'ERR_INTERNET_DISCONNECTED' not in e and 'Failed to load resource' not in e]
            print('   errors other than the font request:', offline_errors)
            ok = ok and not offline_errors

            # 3. BAD wifi: the server answers every request only after 12 seconds; the saved copy must carry the page
            ctx.set_offline(False)
            DELAY['seconds'] = 12.0
            t0 = time.time()
            page.goto(URL, wait_until='load')                                       # (not 'commit': the old page would still answer the poll)
            film_works(page, 'bad wifi')
            slow = time.time() - t0
            print(f'3. BAD wifi (the server takes 12 s to answer anything): a working slider after {slow:.1f} s')
            ok = ok and 2.5 < slow < 8                                              # about the 3-second allowance, never the 12 seconds
            DELAY['seconds'] = 0.0
            ctx.close()

            # 4. a browser that has never seen the page cannot open it offline: say so
            fresh = browser.new_context()
            fresh.set_offline(True)
            p2 = fresh.new_page()
            try:
                p2.goto(URL, wait_until='commit', timeout=15000)
                opened = p2.locator('.pv-slider').count() > 0
            except Exception:
                opened = False
            print(f'4. never visited + network off: page opened = {opened} (expected False: open the page once while online)')
            ok = ok and not opened
            fresh.close()
            browser.close()
    finally:
        srv.shutdown()
    print('RESULT:', 'PASS' if ok else 'FAIL')
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
