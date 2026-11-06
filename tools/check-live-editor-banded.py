"""The website's data editor with a BANDED film (NEXT-WEB 165) in real Chrome, mock mode, LOCAL server only, `liveEditor` ON in a local config copy: the preview is the engine's own drawer on a SYNTHETIC banded
bundle (?banded), the low and high colours are NOT offered (a banded film ignores them), the three bands are shown, the page colour and theme still change the picture, a preset changes only the page and theme,
and a preset with nothing to change says so. Pixels are read back from the picture. Needs Chrome.   python tools/check-live-editor-banded.py"""
import http.server, re, socketserver, sys, threading
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
PORT = 8302
PIXEL = """async (sel) => { const img = document.querySelector(sel); const im = new Image(); im.src = img.src; await im.decode();
  const c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight; const x = c.getContext('2d'); x.drawImage(im, 0, 0);
  const at = (px, py) => Array.from(x.getImageData(px, py, 1, 1).data.slice(0, 3)); return { page: at(2, 2), a: at(70, 50) }; }"""


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


BANDS = [[60, 90, 160], [163, 118, 116], [230, 150, 60]]
with sync_playwright() as pw:
    b = pw.chromium.launch(channel='chrome')
    for name, opts in (('desktop', dict(viewport={'width': 1280, 'height': 900})), ('phone', dict(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True))):
        print(name)
        ctx = b.new_context(**opts)
        ctx.route('**/assets/ryagram-config.js*', lambda r: r.fulfill(status=200, content_type='text/javascript', body=cfg))
        p = ctx.new_page(); errs = []
        p.on('pageerror', lambda e: errs.append(str(e))); p.on('console', lambda m: errs.append(m.text) if m.type == 'error' and 'Failed to load resource' not in m.text else None)
        p.goto(f'http://127.0.0.1:{PORT}/app/?mock&banded#/editor/data', wait_until='load')
        p.wait_for_selector('img.le-svg', timeout=20000)
        check(p.locator('#le-look-choropleth\.low').count() == 1 and p.locator('#le-look-choropleth\.high').count() == 1, 'the low and high colour rows ARE offered: this banded bundle records its ramp')
        check(p.locator('#le-look-page\\.background').count() == 1 and p.locator('#le-look-sequence\\.theme').count() == 0, 'the page colour row is there and the Theme row is NOT (a banded map has no light theme)')
        check(p.locator('[data-key="bands"] .le-swatch').count() == 3 and 'follow the low and high' in p.inner_text('[data-key="bands"]'), 'the three bands are shown, with the sentence that they follow the low and high colours')
        seen = set()
        for frame in (0, 10, 20, 30):
            p.fill('#le-range', str(frame)); p.dispatch_event('#le-range', 'input')
            px = p.evaluate(PIXEL, 'img.le-svg')['a']
            check(px in BANDS, f'frame {frame}: the area is one of the three band colours {px}')
            seen.add(tuple(px))
        check(len(seen) >= 2, 'and it changes band across the periods')
        # a preset with nothing to change for this film says so (a fresh look: nothing is set)
        # the low colour recolours the bands, and the draft note shows only while the slider is being moved
        p.eval_on_selector('#le-look-choropleth\.low', 'e => { e.value = "#ff0000"; e.dispatchEvent(new Event("change", {bubbles: true})); }'); p.wait_for_timeout(500)
        seen2 = set()
        for frame in (0, 10, 20, 30):
            p.fill('#le-range', str(frame)); p.dispatch_event('#le-range', 'input'); p.wait_for_timeout(150); seen2.add(tuple(p.evaluate(PIXEL, 'img.le-svg')['a']))
        check(seen2 != seen and any(c[0] > 150 and c[1] < 90 for c in seen2), f'a red low colour recolours the bands ({sorted(seen2)})')
        p.dispatch_event('#le-range', 'pointerdown'); p.eval_on_selector('#le-range', 'e => { e.value = "12"; e.dispatchEvent(new Event("input", {bubbles: true})); }'); p.wait_for_timeout(250)      # (fill() would also fire change, which is the release)
        check(p.locator('.le-draft').count() == 1, 'while the slider is being moved the page says it is a quick draft')
        p.evaluate("window.dispatchEvent(new Event('pointerup'))"); p.wait_for_timeout(300)
        check(p.locator('.le-draft').count() == 0, 'and the note is gone when the slider is let go')
        # the page colour and the theme still change the picture
        p.eval_on_selector('#le-look-page\\.background', 'e => { e.value = "#ffffff"; e.dispatchEvent(new Event("change", {bubbles: true})); }')
        p.wait_for_timeout(500)
        check(sum(p.evaluate(PIXEL, 'img.le-svg')['page']) >= 750, 'a white page colour is drawn')
        # a preset changes only the page and the theme
        p.click('[data-preset="white-background"]'); p.wait_for_timeout(600)
        look = p.evaluate("window.ryagramMockEditor.draft(window.RYAGRAM_MOCK_EDITOR_PROJECT, 'data').state.look")
        check(sorted(look.keys()) == ['choropleth.high', 'choropleth.low', 'page.background'], f'White background sets low, high and the page colour, not the theme this map cannot switch ({sorted(look.keys())})')
        check(p.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth'), 'no sideways scroll')
        p.screenshot(path=f'D:/Ryagram-scratch/WEB/live-editor-banded-{name}.png', full_page=True)
        check(not errs, 'no console errors' + (f': {errs[:2]}' if errs else ''))
        ctx.close()
    b.close()
srv.shutdown()
print('ALL OK' if ok else 'FAILED'); sys.exit(0 if ok else 1)
