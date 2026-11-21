"""The Version page follows a running job by itself (WEB 11-21, customer step: a free-preview user follows their own film). Real Chrome, mock mode, one browser.
  1. a running job's status line moves on its own ("Working... 2 min" -> "3 min") with no reload, one read at a time about every 10 s;
  2. a read that never comes back does not freeze the page: it is given up on after 30 s and the status line moves again;
  3. when the job ends the line says so and the page stops reading; leaving the page stops it too.
Not part of the node suite (it needs Chrome).   python tools/check-job-poll.py   (about 2 minutes)
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
    try:
        with sync_playwright() as pw:
            b = pw.chromium.launch(channel='chrome')
            p = b.new_page(viewport={'width': 1280, 'height': 900})
            errors = []
            p.on('pageerror', lambda e: errors.append(str(e)))
            p.goto(f'{base}/app/?mock', wait_until='load')
            p.wait_for_selector('#np-title', timeout=20000)
            p.fill('#np-title', 'Poll film')
            p.click('button:text-is("Create")')
            p.wait_for_selector('h1:has-text("Version 1")', timeout=20000)
            # count every read of the jobs (one current_engine_commit call per read); hang the next one when asked
            p.evaluate("""() => { const c = window.ryagramMock.client, real = c.rpc.bind(c); window.__reads = 0; window.__hang = false;
              c.rpc = (name, ...a) => { if (name === 'current_engine_commit') { window.__reads++; if (window.__hang) { window.__hang = false; return new Promise(() => {}); } } return real(name, ...a); }; }""")
            p.evaluate("""() => { const c = window.ryagramMock.client, db = c.db, id = location.hash.split('/')[2].split('?')[0];
              const ago = s => new Date(Date.now() - s * 1000).toISOString();
              db.jobs.push({ id: 'j-poll', version_id: id, job_type: 'preview', state: 'running', attempt: 1, created_at: ago(140), started_at: ago(140), progress_detail: null });
              c.jobChanged(db.jobs[db.jobs.length - 1]); }""")
            line = lambda: p.evaluate("(document.querySelector('.job-list .working') || {}).textContent || ''")
            p.wait_for_function("() => document.querySelector('.job-list .working')", timeout=20000)
            first = line()
            print('first status line:', repr(first))
            r0 = p.evaluate('window.__reads')
            p.wait_for_function("() => document.querySelector('.job-list .working').textContent.includes('3 min')", timeout=40000)
            check(True, f'1. the status line moved on its own: {first!r} -> {line()!r}')
            r1 = p.evaluate('window.__reads')
            check(r1 > r0, f'1. the page read the job again by itself ({r1 - r0} reads)')
            # 2. a hung read
            p.evaluate("window.__hang = true")
            h0 = p.evaluate('window.__reads')
            p.wait_for_function("n => window.__reads > n", arg=h0, timeout=15000)      # the hung one started
            hung_at = p.evaluate('window.__reads')
            before = line()
            p.wait_for_function("n => window.__reads > n", arg=hung_at + 1, timeout=60000)   # a later read ran although the first never answered
            check(True, '2. a read that never answers is given up on; later reads run')
            p.wait_for_function("t => document.querySelector('.job-list .working').textContent !== t", arg=before, timeout=90000)
            check(True, f'2. the status line still moves after the hang: {before!r} -> {line()!r}')
            # 3. the job ends
            p.evaluate("""() => { const c = window.ryagramMock.client, j = c.db.jobs.find(x => x.id === 'j-poll'); j.state = 'complete'; j.ended_at = new Date().toISOString(); c.jobChanged(j); }""")
            p.wait_for_function("() => !document.querySelector('.job-list .working')", timeout=20000)
            check('Complete' in p.inner_text('.job-list'), '3. a finished job reads Complete and the Working line is gone')
            p.wait_for_timeout(2000)
            r2 = p.evaluate('window.__reads')
            p.wait_for_timeout(25000)
            check(p.evaluate('window.__reads') == r2, '3. with nothing running (and Realtime connected) the page stops reading')
            # leaving the page: start a job again, leave, no more reads
            p.evaluate("""() => { const c = window.ryagramMock.client, db = c.db, id = location.hash.split('/')[2].split('?')[0];
              db.jobs.push({ id: 'j-poll2', version_id: id, job_type: 'preview', state: 'running', attempt: 1, created_at: new Date().toISOString(), started_at: new Date().toISOString(), progress_detail: null });
              c.jobChanged(db.jobs[db.jobs.length - 1]); }""")
            p.wait_for_function("() => document.querySelector('.job-list .working')", timeout=20000)
            p.evaluate("location.hash = '#/'")
            p.wait_for_selector('#np-title', timeout=20000)
            p.wait_for_timeout(1500)
            r3 = p.evaluate('window.__reads')
            p.wait_for_timeout(25000)
            check(p.evaluate('window.__reads') == r3, '3. after leaving the page, it reads no more')
            check(not errors, f'no page errors: {errors[:2]}')
            b.close()
    finally:
        srv.shutdown()
    print('PASS' if ok else 'FAIL')
    sys.exit(0 if ok else 1)


main()
