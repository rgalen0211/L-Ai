"""The "Prepared by your AI" card (CONNECT 11-20, Q634) in real Chrome, mock mode, desktop and phone, with `uploads` switched on in a LOCAL copy of the config only. The mock backend has no
prepared-data functions, so this check answers my_prepared_data / my_prepared_data_csv / mark_prepared_accepted / discard_prepared_data itself (in the page, on the app's own client) and passes every
other call through to the mock. It walks: the card shows what the AI declared as words (no link, no markup), what Ryagram measured (the missing 2020 named), the trust label; Accept runs the ordinary
upload path (the mock worker reads it), the confirm screen shows the trust box and refuses without the tick, and the dataset card carries the label; a failed acknowledgement after a good upload is
retried WITHOUT a second upload; Discard removes a table. Nothing scrolls sideways. Writes screenshots. Needs Chrome, so it is not part of the node suite.

    python tools/check-prepared-card.py [outdir]        (default D:/Ryagram-scratch/CONNECT/prep-shots)
"""
import http.server
import json
import re
import socketserver
import sys
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('D:/Ryagram-scratch/CONNECT/prep-shots')
LABEL = 'Unverified, user-supplied'
YEARS = [y for y in range(2010, 2024) if y != 2020]
CSV = 'State,Year,Median age\n' + ''.join(f'{s},{y},{a + (y - 2010) * 0.2:.1f}\n' for s, a in (('Alabama', 37.5), ('Alaska', 33.6), ('Arizona', 35.9)) for y in YEARS)
ITEM = {
    'id': '00000000-0000-4000-8000-0000000000e1',
    'label': 'Median age by US state, 2010 to 2023 (sample table for this check)',
    'ai_name': 'ChatGPT',
    'created_at': '2026-11-20T12:00:00Z', 'expires_at': '2026-11-27T12:00:00Z',
    'sources': {'urls': ['https://data.census.gov/table/ACSDT1Y2022.B01002'], 'publisher': 'US Census Bureau, American Community Survey 1-year',
                'licence': 'Public domain (US government work)', 'units': 'years of age', 'notes': 'There is no 1-year table for 2020.', 'retrieved': '2026-11-20'},
    'change_log': ['Took B01002_001E for each year.', 'Left 2020 out: the Census did not publish it.'],
    'measured': {'rows': 39, 'columns': 3, 'places': 3, 'first_period': 2010, 'last_period': 2023, 'periods_found': 13, 'periods_missing': [2020], 'shape': 'long', 'non_numeric_values': 0},
    'preview_lines': CSV.split('\n')[:21],
}
OTHER = {**ITEM, 'id': '00000000-0000-4000-8000-0000000000e2', 'label': 'A second table to discard'}
HOOK = """(args) => {
  const [item, other, csv] = args;
  const c = window.ryagramApp.client, real = c.rpc.bind(c);
  window.__prep = { items: [item, other], marks: 0, failMark: false, markedWith: [], uploads: 0 };
  c.rpc = async (name, a) => {
    const s = window.__prep;
    if (name === 'my_prepared_data') return { data: s.items.slice(), error: null };
    if (name === 'my_prepared_data_csv') return { data: csv, error: null };
    if (name === 'mark_prepared_accepted') {
      s.marks += 1; s.markedWith.push(a.p_dataset);
      if (s.failMark) { s.failMark = false; return { data: null, error: { message: 'Could not reach Ryagram.' } }; }
      s.items = s.items.filter(i => i.id !== a.p_id); return { data: { accepted: true }, error: null };
    }
    if (name === 'discard_prepared_data') { s.items = s.items.filter(i => i.id !== a.p_id); return { data: { discarded: true }, error: null }; }
    if (name === 'create_upload') s.uploads += 1;
    return real(name, a);
  };
}"""


def serve():
    class H(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *a, **k):
            super().__init__(*a, directory=str(ROOT), **k)

        def log_message(self, *a):
            pass

        def end_headers(self):
            self.send_header('Cache-Control', 'no-store')
            super().end_headers()
    srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), H)          # its own port
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, f'http://127.0.0.1:{srv.server_address[1]}'


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    srv, base = serve()
    ok = True

    def check(cond, what):
        nonlocal ok
        print(('  ok   ' if cond else '  FAIL ') + what)
        ok = ok and bool(cond)
    cfg = (ROOT / 'assets' / 'ryagram-config.js').read_text(encoding='utf-8')
    cfg = re.sub(r'aiFirst:\s*true', 'aiFirst: false', re.sub(r'departments:\s*true', 'departments: false', cfg))
    flipped = re.sub(r'uploads:\s*false', 'uploads: true', cfg)
    try:
        with sync_playwright() as pw:
            b = pw.chromium.launch(channel='chrome')
            for name, opts in (('desktop', dict(viewport={'width': 1280, 'height': 900})),
                               ('phone', dict(viewport={'width': 390, 'height': 844}, device_scale_factor=3, is_mobile=True, has_touch=True))):
                print(name)
                ctx = b.new_context(**opts)
                ctx.route('**/assets/ryagram-config.js*', lambda route: route.fulfill(status=200, content_type='text/javascript', body=flipped))
                p = ctx.new_page()
                errors = []
                p.on('pageerror', lambda e: errors.append(str(e)))
                p.on('console', lambda m: errors.append(m.text) if m.type == 'error' and 'status of 404' not in m.text and 'Failed to load resource' not in m.text else None)
                p.goto(f'{base}/app/?mock', wait_until='load')
                p.wait_for_selector('#np-title', timeout=20000)
                p.evaluate(HOOK, [ITEM, OTHER, CSV])
                p.fill('#np-title', 'Median Age by US State 2010-2023')
                p.click('button:text-is("Create")')
                p.wait_for_selector('h1:has-text("Version 1")', timeout=20000)
                p.wait_for_selector('.uploads-panel', state='attached', timeout=15000)
                adv = p.locator('details.advanced-panel')
                if adv.count() and adv.first.get_attribute('open') is None:
                    adv.first.locator('summary').first.click()
                p.wait_for_selector('.prepared-data:not([hidden])', timeout=15000)
                card = p.locator('.prepared-card').first
                text = card.inner_text()
                check('Prepared by your AI' in p.inner_text('.prepared-data'), 'the card is titled "Prepared by your AI"')
                check('ChatGPT' in text and LABEL in text, 'it names the AI and carries the "Unverified, user-supplied" label')
                check('NO rows for 2020' in text and '13 found' in text, 'Ryagram names the missing 2020 itself')
                check('Ryagram has not checked this' in text and 'Public domain' in text and 'years of age' in text, 'what the AI declared is shown as words, marked not checked')
                check(card.locator('a').count() == 0 and card.locator('img, script, iframe').count() == 0, 'no link and no markup inside the card (a source address is words)')
                p.locator('.prepared-data').scroll_into_view_if_needed()
                check(p.evaluate('[...document.querySelectorAll(".prepared-sources li")].every(x => x.scrollWidth <= x.clientWidth + 1 && x.getBoundingClientRect().right <= window.innerWidth)'), 'a long source address wraps and is not cut off')
                p.evaluate("""() => document.querySelectorAll('*').forEach(e => { const c = getComputedStyle(e).position; if (c === 'fixed' || c === 'sticky') e.style.position = 'static'; })""")      # screenshots only: a sticky bar would sit on top of an element capture
                card.locator('details').last.locator('summary').click()
                check(p.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth'), 'no sideways scroll')
                p.locator('.prepared-data').screenshot(path=str(OUT / f'card-{name}.png'))
                # a failed acknowledgement after a good upload: the second Accept records the SAME upload, no second one
                p.evaluate('window.__prep.failMark = true')
                p.locator('.prepared-card').first.get_by_role('button', name='Accept and continue').click()
                p.wait_for_selector('.prepared-data .app-error', timeout=15000)
                check('Could not reach Ryagram' in p.inner_text('.prepared-data'), 'a failed acknowledgement says so in words')
                p.screenshot(path=str(OUT / f'failed-ack-{name}.png'), full_page=True)
                p.locator('.prepared-card').first.get_by_role('button', name='Accept and continue').click()
                p.wait_for_selector('.mapping-form', timeout=25000)
                s = p.evaluate('({ uploads: window.__prep.uploads, marks: window.__prep.marks, w: window.__prep.markedWith })')
                check(s['uploads'] == 1 and s['marks'] == 2 and s['w'][0] == s['w'][1], f'ONE upload, two acknowledgements, the same dataset ({s})')
                box = p.locator('.trust-box')
                check(box.count() == 1 and LABEL in box.inner_text() and not p.is_checked('#trust-ack'), 'the confirm screen shows the trust box, unticked')
                p.locator('.upload-card').first.screenshot(path=str(OUT / f'confirm-{name}.png'))
                if p.locator('#prov-publisher').count():
                    p.fill('#prov-publisher', 'US Census Bureau'); p.locator('select[aria-label="What lets you use it"]').select_option('own_data')
                    p.fill('#prov-unit', 'years of age'); p.check('#prov-attest')
                p.get_by_role('button', name='These are right').click()
                p.wait_for_timeout(600)
                check(p.locator('.mapping-form').count() == 1 and 'Tick the box to use this data anyway.' in p.inner_text('.uploads-panel'), 'confirming without the tick is refused in words')
                p.check('#trust-ack')
                p.get_by_role('button', name='These are right').click()
                p.wait_for_selector('.upload-card button:has-text("Use in this film")', timeout=15000)
                check(p.locator('.upload-card .trust-chip').count() >= 1 and p.locator('.upload-card .trust-chip').first.inner_text() == LABEL, 'the dataset card carries the label')
                p.locator('.upload-card').first.screenshot(path=str(OUT / f'dataset-{name}.png'))
                # Discard removes the other table
                left = p.locator('.prepared-card')
                check(left.count() == 1 and 'A second table to discard' in left.first.inner_text(), 'the accepted table left the card; the other one is still waiting')
                left.first.get_by_role('button', name='Discard').click()
                p.wait_for_function('document.querySelectorAll(".prepared-card").length === 0 || document.querySelector(".prepared-data").hidden', timeout=15000)
                check(p.locator('.prepared-card').count() == 0, 'Discard removes the waiting table')
                check(p.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth'), 'no sideways scroll at the end')
                check(errors == [], f'no console errors {errors[:2]}')
                ctx.close()
            b.close()
    finally:
        srv.shutdown()
    print('ALL OK' if ok else 'FAILED')
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
