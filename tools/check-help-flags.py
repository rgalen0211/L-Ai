"""The help page in real Chrome (NEXT-WEB 170): the seven answers show; the new-in-the-app entries stay hidden while their switch is off and show when it is on (a local config copy); no sideways scroll at 375 px;
no console errors. LOCAL server only. Needs Chrome.   python tools/check-help-flags.py"""
import http.server, re, socketserver, sys, threading
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
PORT = 8170


class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=str(ROOT), **k)
    def log_message(self, *a): pass
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store'); super().end_headers()


socketserver.TCPServer.allow_reuse_address = True
srv = socketserver.ThreadingTCPServer(('127.0.0.1', PORT), H)
threading.Thread(target=srv.serve_forever, daemon=True).start()
base = (ROOT / 'assets/ryagram-config.js').read_text(encoding='utf-8')
ok = True


def check(c, w):
    global ok
    print(('  ok   ' if c else '  FAIL ') + w); ok = ok and bool(c)


with sync_playwright() as pw:
    b = pw.chromium.launch(channel='chrome')
    on_cfg = base.replace('uploads: false', 'uploads: true')
    if re.search(r'liveEditor:\s*false', on_cfg):                                # the editor branches add this switch to the config; main has no such key yet
        on_cfg = re.sub(r'liveEditor:\s*false', 'liveEditor: true', on_cfg)
    else:
        on_cfg = on_cfg.replace('window.ryagramConfig = Object.freeze({', 'window.ryagramConfig = Object.freeze({ liveEditor: true,', 1)
    for label, cfg, shown in (('as shipped', base, ['How do I connect Claude']), ('all switches on', on_cfg, ['How do I connect Claude', 'change my film', 'get my data'])):
        print(label)
        ctx = b.new_context(viewport={'width': 375, 'height': 800})
        ctx.route(re.compile(r'https://fonts\.(googleapis|gstatic)\.com/.*'), lambda r: r.abort())                  # no outside request: the page's web font is not needed here
        ctx.route('**/assets/ryagram-config.js*', lambda r, _q, c=cfg: r.fulfill(status=200, content_type='text/javascript', body=c))
        p = ctx.new_page(); errs = []
        p.on('pageerror', lambda e: errs.append(str(e))); p.on('console', lambda m: errs.append(m.text) if m.type == 'error' and 'Failed to load resource' not in m.text else None)
        p.goto(f'http://127.0.0.1:{PORT}/help/', wait_until='commit'); p.wait_for_timeout(1500)
        vis = [s for s in p.locator('.faq details:visible > summary').all_inner_texts()]
        check(len(vis) >= 7, f'the seven answers are shown ({len(vis)} visible)')
        for key in ('How do I connect Claude', 'change my film', 'get my data'):
            on = any(key in s for s in vis)
            check(on is (key in shown), f'"{key}" is {"shown" if on else "hidden"} as expected')
        check(p.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth'), 'no sideways scroll at 375 px')
        check(not errs, 'no console errors' + (f': {errs[:2]}' if errs else ''))
        ctx.close()
    b.close()
srv.shutdown()
print('ALL OK' if ok else 'FAILED'); sys.exit(0 if ok else 1)
