"""The film strip under the data editor (WEB, item 1) in real Chrome, mock mode, LOCAL server only, `liveEditor` ON in a local config copy, desktop and phone: the strip shows tiles, the playhead
starts at the first year, clicking and dragging on the strip moves the slider and the picture's year, the slider's own keyboard control still moves the playhead, Play moves it, no sideways scroll
at 375 px, no console errors; the compilation editor has no strip. Needs Chrome.   python tools/check-live-editor-timeline.py"""
import http.server, re, socketserver, sys, threading
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]


class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=str(ROOT), **k)
    def log_message(self, *a): pass
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store'); super().end_headers()


srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), H)          # its own port, loopback only
PORT = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()
base = (ROOT / 'assets/ryagram-config.js').read_text(encoding='utf-8')
on_cfg, _n = re.subn(r"\bliveEditor:\s*(?:false|'account')", 'liveEditor: true', base)
assert _n == 1
ok = True


def check(c, w):
    global ok
    print(('  ok   ' if c else '  FAIL ') + w); ok = ok and bool(c)


with sync_playwright() as pw:
    b = pw.chromium.launch(channel='chrome')
    for name, opts in (('desktop', dict(viewport={'width': 1200, 'height': 900})), ('phone', dict(viewport={'width': 375, 'height': 812}, device_scale_factor=2, is_mobile=True, has_touch=True))):
        print(name)
        ctx = b.new_context(**opts); errs = []
        ctx.route(re.compile(r'https://fonts\.(googleapis|gstatic)\.com/.*'), lambda r, _q: r.abort())
        ctx.route('**/assets/ryagram-config.js*', lambda r, _q: r.fulfill(status=200, content_type='text/javascript', body=on_cfg))
        # the website today has no drawing data route for a person's film, so the editor falls back to the stand-in picture: the same as the engine's look scripts not being there
        ctx.route(re.compile(r'.*/assets/app-editor-data\.js.*'), lambda r, _q: r.abort())
        p = ctx.new_page()
        p.on('pageerror', lambda e: errs.append(str(e))); p.on('console', lambda m: errs.append(m.text) if m.type == 'error' and 'Failed to load resource' not in m.text else None)
        p.goto(f'http://127.0.0.1:{PORT}/app/?mock#/editor/data', wait_until='load'); p.wait_for_selector('.le-tl-strip', timeout=15000)
        tiles = p.locator('.le-tl-tile')
        check(tiles.count() == (12 if opts['viewport']['width'] > 700 else 6), f'the right number of tiles for the width ({tiles.count()})')
        check(p.locator('.le-tl[aria-hidden="true"]').count() == 1, 'the strip is hidden from assistive tech (the slider is the control)')
        v0 = int(p.locator('#le-range').input_value())
        on_year = int(p.locator('.le-tl-on i').inner_text())
        check(on_year <= v0 and all(int(x) <= v0 or int(x) > on_year for x in p.locator('.le-tl-tile i').all_inner_texts()) and p.locator('.le-tl-on').count() == 1, f'the current tile holds the slider year ({on_year} for {v0})')
        box = p.locator('.le-tl-strip').bounding_box()
        hx = p.evaluate("(() => { const h = document.querySelector('.le-tl-head').getBoundingClientRect(), t = document.querySelector('.le-tl-on').getBoundingClientRect(); return [h.left + h.width / 2, t.left, t.right]; })()")
        nxt = p.evaluate("(() => { const t = document.querySelector('.le-tl-on').nextElementSibling; if (!t || !t.classList.contains('le-tl-tile')) return null; const r = t.getBoundingClientRect(); return r.right; })()")
        check(hx[1] - 1 <= hx[0] <= (nxt if nxt else hx[2]) + 1, f'the playhead sits on the current tile or just after its centre toward the next ({hx[0]:.0f} in {hx[1]:.0f} to {(nxt or hx[2]):.0f})')
        p.mouse.click(box['x'] + box['width'] * 0.5, box['y'] + box['height'] / 2); p.wait_for_timeout(200)
        v = int(p.locator('#le-range').input_value())
        tile_year = int(p.evaluate("(() => { const t = [...document.querySelectorAll('.le-tl-tile')]; return t[Math.floor(t.length / 2)].dataset.year; })()"))
        check(v == tile_year, f'a click in the middle lands on the middle tile ({v} is tile {tile_year})')
        check(p.locator('.le-pos').inner_text() == str(v), 'and the position label')
        head1 = p.evaluate("parseFloat(document.querySelector('.le-tl-head').style.left)")
        check(40 < head1 < 60, f'the playhead moved with it ({head1:.0f}%)')
        p.mouse.move(box['x'] + box['width'] * 0.5, box['y'] + box['height'] / 2); p.mouse.down(); p.mouse.move(box['x'] + box['width'] * 0.95, box['y'] + box['height'] / 2, steps=6); p.mouse.up(); p.wait_for_timeout(200)
        v2 = int(p.locator('#le-range').input_value())
        check(v2 >= 2005, f'dragging to the right end moves the slider there ({v2})')
        p.locator('#le-range').focus(); p.keyboard.press('Home'); p.wait_for_timeout(200)
        check(int(p.locator('#le-range').input_value()) == 1985 and abs(p.evaluate("parseFloat(document.querySelector('.le-tl-head').style.left)") - 50 / tiles.count()) < 0.01 and p.locator('.le-tl-on i').inner_text() == '1985', 'the slider keyboard still works and the playhead follows it (first tile centre)')
        p.click('button:has-text("Play")'); p.wait_for_timeout(900)
        moved = p.evaluate("parseFloat(document.querySelector('.le-tl-head').style.left)")
        check(moved > 0, f'Play moves the playhead ({moved:.1f}%)')
        p.click('button:has-text("Pause")')
        p.mouse.click(box['x'] + box['width'] * 0.2, box['y'] + box['height'] / 2); p.wait_for_timeout(200)
        check(p.locator('button:has-text("Play")').count() == 1, 'a click on the strip stops playback')
        check(p.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth'), 'no sideways scroll')
        p.screenshot(path=f'D:/Ryagram-scratch/WEB/editor-timeline-{name}.png', full_page=True)
        ctx2 = b.new_context(**opts); ctx2.route('**/assets/ryagram-config.js*', lambda r, _q: r.fulfill(status=200, content_type='text/javascript', body=on_cfg))
        p2 = ctx2.new_page(); p2.goto(f'http://127.0.0.1:{PORT}/app/?mock#/editor/data', wait_until='load'); p2.wait_for_selector('#le-range', timeout=15000); p2.wait_for_timeout(600)
        check(p2.locator('.le-tl-strip').count() == 0, 'a film with real drawing data keeps its own slider until the strip can draw its pictures'); ctx2.close()
        p.goto(f'http://127.0.0.1:{PORT}/app/?mock#/editor/compilation', wait_until='load'); p.wait_for_selector('.le-lanes', state='attached', timeout=15000); p.wait_for_timeout(400)
        check(p.locator('.le-tl-strip').count() == 0, 'the compilation editor has no film strip (it has tracks and a ruler)')
        if name == 'desktop':                                      # on a phone the tracks give way to a plain clip list, so there is no ruler to use
            over = p.evaluate("(() => { const b = document.querySelector('.le-ruler-bar').getBoundingClientRect(); return Math.max(...[...document.querySelectorAll('.le-ruler-tick i')].map(i => i.getBoundingClientRect().right - b.right)); })()")
            check(over <= 0.5, f'no ruler label overhangs the bar ({over:.1f}px)')
            rb = p.locator('.le-ruler-bar').bounding_box()
            check(p.locator('.le-ruler-tick').count() >= 5 and p.locator('.le-ruler-tick i').first.inner_text() == '0:00', 'the compilation editor has a time ruler above its tracks')
            p.mouse.click(rb['x'] + rb['width'] * 0.5, rb['y'] + rb['height'] / 2); p.wait_for_timeout(250)
            pos = p.locator('.le-pos').inner_text()
            check(pos.startswith('0:06'), f'a click in the middle of the ruler moves the playhead to the middle ({pos})')
            hp = p.evaluate("parseFloat(document.querySelector('.le-ruler-head').style.left)")
            check(45 < hp < 55, f'and the ruler playhead follows ({hp:.0f}%)')
            p.mouse.move(rb['x'] + rb['width'] * 0.5, rb['y'] + rb['height'] / 2); p.mouse.down(); p.mouse.move(rb['x'] + rb['width'] * 0.9, rb['y'] + rb['height'] / 2, steps=5); p.mouse.up(); p.wait_for_timeout(250)
            check(p.locator('.le-pos').inner_text().startswith('0:10') or p.locator('.le-pos').inner_text().startswith('0:11'), f"dragging on the ruler scrubs ({p.locator('.le-pos').inner_text()})")
        check(not errs, 'no console errors' + (f': {errs[:2]}' if errs else ''))
        ctx.close()
    b.close()
srv.shutdown(); srv.server_close()
print('ALL OK' if ok else 'FAILED'); sys.exit(0 if ok else 1)
