"""The website's data editor with a BAR RACE and with a STREAMED film (NEXT-WEB 169) in real Chrome, mock mode, LOCAL server only, `liveEditor` ON in a local config copy.
?bars: a REAL engine bar-race scene (first 2 seconds), drawn by the engine's rules drawer: no low/high rows, the page colour and theme change the picture (pixels read back), the scrubber moves, the sentence says
the bar colour waits for the worker and that the preview holds only the first seconds. ?stream&streamstep: a streamed map: the scrubber is whole at once, the picture says it is still loading until the chunks
come, then draws; ?stream&streamstep&streamfail: a broken stream is said in words and the page stays usable. Needs Chrome.   python tools/check-live-editor-bars.py"""
import http.server, re, socketserver, sys, threading
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
PORT = 8303
PIXEL = """async (sel) => { const img = document.querySelector(sel); const im = new Image(); im.src = img.src; await im.decode();
  const c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight; const x = c.getContext('2d'); x.drawImage(im, 0, 0);
  return { w: im.naturalWidth, h: im.naturalHeight, page: Array.from(x.getImageData(2, 2, 1, 1).data.slice(0, 3)), src: img.src.length }; }"""


class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=str(ROOT), **k)
    def log_message(self, *a): pass
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store'); super().end_headers()


socketserver.TCPServer.allow_reuse_address = True
srv = socketserver.ThreadingTCPServer(('127.0.0.1', PORT), H)
threading.Thread(target=srv.serve_forever, daemon=True).start()
cfg = re.sub(r'liveEditor:\s*false', 'liveEditor: true', (ROOT / 'assets/ryagram-config.js').read_text(encoding='utf-8'))
ok = True


def check(c, w):
    global ok
    print(('  ok   ' if c else '  FAIL ') + w); ok = ok and bool(c)


def page_for(ctx, query, errs):
    p = ctx.new_page()
    p.on('pageerror', lambda e: errs.append(str(e))); p.on('console', lambda m: errs.append(m.text) if m.type == 'error' and 'Failed to load resource' not in m.text else None)
    p.goto(f'http://127.0.0.1:{PORT}/app/?mock&{query}#/editor/data', wait_until='load')
    return p


def set_range(p, v):
    p.fill('#le-range', str(v)); p.dispatch_event('#le-range', 'input'); p.wait_for_timeout(300)


with sync_playwright() as pw:
    b = pw.chromium.launch(channel='chrome')
    for name, opts in (('desktop', dict(viewport={'width': 1280, 'height': 900})), ('phone', dict(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True))):
        print(name + ': the bar race')
        ctx = b.new_context(**opts)
        ctx.route('**/assets/ryagram-config.js*', lambda r: r.fulfill(status=200, content_type='text/javascript', body=cfg))
        errs = []
        p = page_for(ctx, 'bars', errs)
        p.wait_for_selector('img.le-svg', timeout=20000)
        px = p.evaluate(PIXEL, 'img.le-svg')
        check(px['w'] == 1920 and px['h'] == 1080, f'the picture is the engine frame at the film\u2019s own size {px["w"]}x{px["h"]}')
        check(p.locator('#le-look-choropleth\\.low').count() == 0 and p.locator('#le-look-choropleth\\.high').count() == 0 and p.locator('#le-look-state\\.outline_width').count() == 0, 'no low, high or border rows for a bar race')
        check(p.locator('#le-look-page\\.background').count() == 1 and p.locator('#le-look-sequence\\.theme').count() == 1, 'the page colour and the theme rows are there')
        txt = p.inner_text('[data-key="bars"]')
        check('bar race' in txt and 'waits for the worker' in txt and 'first 2 seconds' in txt, f'the plain sentences: one bar colour waits for the worker, only the first seconds held ({txt[:90]!r})')
        p.click('[data-preset="monochrome"]'); p.wait_for_timeout(400)         # a preset with nothing to change for this film says so (a fresh look: nothing is set yet)
        check('does not use' in p.inner_text('.le'), 'Monochrome says it changes only the low and high colours, which this film does not use')
        before = px['src']
        set_range(p, 40)
        check(p.evaluate(PIXEL, 'img.le-svg')['src'] != before, 'moving the scrubber draws another frame')
        p.eval_on_selector('#le-look-page\\.background', 'e => { e.value = "#ffffff"; e.dispatchEvent(new Event("change", {bubbles: true})); }')
        p.wait_for_timeout(500)
        check(sum(p.evaluate(PIXEL, 'img.le-svg')['page']) >= 750, 'a white page colour is drawn')
        p.click('[data-preset="white-background"]'); p.wait_for_timeout(600)
        look = p.evaluate("window.ryagramMockEditor.draft(window.RYAGRAM_MOCK_EDITOR_PROJECT, 'data').state.look")
        check(sorted(look.keys()) == ['page.background', 'sequence.theme'], f'White background sets the page colour and the theme ({sorted(look.keys())})')
        check(p.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth'), 'no sideways scroll')
        p.screenshot(path=f'D:/Ryagram-scratch/WEB/live-editor-bars-{name}.png', full_page=True)
        check(not errs, 'no console errors' + (f': {errs[:2]}' if errs else ''))
        ctx.close()

        print(name + ': a streamed film')
        ctx = b.new_context(**opts)
        ctx.route('**/assets/ryagram-config.js*', lambda r: r.fulfill(status=200, content_type='text/javascript', body=cfg))
        errs = []
        p = page_for(ctx, 'stream&streamstep', errs)
        p.wait_for_selector('#le-range:not([disabled])', timeout=20000)
        check(int(p.get_attribute('#le-range', 'max')) == 30, 'the scrubber is whole as soon as the head is in (31 frames)')
        check('Still loading the film' in p.inner_text('.le') or 'still loading' in p.inner_text('.le'), 'the page says the film is still loading')
        check(p.locator('img.le-svg').count() == 1 and not p.locator('img.le-svg').get_attribute('src'), 'no half picture is drawn before the chunks are here')
        set_range(p, 0)
        p.evaluate('window.ryagramMockStreamStep()'); p.wait_for_timeout(300)
        check(not p.locator('img.le-svg').get_attribute('src'), 'one chunk is not enough: a period also waits for the next one')
        p.evaluate('window.ryagramMockStreamStep()'); p.wait_for_timeout(500)
        check(bool(p.locator('img.le-svg').get_attribute('src')), 'two chunks: the first period draws')
        set_range(p, 30)
        check('still loading' in p.inner_text('.le').lower(), 'the last period says it is still loading')
        for _ in range(2):
            p.evaluate('window.ryagramMockStreamStep()'); p.wait_for_timeout(300)
        p.wait_for_timeout(500)
        check(bool(p.locator('img.le-svg').get_attribute('src')) and 'to come' not in p.inner_text('.le'), 'every chunk in: the last period draws and the loading note is gone')
        check(p.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth'), 'no sideways scroll')
        check(not errs, 'no console errors' + (f': {errs[:2]}' if errs else ''))
        ctx.close()

        print(name + ': a stream that breaks')
        ctx = b.new_context(**opts)
        ctx.route('**/assets/ryagram-config.js*', lambda r: r.fulfill(status=200, content_type='text/javascript', body=cfg))
        errs = []
        p = page_for(ctx, 'stream&streamstep&streamfail', errs)
        p.wait_for_selector('#le-range:not([disabled])', timeout=20000)
        for _ in range(2):
            p.evaluate('window.ryagramMockStreamStep()'); p.wait_for_timeout(400)
        p.wait_for_timeout(600)
        check('could not be loaded' in p.inner_text('.le'), 'a broken stream is said in words')
        check(p.locator('#le-look-page\\.background').count() == 1, 'and the page still works')
        ctx.close()
    b.close()
srv.shutdown()
print('ALL OK' if ok else 'FAILED'); sys.exit(0 if ok else 1)
