"""The named-faces-sharp panel (NEXT-WEB 179) in real Chrome on a test harness page (a fake engine that follows the spec's words), LOCAL server only, desktop and phone: three faces start blurred; refusals are
the engine's sentences; confirm Ann, link a face (the menu lists confirmed people only and is never pre-selected), it shows sharp and the count line says so; withdraw re-blurs; tap sizes; no sideways scroll at
375 px; keyboard reaches a control. Needs Chrome.   python tools/check-faces-sharp.py"""
import http.server, socketserver, sys, threading
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
PORT = 8309


class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=str(ROOT), **k)
    def log_message(self, *a): pass
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store'); super().end_headers()


socketserver.TCPServer.allow_reuse_address = True
srv = socketserver.ThreadingTCPServer(('127.0.0.1', PORT), H)
threading.Thread(target=srv.serve_forever, daemon=True).start()
ok = True


def check(c, w):
    global ok
    print(('  ok   ' if c else '  FAIL ') + w); ok = ok and bool(c)


with sync_playwright() as pw:
    b = pw.chromium.launch(channel='chrome')
    for name, opts in (('desktop', dict(viewport={'width': 1100, 'height': 900})), ('phone', dict(viewport={'width': 375, 'height': 812}, device_scale_factor=2, is_mobile=True, has_touch=True))):
        print(name)
        p = b.new_context(**opts).new_page(); errs = []
        p.on('pageerror', lambda e: errs.append(str(e))); p.on('console', lambda m: errs.append(m.text) if m.type == 'error' and 'Failed to load resource' not in m.text else None)
        p.goto(f'http://127.0.0.1:{PORT}/tests/faces-sharp-harness.html', wait_until='load'); p.wait_for_selector('.fs-face'); p.wait_for_timeout(200)
        check(p.locator('.fs-face.is-blurred').count() == 3 and '0 sharp, 3 blurred' in p.inner_text('.fs-summary'), 'three faces start blurred: ' + p.inner_text('.fs-summary'))
        p.click('#fs-confirm'); p.wait_for_timeout(200)
        check("Type the person's name" in p.inner_text('.faces-sharp-error'), 'no name: the engine sentence is shown as it is')
        p.fill('#fs-name', 'Ann'); p.click('#fs-confirm'); p.wait_for_timeout(200)
        check("Tick that you have this person's OK" in p.inner_text('.faces-sharp-error'), 'no tick: the engine sentence about the OK')
        p.check('#fs-ok'); p.click('#fs-confirm'); p.wait_for_selector('.fs-person'); p.wait_for_timeout(200)
        check('Ann' in p.inner_text('.fs-people') and p.locator('.faces-sharp-error:visible').count() == 0, 'confirmed with name and tick: Ann is listed, the error is gone')
        sel = p.locator('select.fs-who[data-track="b"]')
        check(sel.input_value() == '' and sel.locator('option').all_inner_texts() == ['', 'Ann'], 'the menu is never pre-selected and lists confirmed people only')
        sel.select_option('Ann'); p.wait_for_timeout(300)
        check(p.locator('.fs-face[data-track="b"].is-sharp').count() == 1 and 'sharp (Ann)' in p.inner_text('.fs-face[data-track="b"]'), 'the linked face shows sharp (Ann)')
        check('1 sharp (Ann), 2 blurred' in p.inner_text('.fs-summary'), 'the count line: ' + p.inner_text('.fs-summary'))
        check(p.evaluate('window.lastSpec.tracks.find(t => t.id === "b").person') == 'Ann', 'the spec the page holds is the engine answer')
        p.click('[data-withdraw="Ann"]'); p.wait_for_timeout(300)
        check(p.locator('.fs-face.is-sharp').count() == 0 and '0 sharp, 3 blurred' in p.inner_text('.fs-summary'), 'withdrawing Ann re-blurs every face at once')
        small = p.evaluate("() => [...document.querySelectorAll('button,select,input[type=text]')].filter(e => e.getBoundingClientRect().height > 0 && e.getBoundingClientRect().height < 40).map(e => e.tagName + (e.id ? '#' + e.id : '') + ' ' + Math.round(e.getBoundingClientRect().height))")
        check(not small, f'no control under 40 px high {small}')
        check(p.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth'), 'no sideways scroll')
        p.keyboard.press('Tab'); check(p.evaluate('document.activeElement && document.activeElement !== document.body'), 'the keyboard reaches a control')
        check(not errs, 'no console errors' + (f': {errs[:2]}' if errs else ''))
        p.context.close()
    b.close()
srv.shutdown()
print('ALL OK' if ok else 'FAILED'); sys.exit(0 if ok else 1)
