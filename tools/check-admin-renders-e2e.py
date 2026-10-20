"""The admin render-approval page (#/admin/renders) end to end in real Chrome on a LOCAL server (mock mode, 30 beta credits, auto-render OFF), desktop and phone. One person's story, from both sides:
the full render is REQUESTED and waits (30 credits become 20 available + 10 held, and the library says so); the admin page lists it; DECLINE (after a confirm, with a note) gives the credits back
(30 available, none held) and the person's order list says declined; the person asks again and the admin APPROVES it (the order runs, the credits stay held while it runs); a daily cap is SET for the
person (it appears with how much they used) and CLEARED (the person is back on the default). Local only: no non-GET request and no Supabase host. Not part of the node suite (needs Chrome).
The mock's holds (tests/fake-supabase.js: a waiting order holds its credits, decline and cancel give them back) mirror what the database does; the database's own rules are tested in the SQL suite.
Not covered here: a non-admin being refused (the SQL suite covers it; the page has no way to become a non-admin in mock mode).

    python tools/check-admin-renders-e2e.py
"""
import http.server
import socketserver
import sys
import threading
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
PORT = 8187
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


def make_ladder(p, title):
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


def balance(p):
    p.evaluate("location.hash = '#/'")
    p.wait_for_selector('#np-title', timeout=20000)
    p.wait_for_function("[...document.querySelectorAll('main p')].some(e => e.innerText.includes('available'))", timeout=10000)
    return p.evaluate("[...document.querySelectorAll('main p')].map(e => e.innerText).find(t => t.includes('available'))")


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
            for name, opts in (('desktop', dict(viewport={'width': 1280, 'height': 900})),
                               ('phone', dict(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True))):
                print(name)
                ctx = b.new_context(**opts)
                sent = []
                ctx.on('request', lambda r: sent.append(r.method + ' ' + r.url) if not r.url.startswith((BASE, 'data:', 'blob:')) and (r.method != 'GET' or '.supabase.co' in r.url) else None)
                p = ctx.new_page()
                errors = []
                p.on('pageerror', lambda e: errors.append(str(e)))
                p.on('console', lambda m: errors.append(m.text) if m.type == 'error' and 'status of 404' not in m.text and 'fake.supabase.co' not in m.text and 'media-src' not in m.text else None)
                p.on('dialog', lambda d: d.accept())
                p.goto(f'{BASE}/app/?mock&autorender=off', wait_until='load')
                p.wait_for_selector('#np-title', timeout=20000)
                check('30 credits available' in balance(p) and 'held' not in balance(p), 'the person starts with 30 credits, none held')
                make_ladder(p, 'Admin film')
                p.get_by_role('button', name='Render final film').click()
                p.wait_for_selector('.order-list li', timeout=15000)
                check('Waiting for approval' in p.inner_text('.order-list'), 'the full render is requested and waits for approval')
                line = balance(p)
                check('20 credits available, 10 held by jobs in progress' in line, f'the credits are held and the library says so ({line!r})')
                # the admin page
                p.evaluate("location.hash = '#/admin/renders'")
                p.wait_for_selector('.render-queue li', timeout=15000)
                text = p.inner_text('.render-queue')
                check('Admin film' in text and '10 credits held' in text and '1 full render waiting for your approval' in p.inner_text('main'), 'the admin page lists it, with the credits held')
                # decline gives the credits back
                p.locator('.render-queue li input[placeholder^="Note"]').fill('Not this week')
                p.locator('.render-queue li').first.get_by_role('button', name='Decline').click()
                p.wait_for_function("!document.querySelector('.render-queue')", timeout=10000)
                check('No full renders are waiting for approval.' in p.inner_text('main'), 'Decline (after a confirm): the queue is empty')
                st = p.evaluate("JSON.stringify(window.ryagramMock.client.db.render_orders.map(o => [o.state, o.admin_note]))")
                check(st == '[["declined","Not this week"]]', f'the order is declined with the admin’s note ({st})')
                line = balance(p)
                check('30 credits available' in line and 'held' not in line, f'the credits are back and nothing is held ({line!r})')
                p.evaluate("() => { const db = window.ryagramMock.client.db; location.hash = '#/v/' + db.versions[db.versions.length - 1].id; }")
                p.wait_for_selector('.order-list li', timeout=15000)
                t = p.inner_text('.order-list')
                check('Not approved' in t and 'was not approved' in t, f'the person’s order list says in words that it was not approved ({t[:140]!r})')
                # asks again, and the admin approves
                p.get_by_role('button', name='Render final film').click()
                p.wait_for_function("window.ryagramMock.client.db.render_orders.filter(o => o.state === 'awaiting_approval').length === 1", timeout=15000)
                check('20 credits available, 10 held' in balance(p), 'asking again holds the credits again')
                p.evaluate("location.hash = '#/admin/renders'")
                p.wait_for_selector('.render-queue li', timeout=15000)
                # caps: set 7, then clear it
                row = p.locator('.render-queue li').first
                row.get_by_placeholder('credits a day').fill('7')
                row.get_by_role('button', name='Set daily cap').click()
                p.wait_for_function("document.querySelector('.render-caps').innerText.includes('creator@example.com: 0 of 7 credits')", timeout=10000)
                check(True, 'a daily cap of 7 is set and listed with how much has been used')
                li = p.locator('.render-caps li', has_text='creator@example.com')
                li.locator('input').fill('')
                li.get_by_role('button', name='Save').click()
                p.wait_for_function("!document.querySelector('.render-caps').innerText.includes('creator@example.com')", timeout=10000)
                check('sam@example.com: 12 of 30' in p.inner_text('.render-caps'), 'clearing it removes only that person’s cap; the other cap is untouched')
                # approve
                p.locator('.render-queue li').first.get_by_role('button', name='Approve').click()
                p.wait_for_function("!document.querySelector('.render-queue')", timeout=10000)
                states = p.evaluate("JSON.stringify(window.ryagramMock.client.db.render_orders.map(o => o.state))")
                check(states == '["declined","running"]', f'Approve: the second request is running ({states})')
                check('10 held' in balance(p), 'and its credits stay held while it runs')
                check(not p.evaluate('document.documentElement.scrollWidth > window.innerWidth + 1'), 'no sideways scroll')
                check(not sent, f'no non-GET request and no Supabase host {sent[:3]}')
                check(not errors, f'no page errors {errors}')
                ctx.close()
            b.close()
    finally:
        srv.shutdown()
    print('RESULT:', 'PASS' if ok else 'FAIL')
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
