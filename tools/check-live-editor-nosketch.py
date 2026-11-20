"""The website's live editor never draws the made-up sketch for a person's own film (WEB 11-20, CLAUDE's launch-slice finding: 'a person must never see a fake drawing of their film'). Real Chrome, mock mode, LOCAL server only,
`liveEditor` ON in a local config copy. With a project in the address and no real frames (the film API is not there, as for a film the engine cannot draw): (1) no invented shapes and no 'Stand-in drawing' words, a plain
sentence instead, a link to the film's own page, no year slider or film strip, no 'waiting for the engine' Look rows, a title that is not the sample film's; (2) a film that has a contact sheet shows ITS OWN latest sheet with an honest
one-liner (made when, which version, not live); (3) the address without a project is the design demo as before (the sketch stays there, labelled).   Needs Chrome.   python tools/check-live-editor-nosketch.py"""
import http.server, re, socketserver, sys, threading, time
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
PROJ = '00000000-0000-4000-8000-0000000000a1'


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


def page(b, errs, width=1100):
    ctx = b.new_context(viewport={'width': width, 'height': 900})
    ctx.route(re.compile(r'https://fonts\.(googleapis|gstatic)\.com/.*'), lambda r, _q: r.abort())
    ctx.route('**/assets/ryagram-config.js*', lambda r, _q: r.fulfill(status=200, content_type='text/javascript', body=on_cfg))
    p = ctx.new_page()
    p.on('pageerror', lambda e: errs.append(str(e))); p.on('console', lambda m: errs.append(m.text) if m.type == 'error' and 'Failed to load resource' not in m.text else None)
    return p


def no_sketch(p, label):
    txt = p.inner_text('.le')
    check('Stand-in drawing' not in txt and 'drawer comes later' not in txt, f'{label}: no "Stand-in drawing" words anywhere on the page')
    check(p.locator('.le-view svg').count() == 0 and p.locator('svg.le-svg').count() == 0, f'{label}: no invented shapes (no svg in the picture area)')
    check('waiting for the engine' not in txt, f'{label}: no "waiting for the engine" rows')
    check(p.locator('#le-range').count() == 0 and p.locator('.le-tl-strip').count() == 0 and p.locator('.le-ticks').count() == 0, f'{label}: no made-up year slider or film strip')
    check('obesity and fast food' not in p.inner_text('h1'), f'{label}: the title is not the sample film’s ({p.inner_text("h1")!r})')


with sync_playwright() as pw:
    b = pw.chromium.launch(channel='chrome')
    errs = []

    print('a film with no real frames and no sheet')
    for width in (1100, 390):
        p = page(b, errs, width)
        p.goto(f'http://127.0.0.1:{PORT}/app/?mock&standin#/editor/data/{PROJ}', wait_until='load'); p.wait_for_selector('h1:has-text("Edit your film")', timeout=15000); p.wait_for_timeout(1500)
        no_sketch(p, f'{width}px')
        v = p.inner_text('.le-view')
        check('cannot be drawn in this editor yet' in v and 'made-up one would not be your film' in v, f'{width}px: a plain sentence says why nothing is drawn')
        check(p.locator(f'.le-view a[href="#/p/{PROJ}"]').count() == 1, f'{width}px: a link to the film’s own page')
        check('No drawing is made up for your film' in p.inner_text('.le') and 'saved to this film' in p.inner_text('.le'), f'{width}px: the page foot says no drawing is made up and that changes go to the draft')
        check(p.locator('.le-panel .le-row input[type=color]').count() >= 1, f'{width}px: the real colour rows are still there')
        panel = p.inner_text('.le-panel')
        check(all(w in panel for w in ('Theme', 'Border width', 'Low colour', 'High colour')) and not any(w in panel for w in ('Glow', 'Metal finish', 'Middle colour', 'Marker shape', 'Labels', 'waiting for')), f'{width}px: the Look rows are the ones the draft accepts and the engine honours (Theme, Border width, Low and High colour); none that cannot take effect')
        p.select_option('#le-look-theme', 'light'); p.wait_for_timeout(500)
        check('Draft, not saved' in p.inner_text('.le-top') and p.locator('button:has-text("Undo")').first.is_enabled(), f'{width}px: choosing Light is a real change to the draft (not saved, Undo is on)')
        p.fill('#le-look-border', '9'); p.locator('#le-look-border').dispatch_event('change'); p.wait_for_timeout(300)
        check(p.input_value('#le-look-border') in ('9', '2') and 'allowed' not in p.inner_text('.le-top').lower(), f'{width}px: a border width over 4 is not sent as a change')
        p.context.close()

    print('a film that has a contact sheet shows its own')
    p = page(b, errs)
    p.goto(f'http://127.0.0.1:{PORT}/app/?mock', wait_until='load'); p.wait_for_selector('#np-title', timeout=20000)
    p.fill('#np-title', 'Sheet film'); p.click('button:text-is("Create")'); p.wait_for_selector('h1:has-text("Version 1")', timeout=20000)
    pid = p.evaluate('() => window.ryagramMock.client.db.projects[window.ryagramMock.client.db.projects.length - 1].id')
    check(len(pid) == 36, f'the new project id {pid}')
    p.wait_for_selector('.template-picker summary', timeout=20000)
    if p.locator('details.template-picker[open]').count() == 0: p.click('.template-picker summary')
    p.click('button:has-text("Use this film")'); p.wait_for_selector('text=Template applied and saved', timeout=20000)
    p.get_by_role('button', name='Make contact sheet').click()
    p.evaluate("() => { window.__fast = setInterval(() => window.ryagramMock.worker.tick(), 130) }")
    end = time.time() + 40
    while time.time() < end and p.locator('.job .state.job-complete').count() < 1: p.wait_for_timeout(250)
    p.evaluate('clearInterval(window.__fast)')
    check(p.locator('.job .state.job-complete').count() >= 1, 'the contact sheet job completed in the mock')
    p.evaluate("pid => { window.ryagramMockLookBundle = undefined; location.hash = '#/editor/data/' + pid; }", pid)      # no look bundle: the website as it is today, where the engine's drawer is not offered
    p.wait_for_selector('h1:has-text("Edit your film")', timeout=15000); p.wait_for_timeout(2500)
    no_sketch(p, 'with a sheet')
    check(p.locator('.le-view img.le-sheet').count() == 1, 'the film’s own contact sheet is shown')
    note = p.inner_text('.le-view')
    check('latest contact sheet' in note and 'made 20' in note and 'from version' in note and 'It is not live' in note, f'an honest one-liner: {note[-170:]!r}')
    check((p.locator('.le-view img.le-sheet').get_attribute('src') or '') != '', 'the picture has a real address')
    p.context.close()

    print('the design demo (no project in the address) is as before')
    p = page(b, errs)
    p.goto(f'http://127.0.0.1:{PORT}/app/?mock&standin#/editor/data', wait_until='load'); p.wait_for_selector('h1:has-text("Edit your film")', timeout=15000); p.wait_for_timeout(500)
    check('Stand-in preview for the design' in p.inner_text('.le') and p.locator('.le-view svg').count() == 1, 'the demo keeps its labelled sketch')
    p.context.close()
    check(not errs, 'no console errors' + (f': {errs[:2]}' if errs else ''))
    b.close()
srv.shutdown(); srv.server_close()
print('ALL OK' if ok else 'FAILED'); sys.exit(0 if ok else 1)
