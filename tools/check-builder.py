"""The guided builder in real Chrome, mock mode (fake data and a mock of the guided-builder function), desktop and phone: all seven steps, the source and licence shown as soon as a
dataset is picked and again on the review, the engine's own refusal pointing back at the right step, the raw story behind Advanced, and the free contact sheet at the end.
Writes screenshots. Not part of the node suite (it needs Chrome).

    python tools/check-builder.py [outdir]        (default D:/Ryagram-scratch/WEB/builder-shots)
"""
import http.server
import socketserver
import sys
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('D:/Ryagram-scratch/WEB/builder-shots')
PORT = 8179
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
                p.goto(f'{BASE}/app/?mock#/', wait_until='load')
                p.wait_for_selector('a:has-text("Make a film step by step")', timeout=20000)
                p.click('a:has-text("Make a film step by step")')
                p.wait_for_selector('h2:has-text("Which data?")', timeout=15000)
                check(p.locator('.builder-steps li').count() == 7, 'seven steps are shown')
                check(p.locator('.builder-card').count() == 3 and 'Source: ' in p.inner_text('.builder-list') and 'Licence: ' in p.inner_text('.builder-list'), 'every dataset shows its source and licence in the list')
                p.fill('#bd-filter', 'health')
                check(p.locator('.builder-card').count() == 1, 'the search narrows the list')
                check(p.locator('.builder-source').count() == 0, 'no source box before a choice')
                p.click('.builder-card')
                p.wait_for_selector('.builder-source', timeout=10000)
                check('Source and licence' in p.inner_text('.builder-source') and 'public domain' in p.inner_text('.builder-source'), 'picking a dataset shows its source and licence at once')
                p.screenshot(path=str(OUT / f'step1-{name}.png'), full_page=True)
                p.click('button:has-text("Next")')
                p.wait_for_selector('h2:has-text("What do you want to show?")')
                check(p.locator('.builder-card').count() == 3 and 'Net new since 2011' in p.inner_text('.builder-list') and 'Restaurants per 100,000' not in p.inner_text('.builder-list'), 'only measures a story can choose are offered, plus "let the film choose"')
                p.locator('.builder-card').filter(has=p.locator('strong:text-is("Adult obesity prevalence")')).click()
                p.click('button:has-text("Next")')
                p.wait_for_selector('h2:has-text("Which years?")')
                check('2011 to 2023' in p.inner_text('main') and 'Worth knowing' in p.inner_text('main'), 'the years step says the coverage and shows the method change')
                p.fill('#bd-start', '19')
                p.click('button:has-text("Next")')
                check('Use a four-digit year' in p.inner_text('main'), 'a typo is caught in words without a round trip')
                p.fill('#bd-start', '1990')
                p.click('button:has-text("Next")')
                p.wait_for_selector('h2:has-text("What kind of film?")')
                check(p.locator('.builder-card').count() == 4, 'four film types for this dataset')
                check(p.locator('button:has-text("Next")').is_disabled(), 'Next waits for a choice')
                p.locator('.builder-card').filter(has=p.locator('strong:text-is("Bar race")')).click()
                p.click('button:has-text("Next")')
                p.wait_for_selector('h2:has-text("Which look?")')
                check("The film’s own look" in p.inner_text('main') or "The film\u2019s own look" in p.inner_text('main'), 'the look step offers the film\u2019s own look')
                p.click('button:has-text("Next")')
                p.wait_for_selector('h2:has-text("What is it called?")')
                check(p.input_value('#bd-title').startswith('Adult obesity prevalence'), 'the title is suggested from the choices')
                p.click('button:has-text("Next")')
                p.wait_for_selector('h2:has-text("Review")')
                p.wait_for_selector('.builder-problems', timeout=10000)
                check('years.start: 1990 is outside this dataset' in p.inner_text('.builder-review'), 'the engine\u2019s own sentence is shown (1990 is outside the coverage)')
                check(p.locator('button:has-text("Make the film and a free contact sheet")').is_disabled(), 'nothing can be made while it is refused')
                p.screenshot(path=str(OUT / f'refused-{name}.png'), full_page=True)
                p.click('.builder-review button:has-text("Fix it")')
                p.wait_for_selector('h2:has-text("Which years?")')
                check(p.input_value('#bd-start') == '1990', 'Fix it goes back to the years step')
                p.fill('#bd-start', '2012')
                p.fill('#bd-end', '2020')
                p.click('button:has-text("Next")')
                for heading in ('What kind of film?', 'Which look?', 'What is it called?'):
                    p.wait_for_selector(f'h2:has-text("{heading}")')
                    p.click('button:has-text("Next")')
                p.wait_for_selector('.builder-summary', timeout=10000)
                summary = p.inner_text('.builder-review')
                check('Adult obesity prevalence, 2012 to 2020' in summary, 'the suggested title follows the corrected years')
                check('2012 to 2020' in summary and 'Bar race' in summary and 'Adult obesity prevalence' in summary, 'the review summarises the choices as compiled')
                check('Source and licence' in p.inner_text('main') and p.locator('.builder-source').count() == 1, 'the source and licence are shown again before anything is made')
                check(p.locator('details.builder-advanced').count() == 1 and p.locator('#bd-story').input_value().startswith('{'), 'the raw story is behind Advanced')
                check('free' in summary.lower(), 'it says the contact sheet is free')
                p.screenshot(path=str(OUT / f'review-{name}.png'), full_page=True)
                p.click('button:has-text("Make the film and a free contact sheet")')
                p.wait_for_selector('h1:has-text("Version 1")', timeout=20000)
                state = p.evaluate("""() => { const db = window.ryagramMock.client.db; const j = db.jobs.map(x => x.job_type); const v = db.versions[db.versions.length - 1]; return JSON.stringify({ jobs: j, schema: v.story_spec.schema, view: v.story_spec.sequence.clips[1].view, start: v.story_spec.sequence.clips[1].start }); }""")
                check('"contact_sheet"' in state and 'final_render' not in state and '"view":"bars"' in state and '"start":"2012"' in state, f'a project with the compiled story and a contact sheet job is made ({state})')
                check(not errors, f'no page errors {errors}')
                ctx.close()
            b.close()
    finally:
        srv.shutdown()
    print('RESULT:', 'PASS' if ok else 'FAIL')
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
