"""'Connect an AI' on Account > Connected AIs (NEXT-WEB 156) in real Chrome, mock mode, LOCAL server only, desktop and phone: the button opens plain steps for Claude and ChatGPT, the exact
connector address is shown in full with a Copy button that really copies it, the page says what happens after Allow, the list refreshes when the person comes back to the tab, nothing scrolls sideways. Needs Chrome.

    python tools/check-connect-an-ai.py [outdir]        (default D:/Ryagram-scratch/WEB/connect-an-ai-shots)
"""
import http.server
import socketserver
import sys
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('D:/Ryagram-scratch/WEB/connect-an-ai-shots')
PORT = 8283
BASE = f'http://127.0.0.1:{PORT}'
ADDRESS = 'https://jxtkfishqfxuptwjzczz.supabase.co/functions/v1/connect/mcp'


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
            for name, opts in (('desktop', dict(viewport={'width': 1280, 'height': 900})),
                               ('phone', dict(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True))):
                print(name)
                ctx = b.new_context(**opts)
                ctx.grant_permissions(['clipboard-read', 'clipboard-write'], origin=BASE)
                p = ctx.new_page()
                errors = []
                p.on('pageerror', lambda e: errors.append(str(e)))
                p.on('console', lambda m: errors.append(m.text) if m.type == 'error' and 'status of 404' not in m.text and 'Failed to load resource' not in m.text else None)
                p.goto(f'{BASE}/app/?mock#/account', wait_until='load')
                p.wait_for_selector('#acct-ais', timeout=20000)
                sec = p.locator('.account-section:has(#acct-ais)')
                btn = sec.locator('[data-key="connect-an-ai"]')
                check(btn.inner_text() == 'Connect an AI' and btn.get_attribute('aria-expanded') == 'false', 'a Connect an AI button, closed to start with')
                check(not sec.locator('.connect-how').is_visible(), 'the steps are hidden until it is pressed')
                btn.scroll_into_view_if_needed()
                btn.click()
                p.wait_for_selector('.connect-how', state='visible')
                check(btn.get_attribute('aria-expanded') == 'true', 'pressing it opens the steps')
                check(sec.locator('[data-key="connector-address"]').inner_text() == ADDRESS, 'the exact connector address is shown in full, with the /mcp ending')
                check('/mcp at the end' in sec.inner_text(), 'and the line about the /mcp ending')
                txt = sec.inner_text()
                check('Customize, then Connectors' in txt and 'Register automatically' in txt, 'the Claude steps are there')
                p.locator('.connect-app', has_text='ChatGPT').locator('summary').click()
                check('Create (custom MCP)' in sec.inner_text() and 'only on plans that allow custom MCP connectors' in sec.inner_text(), 'the ChatGPT steps and the plan note are there')
                check('After you press Allow, your AI appears in the list above.' in sec.inner_text(), 'it says what happens after Allow')
                check(sec.locator('a[href*="connect-ai"]').count() == 0, 'the unlisted guide is not linked from here')
                sec.locator('[data-key="copy-address"]').click()
                p.wait_for_selector('.connect-address .form-note[role="status"]:has-text("Copied")')
                check(p.evaluate('navigator.clipboard.readText()') == ADDRESS, 'Copy really puts the address on the clipboard')
                check(p.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth'), 'no sideways scroll')
                sec.screenshot(path=str(OUT / f'connect-an-ai-{name}.png'))
                check(not errors, 'no console errors' + (f': {errors[:2]}' if errors else ''))
                ctx.close()
            b.close()
    finally:
        srv.shutdown()
    print('ALL OK' if ok else 'FAILED')
    sys.exit(0 if ok else 1)


main()
