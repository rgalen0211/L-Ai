"""BYOD audit (Ryan 2026-10-18): a brand-new person walks "upload your own data" in mock mode (fake data) at desktop and phone width, with a screenshot and the visible text of the
upload panel at every step, plus mechanical findings (sideways scroll, small tap targets, console errors). A person reads the screenshots and text for wording and layout.

Steps: new project -> its version page -> where is the upload? (folded under Advanced) -> Upload with nothing chosen -> a .txt -> an empty .csv -> no tick -> years across columns ->
a good long-format file -> reading -> map the columns -> confirm -> ready -> use in this film -> what the film now says -> a county file.

    python tools/audit-byod.py [outdir]        (default D:/Ryagram-scratch/WEB/audit-shots/byod)
Needs the sample files in D:/Ryagram-scratch/WEB/byod (good.csv, wide.csv, empty.csv, notes.txt, counties.csv).
"""
import http.server
import json
import socketserver
import sys
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('D:/Ryagram-scratch/WEB/audit-shots/byod')
FILES = Path('D:/Ryagram-scratch/WEB/byod')
PORT = 8192
BASE = f'http://127.0.0.1:{PORT}'
SMALL = """() => [...document.querySelectorAll('a, button, input:not([type=hidden]), select, textarea, summary')].filter(el => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el);
  const inline = el.tagName === 'A' && s.display === 'inline' && !el.classList.contains('button');
  return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && !inline && (r.height < 40) && !(el.type === 'checkbox' || el.type === 'radio'); })
  .map(el => ((el.innerText || el.getAttribute('aria-label') || el.id || el.tagName).trim().slice(0, 30)) + ' ' + Math.round(el.getBoundingClientRect().height)).slice(0, 10)"""


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
    log = []
    try:
        with sync_playwright() as pw:
            b = pw.chromium.launch(channel='chrome')
            for wname, opts in (('desktop', dict(viewport={'width': 1280, 'height': 900})),
                                ('phone', dict(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True))):
                ctx = b.new_context(**opts)
                p = ctx.new_page()
                errs = []
                p.on('pageerror', lambda e: errs.append(str(e)[:150]))
                p.on('console', lambda m: errs.append(m.text[:150]) if m.type == 'error' and 'status of 404' not in m.text and 'fake.supabase' not in m.text else None)
                p.on('dialog', lambda d: d.accept())
                n = [0]

                def step(name, selector='#library'):
                    n[0] += 1
                    p.wait_for_timeout(700)
                    panel = p.locator('.uploads-panel')
                    text = panel.inner_text() if panel.count() and panel.first.is_visible() else '(upload panel not visible)'
                    log.append({'viewport': wname, 'n': n[0], 'step': name, 'sideways_scroll': p.evaluate('document.documentElement.scrollWidth > window.innerWidth'),
                                'small_targets': p.evaluate(SMALL), 'panel_text': text[:900], 'errors': list(errs)})
                    p.screenshot(path=str(OUT / f'{wname}-{n[0]:02d}-{name}.png'), full_page=True)

                p.goto(f'{BASE}/app/?mock', wait_until='load')
                p.wait_for_selector('#np-title', timeout=20000)
                p.fill('#np-title', 'My rents')
                p.click('button:has-text("Create")')
                p.wait_for_selector('h1:has-text("Version 1")', timeout=20000)
                p.wait_for_selector('.uploads-panel', state='attached', timeout=15000)
                p.wait_for_timeout(800)
                step('version-page-first-view')
                # where is the upload? it sits inside a folded Advanced panel
                adv = p.locator('details.advanced-panel')
                log.append({'viewport': wname, 'note': 'advanced panel present', 'value': adv.count(), 'open': adv.first.get_attribute('open') if adv.count() else None})
                pointer = p.locator('.byod-pointer button')
                log.append({'viewport': wname, 'note': 'pointer line near the top', 'value': pointer.count()})
                if pointer.count():
                    pointer.click()
                    p.wait_for_timeout(500)
                    log.append({'viewport': wname, 'note': 'pointer opened the panel and focused the file box', 'value': [adv.first.get_attribute('open') is not None, p.evaluate("document.activeElement && document.activeElement.id")]})
                elif adv.count() and adv.first.get_attribute('open') is None:
                    adv.first.locator('summary').click()
                p.locator('.uploads-panel').scroll_into_view_if_needed()
                step('advanced-opened')
                up = p.locator('#upload-file')
                p.get_by_role('button', name='Upload').click()
                step('upload-with-nothing-chosen')
                up.set_input_files(str(FILES / 'notes.txt'))
                p.get_by_role('button', name='Upload').click()
                step('wrong-file-type-txt')
                up.set_input_files(str(FILES / 'empty.csv'))
                p.get_by_role('button', name='Upload').click()
                step('empty-csv')
                up.set_input_files(str(FILES / 'good.csv'))
                p.get_by_role('button', name='Upload').click()
                step('good-file-without-rights-tick')
                up.set_input_files(str(FILES / 'wide.csv'))
                p.check('#upload-rights')
                p.get_by_role('button', name='Upload').click()
                p.wait_for_timeout(2500)
                step('years-across-columns-file')
                # delete that failed card if offered, so the next one is clean
                dels = p.locator('.upload-card button:has-text("Delete")')
                if dels.count():
                    dels.first.click()
                    p.wait_for_timeout(800)
                up.set_input_files(str(FILES / 'good.csv'))
                if not p.is_checked('#upload-rights'):
                    p.check('#upload-rights')
                p.get_by_role('button', name='Upload').click()
                step('good-file-just-uploaded')
                p.wait_for_selector('.mapping-form', timeout=20000)
                step('map-the-columns')
                # S5: the source, licence and unit fields (byodGuide): refused until complete, then saved before the mapping
                p.get_by_role('button', name='These are right').click()
                p.wait_for_timeout(500)
                step('mapping-refused-until-source-given')
                p.fill('#prov-publisher', 'Census Bureau')
                p.fill('#prov-link', 'https://example.gov/rents')
                p.locator('select[aria-label="What lets you use it"]').select_option('public_domain')
                p.fill('#prov-unit', 'dollars')
                p.check('#prov-attest')
                step('source-fields-filled')
                p.get_by_role('button', name='These are right').click()
                p.wait_for_selector('.upload-card button:has-text("Use in this film")', timeout=15000)
                step('ready')
                p.get_by_role('button', name='Use in this film').click()
                p.wait_for_timeout(2500)
                step('in-use')
                story = p.evaluate("() => (document.querySelector('#story') || {}).value || ''")
                log.append({'viewport': wname, 'note': 'story after Use in this film', 'value': story[:600]})
                # what does the rest of the page say now?
                log.append({'viewport': wname, 'note': 'page text under Render', 'value': p.inner_text('#library')[-900:]})
                step('after-use-whole-page')
                ctx.close()
            b.close()
    finally:
        srv.shutdown()
    (OUT / 'byod.json').write_text(json.dumps(log, indent=1), encoding='utf-8')
    print('wrote', OUT / 'byod.json', len(log), 'entries')


if __name__ == '__main__':
    main()
