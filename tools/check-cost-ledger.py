"""Opens the Costs section of Ryan's Operations screen (mock mode, fake data) in real Chrome at desktop and phone width, uses its forms, and writes
screenshots. Not part of the node suite (it needs Chrome).

    python tools/check-cost-ledger.py [outdir]        (default D:/Ryagram-scratch/WEB/cost-shots)
"""
import http.server
import socketserver
import sys
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('D:/Ryagram-scratch/WEB/cost-shots')
PORT = 8167
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
                p.goto(f'{BASE}/app/?mock#/admin/ops', wait_until='load')
                p.wait_for_selector('section.ops-section:has(h2:text("Costs"))', timeout=20000)
                sec = p.locator('section.ops-section', has=p.locator('h2', has_text='Costs')).first
                t = sec.inner_text()
                check('Today $9.31 known, plus 2 events with an unknown cost (not counted)' in t, 'today: known total, and the unknown events are named, not counted as $0')
                check('Stripe test mode: 4 events (no real money, not counted)' in t, 'test-mode money is shown apart, labelled as no real money')
                check('Emails sent today by our own alerts and digests: 3' in t and 'sign-up emails are not counted' in t, 'the email reading says what it does not cover')
                check('Stripe, per day: $8.50 of $10.00 (85%), warns at 80%: WARNING' in t, 'the limit line shows where you stand')
                check('Supabase: Pro, $25.00 a month since 2026-10-01' in t, 'the plan is listed')
                check(sec.locator('table.admin-table tbody tr').count() == 14, 'the daily table has 14 days')
                check(p.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), 'no sideways scroll')
                sec.screenshot(path=str(OUT / f'costs-{name}.png'))
                # a limit: the form checks input first, then saves, then the list reloads
                sec.locator('summary', has_text='Set a limit').click()
                p.fill('#cost-th-limit', '0')
                sec.get_by_role('button', name='Save limit').click()
                p.wait_for_timeout(300)
                check(p.evaluate("!document.getElementById('cost-th-limit').checkValidity()") and 'All vendors, per month' not in sec.inner_text(), 'a $0 limit is stopped by the form itself and nothing is saved')
                p.select_option('#cost-th-vendor', '')
                p.select_option('#cost-th-period', 'month')
                p.fill('#cost-th-limit', '100')
                p.fill('#cost-th-warn', '50')
                sec.get_by_role('button', name='Save limit').click()
                p.wait_for_timeout(800)
                sec = p.locator('section.ops-section', has=p.locator('h2', has_text='Costs')).first
                check('All vendors, per month:' in sec.inner_text(), 'the new limit appears')
                # a typed cost
                sec.locator('summary', has_text='Record a cost').click()
                p.select_option('#cost-mc-vendor', 'domain')
                p.fill('#cost-mc-amount', '14.99')
                p.fill('#cost-mc-date', '2026-10-16')
                p.fill('#cost-mc-note', 'uselai.com renewal')
                sec.get_by_role('button', name='Record cost').click()
                p.wait_for_timeout(800)
                sec = p.locator('section.ops-section', has=p.locator('h2', has_text='Costs')).first
                check('Domain $14.99' in sec.inner_text(), 'a typed cost shows up under its vendor')
                check(not errors, f'no page errors {errors}')
                sec.screenshot(path=str(OUT / f'costs-{name}-after.png'))
                ctx.close()
            b.close()
    finally:
        srv.shutdown()
    print('RESULT:', 'PASS' if ok else 'FAIL')
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
