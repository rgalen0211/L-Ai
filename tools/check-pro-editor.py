"""PRO mode of the live editor (WEB 11-20, paper proposals/WEB-PRO-EDITOR-1120.md), real Chrome, mock mode, LOCAL server only, `liveEditor` ON in a local config copy.
Simple is the default and the page is as before; Pro shows the technical layer: the choice is kept, timeline zoom, frame step, J K L shuttle, markers (kept), safe-area guides, the history list with 'Undo back to here',
and Split at the playhead for a text clip as ONE undo step. Page-only tools change nothing in the film (no change appears in the history). Needs Chrome.   python tools/check-pro-editor.py"""
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
on_cfg = re.sub(r"liveEditor:\s*(?:false|'account')", 'liveEditor: true', base)
ok = True


def check(c, w):
    global ok
    print(('  ok   ' if c else '  FAIL ') + w); ok = ok and bool(c)


def page(ctx, errs):
    p = ctx.new_page()
    p.on('pageerror', lambda e: errs.append(str(e))); p.on('console', lambda m: errs.append(m.text) if m.type == 'error' and 'Failed to load resource' not in m.text else None)
    return p


def new_ctx(b):
    ctx = b.new_context(viewport={'width': 1280, 'height': 1000})
    ctx.route(re.compile(r'https://fonts\.(googleapis|gstatic)\.com/.*'), lambda r, _q: r.abort())
    ctx.route('**/assets/ryagram-config.js*', lambda r, _q: r.fulfill(status=200, content_type='text/javascript', body=on_cfg))
    return ctx


with sync_playwright() as pw:
    b = pw.chromium.launch(channel='chrome')
    errs = []
    ctx = new_ctx(b)
    p = page(ctx, errs)
    url = f'http://127.0.0.1:{PORT}/app/?mock#/editor/compilation'
    p.goto(url, wait_until='load'); p.wait_for_selector('.le-lanes', state='attached', timeout=15000); p.wait_for_timeout(600)

    print('Simple is the default')
    check(p.locator('.le-pro-switch').count() == 1 and p.get_by_role('button', name='Simple').get_attribute('aria-pressed') == 'true', 'a Simple | Pro switch, Simple pressed')
    check(p.locator('section.le-pro:visible').count() == 0, 'no PRO tools on screen')
    n_simple = p.locator('.le-top button').count()

    print('Pro on, and kept')
    p.get_by_role('button', name='Pro', exact=True).click(); p.wait_for_timeout(300)
    check(p.locator('section.le-pro:visible').count() == 2 and p.get_by_role('button', name='Pro', exact=True).get_attribute('aria-pressed') == 'true', 'the PRO tools and the history panel show')
    p.goto(url, wait_until='load'); p.wait_for_selector('.le-lanes', state='attached', timeout=15000); p.wait_for_timeout(1200)
    check(p.locator('section.le-pro:visible').count() == 2, 'the choice is kept after a reload')

    print('zoom')
    w0 = p.locator('.le-lanes .le-lane').nth(0).bounding_box()['width']
    p.get_by_role('button', name='Zoom the timeline in').click(); p.wait_for_timeout(200)
    w1 = p.locator('.le-lanes .le-lane').nth(0).bounding_box()['width']
    check(1.8 < w1 / w0 < 2.2, f'Zoom + doubles the lanes ({w0:.0f} to {w1:.0f} px)')
    check('2×' in p.inner_text('.le-pro-zoomlabel'), 'and says so')
    p.get_by_role('button', name='Zoom the timeline out').click(); p.wait_for_timeout(200)
    check(abs(p.locator('.le-lanes .le-lane').nth(0).bounding_box()['width'] - w0) < 2, 'Zoom − puts it back')

    print('frame step and J K L')
    v0 = int(p.locator('#le-range').input_value())
    p.get_by_role('button', name='Forward one frame').click(); p.wait_for_timeout(200)
    check(int(p.locator('#le-range').input_value()) == v0 + 1, 'Frame ▶ moves the playhead one step')
    p.get_by_role('button', name='Back one frame').click(); p.wait_for_timeout(200)
    check(int(p.locator('#le-range').input_value()) == v0, 'and ◀ Frame goes back')
    p.get_by_role('button', name='Put a marker at the playhead').focus()
    p.keyboard.press('l'); p.wait_for_timeout(700)
    v1 = int(p.locator('#le-range').input_value())
    check(v1 > v0 + 3, f'L shuttles forward ({v0} to {v1})')
    p.keyboard.press('k'); p.wait_for_timeout(200)
    v2 = int(p.locator('#le-range').input_value()); p.wait_for_timeout(400)
    check(int(p.locator('#le-range').input_value()) == v2, 'K stops it')
    p.keyboard.press('j'); p.wait_for_timeout(700)
    check(int(p.locator('#le-range').input_value()) < v2 - 3, 'J shuttles backward')
    p.keyboard.press('k')

    print('markers')
    p.locator('#le-range').evaluate("e => { e.value = '30'; e.dispatchEvent(new Event('input', { bubbles: true })); }"); p.wait_for_timeout(200)
    p.keyboard.press('m'); p.wait_for_timeout(200)
    check(p.locator('.le-pro-mark').count() == 1, 'M puts a marker at the playhead')
    p.locator('#le-range').evaluate("e => { e.value = '5'; e.dispatchEvent(new Event('input', { bubbles: true })); }"); p.wait_for_timeout(200)
    p.get_by_role('button', name='Next marker').click(); p.wait_for_timeout(200)
    check(int(p.locator('#le-range').input_value()) == 30, 'Marker ▶ jumps to it')
    p.goto(url, wait_until='load'); p.wait_for_selector('.le-lanes', state='attached', timeout=15000); p.wait_for_timeout(1200)
    check(p.locator('.le-pro-mark').count() == 1, 'the marker is kept after a reload')

    print('safe areas')
    p.get_by_role('button', name='Safe areas').click(); p.wait_for_timeout(200)
    check(p.locator('.le-view.le-pro-safe').count() == 1 and p.evaluate("getComputedStyle(document.querySelector('.le-view'), '::before').borderTopStyle") == 'dashed', 'the guides are drawn over the picture')

    print('page-only tools change nothing in the film')
    check('No changes yet' in p.inner_text('.le-pro-hist'), 'zoom, steps, markers and guides left the history empty')

    print('history and Undo back to here')
    p.locator('.le-lanes .le-c-text.le-clip').first.click(); p.wait_for_timeout(200)
    for v in ('2.5', '2.7'):
        p.fill('#le-len', v); p.locator('#le-len').press('Tab'); p.wait_for_timeout(300)
    items = p.locator('.le-pro-hist li')
    check(items.count() == 2 and 'Trimmed' in items.nth(0).inner_text(), f'two changes are listed ({items.count()}), described in words')
    p.get_by_role('button', name='Undo step 1 and everything after it').click(); p.wait_for_timeout(500)
    check('No changes yet' in p.inner_text('.le-pro-hist'), 'Undo back to step 1 takes both back')

    print('split a text clip: one undo step')
    p.locator('.le-lanes .le-c-text.le-clip').first.click(); p.wait_for_timeout(200)
    c = p.evaluate("(() => { const e = document.querySelector('.le-lanes .le-c-text.le-clip'); return e ? e.getAttribute('aria-label') : null; })()")
    m = re.search(r'starts (\d+):(\d+)\.(\d), ([\d.]+) seconds', c or '')
    check(bool(m), f'a text clip to split ({c})')
    start = int(m.group(1)) * 60 + int(m.group(2)) + int(m.group(3)) / 10; ln = float(m.group(4))
    n_text = p.locator('.le-lanes .le-c-text.le-clip').count()
    mid = round(start + ln / 2, 1)
    p.locator('#le-range').evaluate("(e, v) => { e.value = String(v); e.dispatchEvent(new Event('input', { bubbles: true })); }", int(round(mid * 10))); p.wait_for_timeout(200)
    p.get_by_role('button', name='Split at playhead (S)').click(); p.wait_for_timeout(500)
    check(p.locator('.le-lanes .le-c-text.le-clip').count() == n_text + 1, f'the clip is now two ({n_text} to {p.locator(".le-lanes .le-c-text.le-clip").count()})')
    check(p.locator('.le-pro-hist li').count() == 2, 'the history shows its two changes')
    p.get_by_role('button', name='Undo', exact=True).click(); p.wait_for_timeout(500)
    check(p.locator('.le-lanes .le-c-text.le-clip').count() == n_text and 'No changes yet' in p.inner_text('.le-pro-hist'), 'ONE Undo puts it back as it was (the history is empty again)')

    print('a video clip is not split (said plainly)')
    p.locator('.le-lanes .le-c-video.le-clip').first.click(); p.wait_for_timeout(200)
    p.get_by_role('button', name='Split at playhead (S)').click(); p.wait_for_timeout(200)
    check('not built yet' in p.inner_text('.le-pro-note'), 'it says a video clip needs a new kind of change')

    print('back to Simple')
    p.get_by_role('button', name='Simple').click(); p.wait_for_timeout(200)
    check(p.locator('section.le-pro:visible').count() == 0 and p.locator('.le-view.le-pro-safe').count() == 0 and not p.evaluate("document.querySelector('.le').classList.contains('le-zoomed')"), 'Simple hides the tools and drops the guides and the zoom')
    ctx.close()

    print('the data film page too')
    ctx = new_ctx(b); p = page(ctx, errs)
    p.goto(f'http://127.0.0.1:{PORT}/app/?mock#/editor/data', wait_until='load'); p.wait_for_selector('#le-range', timeout=15000); p.wait_for_timeout(800)
    p.get_by_role('button', name='Pro', exact=True).click(); p.wait_for_timeout(300)
    check(p.locator('section.le-pro:visible').count() == 2 and p.locator('#le-pro-split').count() == 0, 'Pro shows on a data film, without Split (no clips to split)')
    p.get_by_role('button', name='Safe areas').click(); p.wait_for_timeout(200)
    check(p.locator('.le-pro-safe').count() >= 1, 'the guides show')
    p.get_by_role('button', name='Forward one frame').click(); p.wait_for_timeout(300)
    check(p.locator('.le-pro-tc').inner_text() != '–', 'the time and frame show')
    ctx.close()
    check(not errs, 'no console errors' + (f': {errs[:2]}' if errs else ''))
    b.close()
srv.shutdown(); srv.server_close()
print('ALL OK' if ok else 'FAILED'); sys.exit(0 if ok else 1)
