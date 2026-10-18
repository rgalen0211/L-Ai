"""#/admin/renders in real Chrome, mock mode (?autorender=off), desktop and phone: a person requests a full render (it waits), the admin page lists it with the film, who, the credits
held and when it expires, Approve starts it and it leaves the list, a second request is declined (after a confirm, with a note) and leaves too; the library shows the Render approvals link.
Writes screenshots. Not part of the node suite (it needs Chrome).

    python tools/check-render-approvals.py [outdir]        (default D:/Ryagram-scratch/WEB/approval-shots)
"""
import http.server
import socketserver
import sys
import threading
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('D:/Ryagram-scratch/WEB/approval-shots')
PORT = 8182
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


def request_a_render(p, title):
    p.evaluate("location.hash = '#/'")
    p.wait_for_selector('#np-title', timeout=20000)
    p.fill('#np-title', title)
    p.click('button:has-text("Create")')
    p.wait_for_selector('h1:has-text("r1")', timeout=20000)
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
    p.get_by_role('button', name='Render final film').click()
    p.wait_for_selector('.order-list li', timeout=15000)


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
                errors = []
                p.on('pageerror', lambda e: errors.append(str(e)))
                p.on('console', lambda m: errors.append(m.text) if m.type == 'error' and 'status of 404' not in m.text and 'fake.supabase.co' not in m.text and 'media-src' not in m.text else None)
                p.on('dialog', lambda d: d.accept())
                p.goto(f'{BASE}/app/?mock&autorender=off', wait_until='load')
                p.wait_for_selector('#np-title', timeout=20000)
                check(p.locator('.admin-links a:has-text("Render approvals")').count() == 1, 'the library shows the Render approvals link to an admin')
                p.evaluate("location.hash = '#/admin/renders'")
                p.wait_for_selector('h1:has-text("Render approvals")', timeout=15000)
                check('No full renders are waiting for approval.' in p.inner_text('main'), 'an empty queue says so')
                request_a_render(p, 'First film')
                request_a_render(p, 'Second film')
                p.evaluate("location.hash = '#/admin/renders'")
                p.wait_for_selector('.render-queue li', timeout=15000)
                text = p.inner_text('.render-queue')
                check(p.locator('.render-queue li').count() == 2 and 'First film' in text and 'Second film' in text, 'both waiting renders are listed')
                check('creator@example.com' in text and '10 credits held' in text and 'from the app' in text and 'Asked ' in text and ('Expires in' in text or 'has expired' in text), 'with who, credits held, the source, when it was asked and its expiry (the mock clock is fixed, so either expiry wording)')
                check('2 full renders waiting for your approval' in p.inner_text('main'), 'and a summary line')
                p.screenshot(path=str(OUT / f'queue-{name}.png'), full_page=True)
                check('Auto-render is OFF' in p.inner_text('.render-switch'), 'the switch says auto-render is OFF')
                check('sam@example.com: 12 of 30 credits used' in p.inner_text('.render-caps'), 'the caps list shows who has a cap and how much they used')
                row = p.locator('.render-queue li').first
                row.get_by_placeholder('credits a day').fill('abc')
                row.get_by_role('button', name='Set daily cap').click()
                p.wait_for_selector('p.app-error:not([hidden])')
                check('whole number of credits a day' in p.inner_text('main'), 'a bad cap is refused in words')
                row.get_by_placeholder('credits a day').fill('7')
                row.get_by_role('button', name='Set daily cap').click()
                p.wait_for_function("document.querySelector('.render-caps').innerText.includes('creator@example.com: 0 of 7 credits')", timeout=10000)
                check(True, 'Set daily cap from a waiting request: it appears in the caps list')
                li = p.locator('.render-caps li', has_text='creator@example.com')
                li.locator('input').fill('')
                li.get_by_role('button', name='Save').click()
                p.wait_for_function("!document.querySelector('.render-caps').innerText.includes('creator@example.com')", timeout=10000)
                check(True, 'emptying a cap and Save puts the person back on the default')
                p.click('#auto-render-toggle')
                p.wait_for_function("document.querySelector('.render-switch').innerText.includes('Auto-render is ON')", timeout=10000)
                check(True, 'turning auto-render on (after a confirm) shows ON')
                p.click('#auto-render-toggle')
                p.wait_for_function("document.querySelector('.render-switch').innerText.includes('Auto-render is OFF')", timeout=10000)
                check(p.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), 'no sideways scroll; switch back to OFF')
                p.screenshot(path=str(OUT / f'controls-{name}.png'), full_page=True)
                p.locator('.render-queue li').first.get_by_role('button', name='Approve').click()
                p.wait_for_function("document.querySelectorAll('.render-queue li').length === 1", timeout=10000)
                check('Second film' in p.inner_text('.render-queue') and 'First film' not in p.inner_text('.render-queue'), 'Approve: the decided request leaves the list')
                check(p.evaluate("window.ryagramMock.client.db.render_orders[0].state") == 'running', 'and its order is running')
                p.locator('.render-queue li input[placeholder^="Note"]').fill('Not this week')
                p.locator('.render-queue li').first.get_by_role('button', name='Decline').click()
                p.wait_for_function("!document.querySelector('.render-queue')", timeout=10000)
                check('No full renders are waiting for approval.' in p.inner_text('main'), 'Decline (after a confirm): it leaves too, and the queue is empty')
                st = p.evaluate("JSON.stringify(window.ryagramMock.client.db.render_orders.map(o => [o.state, o.admin_note]))")
                check(st == '[["running",null],["declined","Not this week"]]', f'the second order is declined with Ryan\u2019s note ({st})')
                check(not errors, f'no page errors {errors}')
                ctx.close()
            b.close()
    finally:
        srv.shutdown()
    print('RESULT:', 'PASS' if ok else 'FAIL')
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
