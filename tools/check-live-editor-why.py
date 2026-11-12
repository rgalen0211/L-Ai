"""The Why this clip panel in the live editor's compilation mode (NEXT-WEB 185) in real Chrome, mock mode, LOCAL server only, `liveEditor` and `whyClip` ON in a local config copy, desktop and phone: the panel draws the
REAL why_this_clip.py report (on a synthetic edit list) clip by clip with the report's own sentences; the filter shows only the clips asked for; moving the playhead marks the clip playing there; a failing source and a page
with no source both say so in words; with whyClip OFF there is no panel. Needs Chrome.   python tools/check-live-editor-why.py"""
import http.server, re, socketserver, sys, threading
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
PORT = 8314


class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=str(ROOT), **k)
    def log_message(self, *a): pass
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store'); super().end_headers()


srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), H)          # its own port: a fixed one can be bound twice at once on Windows (11-06)
PORT = srv.server_address[1]; URL = f'http://127.0.0.1:{PORT}/app/?mock'
threading.Thread(target=srv.serve_forever, daemon=True).start()
base = (ROOT / 'assets/ryagram-config.js').read_text(encoding='utf-8')
on_cfg = re.sub(r'whyClip:\s*false', 'whyClip: true', re.sub(r"liveEditor:\s*(?:false|'account')", 'liveEditor: true', base))
off_cfg = re.sub(r"liveEditor:\s*(?:false|'account')", 'liveEditor: true', base)
ok = True


def check(c, w):
    global ok
    print(('  ok   ' if c else '  FAIL ') + w); ok = ok and bool(c)


def page(b, cfg, opts, errs):
    ctx = b.new_context(**opts)
    ctx.route(re.compile(r'https://fonts\.(googleapis|gstatic)\.com/.*'), lambda r, _q: r.abort())
    ctx.route('**/assets/ryagram-config.js*', lambda r, _q, c=cfg: r.fulfill(status=200, content_type='text/javascript', body=c))
    p = ctx.new_page()
    p.on('pageerror', lambda e: errs.append(str(e))); p.on('console', lambda m: errs.append(m.text) if m.type == 'error' and 'Failed to load resource' not in m.text else None)
    return p


URL = f'http://127.0.0.1:{PORT}/app/?mock'
with sync_playwright() as pw:
    b = pw.chromium.launch(channel='chrome')
    for name, opts in (('desktop', dict(viewport={'width': 1200, 'height': 900})), ('phone', dict(viewport={'width': 375, 'height': 812}, device_scale_factor=2, is_mobile=True, has_touch=True))):
        print(name)
        errs = []
        p = page(b, on_cfg, opts, errs)
        p.goto(f'{URL}#/editor/compilation', wait_until='load'); p.wait_for_selector('.le-why-list', timeout=20000); p.wait_for_timeout(400)
        check(p.locator('.le-why-clip').count() == 5 and '5 clips, 1 stand-in' in p.inner_text('.le-why-sum'), 'five clips and the summary line: ' + p.inner_text('.le-why-sum'))
        first = p.inner_text('.le-why-clip[data-n="5"]')
        check("never says 'root root root'" in first and 'Voice unsure' in first and 'a stand-in' in first, 'the stand-in clip shows the report’s own sentences')
        p.select_option('#le-why-filter', 'stand_in'); p.wait_for_timeout(200)
        check(p.locator('.le-why-clip').count() == 1 and p.locator('.le-why-clip[data-n="5"]').count() == 1, 'the filter Stand-ins shows only clip 5')
        p.select_option('#le-why-filter', 'all'); p.wait_for_timeout(200)
        check(p.locator('.le-why-clip').count() == 5, 'All shows all five again')
        check(p.locator('.le-why-clip[aria-current="true"]').count() <= 1, 'at most one clip is marked as playing now')
        p.fill('#le-range', '37'); p.dispatch_event('#le-range', 'input'); p.wait_for_timeout(300)
        check(p.locator('.le-why-clip[aria-current="true"]').count() == 1 and p.locator('.le-why-clip[aria-current="true"]').get_attribute('data-n') == '5', 'moving the playhead to 3.7 s marks clip 5, and only that one')
        p.fill('#le-range', '0'); p.dispatch_event('#le-range', 'input'); p.wait_for_timeout(300)
        check(p.locator('.le-why-clip[aria-current="true"]').get_attribute('data-n') == '1', 'back at the start it marks clip 1')
        check(p.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth'), 'no sideways scroll')
        check(not errs, 'no console errors' + (f': {errs[:2]}' if errs else ''))
        p.context.close()
    print('failures and the switch')
    errs = []
    p = page(b, on_cfg, dict(viewport={'width': 1200, 'height': 900}), errs)
    p.goto(f'{URL}&whyfail#/editor/compilation', wait_until='load'); p.wait_for_selector('.le-why', timeout=20000); p.wait_for_timeout(600)
    check('could not be read just now' in p.inner_text('.le-why'), 'a failing source is said in words')
    p.context.close()
    p = page(b, on_cfg, dict(viewport={'width': 1200, 'height': 900}), errs)
    p.goto(f'{URL}&nowhy#/editor/compilation', wait_until='load'); p.wait_for_selector('.le-why', timeout=20000); p.wait_for_timeout(600)
    check('has no explanation of the cut' in p.inner_text('.le-why'), 'a page with no source says it comes from the Ryagram app')
    p.context.close()
    p = page(b, off_cfg, dict(viewport={'width': 1200, 'height': 900}), errs)
    p.goto(f'{URL}#/editor/compilation', wait_until='load'); p.wait_for_selector('h1:has-text("Edit your film")', timeout=20000); p.wait_for_timeout(500)
    check(p.locator('.le-why').count() == 0, 'with whyClip off there is no panel')
    p.context.close(); b.close()
srv.shutdown(); srv.server_close()
print('ALL OK' if ok else 'FAILED'); sys.exit(0 if ok else 1)
