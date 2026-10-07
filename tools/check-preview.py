"""Runs the live preview in real Chrome against the mock app and measures it. Not part of the node suite (it needs Chrome).

    python tools/check-preview.py

For each profile (desktop; the same with the CPU throttled 4x, a stand-in for a phone; an iPhone-sized touch window with the
same throttle) it opens a version in /app/?mock under the app's real Content-Security-Policy, opens the preview, drags the
slider through the whole film with real pointer events, and reports: console errors (a policy block would show here), the
median and 95th-percentile time to draw a frame, the frames per second the drag achieved, whether snap mode switched on, how
many exact-year frames were cached, and what a mark frame costs from the cache. The numbers are for the SYNTHETIC fixture
(about 1,500 miles); the real Interstate bundle is far heavier, so these prove the machinery, not the final frame rates.
"""
import http.server
import json
import socketserver
import statistics
import sys
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
PORT = 8160

PROFILES = [
    ('desktop', dict(viewport={'width': 1280, 'height': 900}), 1),
    ('desktop, CPU 4x slower', dict(viewport={'width': 1280, 'height': 900}), 4),
    ('iPhone-sized, CPU 4x slower', dict(viewport={'width': 390, 'height': 844}, device_scale_factor=3, is_mobile=True, has_touch=True,
                                         user_agent='Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'), 4),
]

MEASURE = """
async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const D = window.ryagramSceneDraw;
  const files = await window.ryagramZip.read(await window.ryagramMock.client.storage.from('x').download('a/scene.bundle.zip').then(r => r.data.arrayBuffer()));
  const scene = await window.ryagramZip.sceneJson(files['scene.json.gz']);
  // 1. the raw cost of a frame: build the string and put it in the page
  const host = document.createElement('div'); Object.assign(host.style, { position: 'fixed', left: '-9999px', width: '960px', height: '540px' }); document.body.append(host);
  const times = [];
  for (let i = 0; i < 120; i++) { const f = Math.floor(Math.random() * scene.frames); const t = performance.now(); host.innerHTML = D.draw(scene, f); host.getBoundingClientRect(); times.push(performance.now() - t); }
  host.remove(); times.sort((a, b) => a - b);
  // 2. a real drag through the film on the real slider
  const slider = document.querySelector('.pv-slider'); slider.scrollIntoView({ block: 'center' });
  const r = slider.getBoundingClientRect(); const y = r.top + r.height / 2;
  slider.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: r.left, clientY: y }));
  const frames = []; let last = performance.now(); let stop = false;
  const loop = () => { const n = performance.now(); frames.push(n - last); last = n; if (!stop) requestAnimationFrame(loop); }; requestAnimationFrame(loop);
  const t0 = performance.now();
  for (let i = 0; i <= 120; i++) { slider.value = String(Math.round((i / 120) * (scene.frames - 1))); slider.dispatchEvent(new Event('input', { bubbles: true })); await sleep(16); }
  const dragMs = performance.now() - t0; stop = true;
  const snapShown = !document.querySelector('.pv-note').hidden;
  slider.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
  await sleep(300);
  frames.sort((a, b) => a - b);
  return { frameMsMedian: +statistics(times, .5).toFixed(2), frameMsP95: +statistics(times, .95).toFixed(2),
           dragFps: +(1000 / (frames.reduce((a, b) => a + b, 0) / frames.length)).toFixed(1), rafWorstMs: +frames[frames.length - 1].toFixed(1),
           dragMs: Math.round(dragMs), snapNoteShownAtEnd: snapShown };
  function statistics(a, q) { return a[Math.min(a.length - 1, Math.floor(a.length * q))]; }
}
"""


def serve():
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a): pass
    class Server(socketserver.TCPServer):
        allow_reuse_address = True
    srv = Server(('127.0.0.1', PORT), lambda *a, **k: Quiet(*a, directory=str(ROOT), **k))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


def main():
    srv = serve()
    ok = True
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(channel='chrome')
            for name, opts, throttle in PROFILES:
                ctx = browser.new_context(**opts)
                page = ctx.new_page()
                errors = []
                page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
                page.on('pageerror', lambda e: errors.append(str(e)))
                page.goto(f'http://127.0.0.1:{PORT}/app/?mock', wait_until='networkidle')
                page.wait_for_selector('a[href^="#/p/"]')
                page.locator('a[href^="#/p/"]').first.click()
                page.wait_for_selector('a[href^="#/v/"]')
                page.locator('a[href^="#/v/"]').first.click()
                page.wait_for_selector('.preview-panel button')
                if throttle > 1:
                    cdp = ctx.new_cdp_session(page)
                    cdp.send('Emulation.setCPUThrottlingRate', {'rate': throttle})
                page.locator('.preview-panel button').first.click()
                page.wait_for_selector('.pv-slider', timeout=30000)
                page.wait_for_timeout(5000 * (1 if throttle == 1 else 2))              # let the exact-year cache fill in idle time
                cached_before = page.evaluate('document.querySelectorAll(".pv-bitmap").length')
                res = page.evaluate(MEASURE)
                snap = page.evaluate('({note: !document.querySelector(".pv-note").hidden, label: document.querySelector(".pv-label").textContent, vt: document.querySelector(".pv-slider").getAttribute("aria-valuetext")})')
                res.update(errors=errors, label=snap['label'], valuetext=snap['vt'])
                print(f'{name}: {json.dumps(res)}')
                ok = ok and not errors
                ctx.close()
            browser.close()
    finally:
        srv.shutdown()
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
