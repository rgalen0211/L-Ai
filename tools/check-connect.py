"""The hosted OAuth consent page and Account > Connected AIs in real Chrome, mock mode (fake data, a mock of CONNECT's four functions), desktop and phone: who is asking, the exact
place the person goes back to, what the AI can do (tickable), that credit-spending tools ask first, Approve and Deny; a refused request shows only its reason; Approve with nothing
ticked is refused in words; the browser goes ONLY to the address shown; the list shows the connection with Disconnect. Writes screenshots. Not part of the node suite (needs Chrome).

    python tools/check-connect.py [outdir]        (default D:/Ryagram-scratch/WEB/connect-shots)
"""
import http.server
import socketserver
import sys
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('D:/Ryagram-scratch/WEB/connect-shots')
PORT = 8180
BASE = f'http://127.0.0.1:{PORT}'
GOOD = '00000000-0000-4000-8000-0000000000aa'
BLOCKED = '00000000-0000-4000-8000-0000000000bb'
EXPIRED = '00000000-0000-4000-8000-0000000000cc'


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
                               ('phone', dict(viewport={'width': 390, 'height': 844}, device_scale_factor=3, is_mobile=True, has_touch=True))):
                print(name)
                ctx = b.new_context(**opts)
                p = ctx.new_page()
                errors, went = [], []
                p.on('pageerror', lambda e: errors.append(str(e)))
                p.on('console', lambda m: errors.append(m.text) if m.type == 'error' and 'status of 404' not in m.text and 'Failed to load resource' not in m.text else None)
                # the AI's callback is intercepted: we only record WHERE the browser went
                p.route('https://claude.ai/**', lambda route: (went.append(route.request.url), route.fulfill(status=200, content_type='text/html', body='<p>AI callback</p>')))
                p.goto(f'{BASE}/app/?mock#/connect/consent?request={GOOD}', wait_until='load')
                p.wait_for_selector('h1:has-text("Connect Claude to Ryagram?")', timeout=20000)
                main_text = p.inner_text('main')
                check('Claude is asking to work with your Ryagram account' in main_text, 'it names who is asking')
                check('https://claude.ai/api/mcp/auth_callback' in main_text and 'claude.ai' in p.inner_text('.consent-uri'), 'it shows the EXACT address you go back to, and its host')
                check(p.locator('.consent-scopes input[type=checkbox]').count() == 3 and p.locator('.consent-scopes input:checked').count() == 3, 'three things it can do, all ticked')
                check('See your projects, films and credit balance' in main_text and 'Make contact sheets and previews (free)' in main_text, 'in plain words')
                check('Tools that spend credits will ask you first.' in main_text and 'acts as your Ryagram account' in main_text and 'disconnect it any time' in main_text, 'the always-true lines are there')
                check(p.get_by_role('button', name='Approve').is_visible() and p.get_by_role('button', name='Deny').is_visible(), 'Approve and Deny')
                check(went == [], 'nothing has gone anywhere before a button is pressed')
                p.screenshot(path=str(OUT / f'consent-{name}.png'), full_page=True)
                for box in p.locator('.consent-scopes input[type=checkbox]').all():
                    box.uncheck()
                p.get_by_role('button', name='Approve').click()
                p.wait_for_selector('.app-error:has-text("Choose at least one thing")', timeout=10000)
                check(went == [], 'Approve with nothing ticked is refused in words, nothing sent')
                p.locator('#cs-read').check()
                p.locator('#cs-render-free').check()
                p.get_by_role('button', name='Approve').click()
                p.wait_for_url('https://claude.ai/**', timeout=15000)
                check(went and went[0].startswith('https://claude.ai/api/mcp/auth_callback?code=MOCKCODE'), f'the browser goes to the shown address with the answer ({went[:1]})')
                ctx.close()
                # the account page: empty, then (the mock lives in one page's memory) a connection made by the mock's own state
                ctx = b.new_context(**opts)
                p = ctx.new_page()
                p.on('dialog', lambda d: d.accept())
                p.route('https://claude.ai/**', lambda route: route.fulfill(status=200, content_type='text/html', body='<p>AI callback</p>'))
                p.goto(f'{BASE}/app/?mock#/account', wait_until='load')
                p.wait_for_selector('h2:has-text("Connected AIs")', timeout=20000)
                check('No AI is connected to your account.' in p.inner_text('.account-section:has(#acct-ais)'), 'the list starts empty')
                p.evaluate(f"location.hash = '#/connect/consent?request={GOOD}'")
                p.wait_for_selector('button:has-text("Approve")', timeout=15000)
                p.locator('#cs-write').uncheck()
                p.route('https://claude.ai/**', lambda route: route.fulfill(status=200, content_type='text/html', body='<p>AI callback</p>'))
                p.get_by_role('button', name='Approve').click()
                p.wait_for_url('https://claude.ai/**', timeout=15000)
                p.go_back()
                p.wait_for_timeout(500)
                # back in the app (the mock was reset by the reload), so check the list through the mock's state instead
                p.goto(f'{BASE}/app/?mock#/account', wait_until='load')
                p.evaluate("""() => { const db = window.ryagramMock.client.db; db.connected = [{ client_id: 'client-claude', client_name: 'Claude', scopes: ['read', 'render_free'], connected_at: new Date().toISOString(), last_used_at: null, calls_30d: 0 }]; }""")
                p.evaluate("() => { location.hash = '#/'; setTimeout(() => { location.hash = '#/account'; }, 50); }")
                p.wait_for_selector('.connected-list li', timeout=15000)
                text = p.inner_text('.connected-list')
                check('Claude' in text and 'See your projects' in text and 'last used never' in text, f'the list shows Claude with what it may do ({text[:60]!r})')
                p.screenshot(path=str(OUT / f'connected-{name}.png'), full_page=True)
                p.get_by_role('button', name='Disconnect').click()
                p.wait_for_selector('text=Claude is disconnected.', timeout=10000)
                check('No AI is connected to your account.' in p.inner_text('main'), 'Disconnect removes it and says so')
                # Deny
                p.evaluate(f"location.hash = '#/connect/consent?request={GOOD}'")
                p.wait_for_selector('button:has-text("Deny")', timeout=15000)
                p.get_by_role('button', name='Deny').click()
                p.wait_for_url('https://claude.ai/**', timeout=15000)
                check('error=access_denied' in p.url, 'Deny goes back with error=access_denied')
                ctx.close()
                # refused requests show only the reason
                for req, word in ((BLOCKED, 'This account can’t connect an AI.'), (EXPIRED, 'expired'), ('00000000-0000-4000-8000-0000000000ee', 'not found')):
                    ctx = b.new_context(**opts)
                    p = ctx.new_page()
                    p.goto(f'{BASE}/app/?mock#/connect/consent?request={req}', wait_until='load')
                    p.wait_for_selector('#library p.app-error', timeout=15000)
                    check(word in p.inner_text('main') and p.get_by_role('button', name='Approve').count() == 0, f'a refused request ({req[-2:]}) shows its reason and no Approve')
                    ctx.close()
                ctx = b.new_context(**opts)
                p = ctx.new_page()
                p.goto(f'{BASE}/app/?mock#/connect/consent?request=nope', wait_until='load')
                p.wait_for_selector('#np-title', timeout=15000)
                check(p.get_by_role('button', name='Approve').count() == 0, 'a malformed request id is not the consent page at all')
                check(not errors, f'no page errors {errors}')
                ctx.close()
            b.close()
    finally:
        srv.shutdown()
    print('RESULT:', 'PASS' if ok else 'FAIL')
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
