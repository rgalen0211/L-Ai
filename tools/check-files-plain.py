"""The Files list shows only what a customer uses (WEB 11-21): the film, preview, contact sheet and thumbnail; the receipt and usage note the render machine keeps are not listed.
Real Chrome, mock mode. Not part of the node suite (it needs Chrome).   python tools/check-files-plain.py
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
            p.fill('#np-title', 'Files film')
            p.click('button:text-is("Create")')
            p.wait_for_selector('h1:has-text("Version 1")', timeout=20000)
            check(p.locator('#files-title').count() == 1 and 'Nothing rendered' in p.inner_text('section[aria-labelledby=files-title]'), 'before any film the Files list says nothing is rendered')
            p.evaluate("""() => { const c = window.ryagramMock.client, db = c.db, id = location.hash.split('/')[2].split('?')[0], v = db.versions.find(x => x.id === id);
              const job = { id: 'j-files', version_id: id, project_id: v.project_id, owner_id: v.owner_id, job_type: 'preview', state: 'complete', attempt: 1, created_at: c.now(), started_at: c.now(), ended_at: c.now(), progress_detail: null };
              db.jobs.push(job);
              for (const [kind, file, mime, bytes] of [['preview', 'preview.mp4', 'video/mp4', 6100000], ['thumbnail', 'thumb.jpg', 'image/jpeg', 88000], ['receipt', 'receipt.sequence.json', 'application/json', 5100], ['receipt_text', 'receipt.txt', 'text/plain', 900], ['metering', 'metering.json', 'application/json', 700]])
                db.artifacts.push({ id: c.newId(), owner_id: v.owner_id, project_id: v.project_id, version_id: id, job_id: job.id, kind, storage_path: `${v.owner_id}/${v.project_id}/${id}/${job.id}/${file}`, mime, bytes, duration_s: null, width: null, height: null, created_at: c.now(), deleted_at: null });
              c.jobChanged(job); }""")
            p.wait_for_function("() => document.querySelectorAll('.file-list li').length > 0", timeout=20000)
            text = p.inner_text('.file-list')
            print(repr(text))
            check(p.locator('.file-list li').count() == 2, 'only the two things a customer uses are listed (preview, thumbnail)')
            check('Preview' in text and 'Thumbnail' in text, 'the preview and thumbnail are there, in plain names')
            check(not any(w in text for w in ('Receipt', 'Metering', 'Usage note', 'receipt', 'metering')), 'no Receipt, Metering or Usage note')
            check(not errors, f'no page errors: {errors[:2]}')
            b.close()
    finally:
        srv.shutdown()
    print('PASS' if ok else 'FAIL')
    sys.exit(0 if ok else 1)


main()
