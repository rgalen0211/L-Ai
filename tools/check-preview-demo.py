"""Measures the live-preview DEMO page (/preview-demo/, the REAL Interstate bundle) in real Chrome. Not part of the node suite (it needs Chrome).

    python tools/check-preview-demo.py [outdir]

For each profile (desktop; CPU throttled 4x; an iPhone-sized touch window throttled 4x, a stand-in for a phone) it opens the page under the
page's real Content-Security-Policy, waits for the film to open, and reports: console errors (a policy block would show here), the time to
open (fetch, unzip, first frame), the cost of putting a frame in the page and painting it (median and 95th percentile over 60 frames across
the film), the frames per second a real pointer drag through the whole film achieved, whether snap-to-exact-years switched on, the number of
exact-year frames cached, and the cost of a colour change on the whole film. Writes screenshots of three moments to outdir
(default D:/Ryagram-scratch/WEB/demo-shots). The numbers are for THIS machine's Chrome with software raster off or on as it chooses; a phone is
slower, which is why the 4x profiles exist. The check says what it measured, it does not promise phone speeds.
"""
import http.server
import json
import socketserver
import sys
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
PORT = 8161
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('D:/Ryagram-scratch/WEB/demo-shots')

PROFILES = [
    ('desktop', dict(viewport={'width': 1280, 'height': 900}), 1),
    ('desktop, CPU 4x slower', dict(viewport={'width': 1280, 'height': 900}), 4),
    ('iPhone-sized, CPU 4x slower', dict(viewport={'width': 390, 'height': 844}, device_scale_factor=3, is_mobile=True, has_touch=True,
                                         user_agent='Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'), 4),
]

MEASURE = """
async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const raf2 = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  const v = window.ryagramDemo.viewer, scene = window.ryagramDemo.baseScene;
  const q = (a, p) => a[Math.min(a.length - 1, Math.floor(a.length * p))];
  // 1. a frame put in the page and painted (two animation frames), at 60 places in the film, not dragging
  const times = [];
  for (let i = 0; i < 60; i++) { const f = Math.round(((i * 37) % 60) / 59 * (scene.frames - 1)); const t = performance.now(); v.setFrame(f); await raf2(); times.push(performance.now() - t); }
  times.sort((a, b) => a - b);
  // 2. a real drag through the whole film on the real slider
  const slider = document.querySelector('.pv-slider'); slider.scrollIntoView({ block: 'center' });
  const r = slider.getBoundingClientRect(); const y = r.top + r.height / 2;
  slider.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: r.left, clientY: y }));
  const frames = []; let last = performance.now(); let stop = false;
  const loop = () => { const n = performance.now(); frames.push(n - last); last = n; if (!stop) requestAnimationFrame(loop); }; requestAnimationFrame(loop);
  const t0 = performance.now(); let snapSeen = false;
  for (let i = 0; i <= 150; i++) { slider.value = String(Math.round((i / 150) * (scene.frames - 1))); slider.dispatchEvent(new Event('input', { bubbles: true })); if (!document.querySelector('.pv-note').hidden) snapSeen = true; await sleep(16); }
  const dragMs = performance.now() - t0; stop = true;
  slider.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
  await sleep(400);
  frames.sort((a, b) => a - b);
  const s = v.state();
  // 3. a colour change on the whole film (the roads), end to end
  const edit = document.querySelector('#demo-edit input[type=color]');
  let colourMs = null;
  if (edit) { const t = performance.now(); edit.value = '#ff8800'; edit.dispatchEvent(new Event('input', { bubbles: true })); await raf2(); colourMs = performance.now() - t; }
  return { frameMsMedian: +q(times, .5).toFixed(1), frameMsP95: +q(times, .95).toFixed(1), dragFps: +(1000 / (frames.reduce((a, b) => a + b, 0) / frames.length)).toFixed(1),
           rafWorstMs: +frames[frames.length - 1].toFixed(1), dragMs: Math.round(dragMs), snapSeenWhileDragging: snapSeen, modeAtEnd: s.mode,
           exactYearsCached: s.cached, marks: s.marks.length, colourChangeMs: colourMs === null ? null : Math.round(colourMs), svgNodes: document.querySelectorAll('.pv-svg *').length };
}
"""


def serve():
    class H(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *a, **k):
            super().__init__(*a, directory=str(ROOT), **k)

        def log_message(self, *a):
            pass
    socketserver.TCPServer.allow_reuse_address = True
    srv = socketserver.ThreadingTCPServer(('127.0.0.1', PORT), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    srv = serve()
    ok = True
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(channel='chrome')
            for n, (name, opts, throttle) in enumerate(PROFILES):
                ctx = browser.new_context(**opts)
                page = ctx.new_page()
                errors = []
                page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
                page.on('pageerror', lambda e: errors.append(str(e)))
                if throttle > 1:
                    page.goto('about:blank')
                    ctx.new_cdp_session(page).send('Emulation.setCPUThrottlingRate', {'rate': throttle})
                page.goto(f'http://127.0.0.1:{PORT}/preview-demo/', wait_until='commit')
                t0 = page.evaluate('performance.now()')
                page.wait_for_selector('.pv-slider', timeout=120000, state='attached')       # (wait_for_function evals a string: the page's policy forbids it)
                for _ in range(600):
                    if page.evaluate('!!(window.ryagramDemo && window.ryagramDemo.viewer)'):
                        break
                    page.wait_for_timeout(100)
                opened_ms = page.evaluate('performance.now()') - t0
                page.wait_for_timeout(4000 * throttle)                     # let the exact-year cache fill in idle time
                res = page.evaluate(MEASURE)
                res.update(openMs=round(opened_ms), errors=errors)
                print(f'{name}: {json.dumps(res)}')
                if n == 0:
                    for label, frame in (('start', 60), ('1965', 900), ('end', 2819)):
                        page.evaluate(f'window.ryagramDemo.viewer.setFrame({frame})')
                        page.wait_for_timeout(600)
                        page.locator('.pv-stage').screenshot(path=str(OUT / f'interstate-{label}.png'))
                if n == 0:
                    # Accuracy of the two-layer fast path: the same mid-year frames drawn the fast way (cached bitmap + live overlay) and the slow way
                    # (the whole frame, nothing cached), compared pixel by pixel.
                    import io
                    import math
                    from PIL import Image, ImageChops
                    worst = 99.0
                    for frame in (450, 1010, 1650, 2300, 2700):
                        page.evaluate(f'window.ryagramDemo.viewer.setFrame({frame})')
                        page.wait_for_timeout(500)
                        fast = Image.open(io.BytesIO(page.locator('.pv-stage').screenshot())).convert('RGB')
                        page.evaluate('window.ryagramDemo.viewer.cache.clear()')
                        page.evaluate(f'window.ryagramDemo.viewer.setFrame({frame})')
                        page.wait_for_timeout(500)
                        full = Image.open(io.BytesIO(page.locator('.pv-stage').screenshot())).convert('RGB')
                        def psnr_of(x, y):
                            diff = ImageChops.difference(x, y)
                            mse = sum(sum(c * c * n for c, n in enumerate(ch.histogram())) for ch in diff.split()) / (x.width * x.height * 3)
                            return 99.0 if mse == 0 else 10 * math.log10(255 * 255 / mse)
                        raw = psnr_of(fast, full)
                        fast.save(OUT / f'fast-{frame}.png'); full.save(OUT / f'full-{frame}.png'); ImageChops.difference(fast, full).point(lambda v: min(255, v * 4)).save(OUT / f'diff-{frame}.png')
                        small = (900, round(fast.height * 900 / fast.width))                  # the cached bitmaps are 900 px wide: compare at THEIR resolution
                        at_bitmap = psnr_of(fast.resize(small, Image.BOX), full.resize(small, Image.BOX))
                        worst = min(worst, at_bitmap)
                        print(f'  fast vs full frame {frame}: PSNR {raw:.1f} dB at screen size (the cached bitmap is softer), {at_bitmap:.1f} dB at the bitmap own size')
                    print(f'  worst fast-vs-full PSNR at the bitmap size {worst:.1f} dB (the bundle check against the engine is a separate, stricter test)')
                    ok = ok and worst >= 30
                    # the theme swap (engine's light palette via the bundle's styles table) and the closing card
                    swap_ms = page.evaluate('''async () => { const t = performance.now(); const r = document.querySelector('#demo-theme-light'); r.checked = true;
                        r.dispatchEvent(new Event('change', { bubbles: true })); await new Promise(x => requestAnimationFrame(() => requestAnimationFrame(x))); return performance.now() - t; }''')
                    page.evaluate('window.ryagramDemo.viewer.setFrame(1650)')
                    page.wait_for_timeout(700)
                    page.locator('.pv-stage').screenshot(path=str(OUT / 'interstate-light-1650.png'))
                    page.wait_for_timeout(6000)                                            # the bitmaps are rebuilt in the new colours in idle time
                    cached = page.evaluate('window.ryagramDemo.viewer.state().cached')
                    page.evaluate('window.ryagramDemo.viewer.setFrame(2819)')
                    page.wait_for_timeout(600)
                    card = page.evaluate("!document.querySelector('.pv-endcard').hidden")
                    page.locator('.pv-stage').screenshot(path=str(OUT / 'interstate-endcard.png'))
                    page.locator('#demo-theme-dark').check()
                    page.wait_for_timeout(300)
                    print(f'  theme swap to light: {swap_ms:.0f} ms to repaint; exact years re-cached: {cached} of 38; end card shown at the last frame: {card}')
                    ok = ok and card
                ok = ok and not errors
                ctx.close()
            browser.close()
    finally:
        srv.shutdown()
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
