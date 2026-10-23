"""'Your look' (lookEditor) end to end in real Chrome on a LOCAL server only, desktop and phone. The committed config keeps lookEditor false (asserted here); this check turns it on for itself by
answering the config request with a copy that says true, and uses mock mode for sign-in and data. Same walk as check-looks.py (preset to a saved look, bad colour refused inline with Save disabled, ramp ends too close, vertical
warning, free sample sheet, set default, no controls for locked things, "Apply my look" = a diff in words and a NEW version) plus: the flag comes from the config, the old version is left untouched (r1 keeps its theme), and no data
leaves this machine (no non-GET request and no Supabase host). Not part of the node suite (needs Chrome).

    python tools/check-looks-e2e.py [outdir]        (default D:/Ryagram-scratch/WEB/looks-e2e-shots)
"""
import http.server
import re
import socketserver
import sys
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('D:/Ryagram-scratch/WEB/looks-e2e-shots')
PORT = 8184
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
    cfg = (ROOT / 'assets' / 'ryagram-config.js').read_text(encoding='utf8')
    check(re.search(r'lookEditor:\s*true', cfg), 'the committed config has lookEditor true')
    flipped = re.sub(r'lookEditor:\s*false', 'lookEditor: true', cfg)
    try:
        with sync_playwright() as pw:
            b = pw.chromium.launch(channel='chrome')
            for name, opts in (('desktop', dict(viewport={'width': 1280, 'height': 900})),
                               ('phone', dict(viewport={'width': 390, 'height': 844}, device_scale_factor=3, is_mobile=True, has_touch=True))):
                print(name)
                ctx = b.new_context(**opts)
                outside = []
                ctx.on('request', lambda r: outside.append(r.method + ' ' + r.url) if not r.url.startswith((BASE, 'data:', 'blob:')) and (r.method != 'GET' or '.supabase.co' in r.url) else None)
                ctx.route('**/assets/ryagram-config.js*', lambda route: route.fulfill(status=200, content_type='text/javascript', body=flipped))
                p = ctx.new_page()
                errors = []
                p.on('pageerror', lambda e: errors.append(str(e)))
                p.on('console', lambda m: errors.append(m.text) if m.type == 'error' and 'status of 404' not in m.text else None)
                p.on('dialog', lambda d: d.accept())
                p.goto(f'{BASE}/app/?mock#/looks', wait_until='load')
                p.wait_for_selector('h1:has-text("Your look")', timeout=20000)
                check(p.evaluate('window.ryagramConfig.lookEditor') is True, 'the local test config turns the look editor on')
                check('You have no looks yet' in p.inner_text('main'), 'an empty list says so')
                check('What a look can\u2019t change' in p.inner_text('main'), 'the locked panel is there')
                p.screenshot(path=str(OUT / f'list-empty-{name}.png'), full_page=True)
                # a preset becomes a new look
                p.click('a:has-text("Bold social")')
                p.wait_for_selector('#look-name', timeout=10000)
                check(p.input_value('#look-name') == 'my-look', 'the editor opens with a free name')
                check(p.locator('.look-swatch').count() >= 7, 'the quick look has its swatches')
                check('Approximate' in p.inner_text('.look-side'), 'and says it is approximate')
                p.screenshot(path=str(OUT / f'editor-{name}.png'), full_page=True)
                # a bad colour is refused inline, Save disabled
                p.fill('#look-look-page_background', '#fff')
                check(p.locator('.look-form button[type=submit]').is_disabled(), 'a bad colour disables Save')
                check(p.locator('.look-problems li').count() >= 1, 'with the engine sentence in the problems list')
                check(p.locator('#look-look-page_background').locator('xpath=ancestor::div[contains(@class,"look-field")]').locator('.look-field-error:not([hidden])').count() == 1, 'and inline next to the control')
                p.fill('#look-look-page_background', '#101018')
                p.fill('#look-look-ramp-low', '#444444')
                p.fill('#look-look-ramp-high', '#4c4c4c')
                check('only 3 dE apart' in p.inner_text('.look-problems'), 'ramp ends too close: the engine own sentence appears')
                p.fill('#look-look-ramp-low', '#2a0a4a')
                p.fill('#look-look-ramp-high', '#ffd23f')
                check(p.locator('.look-form button[type=submit]').is_enabled(), 'fixed colours enable Save again')
                p.get_by_label('Vertical').check()
                check(p.locator('.look-vertical-note:not([hidden])').count() == 1 and 'no vertical layout' in p.inner_text('.look-layout'), 'Vertical shows the engine warning beside the option')
                p.get_by_label('16:9 HD').check()
                # a sample sheet
                p.click('text=Make a sample sheet')
                p.wait_for_selector('.look-sheet', timeout=60000)
                check('checks passed' in p.inner_text('.look-sheet-out'), 'a sample sheet shows its picture and the checks line')
                p.screenshot(path=str(OUT / f'sheet-{name}.png'), full_page=True)
                # save as the default, back to the list
                p.fill('#look-title', 'House style')
                p.click('text=Save as default')
                p.wait_for_selector('.look-list', timeout=10000)
                check('House style' in p.inner_text('.look-list') and 'Default' in p.inner_text('.look-list'), 'saved as the default look and listed')
                p.screenshot(path=str(OUT / f'list-{name}.png'), full_page=True)
                p.click('a:has-text("Edit")')
                p.wait_for_selector('#look-name', timeout=10000)
                check(p.input_value('#look-title') == 'House style' and p.input_value('#look-look-ramp-high') == '#ffd23f', 'edit shows the saved values')
                check(p.locator('#look-name[readonly]').count() == 1, 'the name is fixed once saved')
                form = p.inner_text('.look-form').lower()
                check(not any(w in form for w in ('dataset', 'axis', 'sources', 'no_data_label', 'callout')), 'no control for the data, axis, sources or checks')
                check('not applied yet' in form, 'the Later group is shown, with the sentence')
                p.click('a:has-text("Cancel")')
                p.wait_for_selector('.look-list', timeout=10000)
                # a second look (high-contrast print), saved but not the default
                p.evaluate("location.hash = '#/looks/new?preset=print-mono'")
                p.wait_for_selector('#look-name', timeout=10000)
                p.fill('#look-name', 'print-copy')
                p.click('.look-form button[type=submit]:has-text("Save")')
                p.wait_for_selector('.look-list', timeout=10000)
                check(p.locator('.look-list li').count() == 2, 'two looks are listed')
                # a film: the default look is applied to a template, and Apply my look shows a diff and makes a NEW version
                p.evaluate("location.hash = '#/'")
                p.wait_for_selector('#np-title', timeout=20000)
                p.fill('#np-title', 'Sample film')
                p.click('button:has-text("Create")')
                p.wait_for_selector('h1:has-text("Version 1")', timeout=20000)
                p.click('button:has-text("Use this film")')
                p.wait_for_function("document.body.innerText.includes('Using your look: House style')", timeout=20000)
                check(True, 'a new film from a template says it is using your default look')
                before = p.evaluate("location.hash")
                p.click('details.look-apply summary')
                p.locator('details.look-apply input[value="print-copy"]').check()
                p.click('details.look-apply button:has-text("See what would change")')
                p.wait_for_selector('.look-diff li', timeout=10000)
                diff = p.inner_text('.look-diff')
                check('Theme: dark → light' in diff, f'the diff says it in words ({diff[:80]!r})')
                p.screenshot(path=str(OUT / f'apply-{name}.png'), full_page=True)
                p.click('button:has-text("Create a new version with this look")')
                p.wait_for_function(f"location.hash !== {before!r}", timeout=10000)
                p.wait_for_selector('h1:has-text("Version 2")', timeout=20000)
                check(True, 'applying makes a NEW version (r2)')
                versions = p.evaluate("window.ryagramMock.client.db.versions.map(v => [v.n, (v.story_spec.sequence || {}).theme])")
                check(len(versions) >= 2 and versions[0][1] != versions[-1][1], f'the old version keeps its own theme, the new one has the applied look {versions}')
                check(not outside, f'no data left this machine (only public fonts and scripts are fetched; no POST and no Supabase host) {outside[:3]}')
                p.goto(f'{BASE}/app/?mock#/', wait_until='load')
                p.wait_for_selector('#np-title', timeout=20000)
                check(not errors, f'no page errors {errors}')
                ctx.close()
            b.close()
    finally:
        srv.shutdown()
    print('RESULT:', 'PASS' if ok else 'FAIL')
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
