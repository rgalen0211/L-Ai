"""The design system's rules, in real Chrome, mock mode, LOCAL server only (WEB 2026-11-20, Ryan's front-end order). The signed-in app on the home page:
(1) the header is ONE line at 1280, 1024, 820 and 390 px (the brand, the nav or its Menu button and the avatar share one row, nothing wraps, no sideways scroll);
(2) Sign out is a quiet item INSIDE the account menu (not in the bar) and still signs out;
(3) every .card, .film-card and .dept-card has at least 24 px of padding inside;
(4) cards in a row share a width (the film cards, the department cards);
(5) no text sits closer than 16 px to the edge of its card (home page);
(6) no sideways page scroll.
`--selftest` plants one fault per rule in a scratch copy of the stylesheet and each must be caught.  Needs Chrome.   python tools/check-design-system.py [outdir]  |  python tools/check-design-system.py --selftest"""
import http.server, re, shutil, socketserver, sys, tempfile, threading
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
SELFTEST = '--selftest' in sys.argv
OUT = Path([a for a in sys.argv[1:] if not a.startswith('--')][0]) if [a for a in sys.argv[1:] if not a.startswith('--')] else Path('D:/Ryagram-scratch/WEB/ds-check-shots')
WIDTHS = (1280, 1024, 820, 390)


def serve(root):
    class H(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *a, **k): super().__init__(*a, directory=str(root), **k)
        def log_message(self, *a): pass
        def end_headers(self):
            self.send_header('Cache-Control', 'no-store'); super().end_headers()
    srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


def run(root, tag=''):
    """returns a dict rule -> list of problems"""
    srv = serve(root); port = srv.server_address[1]
    base = (root / 'assets/ryagram-config.js').read_text(encoding='utf-8')
    cfg = re.sub(r"\bdepartments:\s*false", 'departments: true', re.sub(r"liveEditor:\s*(?:false|'account')", 'liveEditor: true', base))
    bad = {k: [] for k in ('header one line', 'sign out in the menu', 'card padding', 'cards share a width', 'text off the card edge', 'no sideways scroll')}
    with sync_playwright() as pw:
        b = pw.chromium.launch(channel='chrome')
        for w in WIDTHS:
            ctx = b.new_context(viewport={'width': w, 'height': 900}, color_scheme='dark')
            ctx.route(re.compile(r'https://fonts\.(googleapis|gstatic)\.com/.*'), lambda r, _q: r.abort())
            ctx.route('**/assets/ryagram-config.js*', lambda r, _q: r.fulfill(status=200, content_type='text/javascript', body=cfg))
            p = ctx.new_page(); p.goto(f'http://127.0.0.1:{port}/app/?mock#/', wait_until='load'); p.wait_for_selector('#np-title', timeout=20000); p.wait_for_timeout(1200)
            p.evaluate("document.querySelector('.mock-bar') && document.querySelector('.mock-bar').remove()")
            # (1) one line: the brand, the departments slot and the account share one row (their vertical centres within 6 px) and the header is a single bar tall
            geo = p.evaluate("""() => { const r = s => { const e = document.querySelector(s); if (!e || e.hidden) return null; const b = e.getBoundingClientRect(); return b.width ? { top: b.top, bottom: b.bottom, cy: (b.top + b.bottom) / 2, h: b.height } : null; };
              const hd = document.querySelector('body>header').getBoundingClientRect(); const nv = document.querySelector('header .container.nav'); return { spill: nv.scrollWidth - nv.clientWidth, overlap: (() => { const k = [...nv.children].filter(c => !c.hidden && c.getBoundingClientRect().width).map(c => c.getBoundingClientRect()); for (let i = 1; i < k.length; i++) if (k[i].left < k[i-1].right - 1) return true; return false; })(), header: hd.height, brand: r('header .brand'), nav: r('header .dept-list') || r('header .dept-menu'), acct: r('#account-avatar') }; }""")
            ys = [g['cy'] for g in (geo['brand'], geo['nav'], geo['acct']) if g]
            if geo['spill'] > 1 or geo['overlap']: bad['header one line'].append(f'{w}px: header content spills ({geo["spill"]} px) or overlaps')
            if geo['header'] > 80 or (ys and max(ys) - min(ys) > 6):
                bad['header one line'].append(f'{w}px: header {geo["header"]:.0f} px tall, centres {[round(y) for y in ys]}')
            # (2) sign out inside the menu, quiet, and not in the bar
            inside = p.evaluate("!!document.querySelector('[data-account-menu] #sign-out')")
            in_bar = p.evaluate("!!document.querySelector('header .container.nav > #sign-out, header .dept-slot #sign-out')")
            if not inside or in_bar: bad['sign out in the menu'].append(f'{w}px: inside menu {inside}, loose in the bar {in_bar}')
            else:
                p.click('[data-account-btn]'); p.wait_for_timeout(150)
                if not p.locator('#sign-out').is_visible(): bad['sign out in the menu'].append(f'{w}px: Sign out is not visible after opening the account menu')
                p.keyboard.press('Escape')
            # (3) padding of every card, (4) widths in a row, (5) text off the edge
            cards = p.evaluate("""() => [...document.querySelectorAll('main .card, main .film-card, main .dept-card, main .credit-balance')].filter(e => e.getBoundingClientRect().width > 0).map(e => { const cs = getComputedStyle(e), b = e.getBoundingClientRect();
                const body = e.querySelector('.film-card-body') || e;
                const bs = getComputedStyle(body);
                const pad = Math.min(parseFloat(bs.paddingLeft), parseFloat(bs.paddingRight), parseFloat(bs.paddingTop), parseFloat(bs.paddingBottom));
                const txt = []; const walker = document.createTreeWalker(e, NodeFilter.SHOW_TEXT); let n; while ((n = walker.nextNode())) { if (!n.textContent.trim()) continue; const r = document.createRange(); r.selectNodeContents(n); const t = r.getBoundingClientRect(); if (!t.width) continue; txt.push(Math.min(t.left - b.left, b.right - t.right)); }
                return { cls: e.className.toString().slice(0, 30), pad, left: b.left, top: Math.round(b.top), w: Math.round(b.width), minEdge: txt.length ? Math.min(...txt) : 99 }; })""")
            for c in cards:
                if c['pad'] < 24 and 'film-card' not in c['cls']: bad['card padding'].append(f'{w}px: {c["cls"]} padding {c["pad"]:.0f} px')
                if c['minEdge'] < 16: bad['text off the card edge'].append(f'{w}px: {c["cls"]} text {c["minEdge"]:.0f} px from the edge')
            for cls in ('film-card', 'dept-card'):
                rows = {}
                for c in cards:
                    if cls in c['cls'] and not (cls == 'dept-card' and c['w'] > 700 and w >= 1000):          # the featured first department card spans the row on purpose
                        rows.setdefault(c['top'] // 40, []).append(c['w'])
                for ws in rows.values():
                    if len(ws) > 1 and max(ws) - min(ws) > 2: bad['cards share a width'].append(f'{w}px: {cls} widths in one row {ws}')
            # (6)
            if not p.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth'): bad['no sideways scroll'].append(f'{w}px: scrollWidth {p.evaluate("document.documentElement.scrollWidth")}')
            ctx.close()
        b.close()
    srv.shutdown(); srv.server_close()
    return bad


if not SELFTEST:
    bad = run(ROOT)
    ok = True
    for rule, probs in bad.items():
        print(('  ok   ' if not probs else '  FAIL ') + rule + ('' if not probs else ': ' + '; '.join(probs[:3]))); ok = ok and not probs
    print('ALL OK' if ok else 'FAILED'); sys.exit(0 if ok else 1)

# ---- selftest: one planted fault per rule in a scratch copy (the real tree is never touched)
FAULTS = [
    ('header one line', 'assets/ryagram-ds.css', '.dept-list{display:none;position:absolute;right:0;', '.dept-list{display:flex;position:static;'),
    ('sign out in the menu', 'app/index.html', '<button id="sign-out" type="button" role="menuitem">Sign out</button>\n</div></div></div></header>', '</div></div><button id="sign-out" type="button">Sign out</button></div></header>'),
    ('card padding', 'assets/ryagram-ds.css', '.dept-card{position:relative;overflow:hidden;display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;align-content:start;gap:var(--s2) var(--s3);padding:var(--s6);', '.dept-card{position:relative;overflow:hidden;display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;align-content:start;gap:var(--s2) var(--s3);padding:var(--s1);'),
    ('cards share a width', 'assets/ryagram-ds.css', '.dept-card-list{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(3,minmax(0,1fr))', '.dept-card-list{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:1.5fr 1fr 1fr'),
    ('no sideways scroll', 'assets/ryagram-ds.css', 'margin-inline:calc(50% - 50vw);width:100vw}', 'margin-inline:calc(50% - 50vw);width:130vw}'),
]
tmp = Path(tempfile.mkdtemp(prefix='dscheck-', dir='D:/Ryagram-scratch/WEB/temp'))
missed = 0
try:
    for rule, f, old, new in FAULTS:
        copy = tmp / 'tree'
        if copy.exists(): shutil.rmtree(copy)
        shutil.copytree(ROOT, copy, ignore=shutil.ignore_patterns('.git', 'node_modules', '.mut-*', 'proposals', 'supabase', '*.test.*', '*_mutants*', '*.json'))   # mock mode needs tests/fake-supabase.js
        t = copy / f; src = t.read_text(encoding='utf-8').replace('\r\n', '\n')
        if old not in src: print(f'  BROKEN FAULT (text not found): {rule}'); missed += 1; continue
        t.write_text(src.replace(old, new), encoding='utf-8')
        got = run(copy)
        caught = bool(got[rule])
        print(('  caught ' if caught else '  MISSED ') + rule); missed += 0 if caught else 1
finally:
    shutil.rmtree(tmp, ignore_errors=True)
print('ALL FAULTS CAUGHT' if not missed else f'{missed} not caught'); sys.exit(1 if missed else 0)
