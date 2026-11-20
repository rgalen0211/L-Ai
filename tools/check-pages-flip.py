"""Long pages as flip sections (WEB 2026-11-20, Ryan 11:55) in real Chrome, mock mode, LOCAL server only. For each page in PAGES: the first screen holds the main action and key facts; every section keeps the page within
MAX_RATIO x the screen at 1280x800 (no long vertical scroll); no sideways scroll at 1280 and 390; the tabs, the dots, the arrow buttons, the keyboard (ArrowRight / ArrowLeft, never while typing) and a touch swipe move between
sections (a vertical swipe does not); the position is kept in the address (?section=<id>) and read back on a reload; a long list scrolls inside its own panel. Needs Chrome.   python tools/check-pages-flip.py [outdir]
Must-fail proof: tests/pages_flip_mutants.mjs-style faults are planted by hand in the scratch copy by running this check against a tree where the rule is broken (see proposals/WEB-DS-PAGES-1120.md)."""
import http.server, re, socketserver, sys, threading
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('D:/Ryagram-scratch/WEB/pages-flip-shots')
OUT.mkdir(parents=True, exist_ok=True)
MAX_RATIO = 1.7                      # the whole page, header to footer, at 1280x800 (the first screen itself holds the action and the facts)


class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=str(ROOT), **k)
    def log_message(self, *a): pass
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store'); super().end_headers()


srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), H)
PORT = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()
base = (ROOT / 'assets/ryagram-config.js').read_text(encoding='utf-8')
cfg = re.sub(r"\bdepartments:\s*false", "departments: true", re.sub(r"liveEditor:\s*(?:false|'account')", 'liveEditor: true', base))
ok = True


def check(c, w):
    global ok
    print(('  ok   ' if c else '  FAIL ') + w); ok = ok and bool(c)


def open_version(p):
    p.goto(f'http://127.0.0.1:{PORT}/app/?mock#/', wait_until='load'); p.wait_for_selector('#np-title', timeout=20000); p.wait_for_timeout(800)
    p.locator('a[href^="#/p/"]').first.click(); p.wait_for_selector('a[href^="#/v/"]'); p.locator('a[href^="#/v/"]').first.click()
    p.wait_for_selector('.flip', timeout=20000); p.wait_for_timeout(1200)


# page name -> (opener, expected section ids)
PAGES = {'Version': (open_version, ['make', 'jobs', 'data', 'files', 'editor', 'advanced'])}


def swipe(p, dx, dy=0):
    p.evaluate("""([dx, dy]) => { const vp = document.querySelector('.flip-viewport'); const t = (type, x, y) => { const e = new Event(type, { bubbles: true }); const pt = { clientX: x, clientY: y }; e.touches = type === 'touchend' ? [] : [pt]; e.changedTouches = [pt]; vp.dispatchEvent(e); };
      t('touchstart', 300, 300); t('touchend', 300 + dx, 300 + dy); }""", [dx, dy])
    p.wait_for_timeout(600)


def cur(p):
    return p.evaluate("(document.querySelector('.flip-tab[aria-selected=true]') || {}).textContent || ''").strip()


with sync_playwright() as pw:
    b = pw.chromium.launch(channel='chrome')
    for name, (opener, ids) in PAGES.items():
        print(name)
        ctx = b.new_context(viewport={'width': 1280, 'height': 800}, color_scheme='dark'); errs = []
        ctx.route(re.compile(r'https://fonts\.(googleapis|gstatic)\.com/.*'), lambda r, _q: r.abort())
        ctx.route('**/assets/ryagram-config.js*', lambda r, _q: r.fulfill(status=200, content_type='text/javascript', body=cfg))
        p = ctx.new_page(); p.on('pageerror', lambda e: errs.append(str(e)))
        opener(p)
        tabs = p.locator('.flip-tab'); n = tabs.count()
        got = p.evaluate("[...document.querySelectorAll('.flip-panel')].map(e => e.dataset.flipSection)")
        check(got[:len(ids)] == ids or all(i in got for i in ids if i != 'editor'), f'{name}: the sections are {got}')
        check(p.locator('.page-hero h1').count() == 1 and p.locator('.fact-cards .fact-card').count() == 3, f'{name}: the first screen has the title band and three key facts')
        first = p.evaluate("(() => { const r = document.querySelector('.flip-bar').getBoundingClientRect(); return r.bottom })()")
        check(first <= 800, f'{name}: the flip bar is on the first screen (bottom {first:.0f} of 800)')
        check(p.evaluate("[...document.querySelectorAll('[data-flip-section=make] button, [data-flip-section=make] summary')].some(b => { const r = b.getBoundingClientRect(); return r.width > 0 && r.top >= 0 && r.bottom <= 800 })"), f'{name}: the main action is visible in the first section')
        for i in range(n):
            tabs.nth(i).click(); p.wait_for_timeout(550)
            h_, vh = p.evaluate('[document.documentElement.scrollHeight, innerHeight]')
            check(h_ <= vh * MAX_RATIO, f'{name}: section {i + 1} ({cur(p)}): the whole page is {h_ / vh:.2f} x the screen (at most {MAX_RATIO})')
            check(p.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth'), f'{name}: section {i + 1}: no sideways scroll')
        tabs.nth(0).click(); p.wait_for_timeout(500)
        # keyboard
        p.locator('body').click(position={'x': 5, 'y': 5}); p.keyboard.press('ArrowRight'); p.wait_for_timeout(500)
        check(p.locator('.flip-tab[aria-selected=true]').evaluate("e => e.parentElement.querySelectorAll('.flip-tab').length > 0 && [...e.parentElement.children].indexOf(e)") == 1, f'{name}: ArrowRight goes to section 2')
        p.keyboard.press('ArrowLeft'); p.wait_for_timeout(500)
        check(p.locator('.flip-tab[aria-selected=true]').evaluate("e => [...e.parentElement.children].indexOf(e)") == 0, f'{name}: ArrowLeft goes back')
        # typing in a field never flips
        inp = p.locator('input, textarea').first
        if inp.count() and inp.is_visible():
            inp.focus(); p.keyboard.press('ArrowRight'); p.wait_for_timeout(300)
            check(p.locator('.flip-tab[aria-selected=true]').evaluate("e => [...e.parentElement.children].indexOf(e)") == 0, f'{name}: ArrowRight inside a field does not flip')
        # dots, arrows
        p.locator('.flip-tab').nth(2).click(); p.wait_for_timeout(500)
        check(p.locator('.flip-dot[aria-current=true]').count() == 1 and p.locator('.flip-tab[aria-selected=true]').evaluate("e => [...e.parentElement.children].indexOf(e)") == 2, f'{name}: a tab opens its section and its dot lights')
        p.locator('[data-flip-prev]').click(); p.wait_for_timeout(500)
        check(p.locator('.flip-tab[aria-selected=true]').evaluate("e => [...e.parentElement.children].indexOf(e)") == 1, f'{name}: the left arrow button goes back')
        p.locator('[data-flip-next]').click(); p.wait_for_timeout(500)
        check(p.locator('.flip-tab[aria-selected=true]').evaluate("e => [...e.parentElement.children].indexOf(e)") == 2, f'{name}: the right arrow button goes on')
        # swipe: horizontal moves, vertical does not
        before = cur(p); swipe(p, -120, 4); after = cur(p)
        check(before != after, f'{name}: a left swipe moves on ({before} to {after})')
        keep = cur(p); swipe(p, -120, 200)
        check(cur(p) == keep, f'{name}: a mostly vertical swipe does not flip')
        # the address remembers the section and a reload reads it back
        hash_ = p.evaluate('location.hash'); check('section=' in hash_, f'{name}: the address carries the section ({hash_})')
        want = cur(p); p.reload(wait_until='load'); p.wait_for_selector('.flip', timeout=20000); p.wait_for_timeout(1200)
        check(cur(p) == want, f'{name}: a reload opens the same section ({want})')
        # a long list scrolls inside its own panel
        check(p.locator('.flip-panel .scroll-panel').count() >= 1 and p.evaluate("getComputedStyle(document.querySelector('.flip-panel .scroll-panel')).overflowY") in ('auto', 'scroll'), f'{name}: a long list sits in a scroll panel')
        p.screenshot(path=str(OUT / f'flip-{name.lower()}-desktop.png'))
        check(not errs, f'{name}: no page errors' + (f': {errs[:2]}' if errs else ''))
        ctx.close()
        # a phone
        ctx = b.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True, color_scheme='dark'); errs = []
        ctx.route(re.compile(r'https://fonts\.(googleapis|gstatic)\.com/.*'), lambda r, _q: r.abort())
        ctx.route('**/assets/ryagram-config.js*', lambda r, _q: r.fulfill(status=200, content_type='text/javascript', body=cfg))
        p = ctx.new_page(); p.on('pageerror', lambda e: errs.append(str(e)))
        opener(p)
        for i in range(p.locator('.flip-tab').count()):
            p.locator('.flip-tab').nth(i).click(); p.wait_for_timeout(500)
            check(p.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth'), f'{name} phone: section {i + 1}: no sideways scroll')
        small = p.evaluate("[...document.querySelectorAll('.flip-tab, .flip-arrow')].filter(e => { const r = e.getBoundingClientRect(); return r.width && (r.height < 44 || r.width < 44) }).length")
        check(small == 0, f'{name} phone: tabs and arrows are at least 44 px')
        p.screenshot(path=str(OUT / f'flip-{name.lower()}-phone.png'))
        check(not errs, f'{name} phone: no page errors')
        ctx.close()

    # ---- the other pages (Account, Credits, My films, Tutorial): measured to the bottom of the footer, the mock bar (a test artefact) hidden
    cfg2 = re.sub(r":\s*'account'", ': true', cfg)
    PAGE_LIMITS = {'Account': (1.5, 1.6), 'Credits': (1.5, 1.7), 'My films': (1.4, 1.5), 'Tutorial': (1.55, 1.7)}
    ROUTE = {'Account': '#/account', 'Credits': '#/credits', 'My films': '#/films', 'Tutorial': '#/build'}

    def foot(p):
        return p.evaluate("Math.round(document.querySelector('footer').getBoundingClientRect().bottom + scrollY)")

    def open2(b, w, h, route):
        ctx = b.new_context(viewport={'width': w, 'height': h}, color_scheme='dark', is_mobile=w < 500, has_touch=w < 500)
        ctx.route(re.compile(r'https://fonts\.(googleapis|gstatic)\.com/.*'), lambda r, _q: r.abort())
        ctx.route('**/assets/ryagram-config.js*', lambda r, _q: r.fulfill(status=200, content_type='text/javascript', body=cfg2))
        p = ctx.new_page(); errs2 = []; p.on('pageerror', lambda e: errs2.append(str(e)))
        p.goto(f'http://127.0.0.1:{PORT}/app/?mock#/', wait_until='load'); p.wait_for_selector('#np-title', timeout=20000)
        p.evaluate("document.querySelector('.mock-bar').style.display = 'none'")
        p.evaluate("(h) => { location.hash = h }", route); p.wait_for_timeout(1800)
        return ctx, p, errs2

    for name, (lim_d, lim_p) in PAGE_LIMITS.items():
        for (w, h_, kind, lim) in ((1280, 800, 'desktop', lim_d), (390, 844, 'phone', lim_p)):
            ctx, p, errs2 = open2(b, w, h_, ROUTE[name])
            if name == 'My films':
                check(p.locator('.films-scroll').count() == 1 and p.evaluate("getComputedStyle(document.querySelector('.films-scroll')).overflowY") in ('auto', 'scroll'), f'{name} {kind}: the film list scrolls in its own panel')
            if name == 'Account':
                check(p.locator('.flip-tab').count() >= 3, f'{name} {kind}: the account sections are tabs ({p.locator(".flip-tab").count()})')
                if kind == 'desktop':
                    p.locator('.flip-tab').first.click(); p.keyboard.press('ArrowRight'); p.wait_for_timeout(500)
                    check(p.locator('.flip-tab[aria-selected=true]').evaluate("e => [...e.parentElement.children].indexOf(e)") >= 1, f'{name}: ArrowRight goes to the next section')
                    check('section=' not in p.evaluate('location.hash'), f'{name}: the address keeps its own form (no section=)')
            if name == 'Credits':
                check(p.locator('.flip-tab').count() in (0, 2), f'{name} {kind}: packs and plans are two tabs when both are on sale ({p.locator(".flip-tab").count()})')
            if name == 'Tutorial':
                check(p.locator('.flip-tab').count() == 2, f'{name} {kind}: step 1 flips between ready-made films and your own data')
                p.locator('.flip-tab').nth(1).click(); p.wait_for_timeout(500)
                check(p.evaluate("getComputedStyle(document.querySelector('.dataset-scroll')).overflowY") in ('auto', 'scroll'), f'{name} {kind}: the dataset list scrolls in its own panel')
                p.locator('input[name=bd-dataset]').first.check(force=True); p.wait_for_timeout(800)
                seen = 0
                for step in range(1, 8):
                    r = foot(p) / h_
                    check(r <= lim, f'{name} {kind}: step {step} is {r:.2f} x the screen (at most {lim})')
                    if step == 7: break
                    if p.locator('input[name=bd-type]').count() and not p.locator('input[name=bd-type]:checked').count(): p.locator('input[name=bd-type]').first.check(force=True)
                    if p.locator('input[name=bd-look]').count() and not p.locator('input[name=bd-look]:checked').count(): p.locator('input[name=bd-look]').first.check(force=True)
                    nb = p.locator('button:text-is("Next")').first
                    if not nb.count() or nb.is_disabled(): check(False, f'{name} {kind}: step {step} has a Next button'); break
                    nb.click(); p.wait_for_timeout(900); seen += 1
                check(seen == 6, f'{name} {kind}: all 7 steps were reached ({seen + 1})')
            else:
                r = foot(p) / h_
                check(r <= lim, f'{name} {kind}: the page is {r:.2f} x the screen (at most {lim})')
            check(p.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth'), f'{name} {kind}: no sideways scroll')
            p.screenshot(path=str(OUT / f'flip-{name.lower().replace(" ", "")}-{kind}.png'))
            check(not errs2, f'{name} {kind}: no page errors' + (f': {errs2[:2]}' if errs2 else ''))
            ctx.close()
    b.close()
srv.shutdown()
print('ALL OK' if ok else 'FAILED'); sys.exit(0 if ok else 1)
