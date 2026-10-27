"""The Windows card's invite-only download button in real Chrome, mock mode, LOCAL server only (CONNECT's app-download function, Cloudflare R2; Ryan 2026-10-26 20:26): with a release record that
points at the function's address the card shows a BUTTON (no direct link); nothing is asked until it is pressed; pressing it asks the (mock) function for a link and the browser DOWNLOADS from the R2
address it returns (the R2 host is answered locally with a tiny file, so nothing leaves this computer); the card keeps a link to it with how long it works; each refusal (?dlerr=401/403/404/429/503)
shows its plain sentence and follows nothing. Desktop and phone. Writes screenshots. Not part of the node suite (needs Chrome).

    python tools/check-windows-download.py [outdir]     (default D:/Ryagram-scratch/WEB/windows-download-shots)
"""
import http.server
import socketserver
import sys
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('D:/Ryagram-scratch/WEB/windows-download-shots')
PORT = 8195
SHA = 'c' * 64
RECORD = ("window.ryagramWindowsApp = Object.freeze({ url: 'https://abcdefghij.supabase.co/functions/v1/app-download', fileName: 'Ryagram-for-Windows.zip', sizeMb: 274, unpackedMb: 736, sha256: '" + SHA + "', personalUseNotice: null });")
SENTENCES = {401: 'Sign in first.', 403: 'The Ryagram app is for invited testers for now. Ask Ryan to turn it on for your account.', 404: 'The download is not ready yet.',
             429: 'You have asked for the download three times in the last day. Try again tomorrow.', 503: 'The download is not set up yet.'}


class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=str(ROOT), **k)

    def log_message(self, *a):
        pass

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    socketserver.TCPServer.allow_reuse_address = True
    srv = socketserver.ThreadingTCPServer(('127.0.0.1', PORT), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    ok = True

    def check(c, w):
        nonlocal ok
        print(('  ok   ' if c else '  FAIL ') + w)
        ok = ok and bool(c)
    try:
        with sync_playwright() as pw:
            b = pw.chromium.launch(channel='chrome')
            try:
                for name, opts in (('desktop', dict(viewport={'width': 1000, 'height': 900})),
                                   ('phone', dict(viewport={'width': 390, 'height': 844}, device_scale_factor=3, is_mobile=True, has_touch=True))):
                    print(name)
                    for query, code in (('?mock&tester', None), ('?mock&tester&dlerr=429', 429), ('?mock&tester&dlerr=403', 403), ('?mock&tester&dlerr=404', 404), ('?mock&tester&dlerr=503', 503), ('?mock&tester&dlerr=401', 401)):
                        ctx = b.new_context(accept_downloads=True, **opts)
                        external, r2 = [], []

                        def route(r):
                            u = r.request.url
                            if u.startswith(f'http://127.0.0.1:{PORT}'):
                                if '/assets/windows-release.js' in u:
                                    return r.fulfill(status=200, content_type='application/javascript', body=RECORD)
                                return r.continue_()
                            if '.r2.cloudflarestorage.com' in u:
                                r2.append(u)
                                return r.fulfill(status=200, headers={'content-type': 'application/zip', 'content-disposition': 'attachment; filename="Ryagram-for-Windows.zip"'}, body=b'PK')
                            external.append(u)
                            return r.abort()
                        ctx.route('**/*', route)
                        p = ctx.new_page()
                        errs = []
                        p.on('pageerror', lambda e: errs.append(str(e)))
                        p.goto(f'http://127.0.0.1:{PORT}/app/{query}#/account', wait_until='load')
                        card = p.locator('.windows-card')
                        card.wait_for(timeout=20000)
                        t = card.inner_text()
                        label = 'download' if code is None else f'refusal {code}'
                        check(card.locator('a.button').count() == 0 and card.locator('#windows-download').count() == 1, f'{label}: the card shows a button and no direct link')
                        check('about 736 MB unpacked' in t and 'about 1.3 GB free' in t and 'Ryagram-for-Windows.zip' in t and SHA in t, f'{label}: the card shows the record\'s file name, SHA-256 and space')
                        check(len(r2) == 0 and not any('app-download' in u for u in external), f'{label}: nothing is asked before the button is pressed')
                        if code is None:
                            p.screenshot(path=str(OUT / f'card-before-{name}.png'), full_page=True)
                            with p.expect_download(timeout=15000) as dl:
                                card.locator('#windows-download').click()
                            d = dl.value
                            check(d.suggested_filename == 'Ryagram-for-Windows.zip', 'download: the browser downloads the file under its own name')
                            check(len(r2) == 1 and r2[0].startswith('https://0123456789abcdef.r2.cloudflarestorage.com/') and 'X-Amz-Expires=900' in r2[0], 'download: it came from the R2 address the function returned')
                            st = card.locator('.windows-download-status').inner_text()
                            check('Your download is starting' in st and 'works for 15 minutes' in st and card.locator('#windows-download-link').count() == 1, 'download: the card keeps a link to it with how long it works')
                            p.screenshot(path=str(OUT / f'card-after-{name}.png'), full_page=True)
                        else:
                            card.locator('#windows-download').click()
                            p.wait_for_selector('.windows-download-status .app-error', timeout=10000)
                            st = card.locator('.windows-download-status').inner_text()
                            check(st == SENTENCES[code], f'{label}: the plain sentence is shown ({st[:50]}...)')
                            check(len(r2) == 0 and card.locator('#windows-download-link').count() == 0, f'{label}: nothing is followed')
                            if code == 429:
                                p.screenshot(path=str(OUT / f'card-refused-{name}.png'), full_page=True)
                        check(p.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth'), f'{label}: no sideways scroll')
                        check(not errs, f'{label}: no page errors')
                        check(all(u.startswith(('https://fonts.googleapis.com', 'https://fonts.gstatic.com', 'https://cdn.jsdelivr.net/npm/@supabase/')) for u in external), f'{label}: nothing left this computer except the public fonts and the sign-in library ({len(external)}: {sorted(set(u.split("/")[2] for u in external))})')
                        ctx.close()
            finally:
                b.close()
    finally:
        srv.shutdown()
    print('ALL OK' if ok else 'FAILED')
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
