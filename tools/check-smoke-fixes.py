"""Smoke-test fixes in real Chrome, mock mode, desktop and phone: the locked Render final film button (not-allowed cursor + a reason on hover), a refusal in plain words
with the raw text behind "Get help with this", and a running job with no progress data reading "Working…" plus elapsed time. Writes screenshots.
Not part of the node suite (it needs Chrome).   python tools/check-smoke-fixes.py [outdir]   (default D:/Ryagram-scratch/WEB/smoke-shots)
"""
import http.server
import socketserver
import sys
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('D:/Ryagram-scratch/WEB/smoke-shots')
PORT = 8175
BASE = f'http://127.0.0.1:{PORT}'


class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=str(ROOT), **k)

    def log_message(self, *a):
        pass

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    socketserver.TCPServer.allow_reuse_address = True
    srv = socketserver.ThreadingTCPServer(('127.0.0.1', PORT), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
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
                p.goto(f'{BASE}/app/?mock', wait_until='load')
                p.wait_for_selector('#np-title', timeout=20000)
                p.fill('#np-title', 'Smoke film')
                p.click('button:has-text("Create")')
                p.wait_for_selector('h1:has-text("Version 1")', timeout=20000)
                fb = p.get_by_role('button', name='Render final film')
                fb.scroll_into_view_if_needed()
                check(fb.is_disabled(), 'the final render button is off before a sheet and preview exist')
                check(p.evaluate("getComputedStyle(document.querySelector('.run-step button.primary')).cursor") == 'not-allowed', 'its cursor is not-allowed (not the wait wheel)')
                blank_title = fb.get_attribute('title') or ''
                check(blank_title == 'Choose a film above first.', f'a BLANK project says to choose a film first: {blank_title!r}')       # (King's Island W1)
                p.wait_for_selector('.template-picker summary', timeout=20000)
                if p.locator('details.template-picker[open]').count() == 0:
                    p.click('.template-picker summary')
                p.click('button:has-text("Use this film")')
                p.wait_for_function("document.body.innerText.includes('Template applied and saved')", timeout=20000)
                title = fb.get_attribute('title') or ''
                check(len(title) > 10 and 'contact sheet' in title.lower(), f'hover reason on a real story (the original proof): {title!r}')
                check('null' not in p.inner_text('main').split(), 'no stray "null" word under the final render button')
                # a failed job with the engine jargon, and a running job the worker never reported on
                p.evaluate("""() => { const db = window.ryagramMock.client.db; const v = { id: location.hash.split('/')[2].split('?')[0] };
                  db.jobs.push({ id: 'j-bad', version_id: v.id, job_type: 'preview', state: 'failed', error_class: 'invalid_input', error_detail: "$: unknown key 'outro'", attempt: 1, created_at: new Date().toISOString(), progress_detail: null });
                  db.jobs.push({ id: 'j-run', version_id: v.id, job_type: 'contact_sheet', state: 'running', attempt: 1, created_at: new Date(Date.now() - 125000).toISOString(), started_at: new Date(Date.now() - 125000).toISOString(), progress_detail: null }); }""")
                h = p.evaluate('location.hash')
                p.evaluate("location.hash = '#/'")
                p.wait_for_selector('#np-title', timeout=20000)
                p.evaluate('(h) => { location.hash = h }', h)                      # leave and come back: the page reads the jobs again (the mock keeps its data)
                p.wait_for_selector('.job-list', timeout=20000)
                text = p.inner_text('.job-list')
                check('Working' in text and 'Stage' not in text.split('Working')[0][-0:] and ('2 min' in text), f'a running job with no data says Working and the time: {text[:200]!r}')
                check('unknown key' not in p.inner_text('.job-problem') and 'outro' in p.inner_text('.job-problem') and '$' not in p.inner_text('.job-problem'), 'the refusal is plain words')
                p.click('summary:has-text("Get help with this")')
                check("$: unknown key 'outro'" in p.inner_text('.job-help'), 'the raw text is behind Get help with this')
                check(p.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), 'no sideways scroll')
                p.screenshot(path=str(OUT / f'smoke-{name}.png'), full_page=True)
                check(not errors, f'no console errors {errors[:2]}')
                ctx.close()
            b.close()
    finally:
        srv.shutdown()
    print('RESULT:', 'PASS' if ok else 'FAIL')
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
