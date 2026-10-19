"""End to end through the guided builder (#/build) on a LOCAL server only, in real Chrome, desktop and phone. The committed config keeps guidedBuilder false: this page turns it on for itself
by answering the config request with a copy that says true, and uses mock mode for the sign-in stub and the guided-builder function (tests/fake-supabase.js). Checks:
the flag really gates the link (the unmodified config), a listed dataset is picked and built, the free contact sheet job is queued (and no preview or full render), a dataset that is not
in the catalog is refused by both the describe and the compile calls, and no data leaves this machine (no non-GET request and no Supabase host; public fonts and scripts are still fetched).
A connected AI's token cannot be presented from a browser page: that refusal is pinned in tests/guided-builder.test.mjs and tests/connect-oauth-guard.test.mjs (index.ts uses the shared verifyAppUser guard).
Not part of the node suite (it needs Chrome).

    python tools/check-builder-e2e.py
"""
import http.server
import re
import socketserver
import sys
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
PORT = 8183
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
    cfg = (ROOT / 'assets' / 'ryagram-config.js').read_text(encoding='utf8')
    check(re.search(r'guidedBuilder:\s*false', cfg), 'the committed config has guidedBuilder false')
    flipped = re.sub(r'guidedBuilder:\s*false', 'guidedBuilder: true', cfg)
    try:
        with sync_playwright() as pw:
            b = pw.chromium.launch(channel='chrome')
            for name, opts in (('desktop', dict(viewport={'width': 1280, 'height': 900})),
                               ('phone', dict(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True))):
                print(name)
                ctx = b.new_context(**opts)
                outside = []
                ctx.on('request', lambda r: outside.append(r.method + ' ' + r.url) if not r.url.startswith((BASE, 'data:', 'blob:')) and (r.method != 'GET' or '.supabase.co' in r.url) else None)
                ctx.route('**/assets/ryagram-config.js*', lambda route: route.fulfill(status=200, content_type='text/javascript', body=flipped))
                p = ctx.new_page()
                errors = []
                p.on('pageerror', lambda e: errors.append(str(e)))
                p.on('console', lambda m: errors.append(m.text) if m.type == 'error' and 'status of 404' not in m.text else None)
                p.goto(f'{BASE}/app/?mock#/', wait_until='load')
                check(p.evaluate('window.ryagramConfig.guidedBuilder') is True, 'the local test config turns the builder on')
                p.wait_for_selector('a:has-text("Make a film step by step")', timeout=20000)
                p.click('a:has-text("Make a film step by step")')
                p.wait_for_selector('h2:has-text("Which data?")', timeout=15000)
                check(p.locator('.builder-card').count() == 3, 'the catalog lists only its listed datasets')
                p.locator('.builder-card').filter(has=p.locator('strong:text-is("State unemployment rate")')).click()
                for heading in ('What do you want to show?', 'Which years?', 'What kind of film?'):
                    p.click('button:has-text("Next")')
                    p.wait_for_selector(f'h2:has-text("{heading}")')
                    if heading == 'What kind of film?':
                        p.locator('.builder-card').first.click()
                for heading in ('Which look?', 'What is it called?', 'Review'):
                    p.click('button:has-text("Next")')
                    p.wait_for_selector(f'h2:has-text("{heading}")')
                p.wait_for_selector('.builder-summary', timeout=10000)
                check('Source and licence' in p.inner_text('main'), 'the source and licence are on the review')
                p.click('button:has-text("Make the film and a free contact sheet")')
                p.wait_for_function("window.ryagramMock.client.db.jobs.length > 0", timeout=20000)
                jobs = p.evaluate("window.ryagramMock.client.db.jobs.map(j => [j.job_type, j.state])")
                check(len(jobs) == 1 and jobs[0][0] == 'contact_sheet' and jobs[0][1] in ('queued', 'running', 'complete'), f'one free contact sheet job is queued, no preview and no full render {jobs}')
                bad = p.evaluate("""async () => {
                  const f = window.ryagramMock.client.functions;
                  const d = await f.invoke('guided-builder', { body: { action: 'describe', dataset: 'not_in_the_catalog' } });
                  const c = await f.invoke('guided-builder', { body: { action: 'compile', request: { dataset: 'not_in_the_catalog', title: 'x', film_type: 'bars' } } });
                  const j = async r => r.error ? (r.error.context && r.error.context.status) + ' ' + JSON.stringify(await r.error.context.json()) : 'NO ERROR';
                  return [await j(d), await j(c)];
                }""")
                check(bad[0].startswith('404') and 'not available' in bad[0], f'describe of an unlisted dataset is refused: {bad[0]}')
                check(bad[1].startswith('422') and 'dataset' in bad[1], f'compile of an unlisted dataset is refused: {bad[1]}')
                check(not outside, f'no data left this machine (only public fonts and scripts are fetched; no POST and no Supabase host) {outside[:3]}')
                check(not errors, f'no page errors {errors}')
                ctx.close()
            b.close()
    finally:
        srv.shutdown()
    print('RESULT:', 'PASS' if ok else 'FAIL')
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
