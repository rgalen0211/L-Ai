"""The Terms and AI-content placeholder pages in real Chrome at desktop and phone: the DRAFT banner, no sideways scroll, the footer links on the app page. Writes screenshots.
Not part of the node suite (it needs Chrome).   python tools/check-legal-shells.py [outdir]   (default D:/Ryagram-scratch/WEB/legal-shots)
"""
import http.server
import socketserver
import sys
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('D:/Ryagram-scratch/WEB/legal-shots')
PORT = 8174
BASE = f'http://127.0.0.1:{PORT}'


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

    def check(cond, what):
        nonlocal ok
        print(('  ok   ' if cond else '  FAIL ') + what)
        ok = ok and bool(cond)
    try:
        with sync_playwright() as pw:
            b = pw.chromium.launch(channel='chrome')
            for name, opts in (('desktop', dict(viewport={'width': 1280, 'height': 900})),
                               ('phone', dict(viewport={'width': 390, 'height': 844}, device_scale_factor=3, is_mobile=True, has_touch=True))):
                print(name)
                ctx = b.new_context(**opts)
                p = ctx.new_page()
                errors = []
                p.on('pageerror', lambda e: errors.append(str(e)))
                p.on('console', lambda m: errors.append(m.text) if m.type == 'error' and 'status of 404' not in m.text else None)
                for path, title in (('/terms/', 'Terms of Use'), ('/ai-content/', 'AI content labelling')):
                    p.goto(BASE + path, wait_until='load')
                    check(p.inner_text('h1') == title, f'{path} heading')
                    check('Pending legal review' in p.inner_text('.shell-banner'), f'{path} banner says pending legal review')
                    check(p.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), f'{path} no sideways scroll')
                    p.screenshot(path=str(OUT / f"{path.strip('/')}-{name}.png"), full_page=True)
                    p.click('footer a[href="/help/"]')
                    check(p.url.endswith('/help/'), f'{path} footer Help link works')
                p.goto(f'{BASE}/app/?mock', wait_until='load')
                p.wait_for_selector('#np-title', timeout=20000)
                links = p.eval_on_selector_all('footer.app-foot a', 'els => els.map(e => e.getAttribute("href"))')
                check('/terms/' in links and '/ai-content/' in links and '/privacy-policy.html' in links, f'the app footer links Terms, Privacy and AI content ({links})')
                p.click('footer.app-foot a[href="/terms/"]')
                p.wait_for_selector('.shell-banner')
                check(True, 'the app footer Terms link opens the shell')
                check(not errors, f'no console errors {errors[:2]}')
                ctx.close()
            b.close()
    finally:
        srv.shutdown()
    print('RESULT:', 'PASS' if ok else 'FAIL')
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
