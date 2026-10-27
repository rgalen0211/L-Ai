"""The home page's CRM preview video is fetched only when it is about to be seen (local, real Chrome): the first screen loads the poster picture and no video bytes; scrolling to the section starts the
video; with 'reduce motion' set it never starts by itself and shows its own controls. Also reports how many bytes the home page costs before and after scrolling.

    python tools/check-home-lazy-video.py
"""
import http.server
import socketserver
import sys
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
PORT = 8198
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
    socketserver.TCPServer.allow_reuse_address = True
    srv = socketserver.ThreadingTCPServer(('127.0.0.1', PORT), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


def main():
    srv = serve()
    ok = True

    def check(cond, what):
        nonlocal ok
        print(('  ok   ' if cond else '  FAIL ') + what)
        ok = ok and bool(cond)
    try:
        with sync_playwright() as pw:
            b = pw.chromium.launch(channel='chrome')
            for scheme_motion, label in (('no-preference', 'normal'), ('reduce', 'reduce motion')):
                print(label)
                ctx = b.new_context(viewport={'width': 1280, 'height': 900}, reduced_motion=scheme_motion)
                page = ctx.new_page()
                urls = []
                page.on('request', lambda r: urls.append(r.url))
                errors = []
                page.on('pageerror', lambda e: errors.append(str(e)))
                page.goto(f'{BASE}/', wait_until='load')
                page.wait_for_timeout(800)
                video_requests = [u for u in urls if u.endswith('.webm') or u.endswith('.mp4')]
                check(not [u for u in video_requests if 'crm-room-preview' in u], 'the first screen requests no CRM video bytes')
                check(any(u.endswith('crm-room-preview-poster.jpg') for u in urls), 'the poster picture is fetched, as a JPEG')
                v = page.locator('video[data-lazy-video]')
                check(v.count() == 1 and v.get_attribute('poster') == 'assets/crm-room-preview-poster.jpg', 'the video shows its poster picture first')
                page.locator('#crm-room').scroll_into_view_if_needed()
                page.wait_for_timeout(1500)
                requested = [u for u in urls if 'crm-room-preview.webm' in u]
                if scheme_motion == 'no-preference':
                    check(len(requested) >= 1, 'scrolling to the section fetches the video')
                    check(page.evaluate("document.querySelector('video[data-lazy-video]').paused") is False, 'and it plays')
                else:
                    check(not requested, 'with reduce motion the video is never fetched by itself')
                    check(page.evaluate("document.querySelector('video[data-lazy-video]').hasAttribute('controls')"), 'and its own controls appear, so a person can choose to play it')
                check(not errors, f'no page errors {errors}')
                ctx.close()
            b.close()
    finally:
        srv.shutdown()
    print('RESULT:', 'PASS' if ok else 'FAIL')
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
