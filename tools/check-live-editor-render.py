"""Dead-end sweep row 4 (WEB 11-21), in real Chrome, LOCAL server only, `liveEditor` ON in a local config copy: the live editor's final-render panel.
(1) mock mode (?mock): 'Render final film' then 'Start the render' still runs the made-up job (every mock check relies on it);
(2) the same page with mock mode taken away (what a real account on the website has: no host.render, no mock): there is NO 'Start the render' button, the panel says plainly that rendering from here
is coming soon and points to the film's page, no job starts, and 'Close' closes it.
A planted fault (the made-up job reachable without mock mode) must make (2) fail: run with --plant to see it do so.
Needs Chrome.   python -B -X utf8 tools/check-live-editor-render.py <fresh folder>"""
import http.server, re, socketserver, sys, threading
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
PLANT = '--plant' in sys.argv


class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=str(ROOT), **k)
    def log_message(self, *a): pass
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store'); super().end_headers()


srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), H)
PORT = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()
base = (ROOT / 'assets/ryagram-config.js').read_text(encoding='utf-8')
on_cfg = re.sub(r"liveEditor:\s*(?:false|'account')", 'liveEditor: true', base)
ok = True


def check(c, w):
    global ok
    print(('  ok   ' if c else '  FAIL ') + w); ok = ok and bool(c)


def page(b, errs):
    ctx = b.new_context(viewport={'width': 1100, 'height': 900})
    ctx.route(re.compile(r'https://fonts\.(googleapis|gstatic)\.com/.*'), lambda r, _q: r.abort())
    ctx.route('**/assets/ryagram-config.js*', lambda r, _q: r.fulfill(status=200, content_type='text/javascript', body=on_cfg))
    if PLANT:     # the fault: the page's mock test always says yes
        ctx.route('**/assets/app-editor.js*', lambda r, _q: r.fulfill(status=200, content_type='text/javascript', body=(ROOT / 'assets/app-editor.js').read_text(encoding='utf-8').replace("window.ryagramMock ? 'mock' : null);", "'mock');")))
    p = ctx.new_page()
    p.on('pageerror', lambda e: errs.append(str(e))); p.on('console', lambda m: errs.append(m.text) if m.type == 'error' and 'Failed to load resource' not in m.text else None)
    return p


with sync_playwright() as pw:
    b = pw.chromium.launch(channel='chrome')
    errs = []
    print('mock mode: the made-up job still runs')
    p = page(b, errs)
    p.goto(f'http://127.0.0.1:{PORT}/app/?mock#/editor/data', wait_until='load'); p.wait_for_selector('h1:has-text("Edit your film")', timeout=15000); p.wait_for_timeout(500)
    p.click('button:has-text("Render final film")')
    check(p.locator('button:has-text("Start the render")').count() == 1 and p.locator('#le-render-soon').count() == 0, 'mock: Start the render is offered, no coming-soon line')
    p.click('button:has-text("Start the render")')
    p.locator('.le-prog-head', has_text=re.compile(r'Drawing frames: [0-9,]+ of 2,820')).wait_for(timeout=5000)
    check(True, 'mock: the made-up job runs (2,820 frames)')
    p.context.close()

    print('no mock, no host.render (a real account on the website): nothing pretend')
    p = page(b, errs)
    p.goto(f'http://127.0.0.1:{PORT}/app/?mock#/editor/data', wait_until='load'); p.wait_for_selector('h1:has-text("Edit your film")', timeout=15000); p.wait_for_timeout(500)
    p.evaluate('delete window.ryagramMock; window.ryagramMock = undefined')
    check(p.evaluate('!window.ryagramMock && !window.ryagramLiveHost'), 'the page now has no mock flag and no host')
    p.click('button:has-text("Render final film")')
    box = p.inner_text('.le-render')
    check(p.locator('button:has-text("Start the render")').count() == 0, 'no Start the render button')
    check(p.locator('#le-render-soon').count() == 1 and 'coming soon' in box and 'film’s page' in box, 'the panel says rendering from here is coming soon and points to the film’s page')
    check('Line colour' in box or 'What the film will be made from' in box, 'it still says what the film is made from')
    p.wait_for_timeout(2500)
    check(p.locator('.le-prog-head').count() == 0 and 'Your film is ready' not in p.inner_text('.le'), 'no progress, no "Your film is ready": nothing was made up')
    p.click('.le-render button:has-text("Close")')
    check(p.locator('.le-render').is_hidden(), 'Close closes the panel')
    p.context.close()
    check(not errs, 'no console errors' + (f': {errs[:2]}' if errs else ''))
    b.close()
srv.shutdown(); srv.server_close()
print('ALL OK' if ok else 'FAILED'); sys.exit(0 if ok else 1)
