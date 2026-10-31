"""The live editor's data-film mode with the engine's own drawer (NEXT-WEB 154) in real Chrome, mock mode, LOCAL server only, with `liveEditor` switched on in a LOCAL copy of the config:
the preview is ENGINE's look-draw.js drawing the SYNTHETIC bundle (tests/fixtures/look-bundle-synthetic.json), the scrubber goes through the bundle's own periods, the Look panel offers
only keys the drawer honours (border width, which the drawer names as ignored, is not offered), the six ready-made looks apply as a set and each can be undone, a colour that matches the
page warns without blocking, 'Render final film' lists what will render, and a bundle that fails to open says so. Pixels are read back from the picture the person sees. Needs Chrome.

    python tools/check-live-editor-data.py [outdir]        (default D:/Ryagram-scratch/WEB/live-editor-data-shots)
"""
import http.server
import json
import re
import socketserver
import sys
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('D:/Ryagram-scratch/WEB/live-editor-data-shots')
PORT = 8262
BASE = f'http://127.0.0.1:{PORT}'
PIXEL = """async (sel) => {
  const img = document.querySelector(sel);
  const im = new Image(); im.src = img.src; await im.decode();
  const c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight;
  const x = c.getContext('2d'); x.drawImage(im, 0, 0);
  const at = (px, py) => Array.from(x.getImageData(px, py, 1, 1).data.slice(0, 3));
  return { page: at(2, 2), a: at(70, 50), b: at(220, 50), c: at(160, 130) };
}"""


def serve():
    class H(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *a, **k):
            super().__init__(*a, directory=str(ROOT), **k)

        def log_message(self, *a):
            pass

        def end_headers(self):
            self.send_header('Cache-Control', 'no-store')
            super().end_headers()
    socketserver.TCPServer.allow_reuse_address = True
    srv = socketserver.ThreadingTCPServer(('127.0.0.1', PORT), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    srv = serve()
    ok = True

    def check(cond, what):
        nonlocal ok
        print(('  ok   ' if cond else '  FAIL ') + what)
        ok = ok and bool(cond)

    cfg = (ROOT / 'assets/ryagram-config.js').read_text(encoding='utf-8')
    flipped = re.sub(r'liveEditor:\s*false', 'liveEditor: true', cfg)
    assert 'liveEditor: true' in flipped
    draft_look = "window.ryagramMockEditor.draft(window.RYAGRAM_MOCK_EDITOR_PROJECT, 'data').state.look"
    try:
        with sync_playwright() as pw:
            b = pw.chromium.launch(channel='chrome')
            for name, opts in (('desktop', dict(viewport={'width': 1280, 'height': 900})),
                               ('phone', dict(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True))):
                print(name)
                ctx = b.new_context(**opts)
                ctx.route('**/assets/ryagram-config.js*', lambda route: route.fulfill(status=200, content_type='text/javascript', body=flipped))
                ctx.route('https://claude.ai/**', lambda route: route.abort())
                p = ctx.new_page()
                errors = []
                p.on('pageerror', lambda e: errors.append(str(e)))
                p.on('console', lambda m: errors.append(m.text) if m.type == 'error' and 'status of 404' not in m.text and 'Failed to load resource' not in m.text else None)
                p.goto(f'{BASE}/app/?mock#/editor/data', wait_until='load')
                p.wait_for_selector('img.le-svg', timeout=20000)
                check(p.get_attribute('.le-view', 'aria-label') == 'Preview of 2003', 'opens on the last period of the film, labelled for a screen reader')
                check(p.inner_text('.le-pos') == '2003', 'the position says 2003')
                src_last = p.get_attribute('img.le-svg', 'src')
                check(src_last.startswith('data:image/svg+xml'), 'the picture is the engine\u2019s drawing as a data image')
                px = p.evaluate(PIXEL, 'img.le-svg')
                check(px['page'] == [20, 20, 26], f'the dark page is drawn ({px["page"]})')
                # the scrubber goes through the bundle's own frames: 4 periods x 10 frames
                check(p.get_attribute('#le-range', 'max') == '30', 'the scrubber has one step for each frame of the bundle (31)')
                p.fill('#le-range', '0')
                p.dispatch_event('#le-range', 'input')
                check(p.inner_text('.le-pos') == '2000' and p.get_attribute('.le-view', 'aria-label') == 'Preview of 2000', 'moving to the first frame says 2000')
                check(p.get_attribute('img.le-svg', 'src') != src_last, 'and the picture changed (different values)')
                labels = p.eval_on_selector_all('.le-ticks span', 'els => els.map(e => e.textContent)')
                check(labels == ['2000', '2001', '2002', '2003'], f'the ticks name the bundle\u2019s periods ({labels})')
                p.fill('#le-range', '30')
                p.dispatch_event('#le-range', 'input')
                # what the panel offers
                check(p.locator('[data-preset]').count() == 6, 'six ready-made looks')
                check(p.locator('#le-look-state\\.outline_width').count() == 0 and 'Border width' not in p.inner_text('.le-panel'), 'border width is not offered (the drawer names it as ignored)')
                check(all(w in p.inner_text('.le-panel') for w in ('Middle colour', 'Metal finish', 'Glow')), 'the keys the worker does not take yet are named and not offered')
                check(p.locator('#le-look-choropleth\\.low').count() == 1 and p.locator('#le-look-choropleth\\.high').count() == 1 and p.locator('#le-look-page\\.background').count() == 1 and p.locator('#le-look-sequence\\.theme').count() == 1, 'the low, high, page and theme rows are there')
                # a colour: dragged shows, released commits
                p.eval_on_selector('#le-look-choropleth\\.low', 'e => { e.value = "#00ff00"; e.dispatchEvent(new Event("input", {bubbles: true})); }')
                check(p.evaluate(draft_look).get('choropleth.low') is None, 'a colour being dragged is only shown, not yet a change')
                p.eval_on_selector('#le-look-choropleth\\.low', 'e => e.dispatchEvent(new Event("change", {bubbles: true}))')
                p.wait_for_selector('.le-pill:has-text("Draft, not saved")')
                check((p.evaluate(draft_look).get('choropleth.low') or '').lower() == '#00ff00', 'releasing it makes the change in the shared draft')
                p.click('button:has-text("Undo")')
                p.wait_for_timeout(400)
                check(p.evaluate(draft_look).get('choropleth.low') is None, 'Undo takes it back, in the draft too')
                # presets
                p.click('[data-preset="white-background"]')
                p.wait_for_selector('[data-preset="white-background"][aria-pressed="true"]')
                look = p.evaluate(draft_look)
                check(look.get('sequence.theme') == 'light' and look.get('page.background') == '#ffffff' and look.get('choropleth.low') == '#8c461e' and look.get('choropleth.high') == '#d6a014', f'White background sets theme, page, low and high together ({look})')
                px = p.evaluate(PIXEL, 'img.le-svg')
                check(sum(px['page']) > 700, f'and the picture is now a light page ({px["page"]})')
                n = len(look)
                p.click('button:has-text("Undo")')
                p.wait_for_selector('[data-preset="white-background"][aria-pressed="false"]')
                check(len(p.evaluate(draft_look)) == n - 1, 'Undo takes one change back at a time')
                p.click('[data-preset="monochrome"]')
                p.wait_for_selector('[data-preset="monochrome"][aria-pressed="true"]')
                check('close to the page colour' in p.inner_text('li:has([data-preset="monochrome"])'), 'Monochrome carries its caution in words')
                check('sink' in p.inner_text('li:has([data-preset="monochrome"])') and 'colour ramp' in p.inner_text('li:has([data-preset="monochrome"])'), 'and the ramp caution')
                p.click('[data-preset="dark-default"]')
                p.wait_for_selector('[data-preset="dark-default"][aria-pressed="true"]')
                check(p.evaluate(draft_look) == {}, 'Dark default clears every key it owns')
                # a colour the same as the page warns and does not block
                p.eval_on_selector('#le-look-choropleth\\.low', 'e => { e.value = "#14141a"; e.dispatchEvent(new Event("change", {bubbles: true})); }')
                p.wait_for_selector('.le-warn:has-text("lowest colour is nearly the page colour")')
                check(not p.is_disabled('button:has-text("Render final film")'), 'the warning does not block the final button')
                # what will render
                p.click('button:has-text("Render final film")')
                p.wait_for_selector('.le-render h2')
                txt = p.inner_text('.le-render')
                check('Low colour: #14141a' in txt and 'Border' not in txt, 'the final button lists exactly the look that was set')
                p.screenshot(path=str(OUT / f'data-{name}.png'), full_page=True)
                p.click('button:has-text("Not yet")')
                check(p.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth'), 'no sideways scroll')
                check(not errors, 'no console errors' + (f': {errors[:2]}' if errors else ''))
                ctx.close()
                # a bundle that fails to open
                ctx = b.new_context(**opts)
                ctx.route('**/assets/ryagram-config.js*', lambda route: route.fulfill(status=200, content_type='text/javascript', body=flipped))
                p = ctx.new_page()
                p.goto(f'{BASE}/app/?mock&nobundle#/editor/data', wait_until='load')
                p.wait_for_selector('.le-bundle-note')
                check('could not be opened' in p.inner_text('.le-bundle-note') and p.is_disabled('#le-range'), 'a bundle that fails to open says so and the scrubber stays off')
                check(p.locator('.le-top h1').count() == 1, 'and the rest of the page is still there')
                ctx.close()
            b.close()
    finally:
        srv.shutdown()
    print('ALL OK' if ok else 'FAILED')
    sys.exit(0 if ok else 1)


main()
