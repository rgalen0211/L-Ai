"""The money confirmations are IN the page, not window.confirm (WEB 11-18; CLAUDE (for Ryan) 23:13: the Claude app's pane and chat panels auto-answer window.confirm with No, so 'Render final film'
did nothing there). Real Chrome, mock mode, LOCAL server only (127.0.0.1), desktop and phone, with window.confirm stubbed to return false and count its calls (what the pane does):
  - Render final film opens a confirm box in the page (naming the version, the lock, and the credits), and window.confirm is never called;
  - 'No, go back' and Escape close it and start nothing; 'Yes, render it' starts the full render (an order exists);
  - with auto_render off, Cancel the request asks in the page too: No keeps the order waiting, Yes cancels it.
Needs Chrome.

    python tools/check-inpage-confirm.py [outdir]        (default D:/Ryagram-scratch/WEB/inpage-confirm-shots)
"""
import http.server
import socketserver
import sys
import threading
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('D:/Ryagram-scratch/WEB/inpage-confirm-shots')
STUB = "window.__confirmCalls = 0; window.confirm = () => { window.__confirmCalls++; return false; };"
ORDERS = "window.ryagramMock.client.db.render_orders.length"


def run_until_ladder(p):
    p.wait_for_selector('.template-picker summary', timeout=20000)
    if p.locator('details.template-picker[open]').count() == 0:
        p.click('.template-picker summary')
    p.click('button:has-text("Use this film")')
    p.wait_for_function("document.body.innerText.includes('Template applied and saved')", timeout=20000)
    for label, count in (('Make contact sheet', 1), ('Make preview', 2)):
        p.get_by_role('button', name=label).click()
        p.evaluate("() => { window.__fast = setInterval(() => window.ryagramMock.worker.tick(), 130) }")
        end = time.time() + 40
        while time.time() < end and p.locator('.job .state.job-complete').count() < count:
            p.wait_for_timeout(250)
        p.evaluate('clearInterval(window.__fast)')


def main():
    OUT.mkdir(parents=True, exist_ok=True)

    class H(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *a, **k):
            super().__init__(*a, directory=str(ROOT), **k)

        def log_message(self, *a):
            pass

        def end_headers(self):
            self.send_header('Cache-Control', 'no-store')
            super().end_headers()
    srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), H)
    base = f'http://127.0.0.1:{srv.server_address[1]}'
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    ok = True

    def check(cond, what):
        nonlocal ok
        print(('  ok   ' if cond else '  FAIL ') + what)
        ok = ok and bool(cond)

    with sync_playwright() as pw:
        b = pw.chromium.launch(channel='chrome')
        for name, opts in (('desktop', dict(viewport={'width': 1280, 'height': 900})),
                           ('phone', dict(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True))):
            for mode in ('autorender=off', ''):
                print(f'{name} {mode or "auto_render on"}')
                ctx = b.new_context(**opts)
                ctx.add_init_script(STUB)
                p = ctx.new_page()
                errs = []
                p.on('pageerror', lambda e: errs.append(str(e)))
                p.on('dialog', lambda d: (errs.append('a browser dialog opened: ' + d.message), d.dismiss()))
                p.goto(f'{base}/app/?mock{"&" + mode if mode else ""}', wait_until='load')
                p.wait_for_selector('#np-title', timeout=20000)
                p.fill('#np-title', 'Confirm film')
                p.click('button:text-is("Create")')
                p.wait_for_selector('h1:has-text("Version 1")', timeout=20000)
                run_until_ladder(p)
                final = p.get_by_role('button', name='Render final film')
                tag = f'{name} {mode or "on"}'
                final.click()
                box = p.locator('.inpage-confirm')
                box.wait_for(state='visible', timeout=5000)
                text = box.inner_text()
                check('Render the final film of version 1?' in text and 'story locks' in text, f'{tag}: the box asks in the page, naming the version and the lock')
                check('credit' in text.lower(), f'{tag}: and the credits ({text[:90]!r})')
                check(p.evaluate('window.__confirmCalls') == 0, f'{tag}: window.confirm is never called')
                check(p.evaluate(ORDERS) == 0, f'{tag}: nothing starts while it is open')
                check(box.get_by_role('button').count() == 2, f'{tag}: two plain buttons')
                p.screenshot(path=str(OUT / f'{name}-{mode or "on"}-asking.png'), full_page=True)
                box.get_by_role('button', name='No, go back').click()
                check(p.locator('.inpage-confirm').count() == 0 and p.evaluate(ORDERS) == 0, f'{tag}: No closes it and starts nothing')
                final.click()
                p.locator('.inpage-confirm').wait_for(state='visible', timeout=5000)
                p.keyboard.press('Escape')
                check(p.locator('.inpage-confirm').count() == 0 and p.evaluate(ORDERS) == 0, f'{tag}: Escape closes it and starts nothing')
                final.click()
                p.locator('.inpage-confirm').wait_for(state='visible', timeout=5000)
                p.locator('.inpage-confirm').get_by_role('button', name='Yes, render it').click()
                p.wait_for_function(f'{ORDERS} === 1', timeout=15000)
                check(p.evaluate(ORDERS) == 1 and p.locator('.inpage-confirm').count() == 0, f'{tag}: Yes starts the full render once')
                if mode:
                    p.wait_for_selector('.order-list li', timeout=15000)
                    p.get_by_role('button', name='Cancel the request').click()
                    box = p.locator('.inpage-confirm')
                    box.wait_for(state='visible', timeout=5000)
                    check('credits are returned' in box.inner_text(), f'{tag}: Cancel the request asks in the page too')
                    box.get_by_role('button', name='No, go back').click()
                    check(p.evaluate("window.ryagramMock.client.db.render_orders[0].state") not in ('cancelled', 'canceled'), f'{tag}: No keeps the order waiting')
                    p.get_by_role('button', name='Cancel the request').click()
                    p.locator('.inpage-confirm').get_by_role('button', name='Yes, cancel it').click()
                    p.wait_for_function("['cancelled','canceled'].includes(window.ryagramMock.client.db.render_orders[0].state)", timeout=15000)
                    check(True, f'{tag}: Yes cancels it')
                check(p.evaluate('window.__confirmCalls') == 0, f'{tag}: window.confirm was never called in the whole run')
                check(not errs, f'{tag}: no page errors or browser dialogs {errs[:2]}')
                ctx.close()
        b.close()
    srv.shutdown()
    print('ALL OK' if ok else 'SOME FAILED')
    sys.exit(0 if ok else 1)


main()
