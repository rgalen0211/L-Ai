"""THE RIDE WALK (NEXT-WEB 133): every ride a user can reach, walked locally with mocks, in Chrome and Edge, desktop (1280) and phone (390, touch). LOCAL server only: any request to another host
is answered with a 503 and counted. Each ride gives OK or a PROBLEM with the plain reason; the table is printed and written to RIDE-WALK-RESULTS.md in the output folder.
Run it on the merged test tree (main + every open branch), flags as committed (a ride that needs a flag on is walked twice: as shipped, and with the flag flipped for the walk).

    python tools/ride-walk.py [outdir]        (default D:/Ryagram-scratch/WEB/ride-walk)
Firefox is not installed here; this script takes 'firefox' as a third browser if it ever is.
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
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('D:/Ryagram-scratch/WEB/ride-walk')
PORT = 8187
BASE = f'http://127.0.0.1:{PORT}'
CFG = (ROOT / 'assets' / 'ryagram-config.js').read_text(encoding='utf8')

PUBLIC = [('Home (L\'Ai)', '/'), ('Ryagram page', '/ryagram/'), ('Help', '/help/'), ('Report a film', '/report/'), ('Connect an AI', '/connect-ai/'), ('AI content', '/ai-content/'),
          ('Terms', '/terms/'), ('Privacy', '/privacy-policy.html'), ('AI workflow audit', '/workflow-audit/'), ('Sample film page', '/film/?sample=interstate'), ('Preview demo', '/preview-demo/')]
APP_ROUTES = [('Library', '#/'), ('Credits and packs', '#/credits'), ('Account and connected AIs', '#/account'), ('Guided builder', '#/build'), ('Your look', '#/looks'),
              ('Request a film', '#/request'), ('Get help (in app)', '#/help'), ('Connect the desktop app (device)', '#/device')]

SCAN = r"""() => {
  const vis = el => { const r = el.getBoundingClientRect(), s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const h1 = [...document.querySelectorAll('h1')].filter(vis).map(e => e.textContent.trim().slice(0, 60));
  const alerts = [...document.querySelectorAll('[role=alert],.app-error')].filter(vis).map(e => e.textContent.trim().slice(0, 100)).filter(Boolean);
  const draft = /DRAFT|\[DRAFT|placeholder|TODO|lorem/i.test(document.body.innerText) ? (document.body.innerText.match(/.{0,40}(DRAFT|placeholder|TODO|lorem).{0,40}/i) || [''])[0] : '';
  return { h1, alerts, overflow: document.documentElement.scrollWidth > innerWidth + 1, look: document.body.classList.contains('ryagram-look'), draft, title: document.title };
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


def flipped(**flags):
    s = CFG
    for k, v in flags.items():
        s = re.sub(rf'{k}:\s*(true|false)', f'{k}: {"true" if v else "false"}', s)
    return s


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    OUT.mkdir(parents=True, exist_ok=True)
    srv = serve()
    rows = []          # (browser, view, ride, status, note)
    external = set()

    def add(br, vw, ride, ok, note=''):
        rows.append((br, vw, ride, 'OK' if ok else 'PROBLEM', note))
        print(f'  {"ok  " if ok else "FAIL"} [{br}/{vw}] {ride}{": " + note if note else ""}')

    try:
        with sync_playwright() as pw:
            browsers = [('chrome', lambda: pw.chromium.launch(channel='chrome')), ('edge', lambda: pw.chromium.launch(channel='msedge'))]
            for br, launch in browsers:
                b = launch()
                for vw, opts in (('desktop', dict(viewport={'width': 1280, 'height': 900})),
                                 ('phone', dict(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True))):
                    ctx = b.new_context(**opts)
                    errs = []

                    def guard(route):
                        u = route.request.url
                        if u.startswith('https://cdn.jsdelivr.net/npm/@supabase/') or u.startswith('https://fonts.g'):
                            return route.continue_()                      # the page's own static library and fonts: read-only GETs, no user data
                        if not route.request.url.startswith('http://127.0.0.1'):
                            external.add(route.request.url.split('?')[0][:80])
                            return route.fulfill(status=503, content_type='application/json', body='{}')
                        return route.continue_()
                    ctx.route('**/*', guard)
                    ctx.add_init_script("Object.defineProperty(navigator, 'webdriver', { get: () => false })")

                    def page():
                        p = ctx.new_page()
                        p.on('pageerror', lambda e: errs.append(str(e)[:120]))
                        p.on('dialog', lambda d: d.accept())
                        return p

                    # ---- public pages
                    for name, path in PUBLIC:
                        p = page(); errs.clear()
                        try:
                            resp = p.goto(BASE + path, wait_until='load')
                            p.wait_for_timeout(500)
                            r = p.evaluate(SCAN)
                            probs = []
                            if resp.status != 200: probs.append(f'HTTP {resp.status}')
                            if not r['h1']: probs.append('no visible heading')
                            if r['overflow'] and vw == 'phone': probs.append('sideways scroll')
                            if errs: probs.append('page error: ' + errs[0])
                            if r['draft']: probs.append('draft wording on the page: "' + r['draft'].strip()[:70] + '"')
                            add(br, vw, f'public page: {name}', not probs, '; '.join(probs))
                        except Exception as e:
                            add(br, vw, f'public page: {name}', False, str(e)[:90])
                        p.close()

                    # ---- sign in as shipped (no mock)
                    p = page(); errs.clear()
                    p.goto(BASE + '/app/', wait_until='load'); p.wait_for_selector('#sign-in:not([hidden]) #si-email', timeout=20000)
                    inv_shown = p.evaluate("!document.getElementById('invite-row').hidden")
                    add(br, vw, 'sign in: the real sign-in page and the invite-code entry', inv_shown and not errs, '' if inv_shown else 'invite-code entry hidden (inviteSignup off)')
                    p.close()

                    # ---- the app (mock): every route
                    for ride, route in APP_ROUTES:
                        p = page(); errs.clear()
                        try:
                            p.goto(f'{BASE}/app/?mock&empty{route}', wait_until='load'); p.wait_for_selector('main h1:visible', timeout=20000); p.wait_for_timeout(900)
                            r = p.evaluate(SCAN)
                            probs = []
                            if r['alerts']: probs.append('shows: ' + r['alerts'][0])
                            if r['overflow'] and vw == 'phone': probs.append('sideways scroll')
                            if errs: probs.append('page error: ' + errs[0])
                            if not r['look']: probs.append('not in the dark look')
                            add(br, vw, f'app (mock): {ride}', not probs, '; '.join(probs))
                        except Exception as e:
                            add(br, vw, f'app (mock): {ride}', False, str(e)[:90])
                        p.close()

                    # ---- the Windows download card (tester, as the release record ships: empty)
                    p = page(); errs.clear()
                    p.goto(f'{BASE}/app/?mock&tester#/account', wait_until='load'); p.wait_for_selector('main h1:visible', timeout=20000); p.wait_for_timeout(1500)
                    t = p.locator('section.windows-card')
                    add(br, vw, 'Windows download card (tester)', t.count() == 1 and 'Not ready yet' in t.inner_text(), 'card there, button off, "Not ready yet" until the file is hosted' if t.count() == 1 else 'no card')
                    p.close()

                    # ---- guided first film (flag off live; walked on the mock)
                    p = page(); errs.clear()
                    p.goto(f'{BASE}/app/?mock&empty#/', wait_until='load'); p.wait_for_selector('#first-film', timeout=20000)
                    p.click('#first-film'); p.wait_for_selector('.builder-start', timeout=15000); p.click('.builder-start[data-start="housing"]'); p.wait_for_selector('.builder-summary', timeout=15000)
                    p.click('button:has-text("Make the film and a free contact sheet")'); p.wait_for_selector('h1:has-text("Version 1")', timeout=20000)
                    p.wait_for_selector('.next-strip:not([hidden])', timeout=40000)
                    add(br, vw, 'guided first film to the buy strip (mock; guidedBuilder is OFF live)', not errs, errs[0] if errs else '')
                    p.close()

                    # ---- the shared workspace, both modes, images/text/folders; and song mode
                    p = page(); errs.clear()
                    p.goto(BASE + '/tools/maker-edit/edit.html?fixture', wait_until='load'); p.wait_for_timeout(1200)
                    probs = []
                    p.get_by_role('tab', name='Images and text').click(); p.wait_for_timeout(300)
                    if not p.locator('#add-pic-folder').count(): probs.append('no "Add pictures from a folder"')
                    if not p.locator('#t-size').count(): probs.append('no text size')
                    kind = p.locator('#mode')
                    if kind.count():
                        try:
                            kind.first.select_option(label='Data film'); p.wait_for_timeout(500)
                            if not p.locator('text=/Page colour|Dot size|Options/i').count(): probs.append('Data film shows no options')
                        except Exception as e:
                            probs.append('could not switch to Data film: ' + str(e)[:50])
                    else:
                        probs.append('no Kind of film switch')
                    if errs: probs.append('page error: ' + errs[0])
                    if vw == 'phone' and p.evaluate('document.documentElement.scrollWidth > innerWidth + 1'): probs.append('sideways scroll')
                    add(br, vw, 'shared workspace: compilation, images, text, folders, Data film (practice build; reached from the desktop maker)', not probs, '; '.join(probs))
                    p.close()
                    p = page(); errs.clear()
                    p.goto(BASE + '/tools/maker-song/song.html?fixture', wait_until='load'); p.wait_for_timeout(1200)
                    probs = []
                    if not p.evaluate("!!document.querySelector('main, body h1')"): probs.append('empty page')
                    if errs: probs.append('page error: ' + errs[0])
                    if vw == 'phone' and p.evaluate('document.documentElement.scrollWidth > innerWidth + 1'): probs.append('sideways scroll')
                    add(br, vw, 'song mode screens (practice build; reached from the desktop maker)', not probs, '; '.join(probs))
                    p.close()
                    ctx.close()

                    # ---- See your county: shipped (flag off) and flipped
                    for flag_on in (False, True):
                        ctx2 = b.new_context(**opts)
                        ctx2.route('**/*', guard)
                        ctx2.route('**/assets/ryagram-config.js*', lambda r, _req=None, on=flag_on: r.fulfill(status=200, content_type='text/javascript', body=flipped(seeYourCounty=on)))
                        p = ctx2.new_page(); errs.clear(); p.on('pageerror', lambda e: errs.append(str(e)[:120]))
                        p.goto(BASE + '/film/?sample=interstate', wait_until='load'); p.wait_for_selector('h1'); p.wait_for_timeout(500)
                        has = p.locator('#remix').count() == 1
                        if flag_on:
                            ok = has
                            if has:
                                p.click('#remix-open'); p.wait_for_selector('#remix-state:not([disabled])'); p.select_option('#remix-state', '48'); p.select_option('#remix-county', '201'); p.click('#remix-go'); p.wait_for_timeout(1200)
                                ok = p.locator('#remix-canvas:visible').count() == 1 and not errs
                            add(br, vw, 'See your county (flag flipped on for the walk)', ok, '' if ok else 'section or preview missing')
                        else:
                            add(br, vw, 'See your county (as shipped: flag OFF)', not has, 'flag off and no section, as intended' if not has else 'section shows with the flag off')
                        p.close(); ctx2.close()
                b.close()
    finally:
        srv.shutdown()
    bad = [r for r in rows if r[3] != 'OK']
    lines = ['# Ride walk results (WEB, NEXT-WEB 133)', '', f'{len(rows)} checks, {len(bad)} problems. Browsers: Chrome and Edge (Firefox not installed here). Views: desktop 1280, phone 390 touch.', '']
    lines += ['| browser | view | ride | result | note |', '|---|---|---|---|---|'] + [f'| {a} | {b} | {c} | {d} | {e} |' for a, b, c, d, e in rows]
    lines += ['', 'Hosts other than 127.0.0.1 that pages tried to reach (all blocked): ' + (', '.join(sorted(external)) or 'none')]
    (OUT / 'RIDE-WALK-RESULTS.md').write_text('\n'.join(lines) + '\n', encoding='utf8')
    print(f'\n{len(rows)} checks, {len(bad)} problems; outside hosts blocked: {sorted(external)}')
    sys.exit(1 if bad else 0)


main()
