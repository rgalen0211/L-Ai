"""The creator beta flow in real Chrome, mock mode (fake data), phone and desktop: a creator requests a film and sees it in their list; Ryan sees it in the queue,
starts it, delivers it with a link (the creator then sees "Watch your film"); declines one and the credits come back; approves an application and gets an invite
code shown once with the mailto link. Writes screenshots. Not part of the node suite (it needs Chrome).

    python tools/check-creator-flow.py [outdir]        (default D:/Ryagram-scratch/WEB/flow-shots)
"""
import http.server
import socketserver
import sys
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('D:/Ryagram-scratch/WEB/flow-shots')
PORT = 8169
BASE = f'http://127.0.0.1:{PORT}'
Q = 'Which states built the most apartments between 2015 and 2024?'


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
                               ('phone', dict(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True))):
                print(name)
                ctx = b.new_context(**opts)
                p = ctx.new_page()
                errors = []
                p.on('pageerror', lambda e: errors.append(str(e)))
                p.goto(f'{BASE}/app/?mock#/request', wait_until='load')
                p.wait_for_selector('#rq-question', timeout=20000)
                t = p.inner_text('main, #app-root, body')
                check('A film request costs 10 credits. If we cannot make it, you get them back.' in t, 'the page says what a request costs and that credits come back')
                check('30' in p.locator('.credit-balance').first.inner_text(), 'the balance (30 beta credits in mock mode) is shown')
                p.fill('#rq-question', 'short')
                p.click('button:has-text("Send request")')
                p.wait_for_timeout(300)
                check(p.evaluate("!document.getElementById('rq-question').checkValidity()") or 'at least a few words' in p.inner_text('body'), 'a too-short question is stopped before it is sent')
                p.fill('#rq-question', Q)
                p.fill('#rq-notes', 'Use county data if you can.')
                p.click('button:has-text("Send request")')
                p.wait_for_selector('text=Request #1 sent', timeout=10000)
                body = p.inner_text('body')
                check('#1 Waiting' in body and Q in body, 'the request shows in "Your requests" as Waiting')
                check('20' in p.locator('.credit-balance').first.inner_text(), 'the 10 credits were taken (20 left)')
                p.screenshot(path=str(OUT / f'flow-{name}-request.png'), full_page=True)

                # Ryan: the queue
                p.goto(f'{BASE}/app/?mock#/admin/ops', wait_until='load')
                p.wait_for_selector('text=Film requests (1)', timeout=20000)
                sec = p.locator('section.ops-section', has=p.locator('h2', has_text='Film requests')).first
                st = sec.inner_text()
                check(Q in st and 'creator@example.com' in st and 'Use county data if you can.' in st, 'the queue shows the question, the notes and who asked')
                sec.screenshot(path=str(OUT / f'flow-{name}-queue.png'))
                sec.get_by_role('button', name='Start').click()
                p.wait_for_timeout(700)
                sec = p.locator('section.ops-section', has=p.locator('h2', has_text='Film requests')).first
                check('#1 In progress' in sec.inner_text(), 'Start moves it to In progress')
                sec.locator('input[type=url]').first.fill('http://insecure.example/f')
                sec.get_by_role('button', name='Mark delivered').click()
                p.wait_for_timeout(500)
                check('https link' in p.inner_text('body') and 'In progress' in sec.inner_text(), 'delivering without an https link is refused')
                sec.locator('input[type=url]').first.fill('https://youtu.be/abc123')
                sec.get_by_role('button', name='Mark delivered').click()
                p.wait_for_timeout(700)
                check('Film requests (0)' in p.inner_text('body'), 'delivered leaves the waiting queue')

                # the creator sees the film
                p.goto(f'{BASE}/app/?mock#/request', wait_until='load')
                p.wait_for_selector('#rq-question')
                p.wait_for_timeout(500)
                link = p.locator('a:has-text("Watch your film")')
                check(link.count() == 1 and link.get_attribute('href') == 'https://youtu.be/abc123' and link.get_attribute('rel') == 'noopener noreferrer', 'the creator sees "Watch your film" with the https link')
                check('#1 Delivered' in p.inner_text('body'), 'and the status says Delivered')

                # a declined request gives the credits back
                p.fill('#rq-question', Q + ' (second)')
                p.click('button:has-text("Send request")')
                p.wait_for_selector('text=Request #2 sent', timeout=10000)
                check('10' in p.locator('.credit-balance').first.inner_text(), 'a second request: 10 left')
                p.goto(f'{BASE}/app/?mock#/admin/ops', wait_until='load')
                p.wait_for_selector('text=Film requests (1)', timeout=20000)
                sec = p.locator('section.ops-section', has=p.locator('h2', has_text='Film requests')).first
                sec.get_by_role('button', name='Decline (returns 10 credits)').click()
                p.wait_for_timeout(700)
                p.goto(f'{BASE}/app/?mock#/request', wait_until='load')
                p.wait_for_selector('#rq-question')
                p.wait_for_timeout(500)
                check('20' in p.locator('.credit-balance').first.inner_text() and 'Declined, your credits were returned' in p.inner_text('body'), 'declined: the credits are back and the creator is told')

                # approve an application and get the invite code, once
                p.goto(f'{BASE}/app/?mock#/admin/ops', wait_until='load')
                p.wait_for_selector('text=Creator beta applications (2)', timeout=20000)
                csec = p.locator('section.ops-section', has=p.locator('h2', has_text='Creator beta applications')).first
                csec.get_by_role('button', name='Approve and make an invite code').first.click()
                p.wait_for_timeout(700)
                csec = p.locator('section.ops-section', has=p.locator('h2', has_text='Creator beta applications')).first
                ct = csec.inner_text()
                check('RYA-K7M2-9QPX' in ct and '(shown once; copy it now)' in ct and 'Creator beta applications (1)' in ct, 'the invite code is shown once, and the application leaves the waiting list')
                mail = csec.locator('a:has-text("Email it to")')
                check(mail.count() == 1 and mail.get_attribute('href').startswith('mailto:'), 'with a mailto: link Ryan sends himself')
                csec.screenshot(path=str(OUT / f'flow-{name}-invite.png'))
                csec.get_by_role('button', name='Done').click()
                p.wait_for_timeout(500)
                check('RYA-K7M2-9QPX' not in p.inner_text('body'), 'Done clears the code from the screen (it cannot be shown again)')
                check(not errors, f'no page errors {errors}')
                ctx.close()
            b.close()
    finally:
        srv.shutdown()
    print('RESULT:', 'PASS' if ok else 'FAIL')
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
