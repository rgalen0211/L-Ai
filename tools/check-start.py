"""The AI-first front door in real Chrome, mock mode (fake account, fake connected-AI list), desktop and phone, with aiFirst switched on in a LOCAL copy of the config only:
no AI connected -> the plain address lands on Connect your AI; Not now (7 days) sends you to the library with the one-line bar; connecting an AI (the mock consent) -> Start a film with six
lines and Claude / ChatGPT / Copy on each, the Claude button highlighted and its address a new-chat link with the line and its tail encoded; the library strip; an account that is not invited
never sees the door or the strip; with the flag OFF (the committed config) nothing changes. Writes screenshots. Not part of the node suite (it needs Chrome).

    python tools/check-start.py [outdir]        (default D:/Ryagram-scratch/WEB/start-shots)
"""
import http.server
import re
import socketserver
import sys
import threading
from pathlib import Path
from urllib.parse import quote

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('D:/Ryagram-scratch/WEB/start-shots')
PORT = 8183
BASE = f'http://127.0.0.1:{PORT}'
GOOD = '00000000-0000-4000-8000-0000000000aa'
TAIL = 'Use the Ryagram connector. Show me a free contact sheet before anything that costs credits.'


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
    cfg = (ROOT / 'assets' / 'ryagram-config.js').read_text(encoding='utf-8')
    check(re.search(r'aiFirst:\s*true', cfg), 'the committed config has aiFirst ON (Ryan 2026-10-28, Q303)')
    off = re.sub(r'aiFirst:\s*true', 'aiFirst: false', cfg)                      # the 'flag off' cases below run against this
    flipped = cfg
    try:
        with sync_playwright() as pw:
            b = pw.chromium.launch(channel='chrome')
            for name, opts in (('desktop', dict(viewport={'width': 1280, 'height': 900})),
                               ('phone', dict(viewport={'width': 390, 'height': 844}, device_scale_factor=3, is_mobile=True, has_touch=True))):
                print(name)

                def page(ctx, flag=True):
                    ctx.route('**/assets/ryagram-config.js*', (lambda body: (lambda route: route.fulfill(status=200, content_type='text/javascript', body=body)))(flipped if flag else off))
                    ctx.route('https://claude.ai/**', lambda route: route.abort())          # the approval's redirect goes nowhere, so the page (and its fake data) stays
                    p = ctx.new_page()
                    errors = []
                    p.on('pageerror', lambda e: errors.append(str(e)))
                    p.on('console', lambda m: errors.append(m.text) if m.type == 'error' and 'status of 404' not in m.text and 'Failed to load resource' not in m.text else None)
                    return p, errors

                # 1. no AI connected: the plain address lands on the door
                ctx = b.new_context(**opts)
                p, errors = page(ctx)
                p.goto(f'{BASE}/app/?mock&door#/', wait_until='load')
                p.wait_for_selector('h1:has-text("Use your AI to make films")', timeout=20000)
                check(p.evaluate('location.hash') == '#/start', 'no AI connected: the plain address lands on #/start')
                t = p.inner_text('main')
                check('Connect Claude' in t and 'Connect ChatGPT (beta)' in t and 'No AI? Build it step by step' in t and 'Not now' in t, 'Connect Claude, Connect ChatGPT (beta), the builder link and Not now are there')
                hrefs = p.eval_on_selector_all('main a.button', 'els => els.map(e => e.getAttribute("href"))')
                check('/connect-ai/#claude' in hrefs and '/connect-ai/#chatgpt' in hrefs, 'the two connect buttons go to the steps for each app')
                check(p.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth'), 'no sideways scroll')
                p.screenshot(path=str(OUT / f'connect-{name}.png'), full_page=True)
                # 2. Not now: library with the one-line bar, and it stays that way after a reload
                p.click('#start-notnow')
                p.wait_for_selector('h1:has-text("Your projects")', timeout=10000)
                check('Connect your AI to start films by talking' in p.inner_text('main'), 'Not now: the library shows the one-line bar')
                p.screenshot(path=str(OUT / f'library-bar-{name}.png'), full_page=True)
                p.reload(wait_until='load')
                p.wait_for_selector('h1:has-text("Your projects")', timeout=10000)
                check(p.evaluate('location.hash') in ('#/', ''), 'after a reload the 7-day Not now still holds: no redirect')
                p.evaluate("localStorage.setItem('ryagram.start.notnow', String(Date.now() - 8 * 24 * 3600 * 1000))")
                p.reload(wait_until='load')
                p.wait_for_selector('h1:has-text("Use your AI to make films")', timeout=10000)
                check(True, 'eight days later the door comes back')
                # 3. with an AI connected (?aiconnected: the mock starts with Claude connected) the door shows Start a film
                p.goto(f'{BASE}/app/?mock&aiconnected#/start', wait_until='load')
                p.wait_for_selector('h1:has-text("Start a film")', timeout=20000)
                t = p.inner_text('main')
                check('Claude is connected' in t, 'the pill says which AI is connected')
                check(p.locator('.start-line').count() == 6, 'six starting lines')
                first = 'Make me a film about housing costs in my county'
                href = p.eval_on_selector('.start-line:first-child a:has-text("Claude")', 'e => e.href')
                check(href == 'https://claude.ai/new?q=' + quote(first + ' ' + TAIL, safe="-_.!~*'()"), 'Claude opens a new chat with the line and its tail encoded in the address')
                href2 = p.eval_on_selector('.start-line:first-child a:has-text("ChatGPT")', 'e => e.href')
                check(href2.startswith('https://chatgpt.com/?q=') and 'housing' in href2, 'ChatGPT opens a new chat the same way')
                check(p.locator('.start-line:first-child a.primary:has-text("Claude")').count() == 1 and p.locator('.start-line:first-child a.primary:has-text("ChatGPT")').count() == 0, 'the connected AI\'s button is the highlighted one')
                check(p.locator('.start-line button:has-text("Copy")').count() == 6, 'every line has Copy')
                check('No AI? Build it step by step' in t and 'Connected AIs' in t, 'the builder link and Connected AIs are the footer')
                check(p.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth'), 'no sideways scroll')
                small = p.evaluate("[...document.querySelectorAll('.start-line .button')].filter(e => e.getBoundingClientRect().height < 43).length")
                check(small == 0, 'every button is at least 44 px tall')
                p.screenshot(path=str(OUT / f'start-{name}.png'), full_page=True)
                # 4. the library strip
                p.goto(f'{BASE}/app/?mock&aiconnected#/', wait_until='load')
                p.wait_for_selector('h1:has-text("Your projects")', timeout=20000)
                check(p.evaluate('location.hash') in ('#/', ''), 'with an AI connected the plain address stays on the library')
                check(p.locator('.start-strip a.start-pill-link').count() == 4, 'the strip has three lines and More lines')
                p.screenshot(path=str(OUT / f'library-strip-{name}.png'), full_page=True)
                check(errors == [], 'no console errors')
                ctx.close()
                # 5. an account that is not invited: no door, no strip
                ctx = b.new_context(**opts)
                p, errors = page(ctx)
                p.goto(f'{BASE}/app/?mock&noinvite#/', wait_until='load')
                p.wait_for_selector('h1:has-text("Your projects")', timeout=20000)
                check(p.evaluate('location.hash') in ('#/', '') and p.locator('.start-strip, .start-bar').count() == 0, 'not invited: the library, no bar, no strip')
                p.goto(f'{BASE}/app/?mock&noinvite#/start', wait_until='load')
                p.wait_for_selector('h1:has-text("Your projects")', timeout=20000)
                check('Use your AI' not in p.inner_text('main'), 'not invited: #/start shows the library, never the door')
                check(errors == [], 'no console errors')
                ctx.close()
                # 6. the flag OFF (the committed config): nothing changes
                ctx = b.new_context(**opts)
                p, errors = page(ctx, flag=False)
                p.goto(f'{BASE}/app/?mock&door#/', wait_until='load')
                p.wait_for_selector('h1:has-text("Your projects")', timeout=20000)
                check(p.evaluate('location.hash') in ('#/', '') and p.locator('.start-strip, .start-bar').count() == 0, 'flag off: the library, no bar, no strip')
                p.goto(f'{BASE}/app/?mock&door#/start', wait_until='load')
                p.wait_for_selector('h1:has-text("Your projects")', timeout=20000)
                check('Use your AI' not in p.inner_text('main'), 'flag off: #/start shows the library')
                check(errors == [], 'no console errors')
                ctx.close()
            b.close()
    finally:
        srv.shutdown()
    print('ALL OK' if ok else 'FAILED')
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
