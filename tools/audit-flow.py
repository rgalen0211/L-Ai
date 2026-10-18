"""Consumer-readiness walk, part 2: the FLOW of a brand-new person through the app (mock mode, fake data) at desktop and phone width, with a screenshot at each step:
new project -> the project page -> the version page (blank story) -> a ready-made film -> contact sheet -> preview -> the render step; plus sign-in errors, the invite form, the reset form
and sign-out. Records mechanical findings per step (sideways scroll, small tap targets, console errors). A person reads the screenshots for wording and layout.

    python tools/audit-flow.py [outdir]        (default D:/Ryagram-scratch/WEB/audit-shots/flow)
"""
import http.server
import json
import socketserver
import sys
import threading
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('D:/Ryagram-scratch/WEB/audit-shots/flow')
PORT = 8191
BASE = f'http://127.0.0.1:{PORT}'
SMALL = """() => [...document.querySelectorAll('a, button, input:not([type=hidden]), select, textarea, summary')].filter(el => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el);
  const inline = el.tagName === 'A' && s.display === 'inline' && !el.classList.contains('button');
  return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && !inline && (r.height < 40) && !(el.type === 'checkbox' || el.type === 'radio'); })
  .map(el => ((el.innerText || el.getAttribute('aria-label') || el.id || el.tagName).trim().slice(0, 30)) + ' ' + Math.round(el.getBoundingClientRect().height)).slice(0, 8)"""


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
    notes = []
    try:
        with sync_playwright() as pw:
            b = pw.chromium.launch(channel='chrome')
            for wname, opts in (('desktop', dict(viewport={'width': 1280, 'height': 900})), ('phone', dict(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True))):
                ctx = b.new_context(**opts)
                p = ctx.new_page()
                errs = []
                p.on('pageerror', lambda e: errs.append(str(e)[:150]))
                p.on('console', lambda m: errs.append(m.text[:150]) if m.type == 'error' and 'status of 404' not in m.text and 'fake.supabase' not in m.text else None)
                p.on('dialog', lambda d: d.accept())

                def shot(step):
                    p.wait_for_timeout(500)
                    p.screenshot(path=str(OUT / f'{step}-{wname}.png'), full_page=True)
                    notes.append({'step': step, 'width': wname, 'overflow': p.evaluate('document.documentElement.scrollWidth > window.innerWidth + 1'), 'small': p.evaluate(SMALL),
                                  'h1': p.evaluate("[...document.querySelectorAll('h1')].filter(h => h.getBoundingClientRect().height > 0).map(h => h.innerText.trim().slice(0, 50))"),
                                  'errors': list(errs)[-3:]})
                p.goto(f'{BASE}/app/?mock#/', wait_until='load')
                p.wait_for_selector('#np-title', timeout=20000)
                p.evaluate("(() => { const db = window.ryagramMock.client.db; db.projects.length = 0; db.versions.length = 0; db.jobs.length = 0; db.artifacts.length = 0; })()")
                p.evaluate("() => { location.hash = '#/x'; setTimeout(() => { location.hash = '#/'; }, 30); }")
                p.wait_for_selector('#np-title', timeout=10000)
                shot('01-empty-library')
                p.click('button:has-text("Create")')                                  # empty name
                shot('02-create-empty-name')
                p.fill('#np-title', 'Housing prices')
                p.click('button:has-text("Create")')
                p.wait_for_selector('h1:has-text("r1")', timeout=20000)
                shot('03-version-blank')
                p.click('a.back')
                p.wait_for_selector('h1:has-text("Housing prices")', timeout=10000)
                shot('04-project-page')
                p.click('.project-list a, .version-list a, ul a >> nth=0')
                p.wait_for_selector('h1:has-text("r1")', timeout=10000)
                if p.locator('details.template-picker[open]').count() == 0:
                    p.click('.template-picker summary')
                shot('05-template-picker')
                p.click('button:has-text("Use this film")')
                p.wait_for_function("document.body.innerText.includes('Template applied and saved')", timeout=20000)
                shot('06-template-applied')
                p.get_by_role('button', name='Make contact sheet').click()
                shot('07-sheet-queued')
                p.evaluate("() => { window.__fast = setInterval(() => window.ryagramMock.worker.tick(), 130) }")
                end = time.time() + 40
                while time.time() < end and p.locator('.job .state.job-complete').count() < 1:
                    p.wait_for_timeout(250)
                p.evaluate('clearInterval(window.__fast)')
                shot('08-sheet-done')
                p.get_by_role('button', name='Make preview').click()
                p.evaluate("() => { window.__fast = setInterval(() => window.ryagramMock.worker.tick(), 130) }")
                end = time.time() + 40
                while time.time() < end and p.locator('.job .state.job-complete').count() < 2:
                    p.wait_for_timeout(250)
                p.evaluate('clearInterval(window.__fast)')
                shot('09-preview-done')
                p.get_by_role('button', name='Render final film').click()
                shot('10-render-requested')
                p.goto(f'{BASE}/app/?mock#/account', wait_until='load')
                p.wait_for_selector('#acct-password', timeout=15000)
                p.fill('#acct-password', 'short')
                p.fill('#acct-password2', 'short')
                p.click('button:has-text("Change password")')
                shot('11-password-too-short')
                p.click('#sign-out')
                p.wait_for_timeout(800)
                shot('12-after-sign-out')
                ctx.close()
                # real sign-in page: errors, invite, reset
                ctx = b.new_context(**opts)
                p = ctx.new_page()
                errs = []
                p.goto(f'{BASE}/app/', wait_until='load')
                p.wait_for_selector('#si-email', timeout=15000)
                p.click('#sign-in-form button[type=submit]')
                shot('13-signin-empty')
                p.fill('#si-email', 'not-an-email')
                p.fill('#si-password', 'x')
                p.click('#sign-in-form button[type=submit]')
                shot('14-signin-bad-email')
                p.fill('#si-email', 'friend@example.com')
                p.fill('#si-password', 'wrongpassword123')
                p.click('#sign-in-form button[type=submit]')
                p.wait_for_timeout(2500)
                shot('15-signin-wrong-password')
                p.click('#have-invite')
                shot('16-invite-form')
                p.click('#forgot')
                shot('17-reset-form')
                ctx.close()
            b.close()
    finally:
        srv.shutdown()
    (OUT / 'flow.json').write_text(json.dumps(notes, indent=1), encoding='utf-8')
    for n in notes:
        print(f"{n['width'][:2]} {n['step']:<28} {'OVERFLOW ' if n['overflow'] else ''}small={len(n['small'])} h1={n['h1']} err={len(n['errors'])}")


if __name__ == '__main__':
    main()
