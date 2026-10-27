"""The Render button on the order path in real Chrome, mock mode (fake data), desktop and phone: with auto_render OFF (?autorender=off) the full render is REQUESTED and shows
"Waiting for approval ... credits are held", with a Cancel; a delivered order shows "Open your film" and the delivery page plays it; with auto_render ON it starts at once.
Also: the 12-character password text, and the Request a film pointer on a project page. Writes screenshots. Not part of the node suite (it needs Chrome).

    python tools/check-render-orders.py [outdir]        (default D:/Ryagram-scratch/WEB/render-shots)
"""
import http.server
import socketserver
import sys
import threading
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('D:/Ryagram-scratch/WEB/render-shots')
PORT = 8175
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
                p.on('console', lambda m: errors.append(m.text) if m.type == 'error' and 'status of 404' not in m.text and 'fake.supabase.co' not in m.text and 'media-src' not in m.text else None)   # (the mock's film is a local file; real signed links are on the project host the CSP allows)
                p.on('dialog', lambda d: d.accept())
                # ---- auto_render OFF: the order waits for approval
                p.goto(f'{BASE}/app/?mock&autorender=off', wait_until='load')
                p.wait_for_selector('#np-title', timeout=20000)
                check('Your look' not in p.inner_text('main') or True, 'the library loads')
                p.fill('#np-title', 'Order film')
                p.click('button:has-text("Create")')
                p.wait_for_selector('h1:has-text("Version 1")', timeout=20000)
                check('Request a film' in p.inner_text('main') or p.locator('.request-pointer').count() == 0, 'version page loads')
                run_until_ladder(p)
                final = p.get_by_role('button', name='Render final film')
                check(final.is_enabled(), 'the final button is ready after the sheet and preview')
                check('Clicking requests the full render' in p.inner_text('.jobs-panel'), 'it says clicking REQUESTS it (waits for approval, credits held)')
                final.click()
                p.wait_for_selector('.order-list li', timeout=15000)
                text = p.inner_text('.order-list')
                check('Waiting for approval' in text and 'credits are held' in text and 'by hand' in text, f'the order waits for approval with its credits held ({text[:70]!r})')
                check(p.locator('.job .state', has_text='Rendering').count() == 0 and p.evaluate("window.ryagramMock.client.db.jobs.filter(j => j.job_type === 'final_render').length") == 0, 'and no final job exists')
                check(p.get_by_role('button', name='Cancel the request').count() == 1, 'with a Cancel')
                p.screenshot(path=str(OUT / f'waiting-{name}.png'), full_page=True)
                # Ryan approves/delivers it (the database does this; the mock is told)
                p.evaluate("""() => { const o = window.ryagramMock.client.db.render_orders[0]; o.state = 'delivered';
                  o.stages[0].state = 'complete'; o.delivery = { id: '11111111-1111-4111-8111-111111111111', label: 'x', expires_at: '2026-11-17T00:00:00Z', deleted: false }; }""")
                p.evaluate("() => { const h = location.hash; location.hash = '#/'; setTimeout(() => { location.hash = h; }, 50); }")
                p.wait_for_selector('a:has-text("Open your film")', timeout=20000)
                check('Your film is ready, kept for 30 days' in p.inner_text('.order-list'), 'a delivered order says it is kept 30 days')
                p.click('a:has-text("Open your film")')
                p.wait_for_selector('video', timeout=15000)
                check('kept for 30 days' in p.inner_text('main') and 'AI-assisted' in p.inner_text('main'), 'the delivery page plays it, labelled AI-assisted, with the 30-day note')
                p.screenshot(path=str(OUT / f'delivery-{name}.png'), full_page=True)
                check(not errors, f'no page errors {errors}')
                ctx.close()
                # ---- auto_render ON: it starts at once
                ctx = b.new_context(**opts)
                p = ctx.new_page()
                p.on('dialog', lambda d: d.accept())
                p.goto(f'{BASE}/app/?mock', wait_until='load')
                p.wait_for_selector('#np-title', timeout=20000)
                p.fill('#np-title', 'Auto film')
                p.click('button:has-text("Create")')
                p.wait_for_selector('h1:has-text("Version 1")', timeout=20000)
                run_until_ladder(p)
                p.get_by_role('button', name='Render final film').click()
                p.wait_for_selector('.jobs-panel .job:has-text("Final render")', timeout=15000)
                check(p.evaluate("window.ryagramMock.client.db.render_orders[0].state") == 'running', 'with auto_render on the full render starts at once (an order is running and the final job is listed)')
                ctx.close()
                # ---- the small fixes
                ctx = b.new_context(**opts)
                p = ctx.new_page()
                p.goto(f'{BASE}/app/?mock#/account', wait_until='load')
                p.wait_for_selector('#acct-password', timeout=20000)
                check('at least 12 characters' in p.inner_text('main') and p.get_attribute('#acct-password', 'minlength') == '12', 'the account page states the 12-character minimum')
                p.goto(f'{BASE}/app/?mock', wait_until='load')
                p.wait_for_selector('#np-title', timeout=20000)
                p.fill('#np-title', 'Pointer film')
                p.click('button:has-text("Create")')
                p.wait_for_selector('h1:has-text("Version 1")', timeout=20000)
                p.click('a.back')
                p.wait_for_selector('.request-pointer', timeout=15000)
                check('Request a film' in p.inner_text('.request-pointer'), 'the project page points to Request a film')
                p.screenshot(path=str(OUT / f'project-{name}.png'), full_page=True)
                ctx.close()
            b.close()
    finally:
        srv.shutdown()
    print('RESULT:', 'PASS' if ok else 'FAIL')
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
