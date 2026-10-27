"""The delivery page (/app/#/delivery/<id>) and the credits lines, end to end in real Chrome on a LOCAL server (mock mode: fake data, 30 beta credits), desktop and phone, following a smoke-film flow:
a free contact sheet and preview, then the final render is REQUESTED (auto-render on, so it starts at once), the credits are HELD and the library says so, the render completes and the hold is CAPTURED
(the balance drops, nothing is held), the film is delivered and "Open your film" leads to the delivery page: a video, an "Open or download" link, the AI-assisted label and the 30-day note.
Then the page's honest failures: a film that was deleted after its 30 days, an id that is not a film, and a hash that is not an id (it must not reach the delivery view).
Local only: nothing is sent to a Supabase host. Not part of the node suite (needs Chrome).

    python tools/check-delivery-e2e.py
"""
import http.server
import socketserver
import sys
import threading
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
PORT = 8186
BASE = f'http://127.0.0.1:{PORT}'
DELIVERY = '11111111-1111-4111-8111-111111111111'
GONE = '22222222-2222-4222-8222-222222222222'
UNKNOWN = '33333333-3333-4333-8333-333333333333'


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


def run_until_ladder(p):
    """Use the first template, then run the sheet and the preview in the mock worker."""
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
                p.goto(f'{BASE}/app/?mock', wait_until='load')
                p.wait_for_selector('#np-title', timeout=20000)
                check('30 credits available' in p.inner_text('.credit-balance, main') and 'held' not in p.inner_text('main').split('30 credits available')[1][:40], 'the library starts at 30 credits available, none held')
                p.fill('#np-title', 'Smoke film')
                p.click('button:has-text("Create")')
                p.wait_for_selector('h1:has-text("Version 1")', timeout=20000)
                run_until_ladder(p)
                led = p.evaluate("JSON.stringify(window.ryagramMock.client.db.jobs.map(j => [j.job_type, j.held || 0, j.captured || 0]))")
                check('"contact_sheet",0,0' in led.replace(' ', '') and '"preview",0,0' in led.replace(' ', ''), f'the contact sheet and the preview are free: nothing held ({led})')
                p.get_by_role('button', name='Render final film').click()
                p.wait_for_selector('.jobs-panel .job:has-text("Final render")', timeout=15000)
                held = p.evaluate("window.ryagramMock.client.db.jobs.filter(j => j.job_type === 'final_render').map(j => j.held)")
                check(len(held) == 1 and held[0] > 0, f'the final render holds its credits ({held})')
                p.evaluate("location.hash = '#/'")
                p.wait_for_selector('#np-title', timeout=20000)
                p.wait_for_function("document.body.innerText.includes('held by jobs in progress')", timeout=10000)
                line = p.evaluate("[...document.querySelectorAll('main p')].map(e => e.innerText).find(t => t.includes('available'))")
                check(f'{30 - held[0]} credits available, {held[0]} held by jobs in progress' in line, f'the library says it in words ({line!r})')
                # the render completes: the hold is captured
                p.evaluate("""() => { const db = window.ryagramMock.client.db; const v = db.versions[db.versions.length - 1]; location.hash = '#/v/' + v.id; }""")
                p.wait_for_timeout(500)
                p.evaluate("() => { window.__fast = setInterval(() => window.ryagramMock.worker.tick(), 130) }")
                end = time.time() + 60
                while time.time() < end and not p.evaluate("window.ryagramMock.client.db.jobs.filter(j => j.job_type === 'final_render').every(j => j.state === 'complete')"):
                    p.wait_for_timeout(300)
                p.evaluate('clearInterval(window.__fast)')
                after = p.evaluate("JSON.stringify(window.ryagramMock.client.db.jobs.filter(j => j.job_type === 'final_render').map(j => [j.state, j.held, j.captured, j.released]))")
                check(after == f'[["complete",{held[0]},{held[0]},0]]', f'a finished render CAPTURES its hold ({after})')
                p.evaluate("location.hash = '#/'")
                p.wait_for_selector('#np-title', timeout=20000)
                p.wait_for_function(f"document.body.innerText.includes('{30 - held[0]} credits available')", timeout=10000)
                line = p.evaluate("[...document.querySelectorAll('main p')].map(e => e.innerText).find(t => t.includes('available'))")
                check(f'{30 - held[0]} credits available' in line and 'held' not in line, f'the balance is down by the price and nothing is held ({line!r})')
                # delivered: Open your film -> the delivery page
                p.evaluate("""(id) => { const db = window.ryagramMock.client.db; db.render_orders.push({ id: 'o-e2e', owner_id: 'u-ryan', state: 'delivered', want: 'final', source: 'app', project_id: db.versions[db.versions.length - 1].project_id,
                  version_id: db.versions[db.versions.length - 1].id, created_at: new Date().toISOString(), stages: [{ stage: 'final_render', state: 'complete', credits_quoted: 10, job_id: null }], delivery: { id, label: 'AI-assisted', expires_at: '2026-11-17T00:00:00Z', deleted: false } }); }""", DELIVERY)
                p.evaluate("() => { const db = window.ryagramMock.client.db; const v = db.versions[db.versions.length - 1]; location.hash = '#/v/' + v.id; }")
                p.wait_for_selector('a:has-text("Open your film")', timeout=20000)
                check(p.evaluate("window.ryagramMock.client.db.versions[window.ryagramMock.client.db.versions.length - 1].state") == 'complete', 'the version is complete (its render finished), and "Open your film" is still on the page')
                p.click('a:has-text("Open your film")')
                p.wait_for_selector('video', timeout=15000)
                main = p.inner_text('main')
                check(p.get_attribute('video', 'src') and 'Open or download' in main, 'the delivery page has the video and an Open or download link')
                check('AI-assisted' in main and 'kept for 30 days, then deleted' in main and 'works for an hour' in main, 'with the AI-assisted label, the 30-day note and the one-hour link note')
                check(p.locator('a:has-text("Open or download")').get_attribute('rel') == 'noopener noreferrer', 'the outside link opens safely (noopener noreferrer)')
                check(not p.evaluate('document.documentElement.scrollWidth > window.innerWidth + 1'), 'no sideways scroll')
                # honest failures
                p.evaluate("""(id) => { const db = window.ryagramMock.client.db; db.render_orders.push({ id: 'o-gone', state: 'delivered', stages: [], delivery: { id, label: 'x', expires_at: '2026-10-01T00:00:00Z', deleted: true } }); }""", GONE)
                p.evaluate(f"location.hash = '#/delivery/{GONE}'")
                p.wait_for_selector('.app-error:visible', timeout=10000)
                check('kept for its 30 days and has been deleted' in p.inner_text('.app-error:visible') and p.locator('video').count() == 0, 'a film past its 30 days says so and shows no player')
                p.evaluate(f"location.hash = '#/delivery/{UNKNOWN}'")
                p.wait_for_function("[...document.querySelectorAll('main .app-error')].some(e => e.innerText.includes('not found'))", timeout=10000)
                check(p.locator('video').count() == 0, 'an id that is not a film says "Film not found." and shows no player')
                p.evaluate("location.hash = '#/delivery/not-an-id'")
                p.wait_for_timeout(600)
                check('Your film' not in p.inner_text('main') or p.locator('video').count() == 0, 'a hash that is not an id does not reach the delivery view')
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
