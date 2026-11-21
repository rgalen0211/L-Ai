"""Phone tap floor (WEB 11-21), real Chrome, mock mode, LOCAL server only, at 390 x 844 (touch) and a desktop width: the film card's Open button, the back links (All projects and the like), the
tutorial link on the builder, the tutorial sample's source link and licence fold are each at least 44 px tall to press on a phone; desktop is unchanged (the Open button stays 40 px).
Planted fault: the same measurement is run after a style that squeezes those elements, and must report them. Not part of the node suite (needs Chrome).

    python tools/check-tap-floor-phone.py [outdir]        (default D:/Ryagram-scratch/WEB/tap-floor-shots)
"""
import http.server
import socketserver
import sys
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('D:/Ryagram-scratch/WEB/tap-floor-shots')
PORT = 0
BASE = ''
# The elements named in the finding, by selector; each measured where visible.
TARGETS = ['.film-card-actions .button', 'main a.back', '.builder-sample-link a', '.builder-source p a', '.builder-source summary']
MEASURE = """(sels) => { const out = []; for (const sel of sels) for (const el of document.querySelectorAll('main ' + sel.replace(/^main /, ''))) {
  const r = el.getBoundingClientRect(), s = getComputedStyle(el); if (!r.width || !r.height || s.visibility === 'hidden') continue;
  out.push([sel, (el.textContent || '').trim().slice(0, 24), Math.round(r.height * 10) / 10]); } return out; }"""
SQUEEZE = """(sels) => { for (const sel of sels) for (const el of document.querySelectorAll('main ' + sel.replace(/^main /, ''))) for (const [k, v] of [['min-height', '0'], ['padding-top', '0'], ['padding-bottom', '0'], ['line-height', '1'], ['height', 'auto']]) el.style.setProperty(k, v, 'important'); }"""


def serve():
    global PORT, BASE
    class H(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *a, **k):
            super().__init__(*a, directory=str(ROOT), **k)

        def log_message(self, *a):
            pass

        def end_headers(self):
            self.send_header('Cache-Control', 'no-store')
            super().end_headers()
    srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), H)
    PORT = srv.server_address[1]; BASE = f'http://127.0.0.1:{PORT}'
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    OUT.mkdir(parents=True, exist_ok=True)
    srv = serve()
    ok = True

    def check(cond, what):
        nonlocal ok
        print(('  ok   ' if cond else '  FAIL ') + what)
        ok = ok and bool(cond)
    try:
        with sync_playwright() as pw:
            b = pw.chromium.launch(channel='chrome')
            for width, height in ((390, 844), (1280, 800)):
                ctx = b.new_context(viewport={'width': width, 'height': height}, has_touch=width < 500)
                page = ctx.new_page()
                errors = []
                page.on('pageerror', lambda e: errors.append(str(e)))
                seen = {}

                def look(name, route, prep=None):
                    page.goto(f'{BASE}/app/?mock{route}', wait_until='load')
                    page.wait_for_timeout(2500)
                    if prep:
                        prep()
                        page.wait_for_timeout(2000)
                    got = page.evaluate(MEASURE, TARGETS)
                    page.screenshot(path=str(OUT / f'bc-tap-{name}-{width}.png'), full_page=True)
                    seen[name] = got
                    return got

                def project():
                    page.locator('.film-grid h3 a').first.click()

                def version():
                    page.locator('.film-grid h3 a').first.click()
                    v = page.locator('main a[href^="#/v/"]').first
                    v.wait_for(timeout=20000)
                    v.click()
                look('home', '#/')
                look('builder', '#/build')
                look('sample', '#/build/sample')
                look('credits', '#/credits')
                look('version', '#/', version)
                allm = [m for rows in seen.values() for m in rows]
                kinds = {m[0] for m in allm}
                check({'.film-card-actions .button', 'main a.back'} <= kinds or width >= 500, f'[{width}] the pages show the Open button and the back link ({sorted(kinds)})')
                if width < 500:
                    short = [m for m in allm if m[2] < 43.5]
                    check(len(allm) >= 5 and not short, f'[{width}] every measured tap target is 44 px or more ({len(allm)} measured; short: {short[:6]})')
                    check(any(m[0] == '.builder-source p a' or m[0] == '.builder-source summary' for m in allm), f'[{width}] the tutorial sample\'s source link and licence fold were measured')
                    # planted fault: squeeze them and the same measurement must report them
                    page.goto(f'{BASE}/app/?mock#/', wait_until='load')
                    page.wait_for_timeout(2500)
                    page.evaluate(SQUEEZE, TARGETS)
                    got = page.evaluate(MEASURE, TARGETS)
                    check(any(m[2] < 43.5 for m in got), f'[{width}] PLANTED FAULT (squeezed Open button) is caught: {[m for m in got if m[2] < 43.5][:3]}')
                else:
                    opens = [m[2] for m in seen['home'] if m[0] == '.film-card-actions .button']
                    check(opens and all(h < 43.5 for h in opens), f'[{width}] desktop is unchanged: the Open button stays at its own height ({opens})')
                check(not errors, f'[{width}] no page errors {errors}')
                ctx.close()
            b.close()
    finally:
        srv.shutdown(); srv.server_close()
    print('RESULT:', 'PASS' if ok else 'FAIL')
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
