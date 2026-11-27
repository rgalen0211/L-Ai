"""The Compilations page in EVERY state, real Chrome, mock mode, LOCAL server only (WEB 2026-11-27). At 390 and 1280 px: no sideways scroll, every button / tab / field / link at least 44 px tall,
live regions present for the saving / saved / run lines, the saved request listed, and each run state (waiting, planning, matching, building, done with counts, failed with each reason code, cancelled) says
its plain words and never a path or an upload promise. Drives the mock with ?compon, ?comprun=<state>, ?compcode=<reason>, ?compfail (save error). The switch-off page says Coming soon.
Needs Chrome.   python tools/check-compilations-page.py [outdir]"""
import http.server, re, socketserver, sys, threading
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('D:/Ryagram-scratch/WEB/compstates-shots')
OUT.mkdir(parents=True, exist_ok=True)
BS = chr(92)
CODES = {'request_invalid': 'could not be read', 'song_request': 'do not make songs', 'folder_not_chosen': 'choose where that folder', 'folder_missing': 'not there any more', 'folder_empty': 'no videos',
         'folders_overlap': 'same videos', 'no_speech': 'No speech', 'not_said': 'do not say these words', 'edit_failed': 'turned into a film', 'build_failed': 'Nothing left your computer', 'crash': 'went wrong'}
RUNS = [('waiting', None, 'Nothing is made until the Ryagram app opens for you'), ('planning', 'planning', 'planning your film'), ('matching', 'matching', '7 matches'), ('building', 'building', 'making your film'),
        ('done', 'done', '7 matches, 7 clips, 41 seconds long'), ('cancelled', 'cancelled', 'Stopped')] + [('failed-' + c, 'failed&compcode=' + c, w) for c, w in CODES.items()]
PATHISH = re.compile('[A-Za-z]:[' + BS + BS + '/]')


class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=str(ROOT), **k)
    def log_message(self, *a): pass
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store'); super().end_headers()


srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), H)
PORT = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()
ok = True


def check(cond, msg):
    global ok
    print(('ok   ' if cond else 'FAIL ') + msg)
    ok = ok and bool(cond)


SMALL = """[...document.querySelectorAll('.comp-start button, .comp-start select, .comp-start input:not([type=file]), .comp-start textarea, .comp-start a, .comp-requests a, .flip-tab')].filter(e=>e.offsetParent).map(e=>{const r=e.getBoundingClientRect();return [e.id||e.className||e.tagName,Math.round(r.height)]}).filter(x=>x[1]<44&&x[1]>0)"""


def open_page(b, w, query):
    c = b.new_context(viewport={'width': w, 'height': 844 if w < 500 else 900}, is_mobile=w < 500, color_scheme='dark')
    c.route(re.compile(r'https://fonts\..*'), lambda r, _q: r.abort())
    p = c.new_page(); errs = []
    p.on('pageerror', lambda e: errs.append(str(e)[:200]))
    p.goto(f'http://127.0.0.1:{PORT}/app/?mock{query}#/d/compilations', wait_until='load')
    if '&compon' in query:
        try: p.wait_for_selector('#comp-phrase', timeout=15000)
        except Exception:      # the mock's first paint is occasionally slow: one more load, then fail for real
            p.reload(); p.wait_for_selector('#comp-phrase', timeout=30000)
    else: p.wait_for_timeout(1800)
    return c, p, errs


def save(p, phrase='of the people, by the people', folders='Interviews\nB-roll'):
    p.fill('#comp-phrase', phrase); p.fill('#comp-folders', folders); p.click('#comp-save')


def err_text(p):
    return p.evaluate("(document.querySelector('.comp-start .app-error:not([hidden])')||{innerText:''}).innerText")


with sync_playwright() as pw:
    b = pw.chromium.launch(channel='chrome')
    for w in (1280, 390):
        def width_ok(p, what):
            sw = p.evaluate('document.documentElement.scrollWidth')
            check(sw <= w, f'{w} {what}: no sideways scroll ({sw})')
        c, p, errs = open_page(b, w, '&compon')
        check('Compilations' in p.evaluate("[...document.querySelectorAll('h1')].map(e=>e.innerText).join('|')"), f'{w} empty: heading')
        check(p.locator('#comp-pick').count() == 0 and 'upload' not in p.inner_text('.comp-start').lower(), f'{w} empty: no folder picker, no upload word')
        check('not open to everyone yet' in p.inner_text('.comp-start') and 'will ask you where each folder is' in p.inner_text('.comp-start'), f'{w} empty: honest launch words on the first tab')
        p.screenshot(path=str(OUT / f'start-{w}.png')); width_ok(p, 'empty start')
        small = p.evaluate(SMALL); check(not small, f'{w} empty start: every control at least 44 px tall {small}')
        p.locator('button.flip-tab').nth(1).click(); p.wait_for_timeout(300)
        check('No compilation requests yet' in p.inner_text('.comp-requests'), f'{w} empty requests: plain line')
        p.screenshot(path=str(OUT / f'requests-empty-{w}.png')); width_ok(p, 'empty requests'); c.close()
        c, p, errs = open_page(b, w, '&compon&comprun=waiting')
        save(p); p.screenshot(path=str(OUT / f'saving-{w}.png'))
        p.wait_for_timeout(1500)
        check(p.evaluate("!!document.querySelector('.comp-start [role=status][aria-live=polite]')"), f'{w} saved: polite live region for the saved line')
        check('Saved' in p.inner_text('.comp-requests'), f'{w} saved: request listed')
        check('Saved. Nothing is made yet' in p.inner_text('.comp-saved') and 'not open to everyone yet' in p.inner_text('.comp-saved'), f'{w} saved: the honest saved line is announced on the requests tab too')
        p.screenshot(path=str(OUT / f'saved-{w}.png')); width_ok(p, 'saved'); check(not errs, f'{w} saved: no page errors {errs[:1]}')
        small = p.evaluate(SMALL); check(not small, f'{w} saved: controls 44 px {small}'); c.close()
        c, p, errs = open_page(b, w, '&compon')
        save(p, 'x', 'C:/Users/me/videos'); p.wait_for_timeout(500)
        check('not a folder name' in err_text(p), f'{w} path refused in plain words')
        check(p.evaluate("!!document.querySelector('.comp-start .app-error[role=alert]')"), f'{w} error is role=alert')
        p.screenshot(path=str(OUT / f'refused-{w}.png')); c.close()
        c, p, errs = open_page(b, w, '&compon')
        p.fill('#comp-title', 'see C:/temp'); save(p); p.wait_for_timeout(400)
        check('Write words, not a place' in err_text(p), f'{w} a place in the compilation name is refused in plain words')
        p.fill('#comp-title', ''); save(p, 'x', 'a;b'); p.wait_for_timeout(400)
        check('semicolon or a comma' in err_text(p), f'{w} a semicolon in a folder name is refused in plain words'); c.close()
        c, p, errs = open_page(b, w, '&compon&compfail')
        save(p); p.wait_for_timeout(1200)
        check(err_text(p).strip() != '', f'{w} save error shown: {err_text(p)[:60]}')
        p.screenshot(path=str(OUT / f'saveerror-{w}.png')); width_ok(p, 'save error'); c.close()
        for name, q, words in RUNS:
            c, p, errs = open_page(b, w, '&compon' + (f'&comprun={q}' if q else ''))
            save(p); p.wait_for_timeout(1500)
            if not p.is_visible('.comp-run'):
                p.locator('button.flip-tab').nth(1).click(); p.wait_for_timeout(300)
            text = p.inner_text('.comp-run')
            check(words.lower() in text.lower(), f'{w} {name}: says "{words}" -> {text[:70]!r}')
            check(not PATHISH.search(text) and 'upload' not in text.lower(), f'{w} {name}: no path, no upload word')
            check(p.evaluate("document.querySelector('.comp-run').getAttribute('role')") == 'status', f'{w} {name}: run line is a live status')
            width_ok(p, name)
            p.screenshot(path=str(OUT / f'run-{name}-{w}.png')); check(not errs, f'{w} {name}: no page errors'); c.close()
        c, p, errs = open_page(b, w, '')
        check('coming soon' in p.inner_text('body').lower(), f'{w} switch off: Coming soon'); width_ok(p, 'switch off')
        p.screenshot(path=str(OUT / f'off-{w}.png')); c.close()
    # (fold2) a 120-character unbroken phrase and title, and ten long folder names, never push a phone sideways; both flip tabs show whole at 360 and 390
    for w in (1280, 390, 360):
        c, p, errs = open_page(b, w, '&compon&comprun=done')
        tabs = p.evaluate("(()=>{const t=document.querySelector('.flip-tabs');return [t.scrollWidth,t.clientWidth,[...document.querySelectorAll('.flip-tab')].map(e=>{const r=e.getBoundingClientRect(),q=t.getBoundingClientRect();return r.left>=q.left-1&&r.right<=q.right+1})]})()")
        check(tabs[0] <= tabs[1] + 1 and all(tabs[2]), f'{w} both tabs show whole {tabs}')
        RECT = "(()=>{const card=document.querySelector('.flip-panel:not([hidden]) .comp-requests')||document.querySelector('.comp-requests');const cr=card.getBoundingClientRect().right;return [...card.querySelectorAll('li,li strong,li .meta,.comp-run')].filter(e=>e.offsetParent).map(e=>Math.round(e.getBoundingClientRect().right-cr)).filter(d=>d>1)})()"
        cases = {'200-char phrase': ('W' * 200, 'T' * 120), 'emoji': ('😀' * 100, '😀' * 60), 'RTL': ('א' * 200, 'א' * 120)}
        for cname, (ph, tt) in cases.items():
            p.reload(); p.wait_for_selector('#comp-phrase', timeout=30000)
            p.fill('#comp-title', tt)
            save(p, ph[:200], chr(10).join(('Folder' + str(i)).ljust(80, 'x') for i in range(8)))
            p.wait_for_timeout(1500)
            if not p.is_visible('.comp-run'): p.locator('button.flip-tab').nth(1).click(); p.wait_for_timeout(300)
            over = p.evaluate(RECT); check(not over, f'{w} {cname} + long folders: every row, title, quote line and run line stays inside its card {over}')
            sw = p.evaluate('document.documentElement.scrollWidth'); check(sw <= w, f'{w} {cname}: no sideways scroll ({sw})')
            p.screenshot(path=str(OUT / f'longtext-{cname.split()[0]}-{w}.png'))
        c.close()
    b.close()
print('RESULT', 'PASS' if ok else 'FAIL')
sys.exit(0 if ok else 1)
