"""First-party funnel tracking in real Chrome: (1) the Funnel section on #/admin/ops (mock mode, fake counts): steps with conversion, by source, by week, the weeks buttons, desktop and
phone; (2) /ryagram/?utm_source=... with the switch forced on and the database call intercepted: exactly ONE call, to funnel_anon, with the cleaned source, and one small record in
local storage, no cookie. Writes screenshots. Not part of the node suite (it needs Chrome).

    python tools/check-funnel.py [outdir]        (default D:/Ryagram-scratch/WEB/funnel-shots)
"""
import http.server
import json
import socketserver
import sys
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('D:/Ryagram-scratch/WEB/funnel-shots')
PORT = 8174
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
                p.on('console', lambda m: errors.append(m.text) if m.type == 'error' and 'status of 404' not in m.text else None)
                # 1. Ryan's Funnel section
                p.goto(f'{BASE}/app/?mock#/admin/ops', wait_until='load')
                p.wait_for_selector('section.ops-section:has-text("Funnel")', timeout=20000)
                sec = p.locator('section.ops-section', has_text='Funnel (last')
                text = sec.inner_text()
                check('Funnel (last 8 weeks)' in text and 'Saw the landing page' in text and 'Signed up' in text and 'Bought credits' in text, 'the steps are listed')
                check('10%' in text, 'with the conversion between steps (400 visits -> 40 signups)')
                check('By source' in text and 'youtube' in text and 'reddit.com' in text, 'by source')
                check('By week' in text and '2026-10-12' in text, 'and by week')
                check(sec.locator('table.funnel-steps tbody tr').count() == 13, 'thirteen step rows')
                check(p.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), 'no sideways scroll')
                sec.screenshot(path=str(OUT / f'funnel-{name}.png'))
                sec.get_by_role('button', name='12 weeks').click()
                p.wait_for_selector('section.ops-section:has-text("Funnel (last 12 weeks)")', timeout=10000)
                check(True, 'the weeks buttons reload it')
                check(not errors, f'no page errors {errors}')
                ctx.close()
                # 2. the landing page: one call, cleaned, one small record, no cookie
                # (automated and headless browsers are skipped on purpose, so this context looks like an ordinary one)
                ctx = b.new_context(**opts, user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36')
                ctx.add_init_script("Object.defineProperty(navigator, 'webdriver', { get: () => false })")
                p = ctx.new_page()
                calls = []

                def config(route):
                    r = route.fetch()
                    route.fulfill(response=r, body=r.text().replace('funnelTracking: false', 'funnelTracking: true'))
                p.route('**/assets/ryagram-config.js*', config)
                p.route('**/rest/v1/rpc/**', lambda route: (calls.append((route.request.url, route.request.post_data)), route.fulfill(status=204, body='', headers={'access-control-allow-origin': '*'})))
                p.goto(f'{BASE}/ryagram/?utm_source=YouTube&utm_medium=Video&utm_campaign=oct-launch', wait_until='load')
                p.wait_for_timeout(1500)
                funnel_calls = [c for c in calls if c[0].endswith('/funnel_anon')]
                check(len(funnel_calls) == 1, f'exactly one funnel call ({len(funnel_calls)})')
                body = json.loads(funnel_calls[0][1]) if funnel_calls else {}
                check(body.get('p_event') == 'landing_view' and body.get('p_utm_source') == 'youtube' and body.get('p_utm_medium') == 'video' and body.get('p_utm_campaign') == 'oct-launch', f'landing_view with the cleaned source {body}')
                check(json.loads(p.evaluate("localStorage.getItem('ryagram-source')"))['s'] == 'youtube', 'one small record in local storage')
                check(p.evaluate('document.cookie') == '', 'and no cookie')
                ctx.close()
            b.close()
    finally:
        srv.shutdown()
    print('RESULT:', 'PASS' if ok else 'FAIL')
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
