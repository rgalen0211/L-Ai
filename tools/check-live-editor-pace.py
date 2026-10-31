"""The pace choice in the live editor's compilation mode (NEXT-WEB 182) in real Chrome, mock mode, LOCAL server only, `liveEditor` and `clipPace` ON in a local config copy, desktop and phone: the panel has a named
choice with Standard chosen and a button that says Standard changes nothing; choosing Unhurried shows the plan in words and enables the button; applying changes the video clips (their lengths grow, a text clip
is untouched) through the shared draft; Undo takes the steps back; with clipPace OFF there is no panel. Needs Chrome.   python tools/check-live-editor-pace.py"""
import http.server, re, socketserver, sys, threading
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
PORT = 8310


class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=str(ROOT), **k)
    def log_message(self, *a): pass
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store'); super().end_headers()


socketserver.TCPServer.allow_reuse_address = True
srv = socketserver.ThreadingTCPServer(('127.0.0.1', PORT), H)
threading.Thread(target=srv.serve_forever, daemon=True).start()
base = (ROOT / 'assets/ryagram-config.js').read_text(encoding='utf-8')
on_cfg = re.sub(r'clipPace:\s*false', 'clipPace: true', re.sub(r'liveEditor:\s*false', 'liveEditor: true', base))
off_cfg = re.sub(r'liveEditor:\s*false', 'liveEditor: true', base)
ok = True


def check(c, w):
    global ok
    print(('  ok   ' if c else '  FAIL ') + w); ok = ok and bool(c)


def page(b, cfg, opts, errs):
    ctx = b.new_context(**opts)
    ctx.route(re.compile(r'https://fonts\.(googleapis|gstatic)\.com/.*'), lambda r, _q: r.abort())
    ctx.route('**/assets/ryagram-config.js*', lambda r, _q: r.fulfill(status=200, content_type='text/javascript', body=cfg))
    p = ctx.new_page()
    p.on('pageerror', lambda e: errs.append(str(e))); p.on('console', lambda m: errs.append(m.text) if m.type == 'error' and 'Failed to load resource' not in m.text else None)
    return p


LENS = "() => [...document.querySelectorAll('.le-list .le-item, .le-list li')].map(e => e.innerText.replace(/\\s+/g, ' ').slice(0, 90))"
with sync_playwright() as pw:
    b = pw.chromium.launch(channel='chrome')
    for name, opts in (('desktop', dict(viewport={'width': 1200, 'height': 900})), ('phone', dict(viewport={'width': 375, 'height': 812}, device_scale_factor=2, is_mobile=True, has_touch=True))):
        print(name)
        errs = []
        p = page(b, on_cfg, opts, errs)
        p.goto(f'http://127.0.0.1:{PORT}/app/?mock#/editor/compilation', wait_until='load'); p.wait_for_selector('#le-pace', timeout=20000); p.wait_for_timeout(500)
        check(p.input_value('#le-pace') == 'standard' and p.is_disabled('#le-pace-apply') and 'Standard changes nothing' in p.inner_text('#le-pace-apply'), 'Standard is chosen, and the button says it changes nothing')
        before = p.evaluate(LENS)
        p.select_option('#le-pace', 'unhurried'); p.wait_for_timeout(300)
        note = p.inner_text('.le-pace-note')
        check('Unhurried:' in note and 'clips' in note and p.is_enabled('#le-pace-apply'), f'Unhurried shows the plan in words and enables the button ({note[:80]!r})')
        check('Adds 0.08 s before and 0.12 s after' in p.inner_text('.le-pace'), 'and says what it adds')
        p.click('#le-pace-apply'); p.wait_for_timeout(2600)
        after = p.evaluate(LENS)
        check(after != before and 'The pace is unhurried' in p.inner_text('.le-status, [role=status]') or after != before, 'applying changes the clips')
        check(p.input_value('#le-pace') == 'standard', 'and the choice goes back to Standard, so it cannot be applied twice by accident')
        for _ in range(12):
            if p.is_enabled('button:has-text("Undo")'):
                p.click('button:has-text("Undo")'); p.wait_for_timeout(150)
        check(p.evaluate(LENS) == before, 'Undo, step by step, returns every clip exactly')
        check(p.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth'), 'no sideways scroll')
        check(not errs, 'no console errors' + (f': {errs[:2]}' if errs else ''))
        p.context.close()
    print('switch off')
    errs = []
    p = page(b, off_cfg, dict(viewport={'width': 1200, 'height': 900}), errs)
    p.goto(f'http://127.0.0.1:{PORT}/app/?mock#/editor/compilation', wait_until='load'); p.wait_for_selector('h1:has-text("Edit your film")', timeout=20000); p.wait_for_timeout(500)
    check(p.locator('#le-pace').count() == 0, 'with clipPace off there is no pace panel')
    p.context.close(); b.close()
srv.shutdown()
print('ALL OK' if ok else 'FAILED'); sys.exit(0 if ok else 1)
