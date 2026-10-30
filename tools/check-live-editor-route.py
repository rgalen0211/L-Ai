"""The live editor reached the way a person would reach it on the website (NEXT-WEB 178), in real Chrome, mock mode, LOCAL server only, `liveEditor` ON in a local config copy:
(1) the version page carries an 'Edit the look live' link to #/editor/data/<project> (and none with the switch off); (2) the editor opened with a project in the address uses the shared draft (the AI's change
reaches it, is listed and can be undone) and says plainly that its picture is a stand-in because a person's own film has no drawing data route yet; (3) the address without a project is as before.
Needs Chrome.   python tools/check-live-editor-route.py"""
import http.server, re, socketserver, sys, threading
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
PORT = 8305
PROJ = '00000000-0000-4000-8000-0000000000a1'


class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=str(ROOT), **k)
    def log_message(self, *a): pass
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store'); super().end_headers()


socketserver.TCPServer.allow_reuse_address = True
srv = socketserver.ThreadingTCPServer(('127.0.0.1', PORT), H)
threading.Thread(target=srv.serve_forever, daemon=True).start()
base = (ROOT / 'assets/ryagram-config.js').read_text(encoding='utf-8')
on_cfg = re.sub(r'liveEditor:\s*false', 'liveEditor: true', base)
ok = True


def check(c, w):
    global ok
    print(('  ok   ' if c else '  FAIL ') + w); ok = ok and bool(c)


def page(b, cfg, errs):
    ctx = b.new_context(viewport={'width': 1100, 'height': 900})
    ctx.route(re.compile(r'https://fonts\.(googleapis|gstatic)\.com/.*'), lambda r, _q: r.abort())
    ctx.route('**/assets/ryagram-config.js*', lambda r, _q: r.fulfill(status=200, content_type='text/javascript', body=cfg))
    p = ctx.new_page()
    p.on('pageerror', lambda e: errs.append(str(e))); p.on('console', lambda m: errs.append(m.text) if m.type == 'error' and 'Failed to load resource' not in m.text else None)
    return p


with sync_playwright() as pw:
    b = pw.chromium.launch(channel='chrome')
    errs = []
    print('the link on the version page')
    p = page(b, on_cfg, errs)
    p.goto(f'http://127.0.0.1:{PORT}/app/?mock#/', wait_until='load'); p.wait_for_selector('a[href^="#/p/"]'); p.locator('a[href^="#/p/"]').first.click()
    p.wait_for_selector('a[href^="#/v/"]'); p.locator('a[href^="#/v/"]').first.click(); p.wait_for_selector('h1:has-text("Version")'); p.wait_for_timeout(500)
    link = p.locator('a:has-text("Edit the look live")')
    check(link.count() == 1 and re.fullmatch(r'#/editor/data/[0-9a-fA-F-]{36}', link.get_attribute('href') or '') is not None, f'the version page has the link ({link.get_attribute("href") if link.count() else None})')
    link.click(); p.wait_for_selector('h1:has-text("Edit your film")', timeout=15000)
    check(p.url.split('#')[1].startswith('/editor/data/'), 'the link opens the editor for that project')
    p.context.close()
    p = page(b, base, errs)
    p.goto(f'http://127.0.0.1:{PORT}/app/?mock#/', wait_until='load'); p.wait_for_selector('a[href^="#/p/"]'); p.locator('a[href^="#/p/"]').first.click()
    p.wait_for_selector('a[href^="#/v/"]'); p.locator('a[href^="#/v/"]').first.click(); p.wait_for_selector('h1:has-text("Version")'); p.wait_for_timeout(500)
    check(p.locator('a:has-text("Edit the look live")').count() == 0, 'with the switch off there is no link')
    p.context.close()

    print('the editor with a project in the address (no drawing data, as on the real site)')
    p = page(b, on_cfg, errs)
    p.goto(f'http://127.0.0.1:{PORT}/app/?mock&standin#/editor/data/{PROJ}', wait_until='load'); p.wait_for_selector('h1:has-text("Edit your film")', timeout=15000); p.wait_for_timeout(800)
    txt = p.inner_text('.le')
    check('stand-in' in txt and 'not available here yet' in txt and 'saved to this film' in txt, 'it says the picture is a stand-in and that changes go to the film’s draft')
    check('Stand-in preview for the design' not in txt and 'nothing here is stored' not in txt, 'and no longer says nothing is stored or sent')
    p.evaluate("window.ryagramMockEditor.ai.apply(window.RYAGRAM_MOCK_EDITOR_PROJECT, 'data', window.ryagramMockEditor.draft(window.RYAGRAM_MOCK_EDITOR_PROJECT, 'data').revision, [{op: 'set_look', key: 'network.color', value: '#ff9f6b'}], 'Claude')"); p.wait_for_timeout(2600)
    check('Your AI changed' in p.inner_text('.le'), 'the AI’s change reaches it through the shared draft')
    p.click('text=Undo my AI’s changes'); p.wait_for_timeout(500)
    check('Your AI changed' not in p.inner_text('.le'), 'and Undo takes it back')
    p.context.close()

    print('the address without a project is as before')
    p = page(b, on_cfg, errs)
    p.goto(f'http://127.0.0.1:{PORT}/app/?mock&standin#/editor/data', wait_until='load'); p.wait_for_selector('h1:has-text("Edit your film")', timeout=15000); p.wait_for_timeout(500)
    check('Stand-in preview for the design' in p.inner_text('.le'), 'the demo wording is unchanged')
    p.context.close()
    check(not errs, 'no console errors' + (f': {errs[:2]}' if errs else ''))
    b.close()
srv.shutdown()
print('ALL OK' if ok else 'FAILED'); sys.exit(0 if ok else 1)
