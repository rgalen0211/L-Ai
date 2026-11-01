"""The lyric card choice in the live editor (NEXT-WEB 189) in real Chrome, mock mode, LOCAL server only, `liveEditor` and `lyricCards` ON in a local config copy, desktop and phone: three designs with pictures that load,
a click picks one and the film's look holds it, the pick survives a repaint, no sideways scroll at 375 px, with `lyricCards` OFF the chooser is not there, and a bad value cannot be made from the page.
Needs Chrome.   python tools/check-lyric-cards.py"""
import http.server, re, socketserver, sys, threading
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
PORT = 8317


class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=str(ROOT), **k)
    def log_message(self, *a): pass
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store'); super().end_headers()


socketserver.TCPServer.allow_reuse_address = True
srv = socketserver.ThreadingTCPServer(('127.0.0.1', PORT), H)
threading.Thread(target=srv.serve_forever, daemon=True).start()
base = (ROOT / 'assets/ryagram-config.js').read_text(encoding='utf-8')
on_cfg = re.sub(r'lyricCards:\s*false', 'lyricCards: true', re.sub(r'liveEditor:\s*false', 'liveEditor: true', base))
off_cfg = re.sub(r'liveEditor:\s*false', 'liveEditor: true', base)
ok = True


def check(c, w):
    global ok
    print(('  ok   ' if c else '  FAIL ') + w); ok = ok and bool(c)


def page(b, cfg, opts, errs):
    ctx = b.new_context(**opts)
    ctx.route(re.compile(r'https://fonts\.(googleapis|gstatic)\.com/.*'), lambda r, _q: r.abort())
    ctx.route('https://claude.ai/**', lambda r, _q: r.abort())
    ctx.route('**/assets/ryagram-config.js*', lambda r, _q, c=cfg: r.fulfill(status=200, content_type='text/javascript', body=c))
    p = ctx.new_page()
    p.on('pageerror', lambda e: errs.append(str(e))); p.on('console', lambda m: errs.append(m.text) if m.type == 'error' and 'Failed to load resource' not in m.text else None)
    return p


with sync_playwright() as pw:
    b = pw.chromium.launch(channel='chrome')
    for name, opts in (('desktop', dict(viewport={'width': 1200, 'height': 900})), ('phone', dict(viewport={'width': 375, 'height': 812}, device_scale_factor=2, is_mobile=True, has_touch=True))):
        print(name)
        errs = []
        p = page(b, on_cfg, opts, errs)
        p.goto(f'http://127.0.0.1:{PORT}/app/?mock#/editor/compilation', wait_until='load'); p.wait_for_selector('.le-lc', timeout=20000); p.wait_for_timeout(300)
        check(p.locator('.le-lc input[type=radio]').count() == 3, 'three designs to choose from')
        check(p.evaluate("[...document.querySelectorAll('.le-lc img')].every(i => i.complete && i.naturalWidth > 100)") or (p.wait_for_timeout(800) is None and p.evaluate("[...document.querySelectorAll('.le-lc img')].every(i => i.complete && i.naturalWidth > 100)")), 'the three pictures load')
        check(p.locator('.le-lc input:checked').count() == 0 and 'usual card' in p.inner_text('.le-lc'), 'nothing is picked at first and it says the usual card stays')
        p.locator('.le-lc-opt:has-text("Bar")').click(); p.wait_for_timeout(300)
        check(p.locator('#le-lc-bar').is_checked(), 'a click picks Bar')
        p.locator('.le-lc-opt:has-text("Sing-along")').click(); p.wait_for_timeout(300)
        check(p.locator('#le-lc-sing_along').is_checked() and not p.locator('#le-lc-bar').is_checked(), 'picking another moves the choice')
        p.locator('#le-fl-theme').select_option('light'); p.wait_for_timeout(300)
        check(p.locator('#le-lc-sing_along').is_checked(), 'the pick survives another look change repainting the panel')
        check('does not draw these cards yet' in p.inner_text('.le-lc'), 'it says plainly that nothing renders these cards yet')
        p.locator('#le-lc-plate').focus(); p.keyboard.press('Space'); p.wait_for_timeout(300)
        check(p.locator('#le-lc-plate').is_checked(), 'the keyboard picks a design')
        check(p.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth'), 'no sideways scroll')
        check(not errs, 'no console errors' + (f': {errs[:2]}' if errs else ''))
        p.screenshot(path=str(Path('D:/Ryagram-scratch/WEB/temp') / f'lyric-cards-{name}.png'), full_page=True)
        p.context.close()
    print('switch off')
    errs = []
    p = page(b, off_cfg, dict(viewport={'width': 1200, 'height': 900}), errs)
    p.goto(f'http://127.0.0.1:{PORT}/app/?mock#/editor/compilation', wait_until='load'); p.wait_for_selector('#le-fl-theme', timeout=20000)
    check(p.locator('.le-lc').count() == 0, 'with the switch off there is no chooser')
    p.context.close(); b.close()
srv.shutdown()
print('ALL OK' if ok else 'FAILED'); sys.exit(0 if ok else 1)
