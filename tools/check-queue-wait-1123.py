"""A stranger waiting in line (WEB 11-23, BUILDER's queue audit). Real Chrome, mock mode, one browser.
  1. a contact sheet waiting behind others reads 'Number N in line.' with the rough estimate and 'may take longer';
  2. the 'Rendering is delayed' banner appears on the waiting page by itself (the 10-second read), says nothing about 'an hour', and goes away when rendering is back;
  3. no service-status request while nothing waits and no notice shows. (The button reasons 'waiting in line' / 'being made' are pinned in tests/queue-words-1123.test.mjs: a blank film's reason hides them here.)
Not part of the node suite (it needs Chrome).   python tools/check-queue-wait-1123.py   (about 1 minute)
"""
import http.server, socketserver, sys, threading
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]


class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=str(ROOT), **k)

    def log_message(self, *a):
        pass

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()


def main():
    srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), H)
    base = f'http://127.0.0.1:{srv.server_address[1]}'
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    ok = True

    def check(cond, what):
        nonlocal ok
        print(('  ok   ' if cond else '  FAIL ') + what)
        ok = ok and bool(cond)
    with sync_playwright() as pw:
        b = pw.chromium.launch(channel='chrome')
        try:
            p = b.new_page(viewport={'width': 1280, 'height': 900})
            errors = []
            p.on('pageerror', lambda e: errors.append(str(e)))
            p.goto(f'{base}/app/?mock', wait_until='load')
            p.wait_for_selector('#np-title', timeout=20000)
            p.fill('#np-title', 'Queue film')
            p.click('button:text-is("Create")')
            p.wait_for_selector('h1:has-text("Version 1")', timeout=20000)
            p.evaluate("""() => { const c = window.ryagramMock.client, real = c.rpc.bind(c); window.__status = 0; window.__delayed = false;
              c.rpc = (name, ...a) => { if (name === 'service_status') { window.__status++; return Promise.resolve({ data: { rendering: window.__delayed ? 'delayed' : 'ok', last_check_in: '2026-11-23T10:02:00Z' }, error: null }); } return real(name, ...a); }; }""")
            # nothing waits and no notice shows: the page does not ask for the service status at all
            p.wait_for_timeout(1500)
            s0 = p.evaluate('window.__status')
            p.wait_for_timeout(12000)
            check(p.evaluate('window.__status') == s0, '3. nothing waiting and no notice: no service-status request in a full tick')
            # three films ahead, then this version's contact sheet
            p.evaluate("""() => { const c = window.ryagramMock.client, db = c.db, id = location.hash.split('/')[2].split('?')[0];
              const ago = s => new Date(Date.now() - s * 1000).toISOString();
              ['a', 'b', 'c'].forEach((k, i) => db.jobs.push({ id: 'j-ahead-' + k, version_id: 'other-' + k, owner_id: 'someone', job_type: 'preview', state: 'queued', attempt: 1, created_at: ago(300 - i), params: {} }));
              db.jobs.push({ id: 'j-mine', version_id: id, job_type: 'contact_sheet', state: 'queued', attempt: 1, created_at: ago(10), params: {} });
              c.jobChanged(db.jobs[db.jobs.length - 1]); }""")
            p.wait_for_function("() => /in line/.test((document.querySelector('.job-list') || {}).textContent || '')", timeout=20000)
            txt = p.inner_text('.job-list')
            print('queue line:', repr(txt))
            check('Number 4 in line. The machine makes one film at a time. At about 5 minutes for each film ahead of yours, that is about 15 minutes, and it may take longer.' in txt, '1. the waiting contact sheet reads its place, the estimate and "may take longer"')
            # the banner comes by itself, then goes
            check(p.evaluate("!document.querySelector('.delayed-notice')"), '2. no banner while rendering is fine')
            p.evaluate("window.__delayed = true")
            p.wait_for_selector('.delayed-notice', timeout=30000)
            bt = p.inner_text('.delayed-notice')
            print('banner:', repr(bt))
            check(bt.startswith('Rendering is delayed.') and 'an hour' not in bt and 'stays down for a long time' in bt, '2. the banner appears on the waiting page by itself, without "an hour"')
            check(p.evaluate("document.querySelectorAll('.delayed-notice').length") == 1, '2. exactly one banner')
            p.evaluate("window.__delayed = false")
            p.wait_for_function("() => !document.querySelector('.delayed-notice')", timeout=30000)
            check(True, '2. the banner goes away by itself when rendering is back')
            check(not errors, f'no page errors: {errors}')
        finally:
            b.close()
    srv.shutdown()
    print('PASS' if ok else 'FAIL')
    sys.exit(0 if ok else 1)


main()
