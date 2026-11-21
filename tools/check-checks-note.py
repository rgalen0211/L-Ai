"""The last preview step (\"Checking the film against its data 454 / 454\") says it can take several minutes, and no other step says it (WEB 11-21). Real Chrome, mock mode, desktop and phone.
Not part of the node suite (it needs Chrome).   python tools/check-checks-note.py
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
            for name, opts in (('desktop', dict(viewport={'width': 1280, 'height': 900})), ('phone', dict(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True))):
                print(name)
                p = b.new_context(**opts).new_page()
                errors = []
                p.on('pageerror', lambda e: errors.append(str(e)))
                p.goto(f'{base}/app/?mock', wait_until='load')
                p.wait_for_selector('#np-title', timeout=20000)
                p.fill('#np-title', 'Step film')
                p.click('button:text-is("Create")')
                p.wait_for_selector('h1:has-text("Version 1")', timeout=20000)
                SAID = 'This step can take several minutes.'
                def stage(detail):
                    p.evaluate("""d => { const c = window.ryagramMock.client, db = c.db, id = location.hash.split('/')[2].split('?')[0];
                      let j = db.jobs.find(x => x.id === 'j-step');
                      if (!j) { j = { id: 'j-step', version_id: id, job_type: 'preview', state: 'running', attempt: 1, created_at: c.now(), started_at: c.now() }; db.jobs.push(j); }
                      j.progress_detail = d; c.jobChanged(j); }""", detail)
                    p.wait_for_function("d => document.querySelector('.job-progress') && (!d.stage || document.querySelector('.job-progress').innerText.includes(d.label))", arg={'stage': detail['stage'], 'label': detail['label']}, timeout=20000)
                    return p.inner_text('.job-progress')
                t = stage({'stage': 'drawing', 'done': 100, 'total': 300, 'unit': 'frames', 'label': 'Drawing frames'})
                check(SAID not in t, 'drawing: no several-minutes line')
                t = stage({'stage': 'checks', 'done': 454, 'total': 454, 'unit': 'clips', 'label': 'Checking the film against its data'})
                print(repr(t))
                check(SAID in t and '454 / 454' in t, 'checks at 454 / 454: the line is there under the count')
                check(not any(w in t for w in ('minutes left', 'will take', 'exactly')), 'no promise of a fixed time')
                check(not errors, f'no page errors: {errors[:2]}')
            b.close()
    finally:
        srv.shutdown()
    print('PASS' if ok else 'FAIL')
    sys.exit(0 if ok else 1)


main()
