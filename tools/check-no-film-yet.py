"""A new project has no film yet (King's Island walk W1) in real Chrome, mock mode, desktop and phone: the three Render buttons are off, a line beside them says to choose a film, and after
'Use this film' the contact sheet button works. Needs Chrome.   python tools/check-no-film-yet.py"""
import http.server, socketserver, threading, sys
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
PORT = 8294


class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=str(ROOT), **k)
    def log_message(self, *a): pass


socketserver.TCPServer.allow_reuse_address = True
srv = socketserver.ThreadingTCPServer(('127.0.0.1', PORT), H)
threading.Thread(target=srv.serve_forever, daemon=True).start()
ok = True


def check(c, w):
    global ok
    print(('  ok   ' if c else '  FAIL ') + w); ok = ok and bool(c)


with sync_playwright() as pw:
    b = pw.chromium.launch(channel='chrome')
    for name, opts in (('desktop', dict(viewport={'width': 1280, 'height': 900})), ('phone', dict(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True))):
        print(name)
        p = b.new_context(**opts).new_page(); errs = []
        p.on('pageerror', lambda e: errs.append(str(e))); p.on('dialog', lambda d: d.accept())
        p.goto(f'http://127.0.0.1:{PORT}/app/?mock&empty', wait_until='load'); p.wait_for_selector('#np-title')
        p.fill('#np-title', 'My first film'); p.click('button:has-text("Create")'); p.wait_for_selector('h1:has-text("Version 1")')
        note = p.locator('[data-key="no-film-yet"]')
        check(note.is_visible() and 'Choose one above' in note.inner_text(), 'a line beside the buttons says there is no film yet and what to do')
        for label in ('Make contact sheet', 'Make preview', 'Render final film'):
            check(p.get_by_role('button', name=label).first.is_disabled(), f'{label} is off')
        check(p.get_by_role('button', name='Make contact sheet').first.get_attribute('title') == 'Choose a film above first.', 'and says why in its tooltip')
        check('schema-1' not in p.inner_text('main'), 'the engineer sentence is not on the page')
        p.get_by_role('button', name='Use this film').click(); p.wait_for_timeout(1500)
        check(not p.locator('[data-key="no-film-yet"]').is_visible(), 'the line goes away once a film is chosen')
        check(not p.get_by_role('button', name='Make contact sheet').first.is_disabled(), 'and the contact sheet button works')
        check(p.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth'), 'no sideways scroll')
        check(not errs, 'no page errors')
    b.close()
srv.shutdown()
print('ALL OK' if ok else 'FAILED'); sys.exit(0 if ok else 1)
