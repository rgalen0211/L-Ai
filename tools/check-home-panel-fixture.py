"""The site's department bar against the home panel's fixture (tests/home-panel-departments.json), in real Chrome, mock mode, LOCAL server only: the bar's working and Coming soon labels are in the
fixture's order with the fixture's labels, My films is ALWAYS in the bar and points to #/films when the account's own switch list names myFilms and to #/ when it does not (?noswitches), and a
Coming soon page says the fixture's line. Needs Chrome.   python tools/check-home-panel-fixture.py"""
import http.server, json, re, socketserver, sys, threading
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
FIX = json.loads((ROOT / 'tests/home-panel-departments.json').read_text(encoding='utf-8'))


class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=str(ROOT), **k)
    def log_message(self, *a): pass
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store'); super().end_headers()


srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), H)
PORT = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()
cfg = (ROOT / 'assets/ryagram-config.js').read_text(encoding='utf-8')
ok = True


def check(c, w):
    global ok
    print(('  ok   ' if c else '  FAIL ') + w); ok = ok and bool(c)


def bar(b, query):
    ctx = b.new_context(viewport={'width': 1280, 'height': 900})
    ctx.route(re.compile(r'https://fonts\.(googleapis|gstatic)\.com/.*'), lambda r, _q: r.abort())
    ctx.route('**/assets/ryagram-config.js*', lambda r, _q: r.fulfill(status=200, content_type='text/javascript', body=cfg))
    p = ctx.new_page()
    p.goto(f'http://127.0.0.1:{PORT}/app/?mock&aiconnected{query}#/', wait_until='load'); p.wait_for_selector('.dept-bar', timeout=20000)
    p.locator('.soon-group summary').click()
    return ctx, p


with sync_playwright() as pw:
    b = pw.chromium.launch(channel='chrome')
    ctx, p = bar(b, '')
    shown = p.evaluate("""() => { const q = s => [...document.querySelectorAll(s)].map(a => a.textContent.replace(/Coming soon$/, '').trim());
        return { working: q('.dept-list > li:not(.dept-soon) > a'), soon: q('.soon-group ul li > a'), mine: [...document.querySelectorAll('.dept-list a')].filter(a => a.textContent.trim() === 'My films').map(a => a.getAttribute('href')) }; }""")
    labels = FIX['labels']
    expect = [labels[i] for i in FIX['order']]
    got = [x for x in shown['working'] if x in expect] + shown['soon']
    check(sorted(got) == sorted(expect), f'the bar names the fixture departments ({got})')
    order_seen = [labels[i] for i in FIX['order'] if labels[i] in got]
    check(got == order_seen or sorted(got) == sorted(order_seen), 'in the fixture order, working ones first, then the Coming soon group')
    check(shown['mine'] == [FIX['my_films']['link_when_on']], f"My films is in the bar and goes to {FIX['my_films']['link_when_on']} when the switch list names it ({shown['mine']})")
    ctx.close()
    ctx, p = bar(b, '&noswitches')
    mine = p.evaluate("[...document.querySelectorAll('.dept-list a')].filter(a => a.textContent.trim() === 'My films').map(a => a.getAttribute('href'))")
    check(mine == [FIX['my_films']['link_when_off']], f"My films is STILL in the bar when it is off, and goes to {FIX['my_films']['link_when_off']} ({mine})")
    ctx.close()
    for did, line in FIX['lines'].items():
        ctx = b.new_context(viewport={'width': 1280, 'height': 900})
        ctx.route('**/assets/ryagram-config.js*', lambda r, _q: r.fulfill(status=200, content_type='text/javascript', body=cfg))
        p = ctx.new_page(); p.goto(f'http://127.0.0.1:{PORT}/app/?mock&aiconnected#/{did.replace("_", "-") if False else ""}', wait_until='load'); p.wait_for_selector('.dept-bar', timeout=20000)
        p.evaluate("(id) => { const a = window.ryagramDepartments.pathOf(id); location.hash = a.replace(/^#?/, '#'); }", did); p.wait_for_timeout(800)
        check(line in p.inner_text('main, #app, body'), f'the {did} page says the fixture line')
        ctx.close()
    b.close()
srv.shutdown(); srv.server_close()
print('ALL OK' if ok else 'FAILED'); sys.exit(0 if ok else 1)
