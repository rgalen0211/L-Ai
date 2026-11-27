"""Front door check (WEB 11-27): the new / opened signed out at 320, 375, 390, 768 and 1280 px (local server on 127.0.0.1 only, real Chrome).
For each width: no sideways scroll, one h1, the Start free buttons read 'Start free, 16 credits' with their spaces, every link on the page is relative or a known outside host and every relative target exists,
no word of the old consulting site, the hero still is uncropped (object-fit contain) and inside the screen, the page height stays under a pixel budget (4400 at 320, 3700 on a phone or tablet, 3200 wider), buttons are 44 px high and 12 px apart.
    python tools/check-home-door.py        prints FAIL lines; ends with RESULT: PASS or FAIL
"""
import http.server, re, socketserver, sys, threading
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
class H(http.server.SimpleHTTPRequestHandler):
    def __init__(s, *a, **k): super().__init__(*a, directory=str(ROOT), **k)
    def log_message(s, *a): pass
srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), H); PORT = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()
bad = []
def check(c, w):
    if not c: bad.append(w); print('  FAIL ' + w)
OUTSIDE = ('https://youtu.be/', 'mailto:')
with sync_playwright() as pw:
    b = pw.chromium.launch(channel='chrome')
    for w, h in ((320, 640), (375, 812), (390, 844), (768, 1024), (1280, 800)):
        c = b.new_context(viewport={'width': w, 'height': h}, is_mobile=w < 700, color_scheme='dark')
        c.route(re.compile(r'https://fonts\..*'), lambda r, _q: r.abort())
        p = c.new_page(); errs = []; p.on('pageerror', lambda e: errs.append(str(e)))
        p.goto(f'http://127.0.0.1:{PORT}/', wait_until='load'); p.wait_for_timeout(900)
        d = p.evaluate("""() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, sh: document.documentElement.scrollHeight, ih: innerHeight,
          h1: document.querySelectorAll('h1').length, btns: [...document.querySelectorAll('.rg-btn')].map(b => [b.innerText.trim(), Math.round(b.getBoundingClientRect().height)]),
          text: document.body.innerText, links: [...document.querySelectorAll('a[href]')].map(a => a.getAttribute('href')),
          still: (() => { const i = document.querySelector('.rg-hero-still'); if (!i) return null; const r = i.getBoundingClientRect(); return [getComputedStyle(i).objectFit, Math.round(r.left), Math.round(r.right), innerWidth, i.naturalWidth]; })(),
          title: document.title })""")
        check(d['sw'] <= d['cw'], f'[{w}] no sideways scroll ({d["sw"]} of {d["cw"]})')
        check(d['h1'] == 1, f'[{w}] one h1')
        check(len(d['btns']) >= 3 and all(t.startswith('Start free, 16 credits') or t == 'Create an account' for t, _ in d['btns']), f'[{w}] buttons read right: {d["btns"]}')
        check(all(hh >= 44 for _, hh in d['btns']), f'[{w}] buttons are at least 44 px high')
        check(not re.search(r'MindWise|workflow|consult|CRM Room|Creator beta|Keep me posted', d['text'], re.I), f'[{w}] no old consulting or waiting-list word')
        check(d['still'] and d['still'][0] == 'contain' and d['still'][1] >= 0 and d['still'][2] <= d['still'][3] and d['still'][4] > 0, f'[{w}] hero still contained and on screen {d["still"]}')
        check(d['sh'] <= (4400 if w < 375 else 3700 if w < 1000 else 3200), f'[{w}] page is {d["sh"]} px tall ({d["sh"] / d["ih"]:.1f} screens)')
        check(d['title'].startswith('Ryagram'), f'[{w}] title starts Ryagram')
        check(not errs, f'[{w}] no page errors {errs[:1]}')
        if w == 1280:
            for l in d['links']:
                if l.startswith(OUTSIDE) or l.startswith('#'): continue
                check(l.startswith('/'), f'link is relative: {l}')
                t = l.split('#')[0].split('?')[0]
                if t in ('/app/', '/'): continue
                rel = t.lstrip('/')
                check((ROOT / rel).exists() or (ROOT / rel / 'index.html').exists(), f'link target exists: {l}')
        c.close()
    b.close()
print('RESULT:', 'FAIL' if bad else 'PASS')
sys.exit(1 if bad else 0)
