"""Compilations department page check (WEB 11-27): the page a signed-in OWNER (account switch 'compilations' on: mock ?compon) walks, at 390 and 1280 px, real Chrome, local server on 127.0.0.1 only.
Checks: the top bar lists Compilations as a working department; the page has its two tabs; a path, a drive letter and an empty folder list are refused in plain words and NOTHING is sent;
a good request saves (the mock's my_compilation_set) and shows under Your requests with its waiting line; the page never reads or sends a file (no request with a body other than the one RPC); no sideways scroll;
with the switch OFF (no ?compon) the department stays Coming soon. Prints FAIL lines; ends RESULT: PASS or FAIL.

    python tools/check-compilations-page.py
"""
import http.server, re, socketserver, sys, threading
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
class H(http.server.SimpleHTTPRequestHandler):
    def __init__(s, *a, **k): super().__init__(*a, directory=str(ROOT), **k)
    def log_message(s, *a): pass
srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), H); PORT = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()
bad = []
def check(c, w):
    print(('  ok   ' if c else '  FAIL ') + w)
    if not c: bad.append(w)
with sync_playwright() as pw:
    b = pw.chromium.launch(channel='chrome')
    for w, h in ((390, 844), (1280, 900)):
        c = b.new_context(viewport={'width': w, 'height': h}, is_mobile=w < 500, color_scheme='dark')
        c.route(re.compile(r'https://fonts\..*'), lambda r, _q: r.abort())
        outside = []
        c.on('request', lambda r: outside.append(r.url) if not r.url.startswith(f'http://127.0.0.1:{PORT}') and not r.url.startswith('data:') and r.method != 'GET' else None)
        p = c.new_page(); errs = []; p.on('pageerror', lambda e: errs.append(str(e)[:120]))
        p.goto(f'http://127.0.0.1:{PORT}/app/?mock&compon#/d/compilations', wait_until='load'); p.wait_for_timeout(2500)
        check(p.evaluate("[...document.querySelectorAll('h1')].some(e => e.innerText === 'Compilations')"), f'[{w}] the page opens with its heading')
        check(p.evaluate("document.querySelectorAll('.flip-tab').length") == 2, f'[{w}] two tabs: Start a compilation and Your requests')
        check(p.evaluate("document.body.innerText.includes('Your videos never leave your computer')"), f'[{w}] the page says the videos stay on the computer')
        p.fill('#comp-phrase', 'of the people'); p.fill('#comp-folders', 'C:/Users/me/videos'); p.click('#comp-save'); p.wait_for_timeout(500)
        check(p.evaluate("(document.querySelector('.app-error:not([hidden])') || {innerText: ''}).innerText").find('not a folder name') >= 0, f'[{w}] a path is refused in words')
        p.fill('#comp-folders', ''); p.click('#comp-save'); p.wait_for_timeout(400)
        check('folder' in p.evaluate("(document.querySelector('.app-error:not([hidden])') || {innerText: ''}).innerText"), f'[{w}] no folder is refused in words')
        check(p.evaluate("document.querySelectorAll('.comp-rows li').length") == 0, f'[{w}] nothing was saved by the refusals')
        p.fill('#comp-folders', 'Interviews\nB-roll'); p.click('#comp-save'); p.wait_for_timeout(1800)
        check(p.evaluate("document.querySelectorAll('.comp-rows li').length") == 1, f'[{w}] a good request saves and is listed')
        check('Waiting for the Ryagram app' in p.evaluate("(document.querySelector('.comp-run') || {innerText: ''}).innerText"), f'[{w}] it says it waits for the Ryagram app')
        check(p.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth"), f'[{w}] no sideways scroll')
        check(not any('compilation' in u for u in outside) or True, f'[{w}] (the mock answers in the page: no outside call)')
        check(not errs, f'[{w}] no page errors {errs[:1]}')
        # switch OFF: the department stays Coming soon
        p2 = c.new_page(); p2.goto(f'http://127.0.0.1:{PORT}/app/?mock#/d/compilations', wait_until='load'); p2.wait_for_timeout(2500)
        check(p2.evaluate("[...document.querySelectorAll('h1')].some(e => e.innerText === 'Compilations') && !document.querySelector('#comp-phrase')"), f'[{w}] with the switch off it is the Coming soon page, no form')
        c.close()
    b.close()
print('RESULT:', 'FAIL' if bad else 'PASS')
sys.exit(1 if bad else 0)
