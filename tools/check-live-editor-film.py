"""The data editor with a film's REAL frames (WEB piece B) in real Chrome, mock mode, LOCAL server only, `liveEditor` ON in a local config copy, desktop and phone. The page is given a fixture film API
(window.ryagramFilmApi: a plan and two film bundle windows made by the engine on a SYNTHETIC story; a window arrives after a short wait and reports progress): the picture is the engine's drawing, a moment in
a title is said to be a title, the second window shows 'Drawing this part of your film: N%' and then its picture, the slider, ruler, film lane and keys work, nothing sticks out sideways, no console errors.
Without the API the editor keeps its stand-in picture. Needs Chrome.   python tools/check-live-editor-film.py"""
import http.server, re, socketserver, sys, threading
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]


class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=str(ROOT), **k)
    def log_message(self, *a): pass
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store'); super().end_headers()


srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), H)
PORT = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()
base = (ROOT / 'assets/ryagram-config.js').read_text(encoding='utf-8')
on_cfg, _n = re.subn(r"\bliveEditor:\s*(?:false|'account')", 'liveEditor: true', base)
assert _n == 1
API = """
window.ryagramFilmApi = () => ({
  plan: async () => ({ fps: 30, frames: 120, seconds: 4, windows: [{ seconds: [0, 2], window: '0:2' }, { seconds: [2, 4], window: '2:4' }],
    timeline: { clips: [{ id: 't', kind: 'title', label: 'Invented title', start: 0, seconds: 1, drawn: false }, { id: 'main', kind: 'render', label: 'Invented film', start: 1, seconds: 4, drawn: true }],
      render_clip: 'main', render_start: 1, total_seconds: 5, total_frames: 150 } }),
  window: async (text, o) => {
    const [a, b] = text.split(':'); o.onProgress(0.25); await new Promise(r => setTimeout(r, a === '2' ? 1200 : 300)); o.onProgress(0.6);
    const data = window.__fixtures[a + '-' + b]; if (!data) throw new Error('that part of your film is not here');          // the page's own connect-src allows only Supabase, so the fixtures are handed in
    const bin = atob(data), out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out;
  }
});
"""
import base64, json
FIX = json.dumps({k: base64.b64encode((ROOT / f'tests/fixtures/film-bundle-synthetic-{k}.zip').read_bytes()).decode() for k in ('0-2', '2-4')})
ok = True


def check(c, w):
    global ok
    print(('  ok   ' if c else '  FAIL ') + w); ok = ok and bool(c)


with sync_playwright() as pw:
    b = pw.chromium.launch(channel='chrome')
    for name, opts in (('desktop', dict(viewport={'width': 1200, 'height': 900})), ('phone', dict(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True))):
        print(name)
        ctx = b.new_context(**opts); errs = []
        ctx.route(re.compile(r'https://fonts\.(googleapis|gstatic)\.com/.*'), lambda r, _q: r.abort())
        ctx.route('**/assets/ryagram-config.js*', lambda r, _q: r.fulfill(status=200, content_type='text/javascript', body=on_cfg))
        ctx.route(re.compile(r'.*/assets/app-editor-data\.js.*'), lambda r, _q: r.abort())               # the website's stand-in data editor (no look bundle), where the film API takes over
        ctx.add_init_script('window.__fixtures = ' + FIX + ';' + API)
        p = ctx.new_page(); p.on('pageerror', lambda e: errs.append(str(e))); p.on('console', lambda m: errs.append(m.text) if m.type == 'error' and 'Failed to load resource' not in m.text else None)
        p.goto(f'http://127.0.0.1:{PORT}/app/?mock#/editor/data', wait_until='load'); p.wait_for_selector('.le-film', timeout=15000)
        p.wait_for_selector('.le-film-view svg', timeout=20000)
        check(p.locator('.le-film-view svg').count() == 1 and len(p.evaluate("document.querySelector('.le-film-view').innerHTML")) > 100000, 'the picture is the engine\'s own drawing of the film')
        p.screenshot(path=f'D:/Ryagram-scratch/WEB/editor-film-frame-{name}.png', full_page=True)
        check('stand-in' not in p.inner_text('.le-film').lower(), 'and it is not the stand-in')
        pos = p.locator('.le-film .le-pos').inner_text()
        check(pos.startswith('0:01.0 / 0:05.0'), f'it opens on the render clip\'s first moment ({pos})')
        check(p.locator('.le-ruler-tick').count() >= 5 and p.locator('.le-film-clip').count() == 2, 'the ruler and the film lane show the whole film with its title block and its film')
        check(p.locator('.le-film-clip').first.inner_text() == 'Invented title', 'a clip label is shown as text')
        check(p.locator('.le-film-status').inner_text() == '' , 'nothing is claimed while the picture is there')
        # a moment in the title block
        p.evaluate("document.getElementById('le-film-range').value = '15'; document.getElementById('le-film-range').dispatchEvent(new Event('input', { bubbles: true }))")
        p.wait_for_timeout(200)
        check('title or a clip that is drawn when the film is made' in p.inner_text('.le-film-view'), 'a moment in the title block says what it is, and invents no picture')
        # a moment in the second window: the page says it is drawing, then draws
        p.evaluate("document.getElementById('le-film-range').value = '120'; document.getElementById('le-film-range').dispatchEvent(new Event('input', { bubbles: true }))")
        p.wait_for_timeout(150)
        line = p.locator('.le-film-status').inner_text()
        check(line.startswith('Drawing this part of your film'), f'a window on its way says so ({line!r})')
        check(re.search(r'\d+%', line) is not None or line == 'Drawing this part of your film.', 'and gives the worker\'s own percent or none')
        for _ in range(80):                                                  # (the page's CSP forbids wait_for_function's eval)
            if p.locator('.le-film-status').inner_text() == '': break
            p.wait_for_timeout(250)
        a1 = p.evaluate("document.querySelector('.le-film-view').innerHTML.length")
        check(a1 > 100000, 'then the picture of that moment is drawn')
        # try colours: preview only, redraws at once, and puts the film's colours back
        p.locator('#le-film-range').focus(); p.keyboard.press('Home')
        for _ in range(3): p.keyboard.press('l')
        p.wait_for_timeout(300)
        check(p.locator('.le-film-col-list input[type=color]').count() >= 3 and 'not saved to your film yet' in p.inner_text('.le-film-colours'), 'the colours of the picture are offered, and the page says they are not saved')
        before = p.evaluate("document.querySelector('.le-film-view').innerHTML.length + ':' + document.querySelector('.le-film-view').innerHTML.slice(2000, 2100)")
        p.evaluate("(() => { const i = document.querySelector('.le-film-col-list input[type=color]'); i.value = '#ff00aa'; i.dispatchEvent(new Event('input', { bubbles: true })); })()")
        p.wait_for_timeout(300)
        mid = p.evaluate("document.querySelector('.le-film-view').innerHTML")
        check('#ff00aa' in mid.lower() or 'rgb(255,0,170)' in mid.replace(' ', ''), 'a colour picked in the picker is in the drawing at once')
        p.click('.le-film-colours button'); p.wait_for_timeout(300)
        again = p.evaluate("document.querySelector('.le-film-view').innerHTML.length + ':' + document.querySelector('.le-film-view').innerHTML.slice(2000, 2100)")
        check(again == before, "and the film own colours come back")
        # keys
        p.locator('#le-film-range').focus(); p.keyboard.press('Home'); p.wait_for_timeout(100)
        p.keyboard.press('l'); p.wait_for_timeout(150)
        check(int(p.locator('#le-film-range').input_value()) > 0, 'L jumps forward')
        p.keyboard.press('Space'); p.wait_for_timeout(300)
        check(p.locator('.le-film .le-scrub button').inner_text() == 'Pause', 'Space plays')
        p.keyboard.press('Space'); p.wait_for_timeout(200)
        check(p.locator('.le-film .le-scrub button').inner_text() == 'Play', 'Space pauses')
        check(p.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth'), 'no sideways scroll')
        p.screenshot(path=f'D:/Ryagram-scratch/WEB/editor-film-{name}.png', full_page=True)
        check(not errs, 'no console errors' + (f': {errs[:2]}' if errs else ''))
        ctx.close()
        # no film API: the stand-in stays
        ctx = b.new_context(**opts); ctx.route('**/assets/ryagram-config.js*', lambda r, _q: r.fulfill(status=200, content_type='text/javascript', body=on_cfg))
        ctx.route(re.compile(r'.*/assets/app-editor-data\.js.*'), lambda r, _q: r.abort())
        p = ctx.new_page(); p.goto(f'http://127.0.0.1:{PORT}/app/?mock#/editor/data', wait_until='load'); p.wait_for_selector('.le-view', timeout=15000); p.wait_for_timeout(500)
        check(p.locator('.le-film').count() == 0 and p.locator('.le-tl-strip').count() == 1, 'without a film API the editor keeps its stand-in picture and film strip')
        ctx.close()
    b.close()
srv.shutdown(); srv.server_close()
print('ALL OK' if ok else 'FAILED'); sys.exit(0 if ok else 1)
